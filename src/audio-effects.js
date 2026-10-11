import { el } from './dom.js';
import { store } from './store.js';
import { openModal, Dropdown } from './components.js';

const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

const EQ_PRESETS = {
    '平直': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    '流行': [-1, -1, 0, 2, 4, 4, 2, 0, -1, -1],
    '摇滚': [5, 4, 2, 0, -1, -1, 1, 3, 4, 5],
    '爵士': [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
    '古典': [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
    '重低音': [8, 7, 5, 3, 1, 0, 0, 0, 0, 0],
    '高音增强': [0, 0, 0, 0, 0, 1, 3, 5, 7, 8],
    '人声': [-2, -3, -2, 1, 4, 4, 3, 1, 0, -1],
};

const DEFAULT_FX = {
    enabled: false,
    preamp: 0,
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bassBoost: 0,
    subBass: 0,
    compThreshold: 0,
    compRatio: 1,
    width: 1,
    surroundDecay: 1.5,
    surroundWet: 0,
};

const corsCache = new Map();

function dbToLinear(db) {
    return Math.pow(10, (Number(db) || 0) / 20);
}

function formatDb(v) {
    const n = Number(v) || 0;
    if (n > 0) return '+' + n + ' dB';
    return n + ' dB';
}

function formatSec(v) {
    return (Number(v) || 0).toFixed(2) + ' s';
}

function formatPct(v) {
    return Math.round((Number(v) || 0) * 100) + '%';
}

function formatNum2(v) {
    return (Number(v) || 0).toFixed(2);
}

function formatRatio(v) {
    return (Number(v) || 1).toFixed(1) + ' : 1';
}

export async function canUseCors(url) {
    let origin;
    try {
        origin = new URL(url).origin;
    } catch {
        return false;
    }
    if (corsCache.has(origin)) return corsCache.get(origin);

    try {
        const res = await fetch(url, {
            method: 'GET',
            mode: 'cors',
            headers: { Range: 'bytes=0-1' },
        });
        const ok = res.ok || res.status === 206;
        try { res.body && res.body.cancel && res.body.cancel(); } catch {}
        corsCache.set(origin, ok);
        return ok;
    } catch {
        corsCache.set(origin, false);
        return false;
    }
}

export class AudioEffects {
    constructor() {
        this.ctx = null;
        this.sourceNode = null;
        this.audioEl = null;
        this.nodes = null;
        this.built = false;
        this._lastIrKey = '';
    }

    attach(audioEl) {
        this.audioEl = audioEl;
    }

    ensureContext() {
        if (!this.ctx) {
            const Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor) return null;
            this.ctx = new Ctor();
        }
        if (this.ctx.state === 'suspended') {
            try { this.ctx.resume(); } catch {}
        }
        return this.ctx;
    }

    ensureChain() {
        if (this.built) return;
        if (!this.audioEl) return;

        const ctx = this.ensureContext();
        if (!ctx) return;

        let sourceNode;
        try {
            sourceNode = ctx.createMediaElementSource(this.audioEl);
        } catch {
            return;
        }
        this.sourceNode = sourceNode;

        const preGain = ctx.createGain();
        preGain.gain.value = 1;

        const eqNodes = [];
        let prev = preGain;
        for (const f of EQ_FREQS) {
            const eq = ctx.createBiquadFilter();
            eq.type = 'peaking';
            eq.frequency.value = f;
            eq.Q.value = 1;
            eq.gain.value = 0;
            prev.connect(eq);
            prev = eq;
            eqNodes.push(eq);
        }

        const subBass = ctx.createBiquadFilter();
        subBass.type = 'lowshelf';
        subBass.frequency.value = 50;
        subBass.gain.value = 0;
        prev.connect(subBass);
        prev = subBass;

        const bassBoost = ctx.createBiquadFilter();
        bassBoost.type = 'peaking';
        bassBoost.frequency.value = 120;
        bassBoost.Q.value = 1;
        bassBoost.gain.value = 0;
        prev.connect(bassBoost);
        prev = bassBoost;

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = 0;
        compressor.knee.value = 30;
        compressor.ratio.value = 1;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;
        prev.connect(compressor);
        prev = compressor;

        const splitter = ctx.createChannelSplitter(2);
        const merger = ctx.createChannelMerger(2);
        const gLL = ctx.createGain();
        const gRL = ctx.createGain();
        const gLR = ctx.createGain();
        const gRR = ctx.createGain();
        gLL.gain.value = 1;
        gRL.gain.value = 0;
        gLR.gain.value = 0;
        gRR.gain.value = 1;

        prev.connect(splitter);
        splitter.connect(gLL, 0);
        splitter.connect(gLR, 0);
        splitter.connect(gRL, 1);
        splitter.connect(gRR, 1);
        gLL.connect(merger, 0, 0);
        gRL.connect(merger, 0, 0);
        gLR.connect(merger, 0, 1);
        gRR.connect(merger, 0, 1);

        prev = merger;

        const convolver = ctx.createConvolver();
        const dryGain = ctx.createGain();
        const wetGain = ctx.createGain();
        dryGain.gain.value = 1;
        wetGain.gain.value = 0;

        prev.connect(dryGain);
        prev.connect(convolver);
        convolver.connect(wetGain);

        const postGain = ctx.createGain();
        dryGain.connect(postGain);
        wetGain.connect(postGain);

        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -1;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.001;
        limiter.release.value = 0.05;

        postGain.connect(limiter);
        limiter.connect(ctx.destination);

        sourceNode.connect(preGain);

        this.nodes = {
            preGain,
            eqNodes,
            subBass,
            bassBoost,
            compressor,
            splitter,
            merger,
            gLL, gRL, gLR, gRR,
            convolver,
            dryGain,
            wetGain,
            postGain,
            limiter,
        };
        this.built = true;
    }

    updateFromSettings() {
        if (!this.built) return;
        const fx = store.get().settings.audioEffects || {};
        this._applyPreamp(fx.preamp);
        this._applyEq(fx.bands);
        this._applySubBass(fx.subBass);
        this._applyBassBoost(fx.bassBoost);
        this._applyCompressor(fx.compThreshold, fx.compRatio);
        this._applyWidth(fx.width);
        this._applySurround(fx.surroundDecay, fx.surroundWet);
    }

    _applyPreamp(db) {
        this.nodes.preGain.gain.value = dbToLinear(db);
    }

    _applyEq(bands) {
        const arr = Array.isArray(bands) ? bands : [];
        for (let i = 0; i < this.nodes.eqNodes.length; i++) {
            const v = Number(arr[i]) || 0;
            this.nodes.eqNodes[i].gain.value = v;
        }
    }

    _applySubBass(db) {
        this.nodes.subBass.gain.value = Number(db) || 0;
    }

    _applyBassBoost(db) {
        this.nodes.bassBoost.gain.value = Number(db) || 0;
    }

    _applyCompressor(threshold, ratio) {
        this.nodes.compressor.threshold.value = Number(threshold) || 0;
        this.nodes.compressor.ratio.value = Math.max(1, Number(ratio) || 1);
    }

    _applyWidth(width) {
        const w = Number(width);
        if (!isFinite(w)) return;
        const a = (1 + w) / 2;
        const b = (1 - w) / 2;
        this.nodes.gLL.gain.value = a;
        this.nodes.gRL.gain.value = b;
        this.nodes.gLR.gain.value = b;
        this.nodes.gRR.gain.value = a;
    }

    _applySurround(decay, wet) {
        const wetV = Math.max(0, Math.min(1, Number(wet) || 0));
        const decayV = Math.max(0.1, Math.min(4, Number(decay) || 1.5));

        this.nodes.dryGain.gain.value = 1 - wetV * 0.5;
        this.nodes.wetGain.gain.value = wetV * 0.9;

        if (wetV > 0) {
            const key = decayV.toFixed(2);
            if (this._lastIrKey !== key) {
                this._lastIrKey = key;
                this._makeIR(decayV).then((buf) => {
                    if (this.nodes && this.nodes.convolver) {
                        this.nodes.convolver.buffer = buf;
                    }
                }).catch(() => {});
            }
        }
    }

    _makeIR(decaySec) {
        const ctx = this.ctx;
        const rate = ctx.sampleRate;
        const len = Math.floor(rate * decaySec);
        const buf = ctx.createBuffer(2, len, rate);
        for (let ch = 0; ch < 2; ch++) {
            const data = buf.getChannelData(ch);
            for (let i = 0; i < len; i++) {
                const t = i / len;
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.5);
            }
        }
        return Promise.resolve(buf);
    }
}

function addSlider(parent, label, value, min, max, step, format, onChange) {
    const group = el('div', { class: 'setting-group' });
    const labelEl = el('div', {
        class: 'setting-label',
        text: `${label}：${format(value)}`,
    });
    const range = el('input', {
        type: 'range',
        class: 'ena-range',
        min: String(min),
        max: String(max),
        step: String(step),
        value: String(value),
    });
    range.addEventListener('input', () => {
        labelEl.textContent = `${label}：${format(Number(range.value))}`;
    });
    range.addEventListener('change', () => {
        onChange(Number(range.value));
    });
    group.appendChild(labelEl);
    group.appendChild(range);
    parent.appendChild(group);

    const setValue = (v) => {
        range.value = String(v);
        labelEl.textContent = `${label}：${format(v)}`;
    };

    return { group, range, labelEl, setValue };
}

export function openAudioEffectsModal(ctx) {
    const body = el('div', { class: 'audio-fx' });
    const leftCol = el('div', { class: 'audio-fx__col' });
    const rightCol = el('div', { class: 'audio-fx__col' });

    const resetHandlers = [];

    function getFx() {
        return store.get().settings.audioEffects || {};
    }

    function updateFx(patch) {
        const s = store.get().settings;
        const fx = { ...(s.audioEffects || {}), ...patch };
        store.update({ settings: { ...s, audioEffects: fx } });
        store.persist();
        if (ctx.player.audioEffects) {
            ctx.player.audioEffects.updateFromSettings();
        }
    }

    const enableGroup = el('div', { class: 'setting-group' });
    const enableRow = el('div', { class: 'audio-fx__enable-row' });

    const enableCb = el('input', { type: 'checkbox' });
    enableCb.checked = !!getFx().enabled;
    enableCb.addEventListener('change', () => {
        const enabled = enableCb.checked;
        updateFx({ enabled });
        if (enabled && ctx.player.audioEffects) {
            ctx.player.audioEffects.ensureChain();
            ctx.player.audioEffects.updateFromSettings();
        }
    });

    enableRow.appendChild(el('label', { class: 'ena-checkbox' },
        enableCb,
        el('span', { class: 'box' }),
        el('span', { text: '启用音频效果' })
    ));

    const resetBtn = el('button', {
        class: 'ena-btn ena-btn--sm',
        type: 'button',
        text: '恢复默认',
    });
    resetBtn.addEventListener('click', () => {
        const keepEnabled = !!enableCb.checked;
        updateFx({ ...DEFAULT_FX, enabled: keepEnabled });
        for (const fn of resetHandlers) {
            try { fn(); } catch {}
        }
    });
    enableRow.appendChild(resetBtn);

    enableGroup.appendChild(enableRow);
    leftCol.appendChild(enableGroup);

    const preampRef = addSlider(leftCol, '前级增益', getFx().preamp ?? 0, -12, 12, 1, formatDb,
        (v) => updateFx({ preamp: v }));
    resetHandlers.push(() => preampRef.setValue(DEFAULT_FX.preamp));

    const bassBoostRef = addSlider(leftCol, 'Bass Boost', getFx().bassBoost ?? 0, -12, 12, 1, formatDb,
        (v) => updateFx({ bassBoost: v }));
    resetHandlers.push(() => bassBoostRef.setValue(DEFAULT_FX.bassBoost));

    const subBassRef = addSlider(leftCol, 'Sub Bass', getFx().subBass ?? 0, -12, 12, 1, formatDb,
        (v) => updateFx({ subBass: v }));
    resetHandlers.push(() => subBassRef.setValue(DEFAULT_FX.subBass));

    const widthGroup = el('div', { class: 'setting-group' });
    const widthLabelEl = el('div', {
        class: 'setting-label',
        text: `声场宽度：${formatNum2(getFx().width ?? 1)}`,
    });
    const widthRange = el('input', {
        type: 'range',
        class: 'ena-range',
        min: '0',
        max: '2',
        step: '0.05',
        value: String(getFx().width ?? 1),
    });
    widthRange.addEventListener('input', () => {
        widthLabelEl.textContent = `声场宽度：${formatNum2(Number(widthRange.value))}`;
    });
    widthRange.addEventListener('change', () => {
        updateFx({ width: Number(widthRange.value) });
    });
    widthGroup.appendChild(widthLabelEl);
    widthGroup.appendChild(widthRange);
    leftCol.appendChild(widthGroup);
    resetHandlers.push(() => {
        widthRange.value = String(DEFAULT_FX.width);
        widthLabelEl.textContent = `声场宽度：${formatNum2(DEFAULT_FX.width)}`;
    });

    const decayRef = addSlider(leftCol, '环绕衰减', getFx().surroundDecay ?? 1.5, 0.2, 4, 0.1, formatSec,
        (v) => updateFx({ surroundDecay: v }));
    resetHandlers.push(() => decayRef.setValue(DEFAULT_FX.surroundDecay));

    const wetRef = addSlider(leftCol, '环绕湿度', getFx().surroundWet ?? 0, 0, 1, 0.01, formatPct,
        (v) => updateFx({ surroundWet: v }));
    resetHandlers.push(() => wetRef.setValue(DEFAULT_FX.surroundWet));

    const compThresholdRef = addSlider(leftCol, '压缩阈值', getFx().compThreshold ?? 0, -60, 0, 1,
        (v) => (Number(v)).toFixed(0) + ' dB',
        (v) => updateFx({ compThreshold: v }));
    resetHandlers.push(() => compThresholdRef.setValue(DEFAULT_FX.compThreshold));

    const compRatioRef = addSlider(leftCol, '压缩比', getFx().compRatio ?? 1, 1, 20, 0.5, formatRatio,
        (v) => updateFx({ compRatio: v }));
    resetHandlers.push(() => compRatioRef.setValue(DEFAULT_FX.compRatio));

    const eqGroup = el('div', { class: 'setting-group' });
    eqGroup.appendChild(el('div', { class: 'setting-label', text: '均衡器' }));

    const presetRow = el('div', { class: 'audio-fx__preset-row' });

    const presetOptions = [
        { value: '', label: '自定义' },
        ...Object.keys(EQ_PRESETS).map((name) => ({ value: name, label: name })),
    ];

    const bandRanges = [];
    const bandVals = [];

    const presetDropdown = Dropdown({
        options: presetOptions,
        value: '',
        title: '均衡器预设',
        className: 'audio-fx__preset',
        onChange: (name) => {
            if (!name) return;
            const preset = EQ_PRESETS[name];
            if (!preset) return;
            updateFx({ bands: preset.slice() });
            for (let i = 0; i < 10; i++) {
                bandRanges[i].value = String(preset[i]);
                bandVals[i].textContent = formatDb(preset[i]);
            }
        },
    });
    presetRow.appendChild(presetDropdown.node);
    eqGroup.appendChild(presetRow);

    const bandsWrap = el('div', { class: 'audio-fx__eq-bands' });

    for (let i = 0; i < 10; i++) {
        const cur = getFx().bands?.[i] ?? 0;
        const bandEl = el('div', { class: 'audio-fx__eq-band' });
        const valEl = el('span', { class: 'audio-fx__eq-value', text: formatDb(cur) });
        const range = el('input', {
            type: 'range',
            class: 'ena-range audio-fx__eq-range',
            min: '-12',
            max: '12',
            step: '1',
            value: String(cur),
        });
        const labelEl = el('span', { class: 'audio-fx__eq-label', text: EQ_LABELS[i] });

        range.addEventListener('input', () => {
            valEl.textContent = formatDb(Number(range.value));
        });
        range.addEventListener('change', () => {
            const bands = [...(getFx().bands || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0])];
            bands[i] = Number(range.value);
            updateFx({ bands });
            presetDropdown.update('');
        });

        bandEl.appendChild(valEl);
        bandEl.appendChild(range);
        bandEl.appendChild(labelEl);
        bandsWrap.appendChild(bandEl);

        bandRanges.push(range);
        bandVals.push(valEl);
    }

    resetHandlers.push(() => {
        presetDropdown.update('');
        for (let i = 0; i < 10; i++) {
            const v = DEFAULT_FX.bands[i];
            bandRanges[i].value = String(v);
            bandVals[i].textContent = formatDb(v);
        }
    });

    eqGroup.appendChild(bandsWrap);
    rightCol.appendChild(eqGroup);

    body.appendChild(leftCol);
    body.appendChild(rightCol);

    openModal({
        title: '音频效果',
        body,
        showCancel: false,
        confirmText: '完成',
    });
}