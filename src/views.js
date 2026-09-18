import { el } from './dom.js';
import {
    icon,
    SongRow,
    CollectionCard,
    ArtistCard,
    AccountButton,
    EmptyState,
    LoadingState,
    ErrorState,
    Pagination,
    Toast,
    confirmDialog,
    openModal,
    Dropdown,
} from './components.js';
import {
    supportsFileSystemAccess,
    pickDownloadDir,
    clearSavedDir,
} from './downloader.js';

function hexToRgb(hex) {
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6) return { r: 0, g: 0, b: 0 };
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function pickTextColor(hex) {
    const { r, g, b } = hexToRgb(hex);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? '#1f2937' : '#ffffff';
}

function matchSearch(song, keyword) {
    if (!keyword) return true;
    const q = keyword.toLowerCase();
    const title = (song.title || '').toLowerCase();
    const artist = (song.artist || '').toLowerCase();
    const album = (song.album || '').toLowerCase();
    return title.includes(q) || artist.includes(q) || album.includes(q);
}

function openDownloadSettingsModal(ctx, options) {
    const { config } = ctx;
    const {
        title = '下载设置',
        initialQuality,
        initialWithLyric,
        initialLyricOnly = false,
        showLyricOnly = false,
        confirmText = '确认',
        onConfirm,
    } = options;

    let selectedQuality = initialQuality ?? config.quality.download;
    let withLyric = !!initialWithLyric;
    let lyricOnly = !!initialLyricOnly;

    const radioName = `quality-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const optionsEl = el('div', { class: 'ena-radio-group' });

    for (const level of config.quality.levels) {
        const input = el('input', { type: 'radio', name: radioName });
        if (selectedQuality === level.id) input.checked = true;

        const dot = el('span', { class: 'dot' });
        const label = el('label', { class: 'ena-radio' },
            input,
            dot,
            el('span', { text: level.label })
        );

        input.addEventListener('change', () => {
            if (input.checked) selectedQuality = level.id;
        });

        optionsEl.appendChild(label);
    }

    const checkboxInput = el('input', { type: 'checkbox' });
    if (withLyric) checkboxInput.checked = true;
    checkboxInput.addEventListener('change', () => {
        withLyric = checkboxInput.checked;
    });

    const checkboxLabel = el('label', { class: 'ena-checkbox' },
        checkboxInput,
        el('span', { class: 'box' }),
        el('span', { text: '同时下载歌词' })
    );

    const lyricOnlyInput = el('input', { type: 'checkbox' });
    if (lyricOnly) lyricOnlyInput.checked = true;

    const lyricOnlyLabel = el('label', { class: 'ena-checkbox' },
        lyricOnlyInput,
        el('span', { class: 'box' }),
        el('span', { text: '仅下载歌词' })
    );

    function syncDisabled() {
        for (const input of optionsEl.querySelectorAll('input')) {
            input.disabled = lyricOnly;
        }
        checkboxInput.disabled = lyricOnly;
        optionsEl.classList.toggle('is-disabled', lyricOnly);
        checkboxLabel.classList.toggle('is-disabled', lyricOnly);
    }

    lyricOnlyInput.addEventListener('change', () => {
        lyricOnly = lyricOnlyInput.checked;
        if (lyricOnly) withLyric = false;
        if (lyricOnly) checkboxInput.checked = false;
        syncDisabled();
    });

    const body = el('div', { class: 'download-options' });

    if (showLyricOnly) {
        body.appendChild(el('div', { class: 'download-options__checkbox' }, lyricOnlyLabel));
    }

    body.appendChild(el('div', { class: 'setting-label', text: '选择下载音质' }));
    body.appendChild(optionsEl);
    body.appendChild(el('div', { class: 'download-options__checkbox' }, checkboxLabel));

    syncDisabled();

    openModal({
        title,
        body,
        confirmText,
        onConfirm: () => {
            onConfirm({ quality: selectedQuality, withLyric, lyricOnly });
        },
    });
}

function openDownloadOptionsModal(song, ctx, mode = 'now') {
    const { store } = ctx;
    const isAddMode = mode === 'addToList';
    const settings = store.get().settings;

    openDownloadSettingsModal(ctx, {
        title: isAddMode ? '添加到下载列表' : '下载设置',
        initialQuality: settings.downloadQuality,
        initialWithLyric: settings.withLyric,
        initialLyricOnly: song._lyricOnly || false,
        showLyricOnly: isAddMode,
        confirmText: isAddMode ? '添加' : '开始下载',
        onConfirm: ({ quality, withLyric, lyricOnly }) => {
            store.update({
                settings: { ...store.get().settings, downloadQuality: quality, withLyric },
            });
            store.persist();

            const prepared = { ...song, _quality: quality, _withLyric: withLyric, _lyricOnly: lyricOnly };

            if (isAddMode) {
                addToDownloadList(prepared, store);
            } else {
                startSingleDownload(prepared, quality, ctx);
            }
        },
    });
}

function openBatchAddModal(songs, ctx, mode) {
    const { store } = ctx;
    const settings = store.get().settings;

    openDownloadSettingsModal(ctx, {
        title: mode === 'replace' ? '替换下载列表' : '添加到下载列表',
        initialQuality: settings.downloadQuality,
        initialWithLyric: settings.withLyric,
        initialLyricOnly: false,
        showLyricOnly: true,
        confirmText: mode === 'replace' ? '替换' : '添加',
        onConfirm: ({ quality, withLyric, lyricOnly }) => {
            const prepared = songs.map((s) => ({
                ...s,
                _quality: quality,
                _withLyric: withLyric,
                _lyricOnly: lyricOnly,
            }));

            if (mode === 'replace') {
                store.update({ downloads: prepared });
                store.persist();
                Toast(`已替换下载列表（${prepared.length} 首）`, 'success', 1600);
            } else {
                const downloads = [...store.get().downloads];
                const seen = new Set(downloads.map((d) => d.id).filter(Boolean));
                let added = 0;
                for (const song of prepared) {
                    if (!song.id || seen.has(song.id)) continue;
                    downloads.push(song);
                    seen.add(song.id);
                    added++;
                }
                if (!added) {
                    Toast('所选歌曲已全部在下载列表中', 'warning', 1600);
                    return;
                }
                store.update({ downloads });
                store.persist();
                Toast(`已添加 ${added} 首到下载列表`, 'success', 1600);
            }
            store.clearSelection();
        },
    });
}

function addToDownloadList(song, store) {
    if (song._type) {
        Toast('专辑/歌单不能直接加入下载列表', 'warning', 1600);
        return;
    }
    const downloads = store.get().downloads;
    if (song.id && downloads.some((d) => d.id === song.id)) {
        Toast('已在下载列表中', 'warning', 1600);
        return;
    }
    store.update({ downloads: [...downloads, song] });
    store.persist();
    Toast(`已加入下载列表：${song.title}`, 'success', 1600);
}

async function startSingleDownload(song, quality, ctx) {
    const { downloader, store } = ctx;
    const mode = store.get().settings.downloadMode;
    try {
        if (mode === 'stream') {
            await downloader.downloadToDisk(song, quality);
        } else {
            await downloader.downloadOne(song, quality);
        }
        Toast(`已下载：${song.title}`, 'success', 1800);
    } catch (err) {
        if (err?.name === 'AbortError' || String(err?.message || '').includes('取消')) return;
        Toast(`下载失败：${err.message}`, 'danger', 2600);
    }
}

async function handleDownloadLyric(song, ctx) {
    const { downloader } = ctx;
    try {
        await downloader.downloadLyric(song);
        Toast(`已下载歌词：${song.title}`, 'success', 1800);
    } catch (err) {
        Toast(`歌词下载失败：${err.message}`, 'danger', 2600);
    }
}

function songRowHandlers(song, ctx, extra = {}) {
    const { store, player } = ctx;
    const state = store.get();
    const selected = state.selection.some((s) => s.id === song.id);

    return {
        selectable: true,
        selected,
        onToggleSelect: (s) => store.toggleSelection(s),
        onPlay: (s) => player.playNow(s),
        onPlayNext: (s) => {
            player.playNext(s);
            Toast(`已设为下一首播放：${s.title}`, 'success', 1600);
        },
        onDownloadNow: (s) => openDownloadOptionsModal(s, ctx, 'now'),
        onDownloadLyric: (s) => handleDownloadLyric(s, ctx),
        onAddDownloadList: (s) => openDownloadOptionsModal(s, ctx, 'addToList'),
        ...extra,
    };
}

function collectionMeta(item) {
    return {
        id: item.id,
        title: item.title,
        artist: item.artist,
        pic: item.pic,
        trackCount: item._type === 'playlist'
            ? (item._extra?.trackCount || 0)
            : (item._extra?.size || 0),
        description: item._extra?.description || '',
    };
}

export function SearchView(ctx) {
    const { store, player, api } = ctx;
    const root = el('div', { class: 'search-view' });
    let lastSearch = null;

    function openArtistDetail(meta) {
        return ctx.searchActions.openArtist(meta.id, meta);
    }

    function openDetail(kind, meta) {
        return ctx.searchActions.openDetail(kind, meta);
    }

    function renderArtistOverview(detail) {
        const songs = (detail.tracks || []).slice(0, 12);
        const albums = (detail.albums || []).slice(0, 12);

        const songsSection = el('div', { class: 'artist-section' });
        const songsHeader = el('div', { class: 'artist-section__header' });
        songsHeader.appendChild(el('div', { class: 'view-title', text: '热门单曲' }));
        const songsAllBtn = el('button', { class: 'ena-btn ena-btn--sm' }, '查看全部热门单曲');
        songsAllBtn.addEventListener('click', () => {
            const cur = store.get().search;
            if (!cur.detail) return;
            store.update({
                search: { ...cur, detail: { ...cur.detail, view: 'songs', hotSongsPage: 1 } },
            });
        });
        songsHeader.appendChild(songsAllBtn);
        songsSection.appendChild(songsHeader);

        if (!songs.length) {
            songsSection.appendChild(EmptyState('暂无单曲', 'music'));
            store.setVisibleTracks([]);
        } else {
            const list = el('div', { class: 'song-list' });
            for (const song of songs) {
                list.appendChild(SongRow(song, songRowHandlers(song, ctx)));
            }
            songsSection.appendChild(list);
            store.setVisibleTracks(songs);
        }
        root.appendChild(songsSection);

        const albumsSection = el('div', { class: 'artist-section' });
        const albumsHeader = el('div', { class: 'artist-section__header' });
        albumsHeader.appendChild(el('div', { class: 'view-title', text: '专辑' }));
        const albumsAllBtn = el('button', { class: 'ena-btn ena-btn--sm' }, '查看全部');
        albumsAllBtn.addEventListener('click', () => {
            const cur = store.get().search;
            if (!cur.detail) return;
            store.update({
                search: { ...cur, detail: { ...cur.detail, view: 'albums', albumsPage: 1 } },
            });
        });
        albumsHeader.appendChild(albumsAllBtn);
        albumsSection.appendChild(albumsHeader);

        if (!albums.length) {
            albumsSection.appendChild(EmptyState('暂无专辑', 'music'));
        } else {
            const list = el('div', { class: 'song-list song-list--album' });
            for (const album of albums) {
                list.appendChild(CollectionCard(album, {
                    onOpen: () => openDetail('album', collectionMeta(album)),
                }));
            }
            albumsSection.appendChild(list);
        }
        root.appendChild(albumsSection);
    }

    function renderArtistSongs(detail) {
        const all = detail.tracks || [];
        if (!all.length) {
            root.appendChild(EmptyState('暂无单曲', 'music'));
            store.setVisibleTracks([]);
            return;
        }

        const perPage = store.get().settings.perPage;
        const totalPages = Math.max(1, Math.ceil(all.length / perPage));
        const page = Math.min(Math.max(1, detail.hotSongsPage || 1), totalPages);
        const start = (page - 1) * perPage;
        const slice = all.slice(start, start + perPage);

        store.setVisibleTracks(slice);

        const header = el('div', { class: 'artist-section__header' });
        const backBtn = el('button', {
            class: 'ena-btn ena-btn--icon',
            title: '返回',
        }, icon('chevron-left'));
        backBtn.addEventListener('click', () => {
            const cur = store.get().search;
            if (!cur.detail) return;
            store.update({
                search: { ...cur, detail: { ...cur.detail, view: 'overview' } },
            });
        });
        header.appendChild(backBtn);
        header.appendChild(el('div', { class: 'view-title', text: '全部热门单曲' }));
        root.appendChild(header);

        const list = el('div', { class: 'song-list' });
        for (const song of slice) {
            list.appendChild(SongRow(song, songRowHandlers(song, ctx)));
        }
        root.appendChild(list);

        if (totalPages > 1) {
            root.appendChild(Pagination({
                page,
                totalPages,
                onPage: (p) => {
                    const cur = store.get().search;
                    if (!cur.detail) return;
                    store.update({
                        search: { ...cur, detail: { ...cur.detail, hotSongsPage: p } },
                    });
                },
            }));
        }
    }

    function renderArtistAlbums(detail) {
        const all = detail.albums || [];
        if (!all.length) {
            root.appendChild(EmptyState('暂无专辑', 'music'));
            store.setVisibleTracks([]);
            return;
        }

        const perPage = store.get().settings.perPage;
        const totalPages = Math.max(1, Math.ceil(all.length / perPage));
        const page = Math.min(Math.max(1, detail.albumsPage || 1), totalPages);
        const start = (page - 1) * perPage;
        const slice = all.slice(start, start + perPage);

        store.setVisibleTracks([]);

        const header = el('div', { class: 'artist-section__header' });
        const backBtn = el('button', {
            class: 'ena-btn ena-btn--icon',
            title: '返回',
        }, icon('chevron-left'));
        backBtn.addEventListener('click', () => {
            const cur = store.get().search;
            if (!cur.detail) return;
            store.update({
                search: { ...cur, detail: { ...cur.detail, view: 'overview' } },
            });
        });
        header.appendChild(backBtn);
        header.appendChild(el('div', { class: 'view-title', text: '全部专辑' }));
        root.appendChild(header);

        const list = el('div', { class: 'song-list song-list--album' });
        for (const album of slice) {
            list.appendChild(CollectionCard(album, {
                onOpen: () => openDetail('album', collectionMeta(album)),
            }));
        }
        root.appendChild(list);

        if (totalPages > 1) {
            root.appendChild(Pagination({
                page,
                totalPages,
                onPage: (p) => {
                    const cur = store.get().search;
                    if (!cur.detail) return;
                    store.update({
                        search: { ...cur, detail: { ...cur.detail, albumsPage: p } },
                    });
                },
            }));
        }
    }

    function renderArtistDetail(detail) {
        root.innerHTML = '';

        const header = el('div', { class: 'detail-header' });
        const bg = el('div', { class: 'detail-header__bg' });
        if (detail.pic) bg.style.backgroundImage = `url("${detail.pic}")`;
        header.appendChild(bg);

        const cover = el('div', { class: 'detail-header__cover artist-detail__cover' });
        if (detail.pic) {
            const img = el('img', { src: detail.pic, alt: '' });
            img.addEventListener('error', () => {
                cover.innerHTML = '';
                cover.appendChild(icon('music'));
            });
            cover.appendChild(img);
        } else {
            cover.appendChild(icon('music'));
        }

        const infoChildren = [
            el('div', { class: 'detail-header__title', text: detail.name || detail.title || '未知' }),
        ];
        if (detail.alias) {
            infoChildren.push(el('div', {
                class: 'artist-detail__alias',
                text: detail.alias,
            }));
        }
        infoChildren.push(el('div', {
            class: 'artist-detail__stats',
            text: `专辑 ${detail.albumSize || 0}　　单曲 ${detail.musicSize || 0}`,
        }));
        if (detail.briefDesc) {
            infoChildren.push(el('div', {
                class: 'detail-header__description',
                text: detail.briefDesc,
            }));
        }

        const info = el('div', { class: 'detail-header__info' }, ...infoChildren);
        header.appendChild(el('div', { class: 'detail-header__inner' }, cover, info));
        root.appendChild(header);

        if (detail.loading) {
            root.appendChild(LoadingState('正在加载歌手信息…'));
            store.setVisibleTracks([]);
            return;
        }

        if (detail.error) {
            root.appendChild(ErrorState(detail.error, () => openArtistDetail({
                id: detail.id,
                title: detail.name,
                pic: detail.pic,
                artist: detail.alias,
            })));
            store.setVisibleTracks([]);
            return;
        }

        const view = detail.view || 'overview';
        if (view === 'songs') {
            renderArtistSongs(detail);
        } else if (view === 'albums') {
            renderArtistAlbums(detail);
        } else {
            renderArtistOverview(detail);
        }
    }

    function renderDetail(detail) {
        root.innerHTML = '';

        const header = el('div', { class: 'detail-header' });

        const bg = el('div', { class: 'detail-header__bg' });
        if (detail.pic) bg.style.backgroundImage = `url("${detail.pic}")`;
        header.appendChild(bg);

        const cover = el('div', { class: 'detail-header__cover' });
        if (detail.pic) {
            const img = el('img', { src: detail.pic, alt: '' });
            img.addEventListener('error', () => {
                cover.innerHTML = '';
                cover.appendChild(icon('music'));
            });
            cover.appendChild(img);
        } else {
            cover.appendChild(icon('music'));
        }

        const count = detail.trackCount || detail.tracks.length;

        const metaChildren = [];
        if (detail.artist) {
            metaChildren.push(el('span', { class: 'detail-header__artist', text: detail.artist }));
        }
        metaChildren.push(el('span', { class: 'detail-header__count', text: `共 ${count} 首` }));

        const playAllBtn = el('button', {
            class: 'ena-btn ena-btn--sm ena-btn--primary',
            title: '播放全部',
        }, icon('play', true), el('span', { text: '播放全部' }));

        playAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!detail.tracks.length) {
                Toast('暂无可播放的歌曲', 'warning', 1600);
                return;
            }
            player.setQueue(detail.tracks, 0, true);
            Toast(`开始播放 ${detail.tracks.length} 首`, 'success', 1600);
        });

        const downloadAllBtn = el('button', {
            class: 'ena-btn ena-btn--sm',
            title: '下载全部',
        }, icon('download'), el('span', { text: '下载全部' }));

        downloadAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!detail.tracks.length) {
                Toast('暂无可下载的歌曲', 'warning', 1600);
                return;
            }
            openBatchAddModal(detail.tracks, ctx, 'append');
        });

        const infoChildren = [];

        infoChildren.push(el('div', { class: 'detail-header__title', text: detail.title || '未知' }));

        if (detail.description) {
            infoChildren.push(el('div', {
                class: 'detail-header__description',
                text: detail.description,
            }));
        }

        infoChildren.push(el('div', { class: 'detail-header__meta' }, ...metaChildren));
        infoChildren.push(el('div', { class: 'detail-header__actions' }, playAllBtn, downloadAllBtn));

        const info = el('div', { class: 'detail-header__info' }, ...infoChildren);

        header.appendChild(el('div', { class: 'detail-header__inner' }, cover, info));
        root.appendChild(header);

        if (detail.loading) {
            root.appendChild(LoadingState('正在加载曲目…'));
            store.setVisibleTracks([]);
            return;
        }

        if (detail.error) {
            root.appendChild(ErrorState(detail.error, () => openDetail(detail.kind, detail)));
            store.setVisibleTracks([]);
            return;
        }

        if (!detail.tracks.length) {
            root.appendChild(EmptyState('没有曲目', 'music'));
            store.setVisibleTracks([]);
            return;
        }

        const perPage = store.get().settings.perPage;
        const totalPages = Math.max(1, Math.ceil(detail.tracks.length / perPage));
        const page = Math.min(Math.max(1, detail.page || 1), totalPages);
        const start = (page - 1) * perPage;
        const slice = detail.tracks.slice(start, start + perPage);

        store.setVisibleTracks(slice);

        const list = el('div', { class: 'song-list' });
        for (const song of slice) {
            list.appendChild(SongRow(song, songRowHandlers(song, ctx)));
        }
        root.appendChild(list);

        if (totalPages > 1) {
            root.appendChild(Pagination({
                page,
                totalPages,
                onPage: (p) => {
                    const cur = store.get().search;
                    if (!cur.detail) return;
                    store.update({
                        search: { ...cur, detail: { ...cur.detail, page: p } },
                    });
                },
            }));
        }
    }

    const SEARCH_TABS = [
        { key: '0', label: '综合' },
        { key: '1', label: '单曲' },
        { key: '100', label: '歌手' },
        { key: '10', label: '专辑' },
        { key: '1000', label: '歌单' },
    ];

    const AGG_SECTIONS = [
        { key: '1', label: '单曲' },
        { key: '100', label: '歌手' },
        { key: '10', label: '专辑' },
        { key: '1000', label: '歌单' },
    ];

    const AGG_SINGLE_LIMIT = 20;

    function trimToFirstRow(list) {
        const items = Array.from(list.children);
        if (items.length <= 1) return;
        const firstTop = items[0].offsetTop;
        let keep = 0;
        for (const it of items) {
            if (it.offsetTop === firstTop) keep++;
            else break;
        }
        if (keep >= items.length || keep === 0) return;
        for (let i = items.length - 1; i >= keep; i--) {
            items[i].remove();
        }
    }

    let tabsEl = null;
    let bodyEl = null;

    function ensureShell() {
        if (tabsEl) return;
        tabsEl = el('div', { class: 'search-tabs' });
        const tabsNav = el('div', { class: 'search-tabs__nav' });
        for (const t of SEARCH_TABS) {
            const btn = el('button', {
                class: 'search-tab',
                text: t.label,
                dataset: { key: t.key },
            });
            btn.addEventListener('click', () => {
                ctx.searchActions.switchTab(t.key);
            });
            tabsNav.appendChild(btn);
        }
        tabsEl.appendChild(tabsNav);
        tabsEl.appendChild(el('div', { class: 'search-tabs__total' }));
        bodyEl = el('div', { class: 'search-body' });
        root.appendChild(tabsEl);
        root.appendChild(bodyEl);
    }

    function syncTabs(type) {
        if (!tabsEl) return;
        tabsEl.querySelectorAll('.search-tab').forEach((b) => {
            b.classList.toggle('is-active', b.dataset.key === type);
        });
    }

    function renderItems(items, typeKey) {
        let listClass = 'song-list';
        if (typeKey === '1000') listClass += ' song-list--playlist';
        else if (typeKey === '10') listClass += ' song-list--album';
        else if (typeKey === '100') listClass += ' song-list--artist';

        const list = el('div', { class: listClass });
        const visibleTracks = [];

        for (const item of items) {
            if (typeKey === '100') {
                list.appendChild(ArtistCard(item, {
                    onOpen: () => openArtistDetail(item),
                }));
            } else if (typeKey === '10' || typeKey === '1000') {
                list.appendChild(CollectionCard(item, {
                    onOpen: () => openDetail(item._type, collectionMeta(item)),
                }));
            } else {
                list.appendChild(SongRow(item, songRowHandlers(item, ctx)));
                visibleTracks.push(item);
            }
        }

        return { list, visibleTracks };
    }

    function renderAggregate(search, host) {
        const allVisible = [];

        for (const { key, label } of AGG_SECTIONS) {
            const r = search.results[key];
            if (!r) continue;

            const section = el('div', { class: 'search-section' });
            const header = el('div', { class: 'search-section__header' });
            header.appendChild(el('div', { class: 'view-title', text: label }));

            if (r.loaded && r.items.length > 0) {
                const moreBtn = el('button', { class: 'ena-btn ena-btn--sm', text: '查看全部' });
                moreBtn.addEventListener('click', () => {
                    ctx.searchActions.switchTab(key);
                });
                header.appendChild(moreBtn);
            }

            section.appendChild(header);

            if (r.loading) {
                section.appendChild(LoadingState(`正在搜索${label}…`));
            } else if (r.error) {
                section.appendChild(ErrorState(r.error, () => {
                    ctx.searchActions.loadType(search.keyword, key, 1);
                }));
            } else if (!r.items.length) {
                section.appendChild(EmptyState(`没有找到相关${label}`, 'search'));
            } else {
                const slice = key === '1' ? r.items.slice(0, AGG_SINGLE_LIMIT) : r.items;
                const { list, visibleTracks } = renderItems(slice, key);
                section.appendChild(list);
                for (const t of visibleTracks) allVisible.push(t);
            }

            host.appendChild(section);

            if (key === '100' || key === '10') {
                const list = section.querySelector('.song-list');
                if (list) trimToFirstRow(list);
            }
        }

        store.setVisibleTracks(allVisible);
    }

    function renderSingleType(search, host) {
        const typeKey = search.type;
        const r = search.results[typeKey];

        if (!r || r.loading) {
            host.appendChild(LoadingState('正在搜索…'));
            store.setVisibleTracks([]);
            return;
        }

        if (r.error) {
            host.appendChild(ErrorState(r.error, () => {
                ctx.searchActions.loadType(search.keyword, typeKey, 1);
            }));
            store.setVisibleTracks([]);
            return;
        }

        if (!r.items.length) {
            host.appendChild(EmptyState('没有找到匹配结果', 'search'));
            store.setVisibleTracks([]);
            return;
        }

        const total = r.total || r.items.length;
        const totalEl = tabsEl.querySelector('.search-tabs__total');
        if (totalEl) {
            totalEl.textContent = `共获取到 ${total} 个结果`;
        }

        const { list, visibleTracks } = renderItems(r.items, typeKey);
        host.appendChild(list);
        store.setVisibleTracks(visibleTracks);

        const perPage = store.get().settings.perPage;
        const totalPages = total > 0 ? Math.ceil(total / perPage) : 0;
        if (totalPages > 1) {
            host.appendChild(Pagination({
                page: r.page || 1,
                totalPages,
                onPage: (p) => ctx.searchActions.loadType(search.keyword, typeKey, p),
            }));
        }
    }

    function render() {
        const state = store.get();
        const search = state.search;
        if (search === lastSearch) return;
        lastSearch = search;

        if (search.detail) {
            tabsEl = null;
            bodyEl = null;
            root.innerHTML = '';
            if (search.detail.kind === 'artist') {
                renderArtistDetail(search.detail);
            } else {
                renderDetail(search.detail);
            }
            return;
        }

        if (!tabsEl) {
            root.innerHTML = '';
            ensureShell();
        }

        if (!search.keyword) {
            tabsEl.classList.add('hidden');
            bodyEl.innerHTML = '';
            bodyEl.appendChild(EmptyState('输入关键词开始搜索', 'search'));
            store.setVisibleTracks([]);
            return;
        }

        tabsEl.classList.remove('hidden');
        const totalEl = tabsEl.querySelector('.search-tabs__total');
        if (totalEl) totalEl.textContent = '';
        syncTabs(search.type);
        bodyEl.innerHTML = '';

        if (search.type === '0') {
            renderAggregate(search, bodyEl);
        } else {
            renderSingleType(search, bodyEl);
        }
    }

    const unsubscribe = store.subscribe(render);

    return {
        node: root,
        destroy: () => unsubscribe(),
    };
}

export function LikedView(ctx) {
    const { store, player, api } = ctx;
    const root = el('div', { class: 'liked-view' });
    let lastAccount = null;
    let tracks = [];
    let loading = false;
    let loadError = null;
    let page = 1;
    let loaded = false;

    async function loadTracks(uid) {
        loading = true;
        loadError = null;
        render();

        try {
            const { playlists } = await api.userPlaylists(uid);
            const liked = playlists.find((p) => p._specialType === 5);
            if (!liked) {
                loadError = '未找到“我喜欢的音乐”歌单';
                loading = false;
                render();
                return;
            }

            const all = await api.fetchAllPlaylistTracks(liked.id, liked._extra.trackCount || 0);
            tracks = all;
            loaded = true;
            loading = false;
            page = 1;
            render();
        } catch (err) {
            loadError = err.message || '加载失败';
            loading = false;
            render();
        }
    }

    function render() {
        const state = store.get();
        const account = state.account;

        root.innerHTML = '';

        const header = el('div', { class: 'view-header' });
        const left = el('div', { class: 'view-header__left' });
        left.appendChild(el('div', { class: 'view-title', text: '收藏的音乐' }));

        const playAllBtn = el('button', {
            class: 'ena-btn ena-btn--sm ena-btn--primary',
            title: '播放全部',
        }, icon('play', true), el('span', { text: '播放全部' }));
        playAllBtn.disabled = !account.connected || !tracks.length;
        playAllBtn.addEventListener('click', () => {
            if (!tracks.length) return;
            player.setQueue(tracks, 0, true);
            Toast(`开始播放 ${tracks.length} 首`, 'success', 1600);
        });
        left.appendChild(playAllBtn);

        const downloadAllBtn = el('button', {
            class: 'ena-btn ena-btn--sm',
            title: '下载全部',
        }, icon('download'), el('span', { text: '下载全部' }));
        downloadAllBtn.disabled = !account.connected || !tracks.length;
        downloadAllBtn.addEventListener('click', () => {
            if (!tracks.length) return;
            openBatchAddModal(tracks, ctx, 'append');
        });
        left.appendChild(downloadAllBtn);

        const refreshBtn = el('button', {
            class: 'ena-btn ena-btn--sm',
            title: '刷新',
        }, icon('refresh'), el('span', { text: '刷新' }));
        refreshBtn.disabled = !account.connected;
        refreshBtn.addEventListener('click', () => {
            loaded = false;
            loadTracks(account.uid);
        });
        left.appendChild(refreshBtn);

        header.appendChild(left);
        header.appendChild(el('span', {
            class: 'view-header__count',
            text: `共 ${tracks.length} 首`,
        }));
        root.appendChild(header);

        if (!account.connected) {
            root.appendChild(EmptyState('请先连接网易云账户', 'user'));
            store.setVisibleTracks([]);
            return;
        }

        if (loading && !loaded) {
            root.appendChild(LoadingState('正在加载收藏的音乐…'));
            store.setVisibleTracks([]);
            return;
        }

        if (loadError) {
            root.appendChild(ErrorState(loadError, () => loadTracks(account.uid)));
            store.setVisibleTracks([]);
            return;
        }

        if (!tracks.length) {
            root.appendChild(EmptyState('收藏的音乐为空', 'heart'));
            store.setVisibleTracks([]);
            return;
        }

        const perPage = state.settings.perPage;
        const totalPages = Math.max(1, Math.ceil(tracks.length / perPage));
        const currentPage = Math.min(Math.max(1, page), totalPages);
        const start = (currentPage - 1) * perPage;
        const slice = tracks.slice(start, start + perPage);

        store.setVisibleTracks(slice);

        const list = el('div', { class: 'song-list' });
        for (const song of slice) {
            list.appendChild(SongRow(song, songRowHandlers(song, ctx)));
        }
        root.appendChild(list);

        if (totalPages > 1) {
            root.appendChild(Pagination({
                page: currentPage,
                totalPages,
                onPage: (p) => {
                    page = p;
                    render();
                },
            }));
        }
    }

    const unsubscribe = store.subscribe((state) => {
        const account = state.account;
        if (lastAccount && lastAccount.uid === account.uid && lastAccount.connected === account.connected) {
            return;
        }
        lastAccount = { uid: account.uid, connected: account.connected };
        if (account.connected && !loaded && !loading) {
            loadTracks(account.uid);
        } else if (!account.connected) {
            loaded = false;
            tracks = [];
            loadError = null;
            render();
        }
    });

    return {
        node: root,
        destroy: () => unsubscribe(),
    };
}

export function QueueView(ctx) {
    const { store, player } = ctx;
    const root = el('div', { class: 'queue-view' });

    const toolbar = el('div', { class: 'view-toolbar' });

    const searchWrap = el('div', { class: 'view-search' });
    const searchInputWrap = el('div', { class: 'ena-input-wrap' });
    const searchIcon = icon('search');
    searchIcon.setAttribute('class', 'ena-input-icon');
    const searchInput = el('input', {
        type: 'text',
        class: 'ena-input ena-input--icon',
        placeholder: '搜索歌曲或艺人…',
        value: store.get().queueSearch || '',
    });
    searchInput.addEventListener('input', (e) => {
        store.update({ queueSearch: e.target.value, queuePage: 1 });
    });
    searchInputWrap.appendChild(searchIcon);
    searchInputWrap.appendChild(searchInput);
    searchWrap.appendChild(searchInputWrap);
    toolbar.appendChild(searchWrap);

    const removeBtn = el('button', { class: 'ena-btn ena-btn--sm' }, '移除');
    removeBtn.addEventListener('click', () => {
        const state = store.get();
        const ids = new Set(state.selection.map((s) => s.id).filter(Boolean));
        if (!ids.size) return;
        const q = state.queue;
        const tracks = q.tracks.filter((t) => !ids.has(t.id));
        const removedCurrent = q.currentIndex >= 0 && ids.has(q.tracks[q.currentIndex]?.id);
        let currentIndex = q.currentIndex;

        if (removedCurrent) {
            currentIndex = -1;
            player.audio.pause();
            player.audio.removeAttribute('src');
        } else if (currentIndex >= 0) {
            const before = q.tracks.slice(0, currentIndex).filter((t) => ids.has(t.id)).length;
            currentIndex -= before;
        }

        store.update({
            queue: {
                ...q,
                tracks,
                currentIndex: tracks.length ? Math.min(Math.max(currentIndex, 0), tracks.length - 1) : -1,
                isPlaying: removedCurrent ? false : q.isPlaying,
                currentTime: removedCurrent ? 0 : q.currentTime,
                duration: removedCurrent ? 0 : q.duration,
            },
            selection: state.selection.filter((s) => !ids.has(s.id)),
        });
        store.persist();
    });
    toolbar.appendChild(removeBtn);

    const clearBtn = el('button', { class: 'ena-btn ena-btn--sm' }, '清空');
    clearBtn.addEventListener('click', async () => {
        const ok = await confirmDialog('确定清空播放队列吗？');
        if (!ok) return;
        store.update({
            queue: { ...store.get().queue, tracks: [], currentIndex: -1, isPlaying: false, currentTime: 0, duration: 0 },
            queuePage: 1,
        });
        player.audio.pause();
        player.audio.removeAttribute('src');
        store.persist();
    });
    toolbar.appendChild(clearBtn);

    root.appendChild(toolbar);

    const listHost = el('div');
    root.appendChild(listHost);

    let lastTracks = null;
    let lastIndex = -1;
    let lastPlaying = null;
    let lastSearch = null;
    let lastPage = null;
    let lastPerPage = null;

    function render() {
        const state = store.get();
        const q = state.queue;
        const search = state.queueSearch || '';
        const page = state.queuePage || 1;
        const perPage = state.settings.perPage;

        if (searchInput.value !== search) searchInput.value = search;

        const hasTracks = q.tracks.length > 0;
        searchInput.disabled = !hasTracks;
        clearBtn.disabled = !hasTracks;
        const selectedInQueue = state.selection.some((s) => q.tracks.some((t) => t.id === s.id));
        removeBtn.disabled = !hasTracks || !selectedInQueue;

        if (
            q.tracks === lastTracks &&
            q.currentIndex === lastIndex &&
            q.isPlaying === lastPlaying &&
            search === lastSearch &&
            page === lastPage &&
            perPage === lastPerPage
        ) return;

        lastTracks = q.tracks;
        lastIndex = q.currentIndex;
        lastPlaying = q.isPlaying;
        lastSearch = search;
        lastPage = page;
        lastPerPage = perPage;

        listHost.innerHTML = '';

        if (!q.tracks.length) {
            listHost.appendChild(EmptyState('队列为空', 'list'));
            store.setVisibleTracks([]);
            return;
        }

        const items = [];
        q.tracks.forEach((song, idx) => {
            if (matchSearch(song, search)) items.push({ song, index: idx });
        });

        if (!items.length) {
            listHost.appendChild(EmptyState('没有匹配的歌曲', 'search'));
            store.setVisibleTracks([]);
            return;
        }

        const totalPages = Math.max(1, Math.ceil(items.length / perPage));
        const currentPage = Math.min(Math.max(1, page), totalPages);
        const start = (currentPage - 1) * perPage;
        const slice = items.slice(start, start + perPage);

        store.setVisibleTracks(slice.map((it) => it.song));

        const list = el('div', { class: 'song-list' });
        for (const { song, index } of slice) {
            const row = SongRow(song, songRowHandlers(song, ctx, {
                hidePlayNextMenu: true,
                onPlay: () => player.playAt(index),
                onRemove: () => removeAt(index),
            }));

            if (index === q.currentIndex) {
                row.classList.add('is-current');
                if (q.isPlaying) row.classList.add('is-playing');
            }

            list.appendChild(row);
        }
        listHost.appendChild(list);

        if (totalPages > 1) {
            listHost.appendChild(Pagination({
                page: currentPage,
                totalPages,
                onPage: (p) => store.update({ queuePage: p }),
            }));
        }
    }

    function removeAt(index) {
        const q = store.get().queue;
        const tracks = [...q.tracks];
        const wasCurrent = index === q.currentIndex;
        tracks.splice(index, 1);

        if (tracks.length === 0) {
            player.audio.pause();
            player.audio.removeAttribute('src');
            store.update({
                queue: { ...q, tracks: [], currentIndex: -1, isPlaying: false, currentTime: 0, duration: 0 },
                queuePage: 1,
            });
            store.persist();
            return;
        }

        if (wasCurrent) {
            const nextIndex = Math.min(index, tracks.length - 1);
            store.update({ queue: { ...q, tracks } });
            player.playAt(nextIndex);
            return;
        }

        const currentIndex = index < q.currentIndex ? q.currentIndex - 1 : q.currentIndex;
        store.update({ queue: { ...q, tracks, currentIndex } });
        store.persist();
    }

    const unsubscribe = store.subscribe(render);

    return {
        node: root,
        destroy: () => unsubscribe(),
    };
}

export function MyPlaylistsView(ctx) {
    const { store, api } = ctx;
    const root = el('div', { class: 'myplaylists-view' });
    let lastAccount = null;
    let playlists = [];
    let loading = false;
    let loadError = null;
    let page = 1;
    let loaded = false;

    async function loadPlaylists(uid) {
        loading = true;
        loadError = null;
        render();

        try {
            const { playlists: all } = await api.userPlaylists(uid);
            const mine = all.filter((p) =>
                p._creatorId === uid &&
                !p._subscribed &&
                p._privacy === 0
            );
            playlists = mine;
            loaded = true;
            loading = false;
            page = 1;
            render();
        } catch (err) {
            loadError = err.message || '加载失败';
            loading = false;
            render();
        }
    }

    function render() {
        const state = store.get();
        const account = state.account;

        root.innerHTML = '';

        const header = el('div', { class: 'view-header' });
        const left = el('div', { class: 'view-header__left' });
        left.appendChild(el('div', { class: 'view-title', text: '我的歌单' }));

        const refreshBtn = el('button', {
            class: 'ena-btn ena-btn--sm',
            title: '刷新',
        }, icon('refresh'), el('span', { text: '刷新' }));
        refreshBtn.disabled = !account.connected;
        refreshBtn.addEventListener('click', () => {
            loaded = false;
            loadPlaylists(account.uid);
        });
        left.appendChild(refreshBtn);

        header.appendChild(left);
        header.appendChild(el('span', {
            class: 'view-header__count',
            text: `共 ${playlists.length} 个`,
        }));
        root.appendChild(header);

        if (!account.connected) {
            root.appendChild(EmptyState('请先连接网易云账户', 'user'));
            return;
        }

        if (loading && !loaded) {
            root.appendChild(LoadingState('正在加载歌单…'));
            return;
        }

        if (loadError) {
            root.appendChild(ErrorState(loadError, () => loadPlaylists(account.uid)));
            return;
        }

        if (!playlists.length) {
            root.appendChild(EmptyState('没有公开的歌单', 'list'));
            return;
        }

        const perPage = state.settings.perPage;
        const totalPages = Math.max(1, Math.ceil(playlists.length / perPage));
        const currentPage = Math.min(Math.max(1, page), totalPages);
        const start = (currentPage - 1) * perPage;
        const slice = playlists.slice(start, start + perPage);

        const grid = el('div', { class: 'song-list song-list--playlist' });
        for (const item of slice) {
            grid.appendChild(CollectionCard(item, {
                onOpen: () => {
                    ctx.searchActions.openDetail('playlist', {
                        id: item.id,
                        title: item.title,
                        artist: item.artist,
                        pic: item.pic,
                        trackCount: item._extra?.trackCount || 0,
                        description: item._extra?.description || '',
                    });
                },
            }));
        }
        root.appendChild(grid);

        if (totalPages > 1) {
            root.appendChild(Pagination({
                page: currentPage,
                totalPages,
                onPage: (p) => {
                    page = p;
                    render();
                },
            }));
        }
    }

    const unsubscribe = store.subscribe((state) => {
        const account = state.account;
        if (lastAccount && lastAccount.uid === account.uid && lastAccount.connected === account.connected) {
            return;
        }
        lastAccount = { uid: account.uid, connected: account.connected };
        if (account.connected && !loaded && !loading) {
            loadPlaylists(account.uid);
        } else if (!account.connected) {
            loaded = false;
            playlists = [];
            loadError = null;
            render();
        }
    });

    return {
        node: root,
        destroy: () => unsubscribe(),
    };
}

export function DownloadsView(ctx) {
    const { store, player, downloader } = ctx;
    const root = el('div', { class: 'downloads-view' });

    const toolbar = el('div', { class: 'view-toolbar' });

    const searchWrap = el('div', { class: 'view-search' });
    const searchInputWrap = el('div', { class: 'ena-input-wrap' });
    const searchIcon = icon('search');
    searchIcon.setAttribute('class', 'ena-input-icon');
    const searchInput = el('input', {
        type: 'text',
        class: 'ena-input ena-input--icon',
        placeholder: '搜索歌曲或艺人…',
        value: store.get().downloadsSearch || '',
    });
    searchInput.addEventListener('input', (e) => {
        store.update({ downloadsSearch: e.target.value, downloadsPage: 1 });
    });
    searchInputWrap.appendChild(searchIcon);
    searchInputWrap.appendChild(searchInput);
    searchWrap.appendChild(searchInputWrap);
    toolbar.appendChild(searchWrap);

    const allBtn = el('button', { class: 'ena-btn ena-btn--primary ena-btn--sm' }, '全部下载');
    allBtn.addEventListener('click', startDownloadAll);
    toolbar.appendChild(allBtn);

    const editBtn = el('button', { class: 'ena-btn ena-btn--sm' }, '编辑');
    editBtn.addEventListener('click', () => {
        if (store.get().selection.length > 0) openBatchEditModal();
    });
    toolbar.appendChild(editBtn);

    const removeBtn = el('button', { class: 'ena-btn ena-btn--sm' }, '移除');
    removeBtn.addEventListener('click', () => {
        const state = store.get();
        const ids = new Set(state.selection.map((s) => s.id).filter(Boolean));
        if (!ids.size) return;
        const downloads = state.downloads.filter((d) => !ids.has(d.id));
        store.update({
            downloads,
            downloadsPage: 1,
            selection: state.selection.filter((s) => !ids.has(s.id)),
        });
        store.persist();
    });
    toolbar.appendChild(removeBtn);

    const clearBtn = el('button', { class: 'ena-btn ena-btn--sm' }, '清空');
    clearBtn.addEventListener('click', async () => {
        const ok = await confirmDialog('确定清空下载列表吗？');
        if (!ok) return;
        store.update({ downloads: [], downloadsPage: 1 });
        store.persist();
    });
    toolbar.appendChild(clearBtn);

    root.appendChild(toolbar);

    const listHost = el('div');
    root.appendChild(listHost);

    let lastDownloads = null;
    let lastSearch = null;
    let lastPage = null;
    let lastPerPage = null;

    async function startDownloadAll() {
        const downloads = store.get().downloads;
        if (!downloads.length) {
            Toast('下载列表为空', 'warning', 1600);
            return;
        }

        const quality = store.get().settings.downloadQuality;
        const mode = store.get().settings.downloadMode;

        try {
            if (mode === 'stream') {
                const result = await downloader.downloadBatchToDisk(downloads, quality);
                if (result.failed > 0) {
                    Toast(`完成 ${result.successful} 首，失败 ${result.failed} 首`, 'warning', 2600);
                } else {
                    Toast(`已下载 ${result.successful} 首到本地目录`, 'success', 2200);
                }
            } else {
                const result = await downloader.downloadAsZip(downloads, quality);
                if (result.failed > 0) {
                    Toast(`完成 ${result.successful} 首，失败 ${result.failed} 首`, 'warning', 2600);
                } else {
                    Toast(`全部下载完成（${result.successful} 首）`, 'success', 2200);
                }
            }
        } catch (err) {
            const cancelled = err?.name === 'AbortError' || String(err?.message || '').includes('取消');
            if (!cancelled) Toast(`下载失败：${err.message}`, 'danger', 2600);
        }
    }

    async function startDownloadOne(song) {
        const quality = song._quality ?? store.get().settings.downloadQuality;
        const mode = store.get().settings.downloadMode;

        try {
            if (mode === 'stream') {
                await downloader.downloadToDisk(song, quality);
            } else {
                await downloader.downloadOne(song, quality);
            }
            Toast(`已下载：${song.title}`, 'success', 1800);
        } catch (err) {
            const cancelled = err?.name === 'AbortError' || String(err?.message || '').includes('取消');
            if (!cancelled) Toast(`下载失败：${err.message}`, 'danger', 2600);
        }
    }

    function openEditModal(song) {
        openDownloadSettingsModal(ctx, {
            title: '编辑下载设置',
            initialQuality: song._quality ?? store.get().settings.downloadQuality,
            initialWithLyric: song._withLyric ?? store.get().settings.withLyric,
            initialLyricOnly: song._lyricOnly || false,
            showLyricOnly: true,
            confirmText: '保存',
            onConfirm: ({ quality, withLyric, lyricOnly }) => {
                const downloads = store.get().downloads.map((d) =>
                    d.id === song.id ? { ...d, _quality: quality, _withLyric: withLyric, _lyricOnly: lyricOnly } : d
                );
                store.update({ downloads });
                store.persist();
                Toast('已更新下载设置', 'success', 1400);
            },
        });
    }

    function openBatchEditModal() {
        const state = store.get();
        const selected = state.selection;
        if (!selected.length) return;
        const first = selected[0];

        openDownloadSettingsModal(ctx, {
            title: `编辑 ${selected.length} 首歌曲的下载设置`,
            initialQuality: first._quality ?? state.settings.downloadQuality,
            initialWithLyric: first._withLyric ?? state.settings.withLyric,
            initialLyricOnly: first._lyricOnly || false,
            showLyricOnly: true,
            confirmText: '应用到选中',
            onConfirm: ({ quality, withLyric, lyricOnly }) => {
                const ids = new Set(selected.map((s) => s.id));
                const downloads = store.get().downloads.map((d) =>
                    ids.has(d.id) ? { ...d, _quality: quality, _withLyric: withLyric, _lyricOnly: lyricOnly } : d
                );
                store.update({ downloads });
                store.persist();
                Toast(`已更新 ${ids.size} 首歌曲的下载设置`, 'success', 1600);
            },
        });
    }

    function render() {
        const state = store.get();
        const search = state.downloadsSearch || '';
        const page = state.downloadsPage || 1;
        const perPage = state.settings.perPage;

        if (searchInput.value !== search) searchInput.value = search;

        const hasDownloads = state.downloads.length > 0;
        searchInput.disabled = !hasDownloads;
        allBtn.disabled = !hasDownloads;
        clearBtn.disabled = !hasDownloads;
        const hasSelection = state.selection.length > 0;
        const selectedInDownloads = state.selection.some((s) => state.downloads.some((d) => d.id === s.id));
        editBtn.disabled = !hasSelection || !hasDownloads;
        removeBtn.disabled = !selectedInDownloads || !hasDownloads;

        if (
            state.downloads === lastDownloads &&
            search === lastSearch &&
            page === lastPage &&
            perPage === lastPerPage
        ) return;

        lastDownloads = state.downloads;
        lastSearch = search;
        lastPage = page;
        lastPerPage = perPage;

        listHost.innerHTML = '';

        if (!state.downloads.length) {
            listHost.appendChild(EmptyState('下载列表为空', 'download'));
            store.setVisibleTracks([]);
            return;
        }

        const filtered = search
            ? state.downloads.filter((s) => matchSearch(s, search))
            : state.downloads;

        if (!filtered.length) {
            listHost.appendChild(EmptyState('没有匹配的歌曲', 'search'));
            store.setVisibleTracks([]);
            return;
        }

        const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
        const currentPage = Math.min(Math.max(1, page), totalPages);
        const start = (currentPage - 1) * perPage;
        const slice = filtered.slice(start, start + perPage);

        store.setVisibleTracks(slice);

        const list = el('div', { class: 'song-list' });
        for (const song of slice) {
            list.appendChild(SongRow(song, {
                selectable: true,
                selected: state.selection.some((s) => s.id === song.id),
                onToggleSelect: (s) => store.toggleSelection(s),
                onPlay: () => player.playNow(song),
                onPlayNext: () => {
                    player.playNext(song);
                    Toast(`已设为下一首播放：${song.title}`, 'success', 1600);
                },
                onEdit: () => openEditModal(song),
                onDownloadNow: () => startDownloadOne(song),
                onDownloadLyric: (s) => handleDownloadLyric(s, ctx),
                onRemove: () => {
                    const downloads = [...store.get().downloads];
                    const i = downloads.indexOf(song);
                    if (i >= 0) downloads.splice(i, 1);
                    store.update({ downloads });
                    store.persist();
                },
            }));
        }
        listHost.appendChild(list);

        if (totalPages > 1) {
            listHost.appendChild(Pagination({
                page: currentPage,
                totalPages,
                onPage: (p) => store.update({ downloadsPage: p }),
            }));
        }
    }

    const unsubscribe = store.subscribe(render);

    return {
        node: root,
        destroy: () => unsubscribe(),
    };
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 KB';
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
}

function formatSpeed(bps) {
    if (!bps || !isFinite(bps) || bps <= 0) return '';
    if (bps >= 1048576) return `${(bps / 1048576).toFixed(2)} MB/s`;
    if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${Math.round(bps)} B/s`;
}

function formatEta(sec) {
    if (sec === null || sec === undefined || !isFinite(sec) || sec <= 0) return '';
    if (sec >= 3600) {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return `${h}h${m}m`;
    }
    if (sec >= 60) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}m${s}s`;
    }
    return `${Math.ceil(sec)}s`;
}

const TRACK_STATUS_LABEL = {
    queued: '排队中',
    resolving: '解析中',
    downloading: '下载中',
    tagging: '写入标签',
    done: '已完成',
    error: '失败',
    cancelled: '已取消',
    skipped: '已跳过',
    removed: '已移除',
};

const TRACK_FILTERS = [
    { key: 'downloading', label: '下载中' },
    { key: 'queued', label: '排队中' },
    { key: 'done', label: '已完成' },
    { key: 'error', label: '失败' },
    { key: 'all', label: '全部' },
];

function matchFilter(track, filter) {
    if (filter === 'all') return track.status !== 'removed';
    if (filter === 'downloading') {
        return track.status === 'downloading' || track.status === 'resolving' || track.status === 'tagging';
    }
    if (filter === 'queued') return track.status === 'queued';
    if (filter === 'done') return track.status === 'done';
    if (filter === 'error') return track.status === 'error' || track.status === 'cancelled' || track.status === 'skipped';
    return true;
}

function isSingleTask(task) {
    return task.type === 'single' && Array.isArray(task.tracks) && task.tracks.length === 1;
}

function getTaskProgress(task) {
    if (isSingleTask(task)) {
        const track = task.tracks[0];
        if (track.status === 'done') return 100;
        return Math.min(100, Math.round((track.progress || 0) * 100));
    }
    if (task.packagingProgress !== null && task.packagingProgress !== undefined) {
        return Math.min(100, Math.round(task.packagingProgress * 100));
    }
    if (task.total > 0) {
        return Math.min(100, Math.round((task.done / task.total) * 100));
    }
    return 0;
}

function getTaskStats(task) {
    const tracks = Array.isArray(task.tracks) ? task.tracks : [];

    if (isSingleTask(task)) {
        const track = tracks[0];
        const stats = [];

        const label = TRACK_STATUS_LABEL[track.status] || track.status;
        stats.push({ text: label });

        const sizeStr = track.totalBytes
            ? `${formatBytes(track.bytes)} / ${formatBytes(track.totalBytes)}`
            : formatBytes(track.bytes);
        stats.push({ text: sizeStr });

        if (track.speed > 0) {
            const sp = formatSpeed(track.speed);
            if (sp) stats.push({ text: sp });
        }

        if (track.status === 'downloading' && track.eta) {
            const eta = formatEta(track.eta);
            if (eta) stats.push({ text: `剩 ${eta}` });
        }

        if (track.status === 'error' && track.error) {
            stats.push({ text: track.error, className: 'status-task__fail' });
        }

        return stats;
    }

    const doneCount = tracks.filter((t) => t.status === 'done').length;
    const activeCount = tracks.filter((t) =>
        t.status === 'downloading' || t.status === 'resolving' || t.status === 'tagging'
    ).length;
    const queuedCount = tracks.filter((t) => t.status === 'queued').length;
    const failedCount = tracks.filter((t) => t.status === 'error').length;

    let totalSpeed = 0;
    let remainingBytes = 0;
    for (const t of tracks) {
        if (t.speed > 0) totalSpeed += t.speed;
        if (t.status === 'downloading' || t.status === 'queued') {
            if (t.totalBytes) remainingBytes += Math.max(0, t.totalBytes - (t.bytes || 0));
        }
    }
    const eta = (totalSpeed > 0 && remainingBytes > 0) ? remainingBytes / totalSpeed : null;

    const stats = [];
    stats.push({ text: `${doneCount} / ${task.total || tracks.length}` });
    stats.push({ text: formatBytes(task.bytes || 0) });
    if (activeCount > 0) stats.push({ text: `下载中 ${activeCount}` });
    if (queuedCount > 0) stats.push({ text: `排队 ${queuedCount}` });
    const sp = formatSpeed(totalSpeed);
    if (sp) stats.push({ text: sp });
    const etaStr = formatEta(eta);
    if (etaStr) stats.push({ text: `剩 ${etaStr}` });
    if (failedCount > 0) stats.push({ text: `失败 ${failedCount}`, className: 'status-task__fail' });

    return stats;
}

function updateStatsElement(statsEl, statsArr) {
    for (let i = 0; i < statsArr.length; i++) {
        let span = statsEl.children[i];
        if (!span) {
            span = el('span');
            statsEl.appendChild(span);
        }
        const item = statsArr[i];
        if (span.textContent !== item.text) span.textContent = item.text;
        const cls = item.className || '';
        if (span.className !== cls) span.className = cls;
    }
    while (statsEl.children.length > statsArr.length) {
        statsEl.removeChild(statsEl.lastChild);
    }
}

function updateTrackMeta(metaEl, track) {
    const parts = [];

    const sizeStr = track.totalBytes
        ? `${formatBytes(track.bytes)} / ${formatBytes(track.totalBytes)}`
        : formatBytes(track.bytes);
    parts.push({ text: sizeStr, cls: 'task-track__size' });

    if (track.status === 'downloading' && track.speed > 0) {
        const sp = formatSpeed(track.speed);
        if (sp) parts.push({ text: sp, cls: 'task-track__speed' });
        const eta = formatEta(track.eta);
        if (eta) parts.push({ text: `剩 ${eta}`, cls: 'task-track__eta' });
    } else if (track.status === 'error' && track.error) {
        parts.push({ text: track.error, cls: 'task-track__error' });
    }

    for (let i = 0; i < parts.length; i++) {
        let span = metaEl.children[i];
        if (!span) {
            span = el('span');
            metaEl.appendChild(span);
        }
        const item = parts[i];
        if (span.textContent !== item.text) span.textContent = item.text;
        if (span.className !== item.cls) span.className = item.cls;
    }
    while (metaEl.children.length > parts.length) {
        metaEl.removeChild(metaEl.lastChild);
    }
}

export function StatusView(ctx) {
    const { store, downloader } = ctx;
    const root = el('div', { class: 'status-view' });

    const expandOverrides = new Map();
    const filters = new Map();

    const taskCache = new Map();

    const toolbarEl = el('div', { class: 'view-toolbar' });
    const clearFinishedBtn = el('button', { class: 'ena-btn ena-btn--sm' }, '清除已结束');
    clearFinishedBtn.addEventListener('click', () => store.clearFinishedTasks());
    toolbarEl.appendChild(clearFinishedBtn);
    root.appendChild(toolbarEl);

    let activeTitleEl = null;
    let activeListEl = null;
    let finishedTitleEl = null;
    let finishedListEl = null;
    let emptyEl = null;

    let pendingFrame = null;

    function getFilter(taskId) {
        return filters.get(taskId) || 'downloading';
    }

    function isTaskExpanded(task) {
        if (expandOverrides.has(task.id)) return expandOverrides.get(task.id);
        return task.type === 'batch';
    }

    function buildTaskNode(task) {
        const node = el('div', { class: 'status-task', dataset: { taskId: task.id } });

        const head = el('div', { class: 'status-task__head' });
        const labelEl = el('div', { class: 'status-task__label' });
        const labelTitleEl = el('span', { class: 'status-task__label-title' });
        const labelArtistEl = el('span', { class: 'status-task__label-artist' });
        labelEl.appendChild(labelTitleEl);
        labelEl.appendChild(labelArtistEl);
        const actionsEl = el('div', { class: 'status-task__actions' });
        head.appendChild(labelEl);
        head.appendChild(actionsEl);
        node.appendChild(head);

        const progressWrap = el('div', { class: 'ena-progress' });
        const progressBar = el('div', { class: 'ena-progress__bar' });
        progressWrap.appendChild(progressBar);
        node.appendChild(progressWrap);

        const statsEl = el('div', { class: 'status-task__stats' });
        node.appendChild(statsEl);

        const expandedEl = el('div', { class: 'task-expanded' });
        const expandedInner = el('div', { class: 'task-expanded__inner' });
        expandedEl.appendChild(expandedInner);
        node.appendChild(expandedEl);

        return {
            node,
            labelEl,
            labelTitleEl,
            labelArtistEl,
            actionsEl,
            progressWrap,
            progressBar,
            statsEl,
            expandedEl,
            expandedInner,
            progressKey: null,
            actionsKey: null,
            actionButtons: {},
            filterBarEl: null,
            filterButtons: null,
            filterKey: null,
            trackListEl: null,
            trackRows: new Map(),
            emptyMsgEl: null,
        };
    }

    function updateProgressStyle(cache, task) {
        let key = 'default';
        if (task.status === 'done') key = 'success';
        else if (task.status === 'error' || task.status === 'cancelled') key = 'danger';

        if (cache.progressKey === key) return;
        cache.progressKey = key;

        const cls = key === 'default'
            ? 'ena-progress'
            : `ena-progress ena-progress--${key}`;
        if (cache.progressWrap.className !== cls) {
            cache.progressWrap.className = cls;
        }
    }

    function rebuildActions(cache, task) {
        const canToggle = task.type === 'batch' || (task.tracks && task.tracks.length > 1);
        const canPackage = task.status === 'active' && task.phase !== 'packaging' && task.phase !== 'done' && task.type === 'batch';
        const canCancel = task.status === 'active' && task.phase !== 'packaging' && task.phase !== 'done';
        const key = `${canToggle}|${canPackage}|${canCancel}`;

        if (cache.actionsKey !== key) {
            cache.actionsKey = key;
            cache.actionsEl.innerHTML = '';
            cache.actionButtons = {};

            if (canToggle) {
                const toggleBtn = el('button', { class: 'ena-btn ena-btn--sm ena-btn--ghost' });
                toggleBtn.addEventListener('click', () => {
                    expandOverrides.set(task.id, !isTaskExpanded(task));
                    scheduleRender();
                });
                cache.actionsEl.appendChild(toggleBtn);
                cache.actionButtons.toggle = toggleBtn;
            }

            if (canPackage) {
                const pkgBtn = el('button', { class: 'ena-btn ena-btn--sm' }, '立即打包');
                pkgBtn.addEventListener('click', async () => {
                    const ok = await confirmDialog('立即打包？排队中和后续的歌曲将被跳过。');
                    if (!ok) return;
                    downloader.packageNow(task.id);
                    Toast('已请求立即打包', 'info', 1600);
                });
                cache.actionsEl.appendChild(pkgBtn);
            }

            if (canCancel) {
                const cancelBtn = el('button', { class: 'ena-btn ena-btn--sm ena-btn--danger' }, '取消');
                cancelBtn.addEventListener('click', async () => {
                    const ok = await confirmDialog('确定取消该任务吗？');
                    if (!ok) return;
                    downloader.abort(task.id);
                    Toast('已取消任务', 'warning', 1600);
                });
                cache.actionsEl.appendChild(cancelBtn);
            }
        }

        if (cache.actionButtons.toggle) {
            const text = isTaskExpanded(task) ? '收起' : '展开';
            if (cache.actionButtons.toggle.textContent !== text) {
                cache.actionButtons.toggle.textContent = text;
            }
        }
    }

    function buildTrackRow(task, track, cache) {
        const row = el('div', { class: `task-track task-track--${track.status}` });

        const info = el('div', { class: 'task-track__info' });
        const titleEl = el('span', { class: 'task-track__title' });
        const artistEl = el('span', { class: 'task-track__artist' });
        info.appendChild(titleEl);
        info.appendChild(artistEl);

        const statusEl = el('span', { class: 'task-track__status' });

        const progressWrap = el('div', { class: 'task-track__progress' });
        const progressBar = el('div', { class: 'task-track__progress-bar' });
        progressWrap.appendChild(progressBar);

        const metaEl = el('div', { class: 'task-track__meta' });

        const removeBtn = el('button', { class: 'task-track__remove', title: '移除' }, icon('close'));
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            downloader.cancelTrack(task.id, track.id);
            store.removeTaskTrack(task.id, track.id);
        });

        const spacer = el('span', { class: 'task-track__spacer' });

        row.appendChild(info);
        row.appendChild(statusEl);
        row.appendChild(progressWrap);
        row.appendChild(metaEl);
        row.appendChild(removeBtn);
        row.appendChild(spacer);

        const rowCache = {
            row,
            titleEl,
            artistEl,
            statusEl,
            progressBar,
            metaEl,
            removeBtn,
            spacer,
            lastStatus: null,
            lastRemovable: null,
        };
        cache.trackRows.set(track.id, rowCache);
        return rowCache;
    }

    function updateTrackRow(rowCache, task, track) {
        const title = track.title || '未知歌曲';
        if (rowCache.titleEl.textContent !== title) rowCache.titleEl.textContent = title;

        const artist = track.artist || '';
        if (rowCache.artistEl.textContent !== artist) rowCache.artistEl.textContent = artist;

        if (rowCache.lastStatus !== track.status) {
            rowCache.lastStatus = track.status;
            rowCache.row.className = `task-track task-track--${track.status}`;
            rowCache.statusEl.className = `task-track__status task-track__status--${track.status}`;
            rowCache.statusEl.textContent = TRACK_STATUS_LABEL[track.status] || track.status;
        }

        const pct = Math.min(100, Math.round((track.progress || 0) * 100));
        rowCache.progressBar.style.width = `${pct}%`;

        updateTrackMeta(rowCache.metaEl, track);

        const removable = task.status === 'active'
            && task.phase !== 'packaging'
            && task.phase !== 'done'
            && track.status !== 'removed'
            && track.status !== 'cancelled';

        if (rowCache.lastRemovable !== removable) {
            rowCache.lastRemovable = removable;
            rowCache.removeBtn.style.display = removable ? '' : 'none';
            rowCache.spacer.style.display = removable ? 'none' : '';
        }
    }

    function updateExpandedContent(container, task, cache) {
        const currentFilter = getFilter(task.id);

        if (!cache.filterBarEl) {
            cache.filterBarEl = el('div', { class: 'task-filter' });
            cache.filterButtons = {};
            for (const opt of TRACK_FILTERS) {
                const btn = el('button', { class: 'task-filter__btn', text: opt.label });
                btn.addEventListener('click', () => {
                    filters.set(task.id, opt.key);
                    scheduleRender();
                });
                cache.filterButtons[opt.key] = btn;
                cache.filterBarEl.appendChild(btn);
            }
            container.insertBefore(cache.filterBarEl, container.firstChild);
        }

        if (cache.filterKey !== currentFilter) {
            cache.filterKey = currentFilter;
            for (const opt of TRACK_FILTERS) {
                const btn = cache.filterButtons[opt.key];
                btn.classList.toggle('is-active', currentFilter === opt.key);
            }
        }

        if (!cache.trackListEl) {
            cache.trackListEl = el('div', { class: 'task-track-list' });
            container.appendChild(cache.trackListEl);
        }

        const trackListEl = cache.trackListEl;
        const tracks = Array.isArray(task.tracks) ? task.tracks : [];
        const visible = tracks.filter((t) => matchFilter(t, currentFilter));
        const visibleIds = new Set(visible.map((t) => t.id));

        for (const [id, rowCache] of Array.from(cache.trackRows)) {
            if (!visibleIds.has(id)) {
                rowCache.row.remove();
                cache.trackRows.delete(id);
            }
        }

        if (!visible.length) {
            if (!cache.emptyMsgEl) {
                cache.emptyMsgEl = el('div', { class: 'task-track-empty', text: '没有符合条件的歌曲' });
            }
            if (!trackListEl.contains(cache.emptyMsgEl)) {
                trackListEl.appendChild(cache.emptyMsgEl);
            }
        } else if (cache.emptyMsgEl && trackListEl.contains(cache.emptyMsgEl)) {
            cache.emptyMsgEl.remove();
        }

        for (let i = 0; i < visible.length; i++) {
            const track = visible[i];
            let rowCache = cache.trackRows.get(track.id);
            if (!rowCache) {
                buildTrackRow(task, track, cache);
                rowCache = cache.trackRows.get(track.id);
            }
            updateTrackRow(rowCache, task, track);

            const current = trackListEl.children[i];
            if (current !== rowCache.row) {
                if (current) trackListEl.insertBefore(rowCache.row, current);
                else trackListEl.appendChild(rowCache.row);
            }
        }
    }

    function renderTaskCard(task) {
        let cache = taskCache.get(task.id);
        if (!cache) {
            cache = buildTaskNode(task);
            taskCache.set(task.id, cache);
        }

        if (isSingleTask(task)) {
            const track = task.tracks[0];
            const title = track.title || '未知歌曲';
            const artist = track.artist || '';
            if (cache.labelTitleEl.textContent !== title) cache.labelTitleEl.textContent = title;
            if (cache.labelArtistEl.textContent !== artist) cache.labelArtistEl.textContent = artist;
        } else {
            const label = task.label || '下载任务';
            if (cache.labelTitleEl.textContent !== label) cache.labelTitleEl.textContent = label;
            if (cache.labelArtistEl.textContent !== '') cache.labelArtistEl.textContent = '';
        }

        rebuildActions(cache, task);

        updateProgressStyle(cache, task);

        const progress = getTaskProgress(task);
        cache.progressBar.style.width = `${progress}%`;

        updateStatsElement(cache.statsEl, getTaskStats(task));

        const isExpanded = isTaskExpanded(task);
        if (isExpanded) {
            updateExpandedContent(cache.expandedInner, task, cache);
            cache.expandedEl.classList.add('is-expanded');
        } else {
            cache.expandedEl.classList.remove('is-expanded');
        }

        return cache.node;
    }

    function renderTaskList(listEl, tasks) {
        const visibleIds = new Set(tasks.map((t) => t.id));

        for (const child of Array.from(listEl.children)) {
            const taskId = child.dataset.taskId;
            if (taskId && !visibleIds.has(taskId)) {
                child.remove();
            }
        }

        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            const node = renderTaskCard(task);
            const current = listEl.children[i];
            if (current !== node) {
                if (current) listEl.insertBefore(node, current);
                else listEl.appendChild(node);
            }
        }

        while (listEl.children.length > tasks.length) {
            listEl.removeChild(listEl.lastChild);
        }
    }

    function clearStructure() {
        if (activeTitleEl) { activeTitleEl.remove(); activeTitleEl = null; }
        if (activeListEl) { activeListEl.remove(); activeListEl = null; }
        if (finishedTitleEl) { finishedTitleEl.remove(); finishedTitleEl = null; }
        if (finishedListEl) { finishedListEl.remove(); finishedListEl = null; }
        if (emptyEl) { emptyEl.remove(); emptyEl = null; }
    }

    function render() {
        const tasks = store.get().downloadTasks || [];
        const taskIds = new Set(tasks.map((t) => t.id));

        for (const [id, cache] of Array.from(taskCache)) {
            if (!taskIds.has(id)) {
                cache.node.remove();
                taskCache.delete(id);
            }
        }

        if (!tasks.length) {
            for (const cache of taskCache.values()) cache.node.remove();
            taskCache.clear();
            clearStructure();
            if (!emptyEl) {
                emptyEl = EmptyState('暂无下载任务', 'download');
                root.appendChild(emptyEl);
            }
            return;
        }

        if (emptyEl) { emptyEl.remove(); emptyEl = null; }

        const activeTasks = tasks.filter((t) => t.status === 'active');
        const finishedTasks = tasks.filter((t) => t.status !== 'active');

        clearFinishedBtn.disabled = !finishedTasks.length;

        if (activeTasks.length) {
            if (!activeTitleEl) {
                activeTitleEl = el('div', { class: 'status-section-title' }, '进行中');
                root.appendChild(activeTitleEl);
            }
            if (!activeListEl) {
                activeListEl = el('div', { class: 'status-list' });
                root.appendChild(activeListEl);
            }
        } else {
            if (activeTitleEl) { activeTitleEl.remove(); activeTitleEl = null; }
            if (activeListEl) { activeListEl.remove(); activeListEl = null; }
        }

        if (finishedTasks.length) {
            if (!finishedTitleEl) {
                finishedTitleEl = el('div', { class: 'status-section-title' }, '历史记录');
                root.appendChild(finishedTitleEl);
            }
            if (!finishedListEl) {
                finishedListEl = el('div', { class: 'status-list' });
                root.appendChild(finishedListEl);
            }
        } else {
            if (finishedTitleEl) { finishedTitleEl.remove(); finishedTitleEl = null; }
            if (finishedListEl) { finishedListEl.remove(); finishedListEl = null; }
        }

        if (activeListEl) {
            renderTaskList(activeListEl, activeTasks);
        }

        if (finishedListEl) {
            const sorted = [...finishedTasks].sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
            renderTaskList(finishedListEl, sorted);
        }
    }

    function scheduleRender() {
        if (pendingFrame) return;
        pendingFrame = requestAnimationFrame(() => {
            pendingFrame = null;
            render();
        });
    }

    const unsubscribe = store.subscribe(scheduleRender);

    return {
        node: root,
        destroy: () => {
            if (pendingFrame) cancelAnimationFrame(pendingFrame);
            unsubscribe();
        },
    };
}

export function SettingsView(ctx) {
    const { store, config } = ctx;
    const root = el('div', { class: 'settings-view' });

    const qualityInputs = new Map();
    const downloadInputs = new Map();
    const downloadModeInputs = new Map();
    const batchCategoryInputs = new Map();
    const lyricSaveModeInputs = new Map();

    let perPageLabel = null;
    let perPageRange = null;
    let playProxyInput = null;
    let downloadProxyInput = null;
    let downloadDirNameEl = null;
    let downloadThreadsLabel = null;
    let downloadThreadsRange = null;
    let themeCustomEl = null;
    let themeBtnEl = null;
    let namingFormatInput = null;

    function buildRadioGroup({ label, name, inputMap, onChange }) {
        const group = el('div', { class: 'setting-group' });
        group.appendChild(el('div', { class: 'setting-label', text: label }));

        const options = el('div', { class: 'ena-radio-group' });

        for (const level of config.quality.levels) {
            const input = el('input', { type: 'radio', name });
            input.addEventListener('change', () => {
                if (input.checked) onChange(level.id);
            });
            inputMap.set(level.id, input);

            const dot = el('span', { class: 'dot' });
            const lbl = el('label', { class: 'ena-radio' },
                input,
                dot,
                el('span', { text: level.label })
            );
            options.appendChild(lbl);
        }

        group.appendChild(options);
        return group;
    }

    function buildCheckbox({ label, onChange }) {
        const input = el('input', { type: 'checkbox' });
        input.addEventListener('change', () => onChange(input.checked));

        const box = el('span', { class: 'box' });
        const lbl = el('label', { class: 'ena-checkbox' },
            input,
            box,
            el('span', { text: label })
        );

        return { input, node: lbl };
    }

    function buildAppearanceGroup() {
        const settings = store.get().settings;
        const group = el('div', { class: 'setting-group' });
        group.appendChild(el('div', { class: 'setting-label', text: '外观' }));

        group.appendChild(el('div', { class: 'setting-sublabel', text: '主题色' }));

        const row = el('div', { class: 'theme-picker-row' });

        const themeCustom = document.createElement('input');
        themeCustom.type = 'color';
        themeCustom.className = 'theme-picker-input';
        themeCustom.tabIndex = -1;
        themeCustom.value = settings.themeColor || '#2d2d2d';
        themeCustom.addEventListener('input', (e) => store.setTheme(e.target.value));
        themeCustomEl = themeCustom;
        row.appendChild(themeCustom);

        const themeBtn = el('button', {
            class: 'ena-btn ena-btn--sm theme-color-btn',
            type: 'button',
            text: '选取颜色',
            title: '选取颜色',
        });

        themeBtnEl = themeBtn;

        themeBtn.addEventListener('click', () => {
            if (typeof themeCustom.showPicker === 'function') {
                try { themeCustom.showPicker(); return; } catch {}
            }
            themeCustom.click();
        });

        row.appendChild(themeBtn);

        const resetBtn = el('button', { class: 'ena-btn ena-btn--sm' }, '恢复默认');
        resetBtn.addEventListener('click', () => store.setTheme(''));
        row.appendChild(resetBtn);

        group.appendChild(row);

        return group;
    }

    function build() {
        const settings = store.get().settings;
        root.innerHTML = '';

        const perPageGroup = el('div', { class: 'setting-group' });
        perPageLabel = el('div', {
            class: 'setting-label',
            text: `每页显示数量：${settings.perPage}`,
        });
        perPageRange = el('input', {
            type: 'range',
            class: 'ena-range',
            min: '20',
            max: '100',
            step: '10',
            value: String(settings.perPage),
        });
        perPageRange.addEventListener('input', (e) => {
            const val = Number(e.target.value);
            perPageLabel.textContent = `每页显示数量：${val}`;
        });
        perPageRange.addEventListener('change', (e) => {
            const val = Number(e.target.value);
            store.update({ settings: { ...store.get().settings, perPage: val } });
            store.persist();
        });
        perPageGroup.appendChild(perPageLabel);
        perPageGroup.appendChild(perPageRange);
        root.appendChild(perPageGroup);

        root.appendChild(buildAppearanceGroup());

        root.appendChild(buildRadioGroup({
            label: '播放音质',
            name: 'play-quality',
            inputMap: qualityInputs,
            onChange: (v) => {
                store.update({ settings: { ...store.get().settings, quality: v } });
                store.persist();
            },
        }));

        root.appendChild(buildRadioGroup({
            label: '默认下载音质',
            name: 'download-quality',
            inputMap: downloadInputs,
            onChange: (v) => {
                store.update({ settings: { ...store.get().settings, downloadQuality: v } });
                store.persist();
            },
        }));

        const proxyGroup = el('div', { class: 'setting-group' });
        proxyGroup.appendChild(el('div', { class: 'setting-label', text: '代理设置' }));

        const playProxyCb = buildCheckbox({
            label: '播放使用代理',
            onChange: (v) => {
                store.update({ settings: { ...store.get().settings, playProxy: v } });
                store.persist();
            },
        });
        playProxyInput = playProxyCb.input;

        const downloadProxyCb = buildCheckbox({
            label: '下载使用代理',
            onChange: (v) => {
                store.update({ settings: { ...store.get().settings, downloadProxy: v } });
                store.persist();
            },
        });
        downloadProxyInput = downloadProxyCb.input;

        proxyGroup.appendChild(el('div', { class: 'setting-checkboxes' },
            playProxyCb.node,
            downloadProxyCb.node
        ));
        root.appendChild(proxyGroup);

        const modeGroup = el('div', { class: 'setting-group' });
        modeGroup.appendChild(el('div', { class: 'setting-label', text: '下载方式' }));

        const supported = supportsFileSystemAccess();
        const blobInput = el('input', { type: 'radio', name: 'download-mode' });
        const streamInput = el('input', { type: 'radio', name: 'download-mode' });
        if (!supported) streamInput.disabled = true;

        blobInput.addEventListener('change', () => {
            if (blobInput.checked) {
                store.update({ settings: { ...store.get().settings, downloadMode: 'blob' } });
                store.persist();
            }
        });
        streamInput.addEventListener('change', () => {
            if (streamInput.checked) {
                store.update({ settings: { ...store.get().settings, downloadMode: 'stream' } });
                store.persist();
            }
        });

        downloadModeInputs.set('blob', blobInput);
        downloadModeInputs.set('stream', streamInput);

        const modeOptions = el('div', { class: 'ena-radio-group' },
            el('label', { class: 'ena-radio' },
                blobInput,
                el('span', { class: 'dot' }),
                el('span', { text: '内存缓存' })
            ),
            el('label', { class: 'ena-radio' },
                streamInput,
                el('span', { class: 'dot' }),
                el('span', { text: '直接流式下载到本地' })
            )
        );
        modeGroup.appendChild(modeOptions);

        if (!supported) {
            modeGroup.appendChild(el('div', {
                class: 'setting-hint',
                text: '当前浏览器不支持 File System Access API，只能使用内存缓存。'
            }));
        }

        root.appendChild(modeGroup);

        const dirGroup = el('div', { class: 'setting-group' });
        dirGroup.appendChild(el('div', { class: 'setting-label', text: '本地目录' }));

        downloadDirNameEl = el('div', { class: 'setting-dir-name', text: '未选择目录' });

        const pickBtn = el('button', { class: 'ena-btn ena-btn--sm' }, '选择目录');
        pickBtn.addEventListener('click', async () => {
            if (!supportsFileSystemAccess()) {
                Toast('当前浏览器不支持', 'warning', 1600);
                return;
            }
            try {
                const handle = await pickDownloadDir();
                const name = handle.name || '';
                store.update({ settings: { ...store.get().settings, downloadDirName: name } });
                store.persist();
                Toast(`已选择目录：${name}`, 'success', 1800);
            } catch (err) {
                if (err.name === 'AbortError') return;
                Toast(`选择目录失败：${err.message}`, 'danger', 2600);
            }
        });

        const clearDirBtn = el('button', { class: 'ena-btn ena-btn--sm' }, '清除目录');
        clearDirBtn.addEventListener('click', async () => {
            await clearSavedDir();
            store.update({ settings: { ...store.get().settings, downloadDirName: '' } });
            store.persist();
            Toast('已清除本地目录', 'success', 1400);
        });

        dirGroup.appendChild(el('div', { class: 'setting-dir-row' },
            downloadDirNameEl,
            pickBtn,
            clearDirBtn
        ));
        root.appendChild(dirGroup);

        const threadsGroup = el('div', { class: 'setting-group' });
        downloadThreadsLabel = el('div', {
            class: 'setting-label',
            text: `下载线程数：${settings.downloadThreads}`,
        });
        downloadThreadsRange = el('input', {
            type: 'range',
            class: 'ena-range',
            min: '1',
            max: '64',
            step: '1',
            value: String(settings.downloadThreads),
        });
        downloadThreadsRange.addEventListener('input', (e) => {
            const val = Number(e.target.value);
            downloadThreadsLabel.textContent = `下载线程数：${val}`;
        });
        downloadThreadsRange.addEventListener('change', (e) => {
            const val = Number(e.target.value);
            store.update({ settings: { ...store.get().settings, downloadThreads: val } });
            store.persist();
        });
        threadsGroup.appendChild(downloadThreadsLabel);
        threadsGroup.appendChild(downloadThreadsRange);
        root.appendChild(threadsGroup);

        const formatGroup = el('div', { class: 'setting-group' });
        formatGroup.appendChild(el('div', { class: 'setting-label', text: '命名格式' }));
        namingFormatInput = el('input', {
            type: 'text',
            class: 'ena-input setting-format-input',
            placeholder: '{title} - {artist}',
            value: settings.namingFormat || '',
        });
        namingFormatInput.addEventListener('input', (e) => {
            store.update({ settings: { ...store.get().settings, namingFormat: e.target.value } });
            store.persist();
        });
        formatGroup.appendChild(namingFormatInput);
        formatGroup.appendChild(el('div', {
            class: 'setting-hint',
            text: '可用占位符：{title} 歌曲名、{artist} 歌手名、{album} 专辑名',
        }));
        root.appendChild(formatGroup);

        const categoryGroup = el('div', { class: 'setting-group' });
        categoryGroup.appendChild(el('div', { class: 'setting-label', text: '批量下载分类方式' }));

        const categoryDefs = [
            { id: 'none', label: '不分类' },
            { id: 'artist', label: '按歌手分类' },
            { id: 'album', label: '按专辑分类' },
        ];
        const categoryOptions = el('div', { class: 'ena-radio-group' });
        for (const c of categoryDefs) {
            const input = el('input', { type: 'radio', name: 'batch-category' });
            input.addEventListener('change', () => {
                if (input.checked) {
                    store.update({ settings: { ...store.get().settings, batchCategory: c.id } });
                    store.persist();
                }
            });
            batchCategoryInputs.set(c.id, input);
            categoryOptions.appendChild(el('label', { class: 'ena-radio' },
                input,
                el('span', { class: 'dot' }),
                el('span', { text: c.label })
            ));
        }
        categoryGroup.appendChild(categoryOptions);
        root.appendChild(categoryGroup);

        const lyricGroup = el('div', { class: 'setting-group' });
        lyricGroup.appendChild(el('div', { class: 'setting-label', text: '歌词批量保存方式' }));

        const lyricDefs = [
            { id: 'same', label: '和对应歌曲同路径' },
            { id: 'separate', label: '单独保存' },
        ];
        const lyricOptions = el('div', { class: 'ena-radio-group' });
        for (const m of lyricDefs) {
            const input = el('input', { type: 'radio', name: 'lyric-save-mode' });
            input.addEventListener('change', () => {
                if (input.checked) {
                    store.update({ settings: { ...store.get().settings, lyricSaveMode: m.id } });
                    store.persist();
                }
            });
            lyricSaveModeInputs.set(m.id, input);
            lyricOptions.appendChild(el('label', { class: 'ena-radio' },
                input,
                el('span', { class: 'dot' }),
                el('span', { text: m.label })
            ));
        }
        lyricGroup.appendChild(lyricOptions);
        root.appendChild(lyricGroup);

        const repoGroup = el('div', { class: 'setting-group setting-group--last' });
        repoGroup.appendChild(el('div', { class: 'setting-label', text: '项目地址' }));
        const repoLink = el('a', {
            class: 'setting-repo-link',
            href: 'https://github.com/ENA-QWQ/cloudmusic_downloader',
            target: '_blank',
            rel: 'noopener noreferrer',
            text: 'https://github.com/ENA-QWQ/cloudmusic_downloader',
        });
        repoGroup.appendChild(repoLink);
        root.appendChild(repoGroup);

        sync();
    }

    function sync() {
        const settings = store.get().settings;

        if (perPageLabel) {
            const text = `每页显示数量：${settings.perPage}`;
            if (perPageLabel.textContent !== text) perPageLabel.textContent = text;
        }
        if (perPageRange && document.activeElement !== perPageRange) {
            const val = String(settings.perPage);
            if (perPageRange.value !== val) perPageRange.value = val;
        }

        for (const [id, input] of qualityInputs) {
            const want = id === settings.quality;
            if (input.checked !== want) input.checked = want;
        }
        for (const [id, input] of downloadInputs) {
            const want = id === settings.downloadQuality;
            if (input.checked !== want) input.checked = want;
        }

        if (playProxyInput) {
            const want = !!settings.playProxy;
            if (playProxyInput.checked !== want) playProxyInput.checked = want;
        }
        if (downloadProxyInput) {
            const want = !!settings.downloadProxy;
            if (downloadProxyInput.checked !== want) downloadProxyInput.checked = want;
        }

        const supported = supportsFileSystemAccess();
        const mode = settings.downloadMode === 'stream' && supported ? 'stream' : 'blob';
        for (const [key, input] of downloadModeInputs) {
            const want = key === mode;
            if (input.checked !== want) input.checked = want;
        }

        if (downloadDirNameEl) {
            const text = settings.downloadDirName || '未选择目录';
            if (downloadDirNameEl.textContent !== text) downloadDirNameEl.textContent = text;
        }

        if (downloadThreadsLabel) {
            const text = `下载线程数：${settings.downloadThreads}`;
            if (downloadThreadsLabel.textContent !== text) downloadThreadsLabel.textContent = text;
        }
        if (downloadThreadsRange && document.activeElement !== downloadThreadsRange) {
            const val = String(settings.downloadThreads);
            if (downloadThreadsRange.value !== val) downloadThreadsRange.value = val;
        }

        if (themeCustomEl && document.activeElement !== themeCustomEl) {
            const want = settings.themeColor || '#2d2d2d';
            if (themeCustomEl.value !== want) themeCustomEl.value = want;
        }

        if (themeBtnEl) {
            if (settings.themeColor) {
                themeBtnEl.style.background = settings.themeColor;
                themeBtnEl.style.borderBottomColor = settings.themeColor;
                themeBtnEl.style.color = pickTextColor(settings.themeColor);
            } else {
                themeBtnEl.style.background = '';
                themeBtnEl.style.borderBottomColor = '';
                themeBtnEl.style.color = '';
            }
        }

        if (namingFormatInput && document.activeElement !== namingFormatInput) {
            const want = settings.namingFormat || '';
            if (namingFormatInput.value !== want) namingFormatInput.value = want;
        }

        for (const [id, input] of batchCategoryInputs) {
            const want = id === (settings.batchCategory || 'none');
            if (input.checked !== want) input.checked = want;
        }

        for (const [id, input] of lyricSaveModeInputs) {
            const want = id === (settings.lyricSaveMode || 'same');
            if (input.checked !== want) input.checked = want;
        }
    }

    build();

    const unsubscribe = store.subscribe(sync);

    return {
        node: root,
        destroy: () => unsubscribe(),
    };
}

function openParseModal(ctx) {
    const { api, searchActions } = ctx;

    const TYPE_OPTIONS = [
        { value: 'song', label: '单曲' },
        { value: 'artist', label: '歌手' },
        { value: 'album', label: '专辑' },
        { value: 'playlist', label: '歌单' },
    ];

    let selectedType = 'song';
    let modal = null;
    let backBtn = null;

    const form = el('div', { class: 'parse-form' });
    form.appendChild(el('div', { class: 'setting-label', text: '内容类型' }));

    const dropdownWrap = el('div', { class: 'parse-form__dropdown' });
    const dropdown = Dropdown({
        options: TYPE_OPTIONS,
        value: selectedType,
        onChange: (v) => { selectedType = v; },
    });
    dropdownWrap.appendChild(dropdown.node);
    form.appendChild(dropdownWrap);

    form.appendChild(el('div', { class: 'setting-label', text: '内容 ID' }));

    const input = el('input', {
        type: 'text',
        class: 'ena-input parse-form__input',
        placeholder: '输入内容 ID',
        autocomplete: 'off',
    });
    form.appendChild(input);

    const resultWrap = el('div', { class: 'parse-result hidden' });
    const body = el('div', { class: 'parse-modal' }, form, resultWrap);

    function resetToForm() {
        form.classList.remove('hidden');
        resultWrap.classList.add('hidden');
        resultWrap.innerHTML = '';
        if (backBtn) backBtn.classList.add('hidden');
        input.value = '';
        input.focus();
    }

    function showSongResult(song) {
        form.classList.add('hidden');
        resultWrap.classList.remove('hidden');
        resultWrap.innerHTML = '';

        const list = el('div', { class: 'song-list' });
        list.appendChild(SongRow(song, songRowHandlers(song, ctx)));
        resultWrap.appendChild(list);

        if (backBtn) backBtn.classList.remove('hidden');
    }

    async function parseSong(id) {
        if (modal?.confirmBtn) {
            modal.confirmBtn.disabled = true;
            modal.confirmBtn.textContent = '解析中…';
        }
        try {
            const song = await api.song(id);
            if (!song) {
                Toast('未找到对应单曲', 'warning', 1600);
                return;
            }
            showSongResult(song);
        } catch (err) {
            Toast(`解析失败：${err.message}`, 'danger', 2600);
        } finally {
            if (modal?.confirmBtn) {
                modal.confirmBtn.disabled = false;
                modal.confirmBtn.textContent = '解析';
            }
        }
    }

    function parseAndOpen(id) {
        modal?.close();
        if (selectedType === 'artist') {
            searchActions.openArtist(id);
        } else if (selectedType === 'album') {
            searchActions.openAlbumById(id);
        } else if (selectedType === 'playlist') {
            searchActions.openPlaylistById(id);
        }
    }

    function handleSubmit() {
        const id = input.value.trim();
        if (!id) {
            Toast('请输入内容 ID', 'warning', 1600);
            return;
        }
        if (selectedType === 'song') {
            parseSong(id);
        } else {
            parseAndOpen(id);
        }
    }

    modal = openModal({
        title: '内容 ID 解析',
        body,
        confirmText: '解析',
        onConfirm: () => {
            handleSubmit();
            return false;
        },
    });

    if (modal && modal.headerEl && modal.titleEl) {
        backBtn = el('button', {
            class: 'ena-btn ena-btn--icon ena-modal__back hidden',
            title: '返回',
        }, icon('chevron-left'));

        backBtn.addEventListener('click', resetToForm);

        const headerLeft = el('div', { class: 'ena-modal__header-left' });
        headerLeft.appendChild(backBtn);
        headerLeft.appendChild(modal.titleEl);
        modal.headerEl.insertBefore(headerLeft, modal.headerEl.firstChild);
    }

    setTimeout(() => input.focus(), 100);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
        }
    });
}

export function HomeView(ctx) {
    const { store } = ctx;
    const root = el('div', { class: 'home-view' });

    const welcome = el('div', { class: 'home-welcome' },
        el('h1', { class: 'home-title', text: '欢迎，从哪里开始？' })
    );
    root.appendChild(welcome);

    const actions = el('div', { class: 'home-actions' });

    const searchBtn = el('button', { class: 'home-action' },
        el('div', { class: 'home-action__icon' }, icon('search')),
        el('div', { class: 'home-action__text', text: '搜索内容' })
    );
    searchBtn.addEventListener('click', () => {
        store.update({ view: 'search' });
        requestAnimationFrame(() => {
            const input = document.getElementById('search-input');
            if (input) {
                input.focus();
                input.select();
            }
        });
    });
    actions.appendChild(searchBtn);

    const accountBtn = el('button', { class: 'home-action' });
    function renderAccount() {
        const account = store.get().account;
        accountBtn.innerHTML = '';
        if (account.connected) {
            accountBtn.appendChild(el('div', { class: 'home-action__icon' }, icon('heart')));
            accountBtn.appendChild(el('div', { class: 'home-action__text', text: '我喜欢的音乐' }));
        } else {
            accountBtn.appendChild(el('div', { class: 'home-action__icon' }, icon('user')));
            accountBtn.appendChild(el('div', { class: 'home-action__text', text: '连接网易云账户' }));
        }
    }
    accountBtn.addEventListener('click', () => {
        const account = store.get().account;
        if (account.connected) {
            store.update({ view: 'liked' });
        } else {
            ctx.openAccountModal();
        }
    });
    renderAccount();
    actions.appendChild(accountBtn);

    const parseBtn = el('button', { class: 'home-action' },
        el('div', { class: 'home-action__icon' }, icon('link')),
        el('div', { class: 'home-action__text', text: '内容 ID 解析' })
    );
    parseBtn.addEventListener('click', () => openParseModal(ctx));
    actions.appendChild(parseBtn);

    root.appendChild(actions);

    let lastAccountKey = '';
    const unsubscribe = store.subscribe((state) => {
        const key = `${state.account.connected}|${state.account.uid}`;
        if (key === lastAccountKey) return;
        lastAccountKey = key;
        renderAccount();
    });

    return {
        node: root,
        destroy: () => unsubscribe(),
    };
}