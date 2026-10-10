import { config } from '../config.js';
import {
    generateThemeVars,
    applyThemeVars,
    clearThemeVars,
    applyColorScheme,
    resolveMode,
    onSystemThemeChange,
} from './theme.js';

const STORAGE_KEY = 'meting-app-state';

function createInitialState() {
    return {
        view: 'search',

        sidebarExpanded: {
            myfavorites: false,
            downloads: false,
            status: false,
            queue: false,
        },

        favoritesTab: 'liked',

        account: {
            uid: '',
            nickname: '',
            avatarUrl: '',
            signature: '',
            playlistCount: 0,
            followeds: 0,
            follows: 0,
            connected: false,
        },

        search: {
            keyword: '',
            type: '1',
            page: 1,
            total: 0,
            results: [],
            selected: new Set(),
            loading: false,
            error: null,
            detail: null,
        },

        queue: {
            tracks: [],
            currentIndex: -1,
            playMode: 'order',
            isPlaying: false,
            currentTime: 0,
            duration: 0,
            volume: 0.7,
            isLoading: false,
            error: null,
        },

        queuePage: 1,
        queueSearch: '',

        downloads: [],
        downloadsPage: 1,
        downloadsSearch: '',

        selection: [],
        multiSelectMode: false,

        visibleTracks: [],
        allTracks: [],
        filteredTracks: [],

        playbackOpen: false,

        wikiMap: new Map(),
        wikiOptions: { genre: [], language: [], bizTags: [] },
        wikiProgress: { active: false, done: 0, total: 0 },

        downloadTasks: [],

        filter: {
            search: null,
            queue: null,
            downloads: null,
            liked: null,
        },

        downloadProgress: {
            active: false,
            done: 0,
            total: 0,
            bytes: 0,
            current: '',
            errors: [],
        },

        settings: {
            quality: config.quality.default,
            downloadQuality: config.quality.download,
            concurrency: config.download.concurrency,
            retry: config.download.retry,
            perPage: config.ui.perPage,
            withLyric: false,
            playProxy: false,
            downloadProxy: false,
            downloadMode: 'blob',
            downloadDirName: '',
            downloadThreads: 8,
            themeColor: '',
            themeMode: 'auto',
            namingFormat: '{title} - {artist}',
            batchCategory: 'none',
            lyricSaveMode: 'same',
            songView: 'tile',
        },
    };
}

function migrateThemeColor(color) {
    const oldDefaults = ['#2d8cf0', '#4a90e2', '#3b82f6'];
    if (!color) return '';
    if (oldDefaults.includes(String(color).toLowerCase())) return '';
    return color;
}

function loadPersisted(state) {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return state;

        const saved = JSON.parse(raw);

        if (Array.isArray(saved.downloads)) {
            state.downloads = saved.downloads;
        }

        if (saved.filter && typeof saved.filter === 'object') {
            const f = saved.filter;
            state.filter = {
                search: f.search || null,
                queue: f.queue || null,
                downloads: f.downloads || null,
                liked: f.liked || null,
            };
            for (const [key, value] of Object.entries(f)) {
                if (key.startsWith('playlist:') && value) {
                    state.filter[key] = value;
                }
            }
        }

        if (saved.settings && typeof saved.settings === 'object') {
            const s = { ...saved.settings };
            if (s.previewQuality !== undefined) {
                if (s.downloadQuality === undefined) s.downloadQuality = s.previewQuality;
                delete s.previewQuality;
            }
            delete s.accentColor;
            if (s.themeColor !== undefined) s.themeColor = migrateThemeColor(s.themeColor);
            Object.assign(state.settings, s);
        }

        if (saved.account && typeof saved.account === 'object' && saved.account.uid) {
            state.account = {
                uid: saved.account.uid || '',
                nickname: saved.account.nickname || '',
                avatarUrl: saved.account.avatarUrl || '',
                signature: saved.account.signature || '',
                playlistCount: saved.account.playlistCount || 0,
                followeds: saved.account.followeds || 0,
                follows: saved.account.follows || 0,
                connected: true,
            };
        }

        if (saved.sidebarExpanded && typeof saved.sidebarExpanded === 'object') {
            state.sidebarExpanded = {
                myfavorites: !!saved.sidebarExpanded.myfavorites,
                downloads: !!saved.sidebarExpanded.downloads,
                status: !!saved.sidebarExpanded.status,
                queue: !!saved.sidebarExpanded.queue,
            };
        }

        if (typeof saved.favoritesTab === 'string') {
            state.favoritesTab = saved.favoritesTab;
        }

        if (saved.queue && typeof saved.queue === 'object') {
            state.queue = {
                ...state.queue,
                tracks: Array.isArray(saved.queue.tracks) ? saved.queue.tracks : [],
                currentIndex: Number.isInteger(saved.queue.currentIndex) ? saved.queue.currentIndex : -1,
                playMode: saved.queue.playMode || 'order',
                volume: typeof saved.queue.volume === 'number' ? saved.queue.volume : 0.7,
                currentTime: typeof saved.queue.currentTime === 'number' ? saved.queue.currentTime : 0,
                duration: typeof saved.queue.duration === 'number' ? saved.queue.duration : 0,
                isPlaying: false,
                isLoading: false,
                error: null,
            };
            if (state.queue.currentIndex >= state.queue.tracks.length) {
                state.queue.currentIndex = -1;
            }
        }

        if (Array.isArray(saved.downloadTasks)) {
            state.downloadTasks = saved.downloadTasks.map((task) => {
                const tracks = Array.isArray(task.tracks)
                    ? task.tracks.map((track) => {
                        if (
                            track.status === 'done' ||
                            track.status === 'error' ||
                            track.status === 'cancelled' ||
                            track.status === 'skipped' ||
                            track.status === 'removed'
                        ) {
                            return track;
                        }
                        return {
                            ...track,
                            status: 'cancelled',
                            speed: 0,
                            eta: 0,
                            finishedAt: Date.now(),
                        };
                    })
                    : [];

                if (task.status === 'active') {
                    return {
                        ...task,
                        status: 'cancelled',
                        phase: 'error',
                        tracks,
                        finishedAt: Date.now(),
                    };
                }

                return { ...task, tracks };
            });

            if (state.downloadTasks.length > 100) {
                state.downloadTasks = state.downloadTasks.slice(-100);
            }
        }
    } catch {
    }

    return state;
}

class Store {
    constructor() {
        this.state = loadPersisted(createInitialState());
        this.listeners = new Set();

        onSystemThemeChange(() => {
            if ((this.state.settings.themeMode || 'auto') !== 'auto') return;
            this.applyTheme();
            this.notify();
        });
    }

    get() {
        return this.state;
    }

    subscribe(fn) {
        this.listeners.add(fn);
        fn(this.state);
        return () => this.listeners.delete(fn);
    }

    notify() {
        for (const fn of this.listeners) {
            try {
                fn(this.state);
            } catch (err) {
                console.error('[store] listener error:', err);
            }
        }
    }

    update(patch) {
        if (typeof patch === 'function') {
            patch = patch(this.state);
        }
        if (!patch) return;

        for (const [key, value] of Object.entries(patch)) {
            if (
                value !== null &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                !(value instanceof Set) &&
                !(value instanceof Map) &&
                this.state[key] &&
                typeof this.state[key] === 'object'
            ) {
                this.state[key] = { ...this.state[key], ...value };
            } else {
                this.state[key] = value;
            }
        }

        this.notify();
    }

    toggleSidebarTree(key) {
        const expanded = { ...this.state.sidebarExpanded };
        expanded[key] = !expanded[key];
        this.state.sidebarExpanded = expanded;
        this.notify();
        this.persist();
    }

    setFavoritesTab(tab) {
        if (this.state.favoritesTab === tab) return;
        this.state.favoritesTab = tab;
        this.notify();
        this.persist();
    }

    toggleSelection(song) {
        if (!song || !song.id) return;
        const list = this.state.selection;
        const exists = list.some((s) => s.id === song.id);
        this.state.selection = exists
            ? list.filter((s) => s.id !== song.id)
            : [...list, song];
        this.notify();
    }

    addSelection(songs) {
        const current = this.state.selection;
        const seen = new Set(current.map((s) => s.id));
        const newOnes = songs.filter((s) => s && s.id && !seen.has(s.id));
        if (!newOnes.length) return false;
        this.state.selection = [...current, ...newOnes];
        this.notify();
        return true;
    }

    clearSelection() {
        if (this.state.selection.length === 0 && !this.state.multiSelectMode) return;
        this.state.selection = [];
        this.state.multiSelectMode = false;
        this.notify();
    }

    toggleMultiSelectMode() {
        this.state.multiSelectMode = !this.state.multiSelectMode;
        if (!this.state.multiSelectMode) {
            this.state.selection = [];
        }
        this.notify();
    }

    moveTrackInQueue(fromIndex, toIndex) {
        const q = this.state.queue;
        if (fromIndex === toIndex) return;
        if (fromIndex < 0 || fromIndex >= q.tracks.length) return;
        if (toIndex < 0 || toIndex >= q.tracks.length) return;
        const tracks = [...q.tracks];
        const [moved] = tracks.splice(fromIndex, 1);
        tracks.splice(toIndex, 0, moved);
        let currentIndex = q.currentIndex;
        if (currentIndex === fromIndex) {
            currentIndex = toIndex;
        } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
            currentIndex -= 1;
        } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
            currentIndex += 1;
        }
        this.state.queue = { ...q, tracks, currentIndex };
        this.notify();
        this.persist();
    }

    moveTracksInQueue(fromIndices, toIndex) {
        const q = this.state.queue;
        const indices = Array.from(new Set(fromIndices))
            .filter((i) => Number.isInteger(i) && i >= 0 && i < q.tracks.length)
            .sort((a, b) => a - b);
        if (!indices.length) return;
        const set = new Set(indices);
        const moved = indices.map((i) => q.tracks[i]);
        const remaining = q.tracks.filter((_, i) => !set.has(i));
        let adjustedTo = toIndex;
        for (const i of indices) {
            if (i < toIndex) adjustedTo -= 1;
        }
        if (adjustedTo < 0) adjustedTo = 0;
        if (adjustedTo > remaining.length) adjustedTo = remaining.length;
        const tracks = [
            ...remaining.slice(0, adjustedTo),
            ...moved,
            ...remaining.slice(adjustedTo),
        ];
        let currentIndex = q.currentIndex;
        if (currentIndex >= 0) {
            const currentSong = q.tracks[currentIndex];
            const found = tracks.indexOf(currentSong);
            currentIndex = found >= 0 ? found : -1;
        }
        this.state.queue = { ...q, tracks, currentIndex };
        this.notify();
        this.persist();
    }

    moveTrackInDownloads(fromIndex, toIndex) {
        const list = this.state.downloads;
        if (fromIndex === toIndex) return;
        if (fromIndex < 0 || fromIndex >= list.length) return;
        if (toIndex < 0 || toIndex >= list.length) return;
        const downloads = [...list];
        const [moved] = downloads.splice(fromIndex, 1);
        downloads.splice(toIndex, 0, moved);
        this.state.downloads = downloads;
        this.notify();
        this.persist();
    }

    moveTracksInDownloads(fromIndices, toIndex) {
        const list = this.state.downloads;
        const indices = Array.from(new Set(fromIndices))
            .filter((i) => Number.isInteger(i) && i >= 0 && i < list.length)
            .sort((a, b) => a - b);
        if (!indices.length) return;
        const set = new Set(indices);
        const moved = indices.map((i) => list[i]);
        const remaining = list.filter((_, i) => !set.has(i));
        let adjustedTo = toIndex;
        for (const i of indices) {
            if (i < toIndex) adjustedTo -= 1;
        }
        if (adjustedTo < 0) adjustedTo = 0;
        if (adjustedTo > remaining.length) adjustedTo = remaining.length;
        const downloads = [
            ...remaining.slice(0, adjustedTo),
            ...moved,
            ...remaining.slice(adjustedTo),
        ];
        this.state.downloads = downloads;
        this.notify();
        this.persist();
    }

    disconnectAccount() {
        this.state.account = {
            uid: '',
            nickname: '',
            avatarUrl: '',
            signature: '',
            playlistCount: 0,
            followeds: 0,
            follows: 0,
            connected: false,
        };
        if (this.state.view === 'myfavorites') {
            this.state.view = 'search';
        }
        this.notify();
        this.persist();
    }

    setVisibleTracks(songs) {
        const next = Array.isArray(songs) ? songs : [];
        if (this.state.visibleTracks === next) return;
        this.state.visibleTracks = next;
        this.notify();
    }

    setAllTracks(songs) {
        this.state.allTracks = Array.isArray(songs) ? songs : [];
    }

    setFilteredTracks(songs) {
        this.state.filteredTracks = Array.isArray(songs) ? songs : [];
    }

    upsertDownloadTask(id, patch, options = {}) {
        const tasks = this.state.downloadTasks;
        const idx = tasks.findIndex((t) => t.id === id);
        const isNew = idx === -1;

        if (isNew) {
            this.state.downloadTasks = [...tasks, { id, ...patch }];
            if (this.state.selection.length > 0) {
                this.state.selection = [];
            }
            if (this.state.view !== 'status') {
                this.state.view = 'status';
            }
        } else {
            this.state.downloadTasks = tasks.map((t, i) =>
                i === idx ? { ...t, ...patch } : t
            );
        }

        this.notify();
        if (options.persist !== false) {
            this.persist();
        }
    }

    updateTaskTrack(taskId, trackId, patch) {
        const tasks = this.state.downloadTasks;
        const idx = tasks.findIndex((t) => t.id === taskId);
        if (idx === -1) return;
        const task = tasks[idx];
        if (!task.tracks) return;

        const tracks = task.tracks.map((t) => {
            if (t.id !== trackId) return t;
            if (t.status === 'removed') return t;
            return { ...t, ...patch };
        });

        const done = tracks.filter((t) => t.status === 'done').length;
        const bytes = tracks.reduce((s, t) => s + (t.bytes || 0), 0);
        const totalBytes = tracks.reduce((s, t) => s + (t.totalBytes || 0), 0);

        this.state.downloadTasks = tasks.map((t, i) =>
            i === idx ? { ...t, tracks, done, bytes, totalBytes } : t
        );
        this.notify();
    }

    removeTaskTrack(taskId, trackId) {
        const tasks = this.state.downloadTasks;
        const idx = tasks.findIndex((t) => t.id === taskId);
        if (idx === -1) return;
        const task = tasks[idx];
        if (!task.tracks) return;

        const tracks = task.tracks.map((t) =>
            t.id === trackId ? { ...t, status: 'removed', speed: 0, eta: 0, progress: 0 } : t
        );

        this.state.downloadTasks = tasks.map((t, i) =>
            i === idx ? { ...t, tracks } : t
        );
        this.notify();
        this.persist();
    }

    clearFinishedTasks() {
        const tasks = this.state.downloadTasks;
        const newTasks = tasks.filter((t) => t.status === 'active');
        if (newTasks.length === tasks.length) return;
        this.state.downloadTasks = newTasks;
        this.notify();
        this.persist();
    }

    persist() {
        try {
            const payload = {
                downloads: this.state.downloads,
                settings: this.state.settings,
                account: this.state.account.connected ? {
                    uid: this.state.account.uid,
                    nickname: this.state.account.nickname,
                    avatarUrl: this.state.account.avatarUrl,
                    signature: this.state.account.signature,
                    playlistCount: this.state.account.playlistCount,
                    followeds: this.state.account.followeds,
                    follows: this.state.account.follows,
                } : null,
                queue: {
                    tracks: this.state.queue.tracks,
                    currentIndex: this.state.queue.currentIndex,
                    playMode: this.state.queue.playMode,
                    volume: this.state.queue.volume,
                    currentTime: this.state.queue.currentTime,
                    duration: this.state.queue.duration,
                },
                downloadTasks: this.state.downloadTasks,
                filter: this.state.filter,
                sidebarExpanded: this.state.sidebarExpanded,
                favoritesTab: this.state.favoritesTab,
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (err) {
            console.error('[store] persist failed:', err);
        }
    }

    applyTheme() {
        const { themeColor, themeMode } = this.state.settings;
        const mode = themeMode || 'auto';
        const resolved = resolveMode(mode);

        if (!themeColor && resolved === 'light') {
            clearThemeVars();
            return;
        }
        applyThemeVars(generateThemeVars(themeColor || '#2d2d2d', resolved));
        applyColorScheme(resolved);
    }

    setTheme(themeColor) {
        if (this.state.settings.themeColor === themeColor) return;
        this.state.settings = { ...this.state.settings, themeColor };
        this.persist();
        this.applyTheme();
        this.notify();
    }

    setThemeMode(mode) {
        if (!['auto', 'light', 'dark'].includes(mode)) return;
        if ((this.state.settings.themeMode || 'auto') === mode) return;
        this.state.settings = { ...this.state.settings, themeMode: mode };
        this.persist();
        this.applyTheme();
        this.notify();
    }
}

export const store = new Store();