const lyricCache = new Map();

export function parseLrc(text) {
    if (!text) return { lines: [], hasTimestamps: false };

    const rawLines = String(text).split(/\r?\n/);
    const timeTagRe = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    const metaRe = /^\[(ar|ti|al|by|offset):(.*)\]/i;
    const lines = [];
    let offset = 0;
    let hasTimestamps = false;

    for (const rawLine of rawLines) {
        const line = rawLine.trim();
        if (!line) continue;

        const meta = line.match(metaRe);
        if (meta) {
            if (meta[1].toLowerCase() === 'offset') {
                const v = parseInt(meta[2], 10);
                if (!isNaN(v)) offset = v / 1000;
            }
            continue;
        }

        timeTagRe.lastIndex = 0;
        const times = [];
        let m;
        while ((m = timeTagRe.exec(line)) !== null) {
            const min = parseInt(m[1], 10) || 0;
            const sec = parseInt(m[2], 10) || 0;
            const frac = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) / 1000 : 0;
            times.push(min * 60 + sec + frac);
            hasTimestamps = true;
        }

        const textPart = line.replace(timeTagRe, '').trim();

        let text = textPart;
        let translation = '';
        const tMatch = textPart.match(/^(.*)\s*\(([^()]+)\)\s*$/);
        if (tMatch) {
            const candidate = tMatch[2].trim();
            if (candidate && /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(candidate)) {
                text = tMatch[1].trim();
                translation = candidate;
            }
        }

        if (times.length === 0) {
            lines.push({ time: -1, text, translation });
        } else {
            for (const t of times) {
                lines.push({ time: t + offset, text, translation });
            }
        }
    }

    if (hasTimestamps) {
        lines.sort((a, b) => a.time - b.time);
    }

    return { lines, hasTimestamps };
}

export function parseYrc(text) {
    if (!text) return { lines: [], hasTimestamps: false, hasWordTimestamps: false };

    const rawLines = String(text).split(/\r?\n/);
    const lines = [];
    let hasWordTimestamps = false;

    for (const rawLine of rawLines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('{')) continue;

        const lineMatch = line.match(/^\[(\d+),(\d+)\]/);
        if (!lineMatch) continue;

        const lineStart = parseInt(lineMatch[1], 10);
        const lineDuration = parseInt(lineMatch[2], 10);
        const content = line.slice(lineMatch[0].length);

        const wordRe = /\((\d+),(\d+),(\d+)\)([^(]*)/g;
        const words = [];
        let wordMatch;

        while ((wordMatch = wordRe.exec(content)) !== null) {
            const wordStart = parseInt(wordMatch[1], 10);
            const wordDurationCs = parseInt(wordMatch[2], 10);
            const wordText = wordMatch[4];
            if (!wordText) continue;
            const startSec = wordStart / 1000;
            const endSec = (wordStart + wordDurationCs) / 1000;
            words.push({ text: wordText, startTime: startSec, endTime: endSec });
            hasWordTimestamps = true;
        }

        if (words.length) {
            lines.push({
                time: lineStart / 1000,
                duration: lineDuration / 1000,
                text: words.map((w) => w.text).join(''),
                words,
            });
        }
    }

    lines.sort((a, b) => a.time - b.time);
    return { lines, hasTimestamps: lines.length > 0, hasWordTimestamps };
}

export function parseWordJson(text) {
    if (!text) return { lines: [], hasTimestamps: false, hasWordTimestamps: false };

    const rawLines = String(text).split(/\r?\n/);
    const lines = [];

    for (const rawLine of rawLines) {
        const line = rawLine.trim();
        if (!line || line[0] !== '{') continue;

        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        if (typeof obj?.t !== 'number' || !Array.isArray(obj.c)) continue;

        const merged = obj.c
            .map(w => (w && typeof w.tx === 'string') ? w.tx : '')
            .join('')
            .trim();

        if (!merged) continue;

        lines.push({
            time: obj.t / 1000,
            text: merged,
            translation: '',
        });
    }

    lines.sort((a, b) => a.time - b.time);
    return { lines, hasTimestamps: lines.length > 0, hasWordTimestamps: false };
}

export function findCurrentIndex(lines, t) {
    if (!lines.length) return -1;
    let lo = 0;
    let hi = lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].time <= t) {
            ans = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return ans;
}

function mergeTranslation(lines, tlyricText) {
    if (!lines || !lines.length || !tlyricText) return;
    const re = /^\[(\d+):(\d+)(?:[.:](\d+))?\](.*)$/;
    const entries = [];
    for (const raw of String(tlyricText).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const m = line.match(re);
        if (!m) continue;
        const min = parseInt(m[1], 10) || 0;
        const sec = parseInt(m[2], 10) || 0;
        const frac = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) / 1000 : 0;
        const text = m[4].trim();
        if (text) entries.push({ time: min * 60 + sec + frac, text });
    }
    if (!entries.length) return;
    for (const line of lines) {
        if (line.translation) continue;
        for (const e of entries) {
            if (Math.abs(e.time - line.time) <= 0.5) {
                line.translation = e.text;
                break;
            }
        }
    }
}

function parseMixed(text) {
    if (!text) return { lines: [], hasTimestamps: false, hasWordTimestamps: false };

    const rawLines = String(text).split(/\r?\n/);
    const lines = [];

    for (const rawLine of rawLines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (line[0] === '{') {
            try {
                const obj = JSON.parse(line);
                if (typeof obj?.t === 'number' && Array.isArray(obj.c)) {
                    const merged = obj.c
                        .map(w => (w && typeof w.tx === 'string') ? w.tx : '')
                        .join('')
                        .trim();
                    if (merged) {
                        lines.push({
                            time: obj.t / 1000,
                            text: merged,
                            translation: '',
                        });
                    }
                }
            } catch {}
            continue;
        }

        const timeMatch = line.match(/^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/);
        if (timeMatch) {
            const min = parseInt(timeMatch[1], 10) || 0;
            const sec = parseInt(timeMatch[2], 10) || 0;
            const frac = timeMatch[3] ? parseInt(timeMatch[3].padEnd(3, '0'), 10) / 1000 : 0;
            const time = min * 60 + sec + frac;
            const text = line.replace(/^\[.*?\]\s*/, '').trim();
            if (text) {
                lines.push({ time, text, translation: '' });
            }
        }
    }

    lines.sort((a, b) => a.time - b.time);
    return { lines, hasTimestamps: lines.length > 0, hasWordTimestamps: false };
}

export async function loadLyric(api, song) {
    if (!song || !song.id) return { lines: [], hasTimestamps: false, hasWordTimestamps: false };

    const key = String(song.id);
    if (lyricCache.has(key)) return lyricCache.get(key);

    let raw = '';
    try {
        raw = await api.resolveLyric(song);
    } catch {
        raw = '';
    }

    let lrcText = '';
    let tlyricText = '';

    if (raw && typeof raw === 'object') {
        lrcText = typeof raw.lrc === 'string' ? raw.lrc : '';
        tlyricText = typeof raw.tlyric === 'string' ? raw.tlyric : '';
    } else if (typeof raw === 'string') {
        lrcText = raw;
    }

    const parsed = parseMixed(lrcText);
    if (tlyricText) mergeTranslation(parsed.lines, tlyricText);

    lyricCache.set(key, parsed);
    return parsed;
}

export function clearLyricCache() {
    lyricCache.clear();
}