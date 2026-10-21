import { el } from './dom.js';
import { store } from './store.js';
import { renderShareCard, sanitizeFilename } from './share-card.js';
import { getTracksBySongId, formatHistoryTime } from './history.js';

const ABOUT_STORAGE_KEY = 'mscd-about-read-version';

function getAboutReadVersion() {
    try {
        return localStorage.getItem(ABOUT_STORAGE_KEY) || '';
    } catch {
        return '';
    }
}

function setAboutReadVersion(v) {
    try {
        localStorage.setItem(ABOUT_STORAGE_KEY, String(v || ''));
    } catch {}
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderMarkdown(md) {
    const inline = (s) => {
        let out = escapeHtml(s);
        out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
        return out;
    };

    const lines = String(md || '').split(/\r?\n/);
    const out = [];
    let listOpen = false;
    let paragraph = [];

    const flushParagraph = () => {
        if (paragraph.length) {
            out.push('<p>' + paragraph.map(inline).join('<br>') + '</p>');
            paragraph = [];
        }
    };
    const flushList = () => {
        if (listOpen) {
            out.push('</ul>');
            listOpen = false;
        }
    };

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) {
            flushParagraph();
            flushList();
            continue;
        }

        const h = line.match(/^(#{1,6})\s+(.*)$/);
        if (h) {
            flushParagraph();
            flushList();
            const level = h[1].length;
            out.push(`<h${level}>${inline(h[2])}</h${level}>`);
            continue;
        }

        const li = line.match(/^[-*+]\s+(.*)$/);
        if (li) {
            flushParagraph();
            if (!listOpen) {
                out.push('<ul>');
                listOpen = true;
            }
            out.push('<li>' + inline(li[1]) + '</li>');
            continue;
        }

        paragraph.push(line);
    }

    flushParagraph();
    flushList();
    return out.join('');
}

const ICON_PATHS = {
    play: '<polygon points="6 4 20 12 6 20"/>',
    'play-next': '<polygon points="5 4 15 12 5 20"/><line x1="19" y1="5" x2="19" y2="19"/>',
    queue: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'chevron-left': '<polyline points="15 18 9 12 15 6"/>',
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    'dots-vertical': '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
    lyric: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="14" y2="18"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="1"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    'share-card': '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    'check-square': '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    'chevron-down': '<polyline points="6 9 12 15 18 9"/>',
    'folder-plus': '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>',
    not: '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
    layout: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
    package: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    'arrow-up': '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
    'external-link': '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    bug: '<path d="M7 8 H17 Q19 8 19 10 V17 Q19 21 15 21 H9 Q5 21 5 17 V10 Q5 8 7 8 Z"/><path d="M8 8 A4 4 0 0 1 16 8"/><path d="M9.5 5 6.5 2.5"/><path d="M14.5 5 17.5 2.5"/><path d="M5 9.5 2.5 7.5"/><path d="M19 9.5 21.5 7.5"/><path d="M5 14.5 H2"/><path d="M19 14.5 h3"/><path d="M5.5 19 2.5 21"/><path d="M18.5 19 21.5 21"/><path d="M12 14 V20.5"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
    locate: '<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="4"/>',
    'arrow-left': '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    'web-fullscreen': '<rect x="2" y="4" width="20" height="16" rx="2"/><rect x="5" y="8" width="14" height="8" rx="1"/>',
    fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
};

function resolveSongRowView() {
    const state = store.get();
    if (state.view !== 'search' && state.view !== 'myfavorites') return 'tile';
    return state.settings.songView || 'tile';
}

function formatPlayCount(n) {
    const num = Number(n) || 0;
    if (num >= 100000000) {
        return (num / 100000000).toFixed(1).replace(/\.0$/, '') + '亿';
    }
    if (num >= 10000) {
        return (num / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    }
    return String(num);
}

function formatMvDuration(sec) {
    if (!sec || !isFinite(sec) || isNaN(sec)) return '';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSongDuration(sec) {
    if (!sec || !isFinite(sec) || isNaN(sec)) return '-';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function detailWikiField(song, key) {
    const state = store.get();
    const map = state.wikiMap;
    const entry = map instanceof Map ? map.get(String(song.id)) : null;
    if (!entry) return '加载中…';
    if (key === 'publishDate') {
        if (!entry.__publishFetched) return '加载中…';
        return entry.publishDate ? String(entry.publishDate) : '-';
    }
    if (!entry.__summaryFetched) return '加载中…';
    if (key === 'bpm') {
        const v = Number(entry.bpm);
        return (v > 0) ? String(v) : '-';
    }
    const v = entry[key];
    if (Array.isArray(v)) return v.length ? v.join(' / ') : '-';
    return v ? String(v) : '-';
}

export function icon(name, filled = false) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    if (filled) {
        svg.setAttribute('fill', 'currentColor');
    } else {
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
    }
    svg.innerHTML = ICON_PATHS[name] || '';
    return svg;
}

function splitArtistNames(str) {
    if (!str) return [];
    return String(str).split(/\s*[\/、，,]\s*|\s*&\s*/).filter(Boolean);
}

export function resolveArtists(song) {
    if (!song) return [];
    if (Array.isArray(song.artists) && song.artists.length) {
        return song.artists
            .map(a => ({ id: String(a && a.id ? a.id : ''), name: a && a.name ? a.name : '' }))
            .filter(a => a.name);
    }
    return splitArtistNames(song.artist).map(name => ({ id: '', name }));
}

function openEntity(ctx, kind, id, name) {
    if (!ctx || !ctx.searchActions) return;
    if (id) {
        if (kind === 'artist') ctx.searchActions.openArtist(id);
        else if (kind === 'album') ctx.searchActions.openAlbumById(id);
        return;
    }
    if (!name) return;
    const type = kind === 'artist' ? '100' : '10';
    ctx.searchActions.go(name, type, 1);
}

const entityIdCache = new Map();

async function resolveEntityId(ctx, kind, name, song) {
    if (!ctx || !ctx.api || !name) return '';
    const netease = ctx.api.adapters && ctx.api.adapters.netease;
    if (!netease || typeof netease.request !== 'function') return '';

    const cacheKey = kind + ':' + (song && song.id ? song.id : '') + ':' + name;
    if (entityIdCache.has(cacheKey)) return entityIdCache.get(cacheKey);

    let found = '';

    if (song && song.id) {
        try {
            const data = await netease.request('/song/detail', { ids: String(song.id) });
            const ds = data && data.songs && data.songs[0];
            if (ds) {
                if (kind === 'artist') {
                    const ar = Array.isArray(ds.ar) ? ds.ar : [];
                    if (ar.length === 1 && ar[0] && ar[0].id) {
                        found = String(ar[0].id);
                    } else {
                        const exact = ar.find(a => a && a.name === name);
                        if (exact && exact.id) found = String(exact.id);
                    }
                } else if (kind === 'album') {
                    const al = ds.al || ds.album;
                    if (al && al.id) found = String(al.id);
                }
            }
        } catch {}
    }

    if (!found) {
        try {
            const type = kind === 'artist' ? 100 : 10;
            const data = await netease.request('/cloudsearch', { keywords: name, type, limit: 5 });
            const r = data && data.result;
            if (r) {
                if (kind === 'artist') {
                    const list = r.artists || [];
                    const exact = list.find(a => a && a.name === name) || list[0];
                    if (exact && exact.id) found = String(exact.id);
                } else if (kind === 'album') {
                    const list = r.albums || [];
                    const exact = list.find(a => a && a.name === name) || list[0];
                    if (exact && exact.id) found = String(exact.id);
                }
            }
        } catch {}
    }

    entityIdCache.set(cacheKey, found);
    return found;
}

function buildEntityLink(ctx, kind, id, name, song) {
    const hasId = !!id;
    const link = el('span', {
        class: 'entity-link' + (hasId ? '' : ' is-search'),
        text: name,
    });
    link.setAttribute('role', 'link');
    link.setAttribute('tabindex', '0');

    let busy = false;
    async function go(e) {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }
        if (!ctx || !ctx.searchActions || busy) return;
        if (id) {
            if (kind === 'artist') ctx.searchActions.openArtist(id);
            else if (kind === 'album') ctx.searchActions.openAlbumById(id);
            return;
        }
        busy = true;
        try {
            const resolved = await resolveEntityId(ctx, kind, name, song);
            if (resolved) {
                if (kind === 'artist') ctx.searchActions.openArtist(resolved);
                else ctx.searchActions.openAlbumById(resolved);
                return;
            }
        } catch {}
        busy = false;
        if (kind === 'artist') ctx.searchActions.go(name, '100', 1);
        else ctx.searchActions.go(name, '10', 1);
    }

    link.addEventListener('click', go);
    link.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') go(e);
    });
    return link;
}

export function renderArtistInto(container, song, ctx, fallback = '未知歌手') {
    container.textContent = '';
    const artists = resolveArtists(song);
    if (!artists.length) {
        container.textContent = fallback;
        return;
    }
    artists.forEach((a, i) => {
        if (i > 0) container.appendChild(document.createTextNode(' / '));
        container.appendChild(buildEntityLink(ctx, 'artist', a.id, a.name, song));
    });
}

export function renderAlbumInto(container, song, ctx, fallback = '') {
    container.textContent = '';
    const name = song && song.album ? String(song.album) : '';
    if (!name) {
        if (fallback) container.textContent = fallback;
        return;
    }
    container.appendChild(buildEntityLink(ctx, 'album', song.albumId || '', name, song));
}

export function buildAlbumNode(song, ctx, className = 'song-album', prefix = '') {
    const wrap = el('span', className ? { class: className } : {});
    const name = song && song.album ? String(song.album) : '';
    if (!name) {
        wrap.textContent = prefix ? prefix.trim() : '未知专辑';
        return wrap;
    }
    if (prefix) wrap.appendChild(document.createTextNode(prefix));
    wrap.appendChild(buildEntityLink(ctx, 'album', song.albumId || '', name, song));
    return wrap;
}

export function copyText(text) {
    const str = String(text || '');
    if (!str) return Promise.resolve(false);

    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(str).then(() => true).catch(() => fallbackCopy(str));
    }
    return Promise.resolve(fallbackCopy(str));
}

function fallbackCopy(text) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}

export function shareSong(song) {
    if (!song || !song.id) {
        Toast('该歌曲暂不支持分享', 'warning', 1600);
        return;
    }

    const base = window.location.origin + window.location.pathname;
    const url = base + '#/song/' + encodeURIComponent(song.id);
    const title = song.title || '未知歌曲';
    const artist = song.artist || '未知歌手';
    const text = `【分享音乐 ${title} - ${artist}】${url}`;

    copyText(text).then((ok) => {
        if (ok) Toast('已复制分享信息', 'success', 1600);
        else Toast('复制失败', 'danger', 1600);
    });
}

export function openShareCardModal(song) {
    if (!song || !song.id) {
        Toast('该歌曲暂不支持生成分享图', 'warning', 1600);
        return;
    }

    const account = store.get().account;
    const username = account.connected && account.nickname ? account.nickname : '匿名用户';
    const shareUrl = window.location.origin + window.location.pathname + '#/song/' + encodeURIComponent(song.id);

    const preview = el('div', { class: 'share-card-modal__preview' });
    const loading = el('div', { class: 'share-card-modal__loading' },
        el('div', { class: 'loading-bars' },
            el('span'), el('span'), el('span')
        ),
        el('p', { text: '正在生成分享图…' })
    );
    preview.appendChild(loading);

    const body = el('div', { class: 'share-card-modal' }, preview);

    let blobRef = null;
    let blobUrl = '';

    const filename = sanitizeFilename(`${song.title || '分享'} - ${song.artist || '未知歌手'}`) + '.png';

    async function enrichSong(s) {
        if (s.album) return s;
        const app = typeof window !== 'undefined' ? window.__app : null;
        if (!app || !app.api || typeof app.api.song !== 'function') return s;
        try {
            const detail = await app.api.song(s.id);
            if (detail && detail.album) {
                return { ...s, album: detail.album };
            }
        } catch {}
        return s;
    }

    (async () => {
        const enriched = await enrichSong(song);
        const blob = await renderShareCard(enriched, { username, shareUrl });
        blobRef = blob;
        blobUrl = URL.createObjectURL(blob);
        const img = document.createElement('img');
        img.src = blobUrl;
        img.alt = '分享图预览';
        preview.innerHTML = '';
        preview.appendChild(img);
    })().catch((err) => {
        preview.innerHTML = '';
        preview.appendChild(el('div', { class: 'share-card-modal__loading' },
            el('p', { text: '生成失败：' + (err.message || '未知错误') })
        ));
    });

    function saveBlob() {
        if (!blobRef || !blobUrl) {
            Toast('图片还在生成中，请稍候', 'warning', 1600);
            return;
        }
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        Toast('已保存分享图', 'success', 1600);
    }

    async function shareOrSaveBlob() {
        if (!blobRef || !blobUrl) {
            Toast('图片还在生成中，请稍候', 'warning', 1600);
            return;
        }

        const file = new File([blobRef], filename, { type: 'image/png' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({
                    files: [file],
                    title: song.title || '分享歌曲',
                    text: `${song.title || ''} - ${song.artist || ''}`,
                });
                return;
            } catch (err) {
                if (err && err.name === 'AbortError') return;
            }
        }

        saveBlob();
    }

    openModal({
        title: '分享图片',
        body,
        confirmText: '保存图片',
        cancelText: '关闭',
        onConfirm: () => {
            shareOrSaveBlob();
            return false;
        },
        onCancel: () => {
            if (blobUrl) {
                URL.revokeObjectURL(blobUrl);
                blobUrl = '';
            }
        },
    });
}

export function closeAllMenus() {
    document.querySelectorAll('.song-menu.is-open').forEach((m) => {
        m.classList.remove('is-open');
        const row = m.closest('.song-row');
        if (row) row.classList.remove('has-menu-open');
        const card = m.closest('.mv-card');
        if (card) card.classList.remove('has-menu-open');
    });
}

function makeActionButton(name, title, danger, onClick) {
    const btn = el('button', {
        class: `song-action${danger ? ' song-action--danger' : ''}`,
        title,
    }, icon(name));

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });

    return btn;
}

export function openHistoryModal(song, ctx) {
    if (!song || !song.id) return;
    const body = el('div', { class: 'history-modal' });
    const listWrap = el('div', { class: 'history-modal__list' });
    const emptyEl = el('div', { class: 'history-modal__empty', text: '加载中…' });
    body.appendChild(emptyEl);
    body.appendChild(listWrap);

    openModal({
        title: '下载历史',
        body,
        showCancel: false,
        confirmText: '关闭',
    });

    getTracksBySongId(song.id).then((tracks) => {
        if (!tracks.length) {
            emptyEl.textContent = '暂无下载记录';
            return;
        }
        emptyEl.remove();
        const KIND_LABEL = { audio: '音频', lyric: '歌词', mv: 'MV' };
        const QUALITY_LABEL = { 128: '标准', 192: '较高', 320: 'HQ', 2000: '无损' };
        for (const tr of tracks) {
            const item = el('div', { class: 'history-modal__item' });
            const head = el('div', { class: 'history-modal__head' });
            head.appendChild(el('span', { class: 'history-modal__kind', text: KIND_LABEL[tr.kind] || tr.kind }));
            if (tr.kind === 'audio' && tr.quality) {
                head.appendChild(el('span', { class: 'history-modal__quality', text: QUALITY_LABEL[Number(tr.quality)] || (tr.quality + 'k') }));
            } else if (tr.kind === 'mv' && tr.quality) {
                head.appendChild(el('span', { class: 'history-modal__quality', text: Number(tr.quality) + 'P' }));
            }
            head.appendChild(el('span', { class: 'history-modal__time', text: formatHistoryTime(tr.finishedAt) }));
            item.appendChild(head);
            const pathText = tr.dirName ? (tr.dirName + ' / ' + (tr.filename || '')) : (tr.filename || '');
            if (pathText) {
                item.appendChild(el('div', { class: 'history-modal__path', text: pathText }));
            }
            listWrap.appendChild(item);
        }
    }).catch(() => {
        emptyEl.textContent = '加载历史失败';
    });
}

export function SongRow(song, handlers = {}) {
    const {
        ctx,
        onPlay, onPlayNext, onAddDownloadList, onDownloadNow, onDownloadLyric, onRemove, onEdit,
        selectable, selected, onToggleSelect,
        hidePlayNextMenu,
        onDownloadMv,
        contentBadges,
        viewOverride,
        showIndex,
        index,
        showDuration,
    } = handlers;

    const coverEl = el('div', { class: 'song-cover' });
    if (song.pic) {
        const img = el('img', { src: song.pic, alt: '', loading: 'lazy' });
        img.addEventListener('error', () => {
            coverEl.innerHTML = '';
            coverEl.appendChild(icon('music'));
        });
        coverEl.appendChild(img);
    } else {
        coverEl.appendChild(icon('music'));
    }
    coverEl.appendChild(el('div', { class: 'song-cover-overlay' }, icon('play', true)));

    const bars = el('div', { class: 'song-playing-bars' },
        el('span'), el('span'), el('span'), el('span')
    );

    const actionsEl = el('div', { class: 'song-actions' });
    if (onEdit) {
        actionsEl.appendChild(makeActionButton('edit', '编辑下载设置', false, () => onEdit(song)));
    }
    if (onDownloadNow) {
        actionsEl.appendChild(makeActionButton('download', '直接下载', false, () => onDownloadNow(song)));
    }
    if (onRemove) {
        actionsEl.appendChild(makeActionButton('trash', '移除', true, () => onRemove(song)));
    }

    const menuItems = [];
    if (onPlayNext && !hidePlayNextMenu) {
        menuItems.push({ icon: 'play-next', filled: true, text: '下一首播放', handler: onPlayNext });
    }
    if (onAddDownloadList) {
        menuItems.push({ icon: 'plus', text: '添加下载队列', handler: onAddDownloadList });
    }
    if (onDownloadLyric) {
        menuItems.push({ icon: 'lyric', text: '下载歌词', handler: onDownloadLyric });
    }
    if (onDownloadMv && song.mv && String(song.mv) !== '0') {
        menuItems.push({ icon: 'video', text: '下载 MV', handler: onDownloadMv });
    }
    if (song.id) {
        menuItems.push({
            icon: 'clock',
            text: '下载历史',
            handler: (s) => openHistoryModal(s, ctx),
        });
        menuItems.push({
            icon: 'copy',
            text: '复制内容 ID',
            handler: (s) => {
                copyText(s.id).then((ok) => {
                    if (ok) Toast('已复制内容 ID：' + s.id, 'success', 1600);
                    else Toast('复制失败', 'danger', 1600);
                });
            },
        });
        menuItems.push({
            icon: 'link',
            text: '分享',
            handler: (s) => shareSong(s),
        });
        menuItems.push({
            icon: 'share-card',
            text: '生成分享图',
            handler: (s) => openShareCardModal(s),
        });
    }

    const menuPanel = el('div', { class: 'song-menu-panel' });
    for (const item of menuItems) {
        const btn = el('button', {
            class: `song-menu-item${item.danger ? ' song-menu-item--danger' : ''}`,
        }, icon(item.icon, item.filled), el('span', { text: item.text }));
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllMenus();
            item.handler(song);
        });
        menuPanel.appendChild(btn);
    }

    const menuTrigger = el('button', {
        class: 'song-menu-trigger',
        title: '更多操作',
    }, icon('dots-vertical', true));

    const menuWrap = el('div', { class: 'song-menu' }, menuTrigger, menuPanel);

    if (!menuItems.length) {
        menuWrap.classList.add('hidden');
    }

    const songView = viewOverride || resolveSongRowView();
    const isDetail = songView === 'detail';
    const isGrid = songView === 'grid';
    const isList = songView === 'list';

    const badgesList = Array.isArray(contentBadges) ? contentBadges.filter(Boolean) : [];

    const row = el('div', {
        class: 'song-row' + (isDetail ? ' song-row--detail' : '') + (isGrid ? ' song-row--grid' : '') + (isList ? ' song-row--list' : ''),
        dataset: { id: song.id },
    });
    row.__song = song;

    const queueState = store.get().queue;
    const playingSong = queueState.currentIndex >= 0 ? queueState.tracks[queueState.currentIndex] : null;
    if (queueState.isPlaying && playingSong && String(playingSong.id) === String(song.id)) {
        row.classList.add('is-playing');
    }

    if (selectable) {
        const checkbox = el('label', { class: 'song-select ena-checkbox' });
        const input = el('input', { type: 'checkbox' });
        if (selected) input.checked = true;
        const box = el('span', { class: 'box' });

        checkbox.appendChild(input);
        checkbox.appendChild(box);

        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        input.addEventListener('change', () => {
            onToggleSelect?.(song);
        });

        if (isGrid) {
            coverEl.appendChild(checkbox);
        } else {
            row.appendChild(checkbox);
        }

        if (selected) row.classList.add('is-selected');
    }

    if (isGrid) {
        coverEl.appendChild(bars);
        coverEl.appendChild(actionsEl);
        coverEl.appendChild(menuWrap);
        row.appendChild(coverEl);
        const gridArtist = el('div', { class: 'song-artist' });
        renderArtistInto(gridArtist, song, ctx, '未知歌手');
        row.appendChild(
            el('div', { class: 'song-info' },
                el('div', { class: 'song-title-row' },
                    el('span', { class: 'song-title', text: song.title || '未知歌曲' })
                ),
                gridArtist
            )
        );
    } else if (isDetail) {
        coverEl.appendChild(bars);
        row.appendChild(coverEl);
        const detailArtist = el('span', { class: 'song-artist' });
        renderArtistInto(detailArtist, song, ctx, '未知歌手');
        row.appendChild(
            el('div', { class: 'song-info' },
                el('div', { class: 'song-title-row' },
                    el('span', { class: 'song-title', text: song.title || '未知歌曲' })
                ),
                detailArtist
            )
        );
        const albumCol = el('div', { class: 'song-detail-col song-detail-col--album' });
        if (song.album) {
            albumCol.appendChild(buildAlbumNode(song, ctx, '', ''));
        } else {
            albumCol.textContent = '-';
        }
        row.appendChild(albumCol);
        row.appendChild(el('div', { class: 'song-detail-col song-detail-col--date', text: detailWikiField(song, 'publishDate') }));
        row.appendChild(el('div', { class: 'song-detail-col song-detail-col--bpm', text: detailWikiField(song, 'bpm') }));
        row.appendChild(el('div', { class: 'song-detail-col song-detail-col--genre', text: detailWikiField(song, 'genre') }));
        row.appendChild(el('div', { class: 'song-detail-col song-detail-col--duration', text: formatSongDuration(song.duration) }));
        row.appendChild(actionsEl);
        row.appendChild(menuWrap);
    } else {
        const tileArtist = el('span', { class: 'song-artist' });
        renderArtistInto(tileArtist, song, ctx, '未知歌手');

        const artistChildren = [tileArtist];
        if (badgesList.length) {
            const badgesEl = el('span', { class: 'song-badges' });
            for (const name of badgesList) {
                const badge = el('span', { class: 'song-badge' });
                badge.appendChild(icon(name));
                badgesEl.appendChild(badge);
            }
            artistChildren.push(badgesEl);
        }

        if (showIndex) {
            row.appendChild(el('span', {
                class: 'song-index',
                text: index != null ? String(index) : '',
            }));
        }

        row.appendChild(bars);
        row.appendChild(coverEl);
        row.appendChild(
            el('div', { class: 'song-info' },
                el('div', { class: 'song-title-row' },
                    el('span', { class: 'song-title', text: song.title || '未知歌曲' }),
                    song.album
                        ? buildAlbumNode(song, ctx, 'song-album', '- ')
                        : null
                ),
                el('div', { class: 'song-artist-row' }, ...artistChildren)
            )
        );
        if (showDuration || isList) {
            row.appendChild(el('span', {
                class: 'song-duration',
                text: formatSongDuration(song.duration),
            }));
        }
        row.appendChild(actionsEl);
        row.appendChild(menuWrap);
    }

    row.addEventListener('click', (e) => {
        if (e.target.closest('.song-menu')) return;
        if (e.target.closest('.song-select')) return;
        if (e.target.closest('.song-actions')) return;

        if (document.body.classList.contains('has-selection') && onToggleSelect) {
            onToggleSelect(song);
            return;
        }

        onPlay?.(song);
    });

    menuTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !menuWrap.classList.contains('is-open');
        closeAllMenus();
        if (willOpen) {
            menuWrap.classList.add('is-open');
            row.classList.add('has-menu-open');
        }
    });

    return row;
}

export function CollectionCard(item, handlers = {}) {
    const { onOpen, ctx } = handlers;

    const coverEl = el('div', { class: 'collection-card__cover' });
    if (item.pic) {
        const img = el('img', { src: item.pic, alt: '', loading: 'lazy' });
        img.addEventListener('error', () => {
            coverEl.innerHTML = '';
            coverEl.appendChild(icon('music'));
        });
        coverEl.appendChild(img);
    } else {
        coverEl.appendChild(icon('music'));
    }

    const menuPanel = el('div', { class: 'song-menu-panel' });
    const openBtn = el('button', { class: 'song-menu-item' },
        icon('play', true),
        el('span', { text: '查看详情' })
    );
    openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAllMenus();
        onOpen?.(item);
    });
    menuPanel.appendChild(openBtn);

    if (item.id) {
        const copyBtn = el('button', { class: 'song-menu-item' },
            icon('copy'),
            el('span', { text: '复制内容 ID' })
        );
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllMenus();
            copyText(item.id).then((ok) => {
                if (ok) Toast('已复制内容 ID：' + item.id, 'success', 1600);
                else Toast('复制失败', 'danger', 1600);
            });
        });
        menuPanel.appendChild(copyBtn);
    }

    const menuTrigger = el('button', {
        class: 'collection-card__more',
        title: '更多操作',
    }, icon('dots-vertical', true));

    const menuWrap = el('div', { class: 'collection-card__menu song-menu' }, menuTrigger, menuPanel);

    const isPlaylist = item._type === 'playlist';
    const desc = item._extra?.description || '';

    const infoChildren = [
        el('div', { class: 'collection-card__title', text: item.title || '未知' }),
    ];

    if (isPlaylist && desc) {
        infoChildren.push(el('div', { class: 'collection-card__desc', text: desc }));
    }

    if (isPlaylist) {
        infoChildren.push(el('div', {
            class: 'collection-card__artist',
            text: item.artist || '未知创建者',
        }));
    } else {
        const cardArtist = el('div', { class: 'collection-card__artist' });
        renderArtistInto(cardArtist, item, ctx, '未知歌手');
        infoChildren.push(cardArtist);
    }

    const card = el('div', {
            class: `collection-card collection-card--${isPlaylist ? 'playlist' : 'album'}`,
        },
        coverEl,
        el('div', { class: 'collection-card__info' }, ...infoChildren),
        menuWrap
    );

    card.addEventListener('click', (e) => {
        if (e.target.closest('.song-menu')) return;
        onOpen?.(item);
    });

    menuTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !menuWrap.classList.contains('is-open');
        closeAllMenus();
        if (willOpen) {
            menuWrap.classList.add('is-open');
        }
    });

    return card;
}

export function ArtistCard(item, handlers = {}) {
    const { onOpen } = handlers;

    const coverEl = el('div', { class: 'artist-card__cover' });
    if (item.pic) {
        const img = el('img', { src: item.pic, alt: '', loading: 'lazy' });
        img.addEventListener('error', () => {
            coverEl.innerHTML = '';
            coverEl.appendChild(icon('music'));
        });
        coverEl.appendChild(img);
    } else {
        coverEl.appendChild(icon('music'));
    }

    const infoEl = el('div', { class: 'artist-card__info' },
        el('div', { class: 'artist-card__title', text: item.title || '未知' })
    );

    if (item.artist) {
        infoEl.appendChild(el('div', { class: 'artist-card__alias', text: item.artist }));
    }

    const metaText = item._extra?.musicSize
        ? `${item._extra.musicSize} 首单曲`
        : (item._extra?.albumSize ? `${item._extra.albumSize} 张专辑` : '');
    if (metaText) {
        infoEl.appendChild(el('div', { class: 'artist-card__meta', text: metaText }));
    }

    const card = el('div', { class: 'artist-card' }, coverEl, infoEl);
    card.addEventListener('click', () => onOpen?.(item));
    return card;
}

export function MvCard(item, handlers = {}) {
    const { onOpen, ctx } = handlers;

    const coverEl = el('div', { class: 'mv-card__cover' });
    if (item.pic) {
        const img = el('img', { src: item.pic, alt: '', loading: 'lazy' });
        img.addEventListener('error', () => {
            coverEl.innerHTML = '';
            coverEl.appendChild(icon('video'));
        });
        coverEl.appendChild(img);
    } else {
        coverEl.appendChild(icon('video'));
    }

    coverEl.appendChild(el('div', { class: 'mv-card__play' }, icon('play', true)));

    const badgeEl = el('div', { class: 'mv-card__badges' });
    const durText = formatMvDuration(item.duration);
    if (durText) {
        badgeEl.appendChild(el('span', { class: 'mv-card__badge', text: durText }));
    }
    const playCount = item._extra && item._extra.playCount ? Number(item._extra.playCount) : 0;
    if (playCount > 0) {
        const playBadge = el('span', { class: 'mv-card__badge mv-card__badge--play' });
        const playIcon = icon('play', true);
        playIcon.setAttribute('class', 'mv-card__badge-icon');
        playBadge.appendChild(playIcon);
        playBadge.appendChild(document.createTextNode(formatPlayCount(playCount)));
        badgeEl.appendChild(playBadge);
    }
    coverEl.appendChild(badgeEl);

    const menuPanel = el('div', { class: 'song-menu-panel' });
    if (item.mv) {
        const dlBtn = el('button', { class: 'song-menu-item' },
            icon('download'),
            el('span', { text: '下载 MV' })
        );
        dlBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllMenus();
            if (ctx && ctx.openMvDownloadOptionsModal) {
                ctx.openMvDownloadOptionsModal(item, ctx, 'now');
            }
        });
        menuPanel.appendChild(dlBtn);
    }

    if (item.id) {
        const copyBtn = el('button', { class: 'song-menu-item' },
            icon('copy'),
            el('span', { text: '复制内容 ID' })
        );
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllMenus();
            copyText(item.id).then((ok) => {
                if (ok) Toast('已复制内容 ID：' + item.id, 'success', 1600);
                else Toast('复制失败', 'danger', 1600);
            });
        });
        menuPanel.appendChild(copyBtn);

        const shareBtn = el('button', { class: 'song-menu-item' },
            icon('link'),
            el('span', { text: '复制链接' })
        );
        shareBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllMenus();
            const url = window.location.origin + window.location.pathname + '#/mv/' + encodeURIComponent(item.id);
            copyText(url).then((ok) => {
                if (ok) Toast('已复制链接', 'success', 1600);
                else Toast('复制失败', 'danger', 1600);
            });
        });
        menuPanel.appendChild(shareBtn);
    }

    const menuTrigger = el('button', {
        class: 'mv-card__more',
        title: '更多操作',
    }, icon('dots-vertical', true));
    const menuWrap = el('div', { class: 'mv-card__menu song-menu' }, menuTrigger, menuPanel);

    const infoChildren = [
        el('div', { class: 'mv-card__title', text: item.title || '未知 MV' }),
    ];
    if (item.artist) {
        const artistLine = el('div', { class: 'mv-card__artist' });
        renderArtistInto(artistLine, item, ctx, '未知艺人');
        infoChildren.push(artistLine);
    }
    const desc = item._extra && item._extra.briefDesc ? String(item._extra.briefDesc) : '';
    if (desc) {
        infoChildren.push(el('div', { class: 'mv-card__desc', text: desc }));
    }

    const card = el('div', { class: 'mv-card' },
        coverEl,
        el('div', { class: 'mv-card__info' }, ...infoChildren),
        menuWrap
    );

    card.addEventListener('click', (e) => {
        if (e.target.closest('.song-menu')) return;
        if (e.target.closest('.mv-card__more')) return;
        onOpen?.(item);
    });

    menuTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = !menuWrap.classList.contains('is-open');
        closeAllMenus();
        if (willOpen) {
            menuWrap.classList.add('is-open');
            card.classList.add('has-menu-open');
        }
    });

    return card;
}

let sharedAccountMenu = null;

if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
        if (sharedAccountMenu && !sharedAccountMenu.contains(e.target)) {
            sharedAccountMenu.classList.remove('is-open');
        }
    });
}

export function openAboutModal(ctx, options = {}) {
    const about = (ctx && ctx.config && ctx.config.about) || {};
    const version = String(about.version || '');
    const body = el('div', { class: 'about-modal' });
    body.innerHTML = renderMarkdown(about.content || '');

    if (!options.silent) setAboutReadVersion(version);

    const ref = openModal({
        title: '关于本站',
        body,
        showCancel: false,
        confirmText: '我知道了',
        onConfirm: () => {
            setAboutReadVersion(version);
        },
    });
    return ref;
}

export function shouldShowAbout(cfg) {
    const about = (cfg && cfg.about) || {};
    const version = String(about.version || '');
    if (!version || !about.content) return false;
    return getAboutReadVersion() !== version;
}

export function AccountButton({ account, onConnect, onDisconnect, onOpenAbout }) {
    if (!account || !account.connected) {
        if (sharedAccountMenu) sharedAccountMenu.classList.remove('is-open');
        const btn = el('button', {
            class: 'ena-btn ena-btn--sm account-btn',
            title: '连接网易云账户',
        }, icon('user'), el('span', { text: '连接账户' }));
        btn.addEventListener('click', onConnect);
        return btn;
    }

    if (!sharedAccountMenu) {
        sharedAccountMenu = el('div', { class: 'account-menu', id: 'account-menu' });
        document.body.appendChild(sharedAccountMenu);
    }
    sharedAccountMenu.innerHTML = '';

    const avatarEl = el('span', { class: 'account-btn__avatar' });
    if (account.avatarUrl) {
        const img = el('img', { src: account.avatarUrl, alt: '' });
        img.addEventListener('error', () => {
            avatarEl.innerHTML = '';
            avatarEl.appendChild(icon('user'));
        });
        avatarEl.appendChild(img);
    } else {
        avatarEl.appendChild(icon('user'));
    }

    const btn = el('button', {
        class: 'ena-btn ena-btn--sm account-btn account-btn--connected',
        title: account.nickname || '已连接',
    }, avatarEl, el('span', { class: 'account-btn__name', text: account.nickname || '已连接' }));

    const disconnectBtn = el('button', { class: 'account-menu__item' },
        icon('log-out'),
        el('span', { text: '断开连接' })
    );
    disconnectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sharedAccountMenu.classList.remove('is-open');
        onDisconnect();
    });
    sharedAccountMenu.appendChild(disconnectBtn);

    const bugBtn = el('button', { class: 'account-menu__item' },
        icon('bug'),
        el('span', { text: '汇报 Bug' })
    );
    bugBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sharedAccountMenu.classList.remove('is-open');
        window.open('https://github.com/ENA-QWQ/Mscd/issues', '_blank', 'noopener,noreferrer');
    });
    sharedAccountMenu.appendChild(bugBtn);

    const aboutBtn = el('button', { class: 'account-menu__item' },
        icon('info'),
        el('span', { text: '关于本站' })
    );
    aboutBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sharedAccountMenu.classList.remove('is-open');
        onOpenAbout?.();
    });
    sharedAccountMenu.appendChild(aboutBtn);

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = btn.getBoundingClientRect();
        sharedAccountMenu.style.top = `${rect.bottom + 6}px`;
        sharedAccountMenu.style.right = `${window.innerWidth - rect.right}px`;
        sharedAccountMenu.classList.toggle('is-open');
    });

    return btn;
}

export function EmptyState(message, iconName = 'music') {
    return el('div', { class: 'empty-state' },
        icon(iconName),
        el('p', { text: message })
    );
}

export function LoadingState(message = '加载中…') {
    return el('div', { class: 'loading-state' },
        el('div', { class: 'loading-bars' },
            el('span'), el('span'), el('span')
        ),
        el('p', { text: message })
    );
}

export function ErrorState(message, onRetry) {
    const retryBtn = el('button', { class: 'ena-btn ena-btn--sm' }, icon('refresh'), '重试');
    retryBtn.addEventListener('click', () => onRetry?.());
    return el('div', { class: 'error-state' },
        icon('info'),
        el('p', { text: message }),
        retryBtn
    );
}

export function Pagination({ page, totalPages, onPage }) {
    const wrap = el('div', { class: 'pagination' });

    const hasTotal = Number.isFinite(totalPages) && totalPages > 1;
    const safePage = Math.max(1, Math.floor(page) || 1);

    const prevBtn = el('button', { class: 'ena-btn ena-btn--sm', text: '上一页' });
    if (safePage <= 1) {
        prevBtn.classList.add('is-disabled');
    } else {
        prevBtn.addEventListener('click', () => onPage(safePage - 1));
    }
    wrap.appendChild(prevBtn);

    const pagesWrap = el('div', { class: 'pagination-pages' });

    if (hasTotal) {
        const items = [];
        if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) items.push(i);
        } else {
            items.push(1);
            const from = Math.max(2, safePage - 1);
            const to = Math.min(totalPages - 1, safePage + 1);
            if (from > 2) items.push('…');
            for (let i = from; i <= to; i++) items.push(i);
            if (to < totalPages - 1) items.push('…');
            items.push(totalPages);
        }

        for (const it of items) {
            if (it === '…') {
                pagesWrap.appendChild(el('span', { class: 'pagination-ellipsis', text: '…' }));
            } else {
                const cls = `pagination-page${it === safePage ? ' is-active' : ''}`;
                const btn = el('button', { class: cls, text: String(it) });
                if (it !== safePage) {
                    btn.addEventListener('click', () => onPage(it));
                }
                pagesWrap.appendChild(btn);
            }
        }
    } else {
        pagesWrap.appendChild(el('span', {
            class: 'pagination-info',
            text: `第 ${safePage} 页`,
        }));
    }
    wrap.appendChild(pagesWrap);

    const nextBtn = el('button', { class: 'ena-btn ena-btn--sm', text: '下一页' });
    if (hasTotal && safePage >= totalPages) {
        nextBtn.classList.add('is-disabled');
    } else {
        nextBtn.addEventListener('click', () => onPage(safePage + 1));
    }
    wrap.appendChild(nextBtn);

    return wrap;
}

export function Toast(message, type = 'success', duration = 2600) {
    const root = document.getElementById('toast-root');
    if (!root) return;

    const line = el('span', { class: 'ena-toast__line' });
    const body = el('span', { class: 'ena-toast__body', text: message });
    const toast = el('div', { class: `ena-toast ena-toast--${type}` }, line, body);
    const item = el('div', { class: 'ena-toast-wrap-item' }, toast);

    root.appendChild(item);

    const LINE_IN = 220;
    const SLIDE = 320;
    const OUT = 320;
    const COLLAPSE = 220;
    const FOLD = 300;

    requestAnimationFrame(() => {
        toast.classList.add('is-in');
        setTimeout(() => toast.classList.add('is-expand'), LINE_IN);
    });

    setTimeout(() => {
        toast.classList.remove('is-expand');
        toast.classList.add('is-out');

        setTimeout(() => {
            toast.classList.add('is-collapse');
        }, OUT);

        setTimeout(() => {
            const h = item.offsetHeight;
            item.style.maxHeight = h + 'px';
            void item.offsetHeight;
            item.style.maxHeight = '0px';
            item.style.marginBottom = '0px';
            item.style.overflow = 'hidden';

            setTimeout(() => {
                item.remove();
            }, FOLD);
        }, OUT + COLLAPSE);
    }, LINE_IN + SLIDE + duration);
}

export function openModal({ title, body, confirmText = '确认', cancelText = '取消', showCancel = true, onConfirm, onCancel, customActions = null }) {
    const root = document.getElementById('modal-root');
    if (!root) return null;

    const closeBtn = el('button', { class: 'ena-modal__close', 'aria-label': '关闭' }, icon('close'));
    const cancelBtn = el('button', { class: 'ena-btn', text: cancelText });
    const confirmBtn = el('button', { class: 'ena-btn ena-btn--primary', text: confirmText });

    const footerChildren = [];
    const customActionButtons = [];
    const hasCustom = Array.isArray(customActions) && customActions.length > 0;
    if (showCancel) footerChildren.push(cancelBtn);
    if (hasCustom) {
        for (const action of customActions) {
            const btn = el('button', {
                class: 'ena-btn' + (action.primary ? ' ena-btn--primary' : ''),
                text: action.text,
            });
            btn.addEventListener('click', () => {
                const result = action.onClick?.();
                if (result === false) return;
                close('custom');
            });
            customActionButtons.push(btn);
            footerChildren.push(btn);
        }
    } else {
        footerChildren.push(confirmBtn);
    }

    const titleEl = el('div', { class: 'ena-modal__title', text: title });
    const headerEl = el('div', { class: 'ena-modal__header' }, titleEl, closeBtn);
    const panel = el('div', { class: 'ena-modal__panel' },
        headerEl,
        el('div', { class: 'ena-modal__body' }, body),
        el('div', { class: 'ena-modal__footer' }, ...footerChildren)
    );

    const overlay = el('div', { class: 'ena-modal__overlay' });
    const modal = el('div', { class: 'ena-modal' }, overlay, panel);

    root.innerHTML = '';
    root.appendChild(modal);
    void modal.offsetHeight;
    requestAnimationFrame(() => modal.classList.add('is-open'));

    function close(fired) {
        if (fired === 'confirm') {
            const result = onConfirm?.();
            if (result === false) return;
        } else {
            onCancel?.();
        }
        document.removeEventListener('keydown', onEsc);
        modal.classList.remove('is-open');
        setTimeout(() => {
            if (root.contains(modal)) root.removeChild(modal);
        }, 320);
    }

    function onEsc(e) {
        if (e.key === 'Escape') close('cancel');
    }

    closeBtn.addEventListener('click', () => close('cancel'));
    cancelBtn.addEventListener('click', () => close('cancel'));
    overlay.addEventListener('click', () => close('cancel'));
    confirmBtn.addEventListener('click', () => close('confirm'));
    document.addEventListener('keydown', onEsc);

    return { close: () => close('cancel'), confirmBtn, cancelBtn, titleEl, headerEl, panelEl: panel, modalEl: modal, customActionButtons };
}

export function confirmDialog(message, { title = '确认', confirmText = '确认', cancelText = '取消' } = {}) {
    return new Promise((resolve) => {
        const body = el('div', { text: message });
        openModal({
            title,
            body,
            confirmText,
            cancelText,
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false),
        });
    });
}

const openDropdowns = new Set();

function closeAllDropdowns() {
    for (const d of Array.from(openDropdowns)) {
        try { d.close(); } catch {}
    }
}

if (typeof document !== 'undefined') {
    document.addEventListener('click', () => closeAllDropdowns());
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllDropdowns();
    });
    window.addEventListener('resize', () => closeAllDropdowns());
    window.addEventListener('scroll', (e) => {
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        for (const n of path) {
            if (n && n.classList && n.classList.contains('ena-dropdown__menu')) return;
        }
        const t = e.target;
        if (t && typeof t.closest === 'function' && t.closest('.ena-dropdown__menu')) return;
        closeAllDropdowns();
    }, true);
}

export function Dropdown({ options, value, onChange, className = '', title = '' }) {
    const wrap = el('div', { class: `ena-dropdown${className ? ' ' + className : ''}` });
    if (title) wrap.title = title;

    const label = el('span', { class: 'ena-dropdown__label' });
    const trigger = el('button', { class: 'ena-dropdown__trigger', type: 'button' }, label);
    wrap.appendChild(trigger);

    let currentValue = value;
    let menuEl = null;
    let isOpen = false;

    function buildMenu() {
        const m = el('div', { class: 'ena-dropdown__menu' });
        for (const opt of options) {
            const item = el('button', {
                class: 'ena-dropdown__item',
                type: 'button',
                text: opt.label,
            });
            item.dataset.value = String(opt.value);
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                close();
                if (String(opt.value) !== String(currentValue)) {
                    currentValue = opt.value;
                    sync();
                    onChange(opt.value);
                }
            });
            m.appendChild(item);
        }
        return m;
    }

    function sync() {
        const found = options.find((o) => String(o.value) === String(currentValue));
        label.textContent = found ? found.label : '';
        if (menuEl) {
            menuEl.querySelectorAll('.ena-dropdown__item').forEach((it) => {
                it.classList.toggle('is-active', it.dataset.value === String(currentValue));
            });
        }
    }

    function open() {
        closeAllDropdowns();
        if (!menuEl) {
            menuEl = buildMenu();
            document.body.appendChild(menuEl);
        }
        const rect = trigger.getBoundingClientRect();
        menuEl.style.minWidth = `${Math.max(rect.width, 140)}px`;
        menuEl.style.maxHeight = '';

        const mh = menuEl.offsetHeight;
        const mw = menuEl.offsetWidth;
        const spaceBelow = window.innerHeight - rect.bottom - 8;
        const spaceAbove = rect.top - 8;

        let left = rect.left;
        if (left + mw > window.innerWidth - 8) {
            left = Math.max(8, window.innerWidth - mw - 8);
        }

        if (spaceBelow >= mh || spaceBelow >= spaceAbove) {
            menuEl.style.top = `${rect.bottom + 4}px`;
            menuEl.style.bottom = '';
            if (mh > spaceBelow) menuEl.style.maxHeight = `${Math.max(120, spaceBelow)}px`;
        } else {
            menuEl.style.top = 'auto';
            menuEl.style.bottom = `${window.innerHeight - rect.top + 4}px`;
            menuEl.style.maxHeight = `${Math.max(120, spaceAbove)}px`;
        }

        menuEl.style.left = `${left}px`;
        wrap.classList.add('is-open');
        isOpen = true;
        openDropdowns.add(instance);
        requestAnimationFrame(() => {
            if (menuEl) menuEl.classList.add('is-open');
        });
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        wrap.classList.remove('is-open');
        if (menuEl) menuEl.classList.remove('is-open');
        openDropdowns.delete(instance);
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isOpen) close();
        else open();
    });

    function update(v) {
        currentValue = v;
        sync();
    }

    function destroy() {
        close();
        if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
        menuEl = null;
    }

    const instance = { node: wrap, update, close, destroy };

    sync();
    return instance;
}