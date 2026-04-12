import { GALAXY_COLORMAPS, DEFAULT_CMAP_INDEX, GALAXY_TYPES, CAMERA_PRESETS, CINEMA_PATHS } from './constants.js';
import { downloadBlob } from './utils.js';
import { state } from './state.js';
import { camera, controls, setCameraFromPreset, applyPerformancePreset } from './renderer.js';
import {
    galaxyGeo, galaxyMat, buildGalaxy, refreshCurrentGalaxyColors,
    updateGalaxyDrawRange, applyGalaxyScaleAndFlatness, applyGalaxyInclination,
} from './galaxy.js';
import { haloGeo, haloMat, nebulaGeo, nebulaMat } from './nebula.js';
import { starGeo, starMat } from './stars.js';
import { scatterGeo } from './scatter.js';
import { hideLightning } from './lightning.js';
import { loadAudioFile, updateAudioGain, seekTo, toggleAudioPlayback, stopAudioPlayback, setLoopEnabled, setLoopRegion, setLoopBars, setDetectedBpm } from './audio.js';

// ── Helper: build a button-grid replacing a <select> ──
function enhanceSelectAsButtonGrid(selectId, valueId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.classList.add('select-as-grid');
    let grid = select.nextElementSibling;
    if (!grid || !grid.classList.contains('option-grid')) {
        grid = document.createElement('div');
        grid.className = 'option-grid';
        select.insertAdjacentElement('afterend', grid);
    }
    const options = Array.from(select.options)
        .map(opt => ({ value: opt.value, label: opt.textContent.trim() }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
    grid.innerHTML = '';
    const buttons = [];
    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cmap-btn';
        btn.textContent = opt.label;
        btn.dataset.value = opt.value;
        btn.addEventListener('click', () => {
            if (select.value !== opt.value) {
                select.value = opt.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            } else { sync(); }
        });
        grid.appendChild(btn);
        buttons.push(btn);
    });
    function sync() {
        buttons.forEach(btn => btn.classList.toggle('active', btn.dataset.value === select.value));
        if (valueId) {
            const valueEl  = document.getElementById(valueId);
            const selected = Array.from(select.options).find(o => o.value === select.value);
            if (valueEl && selected) valueEl.textContent = selected.textContent.trim();
        }
    }
    select.addEventListener('change', sync);
    sync();
}

// ── Collapsible section toggles ──
function setupSectionToggle(toggleRowId, bodyId, arrowId, startCollapsed = false) {
    const toggleRow = document.getElementById(toggleRowId);
    const body      = document.getElementById(bodyId);
    const arrow     = document.getElementById(arrowId);
    if (!toggleRow || !body || !arrow) return;
    body.classList.toggle('collapsed', startCollapsed);
    arrow.classList.toggle('open', !startCollapsed);
    toggleRow.addEventListener('click', () => {
        const isCollapsed = body.classList.toggle('collapsed');
        arrow.classList.toggle('open', !isCollapsed);
    });
}

// ── Audio ──
const loadBtn      = document.getElementById('load-btn');
const playBtn      = document.getElementById('play-btn');
const loopBtn      = document.getElementById('loop-btn');
const audioNameEl  = document.getElementById('audio-name');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue  = document.getElementById('volume-value');
const muteToggle   = document.getElementById('mute-toggle');
const muteValue    = document.getElementById('mute-value');

function syncMuteUI() {
    muteToggle.checked = state.isMuted;
    muteValue.textContent = state.isMuted ? 'On' : 'Off';
}

volumeSlider.addEventListener('input', (e) => {
    volumeValue.textContent = e.target.value + '%';
    updateAudioGain();
});
muteToggle.addEventListener('change', (e) => {
    state.isMuted = e.target.checked;
    syncMuteUI();
    updateAudioGain();
});
syncMuteUI();

loadBtn.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'audio/*';
    inp.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
    document.body.appendChild(inp);
    inp.addEventListener('change', async (e) => {
        const f = e.target.files[0];
        document.body.removeChild(inp);
        if (f) await loadAudioFile(f);
    });
    inp.addEventListener('cancel', () => document.body.removeChild(inp));
    inp.click();
});

function syncPlayButtonUI() {
    playBtn.textContent = state.isPlaying ? '⏸ Pause' : '▶ Play';
    playBtn.className = state.isPlaying ? 'pause' : 'play';
    playBtn.disabled = !state.audioLoaded;
    if (loopBtn) loopBtn.disabled = !state.audioLoaded;
}

playBtn.addEventListener('click', async () => {
    if (!state.audioLoaded) return;
    await toggleAudioPlayback();
});

window.addEventListener('audio-playstate', (e) => {
    state.isPlaying = !!e.detail?.isPlaying;
    syncPlayButtonUI();
});
window.addEventListener('audio-loaded', (e) => {
    playBtn.disabled = false;
    if (loopBtn) loopBtn.disabled = false;
    audioNameEl.textContent = e.detail?.fileName || state.audioFileName || 'Loaded audio';
    syncPlayButtonUI();
});
window.addEventListener('audio-volume', () => {
    volumeValue.textContent = `${volumeSlider.value}%`;
    syncMuteUI();
});

syncPlayButtonUI();

// ── Progress bar scrubbing ──
const progressBar = document.getElementById('progress-bar');
let isScrubbing = false;
function scrubTo(clientX) {
    if (!state.audioLoaded || !state.audioElement) return;
    const rect = progressBar.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    seekTo(pct * state.audioElement.duration);
}
progressBar.addEventListener('mousedown', (e) => { isScrubbing = true; scrubTo(e.clientX); e.preventDefault(); });
progressBar.addEventListener('touchstart', (e) => { isScrubbing = true; scrubTo(e.touches[0].clientX); }, { passive: true });
document.addEventListener('mousemove',  (e) => { if (isScrubbing) scrubTo(e.clientX); });
document.addEventListener('touchmove',  (e) => { if (isScrubbing) scrubTo(e.touches[0].clientX); }, { passive: true });
document.addEventListener('mouseup',   () => { isScrubbing = false; });
document.addEventListener('touchend',  () => { isScrubbing = false; });


// ── Loop / BPM modal ──
const loopUi = {
    root: null,
    backdrop: null,
    fileName: null,
    waveWrap: null,
    waveCanvas: null,
    waveCtx: null,
    minimapWrap: null,
    minimapCanvas: null,
    minimapCtx: null,
    progressWrap: null,
    progressFill: null,
    progressGhost: null,
    playhead: null,
    leftHandle: null,
    rightHandle: null,
    leftTag: null,
    rightTag: null,
    currentTime: null,
    totalTime: null,
    zoomLevel: null,
    bpmInput: null,
    barsInput: null,
    loopSwitch: null,
    volumeSlider: null,
    volumePct: null,
    loopInfo: null,
    statRate: null,
    statDur: null,
    statChannels: null,
    statLoop: null,
    statBeat: null,
    playBtn: null,
    stopBtn: null,
    zoomStart: 0,
    zoomEnd: 0,
    peaks: null,
    waveW: 0,
    waveH: 0,
    miniW: 0,
    miniH: 0,
    dragging: null,
    dragX0: 0,
    dragStartVal: 0,
    dragMoved: false,
};

function fmtLoopTime(seconds, precision = 3) {
    if (!Number.isFinite(seconds)) return '0:00.000';
    const s = Math.max(0, seconds);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toFixed(precision).padStart(6, '0')}`;
}

function getLoopBeatDuration() {
    return state.detectedBpm > 0 ? 60 / state.detectedBpm : 0;
}

function getLoopBarDuration() {
    const beat = getLoopBeatDuration();
    return beat > 0 ? beat * 4 : 0;
}

function ensureLoopModal() {
    if (loopUi.root) return;
    const backdrop = document.createElement('div');
    backdrop.id = 'loop-modal-backdrop';
    backdrop.innerHTML = `
        <div class="loop-modal" role="dialog" aria-modal="true" aria-label="Loop and BPM editor">
            <div class="loop-modal-header">
                <div class="loop-modal-title-wrap">
                    <div class="loop-modal-title">Loop Detective</div>
                    <div class="loop-modal-subtitle" id="loop-modal-file-name">No file loaded</div>
                </div>
                <button type="button" class="secondary-btn loop-modal-close" id="loop-modal-close">×</button>
            </div>
            <div class="loop-modal-body">
                <div class="loop-wave-block">
                    <div class="loop-wave-header">
                        <div class="loop-wave-label">Waveform — Loop Region</div>
                        <div class="loop-zoom-controls">
                            <button type="button" class="loop-zoom-btn" id="loop-zoom-out">−</button>
                            <span class="loop-zoom-level" id="loop-zoom-level">1×</span>
                            <button type="button" class="loop-zoom-btn" id="loop-zoom-in">+</button>
                            <button type="button" class="loop-zoom-btn loop-zoom-fit" id="loop-zoom-fit">FIT</button>
                        </div>
                    </div>
                    <div class="loop-wave-wrap" id="loop-wave-wrap">
                        <div class="loop-wave-clip">
                            <canvas id="loop-wave-canvas"></canvas>
                            <div class="loop-playhead" id="loop-playhead"></div>
                        </div>
                        <div class="loop-handle" id="loop-handle-left"><div class="loop-handle-tag" id="loop-tag-left">0:00.000</div><div class="loop-handle-knob"></div></div>
                        <div class="loop-handle" id="loop-handle-right"><div class="loop-handle-tag" id="loop-tag-right">0:00.000</div><div class="loop-handle-knob"></div></div>
                    </div>
                    <div class="loop-minimap-wrap" id="loop-minimap-wrap"><canvas id="loop-minimap-canvas"></canvas></div>
                    <div class="loop-progress-wrap" id="loop-progress-wrap">
                        <div class="loop-progress-fill" id="loop-progress-fill"></div>
                        <div class="loop-progress-ghost" id="loop-progress-ghost"></div>
                    </div>
                    <div class="loop-time-row">
                        <span id="loop-current-time">0:00.000</span>
                        <span id="loop-total-time">0:00.000</span>
                    </div>
                </div>
                <div class="loop-controls-grid">
                    <div class="loop-card">
                        <div class="loop-card-label">Transport</div>
                        <div class="loop-transport-row">
                            <button type="button" class="loop-transport-btn" id="loop-play-toggle">▶ Play</button>
                            <button type="button" class="loop-transport-btn" id="loop-stop-btn">■ Stop</button>
                        </div>
                        <div class="loop-switch-row">
                            <button type="button" class="loop-switch" id="loop-enabled-switch" aria-pressed="false"></button>
                            <span class="loop-switch-text">Loop Active</span>
                        </div>
                        <div class="loop-volume-row">
                            <button type="button" class="loop-mini-btn" id="loop-mute-btn">🔊</button>
                            <div class="loop-vol-slider-wrap"><input id="loop-volume-slider" class="loop-vol-slider" type="range" min="0" max="100" value="100"></div>
                            <span class="loop-vol-pct" id="loop-volume-pct">100%</span>
                        </div>
                    </div>
                    <div class="loop-card">
                        <div class="loop-card-label">Detected Tempo</div>
                        <div class="loop-bpm-row">
                            <input id="loop-bpm-input" class="loop-bpm-input" type="number" min="40" max="300" value="120">
                            <span class="loop-bpm-unit">BPM</span>
                        </div>
                        <div class="loop-small-text">Editable. Beat snapping follows this tempo.</div>
                    </div>
                    <div class="loop-card">
                        <div class="loop-card-label">Loop Length</div>
                        <div class="loop-bars-row">
                            <div class="loop-stepper">
                                <button type="button" class="loop-mini-btn" id="loop-bars-dec">−</button>
                                <input id="loop-bars-input" class="loop-bars-input" type="number" min="1" max="999" value="4">
                                <span class="loop-bars-unit">bars</span>
                                <button type="button" class="loop-mini-btn" id="loop-bars-inc">+</button>
                            </div>
                        </div>
                        <div class="loop-loop-info" id="loop-loop-info">—</div>
                    </div>
                </div>
                <div class="loop-status-bar" id="loop-status-bar">
                    <div>Rate: <b id="loop-stat-rate">—</b></div>
                    <div>Duration: <b id="loop-stat-dur">—</b></div>
                    <div>Channels: <b id="loop-stat-ch">—</b></div>
                    <div>Loop: <b id="loop-stat-loop">—</b></div>
                    <div>Beat: <b id="loop-stat-beat">—</b></div>
                </div>
            </div>
        </div>`;
    document.body.appendChild(backdrop);
    loopUi.backdrop = backdrop;
    loopUi.root = backdrop.querySelector('.loop-modal');
    loopUi.fileName = backdrop.querySelector('#loop-modal-file-name');
    loopUi.waveWrap = backdrop.querySelector('#loop-wave-wrap');
    loopUi.waveCanvas = backdrop.querySelector('#loop-wave-canvas');
    loopUi.waveCtx = loopUi.waveCanvas.getContext('2d');
    loopUi.minimapWrap = backdrop.querySelector('#loop-minimap-wrap');
    loopUi.minimapCanvas = backdrop.querySelector('#loop-minimap-canvas');
    loopUi.minimapCtx = loopUi.minimapCanvas.getContext('2d');
    loopUi.progressWrap = backdrop.querySelector('#loop-progress-wrap');
    loopUi.progressFill = backdrop.querySelector('#loop-progress-fill');
    loopUi.progressGhost = backdrop.querySelector('#loop-progress-ghost');
    loopUi.playhead = backdrop.querySelector('#loop-playhead');
    loopUi.leftHandle = backdrop.querySelector('#loop-handle-left');
    loopUi.rightHandle = backdrop.querySelector('#loop-handle-right');
    loopUi.leftTag = backdrop.querySelector('#loop-tag-left');
    loopUi.rightTag = backdrop.querySelector('#loop-tag-right');
    loopUi.currentTime = backdrop.querySelector('#loop-current-time');
    loopUi.totalTime = backdrop.querySelector('#loop-total-time');
    loopUi.zoomLevel = backdrop.querySelector('#loop-zoom-level');
    loopUi.bpmInput = backdrop.querySelector('#loop-bpm-input');
    loopUi.barsInput = backdrop.querySelector('#loop-bars-input');
    loopUi.loopSwitch = backdrop.querySelector('#loop-enabled-switch');
    loopUi.volumeSlider = backdrop.querySelector('#loop-volume-slider');
    loopUi.volumePct = backdrop.querySelector('#loop-volume-pct');
    loopUi.loopInfo = backdrop.querySelector('#loop-loop-info');
    loopUi.statRate = backdrop.querySelector('#loop-stat-rate');
    loopUi.statDur = backdrop.querySelector('#loop-stat-dur');
    loopUi.statChannels = backdrop.querySelector('#loop-stat-ch');
    loopUi.statLoop = backdrop.querySelector('#loop-stat-loop');
    loopUi.statBeat = backdrop.querySelector('#loop-stat-beat');
    loopUi.playBtn = backdrop.querySelector('#loop-play-toggle');
    loopUi.stopBtn = backdrop.querySelector('#loop-stop-btn');

    const closeModal = () => loopUi.backdrop.classList.remove('active');
    backdrop.querySelector('#loop-modal-close').addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && loopUi.backdrop.classList.contains('active')) closeModal();
    });

    backdrop.querySelector('#loop-zoom-in').addEventListener('click', () => zoomLoopView(0.72));
    backdrop.querySelector('#loop-zoom-out').addEventListener('click', () => zoomLoopView(1 / 0.72));
    backdrop.querySelector('#loop-zoom-fit').addEventListener('click', () => {
        if (!state.audioBuffer) return;
        loopUi.zoomStart = 0;
        loopUi.zoomEnd = state.audioBuffer.duration;
        renderLoopEditor();
    });

    loopUi.playBtn.addEventListener('click', async () => {
        if (!state.audioLoaded) return;
        await toggleAudioPlayback();
    });
    loopUi.stopBtn.addEventListener('click', () => {
        stopAudioPlayback(true);
        renderLoopEditor();
    });
    loopUi.loopSwitch.addEventListener('click', () => {
        setLoopEnabled(!state.loopEnabled);
        renderLoopEditor();
    });
    backdrop.querySelector('#loop-mute-btn').addEventListener('click', () => {
        muteToggle.checked = !muteToggle.checked;
        muteToggle.dispatchEvent(new Event('change', { bubbles: true }));
        syncLoopVolumeUI();
    });
    loopUi.volumeSlider.addEventListener('input', () => {
        volumeSlider.value = loopUi.volumeSlider.value;
        volumeValue.textContent = `${volumeSlider.value}%`;
        updateAudioGain();
        syncLoopVolumeUI();
    });

    function commitBpm() {
        const bpmVal = Math.max(40, Math.min(300, Math.round(parseFloat(loopUi.bpmInput.value) || state.detectedBpm || 120)));
        loopUi.bpmInput.value = bpmVal;
        setDetectedBpm(bpmVal, false);
        setLoopBars(state.loopBars || 4);
        renderLoopEditor();
    }
    loopUi.bpmInput.addEventListener('change', commitBpm);
    loopUi.bpmInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitBpm(); } });

    function commitBars(nextVal = loopUi.barsInput.value) {
        const bars = Math.max(1, Math.min(999, Math.round(parseFloat(nextVal) || state.loopBars || 4)));
        loopUi.barsInput.value = bars;
        setLoopBars(bars);
        renderLoopEditor();
    }
    loopUi.barsInput.addEventListener('change', () => commitBars());
    loopUi.barsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commitBars(); } });
    backdrop.querySelector('#loop-bars-inc').addEventListener('click', () => commitBars((state.loopBars || 4) + 1));
    backdrop.querySelector('#loop-bars-dec').addEventListener('click', () => commitBars(Math.max(1, (state.loopBars || 4) - 1)));

    const startDrag = (side, clientX) => {
        loopUi.dragging = side;
        loopUi.dragMoved = false;
        loopUi.dragX0 = clientX;
        loopUi.dragStartVal = side === 'left' ? state.loopStart : state.loopEnd;
    };
    loopUi.leftHandle.addEventListener('mousedown', (e) => { e.preventDefault(); startDrag('left', e.clientX); });
    loopUi.rightHandle.addEventListener('mousedown', (e) => { e.preventDefault(); startDrag('right', e.clientX); });
    loopUi.leftHandle.addEventListener('touchstart', (e) => { startDrag('left', e.touches[0].clientX); }, { passive: true });
    loopUi.rightHandle.addEventListener('touchstart', (e) => { startDrag('right', e.touches[0].clientX); }, { passive: true });

    const moveDrag = (clientX) => {
        if (!loopUi.dragging || !state.audioBuffer) return;
        const rect = loopUi.waveWrap.getBoundingClientRect();
        const delta = ((clientX - loopUi.dragX0) / rect.width) * (loopUi.zoomEnd - loopUi.zoomStart);
        const beat = getLoopBeatDuration();
        const minGap = beat > 0 ? beat : 0.1;
        let nextStart = state.loopStart;
        let nextEnd = state.loopEnd;
        if (loopUi.dragging === 'left') {
            nextStart = loopUi.dragStartVal + delta;
            if (beat > 0) nextStart = Math.round(nextStart / beat) * beat;
            nextStart = Math.max(0, Math.min(nextStart, state.loopEnd - minGap));
        } else {
            nextEnd = loopUi.dragStartVal + delta;
            if (beat > 0) nextEnd = Math.round(nextEnd / beat) * beat;
            nextEnd = Math.max(state.loopStart + minGap, Math.min(nextEnd, state.audioBuffer.duration));
        }
        loopUi.dragMoved = true;
        setLoopRegion(nextStart, nextEnd);
        renderLoopEditor();
    };
    document.addEventListener('mousemove', (e) => moveDrag(e.clientX));
    document.addEventListener('touchmove', (e) => moveDrag(e.touches[0].clientX), { passive: true });
    const endDrag = () => { loopUi.dragging = null; };
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);

    loopUi.waveWrap.addEventListener('click', (e) => {
        if (!state.audioBuffer) return;
        if (loopUi.dragMoved) { loopUi.dragMoved = false; return; }
        const rect = loopUi.waveWrap.getBoundingClientRect();
        seekTo(loopXToTime(e.clientX - rect.left));
        renderLoopEditor();
    });
    loopUi.progressWrap.addEventListener('mousemove', (e) => {
        const r = loopUi.progressWrap.getBoundingClientRect();
        loopUi.progressGhost.style.width = `${Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))}%`;
        loopUi.progressGhost.style.display = 'block';
    });
    loopUi.progressWrap.addEventListener('mouseleave', () => { loopUi.progressGhost.style.display = 'none'; });
    loopUi.progressWrap.addEventListener('click', (e) => {
        if (!state.audioElement) return;
        const r = loopUi.progressWrap.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        seekTo(pct * state.audioElement.duration);
        renderLoopEditor();
    });

    window.addEventListener('resize', () => {
        if (loopUi.backdrop.classList.contains('active')) {
            resizeLoopCanvases();
            renderLoopEditor();
        }
    });
}

function resizeLoopCanvases() {
    if (!loopUi.waveCanvas || !loopUi.backdrop.classList.contains('active')) return;
    const dpr = window.devicePixelRatio || 1;
    const waveRect = loopUi.waveWrap.getBoundingClientRect();
    const miniRect = loopUi.minimapWrap.getBoundingClientRect();
    loopUi.waveW = Math.max(1, Math.floor(waveRect.width));
    loopUi.waveH = Math.max(1, Math.floor(waveRect.height));
    loopUi.miniW = Math.max(1, Math.floor(miniRect.width));
    loopUi.miniH = Math.max(1, Math.floor(miniRect.height));
    loopUi.waveCanvas.width = Math.max(1, Math.floor(loopUi.waveW * dpr));
    loopUi.waveCanvas.height = Math.max(1, Math.floor(loopUi.waveH * dpr));
    loopUi.waveCanvas.style.width = `${loopUi.waveW}px`;
    loopUi.waveCanvas.style.height = `${loopUi.waveH}px`;
    loopUi.waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    loopUi.minimapCanvas.width = Math.max(1, Math.floor(loopUi.miniW * dpr));
    loopUi.minimapCanvas.height = Math.max(1, Math.floor(loopUi.miniH * dpr));
    loopUi.minimapCanvas.style.width = `${loopUi.miniW}px`;
    loopUi.minimapCanvas.style.height = `${loopUi.miniH}px`;
    loopUi.minimapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildLoopPeaks();
}

function buildLoopPeaks() {
    if (!state.audioBuffer || loopUi.waveW < 1) return;
    const samples = state.audioBuffer.getChannelData(0);
    const peakCount = Math.ceil(loopUi.waveW * 4);
    const block = Math.max(1, Math.floor(samples.length / peakCount));
    loopUi.peaks = new Float32Array(peakCount);
    for (let i = 0; i < peakCount; i++) {
        let peak = 0;
        const off = i * block;
        for (let j = 0; j < block; j++) {
            const a = Math.abs(samples[off + j] || 0);
            if (a > peak) peak = a;
        }
        loopUi.peaks[i] = peak;
    }
}

function loopTimeToX(t) {
    if (loopUi.zoomEnd <= loopUi.zoomStart) return 0;
    return ((t - loopUi.zoomStart) / (loopUi.zoomEnd - loopUi.zoomStart)) * loopUi.waveW;
}
function loopXToTime(x) {
    if (loopUi.zoomEnd <= loopUi.zoomStart) return 0;
    return loopUi.zoomStart + (x / loopUi.waveW) * (loopUi.zoomEnd - loopUi.zoomStart);
}

function renderLoopWaveform() {
    const ctx = loopUi.waveCtx;
    if (!ctx) return;
    ctx.clearRect(0, 0, loopUi.waveW, loopUi.waveH);
    ctx.fillStyle = 'rgba(3,10,18,0.98)';
    ctx.fillRect(0, 0, loopUi.waveW, loopUi.waveH);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(0, loopUi.waveH / 2);
    ctx.lineTo(loopUi.waveW, loopUi.waveH / 2);
    ctx.stroke();
    if (!loopUi.peaks || !state.audioBuffer) return;

    const lsX = loopTimeToX(state.loopStart);
    const leX = loopTimeToX(state.loopEnd);
    ctx.fillStyle = 'rgba(59,130,246,0.10)';
    ctx.fillRect(lsX, 0, leX - lsX, loopUi.waveH);

    const beat = getLoopBeatDuration();
    if (beat > 0) {
        let first = Math.floor(loopUi.zoomStart / beat) * beat;
        let idx = Math.round(first / beat);
        for (let t = first; t < loopUi.zoomEnd; t += beat, idx++) {
            const x = loopTimeToX(t);
            const isBar = idx % 4 === 0;
            ctx.strokeStyle = isBar ? 'rgba(147,197,253,0.26)' : 'rgba(147,197,253,0.12)';
            ctx.lineWidth = isBar ? 1 : 0.5;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, loopUi.waveH); ctx.stroke();
        }
    }

    const total = state.audioBuffer.duration;
    const n = loopUi.peaks.length;
    const p0 = Math.floor((loopUi.zoomStart / total) * n);
    const p1 = Math.max(p0 + 1, Math.ceil((loopUi.zoomEnd / total) * n));
    const span = p1 - p0;
    for (let i = 0; i < loopUi.waveW; i++) {
        const pi = p0 + Math.round((i / loopUi.waveW) * span);
        const pk = loopUi.peaks[Math.min(pi, n - 1)] || 0;
        const h = Math.max(0.75, pk * loopUi.waveH * 0.86);
        const y = (loopUi.waveH - h) * 0.5;
        const t = loopXToTime(i);
        const inLoop = t >= state.loopStart && t <= state.loopEnd;
        ctx.fillStyle = inLoop
            ? `rgb(${36 + pk * 18 | 0}, ${112 + pk * 52 | 0}, ${172 + pk * 54 | 0})`
            : `rgb(${14 + pk * 12 | 0}, ${48 + pk * 22 | 0}, ${74 + pk * 24 | 0})`;
        ctx.fillRect(i, y, 1, h);
    }

    ctx.strokeStyle = 'rgba(191,219,254,0.65)';
    ctx.lineWidth = 1;
    [lsX, leX].forEach((x) => { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, loopUi.waveH); ctx.stroke(); });
}

function renderLoopMinimap() {
    const ctx = loopUi.minimapCtx;
    if (!ctx) return;
    ctx.clearRect(0, 0, loopUi.miniW, loopUi.miniH);
    ctx.fillStyle = 'rgba(4,12,18,0.96)';
    ctx.fillRect(0, 0, loopUi.miniW, loopUi.miniH);
    if (!loopUi.peaks || !state.audioBuffer) return;
    const total = state.audioBuffer.duration;
    const n = loopUi.peaks.length;
    for (let i = 0; i < loopUi.miniW; i++) {
        const pi = Math.min(n - 1, Math.round((i / loopUi.miniW) * n));
        const pk = loopUi.peaks[pi] || 0;
        const h = Math.max(0.5, pk * loopUi.miniH * 0.88);
        const y = (loopUi.miniH - h) * 0.5;
        const t = (i / loopUi.miniW) * total;
        const inLoop = t >= state.loopStart && t <= state.loopEnd;
        ctx.fillStyle = inLoop ? 'rgba(96,165,250,0.72)' : 'rgba(74,85,104,0.68)';
        ctx.fillRect(i, y, 1, h);
    }
    const visX = (loopUi.zoomStart / total) * loopUi.miniW;
    const visW = ((loopUi.zoomEnd - loopUi.zoomStart) / total) * loopUi.miniW;
    ctx.strokeStyle = 'rgba(191,219,254,0.82)';
    ctx.lineWidth = 1;
    ctx.strokeRect(visX + 0.5, 0.5, Math.max(2, visW - 1), loopUi.miniH - 1);
}

function updateLoopHandles() {
    loopUi.leftHandle.style.left = `${(state.loopStart / state.audioBuffer.duration) * 100}%`;
    loopUi.rightHandle.style.left = `${(state.loopEnd / state.audioBuffer.duration) * 100}%`;
    loopUi.leftTag.textContent = fmtLoopTime(state.loopStart);
    loopUi.rightTag.textContent = fmtLoopTime(state.loopEnd);
}

function syncLoopVolumeUI() {
    loopUi.volumeSlider.value = volumeSlider.value;
    loopUi.volumePct.textContent = `${volumeSlider.value}%`;
    const muteBtn = document.getElementById('loop-mute-btn');
    if (muteBtn) muteBtn.textContent = state.isMuted ? '🔇' : '🔊';
}

function syncLoopInfo() {
    const beat = getLoopBeatDuration();
    const dur = state.loopEnd - state.loopStart;
    loopUi.bpmInput.value = state.detectedBpm || 120;
    loopUi.barsInput.value = state.loopBars || 4;
    loopUi.loopSwitch.classList.toggle('on', !!state.loopEnabled);
    loopUi.loopSwitch.setAttribute('aria-pressed', state.loopEnabled ? 'true' : 'false');
    loopUi.playBtn.textContent = state.isPlaying ? '⏸ Pause' : '▶ Play';
    loopUi.playBtn.classList.toggle('active', state.isPlaying);
    loopUi.loopInfo.textContent = beat > 0
        ? `${state.loopBars} bars · ${dur.toFixed(3)}s total · ${beat.toFixed(3)}s per beat`
        : `${dur.toFixed(3)}s total`;
    loopUi.fileName.textContent = state.audioFileName || 'Loaded audio';
    loopUi.totalTime.textContent = fmtLoopTime(state.audioElement?.duration || state.audioBuffer?.duration || 0);
    if (state.audioElement) loopUi.currentTime.textContent = fmtLoopTime(state.audioElement.currentTime || 0);
    loopUi.statRate.textContent = state.audioBuffer ? `${state.audioBuffer.sampleRate} Hz` : '—';
    loopUi.statDur.textContent = state.audioBuffer ? fmtLoopTime(state.audioBuffer.duration) : '—';
    loopUi.statChannels.textContent = state.audioBuffer ? `${state.audioBuffer.numberOfChannels}` : '—';
    loopUi.statLoop.textContent = `${fmtLoopTime(state.loopStart)} → ${fmtLoopTime(state.loopEnd)}`;
    loopUi.statBeat.textContent = beat > 0 ? `${beat.toFixed(3)}s` : '—';
    syncLoopVolumeUI();
    const durTotal = state.audioElement?.duration || state.audioBuffer?.duration || 0;
    if (durTotal > 0 && state.audioElement) {
        loopUi.progressFill.style.width = `${Math.max(0, Math.min(100, (state.audioElement.currentTime / durTotal) * 100))}%`;
    }
}

function renderLoopEditor() {
    if (!loopUi.root || !state.audioBuffer) return;
    renderLoopWaveform();
    renderLoopMinimap();
    updateLoopHandles();
    syncLoopInfo();
    updateLoopPlayhead(state.audioElement?.currentTime || 0, state.audioElement?.duration || state.audioBuffer.duration);
    const total = state.audioBuffer.duration;
    const zoomSpan = loopUi.zoomEnd - loopUi.zoomStart;
    loopUi.zoomLevel.textContent = `${Math.max(1, (total / Math.max(0.001, zoomSpan))).toFixed(total / zoomSpan >= 10 ? 0 : 1)}×`;
}

function updateLoopPlayhead(currentTime, duration) {
    if (!loopUi.playhead || !state.audioBuffer) return;
    loopUi.currentTime.textContent = fmtLoopTime(currentTime || 0);
    loopUi.totalTime.textContent = fmtLoopTime(duration || state.audioBuffer.duration);
    if (currentTime >= loopUi.zoomStart && currentTime <= loopUi.zoomEnd) {
        loopUi.playhead.style.display = 'block';
        loopUi.playhead.style.left = `${loopTimeToX(currentTime)}px`;
    } else {
        loopUi.playhead.style.display = 'none';
    }
    if (duration > 0) loopUi.progressFill.style.width = `${Math.max(0, Math.min(100, (currentTime / duration) * 100))}%`;
}

function zoomLoopView(multiplier) {
    if (!state.audioBuffer) return;
    const total = state.audioBuffer.duration;
    const currentSpan = Math.max(0.25, loopUi.zoomEnd - loopUi.zoomStart);
    const nextSpan = clamp(currentSpan * multiplier, 0.5, total);
    const center = clamp((state.loopStart + state.loopEnd) * 0.5, 0, total);
    loopUi.zoomStart = clamp(center - nextSpan * 0.5, 0, Math.max(0, total - nextSpan));
    loopUi.zoomEnd = clamp(loopUi.zoomStart + nextSpan, nextSpan, total);
    if (loopUi.zoomEnd > total) {
        loopUi.zoomEnd = total;
        loopUi.zoomStart = Math.max(0, total - nextSpan);
    }
    renderLoopEditor();
}

function openLoopModal() {
    if (!state.audioLoaded || !state.audioBuffer) return;
    ensureLoopModal();
    loopUi.backdrop.classList.add('active');
    if (loopUi.zoomEnd <= loopUi.zoomStart || loopUi.zoomEnd > state.audioBuffer.duration) {
        loopUi.zoomStart = 0;
        loopUi.zoomEnd = state.audioBuffer.duration;
    }
    resizeLoopCanvases();
    renderLoopEditor();
}

if (loopBtn) loopBtn.addEventListener('click', openLoopModal);

window.addEventListener('audio-loaded', () => {
    if (!state.audioBuffer) return;
    loopUi.zoomStart = 0;
    loopUi.zoomEnd = state.audioBuffer.duration;
    if (loopUi.backdrop?.classList.contains('active')) {
        resizeLoopCanvases();
        renderLoopEditor();
    }
});
window.addEventListener('audio-progress', (e) => {
    if (!loopUi.root || !loopUi.backdrop.classList.contains('active')) return;
    updateLoopPlayhead(e.detail?.currentTime || 0, e.detail?.duration || state.audioBuffer?.duration || 0);
});
window.addEventListener('loop-updated', () => {
    if (loopUi.root) renderLoopEditor();
});
window.addEventListener('audio-playstate', () => {
    if (loopUi.root && loopUi.backdrop.classList.contains('active')) renderLoopEditor();
});

// ── Galaxy sliders ──
document.getElementById('reactivity-slider').addEventListener('input', (e) => {
    state.reactivityMultiplier = e.target.value / 100;
    document.getElementById('reactivity-value').textContent = e.target.value + '%';
});
document.getElementById('galaxy-stars-slider').addEventListener('input', (e) => {
    state.galaxyStarAmountMultiplier = e.target.value / 100;
    document.getElementById('galaxy-stars-value').textContent = e.target.value + '%';
    updateGalaxyDrawRange();
});
document.getElementById('galaxy-scale-slider').addEventListener('input', (e) => {
    state.galaxyScaleFactor = e.target.value / 100;
    document.getElementById('galaxy-scale-value').textContent = e.target.value + '%';
    applyGalaxyScaleAndFlatness();
});
document.getElementById('galaxy-flatness-slider').addEventListener('input', (e) => {
    state.galaxyFlatness = e.target.value / 100;
    document.getElementById('galaxy-flatness-value').textContent = e.target.value + '%';
    applyGalaxyScaleAndFlatness();
});
document.getElementById('galaxy-core-size-slider').addEventListener('input', (e) => {
    state.galaxyCoreSize = e.target.value / 100;
    document.getElementById('galaxy-core-size-value').textContent = e.target.value + '%';
});
document.getElementById('dust-intensity-slider').addEventListener('input', (e) => {
    state.dustLaneIntensity = e.target.value / 100;
    document.getElementById('dust-intensity-value').textContent = e.target.value + '%';
    refreshCurrentGalaxyColors();
    galaxyGeo.attributes.aColor.needsUpdate = true;
});
document.getElementById('gas-density-slider').addEventListener('input', (e) => {
    state.gasDensity = e.target.value / 100;
    document.getElementById('gas-density-value').textContent = e.target.value + '%';
});
document.getElementById('disc-inclination-slider').addEventListener('input', (e) => {
    state.galaxyInclinationDeg = parseInt(e.target.value);
    document.getElementById('disc-inclination-value').textContent = e.target.value + '°';
    applyGalaxyInclination(state.galaxyInclinationDeg);
});
document.getElementById('fov-slider').addEventListener('input', (e) => {
    state.cameraFov = parseInt(e.target.value);
    document.getElementById('fov-value').textContent = e.target.value + '°';
    camera.fov = state.cameraFov;
    camera.updateProjectionMatrix();
});

// ── Auto-rotate ──
const autoRotateToggle = document.getElementById('auto-rotate-toggle');
const autoRotateValue  = document.getElementById('auto-rotate-value');
function syncAutoRotateUI() {
    autoRotateToggle.checked = state.autoRotateEnabled;
    autoRotateValue.textContent = state.autoRotateEnabled ? 'On' : 'Off';
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.0;
    controls.update();
}
autoRotateToggle.addEventListener('change', (e) => {
    state.autoRotateEnabled = e.target.checked;
    syncAutoRotateUI();
});
document.getElementById('auto-rotate-speed-slider').addEventListener('input', (e) => {
    state.autoRotateSpeed = e.target.value / 100;
    document.getElementById('auto-rotate-speed-value').textContent = e.target.value + '%';
});
syncAutoRotateUI();

// ── Beam / visual ──
document.getElementById('beam-threshold-slider').addEventListener('input', (e) => {
    state.beamVisibilityThreshold = e.target.value / 100;
    document.getElementById('beam-threshold-value').textContent = e.target.value + '%';
});
document.getElementById('beam-thickness-slider').addEventListener('input', (e) => {
    state.beamThicknessMultiplier = e.target.value / 100;
    document.getElementById('beam-thickness-value').textContent = e.target.value + '%';
});
document.getElementById('beam-length-slider').addEventListener('input', (e) => {
    state.beamLengthMultiplier = e.target.value / 100;
    document.getElementById('beam-length-value').textContent = e.target.value + '%';
});
document.getElementById('core-glow-intensity-slider').addEventListener('input', (e) => {
    state.coreGlowIntensity = e.target.value / 100;
    document.getElementById('core-glow-intensity-value').textContent = e.target.value + '%';
});
document.getElementById('core-glow-size-slider').addEventListener('input', (e) => {
    state.coreGlowScale = e.target.value / 100;
    document.getElementById('core-glow-size-value').textContent = e.target.value + '%';
});

// ── Lightning ──
document.getElementById('lightning-enabled-toggle').addEventListener('change', (e) => {
    state.lightningEnabled = e.target.checked;
    document.getElementById('lightning-enabled-value').textContent = state.lightningEnabled ? 'On' : 'Off';
    if (!state.lightningEnabled) hideLightning();
});
document.getElementById('lightning-frequency-slider').addEventListener('input', (e) => {
    state.lightningFrequencyMultiplier = e.target.value / 100;
    document.getElementById('lightning-frequency-value').textContent = e.target.value + '%';
});
document.getElementById('depth-slider').addEventListener('input', (e) => {
    state.lightningDepth = parseInt(e.target.value);
    document.getElementById('depth-value').textContent = e.target.value;
});
document.getElementById('branch-prob-slider').addEventListener('input', (e) => {
    state.lightningBranchProb = e.target.value / 100;
    document.getElementById('branch-prob-value').textContent = e.target.value + '%';
});
document.getElementById('max-offset-slider').addEventListener('input', (e) => {
    state.lightningMaxOffset = e.target.value / 100;
    document.getElementById('max-offset-value').textContent = state.lightningMaxOffset.toFixed(2);
});
document.getElementById('branch-length-slider').addEventListener('input', (e) => {
    state.lightningBranchLength = e.target.value / 100;
    document.getElementById('branch-length-value').textContent = state.lightningBranchLength.toFixed(2);
});
document.getElementById('lightning-bloom-slider').addEventListener('input', (e) => {
    state.lightningBloomBoost = e.target.value / 100;
    document.getElementById('lightning-bloom-value').textContent = e.target.value + '%';
});
document.getElementById('lightning-strike-length-slider').addEventListener('input', (e) => {
    state.lightningStrikeLength = e.target.value / 100;
    document.getElementById('lightning-strike-length-value').textContent = e.target.value + '%';
});

// ── Performance & camera presets ──
const performancePresetSelect = document.getElementById('performance-preset-select');
const performancePresetValue  = document.getElementById('performance-preset-value');
performancePresetSelect.addEventListener('change', (e) => {
    performancePresetValue.textContent = e.target.options[e.target.selectedIndex].text;
    applyPerformancePreset(e.target.value, {
        applyPerformanceCounts: () => {
            updateGalaxyDrawRange();
            starGeo.setDrawRange(0, state.activeStarCount);
            scatterGeo.setDrawRange(0, state.activeScatterCount);
            haloGeo.setDrawRange(0, state.activeHaloCount);
            nebulaGeo.setDrawRange(0, state.activeNebulaCount);
        }
    });
});

const cameraPresetSelect = document.getElementById('camera-preset-select');
const cameraPresetValue  = document.getElementById('camera-preset-value');
cameraPresetSelect.addEventListener('change', (e) => {
    cameraPresetValue.textContent = e.target.options[e.target.selectedIndex].text;
    setCameraFromPreset(e.target.value);
});

// ── Galaxy type ──
function applyGalaxyType(key) {
    const preset = GALAXY_TYPES[key] || GALAXY_TYPES.barred;
    state.galaxyTypeKey  = key;
    state.galaxyArmCount = preset.armCount;
    state.galaxyArmTwist = preset.armTwist;
    document.getElementById('galaxy-type-value').textContent = preset.label;
}
document.getElementById('galaxy-type-select').addEventListener('change', (e) => {
    applyGalaxyType(e.target.value);
    const statusEl = document.getElementById('regen-status');
    statusEl.textContent = 'Generating…';
    setTimeout(() => {
        buildGalaxy(state.galaxyArmCount, state.galaxyArmTwist, state.galaxyTypeKey);
        updateGalaxyDrawRange();
        statusEl.textContent = '';
    }, 20);
});
const regenBtn = document.getElementById('regen-btn');
if (regenBtn) regenBtn.addEventListener('click', () => {
    const statusEl = document.getElementById('regen-status');
    statusEl.textContent = 'Regenerating…';
    setTimeout(() => {
        buildGalaxy(state.galaxyArmCount, state.galaxyArmTwist, state.galaxyTypeKey);
        updateGalaxyDrawRange();
        statusEl.textContent = 'Done!';
        setTimeout(() => { statusEl.textContent = ''; }, 1800);
    }, 20);
});

// ── Colormap ──
const cmapGrid = document.getElementById('cmap-grid');
GALAXY_COLORMAPS.forEach((cm, idx) => {
    const btn = document.createElement('button');
    btn.className = 'cmap-btn';
    if (idx === state.lockedCmapIndex) btn.classList.add('active');
    btn.textContent = cm.name;
    btn.dataset.cmap = idx;
    btn.addEventListener('click', () => {
        state.lockedCmapIndex = idx;
        state.cmapA = idx; state.cmapB = idx; state.cmapMix = 0;
        refreshCurrentGalaxyColors();
        galaxyGeo.attributes.aColor.needsUpdate = true;
        cmapGrid.querySelectorAll('.cmap-btn').forEach(b => {
            b.classList.remove('active', 'auto-active');
            if (parseInt(b.dataset.cmap) === idx) b.classList.add('active');
        });
    });
    cmapGrid.appendChild(btn);
});
const autoBtn = cmapGrid.querySelector('[data-cmap="auto"]');
autoBtn.addEventListener('click', () => {
    state.lockedCmapIndex = -1;
    state.cmapA = DEFAULT_CMAP_INDEX;
    state.cmapB = (DEFAULT_CMAP_INDEX + 1) % GALAXY_COLORMAPS.length;
    state.cmapMix = 0;
    cmapGrid.querySelectorAll('.cmap-btn').forEach(b => b.classList.remove('active', 'auto-active'));
    autoBtn.classList.add('auto-active');
    refreshCurrentGalaxyColors();
});

document.getElementById('cmap-distribution-select').addEventListener('change', (e) => {
    state.colorMapDistributionMode = e.target.value;
    document.getElementById('cmap-distribution-value').textContent = e.target.options[e.target.selectedIndex].text;
    refreshCurrentGalaxyColors();
});
document.getElementById('cmap-reverse-toggle').addEventListener('change', (e) => {
    state.reverseColorMap = e.target.checked;
    document.getElementById('cmap-reverse-value').textContent = state.reverseColorMap ? 'On' : 'Off';
    refreshCurrentGalaxyColors();
});

// ── Cinema camera ──
document.getElementById('cinema-mode-toggle').addEventListener('change', (e) => {
    state.cinemaMode = e.target.checked;
    if (state.cinemaMode) { state.cinemaT = 0; state.cinemaAutoAdvanceTimer = 0; controls.enabled = false; }
    else { controls.enabled = true; }
});
document.getElementById('cinema-path-select').addEventListener('change', (e) => {
    state.cinemaPathType = e.target.value;
    document.getElementById('cinema-path-value').textContent = e.target.options[e.target.selectedIndex].text;
    state.cinemaT = 0;
});
document.getElementById('cinema-speed-slider').addEventListener('input', (e) => {
    state.cinemaSpeed = e.target.value / 100;
    document.getElementById('cinema-speed-value').textContent = e.target.value + '%';
});
document.getElementById('cinema-elevation-slider').addEventListener('input', (e) => {
    state.cinemaElevation = e.target.value / 100;
    document.getElementById('cinema-elevation-value').textContent = e.target.value + '%';
});
document.getElementById('cinema-distance-slider').addEventListener('input', (e) => {
    state.cinemaDistance = e.target.value / 100;
    document.getElementById('cinema-distance-value').textContent = e.target.value + '%';
});
document.getElementById('cinema-auto-advance').addEventListener('change', (e) => {
    state.cinemaAutoAdvance = e.target.checked;
    state.cinemaAutoAdvanceTimer = 0;
});

// ── Preset manager ──
const PRESET_COUNT  = 4;
const presetStatusEl = document.getElementById('preset-status');

function gatherState() {
    return {
        volume: volumeSlider.value,
        muted: state.isMuted,
        reactivity: document.getElementById('reactivity-slider').value,
        galaxyStars: document.getElementById('galaxy-stars-slider').value,
        autoRotate: autoRotateToggle.checked,
        autoRotateSpeed: document.getElementById('auto-rotate-speed-slider').value,
        galaxyScale: document.getElementById('galaxy-scale-slider').value,
        galaxyCoreSize: document.getElementById('galaxy-core-size-slider').value,
        galaxyFlatness: document.getElementById('galaxy-flatness-slider').value,
        dustIntensity: document.getElementById('dust-intensity-slider').value,
        gasDensity: document.getElementById('gas-density-slider').value,
        discInclination: document.getElementById('disc-inclination-slider').value,
        fov: document.getElementById('fov-slider').value,
        galaxyType: document.getElementById('galaxy-type-select').value,
        beamThreshold: document.getElementById('beam-threshold-slider').value,
        lightningEnabled: document.getElementById('lightning-enabled-toggle').checked,
        lightningFreq: document.getElementById('lightning-frequency-slider').value,
        coreGlowIntensity: document.getElementById('core-glow-intensity-slider').value,
        coreGlowSize: document.getElementById('core-glow-size-slider').value,
        beamThickness: document.getElementById('beam-thickness-slider').value,
        beamLength: document.getElementById('beam-length-slider').value,
        lightningStrikeLength: document.getElementById('lightning-strike-length-slider').value,
        performancePreset: performancePresetSelect.value,
        cameraPreset: cameraPresetSelect.value,
        lockedCmap: state.lockedCmapIndex,
        colorMapMode: state.colorMapDistributionMode,
        reverseColorMap: state.reverseColorMap,
        cinemaPath: state.cinemaPathType,
        cinemaSpeed: document.getElementById('cinema-speed-slider').value,
        cinemaElevation: document.getElementById('cinema-elevation-slider').value,
        cinemaDistance: document.getElementById('cinema-distance-slider').value,
    };
}

function applyStateSnapshot(s) {
    const setSlider = (id, val, unit = '%') => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = val;
        const label = document.getElementById(id.replace('-slider', '-value'));
        if (label) label.textContent = val + unit;
        el.dispatchEvent(new Event('input'));
    };
    setSlider('volume-slider', s.volume);
    state.isMuted = !!s.muted; syncMuteUI(); updateAudioGain();
    setSlider('reactivity-slider', s.reactivity);
    setSlider('galaxy-stars-slider', s.galaxyStars);
    setSlider('auto-rotate-speed-slider', s.autoRotateSpeed);
    setSlider('galaxy-scale-slider', s.galaxyScale);
    setSlider('galaxy-core-size-slider', s.galaxyCoreSize);
    setSlider('galaxy-flatness-slider', s.galaxyFlatness);
    setSlider('dust-intensity-slider', s.dustIntensity);
    setSlider('gas-density-slider', s.gasDensity);
    setSlider('disc-inclination-slider', s.discInclination, '°');
    setSlider('fov-slider', s.fov, '°');
    setSlider('beam-threshold-slider', s.beamThreshold);
    setSlider('lightning-frequency-slider', s.lightningFreq);
    setSlider('core-glow-intensity-slider', s.coreGlowIntensity);
    setSlider('core-glow-size-slider', s.coreGlowSize);
    setSlider('beam-thickness-slider', s.beamThickness);
    setSlider('beam-length-slider', s.beamLength);
    if (s.lightningStrikeLength) setSlider('lightning-strike-length-slider', s.lightningStrikeLength);
    setSlider('cinema-speed-slider', s.cinemaSpeed);
    if (s.cinemaElevation) setSlider('cinema-elevation-slider', s.cinemaElevation);
    if (s.cinemaDistance)  setSlider('cinema-distance-slider',  s.cinemaDistance);

    autoRotateToggle.checked = s.autoRotate;
    autoRotateToggle.dispatchEvent(new Event('change'));
    if (s.lightningEnabled !== undefined) {
        const t = document.getElementById('lightning-enabled-toggle');
        t.checked = !!s.lightningEnabled; t.dispatchEvent(new Event('change'));
    }
    if (s.galaxyType) {
        const sel = document.getElementById('galaxy-type-select');
        sel.value = s.galaxyType; sel.dispatchEvent(new Event('change'));
    }
    if (s.colorMapMode) {
        const d = document.getElementById('cmap-distribution-select');
        d.value = s.colorMapMode; d.dispatchEvent(new Event('change'));
    }
    if (s.reverseColorMap !== undefined) {
        const r = document.getElementById('cmap-reverse-toggle');
        r.checked = !!s.reverseColorMap; r.dispatchEvent(new Event('change'));
    }
    performancePresetSelect.value = s.performancePreset;
    performancePresetSelect.dispatchEvent(new Event('change'));
    cameraPresetSelect.value = s.cameraPreset;
    cameraPresetSelect.dispatchEvent(new Event('change'));
    const cinSel = document.getElementById('cinema-path-select');
    cinSel.value = s.cinemaPath || 'orbit'; cinSel.dispatchEvent(new Event('change'));
    const autoBtnEl = cmapGrid.querySelector('[data-cmap="auto"]');
    if (s.lockedCmap >= 0 && s.lockedCmap < GALAXY_COLORMAPS.length) {
        state.lockedCmapIndex = s.lockedCmap;
        refreshCurrentGalaxyColors();
        cmapGrid.querySelectorAll('.cmap-btn').forEach(b => {
            b.classList.remove('active', 'auto-active');
            if (parseInt(b.dataset.cmap) === state.lockedCmapIndex) b.classList.add('active');
        });
    } else if (s.lockedCmap === -1 && autoBtnEl) {
        state.lockedCmapIndex = -1;
        cmapGrid.querySelectorAll('.cmap-btn').forEach(b => b.classList.remove('active', 'auto-active'));
        autoBtnEl.classList.add('auto-active');
        refreshCurrentGalaxyColors();
    }
}

function buildPresetSlots() {
    const container = document.getElementById('preset-slots');
    container.innerHTML = '';
    for (let i = 0; i < PRESET_COUNT; i++) {
        const raw   = localStorage.getItem(`galaxy_preset_${i}`);
        const saved = raw ? JSON.parse(raw) : null;
        const row   = document.createElement('div');
        row.style.cssText = 'display:grid;grid-template-columns:1fr auto auto;gap:5px;margin:4px 0;align-items:center;';
        const label   = document.createElement('span');
        label.style.cssText = 'font-size:12px;color:#aaa;';
        label.textContent   = saved ? (saved._name || `Preset ${i+1}`) : `Empty ${i+1}`;
        const saveBtn = document.createElement('button');
        saveBtn.className = 'secondary-btn';
        saveBtn.style.cssText = 'width:auto;padding:5px 10px;margin:0;font-size:11px;';
        saveBtn.textContent = 'Save';
        const loadBtn = document.createElement('button');
        loadBtn.className = 'secondary-btn';
        loadBtn.style.cssText = 'width:auto;padding:5px 10px;margin:0;font-size:11px;';
        loadBtn.textContent = 'Load';
        loadBtn.disabled = !saved;
        saveBtn.addEventListener('click', () => {
            const name = prompt(`Name for Preset ${i+1}:`, saved?._name || `Preset ${i+1}`);
            if (name === null) return;
            const snap = gatherState();
            snap._name = name || `Preset ${i+1}`;
            localStorage.setItem(`galaxy_preset_${i}`, JSON.stringify(snap));
            presetStatusEl.textContent = `Saved "${snap._name}"`;
            setTimeout(() => { presetStatusEl.textContent = ''; }, 2000);
            buildPresetSlots();
        });
        loadBtn.addEventListener('click', () => {
            const snap = JSON.parse(localStorage.getItem(`galaxy_preset_${i}`));
            if (snap) { applyStateSnapshot(snap); presetStatusEl.textContent = `Loaded "${snap._name || `Preset ${i+1}`}"`; setTimeout(() => { presetStatusEl.textContent = ''; }, 2000); }
        });
        row.appendChild(label); row.appendChild(saveBtn); row.appendChild(loadBtn);
        container.appendChild(row);
    }
}
buildPresetSlots();

document.getElementById('preset-export-btn').addEventListener('click', () => {
    const all = {};
    for (let i = 0; i < PRESET_COUNT; i++) {
        const raw = localStorage.getItem(`galaxy_preset_${i}`);
        if (raw) all[`preset_${i}`] = JSON.parse(raw);
    }
    all._current = gatherState();
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `galaxy_presets_${Date.now()}.json`);
});
document.getElementById('preset-import-btn').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.style.cssText = 'position:fixed;left:-9999px;';
    document.body.appendChild(inp);
    inp.addEventListener('change', (e) => {
        const f = e.target.files[0];
        document.body.removeChild(inp);
        if (!f) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                for (let i = 0; i < PRESET_COUNT; i++) {
                    if (data[`preset_${i}`]) localStorage.setItem(`galaxy_preset_${i}`, JSON.stringify(data[`preset_${i}`]));
                }
                if (data._current) applyStateSnapshot(data._current);
                buildPresetSlots();
                presetStatusEl.textContent = 'Imported!';
                setTimeout(() => { presetStatusEl.textContent = ''; }, 2000);
            } catch (_) { presetStatusEl.textContent = 'Import failed — invalid JSON.'; }
        };
        reader.readAsText(f);
    });
    inp.addEventListener('cancel', () => document.body.removeChild(inp));
    inp.click();
});

// ── Reset to defaults ──
const captureStatus = document.getElementById('capture-status');
document.getElementById('reset-btn').addEventListener('click', () => {
    volumeSlider.value = 100; volumeValue.textContent = '100%';
    state.isMuted = false; syncMuteUI(); updateAudioGain();
    document.getElementById('reactivity-slider').value = 100;
    document.getElementById('reactivity-value').textContent = '100%';
    state.reactivityMultiplier = 1.0;
    document.getElementById('galaxy-stars-slider').value = 100;
    document.getElementById('galaxy-stars-value').textContent = '100%';
    state.galaxyStarAmountMultiplier = 1.0;
    state.autoRotateEnabled = false;
    state.autoRotateSpeed = 0.20;
    document.getElementById('auto-rotate-speed-slider').value = 20;
    document.getElementById('auto-rotate-speed-value').textContent = '20%';
    state.beamVisibilityThreshold = 0.80;
    document.getElementById('beam-threshold-slider').value = 80;
    document.getElementById('beam-threshold-value').textContent = '80%';
    state.lightningEnabled = true;
    document.getElementById('lightning-enabled-toggle').checked = true;
    document.getElementById('lightning-enabled-value').textContent = 'On';
    state.lightningFrequencyMultiplier = 1.0;
    document.getElementById('lightning-frequency-slider').value = 100;
    document.getElementById('lightning-frequency-value').textContent = '100%';
    state.coreGlowIntensity = 1.0;
    document.getElementById('core-glow-intensity-slider').value = 100;
    document.getElementById('core-glow-intensity-value').textContent = '100%';
    state.coreGlowScale = 0.50;
    document.getElementById('core-glow-size-slider').value = 50;
    document.getElementById('core-glow-size-value').textContent = '50%';
    state.beamThicknessMultiplier = 1.0;
    document.getElementById('beam-thickness-slider').value = 100;
    document.getElementById('beam-thickness-value').textContent = '100%';
    state.beamLengthMultiplier = 1.5;
    document.getElementById('beam-length-slider').value = 150;
    document.getElementById('beam-length-value').textContent = '150%';
    performancePresetSelect.value = 'quality';
    performancePresetSelect.dispatchEvent(new Event('change'));
    cameraPresetSelect.value = 'threeQuarter';
    cameraPresetSelect.dispatchEvent(new Event('change'));
    document.getElementById('frame-size-select').value = '4k';
    document.getElementById('frame-size-value').textContent = '4K';
    document.getElementById('record-resolution-select').value = '4k';
    document.getElementById('record-resolution-value').textContent = '4K';
    captureStatus.textContent = 'Idle';
    syncAutoRotateUI();

    state.galaxyScaleFactor = 1.0;
    document.getElementById('galaxy-scale-slider').value = 100;
    document.getElementById('galaxy-scale-value').textContent = '100%';
    applyGalaxyScaleAndFlatness();
    state.galaxyFlatness = 1.0;
    document.getElementById('galaxy-flatness-slider').value = 100;
    document.getElementById('galaxy-flatness-value').textContent = '100%';
    state.dustLaneIntensity = 1.0;
    document.getElementById('dust-intensity-slider').value = 100;
    document.getElementById('dust-intensity-value').textContent = '100%';
    state.gasDensity = 1.0;
    document.getElementById('gas-density-slider').value = 100;
    document.getElementById('gas-density-value').textContent = '100%';
    state.galaxyInclinationDeg = 0;
    document.getElementById('disc-inclination-slider').value = 0;
    document.getElementById('disc-inclination-value').textContent = '0°';
    applyGalaxyInclination(0);
    state.cameraFov = 60;
    document.getElementById('fov-slider').value = 60;
    document.getElementById('fov-value').textContent = '60°';
    camera.fov = 60; camera.updateProjectionMatrix();

    state.galaxyTypeKey  = 'core';
    state.galaxyArmCount = GALAXY_TYPES.core.armCount;
    state.galaxyArmTwist = GALAXY_TYPES.core.armTwist;
    document.getElementById('galaxy-type-select').value = 'core';
    document.getElementById('galaxy-type-value').textContent = GALAXY_TYPES.core.label;

    state.cinemaMode = false;
    document.getElementById('cinema-mode-toggle').checked = false;
    controls.enabled = true;
    state.cinemaPathType = 'orbit';
    document.getElementById('cinema-path-select').value = 'orbit';
    document.getElementById('cinema-path-value').textContent = 'Orbit';
    state.cinemaSpeed = 0.5;
    document.getElementById('cinema-speed-slider').value = 50;
    document.getElementById('cinema-speed-value').textContent = '50%';
    state.cinemaElevation = 0.35;
    document.getElementById('cinema-elevation-slider').value = 35;
    document.getElementById('cinema-elevation-value').textContent = '35%';
    state.cinemaDistance = 1.0;
    document.getElementById('cinema-distance-slider').value = 100;
    document.getElementById('cinema-distance-value').textContent = '100%';
    state.cinemaAutoAdvance = false;
    document.getElementById('cinema-auto-advance').checked = false;

    state.lightningStrikeLength = 1.0;
    document.getElementById('lightning-strike-length-slider').value = 100;
    document.getElementById('lightning-strike-length-value').textContent = '100%';
    document.getElementById('depth-slider').value = 6;
    document.getElementById('depth-value').textContent = '6';
    state.lightningDepth = 6;
    document.getElementById('branch-prob-slider').value = 15;
    document.getElementById('branch-prob-value').textContent = '15%';
    state.lightningBranchProb = 0.15;
    document.getElementById('max-offset-slider').value = 400;
    document.getElementById('max-offset-value').textContent = '4.00';
    state.lightningMaxOffset = 4.00;
    document.getElementById('branch-length-slider').value = 142;
    document.getElementById('branch-length-value').textContent = '1.42';
    state.lightningBranchLength = 1.42;
    document.getElementById('lightning-bloom-slider').value = 400;
    document.getElementById('lightning-bloom-value').textContent = '400%';
    state.lightningBloomBoost = 4.0;

    state.lockedCmapIndex = DEFAULT_CMAP_INDEX;
    state.cmapA = DEFAULT_CMAP_INDEX; state.cmapB = DEFAULT_CMAP_INDEX; state.cmapMix = 0;
    state.colorMapDistributionMode = 'traditional';
    state.reverseColorMap = true;
    document.getElementById('cmap-distribution-select').value = 'traditional';
    document.getElementById('cmap-distribution-value').textContent = 'Traditional Radial';
    document.getElementById('cmap-reverse-toggle').checked = true;
    document.getElementById('cmap-reverse-value').textContent = 'On';
    refreshCurrentGalaxyColors();
    cmapGrid.querySelectorAll('.cmap-btn').forEach(b => {
        b.classList.remove('active', 'auto-active');
        if (parseInt(b.dataset.cmap) === DEFAULT_CMAP_INDEX) b.classList.add('active');
    });

    state.detectedBpm = 0;
    state.loopEnabled = false;
    state.loopStart = 0;
    state.loopEnd = 0;
    state.loopBars = 4;
    if (loopUi.root) renderLoopEditor();
    hideLightning();
});

// ── Minimize panel ──
const minimizeBtn   = document.getElementById('minimize-btn');
const controlsPanel = document.getElementById('controls');
minimizeBtn.addEventListener('click', () => {
    controlsPanel.classList.toggle('collapsed');
    minimizeBtn.textContent = controlsPanel.classList.contains('collapsed') ? '+' : '−';
});

// ── Drag & drop audio ──
const dragOverlay = document.getElementById('drag-overlay');
let dragCounter = 0;
document.addEventListener('dragenter', (e) => {
    e.preventDefault(); dragCounter++;
    if (e.dataTransfer.types.includes('Files')) dragOverlay.classList.add('active');
});
document.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; dragOverlay.classList.remove('active'); }
});
document.addEventListener('dragover',  (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
    e.preventDefault(); dragCounter = 0; dragOverlay.classList.remove('active');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) await loadAudioFile(file);
});

// ── Keyboard shortcuts ──
document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        if (!document.fullscreenElement) {
            document.querySelector('.visualizer-container').requestFullscreen().catch(() => {});
        } else { document.exitFullscreen(); }
    }
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); if (state.audioLoaded) playBtn.click(); }
    if (e.key === 'h' || e.key === 'H') { e.preventDefault(); controlsPanel.classList.toggle('hidden'); }
    if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        const tog = document.getElementById('cinema-mode-toggle');
        if (tog) { tog.checked = !tog.checked; tog.dispatchEvent(new Event('change')); }
    }
});

// ── Section toggles ──
setupSectionToggle('galaxy-toggle-row',   'galaxy-body',   'galaxy-arrow',   true);
setupSectionToggle('morph-toggle-row',    'morph-body',    'morph-arrow',    true);
setupSectionToggle('cinema-toggle-row',   'cinema-body',   'cinema-arrow',   true);
setupSectionToggle('presets-toggle-row',  'presets-body',  'presets-arrow',  true);
setupSectionToggle('capture-toggle-row',  'capture-body',  'capture-arrow',  true);
setupSectionToggle('lightning-toggle-row','lightning-body','lightning-arrow', true);
setupSectionToggle('cmap-toggle-row',     'cmap-body',     'cmap-arrow',     true);
setupSectionToggle('keyboard-toggle-row', 'keyboard-body', 'keyboard-arrow', true);

// ── Button grids for selects ──
enhanceSelectAsButtonGrid('performance-preset-select', 'performance-preset-value');
enhanceSelectAsButtonGrid('camera-preset-select',      'camera-preset-value');
enhanceSelectAsButtonGrid('frame-size-select',         'frame-size-value');
enhanceSelectAsButtonGrid('galaxy-type-select',        'galaxy-type-value');
enhanceSelectAsButtonGrid('cinema-path-select',        'cinema-path-value');
enhanceSelectAsButtonGrid('cmap-distribution-select',  'cmap-distribution-value');

// ── Initial galaxy sync ──
(function syncInitialGalaxyType() {
    state.galaxyTypeKey  = 'core';
    state.galaxyArmCount = GALAXY_TYPES.core.armCount;
    state.galaxyArmTwist = GALAXY_TYPES.core.armTwist;
    const sel = document.getElementById('galaxy-type-select');
    const val = document.getElementById('galaxy-type-value');
    if (sel) sel.value = 'core';
    if (val) val.textContent = GALAXY_TYPES.core.label;
    buildGalaxy(state.galaxyArmCount, state.galaxyArmTwist, state.galaxyTypeKey);
    updateGalaxyDrawRange();
    refreshCurrentGalaxyColors();
})();

// ── Initial preset applies ──
applyPerformancePreset('quality', {
    applyPerformanceCounts: () => {
        updateGalaxyDrawRange();
        starGeo.setDrawRange(0, state.activeStarCount);
        scatterGeo.setDrawRange(0, state.activeScatterCount);
        haloGeo.setDrawRange(0, state.activeHaloCount);
        nebulaGeo.setDrawRange(0, state.activeNebulaCount);
    }
});
setCameraFromPreset('threeQuarter');
