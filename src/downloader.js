import { config } from '../config.js';
import { store } from './store.js';

const FS_DB_NAME = 'mscd-fs';
const FS_STORE_NAME = 'handles';
const FS_DIR_KEY = 'download-dir';

function openFsDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(FS_DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(FS_STORE_NAME)) {
                db.createObjectStore(FS_STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function fsDbGet(key) {
    const db = await openFsDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(FS_STORE_NAME, 'readonly');
        const req = tx.objectStore(FS_STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function fsDbSet(key, value) {
    const db = await openFsDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(FS_STORE_NAME, 'readwrite');
        const req = tx.objectStore(FS_STORE_NAME).put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function fsDbDel(key) {
    const db = await openFsDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(FS_STORE_NAME, 'readwrite');
        const req = tx.objectStore(FS_STORE_NAME).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export function supportsFileSystemAccess() {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function pickDownloadDir() {
    if (!supportsFileSystemAccess()) throw new Error('当前浏览器不支持文件系统访问');
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await fsDbSet(FS_DIR_KEY, handle);
    return handle;
}

export async function getSavedDirHandle() {
    try {
        return await fsDbGet(FS_DIR_KEY);
    } catch {
        return null;
    }
}

export async function clearSavedDir() {
    try {
        await fsDbDel(FS_DIR_KEY);
    } catch {}
}

export async function ensureDirPermission(handle, request = false) {
    if (!handle) return false;
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if (!request) return false;
    return (await handle.requestPermission(opts)) === 'granted';
}

async function pickUniqueFilename(dirHandle, name, usedSet) {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = name;
    let i = 1;
    while (true) {
        if (usedSet && usedSet.has(candidate)) {
            candidate = `${base} (${i})${ext}`;
            i++;
            continue;
        }
        try {
            await dirHandle.getFileHandle(candidate);
            candidate = `${base} (${i})${ext}`;
            i++;
        } catch (err) {
            if (err.name !== 'NotFoundError') throw err;
            if (usedSet) usedSet.add(candidate);
            return candidate;
        }
    }
}

function proxied(url) {
    if (!url) return '';
    if (!store.get().settings.downloadProxy) return url;
    if (url.startsWith(config.proxy)) return url;
    return config.proxy + encodeURIComponent(url);
}

function sanitizeFilename(name) {
    return String(name || '')
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

function getExtension(quality) {
    return quality === 2000 ? '.flac' : '.mp3';
}

async function fetchWithRetry(url, retries, delay, signal, extraHeaders) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (signal?.aborted) {
            const e = new Error('已取消');
            e.name = 'AbortError';
            throw e;
        }
        try {
            const init = { signal };
            if (extraHeaders) init.headers = extraHeaders;
            const res = await fetch(url, init);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            lastErr = err;
            if (attempt < retries) {
                await new Promise((r) => setTimeout(r, delay * (attempt + 1)));
            }
        }
    }
    throw lastErr || new Error('请求失败');
}

async function downloadWithThreads(url, { retries, retryDelay, threads = 8, signal, onProgress }) {
    let totalSize = 0;
    let supportRanges = false;

    try {
        const probe = await fetch(url, { method: 'HEAD', signal });
        if (probe.ok) {
            totalSize = Number(probe.headers.get('content-length')) || 0;
            const ar = (probe.headers.get('accept-ranges') || '').toLowerCase();
            supportRanges = ar.includes('bytes');
        }
    } catch (e) {
        if (e.name === 'AbortError') throw e;
    }

    if (signal?.aborted) {
        const e = new Error('已取消');
        e.name = 'AbortError';
        throw e;
    }

    const MIN_SIZE = 512 * 1024;
    const useMulti = supportRanges && totalSize >= MIN_SIZE && threads > 1;

    if (!useMulti) {
        const res = await fetchWithRetry(url, retries, retryDelay, signal);
        const cl = Number(res.headers.get('content-length')) || totalSize;
        return await streamToBlob(res, (chunk, total) => {
            onProgress?.(total, cl || total);
        });
    }

    const threadCount = Math.max(1, Math.min(threads, Math.ceil(totalSize / MIN_SIZE)));
    const chunkSize = Math.ceil(totalSize / threadCount);
    const chunks = new Array(threadCount);
    const bytes = new Array(threadCount).fill(0);

    let lastReport = 0;
    const reportProgress = () => {
        const now = Date.now();
        if (now - lastReport < 200) return;
        lastReport = now;
        const total = bytes.reduce((a, b) => a + b, 0);
        onProgress?.(total, totalSize);
    };

    const tasks = Array.from({ length: threadCount }, (_, i) => (async () => {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize - 1, totalSize - 1);
        if (start > end) {
            chunks[i] = new Blob();
            return;
        }

        const headers = { Range: `bytes=${start}-${end}` };
        const res = await fetchWithRetry(url, retries, retryDelay, signal, headers);

        if (!res.body) {
            chunks[i] = await res.blob();
            bytes[i] = chunks[i].size;
            reportProgress();
            return;
        }

        const reader = res.body.getReader();
        const parts = [];
        let localBytes = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value);
            localBytes += value.length;
            bytes[i] = localBytes;
            reportProgress();
        }
        chunks[i] = new Blob(parts);
    })());

    await Promise.all(tasks);

    onProgress?.(totalSize, totalSize);
    return new Blob(chunks);
}

async function streamToBlob(response, onChunk) {
    if (!response.body) {
        return await response.blob();
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
        onChunk?.(value.length, total);
    }
    return new Blob(chunks);
}

function encodeUtf8(str) {
    return new TextEncoder().encode(str);
}

function writeU32LE(n) {
    const b = new Uint8Array(4);
    b[0] = n & 0xff;
    b[1] = (n >>> 8) & 0xff;
    b[2] = (n >>> 16) & 0xff;
    b[3] = (n >>> 24) & 0xff;
    return b;
}

function writeU32BE(n) {
    const b = new Uint8Array(4);
    b[0] = (n >>> 24) & 0xff;
    b[1] = (n >>> 16) & 0xff;
    b[2] = (n >>> 8) & 0xff;
    b[3] = n & 0xff;
    return b;
}

function concatUint8(parts) {
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}

function buildVorbisComment(vendor, tags) {
    const parts = [];
    const vendorBytes = encodeUtf8(vendor);
    parts.push(writeU32LE(vendorBytes.length));
    parts.push(vendorBytes);

    const entries = Object.entries(tags).filter(([, v]) => v != null && v !== '');
    parts.push(writeU32LE(entries.length));

    for (const [k, v] of entries) {
        const entryBytes = encodeUtf8(`${k}=${v}`);
        parts.push(writeU32LE(entryBytes.length));
        parts.push(entryBytes);
    }

    return concatUint8(parts);
}

function buildPictureBlock(picData, mimeType) {
    const parts = [];
    parts.push(writeU32BE(3));

    const mimeBytes = encodeUtf8(mimeType || 'image/jpeg');
    parts.push(writeU32BE(mimeBytes.length));
    parts.push(mimeBytes);

    const descBytes = encodeUtf8('');
    parts.push(writeU32BE(descBytes.length));
    parts.push(descBytes);

    parts.push(writeU32BE(0));
    parts.push(writeU32BE(0));
    parts.push(writeU32BE(0));
    parts.push(writeU32BE(0));

    parts.push(writeU32BE(picData.length));
    parts.push(picData);

    return concatUint8(parts);
}

async function fetchCoverAsBytes(coverUrl) {
    try {
        const res = await fetch(coverUrl);
        if (!res.ok) return null;
        const data = new Uint8Array(await res.arrayBuffer());
        const ct = res.headers.get('content-type') || 'image/jpeg';
        const mime = ct.split(';')[0].trim() || 'image/jpeg';
        return { data, mime };
    } catch {
        return null;
    }
}

async function addMp3Tags(blob, { title, artist, album, coverUrl }) {
    if (typeof window.ID3Writer === 'undefined') return blob;
    try {
        const arrayBuffer = await blob.arrayBuffer();
        const writer = new window.ID3Writer(arrayBuffer);

        if (title) {
            try { writer.setFrame('TIT2', title); } catch (e) {
                console.warn('[downloader] TIT2 failed:', e);
            }
        }
        if (artist) {
            try { writer.setFrame('TPE1', [artist]); } catch (e) {
                console.warn('[downloader] TPE1 failed:', e);
            }
        }
        if (album) {
            try { writer.setFrame('TALB', album); } catch (e) {
                console.warn('[downloader] TALB failed:', e);
            }
        }

        if (coverUrl) {
            const cover = await fetchCoverAsBytes(coverUrl);
            if (cover) {
                try {
                    writer.setFrame('APIC', {
                        type: 3,
                        data: cover.data.buffer,
                        description: 'Cover',
                        mimeType: cover.mime,
                    });
                } catch (e) {
                    console.warn('[downloader] APIC failed:', e);
                }
            }
        }

        writer.addTag();
        return writer.getBlob();
    } catch (err) {
        console.warn('[downloader] MP3 tagging failed:', err);
        return blob;
    }
}

async function addFlacTags(blob, { title, artist, album, coverUrl }) {
    try {
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        if (
            bytes.length < 8 ||
            bytes[0] !== 0x66 || bytes[1] !== 0x4C ||
            bytes[2] !== 0x61 || bytes[3] !== 0x43
        ) {
            return blob;
        }

        const blocks = [];
        let offset = 4;
        while (offset + 4 <= bytes.length) {
            const header = bytes[offset];
            const isLast = (header & 0x80) !== 0;
            const type = header & 0x7f;
            const length =
                (bytes[offset + 1] << 16) |
                (bytes[offset + 2] << 8) |
                bytes[offset + 3];
            const dataStart = offset + 4;
            const dataEnd = dataStart + length;
            if (dataEnd > bytes.length) break;
            blocks.push({ type, data: bytes.slice(dataStart, dataEnd) });
            offset = dataEnd;
            if (isLast) break;
        }

        if (!blocks.length) return blob;

        const commentData = buildVorbisComment('MSCD', {
            TITLE: title,
            ARTIST: artist,
            ALBUM: album,
        });

        let pictureData = null;
        if (coverUrl) {
            const cover = await fetchCoverAsBytes(coverUrl);
            if (cover) {
                pictureData = buildPictureBlock(cover.data, cover.mime);
            }
        }

        const result = [];
        let wroteComment = false;
        let wrotePicture = false;

        for (const block of blocks) {
            if (block.type === 4) {
                result.push({ type: 4, data: commentData });
                wroteComment = true;
            } else if (block.type === 6) {
                if (pictureData) {
                    result.push({ type: 6, data: pictureData });
                    wrotePicture = true;
                } else {
                    result.push({ type: 6, data: block.data });
                }
            } else {
                result.push({ type: block.type, data: block.data });
            }
        }

        if (!wroteComment) {
            result.splice(1, 0, { type: 4, data: commentData });
        }
        if (pictureData && !wrotePicture) {
            let insertAt = result.findIndex((b) => b.type === 4);
            if (insertAt === -1) insertAt = result.length - 1;
            result.splice(insertAt + 1, 0, { type: 6, data: pictureData });
        }

        const audioData = bytes.slice(offset);

        let totalSize = 4;
        for (const b of result) totalSize += 4 + b.data.length;
        totalSize += audioData.length;

        const out = new Uint8Array(totalSize);
        out.set(bytes.slice(0, 4), 0);

        let pos = 4;
        for (let i = 0; i < result.length; i++) {
            const b = result[i];
            const isLast = i === result.length - 1;
            out[pos] = (isLast ? 0x80 : 0) | (b.type & 0x7f);
            out[pos + 1] = (b.data.length >>> 16) & 0xff;
            out[pos + 2] = (b.data.length >>> 8) & 0xff;
            out[pos + 3] = b.data.length & 0xff;
            out.set(b.data, pos + 4);
            pos += 4 + b.data.length;
        }

        out.set(audioData, pos);

        return new Blob([out], { type: 'audio/flac' });
    } catch (err) {
        console.warn('[downloader] FLAC tagging failed:', err);
        return blob;
    }
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function runPool(items, concurrency, worker, shouldStop) {
    const results = new Array(items.length);
    let cursor = 0;
    const workers = Array.from(
        { length: Math.max(1, Math.min(concurrency, items.length)) },
        async () => {
            while (true) {
                if (shouldStop && shouldStop()) return;
                const i = cursor++;
                if (i >= items.length) return;
                try {
                    results[i] = { ok: true, value: await worker(items[i], i) };
                } catch (err) {
                    results[i] = { ok: false, error: err, item: items[i], index: i };
                }
            }
        }
    );
    await Promise.all(workers);
    return results;
}

function applyNamingFormat(song, format) {
    const tpl = String(format || '').trim() || '{title} - {artist}';
    return tpl
        .replace(/\{title\}/g, song.title || '')
        .replace(/\{artist\}/g, song.artist || '')
        .replace(/\{album\}/g, song.album || '');
}

function buildBaseName(song) {
    const format = store.get().settings.namingFormat;
    const raw = applyNamingFormat(song, format);
    return sanitizeFilename(raw) || 'untitled';
}

function getMainArtist(artist) {
    if (!artist) return '';
    const str = String(artist);
    const parts = str.split(/\s*[\/、，,]\s*|\s*&\s*/).filter(Boolean);
    return parts.length ? parts[0].trim() : str.trim();
}

async function getOrCreateSubdir(parentHandle, name, cache) {
    const safe = sanitizeFilename(name) || 'untitled';
    if (cache.has(safe)) return cache.get(safe);
    const promise = parentHandle.getDirectoryHandle(safe, { create: true });
    cache.set(safe, promise);
    try {
        const handle = await promise;
        cache.set(safe, handle);
        return handle;
    } catch (err) {
        cache.delete(safe);
        throw err;
    }
}

async function resolveCategoryDir(rootHandle, song, cache) {
    const mode = store.get().settings.batchCategory || 'none';
    if (mode === 'artist') {
        const artist = getMainArtist(song.artist);
        if (!artist) return rootHandle;
        return getOrCreateSubdir(rootHandle, artist, cache);
    }
    if (mode === 'album') {
        const album = song.album;
        if (!album) return rootHandle;
        return getOrCreateSubdir(rootHandle, album, cache);
    }
    return rootHandle;
}

function newTaskId() {
    return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isCancelledError(err) {
    if (!err) return false;
    if (err.name === 'AbortError') return true;
    const msg = String(err.message || '');
    return msg.includes('取消') || msg.includes('abort');
}

export class Downloader {
    constructor(api, cfg = config) {
        this.api = api;
        this.config = cfg;
        this.taskStates = new Map();
    }

    getState(taskId) {
        return this.taskStates.get(taskId);
    }

    abort(taskId) {
        const state = this.taskStates.get(taskId);
        if (!state) return;
        state.packageRequested = false;
        try { state.abortController.abort(); } catch {}
        for (const c of state.trackControllers.values()) {
            try { c.abort(); } catch {}
        }
        state.trackControllers.clear();
        if (state.writers) {
            for (const w of state.writers.values()) {
                try { w.abort(); } catch {}
            }
            state.writers.clear();
        }
    }

    packageNow(taskId) {
        const state = this.taskStates.get(taskId);
        if (!state) return;
        state.packageRequested = true;
    }

    cancelTrack(taskId, trackId) {
        const state = this.taskStates.get(taskId);
        if (!state) return;
        const c = state.trackControllers.get(trackId);
        if (c) {
            try { c.abort(); } catch {}
            state.trackControllers.delete(trackId);
        }
        if (state.writers) {
            const w = state.writers.get(trackId);
            if (w) {
                try { w.abort(); } catch {}
                state.writers.delete(trackId);
            }
        }
    }

    async prepare(song, quality) {
        const fallback = store.get().settings.downloadQuality
            ?? store.get().settings.quality
            ?? this.config.quality.default;
        const actualQuality = song?._quality ?? quality ?? fallback;
        const audioUrl = await this.api.resolveAudio(song, actualQuality);
        if (!audioUrl) throw new Error('无法解析音频地址');
        const ext = getExtension(actualQuality);
        const baseName = buildBaseName(song);
        return {
            url: audioUrl,
            filename: baseName + ext,
            ext,
            title: song.title || '',
            artist: song.artist || '',
            album: song.album || '',
            cover: song.pic || '',
        };
    }

    async writeTags(blob, meta) {
        const payload = {
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
            coverUrl: meta.cover,
        };
        if (meta.ext === '.flac') {
            return await addFlacTags(blob, payload);
        }
        return await addMp3Tags(blob, payload);
    }

    async downloadLyric(song) {
        const lrc = await this.api.resolveLyric(song);
        if (!lrc || !lrc.trim()) throw new Error('暂无歌词');
        const blob = new Blob([lrc], { type: 'text/plain;charset=utf-8' });
        triggerDownload(blob, buildBaseName(song) + '.lrc');
        return true;
    }

    async fetchLyricText(song) {
        try {
            const lrc = await this.api.resolveLyric(song);
            if (lrc && lrc.trim()) return lrc;
        } catch {}
        return null;
    }

    async downloadOne(song, quality) {
        const { retry, retryDelay } = this.config.download;
        const withLyric = !!song._withLyric;
        const taskId = newTaskId();
        const trackId = `trk-${taskId}-0`;

        const state = {
            abortController: new AbortController(),
            trackControllers: new Map(),
            packageRequested: false,
        };
        this.taskStates.set(taskId, state);

        const track = {
            id: trackId,
            songId: song.id,
            title: song.title || '未知歌曲',
            artist: song.artist || '',
            status: 'resolving',
            bytes: 0,
            totalBytes: 0,
            progress: 0,
            speed: 0,
            eta: null,
            error: null,
            startedAt: Date.now(),
            finishedAt: null,
        };

        store.upsertDownloadTask(taskId, {
            type: 'single',
            label: `下载：${song.title || '未知歌曲'}`,
            status: 'active',
            phase: 'resolving',
            done: 0,
            total: 1,
            bytes: 0,
            totalBytes: 0,
            packagingProgress: null,
            errors: [],
            startedAt: Date.now(),
            finishedAt: null,
            tracks: [track],
        });

        const updateTrack = (patch) => store.updateTaskTrack(taskId, trackId, patch);

        const controller = new AbortController();
        state.trackControllers.set(trackId, controller);

        try {
            if (song._lyricOnly) {
                updateTrack({ status: 'downloading' });
                store.upsertDownloadTask(taskId, { phase: 'downloading' });
                const lrc = await this.fetchLyricText(song);
                if (!lrc) throw new Error('暂无歌词');
                const filename = buildBaseName(song) + '.lrc';
                const blob = new Blob([lrc], { type: 'text/plain;charset=utf-8' });
                triggerDownload(blob, filename);
                updateTrack({
                    status: 'done',
                    bytes: blob.size,
                    totalBytes: blob.size,
                    progress: 1,
                    speed: 0,
                    eta: 0,
                    finishedAt: Date.now(),
                });
                store.upsertDownloadTask(taskId, {
                    status: 'done',
                    phase: 'done',
                    finishedAt: Date.now(),
                });
                this.taskStates.delete(taskId);
                return { taskId };
            }

            const meta = await this.prepare(song, quality);

            if (controller.signal.aborted || state.abortController.signal.aborted) {
                throw new Error('已取消');
            }

            updateTrack({ status: 'downloading' });
            store.upsertDownloadTask(taskId, { phase: 'downloading' });

            const proxyUrl = proxied(meta.url);
            const threads = store.get().settings.downloadThreads || 8;

            let bytes = 0;
            let contentLength = 0;
            const startTime = Date.now();

            const blob = await downloadWithThreads(proxyUrl, {
                retries: retry,
                retryDelay,
                threads,
                signal: controller.signal,
                onProgress: (downloaded, total) => {
                    bytes = downloaded;
                    contentLength = total;
                    const elapsed = (Date.now() - startTime) / 1000;
                    const speed = elapsed > 0 ? bytes / elapsed : 0;
                    const eta = (contentLength > 0 && speed > 0) ? (contentLength - bytes) / speed : null;
                    updateTrack({
                        bytes,
                        totalBytes: contentLength,
                        progress: contentLength > 0 ? Math.min(1, bytes / contentLength) : 0,
                        speed,
                        eta,
                    });
                },
            });

            if (controller.signal.aborted || state.abortController.signal.aborted) {
                throw new Error('已取消');
            }

            updateTrack({ status: 'tagging' });
            store.upsertDownloadTask(taskId, { phase: 'tagging' });
            const finalBlob = await this.writeTags(blob, meta);

            triggerDownload(finalBlob, meta.filename);

            if (withLyric) {
                const lrc = await this.fetchLyricText(song);
                if (lrc) {
                    const lrcBlob = new Blob([lrc], { type: 'text/plain;charset=utf-8' });
                    triggerDownload(lrcBlob, meta.filename.replace(/\.(mp3|flac)$/i, '.lrc'));
                }
            }

            updateTrack({
                status: 'done',
                bytes,
                totalBytes: contentLength || bytes,
                progress: 1,
                speed: 0,
                eta: 0,
                finishedAt: Date.now(),
            });

            store.upsertDownloadTask(taskId, {
                status: 'done',
                phase: 'done',
                finishedAt: Date.now(),
            });

            this.taskStates.delete(taskId);
            return { taskId };
        } catch (err) {
            const cancelled = isCancelledError(err) || state.abortController.signal.aborted;

            this.taskStates.delete(taskId);

            updateTrack({
                status: cancelled ? 'cancelled' : 'error',
                error: cancelled ? null : err.message,
                speed: 0,
                eta: 0,
                finishedAt: Date.now(),
            });

            store.upsertDownloadTask(taskId, {
                status: cancelled ? 'cancelled' : 'error',
                phase: 'error',
                errors: cancelled ? [] : [{ song, error: err.message }],
                finishedAt: Date.now(),
            });

            throw err;
        }
    }

    async downloadToDisk(song, quality) {
        const dirHandle = await getSavedDirHandle();
        if (!dirHandle) throw new Error('未选择本地目录');
        const ok = await ensureDirPermission(dirHandle, true);
        if (!ok) throw new Error('没有目录写入权限');

        const { retry, retryDelay } = this.config.download;
        const withLyric = !!song._withLyric;
        const taskId = newTaskId();
        const trackId = `trk-${taskId}-0`;

        const state = {
            abortController: new AbortController(),
            trackControllers: new Map(),
            writers: new Map(),
            packageRequested: false,
        };
        this.taskStates.set(taskId, state);

        const track = {
            id: trackId,
            songId: song.id,
            title: song.title || '未知歌曲',
            artist: song.artist || '',
            status: 'resolving',
            bytes: 0,
            totalBytes: 0,
            progress: 0,
            speed: 0,
            eta: null,
            error: null,
            startedAt: Date.now(),
            finishedAt: null,
        };

        store.upsertDownloadTask(taskId, {
            type: 'single',
            label: `下载：${song.title || '未知歌曲'}`,
            status: 'active',
            phase: 'resolving',
            done: 0,
            total: 1,
            bytes: 0,
            totalBytes: 0,
            packagingProgress: null,
            errors: [],
            startedAt: Date.now(),
            finishedAt: null,
            tracks: [track],
        });

        const updateTrack = (patch) => store.updateTaskTrack(taskId, trackId, patch);
        const controller = new AbortController();
        state.trackControllers.set(trackId, controller);

        try {
            if (song._lyricOnly) {
                updateTrack({ status: 'downloading' });
                store.upsertDownloadTask(taskId, { phase: 'downloading' });
                const lrc = await this.fetchLyricText(song);
                if (!lrc) throw new Error('暂无歌词');
                const filename = await pickUniqueFilename(dirHandle, buildBaseName(song) + '.lrc');
                const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(lrc);
                await writable.close();
                const size = new Blob([lrc]).size;
                updateTrack({
                    status: 'done',
                    bytes: size,
                    totalBytes: size,
                    progress: 1,
                    speed: 0,
                    eta: 0,
                    finishedAt: Date.now(),
                });
                store.upsertDownloadTask(taskId, {
                    status: 'done',
                    phase: 'done',
                    finishedAt: Date.now(),
                });
                this.taskStates.delete(taskId);
                return { taskId, filename };
            }

            const meta = await this.prepare(song, quality);

            if (controller.signal.aborted || state.abortController.signal.aborted) {
                throw new Error('已取消');
            }

            updateTrack({ status: 'downloading' });
            store.upsertDownloadTask(taskId, { phase: 'downloading' });

            const proxyUrl = proxied(meta.url);
            const threads = store.get().settings.downloadThreads || 8;

            let bytes = 0;
            let contentLength = 0;
            const startTime = Date.now();

            const blob = await downloadWithThreads(proxyUrl, {
                retries: retry,
                retryDelay,
                threads,
                signal: controller.signal,
                onProgress: (downloaded, total) => {
                    bytes = downloaded;
                    contentLength = total;
                    const elapsed = (Date.now() - startTime) / 1000;
                    const speed = elapsed > 0 ? bytes / elapsed : 0;
                    const eta = (contentLength > 0 && speed > 0) ? (contentLength - bytes) / speed : null;
                    updateTrack({
                        bytes,
                        totalBytes: contentLength,
                        progress: contentLength > 0 ? Math.min(1, bytes / contentLength) : 0,
                        speed,
                        eta,
                    });
                },
            });

            if (controller.signal.aborted || state.abortController.signal.aborted) {
                throw new Error('已取消');
            }

            updateTrack({ status: 'tagging' });
            store.upsertDownloadTask(taskId, { phase: 'tagging' });
            const finalBlob = await this.writeTags(blob, meta);

            const filename = await pickUniqueFilename(dirHandle, meta.filename);
            const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(finalBlob);
            await writable.close();

            if (withLyric) {
                const lrc = await this.fetchLyricText(song);
                if (lrc) {
                    const lrcName = filename.replace(/\.(mp3|flac)$/i, '.lrc');
                    const uniqueLrc = await pickUniqueFilename(dirHandle, lrcName);
                    const lrcHandle = await dirHandle.getFileHandle(uniqueLrc, { create: true });
                    const lrcWritable = await lrcHandle.createWritable();
                    await lrcWritable.write(lrc);
                    await lrcWritable.close();
                }
            }

            updateTrack({
                status: 'done',
                bytes,
                totalBytes: contentLength || bytes,
                progress: 1,
                speed: 0,
                eta: 0,
                finishedAt: Date.now(),
            });

            store.upsertDownloadTask(taskId, {
                status: 'done',
                phase: 'done',
                finishedAt: Date.now(),
            });

            this.taskStates.delete(taskId);
            return { taskId, filename };
        } catch (err) {
            const cancelled = isCancelledError(err) || state.abortController.signal.aborted;

            const writable = state.writers.get(trackId);
            if (writable) {
                try { await writable.abort(); } catch {}
                state.writers.delete(trackId);
            }

            this.taskStates.delete(taskId);

            updateTrack({
                status: cancelled ? 'cancelled' : 'error',
                error: cancelled ? null : err.message,
                speed: 0,
                eta: 0,
                finishedAt: Date.now(),
            });

            store.upsertDownloadTask(taskId, {
                status: cancelled ? 'cancelled' : 'error',
                phase: 'error',
                errors: cancelled ? [] : [{ song, error: err.message }],
                finishedAt: Date.now(),
            });

            throw err;
        }
    }

    async downloadBatchToDisk(songs, quality) {
        if (!songs.length) throw new Error('下载列表为空');

        const dirHandle = await getSavedDirHandle();
        if (!dirHandle) throw new Error('未选择本地目录');
        const ok = await ensureDirPermission(dirHandle, true);
        if (!ok) throw new Error('没有目录写入权限');

        const { retry, retryDelay, concurrency } = this.config.download;
        const total = songs.length;
        const taskId = newTaskId();

        const state = {
            abortController: new AbortController(),
            trackControllers: new Map(),
            writers: new Map(),
            packageRequested: false,
        };
        this.taskStates.set(taskId, state);

        const tracks = songs.map((song, index) => ({
            id: `trk-${taskId}-${index}`,
            songId: song.id,
            title: song.title || '未知歌曲',
            artist: song.artist || '',
            status: 'queued',
            bytes: 0,
            totalBytes: 0,
            progress: 0,
            speed: 0,
            eta: null,
            error: null,
            startedAt: null,
            finishedAt: null,
        }));

        store.upsertDownloadTask(taskId, {
            type: 'batch',
            label: `批量下载 ${total} 首`,
            status: 'active',
            phase: 'downloading',
            done: 0,
            total,
            bytes: 0,
            totalBytes: 0,
            packagingProgress: null,
            errors: [],
            startedAt: Date.now(),
            finishedAt: null,
            tracks,
        });

        const updateTrack = (trackId, patch) => store.updateTaskTrack(taskId, trackId, patch);
        const usedNames = new Set();
        const dirCache = new Map();
        const lyricDirCache = new Map();

        const worker = async (song, index) => {
            const trackId = tracks[index].id;

            if (state.abortController.signal.aborted) throw new Error('已取消');

            const cur = store.get().downloadTasks.find((t) => t.id === taskId);
            if (!cur) throw new Error('任务已移除');
            const track = cur.tracks.find((t) => t.id === trackId);
            if (!track || track.status === 'removed' || track.status === 'cancelled' || track.status === 'skipped') {
                return { skipped: true };
            }

            const controller = new AbortController();
            state.trackControllers.set(trackId, controller);

            let writable = null;

            try {
                updateTrack(trackId, { status: 'resolving', startedAt: Date.now() });

                if (song._lyricOnly) {
                    updateTrack(trackId, { status: 'downloading' });
                    const lrc = await this.fetchLyricText(song);
                    if (!lrc) throw new Error('暂无歌词');
                    const baseName = buildBaseName(song);
                    const lyricMode = store.get().settings.lyricSaveMode || 'same';
                    let lrcDir;
                    if (lyricMode === 'separate') {
                        lrcDir = await getOrCreateSubdir(dirHandle, '歌词', lyricDirCache);
                    } else {
                        lrcDir = await resolveCategoryDir(dirHandle, song, dirCache);
                    }
                    const filename = await pickUniqueFilename(lrcDir, baseName + '.lrc', usedNames);
                    const fileHandle = await lrcDir.getFileHandle(filename, { create: true });
                    const w = await fileHandle.createWritable();
                    await w.write(lrc);
                    await w.close();
                    const size = new Blob([lrc]).size;
                    updateTrack(trackId, {
                        status: 'done',
                        bytes: size,
                        totalBytes: size,
                        progress: 1,
                        speed: 0,
                        eta: 0,
                        finishedAt: Date.now(),
                    });
                    return { filename };
                }

                const meta = await this.prepare(song, quality);

                if (controller.signal.aborted || state.abortController.signal.aborted) {
                    throw new Error('已取消');
                }

                updateTrack(trackId, { status: 'downloading' });

                const proxyUrl = proxied(meta.url);
                const threads = store.get().settings.downloadThreads || 8;

                let bytes = 0;
                let contentLength = 0;
                const startTime = Date.now();

                const blob = await downloadWithThreads(proxyUrl, {
                    retries: retry,
                    retryDelay,
                    threads,
                    signal: controller.signal,
                    onProgress: (downloaded, total) => {
                        bytes = downloaded;
                        contentLength = total;
                        const elapsed = (Date.now() - startTime) / 1000;
                        const speed = elapsed > 0 ? bytes / elapsed : 0;
                        const eta = (contentLength > 0 && speed > 0) ? (contentLength - bytes) / speed : null;
                        updateTrack(trackId, {
                            bytes,
                            totalBytes: contentLength,
                            progress: contentLength > 0 ? Math.min(1, bytes / contentLength) : 0,
                            speed,
                            eta,
                        });
                    },
                });

                if (controller.signal.aborted || state.abortController.signal.aborted) {
                    throw new Error('已取消');
                }

                updateTrack(trackId, { status: 'tagging' });
                const finalBlob = await this.writeTags(blob, meta);

                const targetDir = await resolveCategoryDir(dirHandle, song, dirCache);
                const filename = await pickUniqueFilename(targetDir, meta.filename, usedNames);
                const fileHandle = await targetDir.getFileHandle(filename, { create: true });
                const w = await fileHandle.createWritable();
                await w.write(finalBlob);
                await w.close();

                if (song._withLyric) {
                    const lrc = await this.fetchLyricText(song);
                    if (lrc) {
                        const lyricMode = store.get().settings.lyricSaveMode || 'same';
                        let lrcDir;
                        if (lyricMode === 'separate') {
                            lrcDir = await getOrCreateSubdir(dirHandle, '歌词', lyricDirCache);
                        } else {
                            lrcDir = targetDir;
                        }
                        const lrcName = filename.replace(/\.(mp3|flac)$/i, '.lrc');
                        const uniqueLrc = await pickUniqueFilename(lrcDir, lrcName, usedNames);
                        const lrcHandle = await lrcDir.getFileHandle(uniqueLrc, { create: true });
                        const lrcWritable = await lrcHandle.createWritable();
                        await lrcWritable.write(lrc);
                        await lrcWritable.close();
                    }
                }

                updateTrack(trackId, {
                    status: 'done',
                    bytes,
                    totalBytes: contentLength || bytes,
                    progress: 1,
                    speed: 0,
                    eta: 0,
                    finishedAt: Date.now(),
                });

                return { filename };
            } catch (err) {
                if (writable) {
                    try { await writable.abort(); } catch {}
                    state.writers.delete(trackId);
                }
                const cancelled = controller.signal.aborted || state.abortController.signal.aborted || isCancelledError(err);
                updateTrack(trackId, {
                    status: cancelled ? 'cancelled' : 'error',
                    error: cancelled ? null : err.message,
                    speed: 0,
                    eta: 0,
                    finishedAt: Date.now(),
                });
                throw err;
            } finally {
                state.trackControllers.delete(trackId);
            }
        };

        try {
            const pool = await runPool(
                songs,
                concurrency,
                worker,
                () => state.abortController.signal.aborted
            );

            const successful = [];
            const errors = [];

            for (let i = 0; i < pool.length; i++) {
                const r = pool[i];
                if (!r) continue;
                if (r.ok) {
                    if (r.value && r.value.filename) {
                        successful.push(r.value);
                    }
                } else {
                    const cancelled = isCancelledError(r.error) || state.abortController.signal.aborted;
                    if (!cancelled) {
                        errors.push({ song: r.item, error: r.error?.message || '未知错误' });
                    }
                }
            }

            const cur = store.get().downloadTasks.find((t) => t.id === taskId);
            if (cur) {
                for (const track of cur.tracks) {
                    if (track.status === 'queued' || track.status === 'resolving') {
                        updateTrack(track.id, { status: 'skipped', finishedAt: Date.now() });
                    }
                }
            }

            store.upsertDownloadTask(taskId, {
                status: 'done',
                phase: 'done',
                errors,
                finishedAt: Date.now(),
            });

            this.taskStates.delete(taskId);

            return {
                taskId,
                successful: successful.length,
                failed: errors.length,
                errors,
            };
        } catch (err) {
            const cancelled = isCancelledError(err) || state.abortController.signal.aborted;

            this.taskStates.delete(taskId);

            store.upsertDownloadTask(taskId, {
                status: cancelled ? 'cancelled' : 'error',
                phase: 'error',
                errors: cancelled ? [] : [{ song: null, error: err.message }],
                finishedAt: Date.now(),
            });

            throw err;
        }
    }

    async downloadAsZip(songs, quality) {
        if (!songs.length) throw new Error('下载列表为空');

        const { retry, retryDelay, concurrency } = this.config.download;
        const total = songs.length;
        const taskId = newTaskId();

        const state = {
            abortController: new AbortController(),
            trackControllers: new Map(),
            packageRequested: false,
        };
        this.taskStates.set(taskId, state);

        const tracks = songs.map((song, index) => ({
            id: `trk-${taskId}-${index}`,
            songId: song.id,
            title: song.title || '未知歌曲',
            artist: song.artist || '',
            status: 'queued',
            bytes: 0,
            totalBytes: 0,
            progress: 0,
            speed: 0,
            eta: null,
            error: null,
            startedAt: null,
            finishedAt: null,
        }));

        store.upsertDownloadTask(taskId, {
            type: 'batch',
            label: `批量下载 ${total} 首`,
            status: 'active',
            phase: 'downloading',
            done: 0,
            total,
            bytes: 0,
            totalBytes: 0,
            packagingProgress: null,
            errors: [],
            startedAt: Date.now(),
            finishedAt: null,
            tracks,
        });

        const updateTrack = (trackId, patch) => store.updateTaskTrack(taskId, trackId, patch);

        const worker = async (song, index) => {
            const trackId = tracks[index].id;

            if (state.abortController.signal.aborted) throw new Error('已取消');
            if (state.packageRequested) {
                updateTrack(trackId, { status: 'skipped', finishedAt: Date.now() });
                return { skipped: true };
            }

            const cur = store.get().downloadTasks.find((t) => t.id === taskId);
            if (!cur) throw new Error('任务已移除');
            const track = cur.tracks.find((t) => t.id === trackId);
            if (!track || track.status === 'removed' || track.status === 'cancelled' || track.status === 'skipped') {
                return { skipped: true };
            }

            const controller = new AbortController();
            state.trackControllers.set(trackId, controller);

            try {
                updateTrack(trackId, { status: 'resolving', startedAt: Date.now() });

                if (song._lyricOnly) {
                    updateTrack(trackId, { status: 'downloading' });
                    const lrc = await this.fetchLyricText(song);
                    if (!lrc) throw new Error('暂无歌词');
                    const filename = buildBaseName(song) + '.lrc';
                    const size = new Blob([lrc]).size;
                    updateTrack(trackId, {
                        status: 'done',
                        bytes: size,
                        totalBytes: size,
                        progress: 1,
                        speed: 0,
                        eta: 0,
                        finishedAt: Date.now(),
                    });
                    return { meta: { filename }, blob: null, lyric: lrc };
                }

                const meta = await this.prepare(song, quality);

                if (controller.signal.aborted || state.abortController.signal.aborted) {
                    throw new Error('已取消');
                }

                updateTrack(trackId, { status: 'downloading' });

                const proxyUrl = proxied(meta.url);
                const threads = store.get().settings.downloadThreads || 8;

                let bytes = 0;
                let contentLength = 0;
                const startTime = Date.now();

                const blob = await downloadWithThreads(proxyUrl, {
                    retries: retry,
                    retryDelay,
                    threads,
                    signal: controller.signal,
                    onProgress: (downloaded, total) => {
                        bytes = downloaded;
                        contentLength = total;
                        const elapsed = (Date.now() - startTime) / 1000;
                        const speed = elapsed > 0 ? bytes / elapsed : 0;
                        const eta = (contentLength > 0 && speed > 0) ? (contentLength - bytes) / speed : null;
                        updateTrack(trackId, {
                            bytes,
                            totalBytes: contentLength,
                            progress: contentLength > 0 ? Math.min(1, bytes / contentLength) : 0,
                            speed,
                            eta,
                        });
                    },
                });

                if (controller.signal.aborted || state.abortController.signal.aborted) {
                    throw new Error('已取消');
                }

                updateTrack(trackId, { status: 'tagging' });
                const finalBlob = await this.writeTags(blob, meta);

                let lyric = null;
                if (song._withLyric) {
                    lyric = await this.fetchLyricText(song);
                }

                updateTrack(trackId, {
                    status: 'done',
                    bytes,
                    totalBytes: contentLength || bytes,
                    progress: 1,
                    speed: 0,
                    eta: 0,
                    finishedAt: Date.now(),
                });

                return { meta, blob: finalBlob, lyric };
            } catch (err) {
                const cancelled = controller.signal.aborted || state.abortController.signal.aborted || isCancelledError(err);
                updateTrack(trackId, {
                    status: cancelled ? 'cancelled' : 'error',
                    error: cancelled ? null : err.message,
                    speed: 0,
                    eta: 0,
                    finishedAt: Date.now(),
                });
                throw err;
            } finally {
                state.trackControllers.delete(trackId);
            }
        };

        try {
            const pool = await runPool(
                songs,
                concurrency,
                worker,
                () => state.abortController.signal.aborted
            );

            const successful = [];
            const errors = [];

            for (let i = 0; i < pool.length; i++) {
                const r = pool[i];
                if (!r) continue;
                if (r.ok) {
                    if (r.value && r.value.meta) {
                        successful.push(r.value);
                    }
                } else {
                    const cancelled = isCancelledError(r.error) || state.abortController.signal.aborted;
                    if (!cancelled) {
                        errors.push({ song: r.item, error: r.error?.message || '未知错误' });
                    }
                }
            }

            const cur = store.get().downloadTasks.find((t) => t.id === taskId);
            if (cur) {
                for (const track of cur.tracks) {
                    if (track.status === 'queued' || track.status === 'resolving') {
                        updateTrack(track.id, { status: 'skipped', finishedAt: Date.now() });
                    }
                }
            }

            store.upsertDownloadTask(taskId, {
                phase: 'packaging',
                packagingProgress: 0,
                errors,
            });

            if (!successful.length) {
                throw new Error('没有可打包的歌曲');
            }

            const zip = new window.JSZip();
            for (const { meta, blob, lyric } of successful) {
                if (meta.filename.endsWith('.lrc')) {
                    if (lyric) zip.file(meta.filename, lyric);
                } else {
                    zip.file(meta.filename, blob);
                    if (lyric) {
                        zip.file(meta.filename.replace(/\.(mp3|flac)$/i, '.lrc'), lyric);
                    }
                }
            }

            const zipBlob = await zip.generateAsync(
                { type: 'blob' },
                (metadata) => {
                    store.upsertDownloadTask(taskId, {
                        phase: 'packaging',
                        packagingProgress: metadata.percent / 100,
                    });
                }
            );

            triggerDownload(zipBlob, `MSCD_${Date.now()}.zip`);

            store.upsertDownloadTask(taskId, {
                status: 'done',
                phase: 'done',
                packagingProgress: 1,
                errors,
                finishedAt: Date.now(),
            });

            this.taskStates.delete(taskId);

            return {
                taskId,
                successful: successful.length,
                failed: errors.length,
                errors,
            };
        } catch (err) {
            const cancelled = isCancelledError(err) || state.abortController.signal.aborted;

            this.taskStates.delete(taskId);

            store.upsertDownloadTask(taskId, {
                status: cancelled ? 'cancelled' : 'error',
                phase: 'error',
                errors: cancelled ? [] : [{ song: null, error: err.message }],
                finishedAt: Date.now(),
            });

            throw err;
        }
    }
}