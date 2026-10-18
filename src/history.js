
const DB_NAME = 'mscd-history';
const DB_VERSION = 1;
const BATCH_STORE = 'batches';
const TRACK_STORE = 'tracks';

let dbPromise = null;

function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(BATCH_STORE)) {
                const s = db.createObjectStore(BATCH_STORE, { keyPath: 'batchId' });
                s.createIndex('startedAt', 'startedAt');
                s.createIndex('taskId', 'taskId');
            }
            if (!db.objectStoreNames.contains(TRACK_STORE)) {
                const s = db.createObjectStore(TRACK_STORE, { keyPath: 'historyId' });
                s.createIndex('songId', 'songId');
                s.createIndex('batchId', 'batchId');
                s.createIndex('finishedAt', 'finishedAt');
                s.createIndex('dirName', 'dirName');
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

function uid() {
    return 'h-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

export async function recordDownload(entry) {
    if (!entry || !entry.songId) return;
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const t = db.transaction(TRACK_STORE, 'readwrite');
        const s = t.objectStore(TRACK_STORE);
        const now = Date.now();
        s.put({
            historyId: uid(),
            songId: String(entry.songId || ''),
            mvId: String(entry.mvId || ''),
            kind: entry.kind || 'audio',
            quality: Number(entry.quality) || 0,
            filename: String(entry.filename || ''),
            dirName: String(entry.dirName || ''),
            source: entry.source || 'blob',
            status: entry.status || 'done',
            bytes: Number(entry.bytes) || 0,
            title: String(entry.title || ''),
            artist: String(entry.artist || ''),
            album: String(entry.album || ''),
            pic: String(entry.pic || ''),
            duration: Number(entry.duration) || 0,
            batchId: String(entry.batchId || ''),
            finishedAt: entry.finishedAt || now,
        });
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
    });
}

export async function deleteTrack(historyId) {
    if (!historyId) return;
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const t = db.transaction(TRACK_STORE, 'readwrite');
        t.objectStore(TRACK_STORE).delete(historyId);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
    });
}

export async function clearHistory() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const t = db.transaction([BATCH_STORE, TRACK_STORE], 'readwrite');
        t.objectStore(BATCH_STORE).clear();
        t.objectStore(TRACK_STORE).clear();
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
    });
}

export async function getHistoryBySongIds(ids) {
    const uniqueIds = Array.from(new Set((ids || []).map(String).filter(Boolean)));
    if (!uniqueIds.length) return new Map();
    const db = await openDb();
    return new Promise((resolve) => {
        const t = db.transaction(TRACK_STORE, 'readonly');
        const idx = t.objectStore(TRACK_STORE).index('songId');
        const result = new Map();
        let done = 0;
        const total = uniqueIds.length;
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        for (const id of uniqueIds) {
            const req = idx.getAll(id);
            req.onsuccess = () => {
                const list = req.result || [];
                if (list.length) result.set(id, list);
                done++;
                if (done === total) finish();
            };
            req.onerror = () => {
                done++;
                if (done === total) finish();
            };
        }
    });
}

export async function getTracksBySongId(songId) {
    if (!songId) return [];
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const t = db.transaction(TRACK_STORE, 'readonly');
        const idx = t.objectStore(TRACK_STORE).index('songId');
        const req = idx.getAll(String(songId));
        req.onsuccess = () => {
            const list = (req.result || []).sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
            resolve(list);
        };
        req.onerror = () => reject(req.error);
    });
}

export async function getAllTracks() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const t = db.transaction(TRACK_STORE, 'readonly');
        const req = t.objectStore(TRACK_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

export function buildHistoryIndex(rawTracks) {
    const index = new Map();
    for (const tr of rawTracks || []) {
        if (!tr || !tr.songId) continue;
        const id = String(tr.songId);
        let entry = index.get(id);
        if (!entry) {
            entry = {
                audio: false,
                lyric: false,
                mv: false,
                count: 0,
                lastTime: 0,
                lastPath: '',
                paths: new Set(),
                qualities: new Set(),
                byKind: {
                    audio: { count: 0, lastTime: 0, lastPath: '', paths: new Set(), qualities: new Set() },
                    lyric: { count: 0, lastTime: 0, lastPath: '', paths: new Set(), qualities: new Set() },
                    mv: { count: 0, lastTime: 0, lastPath: '', paths: new Set(), qualities: new Set() },
                },
            };
            index.set(id, entry);
        }
        const kind = tr.kind || 'audio';
        const bucket = entry.byKind[kind] || entry.byKind.audio;
        entry[kind] = true;
        entry.count += 1;
        bucket.count += 1;
        const t = tr.finishedAt || 0;
        if (t > entry.lastTime) {
            entry.lastTime = t;
            entry.lastPath = tr.dirName ? (tr.dirName + '/' + (tr.filename || '')) : (tr.filename || '');
        }
        if (t > bucket.lastTime) {
            bucket.lastTime = t;
            bucket.lastPath = tr.dirName ? (tr.dirName + '/' + (tr.filename || '')) : (tr.filename || '');
        }
        if (tr.dirName) {
            entry.paths.add(tr.dirName);
            bucket.paths.add(tr.dirName);
        }
        if (tr.quality) {
            entry.qualities.add(Number(tr.quality));
            bucket.qualities.add(Number(tr.quality));
        }
    }
    return index;
}

export function collectHistoryPaths(index) {
    const set = new Set();
    for (const e of index.values()) {
        for (const p of e.paths) set.add(p);
    }
    return Array.from(set).sort();
}

export function formatHistoryTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
