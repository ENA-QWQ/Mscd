import { config } from '../config.js';

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('请求超时')), ms)
        ),
    ]);
}

async function fetchWithRetry(url, options = {}, retryConfig = config.retry) {
    const { maxRetries, baseDelay } = retryConfig;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.timeout);

            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                redirect: 'follow',
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return response;
        } catch (error) {
            lastError = error;

            if (error.name === 'AbortError') {
                throw new Error('请求超时');
            }

            if (attempt === maxRetries) break;

            const delay = baseDelay * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

function upgradeToHttps(url) {
    if (!url) return url;
    if (url.startsWith('http://')) return 'https://' + url.slice(7);
    return url;
}

function extractIdFromUrl(url) {
    if (!url) return '';
    try {
        return new URL(url).searchParams.get('id') || '';
    } catch {
        return '';
    }
}

function normalizeSong(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const artist = Array.isArray(raw.artist)
        ? raw.artist.filter(Boolean).join(' / ')
        : typeof raw.artist === 'string'
            ? raw.artist
            : Array.isArray(raw.artists)
                ? raw.artists.map(a => a?.name).filter(Boolean).join(' / ')
                : '';

    const album = typeof raw.album === 'string'
        ? raw.album
        : raw.album?.name
        ?? raw.al?.name
        ?? '';

    const idFromUrl = extractIdFromUrl(raw.url);
    const id = String(raw.id ?? raw.url_id ?? raw.song_id ?? idFromUrl ?? '');

    return {
        id,
        title: raw.name ?? raw.title ?? '',
        artist,
        album,
        url: raw.url ?? '',
        pic: raw.pic ?? raw.cover ?? '',
        lrc: raw.lrc ?? '',
        duration: raw.duration ?? 0,
    };
}

class MetingAdapter {
    constructor(base) {
        this.base = base;
    }

    buildUrl(params) {
        const url = new URL(this.base);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, String(value));
            }
        });
        return url.toString();
    }

    async request(params) {
        const url = this.buildUrl(params);
        const response = await fetchWithRetry(url);
        const text = await response.text();
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    pickArray(data) {
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.data)) return data.data;
        if (data && Array.isArray(data.result)) return data.result;
        if (data && Array.isArray(data.songs)) return data.songs;
        if (data && Array.isArray(data.tracks)) return data.tracks;
        if (data && Array.isArray(data.playlists)) return data.playlists;
        if (data && Array.isArray(data.albums)) return data.albums;
        return [];
    }

    async search(keyword, { limit = 50, offset = 0, searchType = 1 } = {}) {
        const page = Math.floor(offset / limit) + 1;
        const data = await this.request({
            server: 'netease',
            type: 'search',
            id: keyword,
            search_type: searchType,
            limit,
            page,
        });
        const list = this.pickArray(data);
        const items = list.map(normalizeSong).filter(Boolean);
        return { items, total: null };
    }

    async song(id) {
        const data = await this.request({ server: 'netease', type: 'song', id });
        const list = this.pickArray(data);
        return list.map(normalizeSong).filter(Boolean)[0] ?? null;
    }

    async songUrl(id, br) {
        const url = this.buildUrl({ server: 'netease', type: 'url', id, br });
        const response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            referrerPolicy: 'no-referrer',
        });

        const finalUrl = response.url;

        if (finalUrl && finalUrl !== url) {
            try { response.body?.cancel(); } catch {}
            return upgradeToHttps(finalUrl);
        }

        const text = (await response.text()).trim();
        if (text.startsWith('@')) return upgradeToHttps(text.slice(1));
        if (text.startsWith('http')) return upgradeToHttps(text);
        throw new Error('无法解析音频地址');
    }

    async lyric(id) {
        try {
            const url = this.buildUrl({ server: 'netease', type: 'lrc', id });
            const response = await fetchWithRetry(url, {}, { maxRetries: 2, baseDelay: 800 });
            return await response.text();
        } catch {
            return '';
        }
    }

    async playlist(id) {
        const data = await this.request({ server: 'netease', type: 'playlist', id });
        const list = this.pickArray(data);
        return list.map(normalizeSong).filter(Boolean);
    }

    async album(id) {
        const data = await this.request({ server: 'netease', type: 'album', id });
        const list = this.pickArray(data);
        return list.map(normalizeSong).filter(Boolean);
    }
}

class NeteaseAdapter {
    constructor(base) {
        this.base = base.replace(/\/+$/, '');
    }

    buildUrl(path, params = {}) {
        const url = new URL(this.base + path);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, String(value));
            }
        });
        return url.toString();
    }

    async request(path, params = {}) {
        const url = this.buildUrl(path, params);
        const response = await fetchWithRetry(url);
        const text = await response.text();
        if (!text) return null;
        return JSON.parse(text);
    }

    pickArray(list) {
        if (!Array.isArray(list)) return [];
        return list.filter(Boolean);
    }

    normalizeSong(item) {
        if (!item) return null;

        let artists = item.ar || item.artists || [];
        if (!Array.isArray(artists) && artists?.name) {
            artists = [artists];
        }
        const artist = artists
            .map(a => a?.name)
            .filter(Boolean)
            .join(' / ');

        const albumObj = item.al || item.album || {};
        const albumName = albumObj.name
            ?? item.al?.name
            ?? item.album?.name
            ?? '';
        const pic = albumObj.picUrl ?? albumObj.pic ?? '';

        return {
            id: String(item.id ?? ''),
            title: item.name ?? '',
            artist,
            album: albumName,
            url: '',
            pic,
            lrc: '',
            duration: item.dt ?? item.duration ?? 0,
        };
    }

    normalizeArtist(item) {
        if (!item) return null;
        const alias = Array.isArray(item.alias)
            ? item.alias.filter(Boolean).join(' / ')
            : (typeof item.alias === 'string' ? item.alias : '');
        return {
            id: String(item.id ?? ''),
            title: item.name ?? '',
            artist: alias,
            url: '',
            pic: item.picUrl ?? item.img1v1Url ?? '',
            lrc: '',
            duration: 0,
            _type: 'artist',
            _extra: {
                albumSize: item.albumSize ?? 0,
                musicSize: item.musicSize ?? 0,
            },
        };
    }

    normalizeUser(item) {
        if (!item) return null;
        return {
            uid: String(item.userId ?? ''),
            nickname: item.nickname ?? '',
            avatarUrl: item.avatarUrl ?? '',
            signature: item.signature ?? '',
        };
    }

    normalizeUserPlaylist(item) {
        if (!item) return null;
        return {
            id: String(item.id ?? ''),
            title: item.name ?? '',
            artist: item.creator?.nickname ?? '',
            pic: item.coverImgUrl ?? '',
            lrc: '',
            duration: 0,
            _type: 'playlist',
            _extra: {
                trackCount: item.trackCount ?? 0,
                playCount: item.playCount ?? 0,
                description: item.description ?? '',
            },
            _creatorId: String(item.creator?.userId ?? ''),
            _specialType: item.specialType ?? 0,
            _privacy: item.privacy ?? 0,
            _subscribed: item.subscribed === true,
        };
    }

    normalizeAlbum(item) {
        if (!item) return null;
        const artist = item.artist?.name
            || (Array.isArray(item.artists) ? item.artists.map(a => a.name).filter(Boolean).join(' / ') : '');
        return {
            id: String(item.id ?? ''),
            title: item.name ?? '',
            artist,
            url: '',
            pic: item.picUrl ?? item.blurPicUrl ?? '',
            lrc: '',
            duration: 0,
            _type: 'album',
            _extra: {
                size: item.size ?? 0,
                publishTime: item.publishTime ?? 0,
                description: item.description ?? '',
            },
        };
    }

    normalizePlaylist(item) {
        if (!item) return null;
        return {
            id: String(item.id ?? ''),
            title: item.name ?? '',
            artist: item.creator?.nickname ?? '',
            url: '',
            pic: item.coverImgUrl ?? '',
            lrc: '',
            duration: 0,
            _type: 'playlist',
            _extra: {
                trackCount: item.trackCount ?? 0,
                playCount: item.playCount ?? 0,
                description: item.description ?? '',
            },
        };
    }

    async search(keyword, { limit = 30, offset = 0, searchType = 1 } = {}) {
        const data = await this.request('/cloudsearch', {
            keywords: keyword,
            type: searchType,
            limit,
            offset,
        });

        if (!data || !data.result) return { items: [], total: 0 };

        const r = data.result;
        let items = [];
        let total = 0;

        if (searchType === 1) {
            items = this.pickArray(r.songs || []).map(s => this.normalizeSong(s));
            total = r.songCount ?? items.length;
        } else if (searchType === 10) {
            items = this.pickArray(r.albums || []).map(a => this.normalizeAlbum(a));
            total = r.albumCount ?? items.length;
        } else if (searchType === 100) {
            items = this.pickArray(r.artists || []).map(a => this.normalizeArtist(a));
            total = r.artistCount ?? items.length;
        } else if (searchType === 1000) {
            items = this.pickArray(r.playlists || []).map(p => this.normalizePlaylist(p));
            total = r.playlistCount ?? items.length;
        }

        return { items, total };
    }

    async song(id) {
        const data = await this.request('/song/detail', { ids: id });
        const songs = data?.songs || [];
        return songs.length ? this.normalizeSong(songs[0]) : null;
    }

    async songUrl(id, br) {
        const brLevel = br >= 2000 ? 999000 : br >= 320 ? 320000 : 128000;

        const data = await this.request('/song/url', { id, br: brLevel });
        const item = data?.data?.[0];

        if (!item || !item.url) {
            try {
                const level = br >= 2000 ? 'lossless' : br >= 320 ? 'exhigh' : 'standard';
                const data2 = await this.request('/song/url/v1', { id, level });
                const item2 = data2?.data?.[0];
                if (item2?.url) return upgradeToHttps(item2.url);
            } catch {
            }
            throw new Error('无法获取歌曲 URL');
        }

        return upgradeToHttps(item.url);
    }

    async lyric(id) {
        try {
            const data = await this.request('/lyric', { id });
            return data?.lrc?.lyric ?? '';
        } catch {
            return '';
        }
    }

    async playlist(id) {
        const data = await this.request('/playlist/detail', { id });
        const playlist = data?.playlist;
        if (!playlist) return [];

        let tracks = playlist.tracks || [];
        const trackIds = playlist.trackIds || [];

        if (trackIds.length > tracks.length) {
            const ids = trackIds.map(t => t.id).join(',');
            const detail = await this.request('/song/detail', { ids });
            tracks = detail?.songs || tracks;
        }

        return tracks.map(t => this.normalizeSong(t)).filter(Boolean);
    }

    async album(id) {
        const data = await this.request('/album', { id });
        const songs = data?.songs || [];
        return songs.map(s => this.normalizeSong(s)).filter(Boolean);
    }

    async albumInfo(id) {
        const data = await this.request('/album', { id });
        const album = data?.album;
        if (!album) return null;
        return this.normalizeAlbum(album);
    }

    async playlistInfo(id) {
        const data = await this.request('/playlist/detail', { id });
        const playlist = data?.playlist;
        if (!playlist) return null;
        return this.normalizePlaylist(playlist);
    }

    async artistDetail(id) {
        const data = await this.request('/artist/detail', { id });
        const a = data?.data?.artist;
        if (!a) throw new Error('无法获取歌手信息');
        const alias = Array.isArray(a.alias)
            ? a.alias.filter(Boolean).join(' / ')
            : (typeof a.alias === 'string' ? a.alias : '');
        return {
            id: String(a.id ?? id),
            name: a.name ?? '',
            pic: a.cover ?? a.avatar ?? '',
            alias,
            briefDesc: a.briefDesc ?? '',
            albumSize: a.albumSize ?? 0,
            musicSize: a.musicSize ?? 0,
            mvSize: a.mvSize ?? 0,
        };
    }

    async artistSongs(id, { limit = 50, offset = 0 } = {}) {
        const data = await this.request('/artists', { id, limit, offset });
        const songs = (data?.hotSongs || []).map(s => this.normalizeSong(s)).filter(Boolean);
        return { songs };
    }

    async artistAlbums(id, { limit = 50, offset = 0 } = {}) {
        const data = await this.request('/artist/album', { id, limit, offset });
        const albums = (data?.hotAlbums || []).map(a => this.normalizeAlbum(a)).filter(Boolean);
        const total = data?.artist?.albumSize || albums.length;
        return { albums, total };
    }

    async searchUser(keyword, { limit = 30, offset = 0 } = {}) {
        const data = await this.request('/cloudsearch', {
            keywords: keyword,
            type: 1002,
            limit,
            offset,
        });
        const r = data?.result;
        if (!r) return { users: [], total: 0 };
        const users = (r.userprofiles || []).map(u => this.normalizeUser(u)).filter(Boolean);
        return { users, total: r.userprofileCount ?? users.length };
    }

    async userDetail(uid) {
        const data = await this.request('/user/detail', { uid });
        const profile = data?.profile;
        if (!profile) throw new Error('无法获取用户信息');
        return {
            uid: String(profile.userId ?? uid),
            nickname: profile.nickname ?? '',
            avatarUrl: profile.avatarUrl ?? '',
            signature: profile.signature ?? '',
            description: profile.description ?? '',
            playlistCount: profile.playlistCount ?? 0,
            followeds: profile.followeds ?? 0,
            follows: profile.follows ?? 0,
            level: profile.level ?? 0,
            listenSongs: profile.listenSongs ?? 0,
        };
    }

    async userPlaylists(uid) {
        const data = await this.request('/user/playlist', { uid });
        const playlists = (data?.playlist || []).map(p => this.normalizeUserPlaylist(p)).filter(Boolean);
        return { playlists, more: data?.more === true };
    }

    async playlistTrackAll(id, { limit = 500, offset = 0 } = {}) {
        const data = await this.request('/playlist/track/all', { id, limit, offset });
        const songs = (data?.songs || []).map(s => this.normalizeSong(s)).filter(Boolean);
        return { songs };
    }
}

export class Meting {
    constructor(cfg = config) {
        this.config = cfg;

        const backends = cfg.backends || {};
        const metingBase = backends.meting?.base ?? cfg.backend;
        const neteaseBase = backends.netease?.base ?? 'http://localhost:3000';

        this.adapters = {
            meting: new MetingAdapter(metingBase),
            netease: new NeteaseAdapter(neteaseBase),
        };

        this.services = cfg.services || {};
    }

    pick(feature) {
        const name = this.services[feature] || 'meting';
        const adapter = this.adapters[name];
        if (!adapter) throw new Error(`未知后端: ${name}`);
        return adapter;
    }

    async search(keyword, options = {}) {
        const adapter = this.pick('search');
        const searchType = options.searchType ?? 1;
        return adapter.search(keyword, { ...options, searchType });
    }

    async song(id, options = {}) {
        return this.pick('song').song(id, options);
    }

    async resolveAudio(song, quality) {
        if (!song?.id) throw new Error('歌曲缺少 ID');
        return this.pick('url').songUrl(song.id, quality);
    }

    async resolveLyric(song) {
        if (!song?.id) return '';
        return this.pick('lyric').lyric(song.id);
    }

    async resolveCover(song) {
        return song?.pic || '';
    }

    async playlist(id) {
        return this.pick('playlist').playlist(id);
    }

    async album(id) {
        return this.pick('album').album(id);
    }

    async albumInfo(id) {
        const adapter = this.pick('album');
        if (typeof adapter.albumInfo !== 'function') return null;
        return adapter.albumInfo(id);
    }

    async playlistInfo(id) {
        const adapter = this.pick('playlist');
        if (typeof adapter.playlistInfo === 'function') {
            try {
                const result = await adapter.playlistInfo(id);
                if (result) return result;
            } catch {}
        }
        const netease = this.adapters.netease;
        if (netease && typeof netease.playlistInfo === 'function') {
            try {
                const result = await netease.playlistInfo(id);
                if (result) return result;
            } catch {}
        }
        return null;
    }

    async artistDetail(id) {
        const adapter = this.pick('artist');
        if (typeof adapter.artistDetail !== 'function') throw new Error('当前后端不支持歌手详情');
        return adapter.artistDetail(id);
    }

    async artistSongs(id, options = {}) {
        const adapter = this.pick('artist');
        if (typeof adapter.artistSongs !== 'function') throw new Error('当前后端不支持歌手单曲');
        return adapter.artistSongs(id, options);
    }

    async artistAlbums(id, options = {}) {
        const adapter = this.pick('artist');
        if (typeof adapter.artistAlbums !== 'function') throw new Error('当前后端不支持歌手专辑');
        return adapter.artistAlbums(id, options);
    }

    async searchUser(keyword, options = {}) {
        return this.pick('user').searchUser(keyword, options);
    }

    async userDetail(uid) {
        return this.pick('user').userDetail(uid);
    }

    async userPlaylists(uid) {
        return this.pick('user').userPlaylists(uid);
    }

    async playlistTrackAll(id, options = {}) {
        return this.pick('user').playlistTrackAll(id, options);
    }

    async fetchAllPlaylistTracks(id, totalCount) {
        const adapter = this.pick('user');
        const pageSize = 500;
        const total = totalCount || 0;
        if (total <= 0) {
            const result = await adapter.playlistTrackAll(id, { limit: pageSize, offset: 0 });
            return result.songs;
        }
        const pages = Math.ceil(total / pageSize);
        const tasks = [];
        for (let i = 0; i < pages; i++) {
            tasks.push(adapter.playlistTrackAll(id, {
                limit: pageSize,
                offset: i * pageSize,
            }));
        }
        const results = await Promise.all(tasks);
        const all = [];
        for (const r of results) {
            if (r && r.songs) all.push(...r.songs);
        }
        return all;
    }

    getQualityLevels() {
        return this.config.quality.levels;
    }
}