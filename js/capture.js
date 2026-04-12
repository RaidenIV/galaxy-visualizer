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

const captureStatus = document.getElementById('capture-status');
const recordBtn = document.getElementById('record-btn');
const frameBtn = document.getElementById('frame-btn');
const formatSelect = document.getElementById('record-format-select');
const bitrateSelect = document.getElementById('record-bitrate-select');
const bitrateRow = document.getElementById('record-bitrate-row');
const loopOnlyToggle = document.getElementById('record-loop-only-toggle');
const formatValue = document.getElementById('record-format-value');
const bitrateValue = document.getElementById('record-bitrate-value');
const rangeValue = document.getElementById('record-range-value');
const captureNote = document.getElementById('capture-note');
const resolutionNote = document.getElementById('capture-resolution-note');
const playBtn = document.getElementById('play-btn');

const EXPORT_PRESETS = {
    mp4_1080: { width: 1920, height: 1080, label: '1080p MP4' },
    mp4_4k: { width: 3840, height: 2160, label: '4K MP4' },
};
const FRAME_EXPORT = { width: 3840, height: 2160, label: '4K' };

let recCanvas = null;
let recRenderer = null;
let recBloomComposer = null;
let recFinalComposer = null;
let recBloomPass = null;
let recWidth = EXPORT_PRESETS.mp4_4k.width;
let recHeight = EXPORT_PRESETS.mp4_4k.height;

let mp4Muxer = null;
let mp4Video = null;
let mp4Audio = null;
let scriptNode = null;
let audioTsUs = 0;
let mp4FrameCount = 0;
let mp4StartTime = null;
let mp4LastTime = null;
let stopRequested = false;
let exportRange = null;
let exportCancelled = false;
export let isMP4Recording = false;
let Mp4MuxerLib = null;

function syncPlayButton(isPlaying) {
    if (!playBtn) return;
    playBtn.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
    playBtn.className = isPlaying ? 'pause' : 'play';
}

function getSelectedPreset() {
    return EXPORT_PRESETS[formatSelect?.value] || EXPORT_PRESETS.mp4_4k;
}

function buildRecordingPipeline(width, height) {
    recWidth = width;
    recHeight = height;
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
    recFinalComposer = new EffectComposer(recRenderer);
    recFinalComposer.addPass(new RenderPass(scene, camera));
    recFinalComposer.addPass(new ShaderPass(finalMat, 'baseTexture'));
}

function destroyRecordingPipeline() {
    if (recRenderer) recRenderer.dispose();
    recCanvas = null;
    recRenderer = null;
    recBloomComposer = null;
    recFinalComposer = null;
    recBloomPass = null;
}

function renderOffscreen() {
    if (!recCanvas) return;
    recBloomPass.strength = bloomPass.strength;
    recBloomPass.radius = bloomPass.radius;
    recBloomPass.threshold = bloomPass.threshold;

    const savedAspect = camera.aspect;
    camera.aspect = recWidth / recHeight;
    camera.updateProjectionMatrix();

    camera.layers.set(BLOOM_LAYER);
    recBloomComposer.render();
    camera.layers.set(0);
    recFinalComposer.render();

    camera.aspect = savedAspect;
    camera.updateProjectionMatrix();
}

async function exportFrame() {
    buildRecordingPipeline(FRAME_EXPORT.width, FRAME_EXPORT.height);
    try {
        renderOffscreen();
        await new Promise((resolve) => {
            const name = `galaxy_frame_4K_${Date.now()}.png`;
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
    if (!window.AudioEncoder || !state.audioContext || !state.gainNode) return false;
    const cfg = { codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate: 192_000 };
    if (!(await AudioEncoder.isConfigSupported(cfg)).supported) return false;

    audioTsUs = 0;
    mp4Audio = new AudioEncoder({
        output: (chunk, meta) => mp4Muxer && mp4Muxer.addAudioChunk(chunk, meta),
        error: (e) => console.error('AudioEncoder:', e),
    });
    mp4Audio.configure(cfg);

    scriptNode = state.audioContext.createScriptProcessor(4096, 2, 2);
    scriptNode.onaudioprocess = (e) => {
        if (!mp4Audio || mp4Audio.state === 'closed') return;
        const n = e.inputBuffer.length;
        const sr = e.inputBuffer.sampleRate;
        const data = new Float32Array(n * 2);
        data.set(e.inputBuffer.getChannelData(0), 0);
        data.set(e.inputBuffer.getChannelData(1), n);
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
    state.gainNode.connect(scriptNode);
    scriptNode.connect(state.audioContext.destination);
    return true;
}

function stopAudioEncoding() {
    if (scriptNode) {
        try { scriptNode.disconnect(); } catch (_) {}
        scriptNode = null;
    }
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
}

function syncFormatUI() {
    const preset = getSelectedPreset();
    if (formatValue) formatValue.textContent = preset.label;
    if (bitrateValue && bitrateSelect) bitrateValue.textContent = `${bitrateSelect.value} Mbps`;
    if (captureNote) captureNote.textContent = `${preset.label}: Chrome/Edge · H.264 · auto-stops at end`;
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
    const bitrateMbps = bitrateSelect ? parseInt(bitrateSelect.value, 10) : 16;
    const bitrate = bitrateMbps * 1_000_000;
    const codec = pickAvcCodec();

    const vOk = await VideoEncoder.isConfigSupported({
        codec,
        width: preset.width,
        height: preset.height,
        bitrate,
        framerate: 60,
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

    const { Muxer, ArrayBufferTarget } = await loadMp4Muxer();
    const sampleRate = state.audioContext ? state.audioContext.sampleRate : 48000;
    const aOk = window.AudioEncoder && state.gainNode &&
        (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate: 192_000 })).supported;

    buildRecordingPipeline(preset.width, preset.height);

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
    mp4Video.configure({ codec, width: preset.width, height: preset.height, bitrate, framerate: 60, latencyMode: 'quality' });

    if (aOk) await startAudioEncoding(sampleRate);

    mp4FrameCount = 0;
    mp4StartTime = null;
    mp4LastTime = null;
    isMP4Recording = true;
    state.isRecording = true;

    suspendAudioLoopEnforcement(true);
    try { state.audioElement.pause(); } catch (_) {}
    state.audioElement.currentTime = exportRange.start;
    await state.audioElement.play();
    state.isPlaying = true;
    syncPlayButton(true);

    recordBtn.textContent = 'Cancel Export';
    captureStatus.textContent = `Exporting ${loopOnly ? 'selected loop' : 'full audio'} as ${preset.label}…`;
}

async function stopMP4Export(cancelled = false) {
    if (!isMP4Recording) return;
    isMP4Recording = false;
    state.isRecording = false;
    exportCancelled = cancelled;
    captureStatus.textContent = cancelled ? 'Cancelling export…' : 'Finalising export…';

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
            captureStatus.textContent = `MP4 saved (${mp4FrameCount} frames).`;
        } else if (cancelled) {
            captureStatus.textContent = 'Export cancelled.';
        }
    } catch (e) {
        console.error(e);
        captureStatus.textContent = 'Export failed: ' + e.message;
    } finally {
        suspendAudioLoopEnforcement(false);
        mp4Video = null;
        mp4Muxer = null;
        destroyRecordingPipeline();
        recordBtn.textContent = 'Record';
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
            mp4LastTime = now;
        }
        const timestampUs = Math.round((now - mp4StartTime) * 1000);
        const durationUs = Math.max(1, Math.round((now - mp4LastTime) * 1000));
        mp4LastTime = now;
        let frame;
        try {
            frame = new VideoFrame(recCanvas, { timestamp: timestampUs, duration: durationUs });
        } catch (_) {
            return;
        }
        mp4Video.encode(frame, { keyFrame: mp4FrameCount % 60 === 0 });
        frame.close();
        mp4FrameCount++;
    }

    if (!stopRequested && exportRange && state.audioElement) {
        const t = state.audioElement.currentTime;
        if (t >= exportRange.end - (1 / 120) || state.audioElement.ended) {
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
    captureStatus.textContent = 'Saving frame (4K)…';
    try {
        await exportFrame();
        captureStatus.textContent = 'Frame saved (4K).';
    } catch (e) {
        captureStatus.textContent = 'Frame capture failed.';
    }
});

formatSelect?.addEventListener('change', syncFormatUI);
bitrateSelect?.addEventListener('change', syncFormatUI);
loopOnlyToggle?.addEventListener('change', syncRangeUI);
document.addEventListener('galaxy-loop-updated', syncRangeUI);
syncFormatUI();

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
