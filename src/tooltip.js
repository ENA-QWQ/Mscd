const GAP = 4;
const EDGE = 8;
const SHOW_DELAY = 320;
const SMOOTH_WINDOW = 220;

let tipEl = null;
let activeEl = null;
let showTimer = 0;
let hideTimer = 0;
let observer = null;
let themeObserver = null;

function ensureTip() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.className = 'app-tooltip';
    tipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tipEl);
    return tipEl;
}

function migrate(el) {
    if (!el || el.nodeType !== 1) return;
    const text = el.getAttribute('title');
    if (text === null) return;
    if (text === '') {
        el.removeAttribute('title');
        return;
    }
    el.removeAttribute('title');
    el.setAttribute('data-app-tooltip', text);
}

function migrateTree(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.hasAttribute && root.hasAttribute('title')) migrate(root);
    if (root.querySelectorAll) {
        const nodes = root.querySelectorAll('[title]');
        for (const el of nodes) migrate(el);
    }
}

function startObserver() {
    if (observer) return;
    observer = new MutationObserver((muts) => {
        for (const m of muts) {
            if (m.type === 'attributes') {
                migrate(m.target);
                continue;
            }
            for (const node of m.addedNodes) {
                migrateTree(node);
            }
        }
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['title'],
    });
}

function syncThemeAttr() {
    if (!document.body) return;
    const scheme = (getComputedStyle(document.documentElement).colorScheme || '').toLowerCase();
    const theme = scheme.includes('dark') ? 'dark' : 'light';
    if (document.body.dataset.theme !== theme) {
        document.body.dataset.theme = theme;
    }
}

function startThemeObserver() {
    if (themeObserver) return;
    themeObserver = new MutationObserver(syncThemeAttr);
    themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['style'],
    });
    syncThemeAttr();
}

function getText(el) {
    return el.getAttribute('data-app-tooltip') || '';
}

function computePos(rect, w, h) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let placement = 'top';
    let top = rect.top - h - GAP;
    if (top < EDGE) {
        const below = rect.bottom + GAP;
        if (below + h <= vh - EDGE) {
            top = below;
            placement = 'bottom';
        } else {
            top = Math.max(EDGE, Math.min(rect.top, vh - h - EDGE));
        }
    }
    let left = rect.left + rect.width / 2 - w / 2;
    if (left < EDGE) left = EDGE;
    if (left + w > vw - EDGE) left = vw - w - EDGE;
    return { left, top, placement };
}

function place(el) {
    const tip = ensureTip();
    const box = tip.getBoundingClientRect();
    const pos = computePos(el.getBoundingClientRect(), box.width, box.height);
    tip.style.left = `${Math.round(pos.left)}px`;
    tip.style.top = `${Math.round(pos.top)}px`;
    tip.dataset.placement = pos.placement;
}

function isTipVisible() {
    return !!(tipEl && tipEl.classList.contains('is-visible'));
}

function show(el, text) {
    const tip = ensureTip();
    tip.textContent = text;

    tip.style.transition = 'none';
    tip.style.transform = '';
    tip.classList.remove('is-visible');
    tip.dataset.placement = 'top';
    tip.style.left = '-9999px';
    tip.style.top = '0px';

    void tip.offsetWidth;

    tip.style.transition = '';

    place(el);

    requestAnimationFrame(() => {
        if (activeEl !== el) return;
        tip.classList.add('is-visible');
    });
}

function smoothTo(el, text) {
    const tip = ensureTip();

    const first = tip.getBoundingClientRect();

    tip.style.transition = 'none';
    tip.style.transform = '';

    tip.textContent = text;
    place(el);

    const last = tip.getBoundingClientRect();

    const dx = first.left - last.left;
    const dy = first.top - last.top;
    const sx = last.width > 0 ? first.width / last.width : 1;
    const sy = last.height > 0 ? first.height / last.height : 1;

    tip.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;

    void tip.offsetWidth;

    tip.style.transition = '';
    tip.style.transform = '';
}

function cancelShow() {
    if (showTimer) {
        clearTimeout(showTimer);
        showTimer = 0;
    }
}

function cancelHide() {
    if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = 0;
    }
}

function scheduleHide() {
    cancelHide();
    hideTimer = setTimeout(() => {
        hideTimer = 0;
        activeEl = null;
        if (tipEl) tipEl.classList.remove('is-visible');
    }, SMOOTH_WINDOW);
}

function forceHide() {
    cancelShow();
    cancelHide();
    activeEl = null;
    if (tipEl) tipEl.classList.remove('is-visible');
}

function findTarget(node) {
    if (!(node instanceof Element)) return null;
    const el = node.closest('[data-app-tooltip]');
    if (el && getText(el)) return el;
    if (activeEl && activeEl.contains(node)) return activeEl;
    return null;
}

function onOver(e) {
    const el = findTarget(e.target);
    if (!el) return;

    if (el === activeEl) {
        cancelHide();
        return;
    }

    cancelShow();
    cancelHide();

    const text = getText(el);
    if (!text) {
        activeEl = null;
        if (tipEl) tipEl.classList.remove('is-visible');
        return;
    }

    activeEl = el;

    if (isTipVisible()) {
        smoothTo(el, text);
        return;
    }

    showTimer = setTimeout(() => {
        showTimer = 0;
        if (activeEl !== el) return;
        if (!document.contains(el)) return;
        show(el, text);
    }, SHOW_DELAY);
}

function onOut(e) {
    if (!activeEl) return;
    const to = e.relatedTarget;
    if (to instanceof Node && activeEl.contains(to)) return;
    const from = e.target;
    if (from instanceof Node && (from === activeEl || activeEl.contains(from))) {
        if (isTipVisible()) scheduleHide();
        else forceHide();
    }
}

function onDocClick() { forceHide(); }
function onKey(e) { if (e.key === 'Escape') forceHide(); }
function onScroll() { forceHide(); }
function onResize() { forceHide(); }
function onBlur() { forceHide(); }

let inited = false;

export function initTooltip() {
    if (inited || typeof window === 'undefined') return;
    inited = true;

    migrateTree(document.body);
    startObserver();
    startThemeObserver();

    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('mousedown', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onBlur);
}