function safeStr(v) {
    return v === null || v === undefined ? '' : String(v);
}

function splitArtists(artist) {
    if (!artist) return [];
    return String(artist).split(/\s*[\/、，,]\s*|\s*&\s*/).filter(Boolean);
}

const VERSION_KEYWORDS = ['live', 'remix', 'acoustic', 'instrumental', 'cover', 'demo', '现场', '伴奏', '翻唱', '纯音乐'];

function titleHasVersion(title) {
    const s = safeStr(title);
    if (!s) return false;
    if (/[（(][^）)]*(live|remix|acoustic|instrumental|cover|demo|现场|伴奏|翻唱|纯音乐)[^）)]*[）)]/i.test(s)) return true;
    const lower = s.toLowerCase();
    return VERSION_KEYWORDS.some((k) => lower.includes(k));
}

function titleHasBracket(title) {
    return /[（(][^）)]*[）)]/.test(safeStr(title));
}

function detectScript(text) {
    const s = safeStr(text);
    if (!s) return 'empty';
    if (/[\u4e00-\u9fff]/.test(s)) return 'chinese';
    if (/[\u3040-\u30ff]/.test(s)) return 'japanese';
    if (/[\uac00-\ud7af]/.test(s)) return 'korean';
    if (/[a-zA-Z]/.test(s)) return 'latin';
    return 'other';
}

export const FIELD_DEFS = {
    title: { label: '歌曲名', type: 'text', get: (s) => s.title || '' },
    artist: { label: '歌手名', type: 'text', get: (s) => s.artist || '' },
    album: { label: '专辑名', type: 'text', get: (s) => s.album || '' },
    artistCount: { label: '歌手数量', type: 'number', get: (s) => splitArtists(s.artist).length },

    duration: { label: '时长', type: 'duration', get: (s) => s.duration || 0 },

    hasCover: { label: '有封面', type: 'boolean', get: (s) => !!s.pic },
    hasAlbum: { label: '有专辑信息', type: 'boolean', get: (s) => !!s.album },
    hasArtist: { label: '有歌手信息', type: 'boolean', get: (s) => !!s.artist },
    titleHasVersion: { label: '标题含版本关键词', type: 'boolean', get: (s) => titleHasVersion(s.title) },
    titleHasBracket: { label: '标题含括号内容', type: 'boolean', get: (s) => titleHasBracket(s.title) },
    titleScript: {
        label: '标题字符集', type: 'enum',
        options: [
            { value: 'chinese', label: '中文' },
            { value: 'japanese', label: '日文' },
            { value: 'korean', label: '韩文' },
            { value: 'latin', label: '拉丁字母' },
            { value: 'other', label: '其它' },
        ],
        get: (s) => detectScript(s.title),
    },

    titleLength: { label: '歌曲名长度', type: 'number', get: (s) => safeStr(s.title).length },
    artistLength: { label: '歌手名长度', type: 'number', get: (s) => safeStr(s.artist).length },
    albumLength: { label: '专辑名长度', type: 'number', get: (s) => safeStr(s.album).length },

    quality: {
        label: '下载音质', type: 'enum',
        options: [
            { value: 128, label: '标准' },
            { value: 192, label: '较高' },
            { value: 320, label: 'HQ' },
            { value: 2000, label: '无损' },
        ],
        get: (s) => s._quality ?? 0,
    },
    withLyric: { label: '同时下载歌词', type: 'boolean', get: (s) => !!s._withLyric },
    lyricOnly: { label: '仅下载歌词', type: 'boolean', get: (s) => !!s._lyricOnly },

    isInDownloads: { label: '已在下载列表', type: 'boolean', get: (s, ctx) => !!s.id && !!ctx?.downloadIds?.has(String(s.id)) },
    isInQueue: { label: '已在播放队列', type: 'boolean', get: (s, ctx) => !!s.id && !!ctx?.queueIds?.has(String(s.id)) },

    publishDate: {
        label: '发行日期', type: 'date', dynamic: true,
        get: (s, ctx) => ctx?.wikiMap?.get(String(s.id))?.publishDate ?? '',
    },
    hasAward: {
        label: '获得奖项', type: 'boolean', dynamic: true,
        get: (s, ctx) => !!ctx?.wikiMap?.get(String(s.id))?.hasAward,
    },
    bizTags: {
        label: '推荐标签', type: 'enum', dynamic: true,
        options: [],
        get: (s, ctx) => ctx?.wikiMap?.get(String(s.id))?.bizTags ?? [],
    },
    language: {
        label: '语种', type: 'enum', dynamic: true,
        options: [],
        get: (s, ctx) => ctx?.wikiMap?.get(String(s.id))?.language ?? '',
    },
    genre: {
        label: '曲风', type: 'enum', dynamic: true,
        options: [],
        get: (s, ctx) => ctx?.wikiMap?.get(String(s.id))?.genre ?? '',
    },
    bpm: {
        label: 'BPM', type: 'number', dynamic: true,
        get: (s, ctx) => ctx?.wikiMap?.get(String(s.id))?.bpm ?? 0,
    },
};

const FIELD_GROUP_DEFS = [
    { key: 'base', label: '基础信息', fields: ['title', 'artist', 'album', 'artistCount'] },
    { key: 'duration', label: '时长相关', fields: ['duration'] },
    { key: 'content', label: '内容特征', fields: ['hasCover', 'hasAlbum', 'hasArtist', 'titleHasVersion', 'titleHasBracket', 'titleScript'] },
    { key: 'length', label: '文本长度', fields: ['titleLength', 'artistLength', 'albumLength'] },
    { key: 'downloads', label: '下载属性', fields: ['quality', 'withLyric', 'lyricOnly'] },
    { key: 'wiki', label: '百科信息', fields: ['publishDate', 'hasAward', 'bizTags', 'language', 'genre', 'bpm'] },
    { key: 'cross', label: '跨列表', fields: ['isInDownloads', 'isInQueue'] },
];

const VIEW_GROUPS = {
    search: ['base', 'duration', 'content', 'length', 'wiki'],
    queue: ['base', 'duration', 'content', 'length', 'cross', 'wiki'],
    downloads: ['base', 'duration', 'content', 'length', 'downloads', 'cross', 'wiki'],
    playlist: ['base', 'duration', 'content', 'length', 'cross', 'wiki'],
    liked: ['base', 'duration', 'content', 'length', 'cross', 'wiki'],
};

export function getFieldsForView(view) {
    const groups = VIEW_GROUPS[view] || VIEW_GROUPS.search;
    const result = [];
    for (const g of FIELD_GROUP_DEFS) {
        if (!groups.includes(g.key)) continue;
        for (const key of g.fields) {
            if (FIELD_DEFS[key]) result.push({ key, ...FIELD_DEFS[key] });
        }
    }
    return result;
}

export const OPERATORS = {
    contains: { label: '包含', types: ['text'], apply: (a, b) => safeStr(a).toLowerCase().includes(safeStr(b).toLowerCase()) },
    notContains: { label: '不包含', types: ['text'], apply: (a, b) => !safeStr(a).toLowerCase().includes(safeStr(b).toLowerCase()) },
    equals: { label: '等于', types: ['text'], apply: (a, b) => String(a) === String(b) },
    notEquals: { label: '不等于', types: ['text'], apply: (a, b) => String(a) !== String(b) },
    startsWith: { label: '开头是', types: ['text'], apply: (a, b) => safeStr(a).toLowerCase().startsWith(safeStr(b).toLowerCase()) },
    endsWith: { label: '结尾是', types: ['text'], apply: (a, b) => safeStr(a).toLowerCase().endsWith(safeStr(b).toLowerCase()) },
    regex: { label: '正则匹配', types: ['text'], apply: (a, b) => { try { return new RegExp(safeStr(b), 'i').test(safeStr(a)); } catch { return false; } } },

    eq: { label: '等于', types: ['number', 'duration'], apply: (a, b) => Number(a) === Number(b) },
    neq: { label: '不等于', types: ['number', 'duration'], apply: (a, b) => Number(a) !== Number(b) },
    gt: { label: '大于', types: ['number', 'duration'], apply: (a, b) => Number(a) > Number(b) },
    gte: { label: '大于等于', types: ['number', 'duration'], apply: (a, b) => Number(a) >= Number(b) },
    lt: { label: '小于', types: ['number', 'duration'], apply: (a, b) => Number(a) < Number(b) },
    lte: { label: '小于等于', types: ['number', 'duration'], apply: (a, b) => Number(a) <= Number(b) },
    between: { label: '介于', types: ['number', 'duration'], valueShape: 'range', apply: (a, b) => Number(a) >= Number(b?.min ?? 0) && Number(a) <= Number(b?.max ?? 0) },

    isTrue: { label: '是', types: ['boolean'], apply: (a) => a === true },
    isFalse: { label: '否', types: ['boolean'], apply: (a) => a === false },

    before: { label: '早于', types: ['date'], apply: (a, b) => { if (!a || !b) return false; return new Date(a).getTime() < new Date(b).getTime(); } },
    after: { label: '晚于', types: ['date'], apply: (a, b) => { if (!a || !b) return false; return new Date(a).getTime() > new Date(b).getTime(); } },
    dateBetween: {
        label: '介于', types: ['date'], valueShape: 'range',
        apply: (a, b) => {
            if (!a) return false;
            const t = new Date(a).getTime();
            if (isNaN(t)) return false;
            const min = b?.min ? new Date(b.min).getTime() : -Infinity;
            const max = b?.max ? new Date(b.max).getTime() : Infinity;
            return t >= min && t <= max;
        },
    },

    eqEnum: { label: '等于', types: ['enum'], apply: (a, b) => String(a) === String(b) },
    neqEnum: { label: '不等于', types: ['enum'], apply: (a, b) => String(a) !== String(b) },
    in: { label: '是其中之一', types: ['enum'], valueShape: 'multi', apply: (a, b) => Array.isArray(b) && b.map(String).includes(String(a)) },
    notIn: { label: '不是其中之一', types: ['enum'], valueShape: 'multi', apply: (a, b) => Array.isArray(b) && !b.map(String).includes(String(a)) },
};

export function getOperatorsForField(field) {
    const result = [];
    for (const [key, op] of Object.entries(OPERATORS)) {
        if (op.types.includes(field.type)) result.push({ key, ...op });
    }
    return result;
}

export function createGroup(op = 'and') {
    return { type: 'group', op, negate: false, children: [] };
}

export function createCondition(fieldKey) {
    const key = fieldKey || 'title';
    const field = FIELD_DEFS[key] || FIELD_DEFS.title;
    const ops = getOperatorsForField(field);
    const op = ops[0]?.key || 'contains';
    return { type: 'condition', field: key, operator: op, value: defaultForOperator(op, field) };
}

export function defaultForOperator(op, field) {
    if (field.type === 'duration') {
        if (op === 'between') return { min: 0, max: 0, unit: 's' };
        return { value: 0, unit: 's' };
    }
    if (field.type === 'date') {
        if (op === 'dateBetween') return { min: '', max: '' };
        return '';
    }
    if (op === 'between') return { min: 0, max: 0 };
    if (op === 'in' || op === 'notIn') return [];
    if (field.type === 'number') return 0;
    if (field.type === 'boolean') return true;
    if (field.type === 'enum') return field.options?.[0]?.value ?? '';
    return '';
}

export function countConditions(node) {
    if (!node) return 0;
    if (node.type === 'condition') return 1;
    if (node.type === 'group') return (node.children || []).reduce((sum, c) => sum + countConditions(c), 0);
    return 0;
}

export function evaluate(node, song, ctx) {
    if (!node) return true;
    if (node.type === 'group') {
        const children = node.children || [];
        if (!children.length) return node.op !== 'or';
        const result = node.op === 'or'
            ? children.some((c) => evaluate(c, song, ctx))
            : children.every((c) => evaluate(c, song, ctx));
        return node.negate ? !result : result;
    }
    if (node.type === 'condition') {
        const field = FIELD_DEFS[node.field];
        const op = OPERATORS[node.operator];
        if (!field || !op) return true;
        const raw = field.get(song, ctx);

        let value = node.value;
        if (field.type === 'duration' && value && typeof value === 'object') {
            const mult = value.unit === 'm' ? 60 : 1;
            if ('min' in value && 'max' in value) {
                value = { min: Number(value.min) * mult, max: Number(value.max) * mult };
            } else if ('value' in value) {
                value = Number(value.value) * mult;
            }
        }

        if (typeof node.value === 'string' && node.value.trim() === '' && op.types.includes('text')) return true;
        try {
            return !!op.apply(raw, value);
        } catch {
            return true;
        }
    }
    return true;
}

export function buildFilterContext(tracks, options = {}) {
    const downloadIds = new Set();
    const queueIds = new Set();
    if (Array.isArray(options.downloads)) {
        for (const d of options.downloads) if (d?.id) downloadIds.add(String(d.id));
    }
    if (Array.isArray(options.queue)) {
        for (const t of options.queue) if (t?.id) queueIds.add(String(t.id));
    }

    return {
        downloadIds,
        queueIds,
        wikiMap: options.wikiMap instanceof Map ? options.wikiMap : new Map(),
    };
}

export function treeHasDynamicField(node) {
    if (!node) return false;
    if (node.type === 'condition') {
        const field = FIELD_DEFS[node.field];
        return !!(field && field.dynamic);
    }
    if (node.type === 'group') {
        return (node.children || []).some((c) => treeHasDynamicField(c));
    }
    return false;
}