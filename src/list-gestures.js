import { store } from './store.js';

const DRAG_THRESHOLD = 6;
const SELECT_THRESHOLD = 6;
const AUTO_SCROLL_EDGE = 40;
const AUTO_SCROLL_MAX_SPEED = 600;

const FLIP_DURATION = 160;
const FLIP_EASING = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
const FLIP_DURATION_SETTLE = 240;

const PLACEHOLDER_ID = '__drag-placeholder__';

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

export function attachListGestures(listEl, options) {
    const kind = options.kind;
    const canReorder = options.canReorder || (() => true);

    listEl.style.userSelect = 'none';
    listEl.style.webkitUserSelect = 'none';

    if (getComputedStyle(listEl).position === 'static') {
        listEl.style.position = 'relative';
    }

    let state = 'idle';
    let startX = 0;
    let startY = 0;
    let startLocalX = 0;
    let startLocalY = 0;
    let activePointerId = null;
    let sourceRow = null;
    let dragIndices = [];
    let dragToIndex = null;
    let dragGroupRows = null;
    let dragCommitted = false;
    let ghost = null;
    let ghostOffsetX = 0;
    let ghostOffsetY = 0;
    let placeholder = null;
    let selectBox = null;
    let initialSelection = null;
    let scrollParent = null;
    let lastPointerEvent = null;
    let autoScrollRaf = null;
    let autoScrollSpeed = 0;
    let lastFrameTs = 0;
    let suppressClick = false;
    let suppressClickTimer = null;

    function getSongs() {
        return kind === 'queue' ? store.get().queue.tracks : store.get().downloads;
    }

    function scanRows() {
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
                index: Number(r.dataset.index),
            });
        }
        return result;
    }

    function setSuppressClick() {
        suppressClick = true;
        if (suppressClickTimer) clearTimeout(suppressClickTimer);
        suppressClickTimer = setTimeout(() => {
            suppressClick = false;
            suppressClickTimer = null;
        }, 320);
    }

    function onCaptureClick(e) {
        if (!suppressClick) return;
        suppressClick = false;
        if (suppressClickTimer) {
            clearTimeout(suppressClickTimer);
            suppressClickTimer = null;
        }
        e.stopPropagation();
        e.preventDefault();
    }

    function captureVisualTops() {
        const map = new Map();
        for (const r of listEl.children) {
            const key = getFlipKey(r);
            if (!key) continue;
            if (!map.has(key)) map.set(key, r.getBoundingClientRect().top);
        }
        return map;
    }

    function flipRows(beforeTops, duration = FLIP_DURATION) {
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

    function cloneRowForPreview(row) {
        const clone = row.cloneNode(true);
        clone.removeAttribute('style');
        clone.classList.remove('is-drag-group');
        clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
        return clone;
    }

    function onPointerDown(e) {
        if (state !== 'idle') return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        const target = e.target;
        if (!(target instanceof Element)) return;
        if (target.closest('.song-select, .song-actions, .song-menu, .song-menu-panel, .song-menu-trigger, button, input, a, label')) return;
        if (!listEl.contains(target)) return;

        const row = target.closest('.song-row');
        const inNameArea = !!(row && target.closest('.song-title, .song-album, .song-artist'));

        startX = e.clientX;
        startY = e.clientY;
        const listRect = listEl.getBoundingClientRect();
        const zoom = getZoom();
        startLocalX = (e.clientX - listRect.left) / zoom;
        startLocalY = (e.clientY - listRect.top) / zoom;
        activePointerId = e.pointerId;
        scrollParent = findScrollParent(listEl);

        if (row && inNameArea) {
            if (!canReorder()) return;
            state = 'pendingDrag';
            sourceRow = row;
        } else {
            state = 'pendingSelect';
        }

        if (e.cancelable) e.preventDefault();
    }

    function onPointerMove(e) {
        if (state === 'idle') return;
        if (activePointerId !== null && e.pointerId !== activePointerId) return;

        lastPointerEvent = e;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (state === 'pendingDrag') {
            if (e.cancelable) e.preventDefault();
            if (dist < DRAG_THRESHOLD) return;
            enterDrag(e);
        } else if (state === 'pendingSelect') {
            if (e.cancelable) e.preventDefault();
            if (dist < SELECT_THRESHOLD) return;
            enterSelect(e);
        } else if (state === 'dragging') {
            if (e.cancelable) e.preventDefault();
            updateDrag(e);
        } else if (state === 'selecting') {
            if (e.cancelable) e.preventDefault();
            updateSelect(e);
        }
    }

    function onPointerUp(e) {
        if (activePointerId !== null && e.pointerId !== activePointerId) return;
        if (state === 'dragging') finishDrag();
        else if (state === 'selecting') finishSelect(e);
        cleanup();
    }

    function onPointerCancel(e) {
        if (activePointerId !== null && e.pointerId !== activePointerId) return;
        cleanup();
    }

    function enterDrag(e) {
        state = 'dragging';
        dragCommitted = false;
        setSuppressClick();
        listEl.classList.add('is-dragging');
        document.body.classList.add('list-gesture-active');

        const dragIndex = Number(sourceRow.dataset.index);
        if (!Number.isInteger(dragIndex)) {
            cleanup();
            return;
        }

        const songs = getSongs();
        const sourceSong = songs[dragIndex];
        if (!sourceSong) {
            cleanup();
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
            cleanup();
            return;
        }

        dragIndices = groupRows.map(r => Number(r.dataset.index)).sort((a, b) => a - b);
        dragGroupRows = groupRows;
        dragToIndex = null;

        const zoom = getZoom();
        const sourceRect = sourceRow.getBoundingClientRect();
        const sourceTop = sourceRect.top;
        const sourceLeft = sourceRect.left;

        let totalHeight = 0;
        let maxWidth = 0;
        for (const r of groupRows) {
            const rr = r.getBoundingClientRect();
            totalHeight += rr.height / zoom;
            if (rr.width > maxWidth) maxWidth = rr.width;
        }
        if (totalHeight <= 0) totalHeight = sourceRect.height / zoom;
        const width = maxWidth || sourceRect.width || 360;

        placeholder = document.createElement('div');
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

        ghost = document.createElement('div');
        ghost.className = 'list-drag-ghost';
        ghost.style.position = 'fixed';
        ghost.style.left = '0';
        ghost.style.top = '0';
        ghost.style.width = width + 'px';
        ghost.style.margin = '0';
        ghost.style.zIndex = '9999';
        ghost.style.pointerEvents = 'none';
        ghost.style.boxShadow = '0 10px 28px rgba(0, 0, 0, 0.22)';
        ghost.style.transformOrigin = 'top left';
        ghost.style.background = 'var(--bg-menu, #fff)';
        ghost.style.overflow = 'hidden';

        for (const r of groupRows) {
            const clone = cloneRowForPreview(r);
            clone.style.width = '100%';
            ghost.appendChild(clone);
        }

        document.body.appendChild(ghost);

        ghost.style.transform = `translate(${sourceLeft / zoom}px, ${sourceTop / zoom}px)`;

        ghostOffsetX = e.clientX - sourceLeft;
        ghostOffsetY = e.clientY - sourceTop;

        updateDrag(e);
    }

    function updateDrag(e) {
        if (!ghost || !placeholder) return;
        if (placeholder.parentNode !== listEl) return;

        const zoom = getZoom();
        const screenX = (e.clientX - ghostOffsetX) / zoom;
        const screenY = (e.clientY - ghostOffsetY) / zoom;
        ghost.style.transform = `translate(${screenX}px, ${screenY}px)`;

        const listRect = listEl.getBoundingClientRect();
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
        dragToIndex = targetIndex;

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
        if (!placeholder) return;

        const beforeTops = captureVisualTops();

        if (ghost && ghost.parentNode) {
            ghost.parentNode.removeChild(ghost);
        }
        if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.removeChild(placeholder);
        }

        ghost = null;
        placeholder = null;
        dragCommitted = true;

        if (dragToIndex === null || !dragIndices.length) return;

        const parentEl = listEl.parentElement;

        if (kind === 'queue') store.moveTracksInQueue(dragIndices, dragToIndex);
        else store.moveTracksInDownloads(dragIndices, dragToIndex);

        requestAnimationFrame(() => {
            if (!parentEl) return;
            const currentList = parentEl.querySelector('.song-list');
            if (!currentList || currentList !== listEl) return;
            flipRows(beforeTops, FLIP_DURATION_SETTLE);
        });
    }

    function enterSelect(e) {
        state = 'selecting';
        setSuppressClick();
        listEl.classList.add('is-box-selecting');
        document.body.classList.add('list-gesture-active');

        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
            store.clearSelection();
        }
        initialSelection = [...store.get().selection];

        selectBox = document.createElement('div');
        selectBox.className = 'list-select-box';
        selectBox.style.position = 'absolute';
        selectBox.style.left = startLocalX + 'px';
        selectBox.style.top = startLocalY + 'px';
        selectBox.style.width = '0px';
        selectBox.style.height = '0px';
        listEl.appendChild(selectBox);
    }

    function updateSelect(e) {
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

        const songs = getSongs();
        const metrics = scanRows();
        const hits = [];
        for (const m of metrics) {
            if (selBottom < m.top || selTop > m.bottom) continue;
            const song = songs[m.index];
            if (song) hits.push(song);
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
        if (!scrollParent) {
            autoScrollSpeed = 0;
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

        autoScrollSpeed = speed;
        if (speed !== 0) startAutoScroll();
        else stopAutoScroll();
    }

    function autoScrollStep(ts) {
        autoScrollRaf = null;

        if (autoScrollSpeed === 0) return;
        if (state !== 'selecting' && state !== 'dragging') {
            autoScrollSpeed = 0;
            return;
        }

        const dt = lastFrameTs ? Math.min(64, ts - lastFrameTs) : 16;
        lastFrameTs = ts;

        if (scrollParent) {
            const max = Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight);
            const cur = scrollParent.scrollTop;
            let next = cur + (autoScrollSpeed * dt) / 1000;
            if (next < 0) next = 0;
            else if (next > max) next = max;
            if (next !== cur) {
                scrollParent.scrollTop = next;
            } else {
                autoScrollSpeed = 0;
                return;
            }
        }

        if (lastPointerEvent) {
            if (state === 'selecting') updateSelect(lastPointerEvent);
            else if (state === 'dragging') updateDrag(lastPointerEvent);
        }

        if (autoScrollSpeed !== 0 && !autoScrollRaf) {
            autoScrollRaf = requestAnimationFrame(autoScrollStep);
        }
    }

    function startAutoScroll() {
        if (autoScrollRaf) return;
        lastFrameTs = 0;
        autoScrollRaf = requestAnimationFrame(autoScrollStep);
    }

    function stopAutoScroll() {
        autoScrollSpeed = 0;
        lastFrameTs = 0;
        if (autoScrollRaf) {
            cancelAnimationFrame(autoScrollRaf);
            autoScrollRaf = null;
        }
    }

    function cleanup() {
        stopAutoScroll();

        const wasDragging = state === 'dragging';
        const wasCommitted = dragCommitted;

        if (ghost && ghost.parentNode) {
            ghost.parentNode.removeChild(ghost);
        }
        ghost = null;

        if (wasDragging && !wasCommitted && dragGroupRows && placeholder && placeholder.parentNode) {
            const parent = placeholder.parentNode;
            for (const r of dragGroupRows) {
                r.classList.remove('is-drag-group');
                parent.insertBefore(r, placeholder);
            }
        }

        if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.removeChild(placeholder);
        }
        placeholder = null;

        for (const r of listEl.querySelectorAll('.song-row')) {
            r.classList.remove('is-drag-group');
        }

        if (selectBox && selectBox.parentNode) selectBox.parentNode.removeChild(selectBox);

        state = 'idle';
        sourceRow = null;
        dragIndices = [];
        dragToIndex = null;
        dragGroupRows = null;
        dragCommitted = false;
        selectBox = null;
        initialSelection = null;
        activePointerId = null;
        lastPointerEvent = null;
        scrollParent = null;
        listEl.classList.remove('is-dragging', 'is-box-selecting');
        document.body.classList.remove('list-gesture-active');
    }

    listEl.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('click', onCaptureClick, true);

    return {
        destroy: () => {
            listEl.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('pointermove', onPointerMove, { passive: false });
            document.removeEventListener('pointerup', onPointerUp);
            document.removeEventListener('pointercancel', onPointerCancel);
            document.removeEventListener('click', onCaptureClick, true);
            cleanup();
        },
    };
}