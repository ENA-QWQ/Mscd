export const config = {
    backend: 'https://api.qijieya.cn/meting/',
    proxy: 'https://mscdownload.pages.dev/proxy?url=',

    backends: {
        meting: {
            base: 'https://api.qijieya.cn/meting/',
        },
        netease: {
            base: 'https://zm.wwoyun.cn/',
        },
    },

    services: {
        search: 'netease',
        song: 'meting',
        url: 'meting',
        lyric: 'meting',
        album: 'netease',
        playlist: 'meting',
        artist: 'netease',
        user: 'netease',
    },

    timeout: 15000,
    retry: {
        maxRetries: 3,
        baseDelay: 1000,
    },
    quality: {
        levels: [
            { id: 128, label: '标准' },
            { id: 192, label: '较高' },
            { id: 320, label: 'HQ' },
            { id: 2000, label: '无损' },
        ],
        default: 320,
        download: 320,
    },
    download: {
        concurrency: 3,
        retry: 3,
        retryDelay: 1000,
    },
    ui: {
        perPage: 50,
        themeColor: '',
    },
};