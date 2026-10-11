import fs from 'node:fs';

const FILE = 'styles.css';

const rules = [
    {
        name: ':root 结构层实色化（保留原始观感）',
        find: `    --bg-top: rgba(232, 232, 232, .92);
    --bg-side: rgba(245, 245, 245, .94);
    --bg-player: rgba(232, 232, 232, .92);
    --bg-input: rgba(255, 255, 255, .7);
    --bg-menu: #ffffff;
    --bg-float: #f5f5f5;
    --border-line: #2d2d2d;`,
        replace: `    --bg-top: #e6e6e6;
    --bg-side: #f0f0f0;
    --bg-player: #e6e6e6;
    --bg-input: #ffffff;
    --bg-menu: #ffffff;
    --bg-float: #f5f5f5;
    --border-line: #2d2d2d;`,
    },
    {
        name: ':root 表面层实色化',
        find: `    --bg-surface: rgba(255, 255, 255, 0.55);
    --bg-surface-hover: rgba(255, 255, 255, 0.75);`,
        replace: `    --bg-surface: #f5f5f5;
    --bg-surface-hover: #ededed;`,
    },
    {
        name: 'body 去背景图（保留 body::before 遮罩）',
        find: `    -webkit-font-smoothing: antialiased;
    background: url(imgs/bg.webp) center / cover fixed;
    background-color: var(--bg-page, #f0f0f0);`,
        replace: `    -webkit-font-smoothing: antialiased;
    background-color: var(--bg-page, #f0f0f0);`,
    },
    {
        name: '.top-bar 去毛玻璃',
        find: `    padding: 0 16px;
    background: var(--bg-top);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    overflow: hidden;
    --bg-input: var(--bg-top);`,
        replace: `    padding: 0 16px;
    background: var(--bg-top);
    overflow: hidden;
    --bg-input: var(--bg-top);`,
    },
    {
        name: '.sidebar 去毛玻璃',
        find: `    background: var(--bg-side);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    overflow-y: auto;`,
        replace: `    background: var(--bg-side);
    overflow-y: auto;`,
    },
    {
        name: '.side-nav a[data-tree].is-expanded 第一处 去毛玻璃',
        find: `    z-index: 100;
    background-color: var(--bg-side);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    box-shadow: 0 1px 0 var(--border-faint);`,
        replace: `    z-index: 100;
    background-color: var(--bg-side);
    box-shadow: 0 1px 0 var(--border-faint);`,
    },
    {
        name: '.side-nav a[data-tree].is-expanded 第二处 去毛玻璃',
        find: `    z-index: 100;
    background-color: var(--bg-side);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
}`,
        replace: `    z-index: 100;
    background-color: var(--bg-side);
}`,
    },
    {
        name: '.player-bar 去毛玻璃',
        find: `    padding: 12px 20px 8px;
    background: var(--bg-player);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    overflow: visible;`,
        replace: `    padding: 12px 20px 8px;
    background: var(--bg-player);
    overflow: visible;`,
    },
    {
        name: '.multi-select-bar 桌面 去毛玻璃',
        find: `    padding: 0 20px;
    background: var(--bg-player);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    clip-path: inset(100% 0 0 0);`,
        replace: `    padding: 0 20px;
    background: var(--bg-player);
    clip-path: inset(100% 0 0 0);`,
    },
    {
        name: '.multi-select-bar 移动端 去毛玻璃',
        find: `        background: var(--bg-player);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        overflow-x: auto;`,
        replace: `        background: var(--bg-player);
        overflow-x: auto;`,
    },
    {
        name: 'MV 模式移动端播放栏实色化',
        find: `        background: rgba(18, 18, 18, .35);
        backdrop-filter: blur(20px) saturate(1.5);
        -webkit-backdrop-filter: blur(20px) saturate(1.5);
        --text-primary: #f5f5f5;`,
        replace: `        background: #1a1a1a;
        --text-primary: #f5f5f5;`,
    },
    {
        name: 'body.mv-web-fullscreen .player-bar 实色化',
        find: `    background: rgba(18, 18, 18, .35);
    backdrop-filter: blur(20px) saturate(1.5);
    -webkit-backdrop-filter: blur(20px) saturate(1.5);
    transition:
            background .3s ease,
            backdrop-filter .3s ease,
            -webkit-backdrop-filter .3s ease,
            clip-path .3s var(--ease);`,
        replace: `    background: #1a1a1a;
    transition: background .3s ease, clip-path .3s var(--ease);`,
    },
    {
        name: 'body.mv-web-fullscreen .playback-overlay__top 实色化',
        find: `    padding: 6px 14px;
    background: rgba(18, 18, 18, .35);
    backdrop-filter: blur(20px) saturate(1.5);
    -webkit-backdrop-filter: blur(20px) saturate(1.5);
}`,
        replace: `    padding: 6px 14px;
    background: #1a1a1a;
}`,
    },
];

const raw = fs.readFileSync(FILE, 'utf8');
const usesCRLF = raw.includes('\r\n');
let content = raw.replace(/\r\n/g, '\n');

console.log(`文件大小 ${raw.length}，换行符 ${usesCRLF ? 'CRLF' : 'LF'}`);

let ok = 0;
let miss = 0;

for (const rule of rules) {
    if (content.includes(rule.find)) {
        content = content.split(rule.find).join(rule.replace);
        console.log(`[OK]   ${rule.name}`);
        ok++;
    } else {
        console.log(`[SKIP] ${rule.name}  —— 未找到`);
        miss++;
    }
}

if (content === raw.replace(/\r\n/g, '\n')) {
    console.log(`\n没有任何改动。命中 ${ok} / ${rules.length}。`);
    process.exit(0);
}

const output = usesCRLF ? content.replace(/\n/g, '\r\n') : content;
fs.writeFileSync(FILE, output, 'utf8');
console.log(`\n完成：命中 ${ok} / ${rules.length}，未命中 ${miss}。`);
console.log(`原文件大小 ${raw.length} → 新文件大小 ${output.length}`);