function parseUrl() {
    const raw = (window.location.hash || '').replace(/^#/, '');
    if (!raw || raw === '/') return { kind: 'home' };

    const [path, query] = raw.split('?');
    const seg = path.split('/').filter(Boolean);
    const name = seg[0] || '';
    const id = seg[1] || '';
    const params = new URLSearchParams(query || '');

    if (name === 'artist' || name === 'album' || name === 'playlist') {
        if (!id) return { kind: 'home' };
        return { kind: 'detail', type: name, id };
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

function buildUrl(state) {
    const detail = state.search.detail;
    if (detail && detail.id) {
        if (detail.kind === 'artist') return `#/artist/${detail.id}`;
        if (detail.kind === 'album') return `#/album/${detail.id}`;
        if (detail.kind === 'playlist') return `#/playlist/${detail.id}`;
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

    function applyFromUrl() {
        const parsed = parseUrl();
        suppress = true;
        try {
            if (parsed.kind === 'home') {
                if (store.get().view !== 'search') {
                    store.update({ view: 'search' });
                }
                searchActions.resetToHome();
                return;
            }

            if (parsed.kind === 'detail') {
                const s = store.get().search;
                if (s.detail && s.detail.kind === parsed.type && String(s.detail.id) === String(parsed.id)) {
                    return;
                }
                store.update({ view: 'search' });
                if (parsed.type === 'artist') searchActions.openArtist(parsed.id);
                else if (parsed.type === 'album') searchActions.openAlbumById(parsed.id);
                else if (parsed.type === 'playlist') searchActions.openPlaylistById(parsed.id);
                return;
            }

            if (parsed.kind === 'search') {
                store.update({ view: 'search' });
                searchActions.go(parsed.keyword, parsed.type, parsed.page);
                return;
            }

            if (parsed.kind === 'view') {
                if (store.get().view !== parsed.view) {
                    store.update({ view: parsed.view });
                }
            }
        } finally {
            suppress = false;
        }
    }

    function syncToUrl(state) {
        if (suppress) return;
        const want = buildUrl(state);
        const current = window.location.hash || '#/';
        if (want === current) return;
        const depth = ((window.history.state && window.history.state.__depth) || 0) + 1;
        history.pushState({ __app: true, __depth: depth }, '', want);
    }

    window.addEventListener('hashchange', applyFromUrl);
    window.addEventListener('popstate', applyFromUrl);

    history.replaceState({ __app: true, __depth: 0 }, '', window.location.href);

    applyFromUrl();

    store.subscribe(syncToUrl);
}