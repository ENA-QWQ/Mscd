import { config } from '../config.js';
import {
    generateThemeVars,
    applyThemeVars,
    clearThemeVars,
} from './theme.js';

const STORAGE_KEY = 'meting-app-state';

function createInitialState() {
    return {
        view: 'search',

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

        visibleTracks: [],

        downloadTasks: [],

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
            namingFormat: '{title} - {artist}',
            batchCategory: 'none',
            lyricSaveMode: 'same',
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
        if (this.state.selection.length === 0) return;
        this.state.selection = [];
        this.notify();
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
        if (this.state.view === 'liked' || this.state.view === 'myplaylists') {
            this.state.view = 'search';
        }
        this.notify();
        this.persist();
    }

    setVisibleTracks(songs) {
        this.state.visibleTracks = Array.isArray(songs) ? songs : [];
    }

    upsertDownloadTask(id, patch) {
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
        this.persist();
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
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (err) {
            console.error('[store] persist failed:', err);
        }
    }

    applyTheme() {
        const { themeColor } = this.state.settings;
        if (!themeColor) {
            clearThemeVars();
        } else {
            applyThemeVars(generateThemeVars(themeColor));
        }
    }

    setTheme(themeColor) {
        if (this.state.settings.themeColor === themeColor) return;
        this.state.settings = { ...this.state.settings, themeColor };
        this.persist();
        if (!themeColor) {
            clearThemeVars();
        } else {
            applyThemeVars(generateThemeVars(themeColor));
        }
        this.notify();
    }
}

export const store = new Store();