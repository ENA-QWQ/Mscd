import { config } from './config.js';
import { Meting } from './src/api.js';
import { store } from './src/store.js';
import { resolveMode } from './src/theme.js';
import { Player } from './src/player.js';
import { Downloader } from './src/downloader.js';
import { loadLyric, findCurrentIndex } from './src/lyric.js';
import { initTooltip } from './src/tooltip.js';
import { el } from './src/dom.js';
import {
    SearchView,
    QueueView,
    DownloadsView,
    StatusView,
    SettingsView,
    MyFavoritesView,
    openParseModal,
    openDownloadOptionsModal,
    openMvDownloadOptionsModal,
    openBatchAddModal,
    handleDownloadLyric,
    runWikiForTracks,
    openConditionSelect,
} from './src/views.js';
import { Toast, closeAllMenus, AccountButton, openModal, icon, confirmDialog, Dropdown, shareSong, openShareCardModal, openAboutModal, shouldShowAbout, SongRow, renderArtistInto } from './src/components.js';
import { initRouter } from './src/router.js';
import { initWikiProgressUI, getAllWiki, collectWikiOptions } from './src/wiki.js';
import { initPlaybackView } from './src/playback-view.js';
import { initSidebarTrees } from './src/sidebar-tree.js';
import { initGlobalListGestures } from './src/list-gestures.js';
import { MVPlayer } from './src/mv-player.js';
import { AudioEffects, openAudioEffectsModal } from './src/audio-effects.js';
import { ThemeManager } from './src/theme-manager.js';

const api = new Meting(config);
const player = new Player(api, config);
const downloader = new Downloader(api, config);
const mvPlayer = new MVPlayer(api, player, store);
player.mvPlayer = mvPlayer;

const audioEffects = new AudioEffects();
audioEffects.attach(player.audio);
player.audioEffects = audioEffects;

store.applyTheme();

const MODE_ICONS = {
    shuffle: '<path fill-rule="evenodd" d="M0 3.5A.5.5 0 0 1 .5 3H1c2.202 0 3.827 1.24 4.874 2.418.49.552.865 1.102 1.126 1.532.26-.43.636-.98 1.126-1.532C9.173 4.24 10.798 3 13 3v1c-1.798 0-3.173 1.01-4.126 2.082A9.6 9.6 0 0 0 7.556 8a9.6 9.6 0 0 0 1.317 1.918C9.828 10.99 11.204 12 13 12v1c-2.202 0-3.827-1.24-4.874-2.418A10.6 10.6 0 0 1 7 9.05c-.26.43-.636.98-1.126 1.532C4.827 11.76 3.202 13 1 13H.5a.5.5 0 0 1 0-1H1c1.798 0 3.173-1.01 4.126-2.082A9.6 9.6 0 0 0 6.444 8a9.6 9.6 0 0 0-1.317-1.918C4.172 5.01 2.796 4 1 4H.5a.5.5 0 0 1-.5-.5"/><path d="M13 5.466V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192m0 9v-3.932a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192"/>',
    'repeat-one': '<path d="M11 4v1.466a.25.25 0 0 0 .41.192l2.36-1.966a.25.25 0 0 0 0-.384l-2.36-1.966a.25.25 0 0 0-.41.192V3H5a5 5 0 0 0-4.48 7.223.5.5 0 0 0 .896-.446A4 4 0 0 1 5 4zm4.48 1.777a.5.5 0 0 0-.896.446A4 4 0 0 1 11 12H5.001v-1.466a.25.25 0 0 0-.41-.192l-2.36 1.966a.25.25 0 0 0 0 .384l2.36 1.966a.25.25 0 0 0 .41-.192V13h6a5 5 0 0 0 4.48-7.223Z"/><path d="M9 5.5a.5.5 0 0 0-.854-.354l-1.75 1.75a.5.5 0 1 0 .708.708L8 6.707V10.5a.5.5 0 0 0 1 0z"/>',
    'repeat-all': '<path d="M11 5.466V4H5a4 4 0 0 0-3.584 5.777.5.5 0 1 1-.896.446A5 5 0 0 1 5 3h6V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192m3.81.086a.5.5 0 0 1 .67.225A5 5 0 0 1 11 13H5v1.466a.25.25 0 0 1-.41.192l-2.36-1.966a.25.25 0 0 1 0-.384l2.36-1.966a.25.25 0 0 1 .41.192V12h6a4 4 0 0 0 3.585-5.777.5.5 0 0 1 .225-.67Z"/>',
};

const mvFetchedIds = new Set();

async function ensureSongMv(song) {
    if (!song || !song.id) return;
    const cur = song.mv == null ? '' : String(song.mv);
    if (cur !== '' && cur !== '0') return;
    const key = String(song.id);
    if (mvFetchedIds.has(key)) return;
    mvFetchedIds.add(key);
    try {
        const netease = api.adapters && api.adapters.netease;
        const detail = netease && typeof netease.song === 'function'
            ? await netease.song(song.id)
            : await api.song(song.id);
        if (!detail) return;
        const mv = detail.mv == null ? '' : String(detail.mv);
        if (mv === '' || mv === '0') return;
        const q = store.get().queue;
        const idx = q.tracks.findIndex((t) => String(t.id) === key);
        if (idx < 0) return;
        const tracks = [...q.tracks];
        tracks[idx] = { ...tracks[idx], mv };
        store.update({ queue: { ...q, tracks } });
        store.persist();
    } catch {}
}

function formatTime(sec) {
    if (!sec || !isFinite(sec) || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function filterTracksBySearch(tracks, keyword) {
    if (!keyword) return tracks;
    const q = keyword.toLowerCase();
    return tracks.filter((song) => {
        const title = (song.title || '').toLowerCase();
        const artist = (song.artist || '').toLowerCase();
        const album = (song.album || '').toLowerCase();
        return title.includes(q) || artist.includes(q) || album.includes(q);
    });
}

const DETAIL_META_CACHE_KEY = 'meting-detail-meta';
const DETAIL_META_CACHE_MAX = 100;

let detailMetaCache = (() => {
    try {
        const raw = localStorage.getItem(DETAIL_META_CACHE_KEY);
        if (!raw) return {};
        return JSON.parse(raw) || {};
    } catch {
        return {};
    }
})();

function persistDetailMetaCache() {
    try {
        localStorage.setItem(DETAIL_META_CACHE_KEY, JSON.stringify(detailMetaCache));
    } catch {}
}

function cacheDetailMeta(kind, meta) {
    if (!kind || !meta || !meta.id) return;
    const key = `${kind}:${meta.id}`;
    detailMetaCache[key] = {
        id: meta.id,
        title: meta.title || '',
        artist: meta.artist || '',
        pic: meta.pic || '',
        trackCount: meta.trackCount || 0,
        description: meta.description || '',
    };
    const keys = Object.keys(detailMetaCache);
    if (keys.length > DETAIL_META_CACHE_MAX) {
        for (let i = 0; i < keys.length - DETAIL_META_CACHE_MAX; i++) {
            delete detailMetaCache[keys[i]];
        }
    }
    persistDetailMetaCache();
}

function getCachedDetailMeta(kind, id) {
    if (!kind || !id) return null;
    const entry = detailMetaCache[`${kind}:${id}`];
    return entry ? { ...entry } : null;
}

const SEARCH_TYPES = ['1', '10', '100', '1000'];

function emptyTypeResult() {
    return { items: [], total: 0, page: 1, loading: false, error: null, loaded: false };
}

function emptyResults() {
    const r = {};
    for (const t of SEARCH_TYPES) r[t] = emptyTypeResult();
    return r;
}

const searchActions = {
    async go(keyword, searchType, page = 1) {
        const typeKey = String(searchType);
        const isAggregate = typeKey === '0';
        const contentEl = document.getElementById('content-area');
        const prevScrollTop = contentEl ? contentEl.scrollTop : 0;

        const results = emptyResults();
        if (isAggregate) {
            for (const t of SEARCH_TYPES) results[t].loading = true;
        } else {
            results[typeKey].loading = true;
        }

        store.update({
            search: {
                keyword,
                type: typeKey,
                loading: true,
                error: null,
                detail: null,
                results,
            },
        });

        if (store.get().view !== 'search') {
            store.update({ view: 'search' });
        }

        if (isAggregate) {
            await Promise.all(SEARCH_TYPES.map(t => searchActions.loadType(keyword, t, 1)));
        } else {
            await searchActions.loadType(keyword, typeKey, page);
        }

        const cur = store.get().search;
        if (cur.keyword === keyword) {
            store.update({ search: { ...cur, loading: false } });
        }

        if (contentEl) {
            requestAnimationFrame(() => {
                contentEl.scrollTop = prevScrollTop;
            });
        }
    },

    async loadType(keyword, type, page = 1) {
        const typeKey = String(type);
        if (store.get().search.keyword !== keyword) return;

        const perPage = store.get().settings.perPage;
        const offset = (page - 1) * perPage;

        {
            const cur = store.get().search;
            const newResults = { ...cur.results };
            newResults[typeKey] = {
                ...(newResults[typeKey] || emptyTypeResult()),
                loading: true,
                error: null,
                page,
            };
            store.update({ search: { ...cur, results: newResults } });
        }

        try {
            const result = await api.search(keyword, {
                offset,
                limit: perPage,
                searchType: Number(typeKey),
            });

            if (store.get().search.keyword !== keyword) return;

            const cur = store.get().search;
            const newResults = { ...cur.results };
            newResults[typeKey] = {
                items: result.items || [],
                total: result.total || 0,
                page,
                loading: false,
                error: null,
                loaded: true,
            };
            store.update({ search: { ...cur, results: newResults } });
        } catch (err) {
            if (store.get().search.keyword !== keyword) return;

            const cur = store.get().search;
            const newResults = { ...cur.results };
            newResults[typeKey] = {
                ...(newResults[typeKey] || emptyTypeResult()),
                loading: false,
                error: err.message || '搜索失败',
            };
            store.update({ search: { ...cur, results: newResults } });
        }
    },

    switchTab(typeKey) {
        typeKey = String(typeKey);
        const cur = store.get().search;
        if (cur.type === typeKey) return;

        store.update({ search: { ...cur, type: typeKey } });

        if (typeKey === '0') {
            for (const t of SEARCH_TYPES) {
                const r = cur.results[t];
                if (r && (r.loaded || r.loading)) continue;
                searchActions.loadType(cur.keyword, t, 1);
            }
        } else {
            const r = cur.results[typeKey];
            if (!r || (!r.loaded && !r.loading)) {
                searchActions.loadType(cur.keyword, typeKey, 1);
            }
        }
    },

    resetToHome() {
        const input = document.getElementById('search-input');
        if (input) input.value = '';
        store.update({
            search: {
                keyword: '',
                type: '1',
                page: 1,
                total: 0,
                results: emptyResults(),
                selected: new Set(),
                loading: false,
                error: null,
                detail: null,
            },
        });
    },

    async openDetail(kind, meta, options = {}) {
        if (meta.title && meta.title !== '加载中…') cacheDetailMeta(kind, meta);
        const s = store.get().search;
        const keepPrevDetail = options.keepPrevDetail === true;
        const prevDetail = keepPrevDetail
            ? s.detail?.prevDetail
            : (s.detail && s.detail.kind === 'artist' ? s.detail : null);

        store.update({
            search: {
                ...s,
                detail: {
                    kind,
                    id: meta.id,
                    title: meta.title,
                    artist: meta.artist,
                    artists: meta.artists || [],
                    pic: meta.pic || '',
                    trackCount: meta.trackCount || 0,
                    description: meta.description || '',
                    tracks: [],
                    page: 1,
                    loading: true,
                    error: null,
                    prevDetail,
                },
            },
        });

        if (store.get().view !== 'search') {
            store.update({ view: 'search' });
        }

        try {
            const tracks = options.preloadedTracks || (
                kind === 'playlist'
                    ? await api.playlist(meta.id)
                    : await api.album(meta.id)
            );
            const cur = store.get().search;
            if (!cur.detail || cur.detail.id !== meta.id) return;
            const updated = { ...cur.detail, tracks, loading: false };
            if (!updated.title || updated.title === '加载中…') {
                if (kind === 'album') {
                    if (tracks.length) {
                        const first = tracks[0];
                        updated.title = first.album || '未知专辑';
                        updated.artist = first.artist || '';
                        updated.artists = first.artists || [];
                        updated.pic = first.pic || '';
                        updated.trackCount = tracks.length;
                    } else {
                        updated.title = '未知专辑';
                    }
                } else {
                    updated.title = '歌单';
                    if (tracks.length) {
                        updated.pic = updated.pic || tracks[0].pic || '';
                        updated.trackCount = tracks.length;
                    }
                }
            }
            if (updated.title && updated.title !== '加载中…') {
                cacheDetailMeta(kind, {
                    id: updated.id,
                    title: updated.title,
                    artist: updated.artist,
                    artists: updated.artists || [],
                    pic: updated.pic,
                    trackCount: updated.trackCount || tracks.length,
                    description: updated.description || '',
                });
            }
            store.update({
                search: { ...cur, detail: updated },
            });
        } catch (err) {
            const cur = store.get().search;
            if (!cur.detail || cur.detail.id !== meta.id) return;
            store.update({
                search: {
                    ...cur,
                    detail: {
                        ...cur.detail,
                        loading: false,
                        error: err.message || '加载失败',
                    },
                },
            });
        }
    },

    async openArtist(id, meta = {}) {
        const cached = getCachedDetailMeta('artist', id);
        const merged = {
            id,
            title: meta.title || cached?.title || '',
            artist: meta.artist || cached?.artist || '',
            pic: meta.pic || cached?.pic || '',
        };
        cacheDetailMeta('artist', merged);

        const s = store.get().search;
        store.update({
            search: {
                ...s,
                detail: {
                    kind: 'artist',
                    id,
                    name: merged.title,
                    title: merged.title,
                    pic: merged.pic,
                    alias: merged.artist,
                    briefDesc: '',
                    albumSize: meta._extra?.albumSize || 0,
                    musicSize: meta._extra?.musicSize || 0,
                    tracks: [],
                    albums: [],
                    view: 'overview',
                    hotSongsPage: 1,
                    albumsPage: 1,
                    loading: true,
                    error: null,
                    prevDetail: s.detail || null,
                },
            },
        });

        if (store.get().view !== 'search') {
            store.update({ view: 'search' });
        }

        try {
            const [info, songsResult, albumsResult] = await Promise.all([
                api.artistDetail(id),
                api.artistSongs(id, { limit: 50 }),
                api.artistAlbums(id, { limit: 50 }),
            ]);
            const cur = store.get().search;
            if (!cur.detail || cur.detail.id !== id || cur.detail.kind !== 'artist') return;
            store.update({
                search: {
                    ...cur,
                    detail: {
                        ...cur.detail,
                        name: info.name || meta.title || '',
                        pic: info.pic || meta.pic || '',
                        alias: info.alias || meta.artist || '',
                        briefDesc: info.briefDesc || '',
                        albumSize: info.albumSize || 0,
                        musicSize: info.musicSize || 0,
                        tracks: songsResult.songs,
                        albums: albumsResult.albums,
                        albumsTotal: albumsResult.total,
                        loading: false,
                    },
                },
            });
        } catch (err) {
            const cur = store.get().search;
            if (!cur.detail || cur.detail.id !== id || cur.detail.kind !== 'artist') return;
            store.update({
                search: {
                    ...cur,
                    detail: { ...cur.detail, loading: false, error: err.message || '加载失败' },
                },
            });
        }
    },

    async openAlbumById(id) {
        const cached = getCachedDetailMeta('album', id);
        if (cached && cached.title && cached.title !== '加载中…') {
            return searchActions.openDetail('album', cached);
        }
        return searchActions.openDetail('album', {
            id,
            title: '加载中…',
            artist: '',
            artists: [],
            pic: '',
            trackCount: 0,
            description: '',
        });
    },

    async openPlaylistById(id) {
        let meta = getCachedDetailMeta('playlist', id);
        try {
            if (meta) throw null;
            const netease = api.adapters && api.adapters.netease;
            const info = netease && typeof netease.playlistInfo === 'function'
                ? await netease.playlistInfo(id)
                : await api.playlistInfo(id);
            if (info) {
                meta = {
                    id,
                    title: info.title,
                    artist: info.artist,
                    pic: info.pic,
                    trackCount: info._extra?.trackCount || 0,
                    description: info._extra?.description || '',
                };
            }
        } catch {}

        if (!meta) {
            try {
                const tracks = await api.playlist(id);
                meta = {
                    id,
                    title: '歌单',
                    artist: '',
                    pic: '',
                    trackCount: tracks.length,
                    description: '',
                };
            } catch {}
        }

        if (!meta) {
            meta = { id, title: '未知歌单', artist: '', pic: '', trackCount: 0, description: '' };
        }

        return searchActions.openDetail('playlist', meta);
    },
};

const ctx = { api, store, player, downloader, config, searchActions, mvPlayer };

const themeManager = new ThemeManager({ store, config });
ctx.themeManager = themeManager;
window.__themeManager = themeManager;
ctx.openParseModal = () => openParseModal(ctx);
ctx.openBatchAddModal = (songs, mode) => openBatchAddModal(songs, ctx, mode);

function bindSidebar() {
    const nav = document.getElementById('side-nav');
    if (!nav) return;

    nav.addEventListener('click', (e) => {
        const link = e.target.closest('a[data-view]');
        if (!link) return;
        e.preventDefault();
        store.update({ view: link.dataset.view });
    });

    store.subscribe((state) => {
        nav.querySelectorAll('a[data-view]').forEach((a) => {
            a.classList.toggle('is-active', a.dataset.view === state.view);
        });
    });
}

function bindSearchBar() {
    const input = document.getElementById('search-input');
    const modeHost = document.getElementById('search-mode');
    const searchBtn = document.getElementById('search-btn');
    if (!input || !searchBtn) return;

    const SEARCH_MODE_OPTIONS = [
        { value: '0', label: '综合' },
        { value: '1', label: '单曲' },
        { value: '10', label: '专辑' },
        { value: '100', label: '歌手' },
        { value: '1000', label: '歌单' },
    ];

    let searchMode = '0';

    if (modeHost) {
        const dropdown = Dropdown({
            options: SEARCH_MODE_OPTIONS,
            value: searchMode,
            title: '搜索类型',
            onChange: (v) => {
                searchMode = v;
            },
        });
        modeHost.appendChild(dropdown.node);
    }

    function trigger() {
        const keyword = input.value.trim();
        if (!keyword) {
            Toast('请输入搜索关键词', 'warning', 1600);
            return;
        }
        searchActions.go(keyword, searchMode, 1);
    }

    searchBtn.addEventListener('click', trigger);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            trigger();
        }
    });
}

function bindBackButton() {
    const backBtn = document.getElementById('back-btn');
    if (!backBtn) return;

    backBtn.addEventListener('click', () => {
        const s = store.get().search;
        if (!s.detail && !s.keyword) return;

        const depth = (window.history.state && window.history.state.__depth) || 0;
        if (depth > 0) {
            window.history.back();
            return;
        }

        if (s.detail) {
            if (s.detail.prevDetail) {
                store.update({ search: { ...s, detail: s.detail.prevDetail } });
            } else {
                store.update({ search: { ...s, detail: null } });
            }
            return;
        }

        if (s.keyword) {
            searchActions.resetToHome();
        }
    });

    store.subscribe((state) => {
        const s = state.search;
        const show = state.view === 'search' && (!!s.detail || !!s.keyword);
        backBtn.classList.toggle('hidden', !show);
    });
}

function bindGlobalMenuClose() {
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.song-menu')) {
            closeAllMenus();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAllMenus();
            store.clearSelection();
        }
    });
}

function bindPlayerBar() {
    const playBtn = document.getElementById('play-btn');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const modeBtn = document.getElementById('mode-btn');
    const mvBtn = document.getElementById('mv-btn');
    const queueBtn = document.getElementById('queue-btn');
    const playerMoreWrap = document.getElementById('player-more-wrap');
    const playerMoreBtn = document.getElementById('player-more-btn');
    const playerMoreMenu = document.getElementById('player-more-menu');
    const progressEl = document.getElementById('player-progress');
    const progressBar = document.getElementById('player-progress-bar');
    const currentEl = document.getElementById('player-current');
    const durationEl = document.getElementById('player-duration');
    const titleEl = document.getElementById('player-title');
    const artistEl = document.getElementById('player-artist');
    const coverEl = document.getElementById('player-cover');
    const volumeWrap = document.getElementById('volume-wrap');
    const volumeBtn = document.getElementById('volume-btn');
    const volumeSlider = document.getElementById('volume-slider');
    const playIcon = document.getElementById('play-icon');
    const modeIconEl = modeBtn.querySelector('svg');
    if (!playBtn) return;

    const volumePopup = volumeWrap.querySelector('.volume-popup');
    const playerMoreMenuEl = playerMoreWrap ? playerMoreWrap.querySelector('.player-more-menu') : null;
    if (volumePopup) document.body.appendChild(volumePopup);
    if (playerMoreMenuEl) document.body.appendChild(playerMoreMenuEl);

    function createCoverPlaceholder() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.5');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.innerHTML = '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>';
        return svg;
    }

    const modeLabels = {
        shuffle: '随机播放',
        'repeat-one': '单曲循环',
        'repeat-all': '列表循环',
    };

    playBtn.addEventListener('click', () => player.toggle());
    prevBtn.addEventListener('click', () => player.prev());
    nextBtn.addEventListener('click', () => player.next());
    modeBtn.addEventListener('click', () => {
        const mode = player.cycleMode();
        Toast(`已切换到${modeLabels[mode]}`, 'info', 1400);
    });

    if (mvBtn) {
        mvBtn.addEventListener('click', async () => {
            const state = store.get();
            if (state.playbackMode === 'mv') {
                mvPlayer.exitMv();
                return;
            }
            const q = state.queue;
            const song = q.currentIndex >= 0 ? q.tracks[q.currentIndex] : null;
            if (!song) {
                Toast('当前没有播放歌曲', 'warning', 1600);
                return;
            }
            let mvId = song.mv != null ? String(song.mv) : '';
            if (mvId === '') {
                try {
                    const netease = api.adapters && api.adapters.netease;
                    const detail = netease && typeof netease.song === 'function'
                        ? await netease.song(song.id)
                        : await api.song(song.id);
                    if (detail && detail.mv != null && String(detail.mv) !== '' && String(detail.mv) !== '0') {
                        mvId = String(detail.mv);
                        const idx = q.tracks.findIndex((t) => String(t.id) === String(song.id));
                        if (idx >= 0) {
                            const tracks = [...q.tracks];
                            tracks[idx] = { ...tracks[idx], mv: mvId };
                            store.update({ queue: { ...q, tracks } });
                            store.persist();
                        }
                    }
                } catch {}
            }
            if (mvId === '' || mvId === '0') {
                Toast('当前歌曲没有官方 MV', 'warning', 1600);
                return;
            }
            store.update({ playbackOpen: true });
            await mvPlayer.enterMv({ ...song, mv: mvId });
        });
    }

    const mvQualityBtn = document.getElementById('mv-quality-btn');
    const mvQualityMenu = document.getElementById('mv-quality-menu');
    const mvWebFullscreenBtn = document.getElementById('mv-web-fullscreen-btn');
    const mvFullscreenBtn = document.getElementById('mv-fullscreen-btn');

    if (mvQualityBtn && mvQualityMenu) {
        if (mvQualityMenu.parentNode !== document.body) {
            document.body.appendChild(mvQualityMenu);
        }

        function closeMvQualityMenu() {
            mvQualityMenu.classList.remove('is-open');
        }

        function openMvQualityMenu() {
            const rect = mvQualityBtn.getBoundingClientRect();
            mvQualityMenu.style.left = `${rect.left + rect.width / 2}px`;
            mvQualityMenu.style.top = `${rect.top - 8}px`;
            mvQualityMenu.style.right = 'auto';
            mvQualityMenu.style.bottom = 'auto';
            mvQualityMenu.style.transform = 'translate(-50%, -100%)';
            mvQualityMenu.classList.add('is-open');
        }

        mvQualityBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (mvQualityMenu.classList.contains('is-open')) {
                closeMvQualityMenu();
            } else {
                openMvQualityMenu();
            }
        });

        document.addEventListener('click', (e) => {
            if (!mvQualityMenu.contains(e.target) && !mvQualityBtn.contains(e.target)) {
                closeMvQualityMenu();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeMvQualityMenu();
        });

        window.addEventListener('resize', closeMvQualityMenu);
        window.addEventListener('scroll', closeMvQualityMenu, true);

        store.subscribe((state) => {
            if (state.playbackMode !== 'mv') closeMvQualityMenu();
        });
    }

    if (mvWebFullscreenBtn) {
        mvWebFullscreenBtn.addEventListener('click', () => {
            const overlay = document.querySelector('.playback-overlay');
            if (!overlay) return;
            const next = !overlay.classList.contains('is-web-fullscreen');
            overlay.classList.toggle('is-web-fullscreen', next);
            document.body.classList.toggle('mv-web-fullscreen', next);
        });
    }

    if (mvFullscreenBtn) {
        mvFullscreenBtn.addEventListener('click', () => {
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                document.documentElement.requestFullscreen();
            }
        });
    }

    let preNativeWebFullscreen = false;

    document.addEventListener('fullscreenchange', () => {
        const isNative = !!document.fullscreenElement;
        const state = store.get();
        const overlay = document.querySelector('.playback-overlay');
        document.body.classList.toggle('mv-native-fullscreen', isNative);

        if (isNative) {
            if (state.playbackMode === 'mv') {
                preNativeWebFullscreen = document.body.classList.contains('mv-web-fullscreen');
                if (overlay) overlay.classList.add('is-web-fullscreen');
                document.body.classList.add('mv-web-fullscreen');
            } else {
                preNativeWebFullscreen = false;
            }
        } else {
            if (!preNativeWebFullscreen) {
                if (overlay) overlay.classList.remove('is-web-fullscreen');
                document.body.classList.remove('mv-web-fullscreen');
            }
            preNativeWebFullscreen = false;
        }
    });

    queueBtn.addEventListener('click', () => {
        store.toggleQueuePanel();
    });

    const audioFxBtn = document.getElementById('audio-fx-btn');
    if (audioFxBtn) {
        audioFxBtn.addEventListener('click', () => {
            openAudioEffectsModal(ctx);
        });
    }

    if (volumeBtn && volumePopup) {
        volumeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = volumePopup.classList.contains('is-open');
            if (playerMoreMenuEl) playerMoreMenuEl.classList.remove('is-open');
            if (isOpen) {
                volumePopup.classList.remove('is-open');
            } else {
                const rect = volumeBtn.getBoundingClientRect();
                volumePopup.style.left = `${rect.left + rect.width / 2}px`;
                volumePopup.style.top = `${rect.top - 10}px`;
                volumePopup.style.transform = 'translate(-50%, -100%)';
                volumePopup.classList.add('is-open');
            }
        });
    }

    if (playerMoreBtn && playerMoreMenuEl) {
        playerMoreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = playerMoreMenuEl.classList.contains('is-open');
            if (volumePopup) volumePopup.classList.remove('is-open');
            if (isOpen) {
                playerMoreMenuEl.classList.remove('is-open');
            } else {
                const rect = playerMoreBtn.getBoundingClientRect();
                playerMoreMenuEl.style.left = `${rect.left + rect.width / 2}px`;
                playerMoreMenuEl.style.top = `${rect.top - 8}px`;
                playerMoreMenuEl.style.transform = 'translate(-50%, -100%)';
                playerMoreMenuEl.classList.add('is-open');
            }
        });
    }

    if (playerMoreMenuEl) {
        playerMoreMenuEl.addEventListener('click', (e) => {
            const item = e.target.closest('.player-more-item');
            if (!item) return;
            e.stopPropagation();
            playerMoreMenuEl.classList.remove('is-open');

            const q = store.get().queue;
            const currentSong = q.currentIndex >= 0 ? q.tracks[q.currentIndex] : null;
            if (!currentSong) {
                Toast('当前没有播放歌曲', 'warning', 1600);
                return;
            }

            const action = item.dataset.action;
            if (action === 'share') {
                shareSong(currentSong);
            } else if (action === 'share-card') {
                openShareCardModal(currentSong);
            } else if (action === 'download-audio') {
                openDownloadOptionsModal(currentSong, ctx, 'now');
            } else if (action === 'download-mv') {
                openMvDownloadOptionsModal(currentSong, ctx, 'now');
            } else if (action === 'download-lyric') {
                handleDownloadLyric(currentSong, ctx);
            } else if (action === 'audio-effects') {
                openAudioEffectsModal(ctx);
            }
        });
    }

    let progressDragging = false;

    function seekFromPointer(e) {
        const rect = progressEl.getBoundingClientRect();
        if (rect.width <= 0) return;
        const percent = (e.clientX - rect.left) / rect.width;
        player.seek(Math.max(0, Math.min(1, percent)));
    }

    progressEl.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        progressDragging = true;
        try { progressEl.setPointerCapture(e.pointerId); } catch {}
        seekFromPointer(e);
        e.preventDefault();
    });

    progressEl.addEventListener('pointermove', (e) => {
        if (!progressDragging) return;
        seekFromPointer(e);
    });

    progressEl.addEventListener('pointerup', (e) => {
        if (!progressDragging) return;
        progressDragging = false;
        try { progressEl.releasePointerCapture(e.pointerId); } catch {}
    });

    progressEl.addEventListener('pointercancel', () => {
        progressDragging = false;
    });

    volumeSlider.addEventListener('input', (e) => {
        player.setVolume(Number(e.target.value) / 100);
    });

    document.addEventListener('click', (e) => {
        if (volumePopup && !volumePopup.contains(e.target) && !volumeBtn.contains(e.target)) {
            volumePopup.classList.remove('is-open');
        }
        if (playerMoreMenuEl && !playerMoreMenuEl.contains(e.target) && playerMoreBtn && !playerMoreBtn.contains(e.target)) {
            playerMoreMenuEl.classList.remove('is-open');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (volumePopup) volumePopup.classList.remove('is-open');
            if (playerMoreMenuEl) playerMoreMenuEl.classList.remove('is-open');
        }
    });

    const lyricLinesEl = document.getElementById('player-lyric-lines');
    const lyricScrollerEl = document.getElementById('player-lyric-scroller');
    const lyricWrapEl = document.getElementById('player-lyric');

    let playerLyric = { lines: [], hasTimestamps: false };
    let playerLyricSongId = '';
    let playerLyricCurrentIndex = -1;

    function setPlayerLyricPlaceholder(text) {
        if (!lyricLinesEl) return;
        lyricLinesEl.innerHTML = '';
        const node = document.createElement('div');
        node.className = 'player-lyric__line';
        node.textContent = text;
        lyricLinesEl.appendChild(node);
        if (lyricScrollerEl) lyricScrollerEl.style.transform = '';
        playerLyricCurrentIndex = -1;
    }

    function renderPlayerLyric() {
        if (!lyricLinesEl) return;
        lyricLinesEl.innerHTML = '';
        if (!playerLyric.lines.length) {
            setPlayerLyricPlaceholder('暂无歌词');
            return;
        }
        const frag = document.createDocumentFragment();
        for (const line of playerLyric.lines) {
            const node = document.createElement('div');
            node.className = 'player-lyric__line';
            if (line.words && line.words.length) {
                for (const word of line.words) {
                    const span = document.createElement('span');
                    span.className = 'player-lyric__word';
                    span.textContent = word.text;
                    span.dataset.start = String(word.startTime);
                    span.dataset.end = String(word.endTime);
                    span.style.setProperty('--p', '0%');
                    node.appendChild(span);
                }
            } else {
                node.textContent = line.text || '';
            }
            frag.appendChild(node);
        }
        lyricLinesEl.appendChild(frag);
        playerLyricCurrentIndex = -1;
        if (lyricScrollerEl) lyricScrollerEl.style.transform = '';
    }

    function updatePlayerWords(t) {
        if (!playerLyric.hasWordTimestamps || !playerLyric.lines.length) return;
        const idx = findCurrentIndex(playerLyric.lines, t);
        if (idx < 0) return;
        const words = playerLyric.lines[idx].words;
        if (!words || !words.length) return;
        const row = lyricLinesEl.children[idx];
        if (!row) return;
        const spans = row.querySelectorAll('.player-lyric__word');
        let activeIdx = -1;
        for (let i = 0; i < words.length; i++) {
            if (t < words[i].endTime) {
                if (t >= words[i].startTime) activeIdx = i;
                break;
            }
            activeIdx = i;
        }
        if (t >= words[words.length - 1].endTime) activeIdx = words.length - 1;
        for (let i = 0; i < spans.length; i++) {
            const isPast = i < activeIdx;
            const isActive = i === activeIdx;
            spans[i].classList.toggle('is-past', isPast);
            spans[i].classList.toggle('is-active', isActive);
            if (isPast) {
                spans[i].style.setProperty('--p', '100%');
            } else if (!isActive) {
                spans[i].style.setProperty('--p', '0%');
            }
        }
        if (activeIdx < 0 || activeIdx >= spans.length) return;
        const w = words[activeIdx];
        const dur = w.endTime - w.startTime;
        if (dur <= 0) return;
        let p = ((t - w.startTime) / dur) * 100;
        if (p < 0) p = 0;
        else if (p > 100) p = 100;
        spans[activeIdx].style.setProperty('--p', p.toFixed(1) + '%');
    }

    function updatePlayerLyricHighlight() {
        if (!lyricLinesEl || !lyricScrollerEl || !lyricWrapEl) return;
        if (!playerLyric.hasTimestamps || !playerLyric.lines.length) return;

        const q = store.get().queue;
        const t = q.currentTime || 0;
        const idx = findCurrentIndex(playerLyric.lines, t);
        if (idx < 0) return;

        if (idx === playerLyricCurrentIndex) return;

        const prev = lyricLinesEl.children[playerLyricCurrentIndex];
        if (prev) prev.classList.remove('is-current');

        playerLyricCurrentIndex = idx;
        const cur = lyricLinesEl.children[idx];
        if (!cur) return;
        cur.classList.add('is-current');

        const containerH = lyricWrapEl.clientHeight;
        const lineH = cur.offsetHeight || 16;
        const targetTop = (containerH - lineH) / 2;
        const offset = cur.offsetTop - targetTop;
        lyricScrollerEl.style.transform = `translateY(${-offset}px)`;
    }

    let playerWordRaf = null;
    function tickPlayerWordRaf() {
        playerWordRaf = null;
        const q = store.get().queue;
        if (!q.isPlaying) return;
        updatePlayerWords(player.audio.currentTime || 0);
        playerWordRaf = requestAnimationFrame(tickPlayerWordRaf);
    }
    function startPlayerWordRaf() {
        if (playerWordRaf) return;
        playerWordRaf = requestAnimationFrame(tickPlayerWordRaf);
    }
    function stopPlayerWordRaf() {
        if (playerWordRaf) {
            cancelAnimationFrame(playerWordRaf);
            playerWordRaf = null;
        }
    }

    async function loadPlayerLyric(song) {
        if (!song || !song.id) {
            playerLyric = { lines: [], hasTimestamps: false };
            playerLyricSongId = '';
            setPlayerLyricPlaceholder('暂无歌词');
            return;
        }
        if (song.id === playerLyricSongId) return;
        playerLyricSongId = song.id;
        playerLyric = { lines: [], hasTimestamps: false };
        setPlayerLyricPlaceholder('歌词加载中…');
        try {
            const parsed = await loadLyric(api, song);
            if (playerLyricSongId !== song.id) return;
            playerLyric = parsed;
            renderPlayerLyric();
            updatePlayerLyricHighlight();
        } catch {
            if (playerLyricSongId !== song.id) return;
            setPlayerLyricPlaceholder('歌词加载失败');
        }
    }

    setPlayerLyricPlaceholder('暂无歌词');

    {
        const q0 = store.get().queue;
        const curSong = q0.currentIndex >= 0 ? q0.tracks[q0.currentIndex] : null;
        if (curSong) loadPlayerLyric(curSong);
    }

    player.on('trackchange', (song) => {
        loadPlayerLyric(song);
        ensureSongMv(song);
    });
    player.on('timeupdate', () => updatePlayerLyricHighlight());

    store.subscribe((state) => {
        if (state.queue.isPlaying) startPlayerWordRaf();
        else stopPlayerWordRaf();
    });

    player.on('error', ({ song, error }) => {
        const msg = error?.message || '播放失败';
        Toast(`${song?.title || '歌曲'}：${msg}`, 'danger', 2600);
    });

    store.subscribe((state) => {
        const q = state.queue;
        const song = q.currentIndex >= 0 ? q.tracks[q.currentIndex] : null;

        if (mvBtn) {
            const isMv = state.playbackMode === 'mv';
            const mvStr = song && song.mv != null ? String(song.mv) : '';
            const hasMv = mvStr !== '' && mvStr !== '0';
            const mvUnknown = mvStr === '';
            mvBtn.disabled = !isMv && !hasMv && !mvUnknown;
            const title = isMv
                ? '返回歌曲'
                : (hasMv ? '播放 MV' : (mvUnknown ? '检测 MV…' : '无官方 MV'));
            if (mvBtn.title !== title) mvBtn.title = title;
            const svgEl = mvBtn.querySelector('svg');
            const wantIcon = isMv ? 'music' : 'video';
            if (svgEl && svgEl.dataset.icon !== wantIcon) {
                svgEl.dataset.icon = wantIcon;
                svgEl.innerHTML = isMv
                    ? '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'
                    : '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>';
            }
        }

        if (playerMoreMenuEl) {
            playerMoreMenuEl.querySelectorAll('.player-more-item').forEach((item) => {
                if (item.dataset.action === 'download-mv') {
                    const mvStr = song && song.mv != null ? String(song.mv) : '';
                    const hasMv = mvStr !== '' && mvStr !== '0';
                    item.disabled = !song || !hasMv;
                    item.classList.toggle('hidden', !hasMv);
                } else {
                    item.disabled = !song;
                }
            });
        }

        if (mvQualityMenu && state.playbackMode === 'mv') {
            const brs = state.mvState.brs || [];
            const brKey = brs.map((b) => b.br).join(',');
            if (mvQualityMenu.dataset.built !== brKey) {
                mvQualityMenu.dataset.built = brKey;
                mvQualityMenu.innerHTML = '';
                for (const br of brs) {
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'mv-quality-item';
                    item.textContent = `${br.br}P`;
                    item.dataset.br = String(br.br);
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        mvQualityMenu.classList.remove('is-open');
                        const target = Number(br.br);
                        if (Number.isFinite(target)) {
                            mvPlayer.switchQuality(target);
                        }
                    });
                    mvQualityMenu.appendChild(item);
                }
            }
            mvQualityMenu.querySelectorAll('.mv-quality-item').forEach((item) => {
                item.classList.toggle('is-active', Number(item.dataset.br) === Number(state.mvState.currentBr));
            });
        }

        if (song) {
            titleEl.textContent = song.title || '未知歌曲';
            const artistKey = String(song.id || '') + '|' + (song.artist || '') + '|' + ((song.artists || []).map((a) => a.id).join(','));
            if (artistEl.dataset.artistKey !== artistKey) {
                artistEl.dataset.artistKey = artistKey;
                renderArtistInto(artistEl, song, ctx, '未知歌手');
            }

            const currentCoverId = coverEl.dataset.songId;
            const nextCoverId = String(song.id || song.url || song.title || '');
            if (nextCoverId !== currentCoverId) {
                coverEl.dataset.songId = nextCoverId;
                coverEl.innerHTML = '';
                if (song.pic) {
                    const img = document.createElement('img');
                    img.src = song.pic;
                    img.alt = '';
                    img.onerror = () => {
                        coverEl.innerHTML = '';
                        coverEl.appendChild(createCoverPlaceholder());
                    };
                    coverEl.appendChild(img);
                } else {
                    coverEl.appendChild(createCoverPlaceholder());
                }
            }
        } else {
            titleEl.textContent = '未播放';
            artistEl.dataset.artistKey = '';
            artistEl.textContent = '从搜索结果中选择歌曲';
            if (coverEl.dataset.songId) {
                coverEl.dataset.songId = '';
                coverEl.innerHTML = '';
                coverEl.appendChild(createCoverPlaceholder());
            }
        }

        const isMvMode = state.playbackMode === 'mv';
        const isLoadingAudio = !isMvMode && !!q.isLoading;
        if (progressEl) progressEl.classList.toggle('is-loading', isLoadingAudio);
        const total = isMvMode ? (state.mvState.duration || 0) : (q.duration || 0);
        const cur = isMvMode ? (state.mvState.currentTime || 0) : (q.currentTime || 0);
        progressBar.style.width = total > 0 ? `${(cur / total) * 100}%` : '0%';
        currentEl.textContent = formatTime(cur);
        durationEl.textContent = formatTime(total);

        if (q.isPlaying) {
            playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
            playBtn.title = '暂停';
        } else {
            playIcon.innerHTML = '<polygon points="6 4 20 12 6 20"/>';
            playBtn.title = '播放';
        }

        const mode = q.playMode || 'repeat-all';
        modeBtn.title = modeLabels[mode] || '列表循环';
        if (modeIconEl) {
            modeIconEl.innerHTML = MODE_ICONS[mode] || MODE_ICONS['repeat-all'];
        }

        if (document.activeElement !== volumeSlider) {
            volumeSlider.value = Math.round((q.volume ?? 0.7) * 100);
        }
    });
}

async function openAccountModal() {
    {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'ena-input';
        input.placeholder = '输入网易云昵称';
        input.setAttribute('autocomplete', 'off');

        const hint = document.createElement('div');
        hint.className = 'account-modal__hint';
        hint.textContent = '仅获取公开数据，不会登录你的账户。';

        const body = document.createElement('div');
        body.className = 'account-modal';
        body.appendChild(input);
        body.appendChild(hint);

        let selectedUid = '';

        const candidateList = document.createElement('div');
        candidateList.className = 'account-modal__candidates';
        candidateList.style.display = 'none';
        body.appendChild(candidateList);

        let modalRef = null;

        function setConfirmText(text) {
            if (modalRef && modalRef.confirmBtn) {
                if (modalRef.confirmBtn.textContent !== text) {
                    modalRef.confirmBtn.textContent = text;
                }
            }
        }

        function resetToSearch() {
            selectedUid = '';
            setConfirmText('提交');
            candidateList.innerHTML = '';
            candidateList.style.display = 'none';
        }

        async function doConnect() {
            const keyword = input.value.trim();
            if (!keyword) {
                Toast('请输入网易云昵称', 'warning', 1600);
                return;
            }

            if (selectedUid) {
                await connectByUid(selectedUid);
                return;
            }

            hint.textContent = '正在搜索用户…';
            try {
                const result = await api.searchUser(keyword, { limit: 5 });
                if (!result.users.length) {
                    candidateList.innerHTML = '';
                    candidateList.style.display = 'none';
                    hint.textContent = '未找到该用户，请检查昵称是否正确。';
                    return;
                }

                candidateList.innerHTML = '';

                for (const u of result.users) {
                    const item = document.createElement('button');
                    item.className = 'account-modal__candidate';
                    const avatar = document.createElement('span');
                    avatar.className = 'account-modal__candidate-avatar';
                    if (u.avatarUrl) {
                        const img = document.createElement('img');
                        img.src = u.avatarUrl;
                        img.alt = '';
                        avatar.appendChild(img);
                    }
                    const name = document.createElement('span');
                    name.textContent = u.nickname;
                    const uidEl = document.createElement('span');
                    uidEl.className = 'account-modal__candidate-uid';
                    uidEl.textContent = `UID ${u.uid}`;
                    item.appendChild(avatar);
                    item.appendChild(name);
                    item.appendChild(uidEl);
                    item.addEventListener('click', () => {
                        selectedUid = u.uid;
                        candidateList.querySelectorAll('.account-modal__candidate').forEach((el) => {
                            el.classList.toggle('is-active', el === item);
                        });
                        setConfirmText('连接');
                    });
                    candidateList.appendChild(item);
                }

                candidateList.style.display = '';
                hint.textContent = '请从下列结果中选择要连接的账户。';
                setConfirmText('提交');
            } catch (err) {
                hint.textContent = `搜索失败：${err.message}`;
            }
        }

        async function connectByUid(uid) {
            hint.textContent = '正在验证账户…';
            try {
                const detail = await api.userDetail(uid);
                store.update({
                    account: {
                        uid: detail.uid,
                        nickname: detail.nickname,
                        avatarUrl: detail.avatarUrl,
                        signature: detail.signature,
                        playlistCount: detail.playlistCount,
                        followeds: detail.followeds,
                        follows: detail.follows,
                        connected: true,
                    },
                });
                store.persist();
                Toast(`已连接：${detail.nickname}`, 'success', 1800);
                if (modalRef && typeof modalRef.close === 'function') modalRef.close();
            } catch (err) {
                hint.textContent = `连接失败：${err.message}`;
            }
        }

        input.addEventListener('input', () => {
            if (selectedUid) {
                resetToSearch();
                hint.textContent = '仅获取公开数据，不会登录你的账户。';
            }
        });

        modalRef = openModal({
            title: '连接网易云账户',
            body,
            confirmText: '提交',
            onConfirm: () => {
                doConnect();
                return false;
            },
        });

        input.focus();
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                doConnect();
            }
        });
    }
}

function bindAccountButton() {
    const host = document.getElementById('top-bar-actions');
    if (!host) return;

    let viewSwitcherMenu = null;

    function ensureViewSwitcherMenu() {
        if (!viewSwitcherMenu) {
            viewSwitcherMenu = document.createElement('div');
            viewSwitcherMenu.className = 'view-switcher-menu';
            document.body.appendChild(viewSwitcherMenu);
        }
        return viewSwitcherMenu;
    }

    function buildViewSwitcherMenu() {
        const menu = ensureViewSwitcherMenu();
        const cur = store.get().settings.songView || 'tile';
        menu.innerHTML = '';
        const items = [
            {
                value: 'tile',
                label: '平铺',
                iconPath: '<rect x="3" y="5" width="18" height="5" rx="1"/><rect x="3" y="14" width="18" height="5" rx="1"/>',
            },
            {
                value: 'list',
                label: '列表',
                iconPath: '<rect x="3" y="4" width="6" height="6" rx="1"/><line x1="12" y1="6" x2="21" y2="6"/><line x1="12" y1="10" x2="21" y2="10"/><rect x="3" y="14" width="6" height="6" rx="1"/><line x1="12" y1="16" x2="21" y2="16"/><line x1="12" y1="20" x2="21" y2="20"/>',
            },
            {
                value: 'detail',
                label: '详细信息',
                iconPath: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>',
            },
            {
                value: 'grid',
                label: '网格',
                iconPath: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
            },
            {
                value: 'mosaic',
                label: '马赛克',
                iconPath: '<rect x="2" y="2" width="10" height="10"/><rect x="14" y="2" width="8" height="6"/><rect x="14" y="10" width="8" height="12"/><rect x="2" y="14" width="10" height="8"/>',
            },
        ];
        for (const opt of items) {
            const item = document.createElement('button');
            item.className = 'view-switcher-item' + (opt.value === cur ? ' is-active' : '');
            item.dataset.view = opt.value;
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '2');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
            svg.innerHTML = opt.iconPath;
            item.appendChild(svg);
            item.appendChild(document.createTextNode(opt.label));
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                menu.classList.remove('is-open');
                if (store.get().settings.songView === opt.value) return;
                store.update({ settings: { ...store.get().settings, songView: opt.value } });
                store.persist();
            });
            menu.appendChild(item);
        }
    }

    function render() {
        host.innerHTML = '';

        const viewSwitcherBtn = document.createElement('button');
        viewSwitcherBtn.className = 'ena-btn ena-btn--icon view-switcher-btn';
        viewSwitcherBtn.title = '切换视图';
        viewSwitcherBtn.appendChild(icon('layout'));
        viewSwitcherBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = ensureViewSwitcherMenu();
            const isOpen = menu.classList.contains('is-open');
            menu.classList.remove('is-open');
            if (isOpen) return;
            buildViewSwitcherMenu();
            const rect = viewSwitcherBtn.getBoundingClientRect();
            const menuWidth = 140;
            let left = rect.right - menuWidth;
            if (left < 8) left = 8;
            menu.style.left = `${left}px`;
            menu.style.top = `${rect.bottom + 6}px`;
            menu.classList.add('is-open');
        });
        host.appendChild(viewSwitcherBtn);

        const multiSelectBtn = document.createElement('button');
        multiSelectBtn.className = 'ena-btn ena-btn--icon multi-select-btn';
        multiSelectBtn.title = '多选';
        multiSelectBtn.appendChild(icon('check-square'));
        multiSelectBtn.addEventListener('click', () => store.toggleMultiSelectMode());
        host.appendChild(multiSelectBtn);

        const parseBtn = document.createElement('button');
        parseBtn.className = 'ena-btn ena-btn--icon parse-btn';
        parseBtn.title = '内容 ID 解析';
        parseBtn.appendChild(icon('link'));
        parseBtn.addEventListener('click', () => ctx.openParseModal());
        host.appendChild(parseBtn);

        const currentMode = store.get().settings.themeMode || 'auto';
        const isDark = resolveMode(currentMode) === 'dark';
        const themeBtn = document.createElement('button');
        themeBtn.className = 'ena-btn ena-btn--icon';
        themeBtn.title = isDark ? '切换到日间模式' : '切换到夜间模式';
        themeBtn.appendChild(icon(isDark ? 'sun' : 'moon'));
        themeBtn.addEventListener('click', () => {
            store.setThemeMode(isDark ? 'light' : 'dark');
        });
        host.appendChild(themeBtn);

        const account = store.get().account;
        host.appendChild(AccountButton({
            account,
            onConnect: openAccountModal,
            onDisconnect: async () => {
                const ok = await confirmDialog('确定断开当前账户吗？');
                if (!ok) return;
                store.disconnectAccount();
                Toast('已断开账户连接', 'success', 1400);
            },
            onOpenAbout: () => openAboutModal(ctx),
        }));
    }

    document.addEventListener('click', (e) => {
        if (!viewSwitcherMenu) return;
        if (viewSwitcherMenu.contains(e.target)) return;
        if (e.target.closest && e.target.closest('.view-switcher-btn')) return;
        viewSwitcherMenu.classList.remove('is-open');
    });

    render();
    store.subscribe((state) => {
        const current = state.account;
        const currentMode = state.settings.themeMode || 'auto';
        const key = `${current.connected}|${current.uid}|${current.nickname}|${current.avatarUrl}|${resolveMode(currentMode)}`;
        if (host.__lastAccountKey === key) return;
        host.__lastAccountKey = key;
        render();
    });
}

function bindSongViewAttr() {
    function sync(state) {
        const contentEl = document.getElementById('content-area');
        if (!contentEl) return;
        const isCardView = state.view === 'search' || state.view === 'myfavorites';
        const sv = isCardView ? (state.settings.songView || 'tile') : 'tile';
        if (contentEl.dataset.songView !== sv) contentEl.dataset.songView = sv;
    }
    store.subscribe(sync);
}

function bindSilentWiki() {
    let lastKey = '';
    store.subscribe((state) => {
        if (state.view !== 'search' && state.view !== 'myfavorites') {
            lastKey = '';
            return;
        }
        if (state.settings.songView !== 'detail') {
            lastKey = '';
            return;
        }
        const tracks = state.visibleTracks;
        if (!tracks || !tracks.length) return;
        const map = state.wikiMap instanceof Map ? state.wikiMap : null;
        const key = tracks.map((t) => {
            const entry = map ? map.get(String(t.id)) : null;
            const s = entry && entry.__summaryFetched ? '1' : '0';
            const p = entry && entry.__publishFetched ? '1' : '0';
            return `${t.id}:${s}${p}`;
        }).join(',');
        if (key === lastKey) return;
        if (state.wikiProgress.active) return;
        lastKey = key;
        void runWikiForTracks(ctx, tracks, { silent: true });
    });
}

bindSongViewAttr();
bindSilentWiki();

function bindMobileMoreMenu() {
    const btn = document.getElementById('mobile-more-btn');
    const menu = document.getElementById('mobile-more-menu');
    if (!btn || !menu) return;

    function close() {
        menu.classList.remove('is-open');
    }

    function open() {
        const rect = btn.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 6}px`;
        menu.style.left = `${Math.max(8, rect.left)}px`;
        menu.classList.add('is-open');
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menu.classList.contains('is-open')) close();
        else open();
    });

    menu.addEventListener('click', (e) => {
        const item = e.target.closest('.mobile-more-item');
        if (!item) return;
        e.stopPropagation();

        if (item.dataset.view) {
            store.update({ view: item.dataset.view });
            close();
            return;
        }

        if (item.dataset.action === 'parse') {
            ctx.openParseModal();
            close();
            return;
        }

        if (item.dataset.action === 'multi-select') {
            store.toggleMultiSelectMode();
            close();
        }
    });

    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target) && !btn.contains(e.target)) close();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
    });

    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);

    store.subscribe((state) => {
        menu.querySelectorAll('.mobile-more-item[data-view]').forEach((item) => {
            item.classList.toggle('is-active', item.dataset.view === state.view);
        });
    });
}

function bindMultiSelectBar() {
    const bar = document.getElementById('multi-select-bar');
    if (!bar) return;

    const pairs = [];
    bar.querySelectorAll('.multi-select-menu-wrap').forEach((wrap) => {
        const menu = wrap.querySelector('.multi-select-menu');
        if (!menu) return;
        document.body.appendChild(menu);
        pairs.push({ wrap, menu });
    });

    function closeMenus() {
        for (const { wrap, menu } of pairs) {
            wrap.classList.remove('is-open');
            menu.classList.remove('is-open');
        }
    }

    function positionMenu(btn, menu) {
        const btnRect = btn.getBoundingClientRect();
        const menuWidth = menu.offsetWidth || 160;
        const menuHeight = menu.offsetHeight || 120;

        let left = btnRect.left + btnRect.width / 2 - menuWidth / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
        menu.style.left = left + 'px';

        let top = btnRect.top - menuHeight - 6;
        if (top < 8) top = btnRect.bottom + 6;
        menu.style.top = top + 'px';
    }

    function openMenuFor(wrap) {
        const entry = pairs.find((p) => p.wrap === wrap);
        if (!entry) return;
        const btn = wrap.querySelector('.multi-select-action');
        if (!btn) return;
        positionMenu(btn, entry.menu);
        wrap.classList.add('is-open');
        entry.menu.classList.add('is-open');
    }

    function handleAction(action) {
        const selection = store.get().selection;

        if (action === 'select-by-condition') {
            openConditionSelect(ctx);
            return;
        }

        if (action === 'select-all') {
            const tracks = store.get().visibleTracks;
            if (!tracks.length) {
                Toast('当前页没有可选的歌曲', 'warning', 1600);
                return;
            }
            const added = store.addSelection(tracks);
            if (!added) {
                Toast('当前页已全部选中', 'warning', 1400);
            } else {
                Toast(`已选中当前页 ${tracks.length} 首`, 'success', 1600);
            }
            return;
        }

        if (action === 'select-all-all') {
            const tracks = store.get().allTracks;
            if (!tracks.length) {
                Toast('当前视图没有可全选的数据', 'warning', 1600);
                return;
            }
            const added = store.addSelection(tracks);
            if (!added) {
                Toast('已全部选中', 'warning', 1400);
            } else {
                Toast(`已选中 ${tracks.length} 首`, 'success', 1600);
            }
            return;
        }

        if (action === 'select-filtered') {
            const tracks = store.get().filteredTracks;
            if (!tracks.length) {
                Toast('没有可选的筛选结果', 'warning', 1600);
                return;
            }

            const added = store.addSelection(tracks);
            if (!added) {
                Toast('筛选结果已全部选中', 'warning', 1400);
            } else {
                Toast(`已选中筛选结果 ${tracks.length} 首`, 'success', 1600);
            }
            return;
        }

        if (action === 'cancel') {
            store.clearSelection();
            return;
        }

        if (!selection.length) {
            Toast('请先选择歌曲', 'warning', 1600);
            return;
        }
        const view = store.get().view;

        if ((action === 'add-playlist' || action === 'replace-playlist') && view === 'queue') {
            Toast('当前为播放队列', 'warning', 1400);
            return;
        }

        if ((action === 'add-download' || action === 'replace-download') && view === 'downloads') {
            Toast('当前为下载列表', 'warning', 1400);
            return;
        }

        if (action === 'add-download') {
            openBatchAddModal(selection, ctx, 'append');
        } else if (action === 'replace-download') {
            openBatchAddModal(selection, ctx, 'replace');
        } else if (action === 'add-playlist') {
            const q = store.get().queue;
            const tracks = [...q.tracks];
            const seen = new Set(tracks.map((t) => t.id).filter(Boolean));
            let added = 0;
            for (const song of selection) {
                if (!song.id || seen.has(song.id)) continue;
                tracks.push(song);
                seen.add(song.id);
                added++;
            }
            if (!added) {
                Toast('所选歌曲已全部在播放列表中', 'warning', 1600);
                return;
            }
            store.update({ queue: { ...q, tracks } });
            store.persist();
            Toast(`已添加 ${added} 首到播放列表`, 'success', 1600);
            store.clearSelection();
        } else if (action === 'replace-playlist') {
            player.setQueue(selection, 0, true);
            Toast(`已替换播放列表（${selection.length} 首）`, 'success', 1600);
            store.clearSelection();
        }
    }

    bar.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('.multi-select-action');
        if (!actionBtn) return;
        e.stopPropagation();

        const wrap = actionBtn.closest('.multi-select-menu-wrap');
        if (wrap) {
            const wasOpen = wrap.classList.contains('is-open');
            closeMenus();
            if (!wasOpen) openMenuFor(wrap);
            return;
        }

        closeMenus();
        handleAction(actionBtn.dataset.action);
    });

    for (const { menu } of pairs) {
        menu.addEventListener('click', (e) => {
            const item = e.target.closest('.multi-select-menu-item');
            if (!item) return;
            e.stopPropagation();
            closeMenus();
            if (item.classList.contains('is-disabled') || item.disabled) return;
            handleAction(item.dataset.action);
        });
    }

    document.addEventListener('click', (e) => {
        if (bar.contains(e.target)) return;
        for (const { menu } of pairs) {
            if (menu.contains(e.target)) return;
        }
        closeMenus();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMenus();
    });

    window.addEventListener('resize', closeMenus);
    window.addEventListener('scroll', closeMenus, true);
}

function bindSelectionSync() {
    let lastSelection = null;
    let lastMode = false;

    store.subscribe((state) => {
        if (state.selection === lastSelection && state.multiSelectMode === lastMode) return;
        lastSelection = state.selection;
        lastMode = state.multiSelectMode;

        const hasSelection = state.selection.length > 0 || state.multiSelectMode;
        document.body.classList.toggle('has-selection', hasSelection);
        const bar = document.getElementById('multi-select-bar');
        if (bar) {
            const view = state.view;
            const hasAll = Array.isArray(state.allTracks) && state.allTracks.length > 0;
            const hasFiltered = Array.isArray(state.filteredTracks) && state.filteredTracks.length > 0;
            const hasVisible = Array.isArray(state.visibleTracks) && state.visibleTracks.length > 0;
            document.querySelectorAll('.multi-select-menu-item').forEach((btn) => {
                const a = btn.dataset.action;
                let disabled = false;
                if ((a === 'add-playlist' || a === 'replace-playlist') && view === 'queue') disabled = true;
                if ((a === 'add-download' || a === 'replace-download') && view === 'downloads') disabled = true;
                if (a === 'select-all' && !hasVisible) disabled = true;
                if (a === 'select-all-all' && !hasAll) disabled = true;
                if (a === 'select-filtered' && !hasFiltered) disabled = true;
                btn.classList.toggle('is-disabled', disabled);
                btn.disabled = disabled;
            });
        }
        const countEl = document.getElementById('selection-count');
        if (countEl) countEl.textContent = String(state.selection.length);

        const selectedIds = new Set(state.selection.map((s) => s.id));

        document.querySelectorAll('.song-row').forEach((row) => {
            const id = row.dataset.id;
            const isSelected = selectedIds.has(id);
            row.classList.toggle('is-selected', isSelected);
            const input = row.querySelector('.song-select input');
            if (input) input.checked = isSelected;
        });
    });
}

function initQueuePanel(ctx) {
    const panel = document.getElementById('queue-panel');
    if (!panel) return;

    const scrim = document.getElementById('queue-panel-scrim');
    const closeBtn = document.getElementById('queue-panel-close');
    const clearBtn = document.getElementById('queue-panel-clear');
    const body = document.getElementById('queue-panel-body');
    const modeBtn = document.getElementById('queue-panel-mode');
    const openViewBtn = document.getElementById('queue-panel-open-view');
    if (!scrim || !closeBtn || !clearBtn || !body) return;

    const PANEL_MODE_ICONS = {
        shuffle: '<path fill-rule="evenodd" d="M0 3.5A.5.5 0 0 1 .5 3H1c2.202 0 3.827 1.24 4.874 2.418.49.552.865 1.102 1.126 1.532.26-.43.636-.98 1.126-1.532C9.173 4.24 10.798 3 13 3v1c-1.798 0-3.173 1.01-4.126 2.082A9.6 9.6 0 0 0 7.556 8a9.6 9.6 0 0 0 1.317 1.918C9.828 10.99 11.204 12 13 12v1c-2.202 0-3.827-1.24-4.874-2.418A10.6 10.6 0 0 1 7 9.05c-.26.43-.636.98-1.126 1.532C4.827 11.76 3.202 13 1 13H.5a.5.5 0 0 1 0-1H1c1.798 0 3.173-1.01 4.126-2.082A9.6 9.6 0 0 0 6.444 8a9.6 9.6 0 0 0-1.317-1.918C4.172 5.01 2.796 4 1 4H.5a.5.5 0 0 1-.5-.5"/><path d="M13 5.466V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192m0 9v-3.932a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192"/>',
        'repeat-one': '<path d="M11 4v1.466a.25.25 0 0 0 .41.192l2.36-1.966a.25.25 0 0 0 0-.384l-2.36-1.966a.25.25 0 0 0-.41.192V3H5a5 5 0 0 0-4.48 7.223.5.5 0 0 0 .896-.446A4 4 0 0 1 5 4zm4.48 1.777a.5.5 0 0 0-.896.446A4 4 0 0 1 11 12H5.001v-1.466a.25.25 0 0 0-.41-.192l-2.36 1.966a.25.25 0 0 0 0 .384l2.36 1.966a.25.25 0 0 0 .41-.192V13h6a5 5 0 0 0 4.48-7.223Z"/><path d="M9 5.5a.5.5 0 0 0-.854-.354l-1.75 1.75a.5.5 0 1 0 .708.708L8 6.707V10.5a.5.5 0 0 0 1 0z"/>',
        'repeat-all': '<path d="M11 5.466V4H5a4 4 0 0 0-3.584 5.777.5.5 0 1 1-.896.446A5 5 0 0 1 5 3h6V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192m3.81.086a.5.5 0 0 1 .67.225A5 5 0 0 1 11 13H5v1.466a.25.25 0 0 1-.41.192l-2.36-1.966a.25.25 0 0 1 0-.384l2.36-1.966a.25.25 0 0 1 .41.192V12h6a4 4 0 0 0 3.585-5.777.5.5 0 0 1 .225-.67Z"/>',
    };
    const PANEL_MODE_LABELS = {
        shuffle: '随机播放',
        'repeat-one': '单曲循环',
        'repeat-all': '列表循环',
    };

    function syncModeButton() {
        if (!modeBtn) return;
        const mode = store.get().queue.playMode || 'repeat-all';
        const svg = modeBtn.querySelector('svg');
        const label = PANEL_MODE_LABELS[mode] || '列表循环';
        modeBtn.title = label;
        if (svg) {
            const html = PANEL_MODE_ICONS[mode] || PANEL_MODE_ICONS['repeat-all'];
            if (svg.innerHTML !== html) svg.innerHTML = html;
        }
    }

    if (modeBtn) {
        modeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const mode = player.cycleMode();
            Toast('已切换到' + (PANEL_MODE_LABELS[mode] || mode), 'info', 1400);
            syncModeButton();
        });
    }

    if (openViewBtn) {
        openViewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            store.setQueuePanelOpen(false);
            store.update({ view: 'queue', playbackOpen: false });
        });
    }

    const locateBtn = document.getElementById('queue-panel-locate');
    if (locateBtn) {
        locateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            locateCurrentInPanel();
        });
    }

    body.innerHTML = '';

    const list = document.createElement('div');
    list.className = 'song-list queue-panel__list';
    body.appendChild(list);
    function locateCurrentInPanel() {
        const q = store.get().queue;
        const song = q.currentIndex >= 0 ? q.tracks[q.currentIndex] : null;
        if (!song) return;
        const id = String(song.id);
        let attempts = 0;
        const find = () => {
            const rows = list.children;
            for (let i = 0; i < rows.length; i++) {
                if (rows[i].dataset && rows[i].dataset.id === id) {
                    rows[i].scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
                    return;
                }
            }
            if (attempts++ < 20) setTimeout(find, 50);
        };
        find();
    }

    const emptyEl = document.createElement('div');
    emptyEl.className = 'queue-panel__empty';
    emptyEl.textContent = '播放队列为空';

    function indexOfSong(song) {
        const tracks = store.get().queue.tracks;
        if (!song) return -1;
        if (song.id != null) {
            for (let i = 0; i < tracks.length; i++) {
                if (tracks[i] && String(tracks[i].id) === String(song.id)) return i;
            }
        }
        return tracks.indexOf(song);
    }

    function removeBySong(song) {
        const q = store.get().queue;
        const index = indexOfSong(song);
        if (index < 0) return;

        const tracks = q.tracks.slice();
        const wasCurrent = index === q.currentIndex;
        tracks.splice(index, 1);

        if (!tracks.length) {
            player.audio.pause();
            player.audio.removeAttribute('src');
            store.update({
                queue: { ...q, tracks: [], currentIndex: -1, isPlaying: false, currentTime: 0, duration: 0 },
            });
            store.persist();
            store.setQueuePanelOpen(false);
            return;
        }

        if (wasCurrent) {
            const next = Math.min(index, tracks.length - 1);
            store.update({ queue: { ...q, tracks } });
            player.playAt(next);
            return;
        }

        const currentIndex = index < q.currentIndex ? q.currentIndex - 1 : q.currentIndex;
        store.update({ queue: { ...q, tracks, currentIndex } });
        store.persist();
    }

    function buildRow(song, index) {
        const row = document.createElement('div');
        row.className = 'song-row queue-panel__row';
        row.dataset.id = song && song.id != null ? String(song.id) : '';
        row.dataset.index = String(index);
        row.__song = song;

        const select = document.createElement('label');
        select.className = 'song-select ena-checkbox';
        const input = document.createElement('input');
        input.type = 'checkbox';
        const box = document.createElement('span');
        box.className = 'box';
        select.appendChild(input);
        select.appendChild(box);
        select.addEventListener('click', (e) => e.stopPropagation());
        const bars = document.createElement('div');
        bars.className = 'song-playing-bars __queue_panel_bars__';
        for (let k = 0; k < 4; k++) bars.appendChild(document.createElement('span'));
        row.appendChild(bars);
        input.addEventListener('change', () => store.toggleSelection(song));
        row.appendChild(select);

        const info = document.createElement('div');
        info.className = 'song-info';

        const title = document.createElement('span');
        title.className = 'song-title';
        title.textContent = (song && song.title) || '未知歌曲';
        info.appendChild(title);

        const artist = document.createElement('span');
        artist.className = 'song-artist';
        renderArtistInto(artist, song, ctx, '');
        info.appendChild(artist);

        row.appendChild(info);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'song-action song-action--remove';
        removeBtn.title = '移除';
        removeBtn.type = 'button';
        removeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeBySong(song);
        });
        row.appendChild(removeBtn);

        row.addEventListener('click', (e) => {
            if (e.target.closest('.song-select')) return;
            if (e.target.closest('.song-action')) return;
            if (document.body.classList.contains('has-selection')) {
                store.toggleSelection(song);
                return;
            }
            const idx = indexOfSong(song);
            if (idx >= 0) player.playAt(idx);
        });

        return row;
    }

    function applyRowStates() {
        const q = store.get().queue;
        const rows = list.children;
        const curId = q.currentIndex >= 0 && q.tracks[q.currentIndex] && q.tracks[q.currentIndex].id != null
            ? String(q.tracks[q.currentIndex].id)
            : '';
        const sel = Array.isArray(store.get().selection) ? store.get().selection : [];
        const selIds = new Set();
        for (const s of sel) if (s && s.id != null) selIds.add(String(s.id));

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const id = row.dataset.id;
            const isCurrent = curId !== '' && id === curId;
            row.classList.toggle('is-current', isCurrent);
            row.classList.toggle('is-playing', isCurrent && q.isPlaying);
            const isSelected = id !== '' && selIds.has(id);
            row.classList.toggle('is-selected', isSelected);
            const input = row.querySelector('.song-select input');
            if (input && input.checked !== isSelected) input.checked = isSelected;
        }
    }

    let buildToken = 0;
    syncModeButton();

    let lastOpen = null;
    let lastTracksRef = null;
    let lastIndex = -2;
    let lastPlaying = null;
    let lastSelectionRef = null;

    function rebuild(tracks) {
        const token = ++buildToken;
        list.innerHTML = '';

        if (!tracks.length) {
            if (!body.contains(emptyEl)) body.appendChild(emptyEl);
            return;
        }
        if (emptyEl.parentNode === body) body.removeChild(emptyEl);

        let i = 0;
        const CHUNK_MS = 8;

        function nextChunk(deadline) {
            if (token !== buildToken) return;
            const frag = document.createDocumentFragment();
            const start = performance.now();
            const timeLimit = deadline && typeof deadline.timeRemaining === 'function'
                ? Math.max(CHUNK_MS, deadline.timeRemaining())
                : CHUNK_MS;

            while (i < tracks.length) {
                frag.appendChild(buildRow(tracks[i], i));
                i++;
                if (performance.now() - start >= timeLimit) break;
            }

            list.appendChild(frag);

            if (i < tracks.length) {
                if (typeof window.requestIdleCallback === 'function') {
                    window.requestIdleCallback(nextChunk, { timeout: 40 });
                } else {
                    setTimeout(() => nextChunk(null), 0);
                }
            } else {
                applyRowStates();
            }
        }

        nextChunk(null);
    }

    closeBtn.addEventListener('click', () => store.setQueuePanelOpen(false));
    scrim.addEventListener('click', () => store.setQueuePanelOpen(false));

    clearBtn.addEventListener('click', async () => {
        const ok = await confirmDialog('确定清空播放队列吗？');
        if (!ok) return;
        const q = store.get().queue;
        player.audio.pause();
        player.audio.removeAttribute('src');
        store.update({
            queue: { ...q, tracks: [], currentIndex: -1, isPlaying: false, currentTime: 0, duration: 0 },
        });
        store.persist();
        store.setQueuePanelOpen(false);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!store.get().queuePanelOpen) return;
        store.setQueuePanelOpen(false);
    });

    store.subscribe((state) => {
        const isOpen = !!state.queuePanelOpen;

        if (isOpen !== lastOpen) {
            lastOpen = isOpen;
            panel.classList.toggle('is-open', isOpen);
            document.body.classList.toggle('queue-panel-open', isOpen);

            if (isOpen) {
                lastTracksRef = null;
                lastIndex = -2;
                lastPlaying = null;
                lastSelectionRef = null;
                const q = store.get().queue;
                lastTracksRef = q.tracks;
                lastIndex = q.currentIndex;
                lastPlaying = q.isPlaying;
                lastSelectionRef = state.selection;
                rebuild(q.tracks);
            }
            return;
        }

        if (!isOpen) return;

        syncModeButton();

        const q = state.queue;
        const tracksChanged = q.tracks !== lastTracksRef;
        const indexChanged = q.currentIndex !== lastIndex;
        const playingChanged = q.isPlaying !== lastPlaying;
        const selectionChanged = state.selection !== lastSelectionRef;

        if (!tracksChanged && !indexChanged && !playingChanged && !selectionChanged) return;

        if (tracksChanged) {
            lastTracksRef = q.tracks;
            lastIndex = q.currentIndex;
            lastPlaying = q.isPlaying;
            lastSelectionRef = state.selection;
            rebuild(q.tracks);
            return;
        }

        lastIndex = q.currentIndex;
        lastPlaying = q.isPlaying;
        lastSelectionRef = state.selection;
        applyRowStates();
    });
}

function bindQueueVisibility() {
    store.subscribe((state) => {
        document.body.classList.toggle('queue-empty', state.queue.tracks.length === 0);
    });
}

function bindPlayingSync() {
    let lastKey = '';
    store.subscribe((state) => {
        const queueState = state.queue;
        const playingSong = queueState.currentIndex >= 0 ? queueState.tracks[queueState.currentIndex] : null;
        const key = `${playingSong ? playingSong.id : ''}|${queueState.isPlaying}`;
        if (key === lastKey) return;
        lastKey = key;
        syncPlayingRows();
    });
}

let currentViewInstance = null;
let lastView = null;

function syncPlayingRows() {
    const queueState = store.get().queue;
    const playingSong = queueState.currentIndex >= 0 ? queueState.tracks[queueState.currentIndex] : null;
    const playingId = queueState.isPlaying && playingSong ? String(playingSong.id) : '';
    document.querySelectorAll('.song-row').forEach((row) => {
        row.classList.toggle('is-playing', playingId !== '' && String(row.dataset.id) === playingId);
    });
}

function mountView(viewName) {
    if (currentViewInstance) {
        currentViewInstance.destroy?.();
        currentViewInstance = null;
    }

    store.setAllTracks([]);
    store.setFilteredTracks([]);

    const contentEl = document.getElementById('content-area');
    if (!contentEl) return;
    contentEl.innerHTML = '';

    let instance;
    switch (viewName) {
        case 'search':
            instance = SearchView(ctx);
            break;
        case 'queue':
            instance = QueueView(ctx);
            break;
        case 'downloads':
            instance = DownloadsView(ctx);
            break;
        case 'status':
            instance = StatusView(ctx);
            break;
        case 'settings':
            instance = SettingsView(ctx);
            break;
        case 'myfavorites':
            instance = MyFavoritesView(ctx);
            break;
        default:
            instance = SearchView(ctx);
    }

    if (instance) {
        contentEl.appendChild(instance.node);
        currentViewInstance = instance;
        syncPlayingRows();
    }
}

function bindRouter() {
    lastView = store.get().view;
    mountView(lastView);

    store.subscribe((state) => {
        if (state.view !== lastView) {
            lastView = state.view;
            mountView(state.view);
        }
    });
}

bindSidebar();
bindSearchBar();
bindBackButton();
bindGlobalMenuClose();
bindPlayerBar();
bindMultiSelectBar();
bindSelectionSync();
bindQueueVisibility();
bindPlayingSync();
bindAccountButton();
bindMobileMoreMenu();
initTooltip();
ctx.openAccountModal = openAccountModal;

initRouter(ctx);
initPlaybackView(ctx);
bindRouter();
initSidebarTrees(ctx);
initGlobalListGestures(ctx);
initWikiProgressUI(store);
initQueuePanel(ctx);

(function setupDownloadCompletionPrompt() {
    const KIND_LABEL = { audio: '音频', lyric: '歌词', mv: 'MV' };
    const pendingKinds = new Map();
    let promptTimer = null;

    function computeWantedKinds(song) {
        const kinds = [];
        const skipAudio = !!song._skipAudio;
        const lyricOnly = !!song._lyricOnly;
        const wantLyric = !!song._withLyric || lyricOnly;
        const dlMv = !!song._mvDownload;
        const mvStr = song.mv == null ? '' : String(song.mv);
        const hasMv = mvStr !== '' && mvStr !== '0';
        if (!skipAudio && !lyricOnly) kinds.push('audio');
        if (wantLyric) kinds.push('lyric');
        if (dlMv && hasMv) kinds.push('mv');
        return kinds;
    }

    function mergeSuccessKinds(successKindsBySongId) {
        for (const songId of Object.keys(successKindsBySongId || {})) {
            const kinds = successKindsBySongId[songId] || [];
            if (!kinds.length) continue;
            const key = String(songId);
            const set = pendingKinds.get(key) || new Set();
            for (const kind of kinds) set.add(kind);
            pendingKinds.set(key, set);
        }
    }

    function hasActiveTaskForPending() {
        if (!pendingKinds.size) return false;
        const tasks = store.get().downloadTasks || [];
        for (const task of tasks) {
            if (task.status !== 'active' && task.status !== 'waiting') continue;
            for (const track of task.tracks || []) {
                if (!track || !track.songId) continue;
                if (!pendingKinds.has(String(track.songId))) continue;
                if (
                    track.status === 'queued' ||
                    track.status === 'resolving' ||
                    track.status === 'downloading' ||
                    track.status === 'tagging'
                ) {
                    return true;
                }
            }
        }
        return false;
    }

    function applyPlans(plans) {
        const downloads = [...store.get().downloads];
        const removedIds = new Set();
        for (const plan of plans) {
            const idx = downloads.findIndex((d) => String(d.id) === String(plan.song.id));
            if (idx < 0) continue;
            if (plan.remaining.length === 0) {
                removedIds.add(String(plan.song.id));
                downloads.splice(idx, 1);
            } else {
                const needAudio = plan.remaining.includes('audio');
                const needLyric = plan.remaining.includes('lyric');
                const needMv = plan.remaining.includes('mv');
                const updated = { ...downloads[idx] };
                if (needAudio) {
                    updated._skipAudio = false;
                    updated._lyricOnly = false;
                    updated._withLyric = needLyric;
                } else if (needLyric) {
                    updated._skipAudio = true;
                    updated._lyricOnly = true;
                    updated._withLyric = false;
                } else {
                    updated._skipAudio = true;
                    updated._lyricOnly = false;
                    updated._withLyric = false;
                }
                updated._mvDownload = needMv;
                downloads[idx] = updated;
            }
        }
        store.update({ downloads });
        store.persist();
        if (removedIds.size > 0) {
            const sel = store.get().selection;
            const newSel = sel.filter((s) => !removedIds.has(String(s.id)));
            if (newSel.length !== sel.length) {
                store.update({ selection: newSel });
            }
        }
    }

    function clearPending(ids) {
        for (const id of ids || []) {
            pendingKinds.delete(String(id));
        }
    }

    function showCompletionPrompt(plans, ids) {
        const body = el('div', { class: 'download-complete-prompt' });
        body.appendChild(el('p', { text: '是否移除已完成下载的项？' }));
        openModal({
            title: '下载完成',
            body,
            confirmText: '移除',
            cancelText: '保留',
            onConfirm: () => {
                applyPlans(plans);
                clearPending(ids);
            },
            onCancel: () => {
                clearPending(ids);
            },
        });
    }

    function schedulePrompt() {
        if (promptTimer) return;
        promptTimer = setTimeout(() => {
            promptTimer = null;
            if (!pendingKinds.size) return;
            if (document.querySelector('.ena-modal.is-open')) {
                schedulePrompt();
                return;
            }
            if (hasActiveTaskForPending()) {
                schedulePrompt();
                return;
            }
            const downloads = store.get().downloads;
            if (!downloads.length) {
                pendingKinds.clear();
                return;
            }
            const plans = [];
            const ids = [];
            for (const [songId, kindSet] of pendingKinds) {
                const succeeded = Array.from(kindSet);
                const song = downloads.find((d) => String(d.id) === String(songId));
                if (!song) continue;
                const wanted = computeWantedKinds(song);
                if (!wanted.length) continue;
                const remaining = wanted.filter((k) => !succeeded.includes(k));
                plans.push({ song, succeeded, remaining });
                ids.push(songId);
            }
            if (!plans.length) {
                pendingKinds.clear();
                return;
            }
            showCompletionPrompt(plans, ids);
        }, 200);
    }

    downloader.onTaskComplete = (info) => {
        if (!info || !info.successKindsBySongId) return;
        mergeSuccessKinds(info.successKindsBySongId);
        schedulePrompt();
    };
})();

(function bindPlaybackAutoClose() {
    let lastView = store.get().view;
    let lastTrackCount = store.get().queue.tracks.length;
    store.subscribe((state) => {
        const viewChanged = state.view !== lastView;
        const trackCount = state.queue.tracks.length;
        const queueCleared = lastTrackCount > 0 && trackCount === 0;
        lastView = state.view;
        lastTrackCount = trackCount;
        if (!state.playbackOpen) return;
        if (viewChanged || queueCleared) {
            store.update({ playbackOpen: false });
        }
    });
})();

(function scheduleAboutAutoShow() {
    if (!shouldShowAbout(config)) return;
    const fire = () => setTimeout(() => openAboutModal(ctx), 600);
    if (document.readyState === 'complete') fire();
    else window.addEventListener('load', fire, { once: true });
})();
(async function bootstrapWiki() {
    try {
        const map = await getAllWiki();
        if (map.size === 0) return;
        store.update({
            wikiMap: map,
            wikiOptions: collectWikiOptions(map),
        });
        console.log('[bootstrap] wikiMap 加载完成:', map.size);
    } catch (e) {
        console.warn('[bootstrap] wikiMap 加载失败:', e);
    }
})();

function initSidebarResizer() {
    const resizer = document.getElementById('sidebar-resizer');
    if (!resizer) return;

    const MIN = 180;
    const MAX = 500;
    const DEFAULT = 260;
    const COLLAPSE = 64;

    let collapsed = !!store.get().sidebarCollapsed;

    function getZoom() {
        const z = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--page-zoom')
        );
        return (isFinite(z) && z > 0) ? z : 1;
    }

    function applyWidth(px) {
        document.documentElement.style.setProperty('--sidebar-width', px + 'px');
    }

    function toggleCollapsedClass(next) {
        if (collapsed === next) return;
        collapsed = next;
        document.body.classList.toggle('sidebar-collapsed', collapsed);
    }

    if (collapsed) {
        document.body.classList.add('sidebar-collapsed');
        applyWidth(COLLAPSE);
    } else {
        const saved = store.get().settings.sidebarWidth;
        if (typeof saved === 'number' && saved >= MIN && saved <= MAX) {
            applyWidth(saved);
        }
    }

    let dragging = false;
    let startX = 0;
    let startWidth = 0;
    let currentWidth = 0;

    function onPointerDown(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (window.matchMedia('(max-width: 900px)').matches) return;
        dragging = true;
        startX = e.clientX;
        const cur = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')
        );
        startWidth = isFinite(cur) ? cur : (collapsed ? COLLAPSE : DEFAULT);
        currentWidth = startWidth;
        resizer.classList.add('is-dragging');
        document.body.classList.add('sidebar-resizing');
        try { resizer.setPointerCapture(e.pointerId); } catch {}
        e.preventDefault();
    }

    function onPointerMove(e) {
        if (!dragging) return;
        const zoom = getZoom();
        const dx = (e.clientX - startX) / zoom;
        let raw = startWidth + dx;
        if (raw > MAX) raw = MAX;
        if (raw < COLLAPSE) raw = COLLAPSE;
        currentWidth = raw;
        applyWidth(raw);
        toggleCollapsedClass(raw < MIN);
    }

    function finishDrag() {
        if (!dragging) return;
        dragging = false;
        resizer.classList.remove('is-dragging');
        document.body.classList.remove('sidebar-resizing');

        if (collapsed) {
            requestAnimationFrame(() => applyWidth(COLLAPSE));
            store.update({
                sidebarCollapsed: true,
                sidebarExpanded: {
                    myfavorites: false,
                    downloads: false,
                    status: false,
                    queue: false,
                },
            });
        } else {
            store.update({
                sidebarCollapsed: false,
                settings: { ...store.get().settings, sidebarWidth: Math.round(currentWidth) },
            });
        }
        store.persist();
    }

    function onPointerUp(e) {
        if (!dragging) return;
        try { resizer.releasePointerCapture(e.pointerId); } catch {}
        finishDrag();
    }

    resizer.addEventListener('pointerdown', onPointerDown);
    resizer.addEventListener('pointermove', onPointerMove);

    window.addEventListener('pointerup', (e) => {
        if (!dragging) return;
        onPointerUp(e);
    });
    window.addEventListener('pointercancel', (e) => {
        if (!dragging) return;
        onPointerUp(e);
    });
    window.addEventListener('blur', () => {
        if (!dragging) return;
        finishDrag();
    });

    resizer.addEventListener('dblclick', () => {
        toggleCollapsedClass(false);
        currentWidth = DEFAULT;
        applyWidth(DEFAULT);
        store.update({
            sidebarCollapsed: false,
            settings: { ...store.get().settings, sidebarWidth: DEFAULT },
        });
        store.persist();
    });

    console.log('[sidebar] resizer 已就绪');
}

initSidebarResizer();

(function syncSearchTabsHeight() {
    const root = document.documentElement;
    let raf = null;

    function measure() {
        raf = null;
        const tabs = document.querySelector('.search-tabs');
        const h = tabs ? tabs.getBoundingClientRect().height : 0;
        root.style.setProperty('--search-tabs-height', (h > 0 ? h : 0) + 'px');
    }

    function schedule() {
        if (raf) return;
        raf = requestAnimationFrame(measure);
    }

    const contentArea = document.getElementById('content-area');
    if (contentArea && typeof MutationObserver !== 'undefined') {
        const mo = new MutationObserver(schedule);
        mo.observe(contentArea, { childList: true, subtree: true });
    }

    window.addEventListener('resize', schedule);
    schedule();
})();

themeManager.init();

window.__app = ctx;