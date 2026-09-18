export const THEME_VAR_NAMES = [
    '--bg-top', '--bg-side', '--bg-player', '--bg-input', '--bg-menu', '--bg-float',
    '--bg-overlay', '--bg-surface', '--bg-surface-hover', '--bg-subtle', '--bg-cover', '--bg-wipe',
    '--text-primary', '--text-secondary', '--text-tertiary',
    '--border', '--border-strong', '--border-faint', '--fill-light',
    '--hover-bg', '--progress-track', '--progress-track-hover',
    '--range-track', '--overlay-cover', '--overlay-detail',
    '--fill', '--border-line', '--hover-text',
];

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

export function generateThemeVars(themeHex) {
    const { h, s, l } = hexToHsl(themeHex);
    const isLight = l >= 0.5;

    const sBg = Math.min(0.42, Math.max(0.04, s * 0.55));
    const sText = Math.min(0.55, Math.max(0.06, s * 0.65));
    const sAccent = Math.min(0.75, Math.max(0.12, s * 0.85));

    const fillL = isLight ? 25 : 42;
    const hoverTextL = isLight ? 20 : 80;

    const accent = {
        '--fill': hsl(h, sAccent, fillL),
        '--border-line': hsl(h, sAccent, fillL),
        '--hover-text': hsl(h, sAccent, hoverTextL),
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
    };
}

export function applyThemeVars(vars) {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) {
        root.style.setProperty(k, v);
    }
}

export function clearThemeVars() {
    const root = document.documentElement;
    for (const name of THEME_VAR_NAMES) {
        root.style.removeProperty(name);
    }
}