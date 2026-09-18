# MSCD

一个现代化的、基于纯前端与 Cloudflare Pages 的 Meting API 播放与下载器。

> 本项目定位为“基于 Meting API 的UI界面”。不提供任何音乐存储与搜索服务，所有数据来源于用户自行配置的第三方 API。

## 🌐 在线演示
https://mscdownload.pages.dev/

## ✨ 特性

- **零构建步骤**：原生 ES Modules，无需 Webpack/Vite，克隆即用。
- **极简部署**：完美适配 Cloudflare Pages + Pages Functions（边缘代理）。
- **现代 UI/UX**：响应式设计，支持桌面端与移动端，内置深色模式与自定义主题色。
- **强大的下载能力**：
    - 浏览器端多线程切片下载。
    - 批量下载打包 ZIP。
    - 本地写入 ID3 (MP3) 与 Vorbis Comment (FLAC) 标签，自动嵌入专辑封面与歌词。
    - 支持 File System Access API。
- **无后端架构**：完全依赖第三方 Meting API 和 Cloudflare Functions 代理。

## 🏗️ 架构

- **前端**：原生 HTML/CSS/JS ，部署于 Cloudflare Pages。
- **代理层**：`functions/proxy.js`，负责转发音频下载请求并处理 CORS。
- **API 后端**：由用户自行准备并部署的 Meting API 兼容接口。

## 💻 本地开发

由于没有构建步骤，你可以直接使用 Python 或 Node 启动一个静态服务器：

使用 Python：
`python -m http.server 8080`

或者使用 Cloudflare Wrangler（推荐，可同时测试 Functions）：
`npx wrangler pages dev . --port 8080`

然后在浏览器中打开 `http://localhost:8080` 即可。

## ⚠️ 免责声明

1. **仅供学习交流**：本项目仅供前端技术学习与交流（Web API 调用、流式传输、音频标签处理），**严禁用于任何商业用途或大规模公开提供服务**。
2. **数据来源**：本项目不提供任何音乐存储与搜索服务。所有数据均来源于用户自行配置的第三方 Meting API。
3. **版权声明**：请尊重音乐版权。因使用本项目产生的任何版权纠纷、流量费用及法律风险，与本项目作者无关。

## 📄 License
MIT License