import { config } from '../config.js';
import { store } from './store.js';

const PLAY_TIMEOUT = 12000;

function proxiedAudio(url) {
    if (!url) return '';
    if (!store.get().settings.playProxy) return url;
    if (url.startsWith(config.proxy)) return url;
    return config.proxy + encodeURIComponent(url);
}

function playWithTimeout(audio, timeoutMs = PLAY_TIMEOUT) {
    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            try { audio.pause(); } catch {}
            reject(new Error('播放超时，音频源可能不可用'));
        }, timeoutMs);
    });
    return Promise.race([audio.play(), timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

export class Player {
    constructor(api, cfg = config) {
        this.api = api;
        this.config = cfg;
        this.audio = new Audio();
        this.audio.preload = 'auto';
        this.events = new Map();
        this.pendingCancel = null;
        this.persistTimer = null;

        const q = store.get().queue;
        const cur = q.currentIndex >= 0 ? q.tracks[q.currentIndex] : null;
        this.resumeState = cur && q.currentTime > 0
            ? { songId: cur.id, time: q.currentTime }
            : null;

        this.audio.addEventListener('timeupdate', () => this.handleTimeUpdate());
        this.audio.addEventListener('ended', () => this.handleEnded());
        this.audio.addEventListener('loadedmetadata', () => this.handleLoadedMetadata());
        this.audio.addEventListener('error', () => this.handleError());

        this.audio.volume = store.get().queue.volume;
    }

    on(event, cb) {
        if (!this.events.has(event)) this.events.set(event, new Set());
        this.events.get(event).add(cb);
        return () => this.events.get(event).delete(cb);
    }

    emit(event, payload) {
        const subs = this.events.get(event);
        if (!subs) return;
        for (const cb of subs) {
            try {
                cb(payload);
            } catch (err) {
                console.error('[player] listener error:', err);
            }
        }
    }

    get current() {
        const q = store.get().queue;
        return q.currentIndex >= 0 ? q.tracks[q.currentIndex] : null;
    }

    playNow(song) {
        const q = store.get().queue;

        const existingIndex = q.tracks.findIndex((t) => t.id === song.id);
        if (existingIndex >= 0) {
            this.playAt(existingIndex);
            return;
        }

        if (q.tracks.length === 0 || q.currentIndex < 0) {
            this.setQueue([song], 0, true);
            return;
        }

        const tracks = [...q.tracks];
        const insertAt = q.currentIndex + 1;
        tracks.splice(insertAt, 0, song);
        store.update({ queue: { ...q, tracks } });
        this.playAt(insertAt);
    }

    addToQueue(song) {
        const q = store.get().queue;
        store.update({
            queue: { ...q, tracks: [...q.tracks, song] },
        });
    }

    playNext(song) {
        const q = store.get().queue;
        const tracks = [...q.tracks];
        const insertAt = q.currentIndex >= 0 ? q.currentIndex + 1 : tracks.length;
        tracks.splice(insertAt, 0, song);
        store.update({ queue: { ...q, tracks } });
    }

    async playAt(index) {
        const q = store.get().queue;
        if (index < 0 || index >= q.tracks.length) return;
        await this.loadAndPlay(index, true);
    }

    async setQueue(tracks, index, autoplay = true) {
        const q = store.get().queue;
        store.update({
            queue: {
                ...q,
                tracks: [...tracks],
                currentIndex: index,
                currentTime: 0,
                duration: 0,
            },
        });
        await this.loadAndPlay(index, autoplay);
    }

    async loadAndPlay(index, autoplay = true) {
        const snapshot = store.get().queue;
        const song = snapshot.tracks[index];
        if (!song) return;

        if (this.pendingCancel) {
            try { this.pendingCancel(); } catch {}
            this.pendingCancel = null;
        }

        const token = { cancelled: false };
        const cancelFn = () => { token.cancelled = true; };
        this.pendingCancel = cancelFn;

        store.update({
            queue: {
                ...store.get().queue,
                currentIndex: index,
                currentTime: 0,
                duration: 0,
                isLoading: true,
                isPlaying: false,
                error: null,
            },
        });

        this.emit('loading', song);

        try {
            const url = await this.api.resolveAudio(song, store.get().settings.quality);
            if (token.cancelled) return;

            this.audio.pause();
            this.audio.src = proxiedAudio(url);
            this.audio.load();

            this.emit('trackchange', song);

            if (autoplay) {
                try {
                    await playWithTimeout(this.audio);
                    if (token.cancelled) return;
                    store.update({ queue: { ...store.get().queue, isPlaying: true, error: null } });
                    store.persist();
                } catch (err) {
                    if (token.cancelled) return;
                    if (err.name === 'AbortError') return;

                    store.update({
                        queue: {
                            ...store.get().queue,
                            isPlaying: false,
                            error: err.message || '播放失败',
                        },
                    });
                    this.emit('error', { song, error: err });
                }
            }
        } catch (err) {
            if (token.cancelled) return;

            store.update({
                queue: {
                    ...store.get().queue,
                    isPlaying: false,
                    error: err.message || '加载失败',
                },
            });
            this.emit('error', { song, error: err });
        } finally {
            if (!token.cancelled) {
                store.update({ queue: { ...store.get().queue, isLoading: false } });
                if (this.pendingCancel === cancelFn) {
                    this.pendingCancel = null;
                }
            }
        }
    }

    toggle() {
        const q = store.get().queue;

        if (!this.audio.src || q.currentIndex < 0) {
            if (q.tracks.length === 0) return;
            const idx = q.currentIndex < 0 ? 0 : q.currentIndex;
            this.loadAndPlay(idx, true);
            return;
        }

        if (this.audio.paused) {
            playWithTimeout(this.audio)
                .then(() => {
                    store.update({ queue: { ...store.get().queue, isPlaying: true, error: null } });
                    store.persist();
                })
                .catch((err) => {
                    if (err.name === 'AbortError') return;
                    store.update({
                        queue: { ...store.get().queue, isPlaying: false, error: err.message },
                    });
                    this.emit('error', { song: this.current, error: err });
                });
        } else {
            this.audio.pause();
            store.update({ queue: { ...store.get().queue, isPlaying: false } });
            store.persist();
        }
    }

    next() {
        const q = store.get().queue;
        if (q.tracks.length === 0) return;

        const idx = this.getNextIndex(1, false);
        if (idx === -1) {
            store.update({ queue: { ...q, isPlaying: false } });
            store.persist();
            return;
        }
        this.loadAndPlay(idx, true);
    }

    prev() {
        const q = store.get().queue;
        if (q.tracks.length === 0) return;

        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
            return;
        }

        const idx = this.getNextIndex(-1, true);
        if (idx === -1) return;
        this.loadAndPlay(idx, true);
    }

    getNextIndex(direction, fromPrev) {
        const q = store.get().queue;
        const total = q.tracks.length;
        if (total === 0) return -1;

        const cur = q.currentIndex < 0 ? 0 : q.currentIndex;

        if (q.playMode === 'shuffle') {
            if (total === 1) return 0;
            let idx;
            do {
                idx = Math.floor(Math.random() * total);
            } while (idx === cur);
            return idx;
        }

        let idx = cur + direction;

        if (idx < 0) {
            if (q.playMode === 'repeat-all') return total - 1;
            return fromPrev ? 0 : -1;
        }

        if (idx >= total) {
            if (q.playMode === 'repeat-all') return 0;
            return -1;
        }

        return idx;
    }

    handleEnded() {
        const q = store.get().queue;

        if (q.playMode === 'repeat-one') {
            this.audio.currentTime = 0;
            this.audio.play().catch(() => {});
            return;
        }

        if (q.tracks.length === 0) return;

        const idx = this.getNextIndex(1, false);
        if (idx === -1) {
            store.update({ queue: { ...q, isPlaying: false } });
            this.emit('ended', null);
            store.persist();
            return;
        }
        this.loadAndPlay(idx, true);
    }

    handleTimeUpdate() {
        const q = store.get().queue;
        store.update({
            queue: {
                ...q,
                currentTime: this.audio.currentTime || 0,
                duration: this.audio.duration || q.duration || 0,
            },
        });
        this.emit('timeupdate', {
            currentTime: this.audio.currentTime || 0,
            duration: this.audio.duration || 0,
        });

        if (!this.persistTimer) {
            this.persistTimer = setTimeout(() => {
                this.persistTimer = null;
                store.persist();
            }, 5000);
        }
    }

    handleLoadedMetadata() {
        const q = store.get().queue;
        const song = q.currentIndex >= 0 ? q.tracks[q.currentIndex] : null;

        if (song && this.resumeState && this.resumeState.songId === song.id && this.resumeState.time > 0) {
            try {
                this.audio.currentTime = this.resumeState.time;
            } catch {}
        }
        this.resumeState = null;

        store.update({
            queue: { ...q, duration: this.audio.duration || 0, currentTime: this.audio.currentTime || 0 },
        });
    }

    handleError() {
        const q = store.get().queue;
        const song = q.tracks[q.currentIndex];
        if (!song) return;

        if (this.pendingCancel) {
            try { this.pendingCancel(); } catch {}
            this.pendingCancel = null;
        }

        const message = '音频加载失败';
        store.update({
            queue: { ...q, isLoading: false, isPlaying: false, error: message },
        });
        this.emit('error', { song, error: new Error(message) });
    }

    seek(percent) {
        if (!this.audio.duration) return;
        const clamped = Math.max(0, Math.min(1, percent));
        this.audio.currentTime = clamped * this.audio.duration;
        store.persist();
    }

    setVolume(v) {
        const vol = Math.max(0, Math.min(1, v));
        this.audio.volume = vol;
        store.update({ queue: { ...store.get().queue, volume: vol } });
        store.persist();
    }

    setMode(mode) {
        const allowed = ['order', 'shuffle', 'repeat-one', 'repeat-all'];
        if (!allowed.includes(mode)) return;
        store.update({ queue: { ...store.get().queue, playMode: mode } });
        store.persist();
    }

    cycleMode() {
        const order = ['order', 'shuffle', 'repeat-one', 'repeat-all'];
        const cur = store.get().queue.playMode;
        const idx = order.indexOf(cur);
        const next = order[(idx + 1) % order.length];
        this.setMode(next);
        return next;
    }

    destroy() {
        if (this.pendingCancel) {
            try { this.pendingCancel(); } catch {}
            this.pendingCancel = null;
        }
        if (this.persistTimer) {
            clearTimeout(this.persistTimer);
            this.persistTimer = null;
        }
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();
        this.events.clear();
    }
}