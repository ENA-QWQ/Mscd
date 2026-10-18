import { el } from './dom.js';
import { store } from './store.js';
import { icon, renderArtistInto, renderAlbumInto, closeAllMenus, Toast, copyText, shareSong, openShareCardModal } from './components.js';

const GOLDEN = 0.6180339887498949;
const CHUNK_HEIGHT = 1000;

function computeColumns(w) {
    if (w < 480) return 8;
    if (w < 720) return 12;
    if (w < 1100) return 16;
    return 20;
}

function placeCells(n, columns) {
    const sizes = new Array(n);
    for (let i = 0; i < n; i++) {
        const p = (i * GOLDEN) % 1;
        if (p < 0.08) sizes[i] = 4;
        else if (p < 0.42) sizes[i] = 2;
        else sizes[i] = 1;
    }

    const positions = new Array(n);
    let totalUnits = 0;
    for (const u of sizes) totalUnits += u * u;
    const maxRows = Math.ceil(totalUnits / columns) + 30;
    const grid = new Uint8Array(maxRows * columns);

    function isFree(x, y, u) {
        if (x + u > columns || y + u > maxRows) return false;
        for (let dy = 0; dy < u; dy++) {
            const base = (y + dy) * columns + x;
            for (let dx = 0; dx < u; dx++) {
                if (grid[base + dx]) return false;
            }
        }
        return true;
    }

    function mark(x, y, u) {
        for (let dy = 0; dy < u; dy++) {
            const base = (y + dy) * columns + x;
            for (let dx = 0; dx < u; dx++) {
                grid[base + dx] = 1;
            }
        }
    }

    let maxY = 0;

    for (let i = 0; i < n; i++) {
        let currentU = sizes[i];
        let placed = false;

        while (!placed) {
            const scanStart = currentU === 1 ? 0 : Math.max(0, maxY - currentU * 4);
            const scanEnd = maxY + currentU;

            for (let y = scanStart; y <= scanEnd && !placed; y++) {
                for (let x = 0; x + currentU <= columns; x++) {
                    if (isFree(x, y, currentU)) {
                        mark(x, y, currentU);
                        positions[i] = { x, y, u: currentU };
                        if (y + currentU > maxY) maxY = y + currentU;
                        placed = true;
                        break;
                    }
                }
            }

            if (!placed) {
                if (currentU > 1) {
                    currentU = currentU === 4 ? 2 : 1;
                } else {
                    mark(0, maxY, 1);
                    positions[i] = { x: 0, y: maxY, u: 1 };
                    maxY += 1;
                    placed = true;
                }
            }
        }
    }

    return { positions, totalRows: maxY };
}

function classify(u) {
    if (u >= 4) return 'normal';
    if (u >= 2) return 'small';
    return 'tiny';
}

function imageSrc(url, w, h) {
    if (!url) return '';
    if (url.indexOf('music.126.net') === -1) return url;
    try {
        const u = new URL(url);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const ww = Math.max(64, Math.round(w * dpr));
        const hh = Math.max(64, Math.round(h * dpr));
        u.searchParams.set('param', ww + 'y' + hh);
        return u.toString();
    } catch {
        return url;
    }
}

export function MosaicView(tracks, options) {
    const ctx = options.ctx;
    const getHandlers = options.getHandlers;
    const root = el('div', { class: 'mosaic-view' });

    let destroyed = false;
    let openPanel = null;
    let recomputeTimer = null;
    let retryCount = 0;
    let lastTracksRef = null;
    let lastWidth = 0;

    let io = null;
    let chunks = [];
    let cellMap = new Map();
    let currentPlayingCell = null;
    let lastPlayingId = '';

    function closePanel() {
        if (!openPanel) return;
        const p = openPanel;
        openPanel = null;
        p.classList.remove('is-open');
        if (p.__cell) p.__cell.classList.remove('has-menu-open');
        setTimeout(() => { if (p.parentNode) p.parentNode.removeChild(p); }, 260);
    }

    const onDocClick = () => closePanel();
    const onKeyDown = (e) => { if (e.key === 'Escape') closePanel(); };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeyDown);

    function getPlayingId() {
        const q = store.get().queue;
        const song = q.currentIndex >= 0 ? q.tracks[q.currentIndex] : null;
        return (q.isPlaying && song) ? String(song.id) : '';
    }

    function openMoreMenu(cell, song, anchor) {
        closeAllMenus();
        closePanel();
        const handlers = getHandlers ? getHandlers(song) : {};
        const items = [];
        if (handlers.onPlayNext) items.push({ icon: 'play-next', filled: true, text: '下一首播放', handler: handlers.onPlayNext });
        if (handlers.onDownloadNow) items.push({ icon: 'download', text: '直接下载', handler: handlers.onDownloadNow });
        if (handlers.onAddDownloadList) items.push({ icon: 'plus', text: '添加下载队列', handler: handlers.onAddDownloadList });
        if (handlers.onDownloadLyric) items.push({ icon: 'lyric', text: '下载歌词', handler: handlers.onDownloadLyric });
        if (handlers.onDownloadMv && song.mv && String(song.mv) !== '0') {
            items.push({ icon: 'video', text: '下载 MV', handler: handlers.onDownloadMv });
        }
        if (song.id) {
            items.push({
                icon: 'copy',
                text: '复制内容 ID',
                handler: (s) => {
                    copyText(s.id).then((ok) => {
                        if (ok) Toast('已复制内容 ID：' + s.id, 'success', 1600);
                        else Toast('复制失败', 'danger', 1600);
                    });
                },
            });
            items.push({ icon: 'link', text: '分享', handler: (s) => shareSong(s) });
            items.push({ icon: 'share-card', text: '生成分享图', handler: (s) => openShareCardModal(s) });
        }
        const panel = el('div', { class: 'mosaic-menu-panel' });
        for (const item of items) {
            const btn = el('button', { class: 'song-menu-item', type: 'button' },
                icon(item.icon, item.filled),
                el('span', { text: item.text })
            );
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                closePanel();
                item.handler(song);
            });
            panel.appendChild(btn);
        }
        const rect = anchor.getBoundingClientRect();
        panel.style.position = 'fixed';
        panel.style.top = (rect.bottom + 6) + 'px';
        const panelWidth = 180;
        let left = rect.right - panelWidth;
        if (left < 8) left = 8;
        if (left + panelWidth > window.innerWidth - 8) left = window.innerWidth - panelWidth - 8;
        panel.style.left = left + 'px';
        document.body.appendChild(panel);
        panel.__cell = cell;
        openPanel = panel;
        cell.classList.add('has-menu-open');
        requestAnimationFrame(() => panel.classList.add('is-open'));
    }

    function buildCell(song, index, rect, u) {
        const minEdge = Math.min(rect.w, rect.h);
        const tier = classify(u);
        const handlers = getHandlers ? getHandlers(song) : {};

        const cell = el('div', { class: 'mosaic-cell mosaic-cell--' + tier });
        cell.style.setProperty('--cell-size', minEdge + 'px');
        cell.style.left = rect.x + 'px';
        cell.style.top = rect.y + 'px';
        cell.style.width = rect.w + 'px';
        cell.style.height = rect.h + 'px';
        cell.dataset.id = song.id;
        cell.dataset.index = String(index);
        cell.__song = song;

        const cover = el('div', { class: 'mosaic-cover' });
        if (song.pic) {
            const img = document.createElement('img');
            img.src = imageSrc(song.pic, rect.w, rect.h);
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.addEventListener('error', () => {
                cover.innerHTML = '';
                cover.appendChild(icon('music'));
            });
            cover.appendChild(img);
        } else {
            cover.appendChild(icon('music'));
        }
        cell.appendChild(cover);

        const info = el('div', { class: 'mosaic-info' });
        info.appendChild(el('div', { class: 'mosaic-title', text: song.title || '未知歌曲' }));
        const artistLine = el('div', { class: 'mosaic-artist' });
        renderArtistInto(artistLine, song, ctx, '未知歌手');
        info.appendChild(artistLine);
        if (song.album) {
            const albumLine = el('div', { class: 'mosaic-album' });
            renderAlbumInto(albumLine, song, ctx, '');
            info.appendChild(albumLine);
        }
        cell.appendChild(info);

        const coverOverlay = el('div', { class: 'mosaic-cover-overlay' }, icon('play', true));
        cell.appendChild(coverOverlay);

        const playingBars = el('div', { class: 'mosaic-playing-bars' },
            el('span'), el('span'), el('span'), el('span')
        );
        cell.appendChild(playingBars);

        const actions = el('div', { class: 'mosaic-actions' });
        if (handlers.onDownloadNow) {
            const dlBtn = el('button', { class: 'mosaic-action', type: 'button', title: '直接下载' }, icon('download'));
            dlBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                handlers.onDownloadNow(song);
            });
            actions.appendChild(dlBtn);
        }
        const moreBtn = el('button', { class: 'mosaic-action', type: 'button', title: '更多' }, icon('dots-vertical', true));
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (openPanel && openPanel.__cell === cell) {
                closePanel();
                return;
            }
            openMoreMenu(cell, song, moreBtn);
        });
        actions.appendChild(moreBtn);
        cell.appendChild(actions);

        cell.addEventListener('click', (e) => {
            if (e.target.closest('.mosaic-actions')) return;
            if (e.target.closest('.entity-link')) return;
            if (document.body.classList.contains('has-selection') && handlers.onToggleSelect) {
                handlers.onToggleSelect(song);
                return;
            }
            if (handlers.onPlay) handlers.onPlay(song);
        });

        return cell;
    }

    function renderChunk(chunk) {
        if (chunk.rendered || destroyed) return;
        chunk.rendered = true;
        const playingId = getPlayingId();
        const frag = document.createDocumentFragment();
        for (const item of chunk.items) {
            const cell = buildCell(item.track, item.index, item.rect, item.u);
            const sid = String(item.track.id || '');
            if (playingId && sid === playingId) {
                cell.classList.add('is-playing');
                currentPlayingCell = cell;
            }
            if (sid) cellMap.set(sid, cell);
            chunk.cells.push(cell);
            frag.appendChild(cell);
        }
        root.appendChild(frag);
    }

    function unrenderChunk(chunk) {
        if (!chunk.rendered || destroyed) return;
        chunk.rendered = false;
        for (const cell of chunk.cells) {
            const sid = String(cell.dataset.id || '');
            if (sid) cellMap.delete(sid);
            if (cell === currentPlayingCell) currentPlayingCell = null;
            if (cell === openPanel?.__cell) closePanel();
            if (cell.parentNode) cell.parentNode.removeChild(cell);
        }
        chunk.cells.length = 0;
    }

    function handleIntersect(entries) {
        for (const entry of entries) {
            const chunk = entry.target.__chunk;
            if (!chunk) continue;
            if (entry.isIntersecting) {
                renderChunk(chunk);
            } else {
                unrenderChunk(chunk);
            }
        }
    }

    function syncPlaying(state) {
        if (destroyed) return;
        const q = state.queue;
        const song = q.currentIndex >= 0 ? q.tracks[q.currentIndex] : null;
        const newPlayingId = (q.isPlaying && song) ? String(song.id) : '';
        if (newPlayingId === lastPlayingId) return;
        lastPlayingId = newPlayingId;

        if (currentPlayingCell) {
            currentPlayingCell.classList.remove('is-playing');
            currentPlayingCell = null;
        }
        if (newPlayingId) {
            const cell = cellMap.get(newPlayingId);
            if (cell) {
                cell.classList.add('is-playing');
                currentPlayingCell = cell;
            }
        }
    }

    function computeAndRender() {
        if (destroyed) return;
        const width = root.clientWidth || (root.parentElement ? root.parentElement.clientWidth : 0);
        if (width <= 0 && retryCount < 15) {
            retryCount++;
            requestAnimationFrame(computeAndRender);
            return;
        }
        retryCount = 0;
        if (width <= 0) return;

        if (!tracks.length) {
            if (root.children.length) root.innerHTML = '';
            if (root.style.height !== '0px') root.style.height = '0px';
            chunks = [];
            cellMap.clear();
            lastTracksRef = null;
            lastWidth = 0;
            return;
        }

        if (lastTracksRef === tracks && lastWidth === width && root.children.length > 0) return;
        lastTracksRef = tracks;
        lastWidth = width;

        if (io) io.disconnect();
        io = new IntersectionObserver(handleIntersect, {
            root: null,
            rootMargin: '600px 0px',
        });

        chunks = [];
        cellMap.clear();
        currentPlayingCell = null;
        lastPlayingId = '';
        root.innerHTML = '';

        const columns = computeColumns(width);
        const unit = width / columns;
        const { positions, totalRows } = placeCells(tracks.length, columns);
        const totalHeight = totalRows * unit;

        if (root.style.height !== totalHeight + 'px') {
            root.style.height = totalHeight + 'px';
        }

        const chunkCount = Math.max(1, Math.ceil(totalHeight / CHUNK_HEIGHT));
        const chunkItems = new Array(chunkCount);
        for (let i = 0; i < chunkCount; i++) chunkItems[i] = [];

        for (let i = 0; i < tracks.length; i++) {
            const p = positions[i];
            if (!p) continue;
            const x0 = Math.round(p.x * unit);
            const y0 = Math.round(p.y * unit);
            const x1 = Math.round((p.x + p.u) * unit);
            const y1 = Math.round((p.y + p.u) * unit);
            const chunkIdx = Math.min(chunkCount - 1, Math.floor(y0 / CHUNK_HEIGHT));
            chunkItems[chunkIdx].push({
                track: tracks[i],
                index: i,
                rect: {
                    x: x0,
                    y: y0,
                    w: Math.max(1, x1 - x0 + 0.25),
                    h: Math.max(1, y1 - y0 + 0.25),
                },
                u: p.u,
            });
        }

        const frag = document.createDocumentFragment();
        for (let i = 0; i < chunkCount; i++) {
            let minTop = Infinity;
            let maxBottom = -Infinity;
            for (const it of chunkItems[i]) {
                if (it.rect.y < minTop) minTop = it.rect.y;
                const bottom = it.rect.y + it.rect.h;
                if (bottom > maxBottom) maxBottom = bottom;
            }
            if (!isFinite(minTop)) {
                minTop = i * CHUNK_HEIGHT;
                maxBottom = minTop;
            }
            const ph = el('div', { class: 'mosaic-chunk' });
            ph.style.top = minTop + 'px';
            ph.style.height = Math.max(1, maxBottom - minTop) + 'px';
            const chunk = {
                items: chunkItems[i],
                cells: [],
                rendered: false,
                placeholder: ph,
            };
            ph.__chunk = chunk;
            chunks.push(chunk);
            frag.appendChild(ph);
        }
        root.appendChild(frag);

        for (const chunk of chunks) io.observe(chunk.placeholder);

        requestAnimationFrame(() => {
            const container = root.closest('.content-area');
            const scrollTop = container ? container.scrollTop : 0;
            const startIdx = Math.max(0, Math.floor((scrollTop - 600) / CHUNK_HEIGHT));
            const endIdx = Math.min(chunkCount - 1, Math.floor((scrollTop + 1400) / CHUNK_HEIGHT));
            for (let i = startIdx; i <= endIdx; i++) {
                if (chunks[i]) renderChunk(chunks[i]);
            }
        });
    }

    const unsubscribe = store.subscribe(syncPlaying);

    requestAnimationFrame(() => requestAnimationFrame(computeAndRender));

    const ro = new ResizeObserver((entries) => {
        const entry = entries && entries[0];
        if (!entry) return;
        let w = 0;
        if (entry.contentBoxSize && entry.contentBoxSize[0]) {
            w = entry.contentBoxSize[0].inlineSize;
        } else {
            w = entry.contentRect ? entry.contentRect.width : 0;
        }
        if (Math.abs(w - lastWidth) < 2) return;
        if (recomputeTimer) clearTimeout(recomputeTimer);
        recomputeTimer = setTimeout(() => {
            recomputeTimer = null;
            computeAndRender();
        }, 150);
    });
    ro.observe(root, { box: 'content-box' });

    root.__destroy = () => {
        destroyed = true;
        if (recomputeTimer) clearTimeout(recomputeTimer);
        if (io) io.disconnect();
        ro.disconnect();
        unsubscribe();
        closePanel();
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onKeyDown);
    };

    return { node: root, destroy: root.__destroy };
}
