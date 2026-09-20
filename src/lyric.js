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

export async function loadLyric(api, song) {
    if (!song || !song.id) return { lines: [], hasTimestamps: false };

    const key = String(song.id);
    if (lyricCache.has(key)) return lyricCache.get(key);

    let text = '';
    try {
        text = await api.resolveLyric(song);
    } catch {
        text = '';
    }

    const parsed = parseLrc(text);
    lyricCache.set(key, parsed);
    return parsed;
}

export function clearLyricCache() {
    lyricCache.clear();
}