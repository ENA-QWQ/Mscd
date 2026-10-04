const CONCURRENCY = 4;

function formatDate(v) {
    if (!v) return '';
    if (typeof v === 'string') {
        const m = v.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
        if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
        const m2 = v.match(/^(\d{4})$/);
        if (m2) return `${m2[1]}-01-01`;
        return '';
    }
    if (typeof v === 'number') {
        const d = new Date(v);
        if (!isNaN(d.getTime())) {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
    }
    return '';
}

function parseWiki(json) {
    const out = {
        genre: '',
        language: '',
        bpm: 0,
        bizTags: [],
        publishDate: '',
        hasAward: false,
    };
    try {
        const blocks = (json && json.data && json.data.blocks) || [];
        for (const block of blocks) {
            if (!block) continue;
            const creatives = block.creatives || [];
            for (const c of creatives) {
                if (!c) continue;
                const type = c.creativeType;

                if (type === 'songTag') {
                    const res = c.resources || [];
                    for (const r of res) {
                        const t = r && r.uiElement && r.uiElement.mainTitle && r.uiElement.mainTitle.title;
                        if (t) { out.genre = String(t); break; }
                    }
                } else if (type === 'songBizTag') {
                    const res = c.resources || [];
                    const tags = [];
                    for (const r of res) {
                        const t = r && r.uiElement && r.uiElement.mainTitle && r.uiElement.mainTitle.title;
                        if (t) tags.push(String(t));
                    }
                    if (tags.length) out.bizTags = tags;
                } else if (type === 'language') {
                    const links = (c.uiElement && c.uiElement.textLinks) || [];
                    for (const l of links) {
                        if (l && l.text && !out.language) { out.language = String(l.text); break; }
                    }
                } else if (type === 'bpm') {
                    const links = (c.uiElement && c.uiElement.textLinks) || [];
                    for (const l of links) {
                        const n = Number(l && l.text);
                        if (!isNaN(n) && n > 0) { out.bpm = n; break; }
                    }
                } else if (type === 'songAward') {
                    const res = c.resources || [];
                    out.hasAward = res.length > 0;
                }
            }
            if (!out.publishDate) {
                const basic = block.basic || {};
                const t = basic.publishTime || basic.publishDate || basic.publishDateStr;
                if (t) out.publishDate = formatDate(t);
            }
        }
    } catch {}
    return out;
}

async function fetchOne(id, apiBase) {
    const url = `${apiBase}?id=${encodeURIComponent(id)}`;
    try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) return { id, error: `HTTP ${res.status}` };
        const json = await res.json();
        return { id, data: parseWiki(json) };
    } catch (e) {
        return { id, error: (e && e.message) || '请求失败' };
    }
}

async function runWithConcurrency(tasks, concurrency) {
    const results = new Array(tasks.length);
    let cursor = 0;
    const runners = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
        while (true) {
            const i = cursor++;
            if (i >= tasks.length) return;
            results[i] = await tasks[i]();
        }
    });
    await Promise.all(runners);
    return results;
}

self.addEventListener('message', async (e) => {
    const msg = e.data || {};
    if (msg.type !== 'batch') return;
    const { ids, token, apiBase } = msg;
    if (!Array.isArray(ids) || !ids.length) {
        self.postMessage({ type: 'batch-done', token, results: [] });
        return;
    }
    const tasks = ids.map((id) => () => fetchOne(id, apiBase));
    const results = await runWithConcurrency(tasks, CONCURRENCY);
    self.postMessage({ type: 'batch-done', token, results });
});