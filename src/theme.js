export const THEME_MODES = [
    { id: 'auto', label: '跟随系统' },
    { id: 'light', label: '日间' },
    { id: 'dark', label: '夜间' },
];

export const THEME_VAR_NAMES = [
    '--bg-top', '--bg-side', '--bg-player', '--bg-input', '--bg-menu', '--bg-float',
    '--bg-overlay', '--bg-surface', '--bg-surface-hover', '--bg-subtle', '--bg-cover', '--bg-wipe',
    '--text-primary', '--text-secondary', '--text-tertiary',
    '--border', '--border-strong', '--border-faint', '--fill-light',
    '--hover-bg', '--progress-track', '--progress-track-hover',
    '--range-track', '--overlay-cover', '--overlay-detail',
    '--fill', '--border-line', '--hover-text',
    '--scrollbar-thumb', '--scrollbar-thumb-hover', '--scrim',
    '--waveform', '--success', '--warning', '--danger', '--info',
    '--tree-bg-2', '--tree-bg-3',
];

const DARK_QUERY = '(prefers-color-scheme: dark)';

let darkQuery = null;

function getDarkQuery() {
    if (darkQuery !== null) return darkQuery;
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    darkQuery = window.matchMedia(DARK_QUERY);
    return darkQuery;
}

export function prefersDark() {
    const q = getDarkQuery();
    return q ? q.matches : false;
}

export function onSystemThemeChange(handler) {
    const q = getDarkQuery();
    if (!q) return;
    if (typeof q.addEventListener === 'function') {
        q.addEventListener('change', handler);
    } else if (typeof q.addListener === 'function') {
        q.addListener(handler);
    }
}

/** 'auto' follows the OS; 'light' and 'dark' are pinned. */
export function resolveMode(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    return prefersDark() ? 'dark' : 'light';
}

export function hexToRgb(hex) {
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6) return { r: 0, g: 0, b: 0 };
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function hexToHsl(hex) {
    const { r, g, b } = hexToRgb(hex);
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        else if (max === gn) h = ((bn - rn) / d + 2) / 6;
        else h = ((rn - gn) / d + 4) / 6;
    }
    return { h: h * 360, s, l };
}

function hsl(h, s, l) {
    return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l)}%)`;
}

function hsla(h, s, l, a) {
    return `hsla(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l)}%, ${a})`;
}

export function generateThemeVars(themeHex, mode = 'auto') {
    const { h, s, l } = hexToHsl(themeHex);
    const resolved = resolveMode(mode);
    const isLight = resolved === 'light';

    // Lifts dark accents so they stay visible against dark surfaces, while
    // keeping enough contrast for the white text drawn on top of them.
    let accentHex = themeHex;
    if (!isLight && l < 0.5) {
        accentHex = hsl(h, s, 40);
    }

    const sBg = Math.min(0.42, Math.max(0.04, s * 0.55));
    const sText = Math.min(0.55, Math.max(0.06, s * 0.65));

    const hoverTextL = isLight ? 20 : 80;

    const accent = {
        '--fill': accentHex,
        '--border-line': accentHex,
        '--hover-text': isLight ? accentHex : hsl(h, s, 88),
    };

    if (isLight) {
        return {
            ...accent,
            '--bg-top': hsla(h, sBg, 90, 0.92),
            '--bg-side': hsla(h, sBg, 85, 0.94),
            '--bg-player': hsla(h, sBg, 90, 0.92),
            '--bg-input': hsla(h, sBg * 0.8, 99, 0.75),
            '--bg-menu': hsl(h, sBg, 99),
            '--bg-float': hsl(h, sBg, 97),
            '--bg-overlay': hsla(h, sBg, 97, 0.9),
            '--bg-surface': hsl(h, sBg, 99),
            '--bg-surface-hover': hsl(h, sBg, 100),
            '--bg-subtle': hsla(h, sBg, 0, 0.03),
            '--bg-cover': hsl(h, sBg, 88),
            '--bg-wipe': hsl(h, sBg, 92),
            '--text-primary': hsl(h, sText * 0.55, 13),
            '--text-secondary': hsl(h, sText * 0.5, 40),
            '--text-tertiary': hsl(h, sText * 0.45, 52),
            '--border': hsl(h, sBg, 86),
            '--border-strong': hsl(h, sBg * 0.8, 55),
            '--border-faint': hsla(h, sBg, 0, 0.07),
            '--fill-light': hsl(h, sBg, 87),
            '--hover-bg': hsla(h, sBg, 0, 0.08),
            '--progress-track': hsla(h, sBg, 0, 0.1),
            '--progress-track-hover': hsla(h, sBg, 0, 0.16),
            '--range-track': hsla(h, sBg, 0, 0.14),
            '--overlay-cover': hsla(h, sBg, 0, 0.5),
            '--overlay-detail': hsla(h, sBg, 94, 0.75),
            '--scrollbar-thumb': hsl(h, 0, 83),
            '--scrollbar-thumb-hover': hsl(h, 0, 72),
            '--scrim': hsla(0, 0, 0, 0.45),
            '--waveform': '#000000',
            '--success': '#10b981',
            '--warning': '#f59e0b',
            '--danger': '#ef4444',
            '--info': '#3b82f6',
            '--tree-bg-2': hsla(h, sBg, 0, 0.025),
            '--tree-bg-3': hsla(h, sBg, 0, 0.05),
        };
    }

    return {
        ...accent,
        '--bg-top': hsla(h, sBg, 9, 0.94),
        '--bg-side': hsla(h, sBg, 3, 0.96),
        '--bg-player': hsla(h, sBg, 9, 0.94),
        '--bg-input': hsla(h, sBg, 22, 0.7),
        '--bg-menu': hsl(h, sBg, 10),
        '--bg-float': hsl(h, sBg, 18),
        '--bg-overlay': hsla(h, sBg, 13, 0.92),
        '--bg-surface': hsl(h, sBg, 15),
        '--bg-surface-hover': hsl(h, sBg, 19),
        '--bg-subtle': hsla(h, sBg, 100, 0.04),
        '--bg-cover': hsl(h, sBg, 22),
        '--bg-wipe': hsl(h, sBg, 14),
        '--text-primary': hsl(h, sText * 0.3, 96),
        '--text-secondary': hsl(h, sText * 0.5, 78),
        '--text-tertiary': hsl(h, sText * 0.6, 60),
        '--border': hsl(h, sBg, 25),
        '--border-strong': hsl(h, sBg * 0.9, 48),
        '--border-faint': hsla(h, sBg, 100, 0.08),
        '--fill-light': hsl(h, sBg, 22),
        '--hover-bg': hsla(h, sBg, 100, 0.09),
        '--progress-track': hsla(h, sBg, 100, 0.14),
        '--progress-track-hover': hsla(h, sBg, 100, 0.2),
        '--range-track': hsla(h, sBg, 100, 0.18),
        '--overlay-cover': hsla(h, sBg, 0, 0.6),
        '--overlay-detail': hsla(h, sBg, 8, 0.8),
        '--scrollbar-thumb': hsl(h, 0, 26),
        '--scrollbar-thumb-hover': hsl(h, 0, 36),
        '--scrim': hsla(h, sBg, 0, 0.6),
        '--waveform': hsl(h, sBg, 92),
        '--success': hsl(158, 0.64, 45),
        '--warning': hsl(38, 0.92, 55),
        '--danger': hsl(0, 0.84, 63),
        '--info': hsl(214, 0.9, 66),
        '--tree-bg-2': hsla(h, sBg, 100, 0.03),
        '--tree-bg-3': hsla(h, sBg, 100, 0.06),
    };
}

export function applyThemeVars(vars) {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) {
        root.style.setProperty(k, v);
    }
}

const PAGE_BG = { light: '#f0f0f0', dark: '#171717' };

export function applyColorScheme(mode) {
    const resolved = resolveMode(mode);
    const root = document.documentElement;
    root.style.setProperty('color-scheme', resolved);
    root.style.setProperty('--bg-page', PAGE_BG[resolved]);
}

export function clearThemeVars() {
    const root = document.documentElement;
    for (const name of THEME_VAR_NAMES) {
        root.style.removeProperty(name);
    }
    applyColorScheme('light');
}