import { config } from '../config.js';

const CARD_W = 1080;
const CARD_H = 1320;
const PADDING = 60;

function tryLoadImage(url, timeout = 10000) {
    return new Promise((resolve, reject) => {
        if (!url) {
            reject(new Error('缺少图片地址'));
            return;
        }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            reject(new Error('图片加载超时'));
        }, timeout);
        img.onload = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(img);
        };
        img.onerror = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            reject(new Error('图片加载失败'));
        };
        img.src = url;
    });
}

async function loadCover(song) {
    const original = song.pic || '';
    const proxied = original && config.proxy
        ? config.proxy + encodeURIComponent(original)
        : '';

    if (proxied) {
        try { return await tryLoadImage(proxied); } catch {}
    }
    if (original && original !== proxied) {
        try { return await tryLoadImage(original); } catch {}
    }
    return null;
}

function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
}

function truncateText(ctx, text, maxWidth) {
    if (!text) return '';
    if (ctx.measureText(text).width <= maxWidth) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const sub = text.slice(0, mid) + '…';
        if (ctx.measureText(sub).width <= maxWidth) lo = mid;
        else hi = mid - 1;
    }
    return text.slice(0, lo) + '…';
}

export function sanitizeFilename(name) {
    return String(name || '')
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

function drawCoverContain(ctx, img, x, y, w, h) {
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

export async function renderShareCard(song, options = {}) {
    const username = options.username || '匿名用户';
    const shareUrl = options.shareUrl
        || (window.location.origin + window.location.pathname + '#/song/' + encodeURIComponent(song.id || ''));

    const title = String(song.title || '未知歌曲');
    const artist = String(song.artist || '未知歌手');
    const album = String(song.album || '');

    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');

    const coverImg = await loadCover(song);

    try {
        await Promise.all([
            document.fonts.load('400 46px "LXGW WenKai Light"'),
            document.fonts.load('700 84px "LXGW WenKai Light"'),
        ]);
    } catch {}
    try {
        await document.fonts.ready;
    } catch {}

    if (coverImg) {
        ctx.save();
        ctx.filter = 'blur(70px)';
        drawCoverContain(ctx, coverImg, -120, -120, CARD_W + 240, CARD_H + 240);
        ctx.restore();
    } else {
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, CARD_W, CARD_H);
    }

    const grad = ctx.createLinearGradient(0, 0, 0, CARD_H);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.62)');
    grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.5)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.74)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = '400 36px "LXGW WenKai Light", system-ui, sans-serif';
    ctx.fillText(`由 ${username} 分享：`, PADDING, 80);

    const coverSize = 780;
    const coverX = (CARD_W - coverSize) / 2;
    const coverY = 160;
    const coverBottom = coverY + coverSize;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 60;
    ctx.shadowOffsetY = 22;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    roundRectPath(ctx, coverX, coverY, coverSize, coverSize, 28);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRectPath(ctx, coverX, coverY, coverSize, coverSize, 28);
    ctx.clip();
    if (coverImg) {
        drawCoverContain(ctx, coverImg, coverX, coverY, coverSize, coverSize);
    } else {
        ctx.fillStyle = '#2b2b2b';
        ctx.fillRect(coverX, coverY, coverSize, coverSize);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '400 200px "LXGW WenKai Light", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('♪', coverX + coverSize / 2, coverY + coverSize / 2);
    }
    ctx.restore();

    const qrSize = 160;
    const qrPadding = 14;
    const qrBoxSize = qrSize + qrPadding * 2;
    const qrBoxX = CARD_W - PADDING - qrBoxSize;

    const infoX = PADDING;
    const infoMaxWidth = qrBoxX - PADDING - 40;

    const infoBlockCenterY = 1120;
    const titleY = infoBlockCenterY - 60;
    const subY = infoBlockCenterY + 60;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    ctx.font = '700 84px "LXGW WenKai Light", system-ui, sans-serif';
    const displayTitle = truncateText(ctx, title, infoMaxWidth);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(displayTitle, infoX, titleY);

    const subText = album ? `${artist} - ${album}` : artist;
    ctx.font = '400 46px "LXGW WenKai Light", system-ui, sans-serif';
    const displaySub = truncateText(ctx, subText, infoMaxWidth);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillText(displaySub, infoX, subY);

    const qrBoxY = infoBlockCenterY - qrBoxSize / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
    roundRectPath(ctx, qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 16);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    if (typeof window.qrcode === 'function') {
        const qr = window.qrcode(0, 'M');
        qr.addData(shareUrl);
        qr.make();
        const count = qr.getModuleCount();
        const cellSize = qrSize / count;
        ctx.fillStyle = '#000000';
        for (let r = 0; r < count; r++) {
            for (let c = 0; c < count; c++) {
                if (!qr.isDark(r, c)) continue;
                const x = qrBoxX + qrPadding + c * cellSize;
                const y = qrBoxY + qrPadding + r * cellSize;
                ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(cellSize), Math.ceil(cellSize));
            }
        }
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = '400 28px "LXGW WenKai Light", system-ui, sans-serif';
    ctx.fillText('扫码听歌', qrBoxX + qrBoxSize / 2, qrBoxY + qrBoxSize + 34);

    return new Promise((resolve, reject) => {
        try {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('图片生成失败'));
            }, 'image/png', 0.95);
        } catch (err) {
            reject(err);
        }
    });
}