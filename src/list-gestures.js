import { store } from './store.js';
import { Toast } from './components.js';

const DRAG_THRESHOLD = 6;
const SELECT_THRESHOLD = 6;
const AUTO_SCROLL_EDGE = 40;
const AUTO_SCROLL_MAX_SPEED = 600;

const FLIP_DURATION = 160;
const FLIP_EASING = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
const FLIP_DURATION_SETTLE = 240;

const PLACEHOLDER_ID = '__drag-placeholder__';

const MOBILE_QUERY = '(max-width: 900px)';

let ctxRef = null;
let activeGesture = null;
let globalSuppressClick = false;
let globalSuppressClickTimer = null;

function isMobile() {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(MOBILE_QUERY).matches;
}

function getZoom() {
    try {
        const z = getComputedStyle(document.documentElement).zoom;
        const n = parseFloat(z);
        return (isFinite(n) && n > 0) ? n : 1;
    } catch {
        return 1;
    }
}

function findScrollParent(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
            return node;
        }
        node = node.parentElement;
    }
    return null;
}

function sameSelection(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (!a[i] || !b[i] || a[i].id !== b[i].id) return false;
    }
    return true;
}

function getFlipKey(el) {
    if (!el || !el.classList) return '';
    if (el.classList.contains('list-drag-placeholder')) return PLACEHOLDER_ID;
    if (el.classList.contains('song-row')) return el.dataset.id || '';
    return '';
}

function setGlobalSuppressClick() {
    globalSuppressClick = true;
    if (globalSuppressClickTimer) clearTimeout(globalSuppressClickTimer);
    globalSuppressClickTimer = setTimeout(() => {
        globalSuppressClick = false;
        globalSuppressClickTimer = null;
    }, 500);
}

function onGlobalClick(e) {
    if (!globalSuppressClick) return;
    globalSuppressClick = false;
    if (globalSuppressClickTimer) {
        clearTimeout(globalSuppressClickTimer);
        globalSuppressClickTimer = null;
    }
    e.stopPropagation();
    e.preventDefault();
}

export function initGlobalListGestures(ctx) {
    ctxRef = ctx;
    if (isMobile()) return;

    document.addEventListener('pointerdown', onGlobalPointerDown, { capture: true });
    document.addEventListener('pointermove', onGlobalPointerMove, { passive: false });
    document.addEventListener('pointerup', onGlobalPointerUp);
    document.addEventListener('pointercancel', onGlobalPointerCancel);
    document.addEventListener('click', onGlobalClick, true);
}

export function attachListGestures() {
    return { destroy: () => {} };
}

function cloneRowForPreview(row) {
    const clone = row.cloneNode(true);
    clone.removeAttribute('style');
    clone.classList.remove('is-drag-group');
    clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    return clone;
}

function buildGhostRow(song) {
    const row = document.createElement('div');
    row.className = 'song-row';
    row.style.width = '100%';

    const cover = document.createElement('div');
    cover.className = 'song-cover';
    if (song && song.pic) {
        const img = document.createElement('img');
        img.src = song.pic;
        img.alt = '';
        cover.appendChild(img);
    }
    row.appendChild(cover);

    const info = document.createElement('div');
    info.className = 'song-info';

    const titleRow = document.createElement('div');
    titleRow.className = 'song-title-row';

    const title = document.createElement('span');
    title.className = 'song-title';
    title.textContent = (song && song.title) || '未知歌曲';
    titleRow.appendChild(title);

    if (song && song.album) {
        const album = document.createElement('span');
        album.className = 'song-album';
        album.textContent = `- ${song.album}`;
        titleRow.appendChild(album);
    }

    info.appendChild(titleRow);

    const artist = document.createElement('div');
    artist.className = 'song-artist';
    artist.textContent = (song && song.artist) || '未知歌手';
    info.appendChild(artist);

    row.appendChild(info);

    return row;
}

function buildGhostCover(song) {
    const cover = document.createElement('div');
    cover.className = 'list-drag-ghost__cover';
    if (song && song.pic) {
        const img = document.createElement('img');
        img.src = song.pic;
        img.alt = '';
        cover.appendChild(img);
    }
    return cover;
}

function buildDragOutGhost(songs) {
    const ghost = document.createElement('div');
    ghost.className = 'list-drag-ghost';
    ghost.style.position = 'fixed';
    ghost.style.left = '0';
    ghost.style.top = '0';
    ghost.style.margin = '0';
    ghost.style.zIndex = '9999';
    ghost.style.pointerEvents = 'none';
    ghost.style.boxShadow = '0 10px 28px rgba(0, 0, 0, 0.22)';
    ghost.style.transformOrigin = 'top left';
    ghost.style.background = 'var(--bg-menu, #fff)';
    ghost.style.overflow = 'hidden';
    ghost.style.display = 'none';

    if (songs.length > 1) {
        ghost.style.width = '220px';
        ghost.classList.add('list-drag-ghost--multi');

        const stack = document.createElement('div');
        stack.className = 'list-drag-ghost__stack';

        const maxCovers = Math.min(3, songs.length);
        for (let i = 0; i < maxCovers; i++) {
            const cover = buildGhostCover(songs[i]);
            cover.style.left = (i * 14) + 'px';
            cover.style.zIndex = String(maxCovers - i);
            stack.appendChild(cover);
        }
        ghost.appendChild(stack);

        const label = document.createElement('div');
        label.className = 'list-drag-ghost__label';
        label.textContent = `已选中 ${songs.length} 首`;
        ghost.appendChild(label);
    } else {
        ghost.style.width = '320px';
        ghost.appendChild(buildGhostRow(songs[0]));
    }

    return ghost;
}

function getSongs() {
    if (!activeGesture) return [];
    const { kind } = activeGesture;
    if (kind === 'queue') return store.get().queue.tracks;
    if (kind === 'downloads') return store.get().downloads;
    return store.get().visibleTracks || [];
}

function onGlobalPointerDown(e) {
    if (activeGesture) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (isMobile()) return;

    const target = e.target;
    if (!(target instanceof Element)) return;

    const listEl = target.closest('.song-list');
    if (!listEl) return;

    if (target.closest('.song-select, .song-actions, .song-menu, .song-menu-panel, .song-menu-trigger, button, input, a, label')) return;

    const row = target.closest('.song-row');

    let kind = 'generic';
    let canReorder = () => false;
    let canDragOut = false;

    if (listEl.closest('.queue-view')) {
        kind = 'queue';
        canReorder = () => {
            const state = store.get();
            const search = state.queueSearch || '';
            const filter = state.filter?.queue || null;
            return !search && !filter;
        };
        canDragOut = false;
    } else if (listEl.closest('.downloads-view')) {
        kind = 'downloads';
        canReorder = () => {
            const state = store.get();
            const search = state.downloadsSearch || '';
            const filter = state.filter?.downloads || null;
            return !search && !filter;
        };
        canDragOut = false;
    } else {
        kind = 'generic';
        canReorder = () => false;
        canDragOut = true;
    }

    const listRect = listEl.getBoundingClientRect();
    const zoom = getZoom();

    activeGesture = {
        listEl,
        kind,
        canReorder,
        canDragOut,
        startX: e.clientX,
        startY: e.clientY,
        startLocalX: (e.clientX - listRect.left) / zoom,
        startLocalY: (e.clientY - listRect.top) / zoom,
        activePointerId: e.pointerId,
        sourceRow: row,
        state: 'idle',
        scrollParent: findScrollParent(listEl),
        lastPointerEvent: null,
        autoScrollRaf: null,
        autoScrollSpeed: 0,
        lastFrameTs: 0,
        dragIndices: [],
        dragToIndex: null,
        dragGroupRows: null,
        dragCommitted: false,
        ghost: null,
        placeholder: null,
        selectBox: null,
        initialSelection: null,
        dragOutSongs: null,
        dropTarget: null,
        dragAnchorEl: null,
    };

    if (row && canDragOut && isInDragOutArea(target)) {
        activeGesture.state = 'pendingDragOut';
    } else if (row && canReorder() && isInReorderArea(target)) {
        activeGesture.state = 'pendingDrag';
    } else {
        activeGesture.state = 'pendingSelect';
    }

    if (e.cancelable) e.preventDefault();
}

function isInReorderArea(target) {
    return !!(target.closest('.song-title, .song-album, .song-artist'));
}

function isInDragOutArea(target) {
    return !!(target.closest('.song-cover, .song-title, .song-artist'));
}

function onGlobalPointerMove(e) {
    if (!activeGesture) return;
    if (activeGesture.activePointerId !== null && e.pointerId !== activeGesture.activePointerId) return;

    activeGesture.lastPointerEvent = e;
    const dx = e.clientX - activeGesture.startX;
    const dy = e.clientY - activeGesture.startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (activeGesture.state === 'pendingDragOut') {
        if (e.cancelable) e.preventDefault();
        if (dist < DRAG_THRESHOLD) return;
        enterDragOut(e);
    } else if (activeGesture.state === 'pendingDrag') {
        if (e.cancelable) e.preventDefault();
        if (dist < DRAG_THRESHOLD) return;
        enterDrag(e);
    } else if (activeGesture.state === 'pendingSelect') {
        if (e.cancelable) e.preventDefault();
        if (dist < SELECT_THRESHOLD) return;
        enterSelect(e);
    } else if (activeGesture.state === 'dragging') {
        if (e.cancelable) e.preventDefault();
        updateDrag(e);
    } else if (activeGesture.state === 'draggingOut') {
        if (e.cancelable) e.preventDefault();
        updateDragOut(e);
    } else if (activeGesture.state === 'selecting') {
        if (e.cancelable) e.preventDefault();
        updateSelect(e);
    }
}

function onGlobalPointerUp(e) {
    if (!activeGesture) return;
    if (activeGesture.activePointerId !== null && e.pointerId !== activeGesture.activePointerId) return;

    if (activeGesture.state === 'dragging') {
        finishDrag();
    } else if (activeGesture.state === 'draggingOut') {
        finishDragOut();
    } else if (activeGesture.state === 'selecting') {
        finishSelect(e);
    }
    cleanupGesture();
}

function onGlobalPointerCancel(e) {
    if (!activeGesture) return;
    if (activeGesture.activePointerId !== null && e.pointerId !== activeGesture.activePointerId) return;
    cleanupGesture();
}

function scanRows() {
    if (!activeGesture) return [];
    const { listEl } = activeGesture;
    const listRect = listEl.getBoundingClientRect();
    const zoom = getZoom();
    const result = [];
    for (const r of listEl.children) {
        if (!r.classList || !r.classList.contains('song-row')) continue;
        const rr = r.getBoundingClientRect();
        result.push({
            row: r,
            top: (rr.top - listRect.top) / zoom,
            bottom: (rr.bottom - listRect.top) / zoom,
            left: (rr.left - listRect.left) / zoom,
            right: (rr.right - listRect.left) / zoom,
            index: Number(r.dataset.index),
            song: r.__song || null,
        });
    }
    return result;
}

function captureVisualTops() {
    if (!activeGesture) return new Map();
    const { listEl } = activeGesture;
    const map = new Map();
    for (const r of listEl.children) {
        const key = getFlipKey(r);
        if (!key) continue;
        if (!map.has(key)) map.set(key, r.getBoundingClientRect().top);
    }
    return map;
}

function flipRows(beforeTops, duration = FLIP_DURATION) {
    if (!activeGesture) return;
    const { listEl } = activeGesture;
    const zoom = getZoom();
    for (const r of listEl.children) {
        const key = getFlipKey(r);
        if (!key) continue;
        const prev = beforeTops.get(key);
        if (prev === undefined) continue;
        const now = r.getBoundingClientRect().top;
        const delta = (prev - now) / zoom;
        if (Math.abs(delta) < 0.5) continue;
        r.style.transition = 'none';
        r.style.transform = `translateY(${delta}px)`;
        void r.offsetHeight;
        r.style.transition = `transform ${duration}ms ${FLIP_EASING}`;
        r.style.transform = '';
    }
}

function enterDragOut(e) {
    const { sourceRow, listEl } = activeGesture;
    if (!sourceRow) return;

    activeGesture.state = 'draggingOut';
    setGlobalSuppressClick();
    listEl.classList.add('is-dragging');
    document.body.classList.add('list-gesture-active');

    const selection = store.get().selection || [];
    let sourceSong = sourceRow.__song;
    if (!sourceSong) {
        const id = sourceRow.dataset.id;
        const tracks = store.get().visibleTracks || [];
        sourceSong = tracks.find(t => String(t.id) === String(id)) || null;
    }

    const inSelection = sourceSong && selection.some(s => s && String(s.id) === String(sourceSong.id));

    let songs = [];
    if (inSelection && selection.length > 1) {
        songs = selection.slice();
    } else if (sourceSong) {
        songs = [sourceSong];
    }

    if (!songs.length) {
        cleanupGesture();
        return;
    }

    activeGesture.dragOutSongs = songs;

    const ghost = buildDragOutGhost(songs);
    document.body.appendChild(ghost);
    activeGesture.ghost = ghost;

    updateDragOut(e);
}

function updateDragOut(e) {
    const { ghost } = activeGesture;
    if (!ghost) return;

    const zoom = getZoom();
    ghost.style.transform = `translate(${e.clientX / zoom + 12}px, ${e.clientY / zoom + 12}px)`;
    ghost.style.display = '';

    const element = document.elementFromPoint(e.clientX, e.clientY);
    let dropTarget = null;
    if (element) {
        const link = element.closest('a[data-view="queue"], a[data-view="downloads"]');
        if (link) {
            dropTarget = link;
        }
    }

    if (activeGesture.dropTarget !== dropTarget) {
        if (activeGesture.dropTarget) {
            activeGesture.dropTarget.classList.remove('is-drop-target');
        }
        if (dropTarget) {
            dropTarget.classList.add('is-drop-target');
        }
        activeGesture.dropTarget = dropTarget;
    }

    updateAutoScroll(e);
}

function finishDragOut() {
    const { dropTarget, dragOutSongs, ghost } = activeGesture;

    if (ghost && ghost.parentNode) {
        ghost.parentNode.removeChild(ghost);
    }
    activeGesture.ghost = null;

    if (dropTarget) {
        dropTarget.classList.remove('is-drop-target');
        setGlobalSuppressClick();
        const view = dropTarget.dataset.view;
        if (dragOutSongs && dragOutSongs.length) {
            if (view === 'queue') {
                addToQueue(dragOutSongs);
            } else if (view === 'downloads') {
                addToDownloads(dragOutSongs);
            }
        }
    }

    activeGesture.dropTarget = null;
}

function addToQueue(songs) {
    const q = store.get().queue;
    const existingIds = new Set(q.tracks.map(t => t.id).filter(Boolean));
    const newTracks = songs.filter(s => s && s.id && !existingIds.has(s.id));
    if (!newTracks.length) {
        Toast('所选歌曲已全部在播放队列中', 'warning', 1600);
        return;
    }
    store.update({ queue: { ...q, tracks: [...q.tracks, ...newTracks] } });
    store.persist();
    Toast(`已添加 ${newTracks.length} 首到播放队列`, 'success', 1600);
}

function addToDownloads(songs) {
    const validSongs = songs.filter(s => s && s.id);
    if (!validSongs.length) {
        Toast('没有可添加的歌曲', 'warning', 1600);
        return;
    }
    ctxRef.openBatchAddModal(validSongs, 'append');
}

function enterDrag(e) {
    const { sourceRow, listEl } = activeGesture;
    if (!sourceRow) return;

    activeGesture.state = 'dragging';
    activeGesture.dragCommitted = false;
    setGlobalSuppressClick();
    listEl.classList.add('is-dragging');
    document.body.classList.add('list-gesture-active');

    const dragIndex = Number(sourceRow.dataset.index);
    if (!Number.isInteger(dragIndex)) {
        cleanupGesture();
        return;
    }

    const songs = getSongs();
    const sourceSong = songs[dragIndex];
    if (!sourceSong) {
        cleanupGesture();
        return;
    }

    const selection = store.get().selection || [];
    const inSelection = selection.some(s => s && String(s.id) === String(sourceSong.id));

    let candidateIndices = [];
    if (inSelection && selection.length > 1) {
        const ids = new Set(selection.map(s => String(s.id)));
        songs.forEach((s, i) => {
            if (s && s.id && ids.has(String(s.id))) candidateIndices.push(i);
        });
    }
    if (!candidateIndices.length) candidateIndices = [dragIndex];
    const groupSet = new Set(candidateIndices);

    const groupRows = [];
    for (const r of listEl.children) {
        if (!r.classList || !r.classList.contains('song-row')) continue;
        const idx = Number(r.dataset.index);
        if (Number.isInteger(idx) && groupSet.has(idx)) groupRows.push(r);
    }
    groupRows.sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));

    if (!groupRows.length) {
        cleanupGesture();
        return;
    }

    activeGesture.dragAnchorEl = groupRows[0].previousSibling;
    activeGesture.dragIndices = groupRows.map(r => Number(r.dataset.index)).sort((a, b) => a - b);
    activeGesture.dragGroupRows = groupRows;
    activeGesture.dragToIndex = null;

    const zoom = getZoom();
    const sourceRect = sourceRow.getBoundingClientRect();

    let totalHeight = 0;
    for (const r of groupRows) {
        totalHeight += r.getBoundingClientRect().height / zoom;
    }
    if (totalHeight <= 0) totalHeight = sourceRect.height / zoom;

    const placeholder = document.createElement('div');
    placeholder.className = 'list-drag-placeholder';
    placeholder.dataset.id = PLACEHOLDER_ID;
    placeholder.style.height = totalHeight + 'px';

    for (const r of groupRows) {
        placeholder.appendChild(cloneRowForPreview(r));
    }

    const firstRow = groupRows[0];
    if (firstRow.parentNode === listEl) {
        listEl.insertBefore(placeholder, firstRow);
    } else if (firstRow.parentNode) {
        firstRow.parentNode.insertBefore(placeholder, firstRow);
    } else {
        listEl.appendChild(placeholder);
    }

    for (const r of groupRows) {
        if (r.parentNode) r.parentNode.removeChild(r);
    }

    activeGesture.placeholder = placeholder;

    const ghost = document.createElement('div');
    ghost.className = 'list-drag-ghost';
    ghost.style.position = 'fixed';
    ghost.style.left = '0';
    ghost.style.top = '0';
    ghost.style.margin = '0';
    ghost.style.zIndex = '9999';
    ghost.style.pointerEvents = 'none';
    ghost.style.boxShadow = '0 10px 28px rgba(0, 0, 0, 0.22)';
    ghost.style.transformOrigin = 'top left';
    ghost.style.background = 'var(--bg-menu, #fff)';
    ghost.style.overflow = 'hidden';
    ghost.style.display = 'none';

    if (activeGesture.dragIndices.length > 1) {
        ghost.style.width = '220px';
        ghost.classList.add('list-drag-ghost--multi');

        const stack = document.createElement('div');
        stack.className = 'list-drag-ghost__stack';
        const maxCovers = Math.min(3, groupRows.length);
        for (let i = 0; i < maxCovers; i++) {
            const cover = document.createElement('div');
            cover.className = 'list-drag-ghost__cover';
            cover.style.left = (i * 14) + 'px';
            cover.style.zIndex = String(maxCovers - i);
            const img = groupRows[i].querySelector('.song-cover img');
            if (img) {
                const newImg = document.createElement('img');
                newImg.src = img.src;
                newImg.alt = '';
                cover.appendChild(newImg);
            }
            stack.appendChild(cover);
        }
        ghost.appendChild(stack);

        const label = document.createElement('div');
        label.className = 'list-drag-ghost__label';
        label.textContent = `已选中 ${activeGesture.dragIndices.length} 首`;
        ghost.appendChild(label);
    } else {
        const sourceWidth = sourceRect.width / zoom;
        ghost.style.width = Math.min(sourceWidth, 280) + 'px';
        const clone = cloneRowForPreview(groupRows[0]);
        clone.style.width = '100%';
        ghost.appendChild(clone);
    }

    document.body.appendChild(ghost);
    activeGesture.ghost = ghost;

    updateDrag(e);
}

function updateDrag(e) {
    const { ghost, placeholder, listEl } = activeGesture;
    if (!ghost || !placeholder) return;
    if (placeholder.parentNode !== listEl) return;

    const zoom = getZoom();
    ghost.style.transform = `translate(${e.clientX / zoom + 12}px, ${e.clientY / zoom + 12}px)`;

    const listRect = listEl.getBoundingClientRect();
    const insideList = e.clientX >= listRect.left
        && e.clientX <= listRect.right
        && e.clientY >= listRect.top
        && e.clientY <= listRect.bottom;
    ghost.style.display = insideList ? 'none' : '';

    if (!insideList) {
        const anchor = activeGesture.dragAnchorEl;
        let needsReset = false;
        if (anchor && anchor.parentNode === listEl) {
            if (placeholder.previousSibling !== anchor) {
                const beforeTops = captureVisualTops();
                listEl.insertBefore(placeholder, anchor.nextSibling);
                flipRows(beforeTops, FLIP_DURATION);
                needsReset = true;
            }
        } else {
            if (listEl.firstChild !== placeholder) {
                const beforeTops = captureVisualTops();
                listEl.insertBefore(placeholder, listEl.firstChild);
                flipRows(beforeTops, FLIP_DURATION);
                needsReset = true;
            }
        }
        if (needsReset) {
            activeGesture.dragToIndex = null;
        }
        updateAutoScroll(e);
        return;
    }

    const curLocalY = (e.clientY - listRect.top) / zoom;

    const metrics = scanRows();
    let targetBefore = null;
    let targetIndex = null;
    for (const m of metrics) {
        const midY = m.top + (m.bottom - m.top) / 2;
        if (curLocalY < midY) {
            targetBefore = m.row;
            targetIndex = m.index;
            break;
        }
    }

    if (targetIndex === null) {
        const songs = getSongs();
        targetIndex = songs.length;
    }
    activeGesture.dragToIndex = targetIndex;

    let needsMove = false;
    if (targetBefore) {
        needsMove = placeholder.nextSibling !== targetBefore;
    } else {
        needsMove = placeholder.parentNode !== listEl || placeholder.nextSibling !== null;
    }

    if (needsMove) {
        const beforeTops = captureVisualTops();

        if (targetBefore && targetBefore.parentNode === listEl) {
            listEl.insertBefore(placeholder, targetBefore);
        } else {
            listEl.appendChild(placeholder);
        }

        flipRows(beforeTops, FLIP_DURATION);
    }

    updateAutoScroll(e);
}

function finishDrag() {
    const { placeholder, ghost, dragIndices, dragToIndex, kind, listEl } = activeGesture;
    if (!placeholder) return;

    const beforeTops = captureVisualTops();

    if (ghost && ghost.parentNode) {
        ghost.parentNode.removeChild(ghost);
    }
    if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.removeChild(placeholder);
    }

    activeGesture.ghost = null;
    activeGesture.placeholder = null;
    activeGesture.dragCommitted = true;

    if (dragToIndex === null || !dragIndices.length) return;

    const parentEl = listEl.parentElement;

    if (kind === 'queue') store.moveTracksInQueue(dragIndices, dragToIndex);
    else if (kind === 'downloads') store.moveTracksInDownloads(dragIndices, dragToIndex);

    requestAnimationFrame(() => {
        if (!parentEl) return;
        const currentList = parentEl.querySelector('.song-list');
        if (!currentList || currentList !== listEl) return;
        flipRows(beforeTops, FLIP_DURATION_SETTLE);
    });
}

function enterSelect(e) {
    const { listEl, startLocalX, startLocalY } = activeGesture;
    activeGesture.state = 'selecting';
    setGlobalSuppressClick();
    listEl.classList.add('is-box-selecting');
    document.body.classList.add('list-gesture-active');

    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        store.clearSelection();
    }
    activeGesture.initialSelection = [...store.get().selection];

    const selectBox = document.createElement('div');
    selectBox.className = 'list-select-box';
    selectBox.style.position = 'absolute';
    selectBox.style.left = startLocalX + 'px';
    selectBox.style.top = startLocalY + 'px';
    selectBox.style.width = '0px';
    selectBox.style.height = '0px';
    listEl.appendChild(selectBox);
    activeGesture.selectBox = selectBox;
}

function updateSelect(e) {
    const { selectBox, listEl, startLocalX, startLocalY, initialSelection } = activeGesture;
    if (!selectBox) return;

    const zoom = getZoom();
    const listRect = listEl.getBoundingClientRect();
    const curLocalX = (e.clientX - listRect.left) / zoom;
    const curLocalY = (e.clientY - listRect.top) / zoom;

    const left = Math.min(startLocalX, curLocalX);
    const top = Math.min(startLocalY, curLocalY);
    const width = Math.abs(curLocalX - startLocalX);
    const height = Math.abs(curLocalY - startLocalY);

    selectBox.style.left = left + 'px';
    selectBox.style.top = top + 'px';
    selectBox.style.width = width + 'px';
    selectBox.style.height = height + 'px';

    const selTop = top;
    const selBottom = top + height;
    const selLeft = left;
    const selRight = left + width;

    const metrics = scanRows();
    const hits = [];
    for (const m of metrics) {
        if (selBottom < m.top || selTop > m.bottom) continue;
        if (selRight < m.left || selLeft > m.right) continue;
        if (m.song) hits.push(m.song);
    }

    const useInitial = e.shiftKey || e.ctrlKey || e.metaKey;
    const merged = [];
    const seen = new Set();
    if (useInitial && initialSelection && initialSelection.length) {
        for (const s of initialSelection) {
            if (s && s.id && !seen.has(s.id)) {
                seen.add(s.id);
                merged.push(s);
            }
        }
    }
    for (const s of hits) {
        if (s && s.id && !seen.has(s.id)) {
            seen.add(s.id);
            merged.push(s);
        }
    }

    if (!sameSelection(merged, store.get().selection)) {
        store.update({ selection: merged });
    }

    updateAutoScroll(e);
}

function finishSelect(e) {
    stopAutoScroll();
    const { selectBox } = activeGesture;
    if (!selectBox) return;
    const w = selectBox.offsetWidth;
    const h = selectBox.offsetHeight;
    if (w < 4 && h < 4) {
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
            store.clearSelection();
        }
    }
}

function updateAutoScroll(e) {
    if (!activeGesture) return;
    const { scrollParent } = activeGesture;
    if (!scrollParent) {
        activeGesture.autoScrollSpeed = 0;
        stopAutoScroll();
        return;
    }

    const rect = scrollParent.getBoundingClientRect();
    let speed = 0;

    if (e.clientY < rect.top + AUTO_SCROLL_EDGE) {
        const ratio = Math.min(1, (rect.top + AUTO_SCROLL_EDGE - e.clientY) / AUTO_SCROLL_EDGE);
        speed = -AUTO_SCROLL_MAX_SPEED * ratio * ratio;
    } else if (e.clientY > rect.bottom - AUTO_SCROLL_EDGE) {
        const ratio = Math.min(1, (e.clientY - (rect.bottom - AUTO_SCROLL_EDGE)) / AUTO_SCROLL_EDGE);
        speed = AUTO_SCROLL_MAX_SPEED * ratio * ratio;
    }

    activeGesture.autoScrollSpeed = speed;
    if (speed !== 0) startAutoScroll();
    else stopAutoScroll();
}

function autoScrollStep(ts) {
    if (!activeGesture) return;
    activeGesture.autoScrollRaf = null;

    if (activeGesture.autoScrollSpeed === 0) return;
    if (activeGesture.state !== 'selecting' && activeGesture.state !== 'dragging' && activeGesture.state !== 'draggingOut') {
        activeGesture.autoScrollSpeed = 0;
        return;
    }

    const dt = activeGesture.lastFrameTs ? Math.min(64, ts - activeGesture.lastFrameTs) : 16;
    activeGesture.lastFrameTs = ts;

    const { scrollParent } = activeGesture;
    if (scrollParent) {
        const max = Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight);
        const cur = scrollParent.scrollTop;
        let next = cur + (activeGesture.autoScrollSpeed * dt) / 1000;
        if (next < 0) next = 0;
        else if (next > max) next = max;
        if (next !== cur) {
            scrollParent.scrollTop = next;
        } else {
            activeGesture.autoScrollSpeed = 0;
            return;
        }
    }

    const lastEvent = activeGesture.lastPointerEvent;
    if (lastEvent) {
        if (activeGesture.state === 'selecting') updateSelect(lastEvent);
        else if (activeGesture.state === 'dragging') updateDrag(lastEvent);
        else if (activeGesture.state === 'draggingOut') updateDragOut(lastEvent);
    }

    if (activeGesture && activeGesture.autoScrollSpeed !== 0 && !activeGesture.autoScrollRaf) {
        activeGesture.autoScrollRaf = requestAnimationFrame(autoScrollStep);
    }
}

function startAutoScroll() {
    if (!activeGesture) return;
    if (activeGesture.autoScrollRaf) return;
    activeGesture.lastFrameTs = 0;
    activeGesture.autoScrollRaf = requestAnimationFrame(autoScrollStep);
}

function stopAutoScroll() {
    if (!activeGesture) return;
    activeGesture.autoScrollSpeed = 0;
    activeGesture.lastFrameTs = 0;
    if (activeGesture.autoScrollRaf) {
        cancelAnimationFrame(activeGesture.autoScrollRaf);
        activeGesture.autoScrollRaf = null;
    }
}

function cleanupGesture() {
    if (!activeGesture) return;

    stopAutoScroll();

    const { listEl, ghost, placeholder, dragGroupRows, dragCommitted, selectBox, dropTarget } = activeGesture;

    if (ghost && ghost.parentNode) {
        ghost.parentNode.removeChild(ghost);
    }

    if (activeGesture.state === 'dragging' && !dragCommitted && dragGroupRows && placeholder && placeholder.parentNode) {
        const parent = placeholder.parentNode;
        for (const r of dragGroupRows) {
            r.classList.remove('is-drag-group');
            parent.insertBefore(r, placeholder);
        }
    }

    if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.removeChild(placeholder);
    }

    if (listEl) {
        for (const r of listEl.querySelectorAll('.song-row')) {
            r.classList.remove('is-drag-group');
        }
    }

    if (selectBox && selectBox.parentNode) {
        selectBox.parentNode.removeChild(selectBox);
    }

    if (dropTarget) {
        dropTarget.classList.remove('is-drop-target');
    }

    if (listEl) {
        listEl.classList.remove('is-dragging', 'is-box-selecting');
    }
    document.body.classList.remove('list-gesture-active');

    activeGesture = null;
}