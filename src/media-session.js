let mediaSession = null;
let lastPositionUpdate = 0;
const POSITION_UPDATE_INTERVAL = 5000;

export function initMediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return null;
    mediaSession = navigator.mediaSession;
    return mediaSession;
}

export function updateMetadata(song) {
    if (!mediaSession || !song) return;
    const artwork = [];
    if (song.pic) {
        artwork.push(
            { src: song.pic, sizes: '96x96', type: 'image/jpeg' },
            { src: song.pic, sizes: '128x128', type: 'image/jpeg' },
            { src: song.pic, sizes: '192x192', type: 'image/jpeg' },
            { src: song.pic, sizes: '256x256', type: 'image/jpeg' },
            { src: song.pic, sizes: '384x384', type: 'image/jpeg' },
            { src: song.pic, sizes: '512x512', type: 'image/jpeg' }
        );
    }
    try {
        mediaSession.metadata = new MediaMetadata({
            title: song.title || '未知歌曲',
            artist: song.artist || '未知歌手',
            album: song.album || '',
            artwork,
        });
    } catch {}
}

export function setPlaybackState(state) {
    if (!mediaSession) return;
    try {
        mediaSession.playbackState = state;
    } catch {}
}

export function setPositionState(duration, currentTime, playbackRate = 1) {
    if (!mediaSession || !mediaSession.setPositionState) return;
    if (!duration || !isFinite(duration) || duration <= 0) return;
    try {
        mediaSession.setPositionState({
            duration,
            playbackRate,
            position: Math.min(Math.max(currentTime, 0), duration),
        });
    } catch {}
}

export function setPositionStateThrottled(duration, currentTime, playbackRate = 1) {
    const now = Date.now();
    if (now - lastPositionUpdate < POSITION_UPDATE_INTERVAL) return;
    lastPositionUpdate = now;
    setPositionState(duration, currentTime, playbackRate);
}

export function forcePositionUpdate(duration, currentTime, playbackRate = 1) {
    lastPositionUpdate = Date.now();
    setPositionState(duration, currentTime, playbackRate);
}

export function clearMetadata() {
    if (!mediaSession) return;
    try {
        mediaSession.metadata = null;
        mediaSession.playbackState = 'none';
    } catch {}
}

export function setupActionHandlers(player) {
    if (!mediaSession) return;

    const handlers = {
        play: () => {
            if (player.audio.paused) {
                player.toggle();
            }
        },
        pause: () => {
            if (!player.audio.paused) {
                player.toggle();
            }
        },
        previoustrack: () => player.prev(),
        nexttrack: () => player.next(),
        seekbackward: (details) => {
            const offset = details.seekOffset || 10;
            if (player.audio.duration) {
                player.seek((player.audio.currentTime - offset) / player.audio.duration);
                forcePositionUpdate(player.audio.duration, player.audio.currentTime);
            }
        },
        seekforward: (details) => {
            const offset = details.seekOffset || 10;
            if (player.audio.duration) {
                player.seek((player.audio.currentTime + offset) / player.audio.duration);
                forcePositionUpdate(player.audio.duration, player.audio.currentTime);
            }
        },
        seekto: (details) => {
            if (details.seekTime != null && player.audio.duration) {
                player.seek(details.seekTime / player.audio.duration);
                forcePositionUpdate(player.audio.duration, player.audio.currentTime);
            }
        },
        stop: () => {
            player.audio.pause();
            player.audio.currentTime = 0;
            setPlaybackState('none');
        },
    };

    for (const [action, handler] of Object.entries(handlers)) {
        try {
            mediaSession.setActionHandler(action, handler);
        } catch {}
    }
}