function parseUrl() {
    const raw = (window.location.hash || '').replace(/^#/, '');
    if (!raw || raw === '/') return { kind: 'home' };

    const [path, query] = raw.split('?');
    const seg = path.split('/').filter(Boolean);
    const name = seg[0] || '';
    const id = seg[1] || '';
    const params = new URLSearchParams(query || '');

    if (name === 'song') {
        if (!id) return { kind: 'home' };
        return { kind: 'playback', songId: decodeURIComponent(id) };
    }

    if (name === 'artist' || name === 'album' || name === 'playlist') {
        if (!id) return { kind: 'home' };
        return { kind: 'detail', type: name, id: decodeURIComponent(id) };
    }

    if (name === 'search') {
        const q = params.get('q') || '';
        if (!q) return { kind: 'home' };
        return {
            kind: 'search',
            keyword: q,
            type: params.get('type') || '1',
            page: Number(params.get('page')) || 1,
        };
    }

    if (['queue', 'downloads', 'status', 'settings', 'liked', 'myplaylists'].includes(name)) {
        return { kind: 'view', view: name };
    }

    return { kind: 'home' };
}

export function buildUrl(state) {
    if (state.playbackOpen) {
        const q = state.queue;
        const song = q.currentIndex >= 0 ? q.tracks[q.currentIndex] : null;
        const id = song?.id;
        if (id) return `#/song/${encodeURIComponent(id)}`;
    }

    const detail = state.search.detail;
    if (detail && detail.id) {
        if (detail.kind === 'artist') return `#/artist/${encodeURIComponent(detail.id)}`;
        if (detail.kind === 'album') return `#/album/${encodeURIComponent(detail.id)}`;
        if (detail.kind === 'playlist') return `#/playlist/${encodeURIComponent(detail.id)}`;
    }

    if (state.view === 'search') {
        const kw = state.search.keyword;
        if (kw) {
            const params = new URLSearchParams();
            params.set('q', kw);
            params.set('type', state.search.type || '1');
            return `#/search?${params.toString()}`;
        }
        return '#/';
    }

    if (['queue', 'downloads', 'status', 'settings', 'liked', 'myplaylists'].includes(state.view)) {
        return `#/${state.view}`;
    }

    return '#/';
}

export function initRouter(ctx) {
    const { store, searchActions } = ctx;
    let suppress = false;

    async function openPlaybackById(id) {
        const { api, player } = ctx;
        const state = store.get();
        const q = state.queue;
        const index = q.tracks.findIndex((t) => String(t.id) === String(id));

        if (index >= 0) {
            if (
                index === q.currentIndex &&
                player.audio &&
                player.audio.src &&
                !player.audio.paused
            ) {
                store.update({ playbackOpen: true });
                return true;
            }
            store.update({ playbackOpen: true });
            await player.loadAndPlay(index, false);
            return true;
        }

        try {
            const song = await api.song(id);
            if (!song) return false;
            store.update({ playbackOpen: true });
            await player.setQueue([song], 0, false);
            return true;
        } catch {
            return false;
        }
    }

    let pendingKey = '';

    async function applyFromUrl() {
        const parsed = parseUrl();

        let key;
        if (parsed.kind === 'detail') {
            key = `detail:${parsed.type}:${parsed.id}`;
        } else if (parsed.kind === 'playback') {
            key = `playback:${parsed.songId}`;
        } else if (parsed.kind === 'search') {
            key = `search:${parsed.keyword}:${parsed.type}:${parsed.page}`;
        } else if (parsed.kind === 'view') {
            key = `view:${parsed.view}`;
        } else {
            key = 'home';
        }

        if (pendingKey === key) return;

        pendingKey = key;
        suppress = true;

        try {
            if (parsed.kind !== 'playback' && store.get().playbackOpen) {
                store.update({ playbackOpen: false });
            }

            if (parsed.kind === 'home') {
                if (store.get().view !== 'search') {
                    store.update({ view: 'search' });
                }
                searchActions.resetToHome();
                return;
            }

            if (parsed.kind === 'playback') {
                const ok = await openPlaybackById(parsed.songId);
                if (!ok) {
                    history.replaceState({ __app: true, __depth: 0 }, '', '#/');
                    store.update({ playbackOpen: false, view: 'search' });
                    searchActions.resetToHome();
                }
                return;
            }

            if (parsed.kind === 'detail') {
                const s = store.get().search;
                if (s.detail && s.detail.kind === parsed.type && String(s.detail.id) === String(parsed.id)) {
                    return;
                }
                store.update({ view: 'search' });
                if (parsed.type === 'artist') await searchActions.openArtist(parsed.id);
                else if (parsed.type === 'album') await searchActions.openAlbumById(parsed.id);
                else if (parsed.type === 'playlist') await searchActions.openPlaylistById(parsed.id);
                return;
            }

            if (parsed.kind === 'search') {
                store.update({ view: 'search' });
                await searchActions.go(parsed.keyword, parsed.type, parsed.page);
                return;
            }

            if (parsed.kind === 'view') {
                if (store.get().view !== parsed.view) {
                    store.update({ view: parsed.view });
                }
            }
        } finally {
            if (pendingKey === key) {
                pendingKey = '';
            }
            suppress = false;
        }
    }

    function syncToUrl(state) {
        if (suppress) return;
        const want = buildUrl(state);
        const current = window.location.hash || '#/';
        if (want === current) return;

        const depth = (window.history.state && window.history.state.__depth) || 0;

        if (want.startsWith('#/song/') && current.startsWith('#/song/')) {
            history.replaceState({ __app: true, __depth: depth }, '', want);
            return;
        }

        history.pushState({ __app: true, __depth: depth + 1 }, '', want);
    }

    window.addEventListener('hashchange', applyFromUrl);
    window.addEventListener('popstate', applyFromUrl);

    history.replaceState({ __app: true, __depth: 0 }, '', window.location.href);

    applyFromUrl();

    store.subscribe(syncToUrl);
}