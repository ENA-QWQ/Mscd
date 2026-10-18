import { Toast } from './components.js';

const STORAGE_KEY = 'meting-app-state';

function hexToRgb(hex) {
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6) return { r: 0, g: 0, b: 0 };
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return { h: h * 360, s, l };
}

function hslCss(h, s, l, a) {
    if (a != null) {
        return 'hsla(' + Math.round(h) + ', ' + Math.round(s * 100) + '%, ' + Math.round(l) + '%, ' + a + ')';
    }
    return 'hsl(' + Math.round(h) + ', ' + Math.round(s * 100) + '%, ' + Math.round(l) + '%)';
}

function pickOnColor(hex) {
    const { r, g, b } = hexToRgb(hex);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? '#1f2937' : '#ffffff';
}

function generateAccentVars(hex, mode) {
    const rgb = hexToRgb(hex);
    if (!rgb.r && !rgb.g && !rgb.b) return null;
    const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const isLight = mode !== 'dark';
    const accent = isLight || l < 0.5 ? hex : hslCss(h, Math.max(s, 0.4), 70);
    return {
        '--fill': accent,
        '--border-line': accent,
        '--hover-text': isLight ? accent : hslCss(h, Math.min(s, 0.5), 85),
        '--on-accent': pickOnColor(accent),
        '--selection-box-bg': hslCss(h, s, l, 0.15),
    };
}

export class ThemeManager {
    constructor({ store, config }) {
        this.store = store;
        this.config = config;
        this.manifest = null;
        this.currentThemeId = '';
        this.currentMode = 'light';
        this.pendingToken = 0;
        this.ready = false;
        this.listeners = new Set();
    }

    subscribe(fn) {
        this.listeners.add(fn);
        try { fn(this.getState()); } catch (e) { console.error('[theme]', e); }
        return () => this.listeners.delete(fn);
    }

    emit() {
        const state = this.getState();
        for (const fn of this.listeners) {
            try { fn(state); } catch (e) { console.error('[theme]', e); }
        }
    }

    getState() {
        return {
            manifest: this.manifest,
            currentThemeId: this.currentThemeId,
            currentMode: this.currentMode,
            ready: this.ready,
        };
    }

    async init() {
        try {
            await this.loadManifest();
        } catch (e) {
            console.warn('[theme] manifest load failed:', e);
            Toast('主题清单加载失败，已使用默认样式', 'warning', 2400);
        }
        this.syncFromStore();
        this.bindSystemMode();
        this.bindStorageSync();
        this.bindStore();
        document.documentElement.style.removeProperty('--bg-page');
        this.ready = true;
        this.emit();
    }

    async loadManifest() {
        const url = (this.config.ui && this.config.ui.themeManifest) || 'themes/index.json';
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        this.manifest = await res.json();
        if (!this.manifest || !Array.isArray(this.manifest.themes)) {
            throw new Error('manifest format invalid');
        }
    }

    getThemeMeta(id) {
        if (!this.manifest) return null;
        return this.manifest.themes.find((t) => t.id === id) || null;
    }

    resolveThemeId(id) {
        const themes = (this.manifest && this.manifest.themes) || [];
        if (id && themes.some((t) => t.id === id)) return id;
        if (this.manifest && this.manifest.default && themes.some((t) => t.id === this.manifest.default)) {
            return this.manifest.default;
        }
        return themes[0] ? themes[0].id : '';
    }

    resolveMode(mode) {
        if (mode === 'light' || mode === 'dark') return mode;
        if (typeof window !== 'undefined' && window.matchMedia &&
            window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    }

    syncFromStore() {
        const s = this.store.get().settings;
        const wanted = s.themeId || (this.config.ui && this.config.ui.defaultTheme) || '';
        const resolved = this.resolveThemeId(wanted);
        const resolvedMode = this.resolveMode(s.themeMode || 'auto');
        this.currentMode = resolvedMode;

        const domTheme = document.documentElement.getAttribute('data-theme') || '';
        if (domTheme && domTheme === resolved) {
            this.currentThemeId = domTheme;
            this.applyDom('', '', resolvedMode);
        } else if (resolved) {
            this.activate(resolved, { silent: true });
        }
        this.applyAccent(s.themeColor);
    }

    bindStore() {
        let lastKey = '';
        this.store.subscribe((state) => {
            const s = state.settings;
            const key = [s.themeId, s.themeMode, s.themeColor].join('|');
            if (key === lastKey) return;
            lastKey = key;
            const id = this.resolveThemeId(s.themeId);
            if (id && id !== this.currentThemeId) {
                this.activate(id, { silent: false });
            }
            const mode = this.resolveMode(s.themeMode || 'auto');
            if (mode !== this.currentMode) {
                this.currentMode = mode;
                this.applyDom('', '', mode);
                this.emit();
            }
            this.applyAccent(s.themeColor);
        });
    }

    bindSystemMode() {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => {
            const themeMode = this.store.get().settings.themeMode || 'auto';
            if (themeMode !== 'auto') return;
            const mode = this.resolveMode('auto');
            if (mode === this.currentMode) return;
            this.currentMode = mode;
            this.applyDom('', '', mode);
            this.applyAccent(this.store.get().settings.themeColor);
            this.emit();
        };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
    }

    bindStorageSync() {
        if (typeof window === 'undefined') return;
        window.addEventListener('storage', (e) => {
            if (e.key !== STORAGE_KEY || !e.newValue) return;
            try {
                const saved = JSON.parse(e.newValue);
                if (!saved || !saved.settings) return;
                const cur = this.store.get().settings;
                const next = { ...cur };
                if (typeof saved.settings.themeId === 'string') next.themeId = saved.settings.themeId;
                if (typeof saved.settings.themeMode === 'string') next.themeMode = saved.settings.themeMode;
                if (typeof saved.settings.themeColor === 'string') next.themeColor = saved.settings.themeColor;
                this.store.update({ settings: next });
            } catch {}
        });
    }

    async switchTheme(id) {
        const meta = this.getThemeMeta(id);
        if (!meta) {
            Toast('主题不存在：' + id, 'warning', 2000);
            return false;
        }
        const settings = this.store.get().settings;
        const mode = this.resolveMode(settings.themeMode || 'auto');
        const supported = Array.isArray(meta.modes) && meta.modes.length ? meta.modes : ['light', 'dark'];
        let nextThemeMode = settings.themeMode || 'auto';
        if (!supported.includes(mode)) {
            nextThemeMode = supported[0];
        }
        const ok = await this.activate(id, { silent: false });
        if (!ok) return false;
        this.store.update({ settings: { ...settings, themeId: id, themeMode: nextThemeMode } });
        this.store.persist();
        if (nextThemeMode !== settings.themeMode) {
            const resolved = this.resolveMode(nextThemeMode);
            this.currentMode = resolved;
            this.applyDom('', '', resolved);
        }
        this.applyAccent(settings.themeColor);
        return true;
    }

    async activate(id, opts = {}) {
        const meta = this.getThemeMeta(id);
        if (!meta) return false;
        if (id === this.currentThemeId) {
            if (opts.silent) return true;
        }
        const token = ++this.pendingToken;
        const href = 'themes/' + meta.css;
        return new Promise((resolve) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;

            const finish = (ok) => {
                if (this.pendingToken !== token) {
                    if (link.parentNode) link.parentNode.removeChild(link);
                    resolve(false);
                    return;
                }
                if (ok) {
                    const old = document.getElementById('theme-stylesheet');
                    if (old && old !== link && old.parentNode) old.parentNode.removeChild(old);
                    link.id = 'theme-stylesheet';
                    this.currentThemeId = id;
                    this.applyDom(id, '', this.currentMode);
                    this.applyAccent(this.store.get().settings.themeColor);
                    this.emit();
                    resolve(true);
                } else {
                    if (link.parentNode) link.parentNode.removeChild(link);
                    Toast('主题样式加载失败，已保留当前主题', 'danger', 2600);
                    resolve(false);
                }
            };

            link.onload = () => finish(true);
            link.onerror = () => finish(false);
            document.head.appendChild(link);
        });
    }

    applyDom(themeId, _mode, resolvedMode) {
        const root = document.documentElement;
        if (themeId) root.setAttribute('data-theme', themeId);
        if (resolvedMode) {
            root.setAttribute('data-mode', resolvedMode);
            root.style.setProperty('color-scheme', resolvedMode);
        }
        root.style.removeProperty('--bg-page');
    }

    setMode(mode) {
        if (mode !== 'light' && mode !== 'dark' && mode !== 'auto') return;
        const settings = { ...this.store.get().settings, themeMode: mode };
        this.store.update({ settings });
        this.store.persist();
        const meta = this.getThemeMeta(this.currentThemeId);
        const supported = meta && Array.isArray(meta.modes) && meta.modes.length ? meta.modes : ['light', 'dark'];
        const want = this.resolveMode(mode);
        const final = supported.includes(want) ? want : supported[0];
        this.currentMode = final;
        this.applyDom('', '', final);
        this.applyAccent(settings.themeColor);
        this.emit();
    }

    setAccent(color) {
        const settings = { ...this.store.get().settings, themeColor: color || '' };
        this.store.update({ settings });
        this.store.persist();
        this.applyAccent(color);
    }

    applyAccent(color) {
        const themeId = document.documentElement.getAttribute('data-theme') || '';
        const meta = this.getThemeMeta(themeId);
        let el = document.getElementById('user-accent');
        if (!el) {
            el = document.createElement('style');
            el.id = 'user-accent';
        }
        const themeLink = document.getElementById('theme-stylesheet');
        if (themeLink && themeLink.parentNode) {
            themeLink.parentNode.insertBefore(el, themeLink.nextSibling);
        } else if (!el.parentNode) {
            document.head.appendChild(el);
        }
        const derivable = !meta || !meta.accent || meta.accent.derivable !== false;
        if (!color || !derivable) {
            el.textContent = '';
            return;
        }
        const lightVars = generateAccentVars(color, 'light');
        const darkVars = generateAccentVars(color, 'dark');
        if (!lightVars && !darkVars) {
            el.textContent = '';
            return;
        }
        const prefix = themeId ? ':root[data-theme="' + themeId + '"]' : ':root';
        let css = '';
        if (lightVars) {
            css += prefix + '[data-mode="light"] {\n';
            for (const k in lightVars) css += '  ' + k + ': ' + lightVars[k] + ';\n';
            css += '}\n';
        }
        if (darkVars) {
            css += prefix + '[data-mode="dark"] {\n';
            for (const k in darkVars) css += '  ' + k + ': ' + darkVars[k] + ';\n';
            css += '}\n';
        }
        el.textContent = css;
    }
}
