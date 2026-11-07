import { config } from '../config.js';
import { store } from './store.js';

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

const DB_NAME = 'mscd-wiki';
const DB_VERSION = 2;
const STORE_NAME = 'songWiki';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const FAILED_TTL = 60 * 60 * 1000;

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
                    const data = entry.data || {};
                    result.set(id, {
                        ...data,
                        __summaryFetched: !!entry.summaryFetched,
                        __publishFetched: !!entry.publishFetched,
                    });
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
            const data = e.data || null;
            const summaryFetched = !!(data && data.__summaryFetched);
            const publishFetched = !!(data && data.__publishFetched);
            const cleanData = data ? { ...data } : null;
            if (cleanData) {
                delete cleanData.__summaryFetched;
                delete cleanData.__publishFetched;
            }
            store.put({
                data: cleanData,
                failed: !cleanData,
                fetchedAt: now,
                summaryFetched,
                publishFetched,
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
                    const data = entry.data || {};
                    result.set(String(cursor.key), {
                        ...data,
                        __summaryFetched: !!entry.summaryFetched,
                        __publishFetched: !!entry.publishFetched,
                    });
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
        const baseUrl = `${apiBase}?ids=${batch.join(',')}`;
        const url = applyApiProxy(baseUrl);
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
        this.apiBase = options.apiBase || config.wiki.summaryApi;
        this.detailBase = options.detailBase || config.wiki.detailApi;
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
            let proxyPrefix = '';
            try {
                if (store.get().settings.apiProxy) proxyPrefix = config.proxy || '';
            } catch {}
            worker.postMessage({ type: 'batch', ids, token, apiBase: this.apiBase, proxyPrefix });
        });
    }

    async ensure(ids, options = {}) {
        const myToken = ++this.token;
        const onProgress = options.onProgress;

        const uniqueIds = Array.from(new Set((ids || []).map(String).filter(Boolean)));
        const total = uniqueIds.length;
        if (!total) return new Map();

        const cached = await getCachedWiki(uniqueIds);

        const result = new Map();
        for (const id of uniqueIds) {
            const entry = cached.get(id);
            if (entry) {
                result.set(id, {
                    ...entry,
                    __summaryFetched: !!entry.__summaryFetched,
                    __publishFetched: !!entry.__publishFetched,
                });
            } else {
                result.set(id, {
                    genre: '', language: '', bpm: 0, bizTags: [], publishDate: '', hasAward: false,
                    __summaryFetched: false,
                    __publishFetched: false,
                });
            }
        }

        const missingSummary = uniqueIds.filter((id) => !result.get(id).__summaryFetched);
        const missingPublish = uniqueIds.filter((id) => !result.get(id).__publishFetched);

        if (!missingSummary.length && !missingPublish.length) {
            onProgress?.({ done: total, total, cached: total, fetched: 0 });
            return result;
        }

        let done = total - missingSummary.length;

        if (missingSummary.length) {
            this.ensureWorkers();

            const batches = [];
            for (let i = 0; i < missingSummary.length; i += this.batchSize) {
                batches.push(missingSummary.slice(i, i + this.batchSize));
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
                        if (!item) continue;
                        const id = String(item.id);
                        const prev = result.get(id) || {};
                        if (item.data) {
                            result.set(id, {
                                ...prev,
                                ...item.data,
                                __summaryFetched: true,
                            });
                        } else {
                            result.set(id, {
                                ...prev,
                                __summaryFetched: true,
                            });
                        }
                        done++;
                    }

                    pendingWrites.push(setWikiBatch(results.map((r) => {
                        const id = String(r.id);
                        const prev = result.get(id) || {};
                        if (r.data) {
                            return {
                                id,
                                data: { ...prev, ...r.data, __summaryFetched: true },
                            };
                        }
                        return {
                            id,
                            data: { ...prev, __summaryFetched: true },
                        };
                    })).catch(() => {}));

                    onProgress?.({ done, total, cached: cached.size, fetched: done - cached.size });
                }
            };

            await Promise.all(this.workers.map((w) => workerLoop(w)));
            await Promise.all(pendingWrites);
        }

        if (missingPublish.length) {
            const publishMap = await fetchPublishDates(missingPublish, this.detailBase);
            if (myToken !== this.token) return result;

            const toUpdate = [];
            for (const id of missingPublish) {
                const prev = result.get(id) || {};
                const ds = publishMap.get(id) || prev.publishDate || '';
                const updated = {
                    ...prev,
                    publishDate: ds,
                    __publishFetched: true,
                };
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

const wikiDetailMem = new Map();
const wikiDetailPending = new Map();

function pickFirstValue(arr, fn) {
    if (!Array.isArray(arr)) return '';
    for (const x of arr) {
        const v = fn(x);
        if (v) return String(v);
    }
    return '';
}

function parseWikiDetail(json) {
    const out = {
        title: '',
        basic: { publishDate: '', company: '' },
        fields: [],
        awards: [],
        sections: [],
        playlists: [],
        raw: json,
        error: null,
    };

    const SKIP_BLOCK_CODES = new Set([
        'SONG_PLAY_ABOUT_MUSIC_MEMORY',
        'SONG_PLAY_ABOUT_SIMILAR_SONG',
        'SONG_PLAY_ABOUT_RELATED_PLAYLIST',
        'SONG_PLAY_ABOUT_MUSIC_SONG_GRADE',
    ]);

    const SKIP_SECTION_TITLES = [
        '影视节目', '乐谱', '乐评', 'MV 相关', '相关 MV', '演唱会', '音乐剧',
        '歌单', '合辑', '专辑推荐', '歌曲推荐', '相似歌曲', '包含这首歌',
        '推荐歌单', '精选歌单', '相关歌单', '歌曲合集', '精选合集',
    ];

    const isCollectionCreative = (type, res) => {
        const t = String(type || '').toLowerCase();
        if (t.includes('songlist') || t.includes('playlist') || t.includes('songrecommend') || t.includes('similar') || t.includes('radio') || t.includes('video') || t.includes('albumlist') || t.includes('songcollection')) return true;
        if (Array.isArray(res) && res.length >= 2) {
            for (const r of res) {
                if (!r) continue;
                const rt = String(r.resourceType || r.type || '').toLowerCase();
                if (rt.includes('playlist') || rt.includes('songlist') || rt.includes('albumlist')) return true;
                if (r.cover || r.picUrl || r.playCount || r.trackCount) return true;
            }
        }
        return false;
    };

    try {
        const blocks = (json && json.data && json.data.blocks) || [];
        const fieldMap = new Map();

        for (const block of blocks) {
            if (!block) continue;
            const blockCode = String(block.code || '');

            if (blockCode === 'SONG_PLAY_ABOUT_RELATED_PLAYLIST') {
                for (const c of block.creatives || []) {
                    for (const r of c.resources || []) {
                        if (!r) continue;
                        if (String(r.resourceType || '') !== 'PLAYLIST') continue;
                        const pid = String(r.resourceId || '');
                        if (!pid) continue;
                        const mainTitle = r.uiElement && r.uiElement.mainTitle && r.uiElement.mainTitle.title;
                        const imgs = (r.uiElement && r.uiElement.images) || [];
                        const pic = imgs[0] && imgs[0].imageUrl ? String(imgs[0].imageUrl) : '';
                        const playCount = r.resourceExtInfo && r.resourceExtInfo.playCount ? Number(r.resourceExtInfo.playCount) : 0;
                        out.playlists.push({
                            id: pid,
                            title: mainTitle ? String(mainTitle) : '',
                            pic,
                            playCount,
                        });
                    }
                }
                continue;
            }

            if (SKIP_BLOCK_CODES.has(blockCode)) continue;

            const blockTitle = block.uiElement && block.uiElement.mainTitle && block.uiElement.mainTitle.title;
            if (blockTitle && SKIP_SECTION_TITLES.some((k) => String(blockTitle).includes(k))) continue;

            const basic = block.basic || {};
            if (!out.basic.publishDate) {
                const pt = basic.publishTime || basic.publishDate || basic.publishDateStr;
                if (pt) {
                    const d = new Date(typeof pt === 'number' ? pt : String(pt));
                    if (!isNaN(d.getTime())) {
                        out.basic.publishDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                    }
                }
            }
            if (!out.basic.company && basic.company) out.basic.company = String(basic.company);

            const creatives = block.creatives || [];
            for (const c of creatives) {
                if (!c) continue;
                const type = c.creativeType || '';
                const res = c.resources || [];
                const links = (c.uiElement && c.uiElement.textLinks) || [];

                if (type === 'songTag') {
                    const val = pickFirstValue(res, (r) => r && r.uiElement && r.uiElement.mainTitle && r.uiElement.mainTitle.title);
                    if (val && !fieldMap.has('genre')) fieldMap.set('genre', { label: '曲风', value: val });
                } else if (type === 'songBizTag') {
                    const tags = [];
                    for (const r of res) {
                        const t = r && r.uiElement && r.uiElement.mainTitle && r.uiElement.mainTitle.title;
                        if (t) tags.push(String(t));
                    }
                    if (tags.length && !fieldMap.has('tags')) fieldMap.set('tags', { label: '标签', value: tags.join(' / ') });
                } else if (type === 'language') {
                    const val = pickFirstValue(links, (l) => l && l.text);
                    if (val && !fieldMap.has('language')) fieldMap.set('language', { label: '语种', value: val });
                } else if (type === 'bpm') {
                    const val = pickFirstValue(links, (l) => l && l.text);
                    if (val && !fieldMap.has('bpm')) fieldMap.set('bpm', { label: 'BPM', value: val });
                } else if (type === 'songAward') {
                    for (const r of res) {
                        if (!r) continue;
                        const mainTitle = r.uiElement && r.uiElement.mainTitle && r.uiElement.mainTitle.title;
                        const subTitles = (r.uiElement && r.uiElement.subTitles) || [];
                        const title = mainTitle ? String(mainTitle).trim() : '';
                        const subtitleList = subTitles
                            .map((st) => (st && st.title ? String(st.title).trim() : ''))
                            .filter(Boolean);
                        if (!title && !subtitleList.length) continue;
                        const key = title + '|' + subtitleList.join('|');
                        if (out.awards.some((a) => (a && typeof a === 'object' ? a.key : a) === key)) continue;
                        out.awards.push({ key, title, subtitles: subtitleList });
                    }
                    for (const l of links) {
                        const t = l && l.text;
                        if (!t || !String(t).trim()) continue;
                        const name = String(t).trim();
                        if (out.awards.some((a) => (a && typeof a === 'object'
                            ? a.title === name && !a.subtitles.length
                            : a === name))) continue;
                        out.awards.push({ key: name, title: name, subtitles: [] });
                    }
                } else if (type === 'entertainment' || type === 'sheet' || type === 'songComment') {
                    continue;
                } else {
                    if (isCollectionCreative(type, res)) continue;
                    const mainTitle = c.uiElement && c.uiElement.mainTitle && c.uiElement.mainTitle.title;
                    const subTitle = c.uiElement && c.uiElement.subTitle && c.uiElement.subTitle.title;
                    const titleStr = mainTitle ? String(mainTitle).trim() : '';
                    if (titleStr && SKIP_SECTION_TITLES.some((k) => titleStr.includes(k))) continue;
                    const lines = [];
                    for (const l of links) {
                        const t = l && l.text;
                        if (t && String(t).trim()) lines.push(String(t).trim());
                    }
                    for (const r of res) {
                        const t = r && r.uiElement && r.uiElement.mainTitle && r.uiElement.mainTitle.title;
                        if (t && String(t).trim()) lines.push(String(t).trim());
                        const st = r && r.uiElement && r.uiElement.subTitle && r.uiElement.subTitle.title;
                        if (st && String(st).trim()) lines.push(String(st).trim());
                    }
                    if (subTitle && String(subTitle).trim()) lines.unshift(String(subTitle).trim());
                    const allText = lines.join(' ');
                    if (allText) out.sections.push({ title: titleStr, text: allText });
                }
            }
        }
        out.fields = Array.from(fieldMap.values());
    } catch {}
    return out;
}

export async function fetchWikiDetail(id) {
    const key = String(id || '');
    if (!key) return null;
    if (wikiDetailMem.has(key)) return wikiDetailMem.get(key);
    if (wikiDetailPending.has(key)) return wikiDetailPending.get(key);

    const promise = (async () => {
        let json = null;
        try {
            const baseUrl = config.wiki.summaryApi + '?id=' + encodeURIComponent(key);
            const url = applyApiProxy(baseUrl);
            const res = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            json = await res.json();
        } catch (e) {
            wikiDetailPending.delete(key);
            return {
                title: '',
                basic: { publishDate: '', company: '' },
                fields: [],
                awards: [],
                sections: [],
                playlists: [],
                raw: null,
                error: (e && e.message) || '请求失败',
            };
        }
        const parsed = parseWikiDetail(json);
        wikiDetailMem.set(key, parsed);
        wikiDetailPending.delete(key);
        return parsed;
    })();

    wikiDetailPending.set(key, promise);
    return promise;
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

        if (p.active && !p.silent) {
            ensureOverlay();
            overlay.classList.remove('hidden');
            wasActive = true;
            const pct = p.total > 0 ? Math.min(100, (p.done / p.total) * 100) : 0;
            if (barEl) barEl.style.width = pct + '%';
            if (textEl) textEl.textContent = `已分析 ${p.done} / ${p.total}`;
        } else if (!p.active && wasActive) {
            wasActive = false;
            if (overlay) overlay.classList.add('hidden');
        }
    });

    return {
        get node() { return overlay; },
        hide: () => { if (overlay) overlay.classList.add('hidden'); },
    };
}