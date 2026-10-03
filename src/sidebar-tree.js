import { store } from './store.js';
import { el } from './dom.js';

let ctx = null;
let favCache = null;
let favPromise = null;
const playlistCache = new Map();
const openNodes = new Set();
const pages = new Map();
let lastRenderTime = 0;
let pendingRender = false;
let lastUid = '';
let lastSignature = '';

const PENDING_TRACK_STATUSES = new Set(['resolving', 'downloading', 'tagging']);

const PER_PAGE = {
    liked: 20,
    artists: 10,
    playlists: 8,
    tracks: 15,
    status: 8,
};

function isOpen(key) {
    return openNodes.has(key);
}

async function resolveArtistId(item) {
    if (!item) return '';
    if (item.artistId) return String(item.artistId);
    const api = ctx && ctx.api;
    const netease = api && api.adapters && api.adapters.netease;
    if (!netease || !item.uid) return '';
    try {
        const data = await netease.request('/user/detail', { uid: item.uid });
        const artistId = data?.profile?.artistId || data?.profile?.artist?.id;
        if (artistId) return String(artistId);
    } catch {}
    return '';
}

function getPage(key) {
    return pages.get(key) || 0;
}

function invalidateFavorites() {
    favCache = null;
    favPromise = null;
    openNodes.clear();
    pages.clear();
    playlistCache.clear();
    lastSignature = '';
}

function loadFavorites() {
    if (favCache) return Promise.resolve(favCache);
    if (favPromise) return favPromise;

    const account = store.get().account;
    if (!account.connected) return Promise.resolve(null);

    const uid = account.uid;
    const api = ctx.api;

    favPromise = (async () => {
        const [playlistResult, followsResult] = await Promise.all([
            api.userPlaylists(uid),
            api.userFollows(uid, { limit: 100, offset: 0 }),
        ]);

        const playlists = playlistResult.playlists || [];
        const created = playlists.filter((p) => String(p._creatorId) === String(uid));
        const collected = playlists.filter((p) => String(p._creatorId) !== String(uid));
        const liked = playlists.find((p) => p._specialType === 5);

        let likedTracks = [];
        if (liked) {
            likedTracks = await api.fetchAllPlaylistTracks(liked.id, liked._extra?.trackCount || 0);
        }

        const artists = (followsResult.follows || []).filter((u) => u.userType === 2);

        favCache = {
            likedTracks,
            likedId: liked?.id || '',
            artists,
            created,
            collected,
        };

        lastSignature = '';
        return favCache;
    })();

    favPromise
        .catch(() => {
            favCache = null;
        })
        .finally(() => {
            favPromise = null;
        });

    return favPromise;
}

function loadPlaylist(id) {
    if (playlistCache.has(id)) return Promise.resolve(playlistCache.get(id));
    playlistCache.set(id, { loading: true, tracks: [] });
    return ctx.api.playlist(id)
        .then((tracks) => {
            const entry = { loading: false, tracks: tracks || [] };
            playlistCache.set(id, entry);
            return entry;
        })
        .catch((err) => {
            playlistCache.delete(id);
            throw err;
        });
}

function makeChevron() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML = '<polyline points="9 6 15 12 9 18" />';
    return svg;
}

function makeNode({ level = 1, label, badge, expandable, expanded, onToggle, onClick, title, active }) {
    const cls = [
        'side-tree-node',
        `side-tree-node--level-${level}`,
        expanded ? 'is-expanded' : '',
        active ? 'is-active' : '',
    ].filter(Boolean).join(' ');

    const node = el('div', { class: cls, title: title || label });

    node.appendChild(el('span', { class: 'side-tree-node__label', text: label }));

    if (badge !== undefined && badge !== null && badge !== '') {
        node.appendChild(el('i', { class: 'side-tree-node__badge', text: String(badge) }));
    }

    if (expandable) {
        const toggle = el('span', { class: 'side-tree-node__toggle' });
        toggle.appendChild(makeChevron());
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            onToggle?.();
        });
        node.appendChild(toggle);
    }

    node.addEventListener('click', (e) => {
        if (e.target.closest('.side-tree-node__toggle')) return;
        onClick?.();
    });

    return node;
}

function makeTrackNode(track, options = {}) {
    const node = el('div', {
        class: 'side-tree-node side-tree-node--track' + (options.active ? ' is-active' : ''),
        title: `${track.title || '未知'} - ${track.artist || '未知'}`,
    });
    node.appendChild(el('span', { class: 'side-tree-node__label', text: track.title || '未知' }));
    if (track.artist) {
        node.appendChild(el('span', { class: 'side-tree-node__artist', text: track.artist }));
    }
    node.addEventListener('click', (e) => {
        e.stopPropagation();
        if (options.onClick) options.onClick(track);
        else ctx.player.playNow(track);
    });
    return node;
}

function makeLoading() {
    return el('div', { class: 'side-tree-loading' },
        el('span'), el('span'), el('span')
    );
}

function makePager(pageKey, totalItems, perPage, onNavigate) {
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
    if (totalPages <= 1) return null;

    let current = getPage(pageKey);
    if (current > totalPages - 1) current = totalPages - 1;
    if (current < 0) current = 0;

    const pager = el('div', { class: 'side-tree-pager' });

    const prev = el('button', { class: 'side-tree-pager__btn', type: 'button', title: '上一页' }, '‹');
    prev.disabled = current <= 0;
    prev.addEventListener('click', (e) => {
        e.stopPropagation();
        pages.set(pageKey, current - 1);
        onNavigate();
    });

    const info = el('span', {
        class: 'side-tree-pager__info',
        text: `${current + 1} / ${totalPages}`,
    });

    const next = el('button', { class: 'side-tree-pager__btn', type: 'button', title: '下一页' }, '›');
    next.disabled = current >= totalPages - 1;
    next.addEventListener('click', (e) => {
        e.stopPropagation();
        pages.set(pageKey, current + 1);
        onNavigate();
    });

    pager.appendChild(prev);
    pager.appendChild(info);
    pager.appendChild(next);
    return pager;
}

function getTaskProgress(task) {
    if (task.type === 'single' && Array.isArray(task.tracks) && task.tracks.length === 1) {
        const t = task.tracks[0];
        if (t.status === 'done') return 100;
        return Math.min(100, Math.round((t.progress || 0) * 100));
    }
    if (task.packagingProgress !== null && task.packagingProgress !== undefined) {
        return Math.min(100, Math.round(task.packagingProgress * 100));
    }
    if (task.total > 0) {
        return Math.min(100, Math.round((task.done / task.total) * 100));
    }
    return 0;
}

function getPendingTracks(task) {
    return (task.tracks || []).filter((t) => PENDING_TRACK_STATUSES.has(t.status));
}

function focusTask(taskId, attempts = 0) {
    const node = document.querySelector(`.status-task[data-task-id="${taskId}"]`);
    if (!node) {
        if (attempts < 12) setTimeout(() => focusTask(taskId, attempts + 1), 60);
        return;
    }
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const prevBg = node.style.background;
    node.style.transition = 'background .3s ease';
    node.style.background = 'var(--hover-bg)';
    setTimeout(() => {
        node.style.background = prevBg || '';
        node.style.transition = '';
    }, 900);
}

function formatSpeed(bps) {
    if (!bps || !isFinite(bps) || bps <= 0) return '';
    if (bps >= 1048576) return `${(bps / 1048576).toFixed(2)} MB/s`;
    if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${Math.round(bps)} B/s`;
}

function makeTaskTrackNode(task, track) {
    const pct = Math.min(100, Math.round((track.progress || 0) * 100));
    const node = el('div', {
        class: 'side-tree-node side-tree-node--task-track',
        title: track.title || '未知',
        dataset: { taskId: task.id, trackId: track.id },
    });
    node.appendChild(el('span', { class: 'side-tree-node__label', text: track.title || '未知' }));
    node.appendChild(el('span', {
        class: 'side-tree-node__speed',
        text: formatSpeed(track.speed),
    }));

    const progressWrap = el('div', { class: 'side-tree-progress' });
    const progressBar = el('div', {
        class: 'side-tree-progress__bar',
        style: { width: `${pct}%` },
    });
    progressWrap.appendChild(progressBar);
    node.appendChild(progressWrap);

    return node;
}

function renderTaskTracks(container, task) {
    container.innerHTML = '';
    const pending = getPendingTracks(task);
    if (!pending.length) {
        container.appendChild(el('div', { class: 'side-tree-empty', text: '无进行中的子项' }));
        return;
    }
    for (const t of pending) {
        container.appendChild(makeTaskTrackNode(task, t));
    }
}

function makeTaskNode(task) {
    const progress = getTaskProgress(task);
    const isDone = task.status === 'done';
    const isErr = task.status === 'error' || task.status === 'cancelled';
    const pending = getPendingTracks(task);
    const expandable = pending.length > 0;

    const key = `st:task:${task.id}`;
    const expanded = isOpen(key);

    const wrapper = el('div', {
        class: 'side-tree-group',
        dataset: { treeKey: key, level: '1' },
    });

    const children = el('div', {
        class: 'side-tree-children' + (expanded ? ' is-expanded is-settled' : ''),
    });
    const inner = el('div', { class: 'side-tree-children-inner' });
    children.appendChild(inner);

    const node = el('div', {
        class: 'side-tree-node side-tree-node--level-1 side-tree-node--task'
            + (expanded ? ' is-expanded' : ''),
        title: task.label,
        dataset: { taskId: task.id },
    });
    node.appendChild(el('span', { class: 'side-tree-node__label', text: task.label }));

    const progressWrap = el('div', { class: 'side-tree-progress' });
    const progressBar = el('div', {
        class: `side-tree-progress__bar${isDone ? ' side-tree-progress__bar--done' : ''}${isErr ? ' side-tree-progress__bar--error' : ''}`,
        style: { width: `${progress}%` },
    });
    progressWrap.appendChild(progressBar);
    node.appendChild(progressWrap);

    if (expandable) {
        const toggle = el('span', { class: 'side-tree-node__toggle' });
        toggle.appendChild(makeChevron());
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const willExpand = !children.classList.contains('is-expanded');

            if (willExpand) {
                openNodes.add(key);
                renderTaskTracks(inner, task);
                children.classList.add('is-expanded');
                node.classList.add('is-expanded');

                let settled = false;
                const settle = () => {
                    if (settled) return;
                    settled = true;
                    if (children.classList.contains('is-expanded')) {
                        children.classList.add('is-settled');
                    }
                    updateStickyTops();
                };
                const onEnd = (e) => {
                    if (e.target !== children) return;
                    if (e.propertyName !== 'grid-template-rows') return;
                    children.removeEventListener('transitionend', onEnd);
                    settle();
                };
                children.addEventListener('transitionend', onEnd);
                setTimeout(settle, 320);
            } else {
                openNodes.delete(key);
                children.classList.remove('is-settled');
                requestAnimationFrame(() => {
                    if (!openNodes.has(key)) {
                        children.classList.remove('is-expanded');
                        node.classList.remove('is-expanded');
                    }
                });
            }
            requestAnimationFrame(updateStickyTops);
        });
        node.appendChild(toggle);
    }

    node.addEventListener('click', (e) => {
        if (e.target.closest('.side-tree-node__toggle')) return;
        e.stopPropagation();
        store.update({ view: 'status' });
        setTimeout(() => focusTask(task.id), 60);
    });

    wrapper.appendChild(node);
    wrapper.appendChild(children);

    if (expanded && expandable) renderTaskTracks(inner, task);

    return wrapper;
}

function openPlaylistDetail(playlist) {
    ctx.searchActions.openDetail('playlist', {
        id: playlist.id,
        title: playlist.title,
        artist: playlist.artist,
        pic: playlist.pic,
        trackCount: playlist._extra?.trackCount || 0,
        description: playlist._extra?.description || '',
    });
}

function renderTrackList(container, tracks, pageKey, perPage) {
    container.innerHTML = '';
    const total = tracks.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    let current = getPage(pageKey);
    if (current > totalPages - 1) current = totalPages - 1;
    if (current < 0) current = 0;
    const start = current * perPage;
    const slice = tracks.slice(start, start + perPage);

    for (const t of slice) container.appendChild(makeTrackNode(t));

    const pager = makePager(pageKey, total, perPage, () => {
        renderTrackList(container, tracks, pageKey, perPage);
    });
    if (pager) container.appendChild(pager);
}

function renderListPaged(container, items, pageKey, perPage, renderItem) {
    container.innerHTML = '';
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    let current = getPage(pageKey);
    if (current > totalPages - 1) current = totalPages - 1;
    if (current < 0) current = 0;
    const start = current * perPage;
    const slice = items.slice(start, start + perPage);

    for (const item of slice) renderItem(item, container);

    const pager = makePager(pageKey, total, perPage, () => {
        renderListPaged(container, items, pageKey, perPage, renderItem);
    });
    if (pager) container.appendChild(pager);
}

function makeExpandable({ level, label, badge, key, active, onClick, renderChildren, title }) {
    const wrapper = el('div', { class: 'side-tree-group', dataset: { treeKey: key, level: String(level) } });
    const expanded = isOpen(key);

    const children = el('div', {
        class: 'side-tree-children' + (expanded ? ' is-expanded is-settled' : ''),
    });
    const inner = el('div', { class: 'side-tree-children-inner' });
    children.appendChild(inner);

    const node = makeNode({
        level,
        label,
        badge,
        title,
        active,
        expandable: true,
        expanded,
        onToggle: () => {
            const willExpand = !children.classList.contains('is-expanded');

            if (willExpand) {
                openNodes.add(key);
                if (renderChildren) renderChildren(inner, true);
                children.classList.add('is-expanded');
                node.classList.add('is-expanded');

                let settled = false;
                const settle = () => {
                    if (settled) return;
                    settled = true;
                    if (children.classList.contains('is-expanded')) {
                        children.classList.add('is-settled');
                    }
                    updateStickyTops();
                };

                const onEnd = (e) => {
                    if (e.target !== children) return;
                    if (e.propertyName !== 'grid-template-rows') return;
                    children.removeEventListener('transitionend', onEnd);
                    settle();
                };
                children.addEventListener('transitionend', onEnd);
                setTimeout(settle, 320);
            } else {
                openNodes.delete(key);
                children.classList.remove('is-settled');
                requestAnimationFrame(() => {
                    if (!openNodes.has(key)) {
                        children.classList.remove('is-expanded');
                        node.classList.remove('is-expanded');
                    }
                });
            }

            requestAnimationFrame(updateStickyTops);
        },
        onClick,
    });

    wrapper.appendChild(node);
    wrapper.appendChild(children);

    if (expanded && renderChildren) renderChildren(inner, true);

    return wrapper;
}

function renderPlaylistNode(container, playlist) {
    const key = `fav:playlist:${playlist.id}`;

    container.appendChild(makeExpandable({
        level: 2,
        label: playlist.title || '未知歌单',
        badge: playlist._extra?.trackCount ? String(playlist._extra.trackCount) : '',
        key,
        title: playlist.title || '',
        onClick: () => openPlaylistDetail(playlist),
        renderChildren: (inner) => {
            const cached = playlistCache.get(playlist.id);

            if (cached && !cached.loading) {
                renderTrackList(inner, cached.tracks, `fav:tracks:${playlist.id}`, PER_PAGE.tracks);
                return;
            }

            inner.innerHTML = '';
            inner.appendChild(makeLoading());

            if (!cached) {
                loadPlaylist(playlist.id)
                    .then(() => {
                        const ready = playlistCache.get(playlist.id);
                        if (ready && !ready.loading) {
                            renderTrackList(inner, ready.tracks, `fav:tracks:${playlist.id}`, PER_PAGE.tracks);
                            requestAnimationFrame(updateStickyTops);
                        }
                    })
                    .catch(() => {
                        inner.innerHTML = '';
                        inner.appendChild(el('div', { class: 'side-tree-empty', text: '加载失败' }));
                    });
            }
        },
    }));
}

function renderFavorites(panel) {
    const inner = panel.querySelector('.side-tree-inner');
    if (!inner) return;
    inner.innerHTML = '';

    const account = store.get().account;
    if (!account.connected) {
        inner.appendChild(el('div', { class: 'side-tree-empty', text: '请先连接账户' }));
        return;
    }

    if (!favCache) {
        inner.appendChild(makeLoading());
        loadFavorites()
            .then(() => {
                updateBadges(store.get());
                renderAll(true);
            })
            .catch(() => {
                inner.innerHTML = '';
                inner.appendChild(el('div', { class: 'side-tree-empty', text: '加载失败' }));
            });
        return;
    }

    inner.appendChild(makeExpandable({
        level: 1,
        label: '收藏的音乐',
        badge: String(favCache.likedTracks.length),
        key: 'fav:liked',
        onClick: () => {
            store.setFavoritesTab('liked');
            store.update({ view: 'myfavorites' });
        },
        renderChildren: (host) => {
            renderListPaged(
                host,
                favCache.likedTracks,
                'fav:liked:page',
                PER_PAGE.liked,
                (t, c) => c.appendChild(makeTrackNode(t))
            );
        },
    }));

    inner.appendChild(makeExpandable({
        level: 1,
        label: '关注的歌手',
        badge: String(favCache.artists.length),
        key: 'fav:artists',
        onClick: () => {
            store.setFavoritesTab('artists');
            store.update({ view: 'myfavorites' });
        },
        renderChildren: (host) => {
            renderListPaged(
                host,
                favCache.artists,
                'fav:artists:page',
                PER_PAGE.artists,
                (u, c) => {
                    const node = makeNode({
                        level: 2,
                        label: u.nickname || '未知歌手',
                        title: u.nickname || '',
                        onClick: async () => {
                            const artistId = await resolveArtistId(u);
                            if (!artistId) return;
                            ctx.searchActions.openArtist(artistId, {
                                id: artistId,
                                title: u.nickname || '',
                                pic: u.avatarUrl || '',
                            });
                        },
                    });
                    c.appendChild(node);
                }
            );
        },
    }));

    inner.appendChild(makeExpandable({
        level: 1,
        label: '创建的歌单',
        badge: String(favCache.created.length),
        key: 'fav:created',
        onClick: () => {
            store.setFavoritesTab('created');
            store.update({ view: 'myfavorites' });
        },
        renderChildren: (host) => {
            renderListPaged(
                host,
                favCache.created,
                'fav:created:page',
                PER_PAGE.playlists,
                (p, c) => renderPlaylistNode(c, p)
            );
        },
    }));

    inner.appendChild(makeExpandable({
        level: 1,
        label: '收藏的歌单',
        badge: String(favCache.collected.length),
        key: 'fav:collected',
        onClick: () => {
            store.setFavoritesTab('collected');
            store.update({ view: 'myfavorites' });
        },
        renderChildren: (host) => {
            renderListPaged(
                host,
                favCache.collected,
                'fav:collected:page',
                PER_PAGE.playlists,
                (p, c) => renderPlaylistNode(c, p)
            );
        },
    }));
}

function renderDownloads(panel) {
    const inner = panel.querySelector('.side-tree-inner');
    if (!inner) return;
    inner.innerHTML = '';

    const downloads = store.get().downloads || [];
    if (!downloads.length) {
        inner.appendChild(el('div', { class: 'side-tree-empty', text: '下载列表为空' }));
        return;
    }

    const perPage = PER_PAGE.downloads;
    const total = downloads.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    let current = getPage('dl:page');
    if (current > totalPages - 1) current = totalPages - 1;
    if (current < 0) current = 0;
    const start = current * perPage;
    const slice = downloads.slice(start, start + perPage);

    for (const track of slice) {
        inner.appendChild(makeTrackNode(track));
    }

    const pager = makePager('dl:page', total, perPage, () => renderDownloads(panel));
    if (pager) inner.appendChild(pager);
}

function renderQueue(panel) {
    const inner = panel.querySelector('.side-tree-inner');
    if (!inner) return;
    inner.innerHTML = '';

    const state = store.get();
    const tracks = state.queue.tracks || [];
    if (!tracks.length) {
        inner.appendChild(el('div', { class: 'side-tree-empty', text: '播放队列为空' }));
        return;
    }

    const currentIndex = state.queue.currentIndex;
    const perPage = PER_PAGE.queue;
    const total = tracks.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    let current = getPage('queue:page');
    if (current > totalPages - 1) current = totalPages - 1;
    if (current < 0) current = 0;
    const start = current * perPage;
    const slice = tracks.slice(start, start + perPage);

    for (let i = 0; i < slice.length; i++) {
        const realIdx = start + i;
        inner.appendChild(makeTrackNode(slice[i], {
            active: realIdx === currentIndex,
            onClick: () => ctx.player.playAt(realIdx),
        }));
    }

    const pager = makePager('queue:page', total, perPage, () => renderQueue(panel));
    if (pager) inner.appendChild(pager);
}

function renderStatus(panel) {
    const inner = panel.querySelector('.side-tree-inner');
    if (!inner) return;
    inner.innerHTML = '';

    const tasks = store.get().downloadTasks || [];
    const active = tasks.filter((t) => t.status === 'active');

    if (!active.length) {
        inner.appendChild(el('div', { class: 'side-tree-empty', text: '暂无进行中的任务' }));
        return;
    }

    const perPage = PER_PAGE.status;
    const total = active.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    let current = getPage('st:active:page');
    if (current > totalPages - 1) current = totalPages - 1;
    if (current < 0) current = 0;
    const start = current * perPage;
    const slice = active.slice(start, start + perPage);

    for (const t of slice) {
        inner.appendChild(makeTaskNode(t));
    }

    const pager = makePager('st:active:page', total, perPage, () => renderStatus(panel));
    if (pager) inner.appendChild(pager);
}

function updateStickyTops() {
    const expandedLink = document.querySelector('.side-nav a[data-tree].is-expanded');
    const baseHeight = expandedLink ? expandedLink.offsetHeight : 0;

    document.querySelectorAll('.side-tree-node.is-expanded').forEach((node) => {
        let top = baseHeight;
        let el = node.parentElement;
        if (el) el = el.parentElement;
        while (el) {
            if (el.classList && el.classList.contains('side-tree-group')) {
                const groupNode = el.querySelector(':scope > .side-tree-node');
                if (groupNode && groupNode.classList.contains('is-expanded')) {
                    top += groupNode.offsetHeight;
                }
            }
            el = el.parentElement;
        }
        node.style.setProperty('--sticky-top', top + 'px');
    });
}

function updateTaskProgressBars() {
    const tasks = store.get().downloadTasks || [];
    const map = new Map(tasks.map((t) => [String(t.id), t]));
    document.querySelectorAll('.side-tree-node--task').forEach((node) => {
        const id = node.dataset.taskId;
        if (!id) return;
        const task = map.get(String(id));
        if (!task) return;
        const bar = node.querySelector('.side-tree-progress__bar');
        if (!bar) return;
        const w = `${getTaskProgress(task)}%`;
        if (bar.style.width !== w) bar.style.width = w;
    });

    document.querySelectorAll('.side-tree-node--task-track').forEach((node) => {
        const taskId = node.dataset.taskId;
        const trackId = node.dataset.trackId;
        if (!taskId || !trackId) return;
        const task = map.get(String(taskId));
        if (!task) return;
        const track = (task.tracks || []).find((t) => String(t.id) === String(trackId));
        if (!track) return;
        const bar = node.querySelector('.side-tree-progress__bar');
        if (bar) {
            const pct = Math.min(100, Math.round((track.progress || 0) * 100));
            const w = `${pct}%`;
            if (bar.style.width !== w) bar.style.width = w;
        }
        const speedEl = node.querySelector('.side-tree-node__speed');
        if (speedEl) {
            const speedText = formatSpeed(track.speed);
            if (speedEl.textContent !== speedText) speedEl.textContent = speedText;
        }
    });
}

function updateBadges(state) {
    const favBadge = document.querySelector('.side-nav a[data-tree="myfavorites"] .side-nav-badge');
    const dlBadge = document.querySelector('.side-nav a[data-tree="downloads"] .side-nav-badge');
    const stBadge = document.querySelector('.side-nav a[data-tree="status"] .side-nav-badge');
    const qBadge = document.querySelector('.side-nav a[data-tree="queue"] .side-nav-badge');

    if (favBadge) {
        const text = state.account.connected && favCache ? String(favCache.likedTracks.length) : '';
        if (favBadge.textContent !== text) favBadge.textContent = text;
    }

    if (dlBadge) {
        const count = (state.downloads || []).length;
        const text = count > 0 ? String(count) : '';
        if (dlBadge.textContent !== text) dlBadge.textContent = text;
    }

    if (stBadge) {
        const count = (state.downloadTasks || []).filter((t) => t.status === 'active').length;
        const text = count > 0 ? String(count) : '';
        if (stBadge.textContent !== text) stBadge.textContent = text;
    }

    if (qBadge) {
        const count = (state.queue.tracks || []).length;
        const text = count > 0 ? String(count) : '';
        if (qBadge.textContent !== text) qBadge.textContent = text;
    }
}

function computeSignature(state) {
    const tasks = state.downloadTasks || [];
    const downloads = state.downloads || [];
    const queueTracks = state.queue.tracks || [];
    return [
        state.account.uid,
        state.account.connected ? '1' : '0',
        tasks.filter((t) => t.status === 'active').map((t) => {
            const pending = (t.tracks || []).filter((tr) => PENDING_TRACK_STATUSES.has(tr.status));
            return `${t.id}:${t.status}:${pending.length}`;
        }).join(','),
        state.sidebarExpanded.myfavorites ? '1' : '0',
        state.sidebarExpanded.status ? '1' : '0',
        favCache ? '1' : '0',
    ].join('|');
}

function renderAll(force = false) {
    const state = store.get();
    const sig = computeSignature(state);

    if (!force && sig === lastSignature) {
        updateBadges(state);
        updateTaskProgressBars();
        return;
    }
    lastSignature = sig;

    const sidebar = document.querySelector('.sidebar');
    const scrollTop = sidebar ? sidebar.scrollTop : 0;

    const expanded = state.sidebarExpanded || {};

    if (expanded.myfavorites) {
        const panel = document.querySelector('.side-tree[data-tree-panel="myfavorites"]');
        if (panel) renderFavorites(panel);
    }
    if (expanded.status) {
        const panel = document.querySelector('.side-tree[data-tree-panel="status"]');
        if (panel) renderStatus(panel);
    }

    updateBadges(state);

    if (sidebar && scrollTop > 0) {
        sidebar.scrollTop = scrollTop;
        requestAnimationFrame(() => {
            if (sidebar) sidebar.scrollTop = scrollTop;
        });
    }

    requestAnimationFrame(updateStickyTops);
}

function scheduleRender(state) {
    const now = Date.now();
    if (now - lastRenderTime < 180) {
        if (!pendingRender) {
            pendingRender = true;
            setTimeout(() => {
                pendingRender = false;
                lastRenderTime = Date.now();
                renderAll();
            }, 180);
        }
        return;
    }
    lastRenderTime = now;
    renderAll();
}

export function initSidebarTrees(context) {
    ctx = context;

    const links = Array.from(document.querySelectorAll('.side-nav a[data-tree]'));

    for (const link of links) {
        const key = link.dataset.tree;
        const panel = document.querySelector(`.side-tree[data-tree-panel="${key}"]`);
        if (!panel) continue;

        const toggle = link.querySelector('.side-tree-toggle');
        if (toggle) {
            toggle.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                store.toggleSidebarTree(key);
            });
        }
    }

    lastUid = store.get().account.uid;

    store.subscribe((state) => {
        if (state.account.uid !== lastUid) {
            lastUid = state.account.uid;
            invalidateFavorites();
        }

        for (const link of links) {
            const key = link.dataset.tree;
            const panel = document.querySelector(`.side-tree[data-tree-panel="${key}"]`);
            if (!panel) continue;

            const expanded = !!state.sidebarExpanded[key];
            const wasOpen = panel.classList.contains('is-open');

            link.classList.toggle('is-expanded', expanded);

            if (expanded && !wasOpen) {
                panel.classList.add('is-open');
                panel.classList.remove('is-settled');
                let settled = false;
                const settle = () => {
                    if (settled) return;
                    settled = true;
                    if (panel.classList.contains('is-open')) {
                        panel.classList.add('is-settled');
                        requestAnimationFrame(updateStickyTops);
                    }
                };
                const onEnd = (e) => {
                    if (e.target !== panel) return;
                    if (e.propertyName !== 'grid-template-rows') return;
                    panel.removeEventListener('transitionend', onEnd);
                    settle();
                };
                panel.addEventListener('transitionend', onEnd);
                setTimeout(settle, 350);
            } else if (!expanded && wasOpen) {
                panel.classList.remove('is-settled');
                requestAnimationFrame(() => {
                    if (!store.get().sidebarExpanded[key]) {
                        panel.classList.remove('is-open');
                    }
                });
            }
        }

        updateTaskProgressBars();
        scheduleRender(state);
    });

    window.addEventListener('resize', () => {
        requestAnimationFrame(updateStickyTops);
    });
}