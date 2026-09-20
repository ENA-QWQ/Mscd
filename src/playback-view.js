import { el } from './dom.js';
import { icon } from './components.js';
import { loadLyric, findCurrentIndex } from './lyric.js';

const SCROLL_DURATION = 280;
const SCROLL_EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

export function initPlaybackView(ctx) {
    const { store, player } = ctx;

    const bg = el('div', { class: 'playback-overlay__bg' });
    const scrim = el('div', { class: 'playback-overlay__scrim' });

    const closeBtn = el('button', {
        class: 'ena-btn ena-btn--icon',
        title: '收起',
    }, icon('chevron-left'));

    const topBar = el('div', { class: 'playback-overlay__top' }, closeBtn);

    const coverEl = el('div', { class: 'playback-cover' });
    const titleEl = el('div', { class: 'playback-title' });
    const artistEl = el('div', { class: 'playback-artist' });
    const albumEl = el('div', { class: 'playback-album' });

    const titleRow = el('div', { class: 'playback-title-row' }, titleEl, albumEl);
    const infoEl = el('div', { class: 'playback-info' }, titleRow, artistEl);

    const leftEl = el('div', { class: 'playback-overlay__left' }, coverEl, infoEl);

    const lyricSpacerTop = el('div', { class: 'playback-lyric__spacer' });
    const lyricSpacerBottom = el('div', { class: 'playback-lyric__spacer' });
    const lyricLines = el('div', { class: 'playback-lyric__lines' });
    const lyricScroller = el('div', { class: 'playback-lyric__scroller' },
        lyricSpacerTop, lyricLines, lyricSpacerBottom
    );
    const lyricEl = el('div', { class: 'playback-lyric' }, lyricScroller);

    const lyricPlaceholder = el('div', { class: 'playback-lyric__placeholder', text: '暂无歌词' });

    const rightEl = el('div', { class: 'playback-overlay__right' }, lyricEl, lyricPlaceholder);

    const inner = el('div', { class: 'playback-overlay__inner' }, leftEl, rightEl);

    const overlay = el('div', { class: 'playback-overlay' }, bg, scrim, topBar, inner);

    document.body.appendChild(overlay);

    let currentSongId = '';
    let currentLyric = { lines: [], hasTimestamps: false };
    let currentLineIndex = -1;
    let lyricLoading = false;
    let lyricToken = 0;
    let followPaused = false;
    let followTimer = null;
    let scrollY = 0;
    let isDragging = false;
    let dragStartY = 0;
    let dragStartScrollY = 0;
    let switchingTimer = null;

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

    function renderCover(song) {
        coverEl.innerHTML = '';
        if (song && song.pic) {
            const img = document.createElement('img');
            img.src = song.pic;
            img.alt = '';
            img.addEventListener('error', () => {
                coverEl.innerHTML = '';
                coverEl.appendChild(createCoverPlaceholder());
            });
            coverEl.appendChild(img);
        } else {
            coverEl.appendChild(createCoverPlaceholder());
        }
    }

    function renderBg(song) {
        if (song && song.pic) {
            bg.style.backgroundImage = `url("${song.pic}")`;
        } else {
            bg.style.backgroundImage = '';
        }
    }

    function getMaxScroll() {
        return Math.max(0, lyricScroller.scrollHeight - lyricEl.clientHeight);
    }

    function applyScroll(animated) {
        lyricScroller.style.transition = animated
            ? `transform ${SCROLL_DURATION}ms ${SCROLL_EASE}`
            : 'none';
        lyricScroller.style.transform = `translateY(${-scrollY}px)`;
    }

    function updateSpacerHeight() {
        const h = lyricEl.clientHeight;
        if (h <= 0) return;
        const spacerH = Math.floor(h / 2);
        lyricSpacerTop.style.height = spacerH + 'px';
        lyricSpacerBottom.style.height = spacerH + 'px';
    }

    function renderLyricLines(lines) {
        lyricLines.innerHTML = '';
        currentLineIndex = -1;
        scrollY = 0;
        applyScroll(false);

        if (!lines.length) {
            lyricEl.classList.add('hidden');
            lyricPlaceholder.classList.remove('hidden');
            return;
        }

        lyricEl.classList.remove('hidden');
        lyricPlaceholder.classList.add('hidden');

        lines.forEach((line, index) => {
            const row = el('div', { class: 'playback-lyric__line' });
            row.dataset.index = String(index);
            row.appendChild(el('div', {
                class: 'playback-lyric__text',
                text: line.text || '',
            }));
            if (line.translation) {
                row.appendChild(el('div', {
                    class: 'playback-lyric__translation',
                    text: line.translation,
                }));
            }
            row.addEventListener('click', () => {
                if (!currentLyric.hasTimestamps) return;
                if (line.time < 0) return;
                const q = store.get().queue;
                const total = q.duration || 0;
                if (!total) return;
                player.seek(line.time / total);
                resumeFollow();
            });
            lyricLines.appendChild(row);
        });
    }

    function scrollLineIntoCenter(row, smooth) {
        if (!row) return;
        const rowTop = row.offsetTop;
        const rowHeight = row.offsetHeight;
        const containerHeight = lyricEl.clientHeight;
        const target = rowTop - (containerHeight - rowHeight) / 2;
        const max = getMaxScroll();
        const top = Math.max(0, Math.min(target, max));
        scrollY = top;
        applyScroll(smooth);
    }

    function updateHighlight(index, smooth) {
        if (index === currentLineIndex) return;

        const prev = lyricLines.children[currentLineIndex];
        const row = lyricLines.children[index];
        if (!row) return;

        currentLineIndex = index;

        if (prev) prev.classList.remove('is-current');
        row.classList.add('is-current');

        if (!followPaused) {
            scrollLineIntoCenter(row, smooth);
        }
    }

    function pauseFollow(ms) {
        followPaused = true;
        if (followTimer) clearTimeout(followTimer);
        followTimer = setTimeout(() => {
            followPaused = false;
            if (currentLineIndex >= 0) {
                const row = lyricLines.children[currentLineIndex];
                scrollLineIntoCenter(row, true);
            }
        }, ms);
    }

    function resumeFollow() {
        followPaused = false;
        if (followTimer) {
            clearTimeout(followTimer);
            followTimer = null;
        }
    }

    async function loadCurrentLyric(song) {
        const token = ++lyricToken;
        lyricLoading = true;

        currentLyric = { lines: [], hasTimestamps: false };
        currentLineIndex = -1;
        lyricLines.innerHTML = '';
        scrollY = 0;
        applyScroll(false);
        lyricEl.classList.remove('hidden');
        lyricPlaceholder.classList.add('hidden');

        try {
            const parsed = await loadLyric(ctx.api, song);
            if (token !== lyricToken) return;
            currentLyric = parsed;
            renderLyricLines(parsed.lines);
        } catch {
            if (token !== lyricToken) return;
            currentLyric = { lines: [], hasTimestamps: false };
            lyricEl.classList.add('hidden');
            lyricPlaceholder.classList.remove('hidden');
            lyricPlaceholder.textContent = '歌词加载失败';
        } finally {
            if (token === lyricToken) lyricLoading = false;
        }
    }

    function handleTimeUpdate() {
        if (!currentLyric.hasTimestamps || !currentLyric.lines.length) return;
        const q = store.get().queue;
        const t = q.currentTime || 0;
        const idx = findCurrentIndex(currentLyric.lines, t);
        if (idx >= 0) updateHighlight(idx, true);
    }

    function handleSongChange(song) {
        if (!song) return;
        const id = String(song.id || '');
        if (id === currentSongId) return;
        currentSongId = id;

        if (switchingTimer) {
            clearTimeout(switchingTimer);
            switchingTimer = null;
        }

        overlay.classList.add('is-switching');

        switchingTimer = setTimeout(() => {
            switchingTimer = null;
            renderCover(song);
            renderBg(song);
            titleEl.textContent = song.title || '未知歌曲';
            artistEl.textContent = song.artist || '未知歌手';
            albumEl.textContent = song.album || '';
            loadCurrentLyric(song);
            overlay.classList.remove('is-switching');
        }, 200);
    }

    function onWheel(e) {
        e.preventDefault();
        const max = getMaxScroll();
        scrollY = Math.max(0, Math.min(max, scrollY + e.deltaY));
        applyScroll(false);
        pauseFollow(2000);
    }

    function onTouchStart(e) {
        if (e.touches.length !== 1) return;
        isDragging = true;
        dragStartY = e.touches[0].clientY;
        dragStartScrollY = scrollY;
        pauseFollow(3000);
    }

    function onTouchMove(e) {
        if (!isDragging || e.touches.length !== 1) return;
        const dy = dragStartY - e.touches[0].clientY;
        const max = getMaxScroll();
        scrollY = Math.max(0, Math.min(max, dragStartScrollY + dy));
        applyScroll(false);
    }

    function onTouchEnd() {
        isDragging = false;
    }

    closeBtn.addEventListener('click', () => {
        store.update({ playbackOpen: false });
    });

    lyricEl.addEventListener('wheel', onWheel, { passive: false });
    lyricEl.addEventListener('touchstart', onTouchStart, { passive: true });
    lyricEl.addEventListener('touchmove', onTouchMove, { passive: true });
    lyricEl.addEventListener('touchend', onTouchEnd, { passive: true });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && store.get().playbackOpen) {
            store.update({ playbackOpen: false });
        }
    });

    player.on('timeupdate', handleTimeUpdate);
    player.on('trackchange', (song) => handleSongChange(song));

    window.addEventListener('resize', updateSpacerHeight);

    let lastSongKey = '';

    store.subscribe((state) => {
        const q = state.queue;
        const song = q.currentIndex >= 0 ? q.tracks[q.currentIndex] : null;

        document.body.classList.toggle('playback-open', !!state.playbackOpen);

        if (state.playbackOpen) {
            requestAnimationFrame(updateSpacerHeight);
        }

        if (song) {
            const key = String(song.id || song.url || song.title || '');
            if (key !== lastSongKey) {
                lastSongKey = key;
                handleSongChange(song);
            }
        }
    });

    const playerInfo = document.querySelector('.player-info');
    if (playerInfo) {
        playerInfo.style.cursor = 'pointer';
        playerInfo.addEventListener('click', () => {
            const q = store.get().queue;
            if (q.currentIndex < 0 || !q.tracks[q.currentIndex]) return;
            store.update({ playbackOpen: true });
        });
    }

    return {
        node: overlay,
        destroy: () => {
            if (switchingTimer) clearTimeout(switchingTimer);
            window.removeEventListener('resize', updateSpacerHeight);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        },
    };
}