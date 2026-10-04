import { config } from './config.js';
import { Meting } from './src/api.js';
import { store } from './src/store.js';
import { Player } from './src/player.js';
import { Downloader } from './src/downloader.js';
import { loadLyric, findCurrentIndex } from './src/lyric.js';
import {
    SearchView,
    QueueView,
    DownloadsView,
    StatusView,
    SettingsView,
    MyFavoritesView,
    openParseModal,
    openDownloadOptionsModal,
    openBatchAddModal,
    handleDownloadLyric,
} from './src/views.js';
import { Toast, closeAllMenus, AccountButton, openModal, icon, confirmDialog, Dropdown, shareSong, openShareCardModal } from './src/components.js';
import { initRouter } from './src/router.js';
import { initWikiProgressUI } from './src/wiki.js';
import { initPlaybackView } from './src/playback-view.js';
import { initSidebarTrees } from './src/sidebar-tree.js';

const api = new Meting(config);
const player = new Player(api, config);
const downloader = new Downloader(api, config);

store.applyTheme();

const MODE_ICONS = {
    order: '<path d="M1 3h8.5v1.2H1zM1 7.4h8.5v1.2H1zM1 11.8h8.5v1.2H1z"/><path d="M11 3.5L15 8l-4 4.5z"/>',
    shuffle: '<path fill-rule="evenodd" d="M0 3.5A.5.5 0 0 1 .5 3H1c2.202 0 3.827 1.24 4.874 2.418.49.552.865 1.102 1.126 1.532.26-.43.636-.98 1.126-1.532C9.173 4.24 10.798 3 13 3v1c-1.798 0-3.173 1.01-4.126 2.082A9.6 9.6 0 0 0 7.556 8a9.6 9.6 0 0 0 1.317 1.918C9.828 10.99 11.204 12 13 12v1c-2.202 0-3.827-1.24-4.874-2.418A10.6 10.6 0 0 1 7 9.05c-.26.43-.636.98-1.126 1.532C4.827 11.76 3.202 13 1 13H.5a.5.5 0 0 1 0-1H1c1.798 0 3.173-1.01 4.126-2.082A9.6 9.6 0 0 0 6.444 8a9.6 9.6 0 0 0-1.317-1.918C4.172 5.01 2.796 4 1 4H.5a.5.5 0 0 1-.5-.5"/><path d="M13 5.466V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192m0 9v-3.932a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192"/>',
    'repeat-one': '<path d="M11 4v1.466a.25.25 0 0 0 .41.192l2.36-1.966a.25.25 0 0 0 0-.384l-2.36-1.966a.25.25 0 0 0-.41.192V3H5a5 5 0 0 0-4.48 7.223.5.5 0 0 0 .896-.446A4 4 0 0 1 5 4zm4.48 1.777a.5.5 0 0 0-.896.446A4 4 0 0 1 11 12H5.001v-1.466a.25.25 0 0 0-.41-.192l-2.36 1.966a.25.25 0 0 0 0 .384l2.36 1.966a.25.25 0 0 0 .41-.192V13h6a5 5 0 0 0 4.48-7.223Z"/><path d="M9 5.5a.5.5 0 0 0-.854-.354l-1.75 1.75a.5.5 0 1 0 .708.708L8 6.707V10.5a.5.5 0 0 0 1 0z"/>',
    'repeat-all': '<path d="M11 5.466V4H5a4 4 0 0 0-3.584 5.777.5.5 0 1 1-.896.446A5 5 0 0 1 5 3h6V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192m3.81.086a.5.5 0 0 1 .67.225A5 5 0 0 1 11 13H5v1.466a.25.25 0 0 1-.41.192l-2.36-1.966a.25.25 0 0 1 0-.384l2.36-1.966a.25.25 0 0 1 .41.192V12h6a4 4 0 0 0 3.585-5.777.5.5 0 0 1 .225-.67Z"/>',
};

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
        cacheDetailMeta(kind, meta);
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
                    pic: meta.pic,
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
            const tracks = kind === 'playlist'
                ? await api.playlist(meta.id)
                : await api.album(meta.id);
            const cur = store.get().search;
            if (!cur.detail || cur.detail.id !== meta.id) return;
            store.update({
                search: { ...cur, detail: { ...cur.detail, tracks, loading: false } },
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
        let meta = getCachedDetailMeta('album', id);
        try {
            if (meta) throw null;
            const info = await api.albumInfo(id);
            if (info) {
                meta = {
                    id,
                    title: info.title,
                    artist: info.artist,
                    pic: info.pic,
                    trackCount: info._extra?.size || 0,
                    description: info._extra?.description || '',
                };
            }
        } catch {}

        if (!meta) {
            try {
                const tracks = await api.album(id);
                if (tracks.length) {
                    meta = {
                        id,
                        title: tracks[0].album || '未知专辑',
                        artist: tracks[0].artist || '',
                        pic: tracks[0].pic || '',
                        trackCount: tracks.length,
                        description: '',
                    };
                }
            } catch {}
        }

        if (!meta) {
            meta = { id, title: '未知专辑', artist: '', pic: '', trackCount: 0, description: '' };
        }

        return searchActions.openDetail('album', meta);
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

const ctx = { api, store, player, downloader, config, searchActions };
ctx.openParseModal = () => openParseModal(ctx);

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
        order: '顺序播放',
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

    queueBtn.addEventListener('click', () => {
        store.update({ view: 'queue' });
    });

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
            } else if (action === 'download-lyric') {
                handleDownloadLyric(currentSong, ctx);
            }
        });
    }

    progressEl.addEventListener('click', (e) => {
        const rect = progressEl.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        player.seek(percent);
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

    player.on('trackchange', (song) => loadPlayerLyric(song));
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

        if (playerMoreMenuEl) {
            playerMoreMenuEl.querySelectorAll('.player-more-item').forEach((item) => {
                item.disabled = !song;
            });
        }

        if (song) {
            titleEl.textContent = song.title || '未知歌曲';
            artistEl.textContent = song.artist || '未知歌手';

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
            artistEl.textContent = '从搜索结果中选择歌曲';
            if (coverEl.dataset.songId) {
                coverEl.dataset.songId = '';
                coverEl.innerHTML = '';
                coverEl.appendChild(createCoverPlaceholder());
            }
        }

        const total = q.duration || 0;
        const cur = q.currentTime || 0;
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

        const mode = q.playMode || 'order';
        modeBtn.title = modeLabels[mode] || '顺序播放';
        if (modeIconEl) {
            modeIconEl.innerHTML = MODE_ICONS[mode] || MODE_ICONS.order;
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

    function render() {
        host.innerHTML = '';

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
        }));
    }

    render();
    store.subscribe((state) => {
        const current = state.account;
        const last = host.__lastAccount;
        if (last && last.connected === current.connected && last.uid === current.uid && last.nickname === current.nickname && last.avatarUrl === current.avatarUrl) return;
        host.__lastAccount = { ...current };
        render();
    });
}

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
ctx.openAccountModal = openAccountModal;

initRouter(ctx);
initPlaybackView(ctx);
bindRouter();
initSidebarTrees(ctx);
initWikiProgressUI(store);
(function bootstrapWiki() {
    const req = indexedDB.open('mscd-wiki', 1);
    req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('songWiki')) return;
        const tx = db.transaction('songWiki', 'readonly');
        const store2 = tx.objectStore('songWiki');
        const map = new Map();
        store2.openCursor().onsuccess = (ev) => {
            const cur = ev.target.result;
            if (!cur) return;
            if (cur.value && !cur.value.failed && cur.value.data) {
                map.set(String(cur.key), cur.value.data);
            }
            cur.continue();
        };
        tx.oncomplete = () => {
            if (map.size === 0) return;
            const genre = new Set();
            const language = new Set();
            const bizTags = new Set();
            for (const entry of map.values()) {
                if (entry.genre) genre.add(String(entry.genre));
                if (entry.language) language.add(String(entry.language));
                for (const t of (entry.bizTags || [])) if (t) bizTags.add(String(t));
            }
            store.update({
                wikiMap: map,
                wikiOptions: {
                    genre: Array.from(genre).sort(),
                    language: Array.from(language).sort(),
                    bizTags: Array.from(bizTags).sort(),
                },
            });
            console.log('[bootstrap] wikiMap 加载完成:', map.size);
        };
    };
})();

window.__app = ctx;