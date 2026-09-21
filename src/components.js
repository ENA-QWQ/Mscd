import { el } from './dom.js';

const ICON_PATHS = {
    play: '<polygon points="6 4 20 12 6 20"/>',
    'play-next': '<polygon points="5 4 15 12 5 20"/><line x1="19" y1="5" x2="19" y2="19"/>',
    queue: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
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
};

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

export function closeAllMenus() {
    document.querySelectorAll('.song-menu.is-open').forEach((m) => {
        m.classList.remove('is-open');
        const row = m.closest('.song-row');
        if (row) row.classList.remove('has-menu-open');
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

export function SongRow(song, handlers = {}) {
    const {
        onPlay, onPlayNext, onAddDownloadList, onDownloadNow, onDownloadLyric, onRemove, onEdit,
        selectable, selected, onToggleSelect,
        hidePlayNextMenu,
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
    if (onDownloadLyric) {
        actionsEl.appendChild(makeActionButton('lyric', '下载歌词', false, () => onDownloadLyric(song)));
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
    if (song.id) {
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

    const row = el('div', { class: 'song-row', dataset: { id: song.id } });

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

        row.appendChild(checkbox);

        if (selected) row.classList.add('is-selected');
    }

    row.appendChild(bars);
    row.appendChild(coverEl);
    row.appendChild(
        el('div', { class: 'song-info' },
            el('div', { class: 'song-title-row' },
                el('span', { class: 'song-title', text: song.title || '未知歌曲' }),
                song.album
                    ? el('span', { class: 'song-album', text: `- ${song.album}` })
                    : null
            ),
            el('div', { class: 'song-artist', text: song.artist || '未知歌手' })
        )
    );
    row.appendChild(actionsEl);
    row.appendChild(menuWrap);

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
    const { onOpen } = handlers;

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
    const artist = item.artist || (isPlaylist ? '未知创建者' : '未知歌手');

    const infoChildren = [
        el('div', { class: 'collection-card__title', text: item.title || '未知' }),
    ];

    if (isPlaylist && desc) {
        infoChildren.push(el('div', { class: 'collection-card__desc', text: desc }));
    }

    infoChildren.push(el('div', { class: 'collection-card__artist', text: artist }));

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

let sharedAccountMenu = null;

if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
        if (sharedAccountMenu && !sharedAccountMenu.contains(e.target)) {
            sharedAccountMenu.classList.remove('is-open');
        }
    });
}

export function AccountButton({ account, onConnect, onDisconnect }) {
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

export function openModal({ title, body, confirmText = '确认', cancelText = '取消', showCancel = true, onConfirm, onCancel }) {
    const root = document.getElementById('modal-root');
    if (!root) return null;

    const closeBtn = el('button', { class: 'ena-modal__close', 'aria-label': '关闭' }, icon('close'));
    const cancelBtn = el('button', { class: 'ena-btn', text: cancelText });
    const confirmBtn = el('button', { class: 'ena-btn ena-btn--primary', text: confirmText });

    const footerChildren = [];
    if (showCancel) footerChildren.push(cancelBtn);
    footerChildren.push(confirmBtn);

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

    return { close: () => close('cancel'), confirmBtn, cancelBtn, titleEl, headerEl, panelEl: panel, modalEl: modal };
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
    window.addEventListener('scroll', () => closeAllDropdowns(), true);
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
        const mw = menuEl.offsetWidth;
        let left = rect.left;
        if (left + mw > window.innerWidth - 8) {
            left = Math.max(8, window.innerWidth - mw - 8);
        }
        menuEl.style.top = `${rect.bottom + 4}px`;
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