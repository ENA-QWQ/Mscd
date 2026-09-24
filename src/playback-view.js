import { el } from './dom.js';
import { icon, shareSong, openShareCardModal, Toast } from './components.js';
import { loadLyric, findCurrentIndex } from './lyric.js';
import { openDownloadOptionsModal, handleDownloadLyric } from './views.js';

const SCROLL_DURATION = 280;
const SCROLL_EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';

function formatMobileTime(sec) {
    if (!sec || !isFinite(sec) || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

export function initPlaybackView(ctx) {
    const { store, player } = ctx;

    const bg = el('div', { class: 'playback-overlay__bg' });

    const glowBlobs = [
        el('div', { class: 'playback-overlay__glow-blob' }),
        el('div', { class: 'playback-overlay__glow-blob' }),
        el('div', { class: 'playback-overlay__glow-blob' }),
    ];
    const glow = el('div', { class: 'playback-overlay__glow' }, ...glowBlobs);

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

    const SVG_NS = 'http://www.w3.org/2000/svg';

    function createMobileSvg(pathContent, filled = true, viewBox = '0 0 24 24') {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', viewBox);
        if (filled) {
            svg.setAttribute('fill', 'currentColor');
        } else {
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '2');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
        }
        svg.innerHTML = pathContent;
        return svg;
    }

    const MOBILE_MODE_ICONS = {
        order: '<path d="M1 3h8.5v1.2H1zM1 7.4h8.5v1.2H1zM1 11.8h8.5v1.2H1z"/><path d="M11 3.5L15 8l-4 4.5z"/>',
        shuffle: '<path fill-rule="evenodd" d="M0 3.5A.5.5 0 0 1 .5 3H1c2.202 0 3.827 1.24 4.874 2.418.49.552.865 1.102 1.126 1.532.26-.43.636-.98 1.126-1.532C9.173 4.24 10.798 3 13 3v1c-1.798 0-3.173 1.01-4.126 2.082A9.6 9.6 0 0 0 7.556 8a9.6 9.6 0 0 0 1.317 1.918C9.828 10.99 11.204 12 13 12v1c-2.202 0-3.827-1.24-4.874-2.418A10.6 10.6 0 0 1 7 9.05c-.26.43-.636.98-1.126 1.532C4.827 11.76 3.202 13 1 13H.5a.5.5 0 0 1 0-1H1c1.798 0 3.173-1.01 4.126-2.082A9.6 9.6 0 0 0 6.444 8a9.6 9.6 0 0 0-1.317-1.918C4.172 5.01 2.796 4 1 4H.5a.5.5 0 0 1-.5-.5"/><path d="M13 5.466V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192m0 9v-3.932a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192"/>',
        'repeat-one': '<path d="M11 4v1.466a.25.25 0 0 0 .41.192l2.36-1.966a.25.25 0 0 0 0-.384l-2.36-1.966a.25.25 0 0 0-.41.192V3H5a5 5 0 0 0-4.48 7.223.5.5 0 0 0 .896-.446A4 4 0 0 1 5 4zm4.48 1.777a.5.5 0 0 0-.896.446A4 4 0 0 1 11 12H5.001v-1.466a.25.25 0 0 0-.41-.192l-2.36 1.966a.25.25 0 0 0 0 .384l2.36 1.966a.25.25 0 0 0 .41-.192V13h6a5 5 0 0 0 4.48-7.223Z"/><path d="M9 5.5a.5.5 0 0 0-.854-.354l-1.75 1.75a.5.5 0 1 0 .708.708L8 6.707V10.5a.5.5 0 0 0 1 0z"/>',
        'repeat-all': '<path d="M11 5.466V4H5a4 4 0 0 0-3.584 5.777.5.5 0 1 1-.896.446A5 5 0 0 1 5 3h6V1.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384l-2.36 1.966a.25.25 0 0 1-.41-.192m3.81.086a.5.5 0 0 1 .67.225A5 5 0 0 1 11 13H5v1.466a.25.25 0 0 1-.41.192l-2.36-1.966a.25.25 0 0 1 0-.384l2.36-1.966a.25.25 0 0 1 .41.192V12h6a4 4 0 0 0 3.585-5.777.5.5 0 0 1 .225-.67Z"/>',
    };

    const MOBILE_MODE_LABELS = {
        order: '顺序播放',
        shuffle: '随机播放',
        'repeat-one': '单曲循环',
        'repeat-all': '列表循环',
    };

    const mobileControlsEl = el('div', { class: 'playback-mobile-controls' });

    const mobileModeBtn = el('button', {
        class: 'playback-mobile-btn playback-mobile-btn--small',
        title: '顺序播放',
        type: 'button',
    });
    const mobileModeSvg = document.createElementNS(SVG_NS, 'svg');
    mobileModeSvg.setAttribute('viewBox', '0 0 16 16');
    mobileModeSvg.setAttribute('fill', 'currentColor');
    mobileModeSvg.setAttribute('stroke', 'none');
    mobileModeSvg.innerHTML = MOBILE_MODE_ICONS.order;
    mobileModeBtn.appendChild(mobileModeSvg);

    const mobilePrevBtn = el('button', {
        class: 'playback-mobile-btn playback-mobile-btn--medium',
        title: '上一首',
        type: 'button',
    }, createMobileSvg('<polygon points="19 20 9 12 19 4"/><rect x="4" y="4" width="2" height="16"/>'));

    const mobilePlayBtn = el('button', {
        class: 'playback-mobile-btn playback-mobile-btn--large',
        title: '播放',
        type: 'button',
    });
    const mobilePlaySvg = document.createElementNS(SVG_NS, 'svg');
    mobilePlaySvg.setAttribute('viewBox', '0 0 24 24');
    mobilePlaySvg.setAttribute('fill', 'currentColor');
    mobilePlaySvg.innerHTML = '<polygon points="6 4 20 12 6 20"/>';
    mobilePlayBtn.appendChild(mobilePlaySvg);

    const mobileNextBtn = el('button', {
        class: 'playback-mobile-btn playback-mobile-btn--medium',
        title: '下一首',
        type: 'button',
    }, createMobileSvg('<polygon points="5 4 15 12 5 20"/><rect x="18" y="4" width="2" height="16"/>'));

    const mobileMoreWrap = el('div', { class: 'playback-mobile-more-wrap' });
    const mobileMoreBtn = el('button', {
        class: 'playback-mobile-btn playback-mobile-btn--small',
        title: '更多',
        type: 'button',
    }, createMobileSvg('<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>'));

    const mobileMoreMenu = el('div', { class: 'playback-mobile-more-menu' });

    const MOBILE_MORE_ITEMS = [
        {
            action: 'share',
            label: '分享',
            svg: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
            stroke: true,
        },
        {
            action: 'share-card',
            label: '生成分享图',
            svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
            stroke: true,
        },
        {
            action: 'download-audio',
            label: '下载单曲',
            svg: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
            stroke: true,
        },
        {
            action: 'download-lyric',
            label: '下载歌词',
            svg: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="14" y2="18"/>',
            stroke: true,
        },
    ];

    for (const item of MOBILE_MORE_ITEMS) {
        const btn = el('button', {
            class: 'playback-mobile-more-item',
            type: 'button',
            dataset: { action: item.action },
        }, createMobileSvg(item.svg, !item.stroke), el('span', { text: item.label }));
        mobileMoreMenu.appendChild(btn);
    }

    mobileMoreWrap.appendChild(mobileMoreBtn);
    mobileMoreWrap.appendChild(mobileMoreMenu);

    mobileControlsEl.appendChild(mobileModeBtn);
    mobileControlsEl.appendChild(mobilePrevBtn);
    mobileControlsEl.appendChild(mobilePlayBtn);
    mobileControlsEl.appendChild(mobileNextBtn);
    mobileControlsEl.appendChild(mobileMoreWrap);

    const mobileProgressBar = el('div', { class: 'playback-mobile-progress-bar' });
    const mobileProgressEl = el('div', { class: 'playback-mobile-progress' }, mobileProgressBar);

    const mobileTimeCurrent = el('span', { class: 'playback-mobile-time', text: '0:00' });
    const mobileTimeDuration = el('span', { class: 'playback-mobile-time', text: '0:00' });

    const mobileProgressRow = el('div', { class: 'playback-mobile-progress-row' },
        mobileTimeCurrent,
        mobileProgressEl,
        mobileTimeDuration
    );

    const mobileBottomEl = el('div', { class: 'playback-mobile-bottom' },
        mobileProgressRow,
        mobileControlsEl
    );

    const overlay = el('div', { class: 'playback-overlay' }, bg, glow, scrim, topBar, inner, mobileBottomEl);

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
    let glowToken = 0;

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

    function resetGlow() {
        for (const blob of glowBlobs) {
            blob.style.background = '';
            blob.style.opacity = '0';
        }
    }

    function proxiedCover(url) {
        if (!url) return '';
        if (!ctx.config || !ctx.config.proxy) return url;
        return ctx.config.proxy + encodeURIComponent(url);
    }

    function extractPalette(imgUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const size = 32;
                    const canvas = document.createElement('canvas');
                    canvas.width = size;
                    canvas.height = size;
                    const cx = canvas.getContext('2d');
                    cx.drawImage(img, 0, 0, size, size);
                    const data = cx.getImageData(0, 0, size, size).data;

                    const buckets = new Map();
                    const step = 8;
                    for (let i = 0; i < data.length; i += 4) {
                        const r = data[i];
                        const g = data[i + 1];
                        const b = data[i + 2];
                        const a = data[i + 3];
                        if (a < 128) continue;

                        const max = Math.max(r, g, b);
                        const min = Math.min(r, g, b);
                        const sat = max === 0 ? 0 : (max - min) / max;
                        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                        if (sat < 0.15) continue;
                        if (lum < 0.1 || lum > 0.92) continue;

                        const key = `${Math.round(r / step) * step},${Math.round(g / step) * step},${Math.round(b / step) * step}`;
                        const entry = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0, sat: 0 };
                        entry.r += r;
                        entry.g += g;
                        entry.b += b;
                        entry.count += 1;
                        entry.sat += sat;
                        buckets.set(key, entry);
                    }

                    const list = [];
                    for (const entry of buckets.values()) {
                        list.push({
                            r: Math.round(entry.r / entry.count),
                            g: Math.round(entry.g / entry.count),
                            b: Math.round(entry.b / entry.count),
                            count: entry.count,
                            sat: entry.sat / entry.count,
                        });
                    }
                    list.sort((a, b) => (b.count * b.sat) - (a.count * a.sat));

                    const picked = [];
                    for (const c of list) {
                        let tooClose = false;
                        for (const p of picked) {
                            const dr = c.r - p.r;
                            const dg = c.g - p.g;
                            const db = c.b - p.b;
                            if (Math.sqrt(dr * dr + dg * dg + db * db) < 60) {
                                tooClose = true;
                                break;
                            }
                        }
                        if (!tooClose) picked.push(c);
                        if (picked.length >= 3) break;
                    }

                    while (picked.length < 3) {
                        picked.push({ r: 120, g: 120, b: 120 });
                    }

                    resolve(picked);
                } catch {
                    resolve([]);
                }
            };
            img.onerror = () => resolve([]);
            img.src = proxiedCover(imgUrl);
        });
    }

    async function updateGlow(picUrl) {
        const token = ++glowToken;
        const palette = await extractPalette(picUrl);
        if (token !== glowToken) return;

        if (!palette.length) {
            resetGlow();
            return;
        }

        const positions = [
            { x: '20%', y: '25%' },
            { x: '78%', y: '35%' },
            { x: '50%', y: '80%' },
        ];

        palette.forEach((c, i) => {
            const blob = glowBlobs[i];
            if (!blob) return;
            const pos = positions[i] || positions[0];
            const color = `rgba(${c.r}, ${c.g}, ${c.b}, 0.75)`;
            blob.style.background = `radial-gradient(circle at center, ${color} 0%, rgba(${c.r}, ${c.g}, ${c.b}, 0) 70%)`;
            blob.style.left = pos.x;
            blob.style.top = pos.y;
            blob.style.opacity = '1';
        });
    }

    function renderBg(song) {
        if (song && song.pic) {
            bg.style.backgroundImage = `url("${song.pic}")`;
            updateGlow(song.pic);
        } else {
            bg.style.backgroundImage = '';
            glowToken++;
            resetGlow();
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

        requestAnimationFrame(updateSpacerHeight);
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

    function closePlayback() {
        const depth = (window.history.state && window.history.state.__depth) || 0;
        if (depth > 0) {
            window.history.back();
            return;
        }
        store.update({ playbackOpen: false });
    }

    closeBtn.addEventListener('click', closePlayback);

    lyricEl.addEventListener('wheel', onWheel, { passive: false });
    lyricEl.addEventListener('touchstart', onTouchStart, { passive: true });
    lyricEl.addEventListener('touchmove', onTouchMove, { passive: true });
    lyricEl.addEventListener('touchend', onTouchEnd, { passive: true });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && store.get().playbackOpen) {
            closePlayback();
        }
    });

    mobilePrevBtn.addEventListener('click', () => player.prev());
    mobileNextBtn.addEventListener('click', () => player.next());
    mobilePlayBtn.addEventListener('click', () => player.toggle());

    mobileModeBtn.addEventListener('click', () => {
        const mode = player.cycleMode();
        Toast(`已切换到${MOBILE_MODE_LABELS[mode]}`, 'info', 1400);
    });

    mobileProgressEl.addEventListener('click', (e) => {
        const rect = mobileProgressEl.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        player.seek(percent);
    });

    mobileMoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        mobileMoreWrap.classList.toggle('is-open');
    });

    mobileMoreMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.playback-mobile-more-item');
        if (!item) return;
        e.stopPropagation();
        mobileMoreWrap.classList.remove('is-open');

        const q = store.get().queue;
        const song = q.currentIndex >= 0 ? q.tracks[q.currentIndex] : null;
        if (!song) {
            Toast('当前没有播放歌曲', 'warning', 1600);
            return;
        }

        const action = item.dataset.action;
        if (action === 'share') {
            shareSong(song);
        } else if (action === 'share-card') {
            openShareCardModal(song);
        } else if (action === 'download-audio') {
            openDownloadOptionsModal(song, ctx, 'now');
        } else if (action === 'download-lyric') {
            handleDownloadLyric(song, ctx);
        }
    });

    document.addEventListener('click', (e) => {
        if (!mobileMoreWrap.contains(e.target)) {
            mobileMoreWrap.classList.remove('is-open');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            mobileMoreWrap.classList.remove('is-open');
        }
    });

    store.subscribe((state) => {
        const q = state.queue;

        const mode = q.playMode || 'order';
        const label = MOBILE_MODE_LABELS[mode] || '顺序播放';
        if (mobileModeBtn.title !== label) mobileModeBtn.title = label;
        const iconHtml = MOBILE_MODE_ICONS[mode] || MOBILE_MODE_ICONS.order;
        if (mobileModeSvg.innerHTML !== iconHtml) mobileModeSvg.innerHTML = iconHtml;

        const total = q.duration || 0;
        const cur = q.currentTime || 0;
        const pct = total > 0 ? `${(cur / total) * 100}%` : '0%';
        if (mobileProgressBar.style.width !== pct) mobileProgressBar.style.width = pct;

        const curText = formatMobileTime(cur);
        const durText = formatMobileTime(total);
        if (mobileTimeCurrent.textContent !== curText) mobileTimeCurrent.textContent = curText;
        if (mobileTimeDuration.textContent !== durText) mobileTimeDuration.textContent = durText;

        if (q.isPlaying) {
            const html = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
            if (mobilePlaySvg.innerHTML !== html) mobilePlaySvg.innerHTML = html;
            if (mobilePlayBtn.title !== '暂停') mobilePlayBtn.title = '暂停';
        } else {
            const html = '<polygon points="6 4 20 12 6 20"/>';
            if (mobilePlaySvg.innerHTML !== html) mobilePlaySvg.innerHTML = html;
            if (mobilePlayBtn.title !== '播放') mobilePlayBtn.title = '播放';
        }
    });

    player.on('timeupdate', handleTimeUpdate);
    player.on('trackchange', (song) => handleSongChange(song));

    let lastSongKey = '';
    let wasPlaybackOpen = !!store.get().playbackOpen;
    let closeTimer = null;

    store.subscribe((state) => {
        const q = state.queue;
        const song = q.currentIndex >= 0 ? q.tracks[q.currentIndex] : null;

        const isOpen = !!state.playbackOpen;
        document.body.classList.toggle('playback-open', isOpen);

        if (isOpen) {
            if (closeTimer) {
                clearTimeout(closeTimer);
                closeTimer = null;
            }
            document.body.classList.remove('playback-closing');
        } else if (wasPlaybackOpen) {
            if (closeTimer) clearTimeout(closeTimer);
            document.body.classList.add('playback-closing');
            closeTimer = setTimeout(() => {
                document.body.classList.remove('playback-closing');
                closeTimer = null;
            }, 420);
        }
        wasPlaybackOpen = isOpen;

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

    window.addEventListener('resize', updateSpacerHeight);

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
            if (followTimer) clearTimeout(followTimer);
            if (closeTimer) clearTimeout(closeTimer);
            window.removeEventListener('resize', updateSpacerHeight);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        },
    };
}