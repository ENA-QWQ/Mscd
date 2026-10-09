export const config = {
    backend: 'https://api.qijieya.cn/meting/',
    proxy: 'https://mscdownload.legspcpd.asia/proxy?url=',

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
        playlist: 'netease',
        artist: 'netease',
        user: 'netease',
        mv: 'netease',
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

    about: {
        version: '2026-10-05',
        content: `
感谢使用本项目！如果有什么问题或者建议的新功能，您可以：

- 加入MSCD用户QQ群：**1128651874**
- 联系站长QQ：**409894128**

站长主页：[Ena](https://enashpinal.pages.dev)
项目地址：[ENA-QWQ/MSCD](https://github.com/ENA-QWQ/MSCD)

## 声明

- **本项目仅用于前端技术学习，严禁用于任何商业用途或大规模公开提供服务。**
- **请尊重音乐版权。因使用本项目产生的任何版权纠纷、流量费用及法律风险，与本项目作者无关。**
`,
    },
};