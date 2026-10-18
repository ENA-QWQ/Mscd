import { config } from '../config.js';
import { store } from './store.js';
import { recordDownload } from './history.js';

function applyApiProxy(url) {
    if (!url) return url;
    if (url.startsWith(config.proxy)) return url;
    let settings;
    try {
        settings = store.get().settings;
    } catch {
        return url;
    }
    if (!settings || !settings.apiProxy) return url;
    if (!config.proxy) return url;
    return config.proxy + encodeURIComponent(url);
}

const FS_DB_NAME = 'mscd-fs';
const FS_STORE_NAME = 'handles';
const FS_DIR_KEY = 'download-dir';

const coverCache = new Map();
const coverPending = new Map();
const MAX_COVER_CACHE = 20;
const AUTO_RETRY_MAX = 1;

class Semaphore {
    constructor(limit) {
        this.limit = Math.max(1, limit);
        this.active = 0;
        this.queue = [];
    }
    acquire() {
        if (this.active < this.limit) {
            this.active++;
            return Promise.resolve();
        }
        return new Promise((resolve) => this.queue.push(resolve));
    }
    release() {
        if (this.queue.length) {
            const resolve = this.queue.shift();
            resolve();
        } else {
            this.active--;
        }
    }
}

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
        if (usedSet) usedSet.add(candidate);
        try {
            await dirHandle.getFileHandle(candidate);
        } catch (err) {
            if (err.name !== 'NotFoundError') {
                if (usedSet) usedSet.delete(candidate);
                throw err;
            }
            return candidate;
        }
        if (usedSet) usedSet.delete(candidate);
        candidate = `${base} (${i})${ext}`;
        i++;
    }
}

const _wikiFieldMem = new Map();
const _wikiFieldPending = new Map();

async function fetchWikiFields(id) {
    const key = String(id);
    if (!key) return { genre: '', bpm: 0, publishDate: '', language: '' };
    if (_wikiFieldMem.has(key)) return _wikiFieldMem.get(key);
    if (_wikiFieldPending.has(key)) return _wikiFieldPending.get(key);

    const promise = (async () => {
        const out = { genre: '', bpm: 0, publishDate: '', language: '' };
        try {
            const baseUrl = 'https://zm.wwoyun.cn/song/wiki/summary?id=' + encodeURIComponent(key);
            const url = applyApiProxy(baseUrl);
            const res = await fetch(url, { headers: { Accept: 'application/json' } });
            if (res.ok) {
                const json = await res.json();
                const seen = new Set();
                const visit = (node) => {
                    if (!node || typeof node !== 'object') return;
                    if (seen.has(node)) return;
                    seen.add(node);
                    if (Array.isArray(node)) {
                        for (const x of node) visit(x);
                        return;
                    }
                    if (node.creativeType) {
                        const t = String(node.creativeType);
                        const arr = Array.isArray(node.resources) ? node.resources : [];
                        for (const r of arr) {
                            const title = r && r.uiElement && r.uiElement.mainTitle && r.uiElement.mainTitle.title;
                            if (!title) continue;
                            const s = String(title);
                            if ((t === 'songTag' || t === 'genre') && !out.genre) out.genre = s;
                            else if (t === 'language' && !out.language) out.language = s;
                            else if (t === 'bpm' && !out.bpm) {
                                const n = Number(s.replace(/[^0-9.]/g, ''));
                                if (Number.isFinite(n) && n > 0) out.bpm = n;
                            }
                        }
                    }
                    const basic = node.basic;
                    if (basic && !out.publishDate) {
                        const pt = basic.publishTime || basic.publishDate || basic.publishDateStr;
                        if (pt) {
                            const d = new Date(typeof pt === 'number' ? pt : String(pt));
                            if (!isNaN(d.getTime())) {
                                out.publishDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                            }
                        }
                    }
                    for (const k in node) visit(node[k]);
                };
                visit(json);
            }
        } catch {}
        _wikiFieldMem.set(key, out);
        _wikiFieldPending.delete(key);
        return out;
    })();

    _wikiFieldPending.set(key, promise);
    return promise;
}

function proxied(url) {
    if (!url) return '';
    if (!store.get().settings.downloadProxy) return url;
    if (url.startsWith(config.proxy)) return url;
    return config.proxy + encodeURIComponent(url);
}

function shiftLrc(text, seconds) {
    if (!text || !seconds) return text;
    const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    return text.replace(re, (m, mm, ss, ff) => {
        let t = parseInt(mm, 10) * 60 + parseInt(ss, 10);
        if (ff) t += parseInt(String(ff).padEnd(3, '0'), 10) / 1000;
        t += seconds;
        if (t < 0) t = 0;
        const m2 = Math.floor(t / 60);
        const s2 = Math.floor(t % 60);
        const ms2 = Math.round((t - m2 * 60 - s2) * 1000);
        return '[' + String(m2).padStart(2, '0') + ':' + String(s2).padStart(2, '0') + '.' + String(ms2).padStart(3, '0') + ']';
    });
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

function pickMvBr(brs, targetBr, fallback) {
    const available = (brs || [])
        .map((b) => Number(b && b.br))
        .filter((n) => Number.isFinite(n) && n > 0);
    const uniq = Array.from(new Set(available)).sort((a, b) => a - b);
    if (!uniq.length) return targetBr;
    if (uniq.includes(targetBr)) return targetBr;
    if (fallback === 'max') return uniq[uniq.length - 1];
    if (fallback === 'min') return uniq[0];
    let best = uniq[0];
    let bestDist = Math.abs(uniq[0] - targetBr);
    for (const q of uniq) {
        const d = Math.abs(q - targetBr);
        if (d < bestDist) { best = q; bestDist = d; }
    }
    return best;
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

async function streamToBlob(response, onChunk, checkPause) {
    if (!response.body) {
        return await response.blob();
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        if (checkPause) await checkPause();
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
        onChunk?.(value.length, total);
    }
    return new Blob(chunks);
}

async function downloadWithThreads(url, { retries, retryDelay, threads = 8, signal, onProgress, checkPause }) {
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
        }, checkPause);
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
            if (checkPause) await checkPause();
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

function cacheCover(key, value) {
    if (coverCache.size >= MAX_COVER_CACHE) {
        const oldest = coverCache.keys().next().value;
        coverCache.delete(oldest);
    }
    coverCache.set(key, value);
}

async function fetchCoverAsBytes(coverUrl) {
    if (!coverUrl) return null;

    if (coverCache.has(coverUrl)) return coverCache.get(coverUrl);
    if (coverPending.has(coverUrl)) return coverPending.get(coverUrl);

    const promise = (async () => {
        const url = config.proxy && !coverUrl.startsWith(config.proxy)
            ? config.proxy + encodeURIComponent(coverUrl)
            : coverUrl;
        try {
            const res = await fetch(url);
            if (!res.ok) return null;
            const data = new Uint8Array(await res.arrayBuffer());
            const ct = res.headers.get('content-type') || 'image/jpeg';
            const mime = ct.split(';')[0].trim() || 'image/jpeg';
            const result = { data, mime };
            cacheCover(coverUrl, result);
            return result;
        } catch {
            return null;
        } finally {
            coverPending.delete(coverUrl);
        }
    })();

    coverPending.set(coverUrl, promise);
    return promise;
}

async function addMp3Tags(blob, { title, artist, album, year, bpm, genre, coverUrl, writeTitle, writeArtist, writeAlbum, writeYear, writeBpm, writeGenre, writeCover }) {
    if (typeof window.ID3Writer === 'undefined') return blob;
    try {
        const arrayBuffer = await blob.arrayBuffer();
        const writer = new window.ID3Writer(arrayBuffer);

        if (writeTitle !== false && title) {
            try { writer.setFrame('TIT2', title); } catch (e) {
                console.warn('[downloader] TIT2 failed:', e);
            }
        }
        if (writeArtist !== false && artist) {
            try { writer.setFrame('TPE1', [artist]); } catch (e) {
                console.warn('[downloader] TPE1 failed:', e);
            }
        }
        if (writeAlbum !== false && album) {
            try { writer.setFrame('TALB', album); } catch (e) {
                console.warn('[downloader] TALB failed:', e);
            }
        }
        console.log('[MP3 tag]', { writeYear, writeBpm, writeGenre, year, bpm, genre });
        if (writeYear !== false && year) {
            try {
                const y = parseInt(String(year).slice(0, 4), 10);
                if (Number.isFinite(y) && y > 0) writer.setFrame('TYER', y);
            } catch (e) {
                console.warn('[downloader] TYER failed:', e);
            }
        }
        if (writeBpm !== false && bpm) {
            try {
                const b = parseInt(String(bpm), 10);
                if (Number.isFinite(b) && b > 0) writer.setFrame('TBPM', b);
            } catch (e) {
                console.warn('[downloader] TBPM failed:', e);
            }
        }
        if (writeGenre !== false && genre) {
            try { writer.setFrame('TCON', [String(genre)]); } catch (e) {
                console.warn('[downloader] TCON failed:', e);
            }
        }

        if (writeCover !== false && coverUrl) {
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

async function addFlacTags(blob, { title, artist, album, year, bpm, genre, coverUrl, writeTitle, writeArtist, writeAlbum, writeYear, writeBpm, writeGenre, writeCover }) {
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

        const tagKv = {};
        if (writeTitle !== false && title) tagKv.TITLE = title;
        if (writeArtist !== false && artist) tagKv.ARTIST = artist;
        if (writeAlbum !== false && album) tagKv.ALBUM = album;
        if (writeYear !== false && year) tagKv.DATE = String(year);
        if (writeBpm !== false && bpm) tagKv.BPM = String(bpm);
        if (writeGenre !== false && genre) tagKv.GENRE = String(genre);

        const commentData = buildVorbisComment('MSCD', tagKv);

        let pictureData = null;
        if (writeCover !== false && coverUrl) {
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

        const audioData = bytes.subarray(offset);

        let totalSize = 4;
        for (const b of result) totalSize += 4 + b.data.length;
        totalSize += audioData.length;

        const out = new Uint8Array(totalSize);
        out.set(bytes.subarray(0, 4), 0);

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
    if (song && song._kind === 'mv') {
        const mvMode = store.get().settings.mvDirMode || 'same';
        if (mvMode === 'separate') {
            return getOrCreateSubdir(rootHandle, 'MV', cache);
        }
    }
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

function buildCheckPause(state, trackId, controller) {
    return async () => {
        if (state.abortController.signal.aborted || controller.signal.aborted) {
            const e = new Error('已取消');
            e.name = 'AbortError';
            throw e;
        }
        while (state.paused.has(trackId)) {
            await new Promise((resolve) => {
                state.pauseResolvers.set(trackId, resolve);
            });
            if (state.abortController.signal.aborted || controller.signal.aborted) {
                const e = new Error('已取消');
                e.name = 'AbortError';
                throw e;
            }
        }
    };
}

export class Downloader {
    constructor(api, cfg = config) {
        this.api = api;
        this.config = cfg;
        this.taskStates = new Map();
    }

    _recordHistory(song, opts = {}) {
        const s = song || {};
        if (s._historyRecord === false) return;
        try {
            if (store.get().settings.historyRecord === false) return;
        } catch { return; }
        const kind = opts.kind || 'audio';
        const songId = String(s.id || s.songId || '');
        if (!songId) return;
        let source = opts.source;
        if (!source) {
            try { source = store.get().settings.downloadMode === 'stream' ? 'stream' : 'blob'; } catch { source = 'blob'; }
        }
        let quality = opts.quality;
        if (quality == null) quality = s._quality != null ? s._quality : 0;
        recordDownload({
            songId,
            mvId: kind === 'mv' ? String(s.mv || s.mvid || '') : '',
            kind,
            quality: Number(quality) || 0,
            filename: String(opts.filename || ''),
            dirName: String(opts.dirName || ''),
            source,
            status: opts.status || 'done',
            bytes: Number(opts.bytes) || 0,
            title: s.title || '',
            artist: s.artist || '',
            album: s.album || '',
            pic: s.pic || '',
            duration: Number(s.duration) || 0,
            batchId: String(opts.batchId || ''),
        }).catch(() => {});
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
        for (const resolve of state.pauseResolvers.values()) {
            try { resolve(); } catch {}
        }
        state.pauseResolvers.clear();
        state.paused.clear();
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

    pauseTrack(taskId, trackId) {
        const state = this.taskStates.get(taskId);
        if (!state) return;
        state.paused.add(trackId);
        store.updateTaskTrack(taskId, trackId, { paused: true });
    }

    resumeTrack(taskId, trackId) {
        const state = this.taskStates.get(taskId);
        if (!state) return;
        state.paused.delete(trackId);
        const resolve = state.pauseResolvers.get(trackId);
        if (resolve) {
            state.pauseResolvers.delete(trackId);
            try { resolve(); } catch {}
        }
        store.updateTaskTrack(taskId, trackId, { paused: false });
    }

    pauseTask(taskId) {
        const state = this.taskStates.get(taskId);
        if (!state) return;
        const task = store.get().downloadTasks.find((t) => t.id === taskId);
        if (!task || !task.tracks) return;
        for (const track of task.tracks) {
            if (track.status === 'downloading' || track.status === 'queued' || track.status === 'resolving' || track.status === 'tagging') {
                this.pauseTrack(taskId, track.id);
            }
        }
    }

    resumeTask(taskId) {
        const state = this.taskStates.get(taskId);
        if (!state) return;
        const task = store.get().downloadTasks.find((t) => t.id === taskId);
        if (!task || !task.tracks) return;
        for (const track of task.tracks) {
            if (track.paused) {
                this.resumeTrack(taskId, track.id);
            }
        }
    }

    prioritizeTrack(taskId, trackId) {
        const state = this.taskStates.get(taskId);
        if (!state) return;
        if (state.priorityQueue.includes(trackId)) return;
        state.priorityQueue.unshift(trackId);
    }

    cancelTrack(taskId, trackId) {
        const state = this.taskStates.get(taskId);
        if (!state) return;
        state.paused.delete(trackId);
        const resolve = state.pauseResolvers.get(trackId);
        if (resolve) {
            state.pauseResolvers.delete(trackId);
            try { resolve(); } catch {}
        }
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

    removeTrackFromTask(taskId, trackId) {
        const tasks = store.get().downloadTasks;
        const idx = tasks.findIndex((t) => t.id === taskId);
        if (idx === -1) return;
        const task = tasks[idx];
        if (!task.tracks) return;
        const tracks = task.tracks.map((t) =>
            t.id === trackId
                ? { ...t, status: 'removed', speed: 0, eta: 0, progress: 0, paused: false, bytes: 0, totalBytes: 0 }
                : t
        );
        const active = tracks.filter((t) => t.status !== 'removed');
        const total = active.length;
        const done = active.filter((t) => t.status === 'done' || t.status === 'tagging').length;
        const bytes = active.reduce((s, t) => s + (t.bytes || 0), 0);
        const totalBytes = active.reduce((s, t) => s + (t.totalBytes || 0), 0);
        store.update({
            downloadTasks: tasks.map((t, i) =>
                i === idx ? { ...t, tracks, total, done, bytes, totalBytes } : t
            ),
        });
        store.persist();
    }

    async promoteTrack(taskId, trackId) {
        const task = store.get().downloadTasks.find((t) => t.id === taskId);
        if (!task || !task.tracks) return;
        const track = task.tracks.find((t) => t.id === trackId);
        if (!track) return;
        if (track.status === 'done' || track.status === 'error' || track.status === 'cancelled') return;

        this.cancelTrack(taskId, trackId);

        const song = {
            id: track.songId,
            title: track.title,
            artist: track.artist,
            album: track.album || '',
            pic: track.pic || '',
            _quality: track._quality,
            _withLyric: track._withLyric,
            _lyricOnly: track._lyricOnly,
        };

        this.removeTrackFromTask(taskId, trackId);

        const mode = store.get().settings.downloadMode;
        try {
            if (mode === 'stream') {
                await this.downloadToDisk(song, song._quality);
            } else {
                await this.downloadOne(song, song._quality);
            }
        } catch {}
    }

    async retryTrack(taskId, trackId) {
        const task = store.get().downloadTasks.find((t) => t.id === taskId);
        if (!task || !task.tracks) return;
        const track = task.tracks.find((t) => t.id === trackId);
        if (!track) return;

        const isBatch = task.type === 'batch';

        if (isBatch) {
            const retryableStatus = track.status === 'error'
                || track.status === 'cancelled'
                || track.status === 'skipped'
                || track.status === 'queued';
            if (!retryableStatus) return;

            const state = this.taskStates.get(taskId);
            if (state && task.status === 'active') {
                store.updateTaskTrack(taskId, trackId, {
                    status: 'queued',
                    bytes: 0,
                    totalBytes: 0,
                    progress: 0,
                    speed: 0,
                    eta: null,
                    error: null,
                    paused: false,
                    startedAt: null,
                    finishedAt: null,
                });
                const idx = task.tracks.findIndex((t) => t.id === trackId);
                if (idx >= 0) {
                    if (state.pendingIndices && !state.pendingIndices.includes(idx)) {
                        state.pendingIndices.unshift(idx);
                    }
                    if (state.priorityQueue && !state.priorityQueue.includes(trackId)) {
                        state.priorityQueue.unshift(trackId);
                    }
                }
                state.resumeRequested = true;
                return;
            }

            await this.retryTask(taskId);
            return;
        }

        if (track.status !== 'error' && track.status !== 'cancelled' && track.status !== 'skipped') return;

        const song = {
            id: track.songId,
            title: track.title,
            artist: track.artist,
            album: track.album || '',
            pic: track.pic || '',
            _quality: track._quality,
            _withLyric: track._withLyric,
            _lyricOnly: track._lyricOnly,
        };

        store.update({
            downloadTasks: store.get().downloadTasks.filter((t) => t.id !== taskId),
        });

        const mode = store.get().settings.downloadMode;
        if (mode === 'stream') {
            await this.downloadToDisk(song, track._quality);
        } else {
            await this.downloadOne(song, track._quality);
        }
    }

    async retryTask(taskId) {
        const task = store.get().downloadTasks.find((t) => t.id === taskId);
        if (!task || !task.tracks) return false;

        const retryable = task.tracks.filter((t) =>
            t.status !== 'done'
            && t.status !== 'tagging'
            && t.status !== 'moved'
            && t.status !== 'removed'
        );
        if (!retryable.length) return false;

        if (task.type === 'single') {
            const track = retryable[0];
            const song = {
                id: track.songId,
                title: track.title,
                artist: track.artist,
                album: track.album || '',
                pic: track.pic || '',
                _quality: track._quality,
                _withLyric: track._withLyric,
                _lyricOnly: track._lyricOnly,
            };
            store.update({
                downloadTasks: store.get().downloadTasks.filter((t) => t.id !== taskId),
            });
            const mode = store.get().settings.downloadMode;
            if (mode === 'stream') {
                await this.downloadToDisk(song, track._quality);
            } else {
                await this.downloadOne(song, track._quality);
            }
            return true;
        }

        if (task.mode === 'batch-zip') {
            await this.downloadAsZip(null, null, { resumeTaskId: taskId });
        } else {
            await this.downloadBatchToDisk(null, null, { resumeTaskId: taskId });
        }
        return true;
    }

    removeTask(taskId) {
        const tasks = store.get().downloadTasks;
        const next = tasks.filter((t) => t.id !== taskId);
        if (next.length === tasks.length) return;
        this.taskStates.delete(taskId);
        store.update({ downloadTasks: next });
        store.persist();
    }

    _maybeStartNextWaiting(taskId) {
        const waiting = store.get().downloadTasks.find(
            (t) => t.waitingForTaskId === taskId && t.status === 'waiting'
        );
        if (waiting) {
            this._startWaitingTask(waiting.id).catch(() => {});
        }
    }

    async _startWaitingTask(taskId) {
        const task = store.get().downloadTasks.find((t) => t.id === taskId);
        if (!task || task.status !== 'waiting') return;

        const songs = task.tracks
            .filter((t) => t.status !== 'done' && t.status !== 'removed')
            .map((t) => ({
                id: t.songId,
                title: t.title,
                artist: t.artist,
                album: t.album || '',
                pic: t.pic || '',
                _quality: t._quality,
                _withLyric: false,
                _lyricOnly: true,
                _lyricWithTranslation: !!t._lyricWithTranslation,
                _lyricDelay: Number(t._lyricDelay) || 0,
            }));

        if (!songs.length) {
            store.upsertDownloadTask(taskId, {
                status: 'done',
                phase: 'done',
                finishedAt: Date.now(),
            });
            return;
        }

        store.update({
            downloadTasks: store.get().downloadTasks.map((t) =>
                t.id === taskId ? { ...t, status: 'active', phase: 'downloading', waitingForTaskId: null } : t
            ),
        });

        const mode = store.get().settings.downloadMode;
        try {
            if (mode === 'stream') {
                await this.downloadBatchToDisk(songs, songs[0]._quality, { resumeTaskId: taskId });
            } else {
                await this.downloadAsZip(songs, songs[0]._quality, { resumeTaskId: taskId });
            }
        } catch {}
    }

    async prepareMv(song, quality) {
        const mvid = String(song.mv || song.id || '');
        if (!mvid || mvid === '0') throw new Error('当前歌曲没有 MV');
        const cfgMv = this.config.mv || {};
        const targetBr = song._mvQuality ?? song._quality ?? quality ?? cfgMv.download ?? 1080;
        const fallback = song._mvFallback || store.get().settings.mvFallback || 'max';
        const detail = await this.api.mvDetail(mvid);
        if (!detail) throw new Error('无法获取 MV 信息');
        const actualBr = pickMvBr(detail.brs, targetBr, fallback);
        const urlData = await this.api.mvUrl(mvid, actualBr);
        if (!urlData || !urlData.url) throw new Error('无法解析 MV 地址');
        const filename = sanitizeFilename(detail.name || song.title || 'MV') + '.mp4';
        return {
            url: urlData.url,
            filename,
            ext: '.mp4',
            title: detail.name || song.title || '',
            artist: detail.artistName || song.artist || '',
            album: '',
            cover: detail.cover || song.pic || '',
            kind: 'mv',
            br: actualBr,
        };
    }

    expandDownloadEntries(songs) {
        const out = [];
        for (const song of songs) {
            if (!song) continue;
            const skipAudio = !!song._skipAudio;
            const lyricOnly = !!song._lyricOnly;
            const wantLyric = !!song._withLyric || lyricOnly;
            const dlMv = !!song._mvDownload;
            const mvStr = song.mv == null ? '' : String(song.mv);
            const hasMv = mvStr !== '' && mvStr !== '0';

            if (!skipAudio && !lyricOnly) {
                out.push({
                    ...song,
                    _kind: 'audio',
                    _lyricOnly: false,
                    _withLyric: false,
                });
            }

            if (dlMv && hasMv) {
                out.push({
                    ...song,
                    _kind: 'mv',
                    _withLyric: false,
                    _lyricOnly: false,
                    _mvQuality: song._mvQuality,
                    _mvFallback: song._mvFallback,
                });
            }

            if (wantLyric) {
                out.push({
                    ...song,
                    _kind: 'lyric',
                    _withLyric: false,
                    _lyricOnly: true,
                });
            }
        }
        return out;
    }

    async prepare(song, quality) {
        if (song && song._kind === 'mv') return this.prepareMv(song, quality);
        const fallback = store.get().settings.downloadQuality
            ?? store.get().settings.quality
            ?? this.config.quality.default;
        const actualQuality = song?._quality ?? quality ?? fallback;
        const audioUrl = await this.api.resolveAudio(song, actualQuality);
        if (!audioUrl) throw new Error('无法解析音频地址');
        const ext = getExtension(actualQuality);
        const baseName = buildBaseName(song);
        const needWiki = song._metaYear === true || song._metaBpm === true || song._metaGenre === true;
        let year = '';
        let bpm = '';
        let genre = '';

        if (needWiki && song.id) {
            const wikiMap = store.get().wikiMap;
            const cached = (wikiMap instanceof Map) ? wikiMap.get(String(song.id)) : null;
            if (cached) {
                if (cached.publishDate) year = String(cached.publishDate).slice(0, 4);
                if (cached.bpm) bpm = String(cached.bpm);
                if (cached.genre) genre = String(cached.genre);
            }
            const needYear = song._metaYear === true;
            const needBpm = song._metaBpm === true;
            const needGenre = song._metaGenre === true;
            const missingYear = needYear && !year;
            const missingBpm = needBpm && !bpm;
            const missingGenre = needGenre && !genre;
            if (missingYear || missingBpm || missingGenre) {
                try {
                    const fetched = await fetchWikiFields(song.id);
                    if (missingYear && fetched.publishDate) year = String(fetched.publishDate).slice(0, 4);
                    if (missingBpm && fetched.bpm) bpm = String(fetched.bpm);
                    if (missingGenre && fetched.genre) genre = String(fetched.genre);
                } catch {}
            }
        }
        return {
            url: audioUrl,
            filename: baseName + ext,
            ext,
            title: song.title || '',
            artist: song.artist || '',
            album: song.album || '',
            year,
            bpm,
            genre,
            cover: song.pic || '',
            kind: 'audio',
            writeTitle: song._metaTitle !== false,
            writeArtist: song._metaArtist !== false,
            writeAlbum: song._metaAlbum !== false,
            writeYear: song._metaYear !== false,
            writeBpm: song._metaBpm !== false,
            writeGenre: song._metaGenre !== false,
            writeCover: song._metaCover !== false,
        };
    }

    async writeTags(blob, meta) {
        if (meta.kind === 'mv') return blob;
        const payload = {
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
            year: meta.year,
            bpm: meta.bpm,
            genre: meta.genre,
            coverUrl: meta.cover,
            writeTitle: meta.writeTitle !== false,
            writeArtist: meta.writeArtist !== false,
            writeAlbum: meta.writeAlbum !== false,
            writeYear: meta.writeYear !== false,
            writeBpm: meta.writeBpm !== false,
            writeGenre: meta.writeGenre !== false,
            writeCover: meta.writeCover !== false,
        };
        if (meta.ext === '.flac') {
            return await addFlacTags(blob, payload);
        }
        return await addMp3Tags(blob, payload);
    }

    async downloadLyric(song) {
        const text = await this.fetchLyricText(song);
        if (!text) throw new Error('暂无歌词');
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        triggerDownload(blob, buildBaseName(song) + '.lrc');
        return true;
    }

    async fetchLyricText(song) {
        const delay = Number(song && song._lyricDelay) || 0;
        const finalize = (text) => {
            if (!text) return null;
            if (!delay) return text;
            return shiftLrc(text, delay);
        };
        try {
            const raw = await this.api.resolveLyric(song);
            if (!raw) return null;
            if (typeof raw === 'string') {
                const t = raw.trim();
                return t ? finalize(t) : null;
            }
            const baseText = raw.lrc || raw.yrc || '';
            if (!baseText.trim()) return null;

            const tlyricText = typeof raw.tlyric === 'string' ? raw.tlyric : '';
            if (!song._lyricWithTranslation || !tlyricText.trim()) return finalize(baseText);

            const re = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\](.*)$/;
            const transMap = new Map();
            for (const line of tlyricText.split(/\r?\n/)) {
                const s = line.trim();
                if (!s) continue;
                const m = s.match(re);
                if (!m) continue;
                const min = parseInt(m[1], 10) || 0;
                const sec = parseInt(m[2], 10) || 0;
                const frac = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) / 1000 : 0;
                const text = m[4].trim();
                if (!text) continue;
                transMap.set(Math.round((min * 60 + sec + frac) * 100), text);
            }

            if (!transMap.size) return finalize(baseText);

            const out = [];
            for (const line of baseText.split(/\r?\n/)) {
                const s = line.trim();
                if (s.startsWith('{') && s.includes('"t"') && s.includes('"c"')) continue;
                const m = s.match(re);
                if (m) {
                    const min = parseInt(m[1], 10) || 0;
                    const sec = parseInt(m[2], 10) || 0;
                    const frac = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) / 1000 : 0;
                    const key = Math.round((min * 60 + sec + frac) * 100);
                    const trans = transMap.get(key);
                    const content = m[4].trim();
                    if (trans && content) {
                        const tsPrefix = '[' + m[1] + ':' + m[2] + (m[3] !== undefined ? '.' + m[3] : '') + ']';
                        out.push(tsPrefix + content + '(' + trans + ')');
                        continue;
                    }
                }
                out.push(line);
            }
            return finalize(out.join('\n'));
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
            paused: new Set(),
            pauseResolvers: new Map(),
            priorityQueue: [],
            mode: 'single',
        };
        this.taskStates.set(taskId, state);

        const track = {
            id: trackId,
            songId: song.id,
            title: song.title || '未知歌曲',
            artist: song.artist || '',
            album: song.album || '',
            pic: song.pic || '',
            _quality: song._quality ?? quality,
            _withLyric: withLyric,
            _lyricOnly: song._lyricOnly || false,
            status: 'resolving',
            bytes: 0,
            totalBytes: 0,
            progress: 0,
            speed: 0,
            eta: null,
            error: null,
            paused: false,
            startedAt: Date.now(),
            finishedAt: null,
        };

        store.upsertDownloadTask(taskId, {
            type: 'single',
            mode: 'single',
            kind: song._kind === 'mv'
                ? 'single-mv'
                : (song._lyricOnly || song._kind === 'lyric')
                    ? 'single-lyric'
                    : 'single',
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
        const checkPause = buildCheckPause(state, trackId, controller);

        try {
            if (song._lyricOnly) {
                updateTrack({ status: 'downloading' });
                store.upsertDownloadTask(taskId, { phase: 'downloading' });
                const lrc = await this.fetchLyricText(song);
                if (!lrc) throw new Error('暂无歌词');
                const filename = buildBaseName(song) + '.lrc';
                const blob = new Blob([lrc], { type: 'text/plain;charset=utf-8' });
                triggerDownload(blob, filename);
                this._recordHistory(song, { kind: 'lyric', filename, bytes: blob.size });
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

            if (meta.kind === 'mv') {
                updateTrack({ title: meta.title, artist: meta.artist, pic: meta.cover });
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
                checkPause,
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
                    this._recordHistory(song, {
                        kind: 'lyric',
                        filename: meta.filename.replace(/\.(mp3|flac)$/i, '.lrc'),
                        bytes: lrcBlob.size,
                    });
                }
            }

            this._recordHistory(song, {
                kind: meta.kind === 'mv' ? 'mv' : 'audio',
                quality: meta.kind === 'mv' ? meta.br : undefined,
                filename: meta.filename,
                bytes,
            });

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
            paused: new Set(),
            pauseResolvers: new Map(),
            priorityQueue: [],
            mode: 'single',
        };
        this.taskStates.set(taskId, state);

        const track = {
            id: trackId,
            songId: song.id,
            title: song.title || '未知歌曲',
            artist: song.artist || '',
            album: song.album || '',
            pic: song.pic || '',
            _quality: song._quality ?? quality,
            _withLyric: withLyric,
            _lyricOnly: song._lyricOnly || false,
            status: 'resolving',
            bytes: 0,
            totalBytes: 0,
            progress: 0,
            speed: 0,
            eta: null,
            error: null,
            paused: false,
            startedAt: Date.now(),
            finishedAt: null,
        };

        store.upsertDownloadTask(taskId, {
            type: 'single',
            mode: 'single',
            kind: song._kind === 'mv'
                ? 'single-mv'
                : (song._lyricOnly || song._kind === 'lyric')
                    ? 'single-lyric'
                    : 'single',
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
        const checkPause = buildCheckPause(state, trackId, controller);

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
                this._recordHistory(song, { kind: 'lyric', filename, dirName: dirHandle.name, bytes: size });
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

            if (meta.kind === 'mv') {
                updateTrack({ title: meta.title, artist: meta.artist, pic: meta.cover });
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
                checkPause,
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
                    this._recordHistory(song, {
                        kind: 'lyric',
                        filename: uniqueLrc,
                        dirName: dirHandle.name,
                        bytes: new Blob([lrc]).size,
                    });
                }
            }

            this._recordHistory(song, {
                kind: meta.kind === 'mv' ? 'mv' : 'audio',
                quality: meta.kind === 'mv' ? meta.br : undefined,
                filename,
                dirName: dirHandle.name,
                bytes,
            });

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

    async downloadBatchToDisk(songs, quality, options = {}) {
        const dirHandle = await getSavedDirHandle();
        if (!dirHandle) throw new Error('未选择本地目录');
        const ok = await ensureDirPermission(dirHandle, true);
        if (!ok) throw new Error('没有目录写入权限');

        const { retry, retryDelay } = this.config.download;
        const concurrency = store.get().settings.concurrency ?? this.config.download.concurrency;
        const tagConcurrency = Math.max(2, Math.min(4, concurrency));

        if (!options.resumeTaskId && Array.isArray(songs)) {
            songs = this.expandDownloadEntries(songs);
        }

        let lyricSongs = null;
        if (!options.resumeTaskId && Array.isArray(songs)) {
            const lyrics = songs.filter((s) => s && s._kind === 'lyric');
            if (lyrics.length) {
                lyricSongs = lyrics;
                songs = songs.filter((s) => s._kind !== 'lyric');
            }
        }

        let onlyLyricMode = false;
        if (!options.resumeTaskId && !songs.length && lyricSongs && lyricSongs.length) {
            songs = lyricSongs;
            lyricSongs = null;
            onlyLyricMode = true;
        }

        let taskId;
        let tracks;

        if (options.resumeTaskId) {
            const existing = store.get().downloadTasks.find((t) => t.id === options.resumeTaskId);
            if (!existing || !existing.tracks) throw new Error('任务不存在');
            taskId = existing.id;

            tracks = existing.tracks.map((t) => {
                if (
                    t.status !== 'done'
                    && t.status !== 'tagging'
                    && t.status !== 'moved'
                    && t.status !== 'removed'
                ) {
                    return {
                        ...t,
                        status: 'queued',
                        bytes: 0,
                        totalBytes: 0,
                        progress: 0,
                        speed: 0,
                        eta: null,
                        error: null,
                        paused: false,
                        startedAt: null,
                        finishedAt: null,
                    };
                }
                return t;
            });

            songs = tracks.map((t) => ({
                id: t.songId,
                title: t.title,
                artist: t.artist,
                album: t.album || '',
                pic: t.pic || '',
                _quality: t._quality,
                _kind: t._kind || (t._lyricOnly ? 'lyric' : 'audio'),
                _withLyric: t._withLyric,
                _lyricOnly: t._lyricOnly,
                _lyricWithTranslation: !!t._lyricWithTranslation,
                _lyricDelay: Number(t._lyricDelay) || 0,
                _metaTitle: t._metaTitle,
                _metaArtist: t._metaArtist,
                _metaAlbum: t._metaAlbum,
                _metaYear: t._metaYear,
                _metaBpm: t._metaBpm,
                _metaGenre: t._metaGenre,
                _metaCover: t._metaCover,
                _mvDownload: t._mvDownload,
                _mvQuality: t._mvQuality,
                _mvFallback: t._mvFallback,
                _skipAudio: t._skipAudio,
            }));

            quality = tracks[0]?._quality ?? quality;

            const total = tracks.length;
            const done = tracks.filter((t) => t.status === 'done' || t.status === 'tagging').length;
            const bytes = tracks.reduce((s, t) => s + (t.bytes || 0), 0);
            const totalBytes = tracks.reduce((s, t) => s + (t.totalBytes || 0), 0);

            store.update({
                downloadTasks: store.get().downloadTasks.map((t) =>
                    t.id === taskId ? {
                        ...t,
                        status: 'active',
                        phase: 'downloading',
                        tracks,
                        done,
                        bytes,
                        totalBytes,
                        errors: [],
                        finishedAt: null,
                    } : t
                ),
            });
        } else {
            if (!songs.length) throw new Error('下载列表为空');
            taskId = newTaskId();
            const total = songs.length;
            tracks = songs.map((song, index) => ({
                id: `trk-${taskId}-${index}`,
                songId: song.id,
                title: song.title || '未知歌曲',
                artist: song.artist || '',
                album: song.album || '',
                pic: song.pic || '',
                _quality: song._quality ?? quality,
                _kind: song._kind || 'audio',
                _withLyric: !!song._withLyric,
                _lyricOnly: !!song._lyricOnly,
                _lyricWithTranslation: !!song._lyricWithTranslation,
                _lyricDelay: Number(song._lyricDelay) || 0,
                _metaTitle: song._metaTitle,
                _metaArtist: song._metaArtist,
                _metaAlbum: song._metaAlbum,
                _metaYear: song._metaYear,
                _metaBpm: song._metaBpm,
                _metaGenre: song._metaGenre,
                _metaCover: song._metaCover,
                _mvDownload: !!song._mvDownload,
                _mvQuality: song._mvQuality,
                _mvFallback: song._mvFallback,
                _skipAudio: !!song._skipAudio,
                status: 'queued',
                bytes: 0,
                totalBytes: 0,
                progress: 0,
                speed: 0,
                eta: null,
                error: null,
                paused: false,
                startedAt: null,
                finishedAt: null,
            }));

            const uniqueSongIds = new Set(songs.map((s) => String(s.id || s.songId || '')));
            const isSingleSongBatch = uniqueSongIds.size === 1 && !onlyLyricMode;
            const batchLabel = isSingleSongBatch
                ? `${songs[0].title || '未知歌曲'} - ${songs[0].artist || '未知艺人'}`
                : `批量下载 ${total} 首`;
            store.upsertDownloadTask(taskId, {
                type: 'batch',
                kind: onlyLyricMode ? 'batch-lyric' : 'batch-audio',
                mode: 'batch-disk',
                label: onlyLyricMode ? `下载歌词 ${total} 首` : batchLabel,
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
        }

        if (lyricSongs && lyricSongs.length) {
            const lyricTaskId = newTaskId();
            const lyricTracks = lyricSongs.map((song, index) => ({
                id: `trk-${lyricTaskId}-${index}`,
                songId: song.id,
                title: song.title || '未知歌曲',
                artist: song.artist || '',
                album: song.album || '',
                pic: song.pic || '',
                _quality: song._quality ?? quality,
                _kind: 'lyric',
                _withLyric: false,
                _lyricOnly: true,
                _lyricWithTranslation: !!song._lyricWithTranslation,
                _lyricDelay: Number(song._lyricDelay) || 0,
                status: 'queued',
                bytes: 0,
                totalBytes: 0,
                progress: 0,
                speed: 0,
                eta: null,
                error: null,
                paused: false,
                startedAt: null,
                finishedAt: null,
            }));
            const lyricUniqueIds = new Set(lyricSongs.map((s) => String(s.id || s.songId || '')));
            const lyricSingle = lyricUniqueIds.size === 1;
            const lyricLabel = lyricSingle
                ? `歌词：${lyricSongs[0].title || '未知歌曲'} - ${lyricSongs[0].artist || '未知艺人'}`
                : `下载歌词 ${lyricSongs.length} 首`;
            store.upsertDownloadTask(lyricTaskId, {
                type: 'batch',
                kind: 'batch-lyric',
                mode: 'batch-disk',
                label: lyricLabel,
                status: 'waiting',
                waitingForTaskId: taskId,
                phase: 'waiting',
                done: 0,
                total: lyricTracks.length,
                bytes: 0,
                totalBytes: 0,
                packagingProgress: null,
                errors: [],
                startedAt: null,
                finishedAt: null,
                tracks: lyricTracks,
            });
        }

        const state = {
            abortController: new AbortController(),
            trackControllers: new Map(),
            writers: new Map(),
            packageRequested: false,
            paused: new Set(),
            pauseResolvers: new Map(),
            priorityQueue: [],
            mode: 'batch-disk',
            autoRetriedTracks: new Set(),
        };
        this.taskStates.set(taskId, state);

        const updateTrack = (trackId, patch) => store.updateTaskTrack(taskId, trackId, patch);
        const usedNames = new Set();
        const dirCache = new Map();
        const lyricDirCache = new Map();

        const tagSem = new Semaphore(tagConcurrency);
        const tagPromises = [];

        const worker = async (song, index) => {
            const trackId = tracks[index].id;

            if (state.abortController.signal.aborted) throw new Error('已取消');

            const cur = store.get().downloadTasks.find((t) => t.id === taskId);
            if (!cur) throw new Error('任务已移除');
            const track = cur.tracks.find((t) => t.id === trackId);
            if (!track || track.status !== 'queued') {
                return { skipped: true };
            }

            const controller = new AbortController();
            state.trackControllers.set(trackId, controller);
            const checkPause = buildCheckPause(state, trackId, controller);

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
                    this._recordHistory(song, {
                        kind: 'lyric',
                        filename,
                        dirName: dirHandle.name,
                        bytes: size,
                    });
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

                if (meta.kind === 'mv') {
                    updateTrack(trackId, { title: meta.title, artist: meta.artist, pic: meta.cover });
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
                    checkPause,
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

                const tagPromise = (async () => {
                    await tagSem.acquire();
                    try {
                        if (state.abortController.signal.aborted) {
                            throw new Error('已取消');
                        }

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

                        this._recordHistory(song, {
                            kind: meta.kind === 'mv' ? 'mv' : 'audio',
                            quality: meta.kind === 'mv' ? meta.br : undefined,
                            filename,
                            dirName: dirHandle.name,
                            bytes,
                        });

                        updateTrack(trackId, {
                            status: 'done',
                            bytes,
                            totalBytes: contentLength || bytes,
                            progress: 1,
                            speed: 0,
                            eta: 0,
                            finishedAt: Date.now(),
                        });

                        return { ok: true, filename };
                    } catch (err) {
                        const cancelled = isCancelledError(err) || state.abortController.signal.aborted;
                        updateTrack(trackId, {
                            status: cancelled ? 'cancelled' : 'error',
                            error: cancelled ? null : err.message,
                            speed: 0,
                            eta: 0,
                            finishedAt: Date.now(),
                        });
                        return { ok: false, error: err, song };
                    } finally {
                        tagSem.release();
                    }
                })();

                tagPromises.push(tagPromise);
                return { ok: true };
            } catch (err) {
                const cancelled = controller.signal.aborted || state.abortController.signal.aborted || isCancelledError(err);
                if (!cancelled && !state.autoRetriedTracks.has(trackId)) {
                    state.autoRetriedTracks.add(trackId);
                    store.updateTaskTrack(taskId, trackId, {
                        status: 'queued',
                        bytes: 0,
                        totalBytes: 0,
                        progress: 0,
                        speed: 0,
                        eta: null,
                        error: null,
                        paused: false,
                        startedAt: null,
                        finishedAt: null,
                    });
                    if (state.pendingIndices && !state.pendingIndices.includes(index)) {
                        state.pendingIndices.unshift(index);
                    }
                    return;
                }
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

        const pendingIndices = [];
        state.pendingIndices = pendingIndices;

        const takeNext = () => {
            while (state.priorityQueue.length) {
                const id = state.priorityQueue.shift();
                const idx = tracks.findIndex((t) => t.id === id);
                if (idx === -1) continue;
                const pos = pendingIndices.indexOf(idx);
                if (pos >= 0) {
                    pendingIndices.splice(pos, 1);
                    return idx;
                }
            }
            return pendingIndices.length ? pendingIndices.shift() : -1;
        };

        try {
            while (true) {
                if (state.abortController.signal.aborted) break;

                const live = store.get().downloadTasks.find((t) => t.id === taskId);
                if (!live) break;

                pendingIndices.length = 0;
                tracks.forEach((t, i) => {
                    const cur = live.tracks.find((x) => x.id === t.id);
                    if (cur && cur.status === 'queued') pendingIndices.push(i);
                });

                if (!pendingIndices.length) {
                    if (state.resumeRequested) {
                        state.resumeRequested = false;
                        continue;
                    }
                    await new Promise((r) => setTimeout(r, 30));
                    const live2 = store.get().downloadTasks.find((t) => t.id === taskId);
                    if (!live2) break;
                    pendingIndices.length = 0;
                    tracks.forEach((t, i) => {
                        const cur = live2.tracks.find((x) => x.id === t.id);
                        if (cur && cur.status === 'queued') pendingIndices.push(i);
                    });
                    if (!pendingIndices.length) break;
                    continue;
                }

                const workerCount = Math.max(1, Math.min(concurrency, pendingIndices.length));
                const workers = Array.from({ length: workerCount }, async () => {
                    while (true) {
                        if (state.abortController.signal.aborted) return;
                        const idx = takeNext();
                        if (idx === -1) return;
                        try {
                            await worker(songs[idx], idx);
                        } catch {}
                    }
                });
                await Promise.all(workers);
            }

            await Promise.all(tagPromises);

            const cur = store.get().downloadTasks.find((t) => t.id === taskId);
            if (cur) {
                for (const track of cur.tracks) {
                    if (track.status === 'queued' || track.status === 'resolving') {
                        updateTrack(track.id, { status: 'skipped', finishedAt: Date.now() });
                    }
                }
            }

            const finalTask = store.get().downloadTasks.find((t) => t.id === taskId);
            const allErrors = (finalTask?.tracks || [])
                .filter((t) => t.status === 'error')
                .map((t) => ({
                    song: { id: t.songId, title: t.title, artist: t.artist },
                    error: t.error || '未知错误',
                }));
            const successCount = (finalTask?.tracks || []).filter(
                (t) => t.status === 'done' || t.status === 'tagging'
            ).length;

            store.upsertDownloadTask(taskId, {
                status: 'done',
                phase: 'done',
                errors: allErrors,
                finishedAt: Date.now(),
            });

            this.taskStates.delete(taskId);
            this._maybeStartNextWaiting(taskId);

            return {
                taskId,
                successful: successCount,
                failed: allErrors.length,
                errors: allErrors,
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
            this._maybeStartNextWaiting(taskId);
            throw err;
        }
    }

    async downloadAsZip(songs, quality, options = {}) {
        const { retry, retryDelay } = this.config.download;
        const concurrency = store.get().settings.concurrency ?? this.config.download.concurrency;
        const tagConcurrency = Math.max(2, Math.min(4, concurrency));

        if (!options.resumeTaskId && Array.isArray(songs)) {
            songs = this.expandDownloadEntries(songs);
        }

        let taskId;
        let tracks;

        if (options.resumeTaskId) {
            const existing = store.get().downloadTasks.find((t) => t.id === options.resumeTaskId);
            if (!existing || !existing.tracks) throw new Error('任务不存在');
            taskId = existing.id;

            tracks = existing.tracks.map((t) => {
                if (
                    t.status !== 'done'
                    && t.status !== 'tagging'
                    && t.status !== 'moved'
                    && t.status !== 'removed'
                ) {
                    return {
                        ...t,
                        status: 'queued',
                        bytes: 0,
                        totalBytes: 0,
                        progress: 0,
                        speed: 0,
                        eta: null,
                        error: null,
                        paused: false,
                        startedAt: null,
                        finishedAt: null,
                    };
                }
                return t;
            });

            songs = tracks.map((t) => ({
                id: t.songId,
                title: t.title,
                artist: t.artist,
                album: t.album || '',
                pic: t.pic || '',
                _quality: t._quality,
                _kind: t._kind || (t._lyricOnly ? 'lyric' : 'audio'),
                _withLyric: t._withLyric,
                _lyricOnly: t._lyricOnly,
                _lyricWithTranslation: !!t._lyricWithTranslation,
                _lyricDelay: Number(t._lyricDelay) || 0,
                _metaTitle: t._metaTitle,
                _metaArtist: t._metaArtist,
                _metaAlbum: t._metaAlbum,
                _metaYear: t._metaYear,
                _metaBpm: t._metaBpm,
                _metaGenre: t._metaGenre,
                _metaCover: t._metaCover,
                _mvDownload: t._mvDownload,
                _mvQuality: t._mvQuality,
                _mvFallback: t._mvFallback,
                _skipAudio: t._skipAudio,
            }));

            quality = tracks[0]?._quality ?? quality;

            const total = tracks.length;
            const done = tracks.filter((t) => t.status === 'done' || t.status === 'tagging').length;
            const bytes = tracks.reduce((s, t) => s + (t.bytes || 0), 0);
            const totalBytes = tracks.reduce((s, t) => s + (t.totalBytes || 0), 0);

            store.update({
                downloadTasks: store.get().downloadTasks.map((t) =>
                    t.id === taskId ? {
                        ...t,
                        status: 'active',
                        phase: 'downloading',
                        tracks,
                        done,
                        bytes,
                        totalBytes,
                        packagingProgress: null,
                        errors: [],
                        finishedAt: null,
                    } : t
                ),
            });
        } else {
            if (!songs.length) throw new Error('下载列表为空');
            taskId = newTaskId();
            const total = songs.length;
            tracks = songs.map((song, index) => ({
                id: `trk-${taskId}-${index}`,
                songId: song.id,
                title: song.title || '未知歌曲',
                artist: song.artist || '',
                album: song.album || '',
                pic: song.pic || '',
                _quality: song._quality ?? quality,
                _kind: song._kind || 'audio',
                _withLyric: !!song._withLyric,
                _lyricOnly: !!song._lyricOnly,
                _lyricWithTranslation: !!song._lyricWithTranslation,
                _lyricDelay: Number(song._lyricDelay) || 0,
                _metaTitle: song._metaTitle,
                _metaArtist: song._metaArtist,
                _metaAlbum: song._metaAlbum,
                _metaYear: song._metaYear,
                _metaBpm: song._metaBpm,
                _metaGenre: song._metaGenre,
                _metaCover: song._metaCover,
                _mvDownload: !!song._mvDownload,
                _mvQuality: song._mvQuality,
                _mvFallback: song._mvFallback,
                _skipAudio: !!song._skipAudio,
                status: 'queued',
                bytes: 0,
                totalBytes: 0,
                progress: 0,
                speed: 0,
                eta: null,
                error: null,
                paused: false,
                startedAt: null,
                finishedAt: null,
            }));

            const uniqueSongIds = new Set(songs.map((s) => String(s.id || s.songId || '')));
            const isSingleSongBatch = uniqueSongIds.size === 1;
            const batchLabel = isSingleSongBatch
                ? `${songs[0].title || '未知歌曲'} - ${songs[0].artist || '未知艺人'}`
                : `批量下载 ${total} 首`;
            store.upsertDownloadTask(taskId, {
                type: 'batch',
                mode: 'batch-zip',
                label: batchLabel,
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
        }

        const state = {
            abortController: new AbortController(),
            trackControllers: new Map(),
            packageRequested: false,
            paused: new Set(),
            pauseResolvers: new Map(),
            priorityQueue: [],
            mode: 'batch-zip',
            autoRetriedTracks: new Set(),
        };
        this.taskStates.set(taskId, state);

        const updateTrack = (trackId, patch) => store.updateTaskTrack(taskId, trackId, patch);

        const artifactByTrackId = new Map();
        const tagSem = new Semaphore(tagConcurrency);
        const tagPromises = [];

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
            if (!track || track.status !== 'queued') {
                return { skipped: true };
            }

            const controller = new AbortController();
            state.trackControllers.set(trackId, controller);
            const checkPause = buildCheckPause(state, trackId, controller);

            try {
                updateTrack(trackId, { status: 'resolving', startedAt: Date.now() });

                if (song._lyricOnly) {
                    updateTrack(trackId, { status: 'downloading' });
                    const lrc = await this.fetchLyricText(song);
                    if (!lrc) throw new Error('暂无歌词');
                    const filename = buildBaseName(song) + '.lrc';
                    const size = new Blob([lrc]).size;
                    artifactByTrackId.set(trackId, { kind: 'lyric', lyric: lrc, filename });
                    this._recordHistory(song, { kind: 'lyric', filename, bytes: size });
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

                if (meta.kind === 'mv') {
                    updateTrack(trackId, { title: meta.title, artist: meta.artist, pic: meta.cover });
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
                    checkPause,
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

                const tagPromise = (async () => {
                    await tagSem.acquire();
                    try {
                        if (state.abortController.signal.aborted) {
                            throw new Error('已取消');
                        }
                        const finalBlob = await this.writeTags(blob, meta);
                        let lyric = null;
                        if (song._withLyric) {
                            lyric = await this.fetchLyricText(song);
                        }
                        artifactByTrackId.set(trackId, { kind: 'audio', blob: finalBlob, lyric, filename: meta.filename });
                        if (lyric) {
                            this._recordHistory(song, {
                                kind: 'lyric',
                                filename: meta.filename.replace(/\.(mp3|flac)$/i, '.lrc'),
                                bytes: new Blob([lyric]).size,
                            });
                        }
                        this._recordHistory(song, {
                            kind: meta.kind === 'mv' ? 'mv' : 'audio',
                            quality: meta.kind === 'mv' ? meta.br : undefined,
                            filename: meta.filename,
                            bytes,
                        });
                        updateTrack(trackId, {
                            status: 'done',
                            bytes,
                            totalBytes: contentLength || bytes,
                            progress: 1,
                            speed: 0,
                            eta: 0,
                            finishedAt: Date.now(),
                        });
                        return { ok: true, meta, blob: finalBlob, lyric };
                    } catch (err) {
                        const cancelled = isCancelledError(err) || state.abortController.signal.aborted;
                        updateTrack(trackId, {
                            status: cancelled ? 'cancelled' : 'error',
                            error: cancelled ? null : err.message,
                            speed: 0,
                            eta: 0,
                            finishedAt: Date.now(),
                        });
                        return { ok: false, error: err, song };
                    } finally {
                        tagSem.release();
                    }
                })();

                tagPromises.push(tagPromise);
                return { ok: true };
            } catch (err) {
                const cancelled = controller.signal.aborted || state.abortController.signal.aborted || isCancelledError(err);
                if (!cancelled && !state.autoRetriedTracks.has(trackId)) {
                    state.autoRetriedTracks.add(trackId);
                    store.updateTaskTrack(taskId, trackId, {
                        status: 'queued',
                        bytes: 0,
                        totalBytes: 0,
                        progress: 0,
                        speed: 0,
                        eta: null,
                        error: null,
                        paused: false,
                        startedAt: null,
                        finishedAt: null,
                    });
                    if (state.pendingIndices && !state.pendingIndices.includes(index)) {
                        state.pendingIndices.unshift(index);
                    }
                    return;
                }
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

        const pendingIndices = [];
        state.pendingIndices = pendingIndices;

        const takeNext = () => {
            while (state.priorityQueue.length) {
                const id = state.priorityQueue.shift();
                const idx = tracks.findIndex((t) => t.id === id);
                if (idx === -1) continue;
                const pos = pendingIndices.indexOf(idx);
                if (pos >= 0) {
                    pendingIndices.splice(pos, 1);
                    return idx;
                }
            }
            return pendingIndices.length ? pendingIndices.shift() : -1;
        };

        try {
            while (true) {
                if (state.abortController.signal.aborted) break;

                const live = store.get().downloadTasks.find((t) => t.id === taskId);
                if (!live) break;

                pendingIndices.length = 0;
                tracks.forEach((t, i) => {
                    const cur = live.tracks.find((x) => x.id === t.id);
                    if (cur && cur.status === 'queued') pendingIndices.push(i);
                });

                if (!pendingIndices.length) {
                    if (state.resumeRequested) {
                        state.resumeRequested = false;
                        continue;
                    }
                    await new Promise((r) => setTimeout(r, 30));
                    const live2 = store.get().downloadTasks.find((t) => t.id === taskId);
                    if (!live2) break;
                    pendingIndices.length = 0;
                    tracks.forEach((t, i) => {
                        const cur = live2.tracks.find((x) => x.id === t.id);
                        if (cur && cur.status === 'queued') pendingIndices.push(i);
                    });
                    if (!pendingIndices.length) break;
                    continue;
                }

                const workerCount = Math.max(1, Math.min(concurrency, pendingIndices.length));
                const workers = Array.from({ length: workerCount }, async () => {
                    while (true) {
                        if (state.abortController.signal.aborted) return;
                        const idx = takeNext();
                        if (idx === -1) return;
                        try {
                            await worker(songs[idx], idx);
                        } catch {}
                    }
                });
                await Promise.all(workers);
            }

            await Promise.all(tagPromises);

            const cur = store.get().downloadTasks.find((t) => t.id === taskId);
            if (cur) {
                for (const track of cur.tracks) {
                    if (track.status === 'queued' || track.status === 'resolving') {
                        updateTrack(track.id, { status: 'skipped', finishedAt: Date.now() });
                    }
                }
            }

            if (state.abortController.signal.aborted) {
                this.taskStates.delete(taskId);
                store.upsertDownloadTask(taskId, {
                    status: 'cancelled',
                    phase: 'error',
                    errors: [],
                    finishedAt: Date.now(),
                });
                throw new Error('已取消');
            }

            const finalTask = store.get().downloadTasks.find((t) => t.id === taskId);
            const successful = [];
            const errors = [];

            for (const track of (finalTask?.tracks || [])) {
                if (track.status === 'done' || track.status === 'tagging') {
                    const artifact = artifactByTrackId.get(track.id);
                    if (!artifact) continue;
                    successful.push({ track, ...artifact });
                } else if (track.status === 'error') {
                    errors.push({
                        song: { id: track.songId, title: track.title, artist: track.artist },
                        error: track.error || '未知错误',
                    });
                }
            }

            if (!successful.length) {
                this.taskStates.delete(taskId);
                store.upsertDownloadTask(taskId, {
                    status: 'cancelled',
                    phase: 'error',
                    errors,
                    finishedAt: Date.now(),
                });
                return { taskId, successful: 0, failed: errors.length, errors };
            }

            store.upsertDownloadTask(taskId, {
                phase: 'packaging',
                packagingProgress: 0,
                errors,
            });

            const zip = new window.JSZip();
            const categoryMode = store.get().settings.batchCategory || 'none';
            const lyricMode = store.get().settings.lyricSaveMode || 'same';
            for (const { track, kind, blob, lyric, filename } of successful) {
                let folder = '';
                if (categoryMode === 'artist') {
                    const a = getMainArtist(track.artist);
                    if (a) folder = sanitizeFilename(a) + '/';
                } else if (categoryMode === 'album') {
                    const al = track.album;
                    if (al) folder = sanitizeFilename(al) + '/';
                }
                if (kind === 'lyric') {
                    zip.file(folder + filename, lyric);
                    continue;
                }
                if (blob) {
                    zip.file(folder + filename, blob);
                }
                if (lyric) {
                    const lrcName = filename.replace(/\.(mp3|flac)$/i, '.lrc');
                    const lrcFolder = lyricMode === 'separate' ? '歌词/' : folder;
                    zip.file(lrcFolder + lrcName, lyric);
                }
            }

            let lastPackagingTick = 0;
            const zipBlob = await zip.generateAsync(
                { type: 'blob' },
                (metadata) => {
                    const now = Date.now();
                    if (now - lastPackagingTick < 200 && metadata.percent < 100) return;
                    lastPackagingTick = now;
                    store.upsertDownloadTask(taskId, {
                        phase: 'packaging',
                        packagingProgress: metadata.percent / 100,
                    }, { persist: false });
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