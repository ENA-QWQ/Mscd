const DB_NAME = 'mscd-wiki';
const DB_VERSION = 1;
const STORE_NAME = 'songWiki';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const FAILED_TTL = 60 * 60 * 1000;

const DEFAULT_WIKI_API = 'https://zm.wwoyun.cn/song/wiki/summary';
const DEFAULT_DETAIL_API = 'https://zm.wwoyun.cn/song/detail';

let dbPromise = null;

function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

function isFresh(entry) {
    if (!entry) return false;
    const age = Date.now() - (entry.fetchedAt || 0);
    if (entry.failed) return age < FAILED_TTL;
    return age < CACHE_TTL;
}

export async function getCachedWiki(ids) {
    const uniqueIds = Array.from(new Set((ids || []).map(String).filter(Boolean)));
    if (!uniqueIds.length) return new Map();
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const result = new Map();
        for (const id of uniqueIds) {
            const req = store.get(id);
            req.onsuccess = () => {
                const entry = req.result;
                if (entry && !entry.failed && isFresh(entry)) {
                    result.set(id, entry.data);
                }
            };
        }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
    });
}

export async function setWikiBatch(entries) {
    if (!entries || !entries.length) return;
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const now = Date.now();
        for (const e of entries) {
            if (!e || !e.id) continue;
            store.put({
                data: e.data || null,
                failed: !e.data,
                fetchedAt: now,
            }, String(e.id));
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function getAllWiki() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const result = new Map();
        const req = store.openCursor();
        req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) {
                const entry = cursor.value;
                if (entry && !entry.failed && isFresh(entry)) {
                    result.set(String(cursor.key), entry.data);
                }
                cursor.continue();
            }
        };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
    });
}

export async function clearWikiCache() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function dropWikiDb() {
    if (dbPromise) {
        try {
            const db = await dbPromise;
            db.close();
        } catch {}
        dbPromise = null;
    }
    return new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('数据库被占用，请刷新页面后重试'));
    });
}

function tsToDateStr(ts) {
    if (!ts) return '';
    const n = Number(ts);
    if (!isFinite(n) || n <= 0) return '';
    const d = new Date(n);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function fetchPublishDates(ids, apiBase) {
    const BATCH_SIZE = 50;
    const result = new Map();
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = ids.slice(i, i + BATCH_SIZE);
        const url = `${apiBase}?ids=${batch.join(',')}`;
        try {
            const res = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!res.ok) continue;
            const json = await res.json();
            const songs = (json && json.songs) || [];
            for (const s of songs) {
                if (!s || !s.id) continue;
                const ds = tsToDateStr(s.publishTime);
                if (ds) result.set(String(s.id), ds);
            }
        } catch {}
    }
    return result;
}

export class WikiFetcher {
    constructor(options = {}) {
        this.apiBase = options.apiBase || DEFAULT_WIKI_API;
        this.detailBase = options.detailBase || DEFAULT_DETAIL_API;
        this.workerCount = options.workerCount || 4;
        this.batchSize = options.batchSize || 16;
        this.workers = [];
        this.token = 0;
    }

    ensureWorkers() {
        if (this.workers.length) return;
        for (let i = 0; i < this.workerCount; i++) {
            const w = new Worker(new URL('./wiki-worker.js', import.meta.url), { type: 'module' });
            this.workers.push(w);
        }
    }

    abort() {
        this.token++;
    }

    destroy() {
        this.token++;
        for (const w of this.workers) {
            try { w.terminate(); } catch {}
        }
        this.workers = [];
    }

    runBatch(worker, ids, token) {
        return new Promise((resolve) => {
            const handler = (e) => {
                if (!e.data || e.data.token !== token) return;
                if (e.data.type !== 'batch-done') return;
                worker.removeEventListener('message', handler);
                resolve(e.data.results || []);
            };
            worker.addEventListener('message', handler);
            worker.postMessage({ type: 'batch', ids, token, apiBase: this.apiBase });
        });
    }

    async ensure(ids, options = {}) {
        const myToken = ++this.token;
        const onProgress = options.onProgress;

        const uniqueIds = Array.from(new Set((ids || []).map(String).filter(Boolean)));
        const total = uniqueIds.length;
        if (!total) return new Map();

        const cached = await getCachedWiki(uniqueIds);
        const missing = uniqueIds.filter((id) => !cached.has(id));

        const result = new Map(cached);
        let done = result.size;

        if (!missing.length) {
            onProgress?.({ done, total, cached: done, fetched: 0 });
            return result;
        }

        this.ensureWorkers();

        const publishPromise = fetchPublishDates(missing, this.detailBase);

        const batches = [];
        for (let i = 0; i < missing.length; i += this.batchSize) {
            batches.push(missing.slice(i, i + this.batchSize));
        }

        let cursor = 0;
        const pendingWrites = [];

        const workerLoop = async (worker) => {
            while (true) {
                if (myToken !== this.token) return;
                const idx = cursor++;
                if (idx >= batches.length) return;
                const batch = batches[idx];
                const results = await this.runBatch(worker, batch, myToken);
                if (myToken !== this.token) return;

                for (const item of results) {
                    if (item && item.data) {
                        result.set(String(item.id), item.data);
                        done++;
                    }
                }

                pendingWrites.push(setWikiBatch(results.map((r) => ({
                    id: r.id,
                    data: r.data || null,
                }))).catch(() => {}));

                onProgress?.({ done, total, cached: cached.size, fetched: done - cached.size });
            }
        };

        await Promise.all(this.workers.map((w) => workerLoop(w)));
        await Promise.all(pendingWrites);

        const publishMap = await publishPromise;
        if (myToken !== this.token) return result;

        if (publishMap.size > 0) {
            const toUpdate = [];
            for (const [id, ds] of publishMap) {
                const entry = result.get(id);
                if (!entry) continue;
                if (entry.publishDate === ds) continue;
                const updated = { ...entry, publishDate: ds };
                result.set(id, updated);
                toUpdate.push({ id, data: updated });
            }
            if (toUpdate.length) {
                await setWikiBatch(toUpdate).catch(() => {});
            }
        }

        return result;
    }
}

let sharedFetcher = null;
export function getWikiFetcher() {
    if (!sharedFetcher) sharedFetcher = new WikiFetcher();
    return sharedFetcher;
}

export function collectWikiOptions(wikiMap) {
    const genres = new Set();
    const languages = new Set();
    const tags = new Set();
    for (const entry of wikiMap.values()) {
        if (!entry) continue;
        if (entry.genre) genres.add(entry.genre);
        if (entry.language) languages.add(entry.language);
        for (const t of entry.bizTags || []) {
            if (t) tags.add(t);
        }
    }
    return {
        genre: Array.from(genres).sort(),
        language: Array.from(languages).sort(),
        bizTags: Array.from(tags).sort(),
    };
}

export function initWikiProgressUI(store) {
    if (typeof document === 'undefined') return null;

    let overlay = null;
    let textEl = null;
    let barEl = null;
    let wasActive = false;

    function ensureOverlay() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.className = 'wiki-progress-overlay hidden';
        overlay.innerHTML = `
            <div class="wiki-progress-panel">
                <div class="wiki-progress-header">
                    <span class="wiki-progress-title">正在分析曲目百科</span>
                </div>
                <div class="wiki-progress-body">
                    <div class="wiki-progress-text">准备中…</div>
                    <div class="wiki-progress-bar"><div class="wiki-progress-bar-inner"></div></div>
                    <div class="wiki-progress-hint">已获取的数据会保留，取消后可稍后继续</div>
                </div>
                <div class="wiki-progress-footer">
                    <button class="ena-btn ena-btn--sm wiki-progress-cancel">取消分析</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        textEl = overlay.querySelector('.wiki-progress-text');
        barEl = overlay.querySelector('.wiki-progress-bar-inner');
        const cancelBtn = overlay.querySelector('.wiki-progress-cancel');
        cancelBtn.addEventListener('click', () => {
            const fetcher = getWikiFetcher();
            fetcher.abort();
            store.update({ wikiProgress: { active: false, done: 0, total: 0 } });
        });
    }

    store.subscribe((state) => {
        const p = state.wikiProgress;
        if (!p) return;

        if (p.active) {
            ensureOverlay();
            overlay.classList.remove('hidden');
            wasActive = true;
            const pct = p.total > 0 ? Math.min(100, (p.done / p.total) * 100) : 0;
            if (barEl) barEl.style.width = pct + '%';
            if (textEl) textEl.textContent = `已分析 ${p.done} / ${p.total}`;
        } else if (wasActive) {
            wasActive = false;
            if (overlay) overlay.classList.add('hidden');
        }
    });

    return {
        get node() { return overlay; },
        hide: () => { if (overlay) overlay.classList.add('hidden'); },
    };
}