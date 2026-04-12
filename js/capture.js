import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { downloadBlob } from './utils.js';
import { state } from './state.js';
import { camera, bloomPass, scene } from './renderer.js';
import { BLOOM_LAYER } from './constants.js';
import { suspendAudioLoopEnforcement } from './audio.js';
import { galaxyMat } from './galaxy.js';
import { starMat } from './stars.js';
import { haloMat, nebulaMat } from './nebula.js';
import { scatterMat } from './scatter.js';

const captureStatus = document.getElementById('capture-status');
const recordBtn = document.getElementById('record-btn');
const frameBtn = document.getElementById('frame-btn');
const exportKindMp4 = document.getElementById('export-kind-mp4');
const exportKindPng = document.getElementById('export-kind-png');
const exportKindValue = document.getElementById('export-kind-value');
const mp4Settings = document.getElementById('mp4-export-settings');
const pngSettings = document.getElementById('png-export-settings');
const formatSelect = document.getElementById('record-format-select');
const bitrateSelect = document.getElementById('record-bitrate-select');
const bitrateRow = document.getElementById('record-bitrate-row');
const loopOnlyToggle = document.getElementById('record-loop-only-toggle');
const formatValue = document.getElementById('record-format-value');
const bitrateValue = document.getElementById('record-bitrate-value');
const fpsSelect = document.getElementById('record-fps-select');
const fpsValue = document.getElementById('record-fps-value');
const rangeValue = document.getElementById('record-range-value');
const captureNote = document.getElementById('capture-note');
const resolutionNote = document.getElementById('capture-resolution-note');
const frameSizeSelect = document.getElementById('frame-size-select');
const frameSizeValue = document.getElementById('frame-size-value');
const frameOrientationSelect = document.getElementById('frame-orientation-select');
const frameOrientationValue = document.getElementById('frame-orientation-value');
const recordEstimateLine = document.getElementById('record-estimate-line');
const playBtn = document.getElementById('play-btn');

const EXPORT_PRESETS = {
    mp4_1080: { width: 1920, height: 1080, label: '1080p MP4' },
    mp4_4k: { width: 3840, height: 2160, label: '4K MP4' },
};
const FRAME_EXPORT_PRESETS = {
    '1080_landscape': { width: 1920, height: 1080, label: '1080p Landscape' },
    '1080_portrait': { width: 1080, height: 1920, label: '1080p Portrait' },
    '2160_landscape': { width: 3840, height: 2160, label: '4K Landscape' },
    '2160_portrait': { width: 2160, height: 3840, label: '4K Portrait' },
};

let recCanvas = null;
let recRenderer = null;
let recBloomComposer = null;
let recFinalComposer = null;
let recBloomPass = null;
let recFinalPass = null;   // kept so renderOffscreen can update its bloomTexture uniform each frame
let recWidth = EXPORT_PRESETS.mp4_4k.width;
let recHeight = EXPORT_PRESETS.mp4_4k.height;

let mp4Muxer = null;
let mp4Video = null;
let mp4Audio = null;
let scriptNode = null;
let audioTsUs = 0;
let mp4FrameCount = 0;
let mp4StartTime = null;
let mp4NextFrameDueMs = null;
let mp4LastTimestampUs = -1;
let mp4FrameRate = 60;
let mp4FrameDurationUs = Math.round(1_000_000 / 60);
let stopRequested = false;
let exportRange = null;
let exportCancelled = false;
export let isMP4Recording = false;
let Mp4MuxerLib = null;

let renderProgressOverlay = null;
let renderProgressTitle = null;
let renderProgressMeta = null;
let renderProgressBar = null;
let renderProgressPct = null;
let renderProgressSub = null;
let renderProgressCancelBtn = null;
let exportEstimatedBytes = 0;
let silentMonitorGain = null;
let exportTapGain = null;
let liveGainWasConnectedBeforeExport = false;

function ensureRenderProgressOverlay() {
    if (renderProgressOverlay) return;

    const style = document.createElement('style');
    style.textContent = `
    .render-progress-overlay {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        z-index: 5000;
        background: rgba(0,0,0,0.88);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
    }
    body.export-in-progress #beat-flash { display: none !important; }
    .render-progress-overlay.show { display: flex; }
    .render-progress-card {
        width: min(360px, calc(100vw - 32px));
        background: rgba(0, 0, 0, 0.86);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 16px;
        box-shadow: 0 18px 48px rgba(0,0,0,0.45);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        padding: 18px 18px 16px;
        color: #fff;
        pointer-events: auto;
    }
    .render-progress-title {
        font-family: 'Rajdhani', sans-serif;
        font-size: 22px;
        font-weight: 700;
        letter-spacing: 0.02em;
        margin-bottom: 4px;
    }
    .render-progress-meta, .render-progress-sub {
        font-family: 'Rajdhani', sans-serif;
        font-size: 13px;
        color: rgba(255,255,255,0.72);
        line-height: 1.4;
    }
    .render-progress-sub { margin-top: 8px; }
    .render-progress-bar-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 14px;
    }
    .render-progress-track {
        flex: 1;
        height: 10px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.08);
    }
    .render-progress-fill {
        width: 0%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, rgba(80,130,255,0.95) 0%, rgba(130,180,255,0.98) 100%);
        box-shadow: 0 0 18px rgba(90,150,255,0.45);
        transition: width 0.12s linear;
    }
    .render-progress-pct {
        font-family: 'Rajdhani', sans-serif;
        font-size: 14px;
        font-weight: 700;
        min-width: 38px;
        text-align: right;
        flex-shrink: 0;
    }
    .render-progress-row {
        display: flex;
        align-items: center;
        justify-content: center;
        margin-top: 10px;
    }
    .render-progress-cancel {
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.06);
        color: #fff;
        border-radius: 10px;
        padding: 8px 14px;
        cursor: pointer;
        font-family: 'Rajdhani', sans-serif;
        font-size: 13px;
        font-weight: 600;
        transition: background 0.18s ease, transform 0.18s ease;
        width: 50%;
    }
    .render-progress-cancel:hover { background: rgba(255,255,255,0.12); transform: translateY(-1px); }
    .render-progress-cancel:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
    `;
    document.head.appendChild(style);

    renderProgressOverlay = document.createElement('div');
    renderProgressOverlay.className = 'render-progress-overlay';
    renderProgressOverlay.innerHTML = `
        <div class="render-progress-card" role="dialog" aria-modal="true" aria-live="polite">
            <div class="render-progress-title">Rendering MP4</div>
            <div class="render-progress-meta"></div>
            <div class="render-progress-bar-row">
                <div class="render-progress-track"><div class="render-progress-fill"></div></div>
                <div class="render-progress-pct">0%</div>
            </div>
            <div class="render-progress-row">
                <button type="button" class="render-progress-cancel">Cancel</button>
            </div>
            <div class="render-progress-sub">Preparing export…</div>
        </div>
    `;
    document.body.appendChild(renderProgressOverlay);

    renderProgressTitle = renderProgressOverlay.querySelector('.render-progress-title');
    renderProgressMeta = renderProgressOverlay.querySelector('.render-progress-meta');
    renderProgressBar = renderProgressOverlay.querySelector('.render-progress-fill');
    renderProgressPct = renderProgressOverlay.querySelector('.render-progress-pct');
    renderProgressSub = renderProgressOverlay.querySelector('.render-progress-sub');
    renderProgressCancelBtn = renderProgressOverlay.querySelector('.render-progress-cancel');
    renderProgressCancelBtn.addEventListener('click', async () => {
        if (!state.isRecording) return;
        renderProgressCancelBtn.disabled = true;
        await stopMP4Export(true);
    });
}

function showRenderProgressOverlay(preset, range) {
    ensureRenderProgressOverlay();
    renderProgressTitle.textContent = 'Rendering MP4';
    renderProgressMeta.textContent = `${preset.label} · ${mp4FrameRate} fps · ${range.loopOnly ? 'Selected Loop' : 'Full Audio'} · Est. ${formatBytes(exportEstimatedBytes)}`;
    renderProgressCancelBtn.disabled = false;
    updateRenderProgressOverlay(0, range.start, range.end, 'Starting export…');
    document.body.classList.add('export-in-progress');
    renderProgressOverlay.classList.add('show');
}

function updateRenderProgressOverlay(progress, currentTime, endTime, subText = '') {
    if (!renderProgressOverlay) return;
    const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    renderProgressBar.style.width = `${(clamped * 100).toFixed(2)}%`;
    renderProgressPct.textContent = `${Math.round(clamped * 100)}%`;
    if (subText) {
        renderProgressSub.textContent = `${subText} · Est. ${formatBytes(exportEstimatedBytes)}`;
        return;
    }
    renderProgressSub.textContent = `${formatClock(currentTime)} / ${formatClock(endTime)} · Est. ${formatBytes(exportEstimatedBytes)}`;
}

function hideRenderProgressOverlay() {
    if (!renderProgressOverlay) return;
    renderProgressOverlay.classList.remove('show');
    document.body.classList.remove('export-in-progress');
}

function formatClock(seconds) {
    const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    const mins = Math.floor(safe / 60);
    const secs = safe - mins * 60;
    return `${mins}:${secs.toFixed(2).padStart(5, '0')}`;
}

function formatBytes(bytes) {
    const safe = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
    if (safe >= 1024 ** 3) return `${(safe / (1024 ** 3)).toFixed(2)} GB`;
    if (safe >= 1024 ** 2) return `${(safe / (1024 ** 2)).toFixed(1)} MB`;
    if (safe >= 1024) return `${Math.round(safe / 1024)} KB`;
    return `${Math.round(safe)} B`;
}

function getResolutionScaleForPreset(preset) {
    const basePixels = 1920 * 1080;
    const pixels = Math.max(1, (preset?.width || 1920) * (preset?.height || 1080));
    return pixels / basePixels;
}

function getConfiguredVideoBitrateMbps() {
    return Math.max(1, parseInt(bitrateSelect?.value || '16', 10) || 16);
}

function getEffectiveVideoBitrateMbps(preset = getSelectedPreset()) {
    return getConfiguredVideoBitrateMbps() * getResolutionScaleForPreset(preset);
}

function getEffectiveVideoBitrate(preset = getSelectedPreset()) {
    return Math.round(getEffectiveVideoBitrateMbps(preset) * 1_000_000);
}

function getEstimatedExportBytes() {
    if (!state.audioElement?.duration) return 0;
    const preset = getSelectedPreset();
    const loopOnly = getLoopOnlyActive();
    const duration = Math.max(0, loopOnly ? (state.loopEnd - state.loopStart) : state.audioElement.duration);
    const videoBitrateMbps = getEffectiveVideoBitrateMbps(preset);
    const audioBitrateMbps = 0.192;
    const totalBits = duration * ((videoBitrateMbps + audioBitrateMbps) * 1_000_000) * 1.02;
    return totalBits / 8;
}

function syncEstimatedSizeUI() {
    exportEstimatedBytes = getEstimatedExportBytes();
    if (recordEstimateLine) recordEstimateLine.textContent = `Estimated file size: ${formatBytes(exportEstimatedBytes)}`;
}

function setExportKind(kind) {
    const usePng = kind === 'png';
    if (exportKindMp4) exportKindMp4.checked = !usePng;
    if (exportKindPng) exportKindPng.checked = usePng;
    if (exportKindValue) exportKindValue.textContent = usePng ? 'PNG' : 'MP4';
    if (mp4Settings) mp4Settings.style.display = usePng ? 'none' : '';
    if (pngSettings) pngSettings.style.display = usePng ? '' : 'none';
}

function syncPlayButton(isPlaying) {
    if (!playBtn) return;
    playBtn.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
    playBtn.className = isPlaying ? 'pause' : 'play';
}

function getSelectedPreset() {
    return EXPORT_PRESETS[formatSelect?.value] || EXPORT_PRESETS.mp4_4k;
}

function getSelectedFps() {
    return Math.max(1, parseInt(fpsSelect?.value || '60', 10) || 60);
}

function getExportPointScale(width, height) {
    return Math.max(1, Math.sqrt((width * height) / (1920 * 1080)));
}

function setExportPointScale(scale = 1) {
    const mats = [galaxyMat, starMat, haloMat, nebulaMat, scatterMat];
    for (const mat of mats) {
        if (mat?.uniforms?.uPointScale) mat.uniforms.uPointScale.value = scale;
    }
}

function buildRecordingPipeline(width, height) {
    recWidth = width;
    recHeight = height;
    setExportPointScale(getExportPointScale(width, height));
    recCanvas = document.createElement('canvas');
    recCanvas.width = width;
    recCanvas.height = height;

    recRenderer = new THREE.WebGLRenderer({
        canvas: recCanvas,
        antialias: true,
        preserveDrawingBuffer: true,
        alpha: false,
        powerPreference: 'high-performance',
    });
    recRenderer.setPixelRatio(1);
    recRenderer.setSize(width, height);
    recRenderer.setClearColor(0x000000);

    recBloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), bloomPass.strength, bloomPass.radius, bloomPass.threshold);
    recBloomComposer = new EffectComposer(recRenderer);
    recBloomComposer.renderToScreen = false;
    recBloomComposer.addPass(new RenderPass(scene, camera));
    recBloomComposer.addPass(recBloomPass);

    const finalMat = new THREE.ShaderMaterial({
        uniforms: {
            baseTexture: { value: null },
            bloomTexture: { value: recBloomComposer.renderTarget2.texture },
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv; void main() { gl_FragColor = texture2D(baseTexture,vUv) + texture2D(bloomTexture,vUv); }`,
        transparent: true,
    });
    recFinalPass = new ShaderPass(finalMat, 'baseTexture');
    recFinalComposer = new EffectComposer(recRenderer);
    recFinalComposer.addPass(new RenderPass(scene, camera));
    recFinalComposer.addPass(recFinalPass);
}

function destroyRecordingPipeline() {
    setExportPointScale(1);
    if (recRenderer) recRenderer.dispose();
    recCanvas = null;
    recRenderer = null;
    recBloomComposer = null;
    recFinalComposer = null;
    recBloomPass = null;
    recFinalPass = null;
}

function renderOffscreen() {
    if (!recCanvas) return;
    const is4K = recWidth >= 3840;
    recBloomPass.strength = bloomPass.strength * (is4K ? 2.0 : 1.0);
    recBloomPass.radius = bloomPass.radius;
    recBloomPass.threshold = bloomPass.threshold;

    const savedAspect = camera.aspect;
    camera.aspect = recWidth / recHeight;
    camera.updateProjectionMatrix();

    camera.layers.set(BLOOM_LAYER);
    recBloomComposer.render();

    // ── Fix 1: refresh bloom texture reference each frame.
    // EffectComposer ping-pongs between renderTarget1/2 on every pass; the texture
    // that holds the bloom result can flip between renders. Reading it fresh from
    // readBuffer after the bloom composer finishes guarantees we sample the correct
    // frame instead of the previous one (which caused ghosting / doubled-frame artifacts).
    if (recFinalPass?.material?.uniforms?.bloomTexture) {
        recFinalPass.material.uniforms.bloomTexture.value = recBloomComposer.readBuffer.texture;
    }

    camera.layers.set(0);
    recFinalComposer.render();

    // ── Fix 2: GPU sync before VideoFrame pixel readback.
    // WebGL command submission is asynchronous — without gl.finish() the GPU may
    // still be executing the last draw calls when VideoFrame(canvas) snapshots the
    // framebuffer, producing partial / torn frames in the encoded MP4.
    recRenderer.getContext().finish();

    camera.aspect = savedAspect;
    camera.updateProjectionMatrix();
}

function getSelectedFramePreset() {
    const sizeKey = frameSizeSelect?.value || '1080';
    const orientationKey = frameOrientationSelect?.value || 'landscape';
    return FRAME_EXPORT_PRESETS[`${sizeKey}_${orientationKey}`] || FRAME_EXPORT_PRESETS['1080_landscape'];
}

function syncFrameUI() {
    const preset = getSelectedFramePreset();
    if (frameSizeValue) frameSizeValue.textContent = preset.label.startsWith('4K') ? '4K' : '1080p';
    if (frameOrientationValue) frameOrientationValue.textContent = preset.label.includes('Portrait') ? 'Portrait' : 'Landscape';
}

async function exportFrame() {
    const preset = getSelectedFramePreset();
    buildRecordingPipeline(preset.width, preset.height);
    try {
        renderOffscreen();
        await new Promise((resolve) => {
            const name = `galaxy_frame_${preset.label.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}.png`;
            const finish = (blob) => {
                if (!blob) {
                    const a = document.createElement('a');
                    a.href = recCanvas.toDataURL('image/png');
                    a.download = name;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                } else {
                    downloadBlob(blob, name);
                }
                resolve();
            };
            if (recCanvas.toBlob) recCanvas.toBlob(finish, 'image/png');
            else finish(null);
        });
    } finally {
        destroyRecordingPipeline();
    }
}

async function loadMp4Muxer() {
    if (!Mp4MuxerLib) Mp4MuxerLib = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5/+esm');
    return Mp4MuxerLib;
}

function pickAvcCodec() {
    return 'avc1.640033';
}

async function startAudioEncoding(sampleRate) {
    if (!window.AudioEncoder || !state.audioContext || !state.audioSource) return false;
    const cfg = { codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate: 192_000 };
    if (!(await AudioEncoder.isConfigSupported(cfg)).supported) return false;

    audioTsUs = 0;
    mp4Audio = new AudioEncoder({
        output: (chunk, meta) => mp4Muxer && mp4Muxer.addAudioChunk(chunk, meta),
        error: (e) => console.error('AudioEncoder:', e),
    });
    mp4Audio.configure(cfg);

    exportTapGain = state.audioContext.createGain();
    exportTapGain.gain.value = 1;
    scriptNode = state.audioContext.createScriptProcessor(4096, 2, 2);
    scriptNode.onaudioprocess = (e) => {
        if (!mp4Audio || mp4Audio.state === 'closed') return;
        const input = e.inputBuffer;
        const n = input.length;
        const sr = input.sampleRate;
        const ch = Math.min(2, input.numberOfChannels || 2);
        const ch0 = input.getChannelData(0);
        const ch1 = ch > 1 ? input.getChannelData(1) : ch0;
        const data = new Float32Array(n * 2);
        data.set(ch0, 0);
        data.set(ch1, n);
        const ad = new AudioData({
            format: 'f32-planar',
            sampleRate: sr,
            numberOfFrames: n,
            numberOfChannels: 2,
            timestamp: audioTsUs,
            data,
        });
        mp4Audio.encode(ad);
        ad.close();
        audioTsUs += Math.round((n / sr) * 1_000_000);
    };
    silentMonitorGain = state.audioContext.createGain();
    silentMonitorGain.gain.value = 0;
    state.audioSource.connect(exportTapGain);
    exportTapGain.connect(scriptNode);
    scriptNode.connect(silentMonitorGain);
    silentMonitorGain.connect(state.audioContext.destination);
    return true;
}

function stopAudioEncoding() {
    if (scriptNode) {
        try { scriptNode.disconnect(); } catch (_) {}
        scriptNode = null;
    }
    if (exportTapGain) {
        try { exportTapGain.disconnect(); } catch (_) {}
        exportTapGain = null;
    }
    if (silentMonitorGain) {
        try { silentMonitorGain.disconnect(); } catch (_) {}
        silentMonitorGain = null;
    }
}

function muteLiveAudioForExport() {
    liveGainWasConnectedBeforeExport = !!(state.gainNode && state.gainNodeConnected);
    if (state.gainNode && state.audioContext?.destination && state.gainNodeConnected) {
        try { state.gainNode.disconnect(state.audioContext.destination); } catch (_) {}
        state.gainNodeConnected = false;
    }
}

function restoreLiveAudioAfterExport() {
    if (state.gainNode && state.audioContext?.destination && liveGainWasConnectedBeforeExport && !state.gainNodeConnected) {
        try { state.gainNode.connect(state.audioContext.destination); state.gainNodeConnected = true; } catch (_) {}
    }
    liveGainWasConnectedBeforeExport = false;
}

function getLoopOnlyActive() {
    return !!(loopOnlyToggle?.checked && state.loopEnabled && state.loopEnd > state.loopStart);
}

function syncRangeUI() {
    const hasLoop = !!(state.loopEnabled && state.loopEnd > state.loopStart);
    const loopOnly = getLoopOnlyActive();
    if (rangeValue) rangeValue.textContent = loopOnly ? 'Selected Loop' : 'Full Audio';
    if (resolutionNote) {
        resolutionNote.textContent = hasLoop
            ? 'Exports the full track by default. Turn on the option below to export only the selected loop.'
            : 'No loop is active right now, so Record will export the full track.';
    }
    syncEstimatedSizeUI();
}

function syncFormatUI() {
    const preset = getSelectedPreset();
    const fps = getSelectedFps();
    const configuredMbps = getConfiguredVideoBitrateMbps();
    const effectiveMbps = getEffectiveVideoBitrateMbps(preset);
    if (formatValue) formatValue.textContent = preset.label;
    if (bitrateValue && bitrateSelect) {
        bitrateValue.textContent = preset.height >= 2160
            ? `${configuredMbps} Mbps base · ${effectiveMbps.toFixed(0)} Mbps effective`
            : `${configuredMbps} Mbps`;
    }
    if (fpsValue) fpsValue.textContent = `${fps} fps`;
    if (captureNote) {
        captureNote.textContent = preset.height >= 2160
            ? `${preset.label} · ${fps} fps · H.264 · 4× pixel density bitrate scaling`
            : `${preset.label} · ${fps} fps: Chrome/Edge · H.264 · auto-stops at end`;
    }
    if (bitrateRow) bitrateRow.style.display = '';
    syncRangeUI();
}

async function startMP4Export() {
    if (!state.audioLoaded || !state.audioElement || !state.audioElement.duration) {
        captureStatus.textContent = 'Load an audio file first.';
        return;
    }
    if (!window.VideoEncoder) {
        captureStatus.textContent = 'MP4 export requires Chrome 94+ or Edge.';
        return;
    }

    const preset = getSelectedPreset();
    const bitrateMbps = getEffectiveVideoBitrateMbps(preset);
    const bitrate = getEffectiveVideoBitrate(preset);
    const codec = pickAvcCodec();
    mp4FrameRate = getSelectedFps();
    mp4FrameDurationUs = Math.round(1_000_000 / mp4FrameRate);

    const vOk = await VideoEncoder.isConfigSupported({
        codec,
        width: preset.width,
        height: preset.height,
        bitrate,
        framerate: mp4FrameRate,
    });
    if (!vOk.supported) {
        captureStatus.textContent = `${preset.label} is not supported in this browser.`;
        return;
    }

    const loopOnly = getLoopOnlyActive();
    exportRange = {
        loopOnly,
        start: loopOnly ? state.loopStart : 0,
        end: loopOnly ? state.loopEnd : state.audioElement.duration,
    };
    stopRequested = false;
    exportCancelled = false;

    if (state.audioContext && state.audioContext.state === 'suspended') {
        try { await state.audioContext.resume(); } catch (_) {}
    }
    exportEstimatedBytes = getEstimatedExportBytes();

    const { Muxer, ArrayBufferTarget } = await loadMp4Muxer();
    const sampleRate = state.audioContext ? state.audioContext.sampleRate : 48000;
    const aOk = window.AudioEncoder && state.audioSource &&
        (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate: 192_000 })).supported;

    buildRecordingPipeline(preset.width, preset.height);
    showRenderProgressOverlay(preset, exportRange);

    mp4Muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: 'avc', width: preset.width, height: preset.height },
        ...(aOk && { audio: { codec: 'aac', sampleRate, numberOfChannels: 2 } }),
        fastStart: 'in-memory',
    });

    mp4Video = new VideoEncoder({
        output: (chunk, meta) => mp4Muxer.addVideoChunk(chunk, meta),
        error: (e) => { captureStatus.textContent = 'Video encode error: ' + e.message; stopMP4Export(true); },
    });
    mp4Video.configure({ codec, width: preset.width, height: preset.height, bitrate, framerate: mp4FrameRate, latencyMode: 'quality' });

    muteLiveAudioForExport();
    if (aOk) await startAudioEncoding(sampleRate);

    mp4FrameCount = 0;
    mp4StartTime = null;
    mp4NextFrameDueMs = null;
    mp4LastTimestampUs = -1;
    isMP4Recording = true;
    state.isRecording = true;

    suspendAudioLoopEnforcement(true);
    try { state.audioElement.pause(); } catch (_) {}
    state.audioElement.currentTime = exportRange.start;
    await state.audioElement.play();
    state.isPlaying = true;
    syncPlayButton(true);

    recordBtn.textContent = 'Cancel Export';
    captureStatus.textContent = `Exporting ${loopOnly ? 'selected loop' : 'full audio'} as ${preset.label} (${bitrateMbps.toFixed(0)} Mbps)…`;
}

async function stopMP4Export(cancelled = false) {
    if (!isMP4Recording) return;
    isMP4Recording = false;
    state.isRecording = false;
    exportCancelled = cancelled;
    captureStatus.textContent = cancelled ? 'Cancelling export…' : 'Finalising export…';
    updateRenderProgressOverlay(cancelled ? 0 : 1, exportRange ? exportRange.end : 0, exportRange ? exportRange.end : 0, cancelled ? 'Cancelling export…' : 'Finalising export…');

    try {
        stopAudioEncoding();
        if (state.audioElement) {
            try { state.audioElement.pause(); } catch (_) {}
            state.isPlaying = false;
            syncPlayButton(false);
            state.audioElement.currentTime = exportRange ? exportRange.start : 0;
        }
        if (mp4Audio) {
            await mp4Audio.flush();
            mp4Audio.close();
            mp4Audio = null;
        }
        if (mp4Video) await mp4Video.flush();
        if (!cancelled && mp4Muxer) {
            mp4Muxer.finalize();
            const blob = new Blob([mp4Muxer.target.buffer], { type: 'video/mp4' });
            const preset = getSelectedPreset();
            const suffix = exportRange?.loopOnly ? '_loop' : '_full';
            downloadBlob(blob, `galaxy_${preset.height}p${suffix}_${Date.now()}.mp4`);
            captureStatus.textContent = `MP4 saved (${mp4FrameCount} frames · ${formatBytes(blob.size)}).`;
        } else if (cancelled) {
            captureStatus.textContent = 'Export cancelled.';
        }
    } catch (e) {
        console.error(e);
        captureStatus.textContent = 'Export failed: ' + e.message;
    } finally {
        suspendAudioLoopEnforcement(false);
        restoreLiveAudioAfterExport();
        mp4Audio = null;
        mp4Video = null;
        mp4Muxer = null;
        destroyRecordingPipeline();
        recordBtn.textContent = 'Record';
        hideRenderProgressOverlay();
        exportRange = null;
        stopRequested = false;
    }
}

export function captureFrame(now) {
    if (!state.isRecording || !recCanvas) return;
    renderOffscreen();

    if (isMP4Recording && mp4Video && mp4Video.encodeQueueSize <= 15) {
        if (mp4StartTime === null) {
            mp4StartTime = now;
            mp4NextFrameDueMs = now;
        }

        // Wall-clock gate: only capture when enough real time has passed for the next
        // frame slot. Unlike the previous do-while that advanced multiple slots at once
        // (causing PTS gaps → tears), we advance by exactly one slot per capture.
        // If rendering is slow we'll be behind, but we still emit at most one frame per
        // animate() call — never skipping a timestamp.
        if (now >= mp4NextFrameDueMs) {
            // Anchor PTS to audio playback time, not the frame counter.
            // If the GPU renders 4K slower than real-time, frame-counter PTS would
            // make the video shorter than the audio track → desync. Using the audio
            // element's currentTime as the canonical clock keeps them locked together.
            const audioSec = state.audioElement
                ? Math.max(0, state.audioElement.currentTime - (exportRange?.start ?? 0))
                : mp4FrameCount * (mp4FrameDurationUs / 1_000_000);
            // Encoder requires strictly monotonically increasing timestamps.
            const timestampUs = Math.max(mp4LastTimestampUs + 1, Math.round(audioSec * 1_000_000));

            let frame;
            try {
                frame = new VideoFrame(recCanvas, { timestamp: timestampUs, duration: mp4FrameDurationUs });
            } catch (_) {
                return;
            }
            mp4Video.encode(frame, { keyFrame: mp4FrameCount % mp4FrameRate === 0 });
            frame.close();
            mp4LastTimestampUs = timestampUs;
            mp4FrameCount++;
            // Advance by exactly one frame — never loop to "catch up"
            mp4NextFrameDueMs += 1000 / mp4FrameRate;
        }
    }

    if (exportRange && state.audioElement) {
        const t = Math.max(exportRange.start, Math.min(exportRange.end, state.audioElement.currentTime));
        const total = Math.max(0.0001, exportRange.end - exportRange.start);
        const progress = (t - exportRange.start) / total;
        updateRenderProgressOverlay(progress, t, exportRange.end);

        if (!stopRequested && (t >= exportRange.end - (1 / Math.max(120, mp4FrameRate * 2)) || state.audioElement.ended)) {
            stopRequested = true;
            queueMicrotask(() => stopMP4Export(false));
        }
    }
}

recordBtn.addEventListener('click', async () => {
    if (state.isRecording) {
        await stopMP4Export(true);
    } else {
        await startMP4Export();
    }
});

frameBtn.addEventListener('click', async () => {
    const preset = getSelectedFramePreset();
    captureStatus.textContent = `Saving frame (${preset.label})…`;
    try {
        await exportFrame();
        captureStatus.textContent = `Frame saved (${preset.label}).`;
    } catch (e) {
        captureStatus.textContent = 'Frame capture failed.';
    }
});

formatSelect?.addEventListener('change', syncFormatUI);
bitrateSelect?.addEventListener('change', syncFormatUI);
fpsSelect?.addEventListener('change', syncFormatUI);
loopOnlyToggle?.addEventListener('change', syncRangeUI);
frameSizeSelect?.addEventListener('change', syncFrameUI);
frameOrientationSelect?.addEventListener('change', syncFrameUI);
exportKindMp4?.addEventListener('change', () => setExportKind(exportKindMp4.checked ? 'mp4' : 'png'));
exportKindPng?.addEventListener('change', () => setExportKind(exportKindPng.checked ? 'png' : 'mp4'));
document.addEventListener('galaxy-loop-updated', syncRangeUI);
setExportKind('mp4');
syncFormatUI();
syncFrameUI();

(function () {
    const row = document.getElementById('capture-toggle-row');
    const body = document.getElementById('capture-body');
    const arrow = document.getElementById('capture-arrow');
    if (!row || !body || !arrow) return;
    row.addEventListener('click', () => {
        const collapsed = body.classList.toggle('collapsed');
        arrow.classList.toggle('open', !collapsed);
    });
})();
