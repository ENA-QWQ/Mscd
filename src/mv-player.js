import { store } from './store.js';
import { Toast } from './components.js';

export class MVPlayer {
    constructor(api, player) {
        this.api = api;
        this.player = player;
        this.video = null;
        this.pendingSeekTime = null;
        this.videoBound = false;
    }

    getVideo() {
        if (!this.video) {
            this.video = document.querySelector('.mv-video');
        }
        if (this.video && !this.videoBound) {
            this.videoBound = true;
            this.bindVideoEvents(this.video);
        }
        return this.video;
    }

    bindVideoEvents(v) {
        v.addEventListener('loadeddata', () => {
            if (store.get().playbackMode !== 'mv') return;
            requestAnimationFrame(() => {
                v.classList.add('is-ready');
            });
        });

        v.addEventListener('timeupdate', () => {
            if (store.get().playbackMode !== 'mv') return;
            const s = store.get().mvState;
            store.update({
                mvState: {
                    ...s,
                    currentTime: v.currentTime || 0,
                    duration: v.duration || s.duration,
                },
            });
        });

        v.addEventListener('loadedmetadata', () => {
            const target = this.pendingSeekTime;
            this.pendingSeekTime = null;
            if (target != null && v.duration) {
                v.currentTime = Math.max(0, Math.min(target, v.duration - 0.1));
            }
            const s = store.get().mvState;
            store.update({
                mvState: {
                    ...s,
                    duration: v.duration || s.duration,
                    loading: false,
                },
            });
        });

        v.addEventListener('ended', () => this.handleEnded());

        v.addEventListener('error', () => {
            Toast('MV 加载失败', 'danger', 2200);
        });

        v.addEventListener('play', () => {
            const s = store.get();
            if (s.playbackMode !== 'mv') return;
            store.update({ queue: { ...s.queue, isPlaying: true } });
        });

        v.addEventListener('pause', () => {
            const s = store.get();
            if (s.playbackMode !== 'mv') return;
            if (this._switchingSrc) return;
            store.update({ queue: { ...s.queue, isPlaying: false } });
        });
    }

    async loadDetail(mvid) {
        const detail = await this.api.mvDetail(mvid);
        const settings = store.get().settings;
        const brs = detail.brs || [];
        let targetBr = settings.mvQuality || 1080;
        if (!brs.some(b => b.br === targetBr)) {
            targetBr = brs.reduce((m, b) => Math.max(m, b.br || 0), 0) || 1080;
        }
        store.update({
            mvState: {
                ...store.get().mvState,
                mvid,
                detail,
                brs,
                currentBr: targetBr,
                duration: detail.duration ? detail.duration / 1000 : 0,
                loading: true,
                error: null,
            },
        });
        return { detail, targetBr };
    }

    async loadUrl(br, initialTime) {
        const s = store.get();
        const mvid = s.mvState.mvid;
        if (!mvid) return;
        const urlData = await this.api.mvUrl(mvid, br);
        const v = this.getVideo();
        if (!v) return;

        v.style.transition = 'none';
        v.classList.remove('is-ready');
        void v.offsetWidth;
        v.style.transition = '';

        this._switchingSrc = true;
        const target = initialTime != null ? initialTime : v.currentTime;
        this.pendingSeekTime = target;

        v.src = urlData.url;
        v.load();
        this._switchingSrc = false;

        store.update({
            mvState: {
                ...store.get().mvState,
                url: urlData.url,
                currentBr: br,
                loading: false,
            },
        });

        if (store.get().queue.isPlaying) {
            try { await v.play(); } catch {}
        }
    }

        async enterMv(song) {
        if (!song) return;
        const mvStr = song.mv != null ? String(song.mv) : '';
        if (mvStr === '' || mvStr === '0') return;
        const audio = this.player.audio;
        const songProgress = audio.duration > 0 ? audio.currentTime / audio.duration : 0;
        const wasPlaying = !audio.paused;

        audio.pause();

        try {
            store.update({ playbackMode: 'mv' });
            const { detail, targetBr } = await this.loadDetail(String(song.mv));
            const mvDurationSec = (detail.duration || 0) / 1000;
            const initialTime = songProgress * mvDurationSec;
            store.update({ queue: { ...store.get().queue, isPlaying: wasPlaying } });
            await this.loadUrl(targetBr, initialTime);
        } catch (err) {
            Toast(`MV 加载失败：${err.message}`, 'danger', 2400);
            store.update({ playbackMode: 'song' });
            if (wasPlaying) audio.play().catch(() => {});
        }
    }

    exitMv() {
        const s = store.get();
        const v = this.getVideo();
        const audio = this.player.audio;

        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }

        const overlayEl = document.querySelector('.playback-overlay');
        if (overlayEl) overlayEl.classList.remove('is-web-fullscreen');
        document.body.classList.remove('mv-web-fullscreen');
        document.body.classList.remove('mv-bars-hidden');

        const mvDuration = v && v.duration ? v.duration : s.mvState.duration;
        const mvProgress = mvDuration > 0 && v ? v.currentTime / mvDuration : 0;
        const wasPlaying = v ? !v.paused : s.queue.isPlaying;

        const currentSong = s.queue.currentIndex >= 0 ? s.queue.tracks[s.queue.currentIndex] : null;
        const currentSongId = currentSong ? String(currentSong.id) : '';
        const audioMatches = audio.duration > 0 && this.player.currentAudioSongId === currentSongId;

        if (audioMatches) {
            audio.currentTime = mvProgress * audio.duration;
        } else {
            this.player.resumeState = {
                songId: currentSongId,
                ratio: mvProgress,
            };
        }

        if (v) {
            this._switchingSrc = true;
            v.pause();
            v.removeAttribute('src');
            try { v.load(); } catch {}
            this._switchingSrc = false;
        }

        store.update({
            playbackMode: 'song',
            mvState: {
                ...s.mvState,
                mvid: '',
                detail: null,
                brs: [],
                url: '',
                currentTime: 0,
                duration: 0,
                loading: false,
                error: null,
            },
        });

        if (!audioMatches && currentSong) {
            this.player.loadAndPlay(s.queue.currentIndex, wasPlaying);
            return;
        }

        if (wasPlaying) audio.play().catch(() => {});
    }

    toggle() {
        const v = this.getVideo();
        if (!v) return;
        if (v.paused) v.play().catch(() => {});
        else v.pause();
    }

    seek(percent) {
        const v = this.getVideo();
        if (!v || !v.duration) return;
        const clamped = Math.max(0, Math.min(1, percent));
        v.currentTime = clamped * v.duration;
    }

    setVolume(vol) {
        const v = this.getVideo();
        if (v) v.volume = Math.max(0, Math.min(1, vol));
    }

    async switchQuality(br) {
        const s = store.get();
        if (s.mvState.currentBr === br) return;
        store.update({ settings: { ...s.settings, mvQuality: br } });
        store.persist();
        await this.loadUrl(br);
    }

    findNextIndex(direction) {
        const q = store.get().queue;
        const total = q.tracks.length;
        if (total === 0) return -1;
        const cur = q.currentIndex < 0 ? 0 : q.currentIndex;

        if (q.playMode === 'shuffle') {
            if (total === 1) return 0;
            let idx;
            do { idx = Math.floor(Math.random() * total); } while (idx === cur && total > 1);
            return idx;
        }

        let idx = cur + direction;
        if (idx < 0) {
            if (q.playMode === 'repeat-all') return total - 1;
            return -1;
        }
        if (idx >= total) {
            if (q.playMode === 'repeat-all') return 0;
            return -1;
        }
        return idx;
    }

    stopVideo() {
        const v = this.getVideo();
        if (!v) return;
        this._switchingSrc = true;
        try { v.pause(); } catch {}
        v.removeAttribute('src');
        try { v.load(); } catch {}
        v.style.transition = 'none';
        v.classList.remove('is-ready');
        void v.offsetWidth;
        v.style.transition = '';
        const panel = v.closest('.playback-panel--mv');
        if (panel) panel.classList.remove('is-paused');
        this._switchingSrc = false;
    }

    clearMvState() {
        store.update({
            mvState: {
                ...store.get().mvState,
                mvid: '',
                detail: null,
                brs: [],
                url: '',
                currentTime: 0,
                duration: 0,
                loading: false,
                error: null,
            },
        });
    }

    goToIndex(idx) {
        const q = store.get().queue;
        const song = q.tracks[idx];
        if (!song) return;

        if (song.mv && String(song.mv) !== '0') {
            const audio = this.player.audio;
            audio.pause();
            store.update({
                queue: {
                    ...q,
                    currentIndex: idx,
                    currentTime: 0,
                    duration: 0,
                    isPlaying: true,
                    error: null,
                },
            });
            store.persist();
            this.player.emit('trackchange', song);
            this.loadDetail(String(song.mv)).then(({ targetBr }) => {
                this.loadUrl(targetBr, 0);
            }).catch((err) => {
                Toast(`MV 加载失败：${err.message}`, 'danger', 2400);
                this.stopVideo();
                this.clearMvState();
                store.update({ playbackMode: 'song' });
                this.player.loadAndPlay(idx, true);
            });
        } else {
            this.stopVideo();
            this.clearMvState();
            store.update({ playbackMode: 'song' });
            this.player.loadAndPlay(idx, true);
        }
    }

    next() {
        const q = store.get().queue;
        if (!q.tracks.length) return;
        const idx = this.findNextIndex(1);
        if (idx === -1) {
            store.update({ queue: { ...q, isPlaying: false } });
            store.persist();
            return;
        }
        this.goToIndex(idx);
    }

    prev() {
        const v = this.getVideo();
        if (v && v.currentTime > 3) {
            v.currentTime = 0;
            return;
        }
        const q = store.get().queue;
        if (!q.tracks.length) return;
        const idx = this.findNextIndex(-1);
        if (idx === -1) return;
        this.goToIndex(idx);
    }

    handleEnded() {
        const q = store.get().queue;
        if (q.playMode === 'repeat-one') {
            const v = this.getVideo();
            if (v) {
                v.currentTime = 0;
                v.play().catch(() => {});
            }
            return;
        }
        this.next();
    }
}