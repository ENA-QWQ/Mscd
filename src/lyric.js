const lyricCache = new Map();

function parseAny(text) {
    if (!text) return null;

    const rawLines = String(text).split(/\r?\n/);
    const lines = [];
    let hasWordTimestamps = false;

    for (const rawLine of rawLines) {
        const s = rawLine.trim();
        if (!s) continue;

        if (s[0] === '{') {
            try {
                const obj = JSON.parse(s);
                if (typeof obj?.t === 'number' && Array.isArray(obj.c)) {
                    const parts = [];
                    const words = [];
                    let allTimed = true;
                    for (const w of obj.c) {
                        if (!w || typeof w.tx !== 'string') continue;
                        parts.push(w.tx);
                        if (typeof w.ts === 'number' && typeof w.te === 'number') {
                            words.push({ text: w.tx, startTime: w.ts / 1000, endTime: w.te / 1000 });
                        } else {
                            allTimed = false;
                        }
                    }
                    const merged = parts.join('').trim();
                    if (merged) {
                        const line = {
                            time: obj.t / 1000,
                            text: merged,
                            translation: '',
                        };
                        if (allTimed && words.length) {
                            line.words = words;
                            hasWordTimestamps = true;
                        } else {
                            line.isMeta = true;
                        }
                        lines.push(line);
                    }
                }
            } catch {}
            continue;
        }

        if (/^\[(ar|ti|al|by|offset|re|ve|kana):/i.test(s)) continue;

        const yrcMatch = s.match(/^\[(\d+),(\d+)\](.*)$/);
        if (yrcMatch) {
            const lineStart = parseInt(yrcMatch[1], 10);
            const lineDuration = parseInt(yrcMatch[2], 10);
            const content = yrcMatch[3];

            const wordRe = /\((\d+),(\d+),(\d+)\)([^(]*)/g;
            const words = [];
            let wm;
            while ((wm = wordRe.exec(content)) !== null) {
                const ws = parseInt(wm[1], 10);
                const wd = parseInt(wm[2], 10);
                const wt = wm[4];
                if (!wt) continue;
                words.push({
                    text: wt,
                    startTime: ws / 1000,
                    endTime: (ws + wd) / 1000,
                });
            }
            if (words.length) {
                hasWordTimestamps = true;
                lines.push({
                    time: lineStart / 1000,
                    duration: lineDuration / 1000,
                    text: words.map(w => w.text).join(''),
                    words,
                });
            } else {
                const plain = content.trim();
                if (plain) lines.push({ time: lineStart / 1000, text: plain, translation: '' });
            }
            continue;
        }

        const timeTagRe = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
        timeTagRe.lastIndex = 0;
        const times = [];
        let m;
        while ((m = timeTagRe.exec(s)) !== null) {
            const min = parseInt(m[1], 10) || 0;
            const sec = parseInt(m[2], 10) || 0;
            const frac = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) / 1000 : 0;
            times.push(min * 60 + sec + frac);
        }
        if (!times.length) continue;
        const textPart = s.replace(timeTagRe, '').trim();
        if (!textPart) continue;
        for (const t of times) {
            lines.push({ time: t, text: textPart, translation: '' });
        }
    }

    if (!lines.length) return null;

    lines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));

    return {
        lines,
        hasTimestamps: true,
        hasWordTimestamps,
    };
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
        if (line.isMeta) continue;
        let best = null;
        let bestDiff = 0.5;
        for (const e of entries) {
            const diff = Math.abs(e.time - line.time);
            if (diff < bestDiff) {
                bestDiff = diff;
                best = e;
            }
        }
        if (best) line.translation = best.text;
    }
}

function dedupeLines(lines) {
    const seen = new Set();
    const out = [];
    for (const line of lines) {
        const key = `${Math.round((line.time ?? 0) * 1000)}|${line.text || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(line);
    }
    return out;
}

export function parseLrc(text) {
    return parseAny(text) || { lines: [], hasTimestamps: false, hasWordTimestamps: false };
}

export function parseYrc(text) {
    return parseAny(text) || { lines: [], hasTimestamps: false, hasWordTimestamps: false };
}

export function parseWordJson(text) {
    return parseAny(text) || { lines: [], hasTimestamps: false, hasWordTimestamps: false };
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
    if (!song || !song.id) return { lines: [], hasTimestamps: false, hasWordTimestamps: false };

    const key = String(song.id);
    if (lyricCache.has(key)) return lyricCache.get(key);

    let raw = '';
    try {
        raw = await api.resolveLyric(song);
    } catch {
        raw = '';
    }

    let yrcText = '';
    let lrcText = '';
    let tlyricText = '';

    if (raw && typeof raw === 'object') {
        yrcText = typeof raw.yrc === 'string' ? raw.yrc : '';
        lrcText = typeof raw.lrc === 'string' ? raw.lrc : '';
        tlyricText = typeof raw.tlyric === 'string' ? raw.tlyric : '';
    } else if (typeof raw === 'string') {
        lrcText = raw;
    }

    const y = yrcText ? parseAny(yrcText) : null;
    const l = lrcText ? parseAny(lrcText) : null;

    let parsed;

    if (l) {
        parsed = l;
        if (y && y.hasWordTimestamps && y.lines.length) {
            const yLines = y.lines;
            const usedY = new Set();
            for (const line of parsed.lines) {
                if (line.isMeta) continue;
                let best = null;
                let bestIdx = -1;
                let bestDiff = 0.5;
                for (let i = 0; i < yLines.length; i++) {
                    if (usedY.has(i)) continue;
                    const yl = yLines[i];
                    if (!yl.words || !yl.words.length) continue;
                    const diff = Math.abs(yl.time - line.time);
                    if (diff < bestDiff) {
                        bestDiff = diff;
                        best = yl;
                        bestIdx = i;
                    }
                }
                if (best) {
                    usedY.add(bestIdx);
                    line.words = best.words;
                }
            }
            parsed.hasWordTimestamps = parsed.lines.some((ln) => ln.words && ln.words.length);
        }
    } else if (y) {
        parsed = y;
    }

    if (!parsed) {
        const empty = { lines: [], hasTimestamps: false, hasWordTimestamps: false };
        lyricCache.set(key, empty);
        return empty;
    }

    parsed.lines = dedupeLines(parsed.lines);

    if (tlyricText) mergeTranslation(parsed.lines, tlyricText);

    lyricCache.set(key, parsed);
    return parsed;
}

export function clearLyricCache() {
    lyricCache.clear();
}