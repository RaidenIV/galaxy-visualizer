import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }     from 'three/addons/postprocessing/ShaderPass.js';
import { downloadBlob } from './utils.js';
import { state } from './state.js';
import { camera, bloomPass, scene } from './renderer.js';
import { BLOOM_LAYER } from './constants.js';

// ── DOM refs ──
const captureStatus  = document.getElementById('capture-status');
const recordBtn      = document.getElementById('record-btn');
const frameBtn       = document.getElementById('frame-btn');
const formatSelect   = document.getElementById('record-format-select');
const bitrateSelect  = document.getElementById('record-bitrate-select');
const bitrateRow     = document.getElementById('record-bitrate-row');

// ── All exports are always 4K ──
const EXPORT_W = 3840;
const EXPORT_H = 2160;

// ── Offscreen recording pipeline ──
let recCanvas        = null;
let recRenderer      = null;
let recBloomComposer = null;
let recFinalComposer = null;
let recBloomPass     = null;

function buildRecordingPipeline() {
    recCanvas        = document.createElement('canvas');
    recCanvas.width  = EXPORT_W;
    recCanvas.height = EXPORT_H;

    recRenderer = new THREE.WebGLRenderer({
        canvas: recCanvas,
        antialias: true,
        preserveDrawingBuffer: true,
        alpha: false,
        powerPreference: 'high-performance',
    });
    recRenderer.setPixelRatio(1);
    recRenderer.setSize(EXPORT_W, EXPORT_H);
    recRenderer.setClearColor(0x000000);

    recBloomPass = new UnrealBloomPass(
        new THREE.Vector2(EXPORT_W, EXPORT_H),
        bloomPass.strength, bloomPass.radius, bloomPass.threshold
    );
    recBloomComposer = new EffectComposer(recRenderer);
    recBloomComposer.renderToScreen = false;
    recBloomComposer.addPass(new RenderPass(scene, camera));
    recBloomComposer.addPass(recBloomPass);

    const finalMat = new THREE.ShaderMaterial({
        uniforms: {
            baseTexture:  { value: null },
            bloomTexture: { value: recBloomComposer.renderTarget2.texture },
        },
        vertexShader: `
            varying vec2 vUv;
            void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
        `,
        fragmentShader: `
            uniform sampler2D baseTexture;
            uniform sampler2D bloomTexture;
            varying vec2 vUv;
            void main() { gl_FragColor = texture2D(baseTexture,vUv) + texture2D(bloomTexture,vUv); }
        `,
        transparent: true,
    });
    recFinalComposer = new EffectComposer(recRenderer);
    recFinalComposer.addPass(new RenderPass(scene, camera));
    recFinalComposer.addPass(new ShaderPass(finalMat, 'baseTexture'));
}

function destroyRecordingPipeline() {
    if (recRenderer) { recRenderer.dispose(); recRenderer = null; }
    recCanvas = recBloomComposer = recFinalComposer = recBloomPass = null;
}

function renderOffscreen() {
    recBloomPass.strength  = bloomPass.strength;
    recBloomPass.radius    = bloomPass.radius;
    recBloomPass.threshold = bloomPass.threshold;

    const savedAspect = camera.aspect;
    camera.aspect = EXPORT_W / EXPORT_H;
    camera.updateProjectionMatrix();

    camera.layers.set(BLOOM_LAYER);
    recBloomComposer.render();
    camera.layers.set(0);
    recFinalComposer.render();

    camera.aspect = savedAspect;
    camera.updateProjectionMatrix();
}

// ── PNG frame export — always 4K ──
async function exportFrame() {
    buildRecordingPipeline();
    try {
        renderOffscreen();
        await new Promise((resolve) => {
            const name = `galaxy_frame_4K_${Date.now()}.png`;
            const finish = (blob) => {
                if (!blob) {
                    const a = document.createElement('a');
                    a.href = recCanvas.toDataURL('image/png');
                    a.download = name;
                    document.body.appendChild(a); a.click(); a.remove();
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

// ── WebM recording ──
let webmRecorder = null;
let webmChunks   = [];

function pickWebMType() {
    const c = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
    return c.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
}

async function startWebMRecording() {
    if (!window.MediaRecorder) { captureStatus.textContent = 'MediaRecorder not supported.'; return; }
    if (state.audioContext && state.audioContext.state === 'suspended') {
        try { await state.audioContext.resume(); } catch (_) {}
    }

    buildRecordingPipeline();

    const videoTracks = recCanvas.captureStream(60).getVideoTracks();
    const audioTracks = (state.mediaDest && state.mediaDest.stream)
        ? state.mediaDest.stream.getAudioTracks() : [];
    const stream   = new MediaStream([...videoTracks, ...audioTracks]);
    const mimeType = pickWebMType();

    webmChunks = [];
    webmRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    webmRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) webmChunks.push(e.data); };
    webmRecorder.onstop = () => {
        destroyRecordingPipeline();
        const blob = new Blob(webmChunks, { type: mimeType || 'video/webm' });
        downloadBlob(blob, `galaxy_${Date.now()}.webm`);
        captureStatus.textContent = 'WebM saved.';
        state.isRecording = false;
        recordBtn.textContent = '● Start Recording';
    };
    webmRecorder.start();
    state.isRecording = true;
    recordBtn.textContent = '■ Stop Recording';
    captureStatus.textContent = `Recording WebM (4K)…`;
}

function stopWebMRecording() { if (webmRecorder) webmRecorder.stop(); }

// ── Audio encoding (MP4 only) ──
let mp4Audio     = null;
let scriptNode   = null;
let audioTsUs    = 0;

async function startAudioEncoding(sampleRate) {
    if (!window.AudioEncoder || !state.audioContext || !state.gainNode) return false;
    const cfg = { codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate: 192_000 };
    if (!(await AudioEncoder.isConfigSupported(cfg)).supported) return false;

    audioTsUs = 0;
    mp4Audio  = new AudioEncoder({
        output: (chunk, meta) => mp4Muxer && mp4Muxer.addAudioChunk(chunk, meta),
        error:  (e) => console.error('AudioEncoder:', e),
    });
    mp4Audio.configure(cfg);

    scriptNode = state.audioContext.createScriptProcessor(4096, 2, 2);
    scriptNode.onaudioprocess = (e) => {
        if (!mp4Audio || mp4Audio.state === 'closed') return;
        const n  = e.inputBuffer.length;
        const sr = e.inputBuffer.sampleRate;
        const data = new Float32Array(n * 2);
        data.set(e.inputBuffer.getChannelData(0), 0);
        data.set(e.inputBuffer.getChannelData(1), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: audioTsUs, data });
        mp4Audio.encode(ad);
        ad.close();
        audioTsUs += Math.round((n / sr) * 1_000_000);
    };
    state.gainNode.connect(scriptNode);
    scriptNode.connect(state.audioContext.destination);
    return true;
}

function stopAudioEncoding() {
    if (scriptNode) { scriptNode.disconnect(); scriptNode = null; }
}

// ── MP4 recording ──
let mp4Muxer      = null;
let mp4Video      = null;
let mp4FrameCount = 0;
let mp4StartTime  = null;
let mp4LastTime   = null;
export let isMP4Recording = false;

let Mp4MuxerLib = null;
async function loadMp4Muxer() {
    if (!Mp4MuxerLib) Mp4MuxerLib = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5/+esm');
    return Mp4MuxerLib;
}

function pickAvcCodec() {
    return 'avc1.640033'; // always 4K → high profile
}

async function startMP4Recording() {
    if (!window.VideoEncoder) {
        captureStatus.textContent = 'MP4 requires Chrome 94+ or Edge. Try WebM instead.'; return;
    }
    const bitrateMbps = bitrateSelect ? parseInt(bitrateSelect.value) : 16;
    const bitrate     = bitrateMbps * 1_000_000;
    const codec       = pickAvcCodec();

    const vOk = await VideoEncoder.isConfigSupported({ codec, width: EXPORT_W, height: EXPORT_H, bitrate, framerate: 60 });
    if (!vOk.supported) {
        captureStatus.textContent = `Codec unsupported at 4K. Try WebM instead.`; return;
    }

    const { Muxer, ArrayBufferTarget } = await loadMp4Muxer();
    const sampleRate = state.audioContext ? state.audioContext.sampleRate : 48000;
    const aOk = window.AudioEncoder && state.gainNode &&
        (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate: 192_000 })).supported;

    buildRecordingPipeline();

    mp4Muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video:  { codec: 'avc', width: EXPORT_W, height: EXPORT_H },
        ...(aOk && { audio: { codec: 'aac', sampleRate, numberOfChannels: 2 } }),
        fastStart: 'in-memory',
    });

    mp4Video = new VideoEncoder({
        output: (chunk, meta) => mp4Muxer.addVideoChunk(chunk, meta),
        error:  (e) => { captureStatus.textContent = 'Video encode error: ' + e.message; stopMP4Recording(); },
    });
    mp4Video.configure({ codec, width: EXPORT_W, height: EXPORT_H, bitrate, framerate: 60, latencyMode: 'quality' });

    if (aOk) await startAudioEncoding(sampleRate);

    mp4FrameCount = 0; mp4StartTime = null; mp4LastTime = null;
    isMP4Recording = true; state.isRecording = true;
    recordBtn.textContent = '■ Stop Recording';
    captureStatus.textContent = `Recording MP4 (4K · ${bitrateMbps} Mbps${aOk ? ' · audio' : ''})…`;
}

async function stopMP4Recording() {
    if (!isMP4Recording) return;
    isMP4Recording = false;
    captureStatus.textContent = 'Finalising…';
    try {
        stopAudioEncoding();
        if (mp4Audio) { await mp4Audio.flush(); mp4Audio.close(); mp4Audio = null; }
        await mp4Video.flush();
        mp4Muxer.finalize();
        const blob = new Blob([mp4Muxer.target.buffer], { type: 'video/mp4' });
        downloadBlob(blob, `galaxy_${Date.now()}.mp4`);
        captureStatus.textContent = `MP4 saved (${mp4FrameCount} frames).`;
    } catch (e) {
        console.error(e);
        captureStatus.textContent = 'Export failed: ' + e.message;
    } finally {
        mp4Video = null; mp4Muxer = null;
        destroyRecordingPipeline();
        state.isRecording = false;
        recordBtn.textContent = '● Start Recording';
    }
}

// ── captureFrame — called by main.js every frame ──
export function captureFrame(now) {
    if (!state.isRecording || !recCanvas) return;
    renderOffscreen();

    if (isMP4Recording && mp4Video && mp4Video.encodeQueueSize <= 15) {
        if (mp4StartTime === null) { mp4StartTime = now; mp4LastTime = now; }
        const timestampUs = Math.round((now - mp4StartTime) * 1000);
        const durationUs  = Math.max(1, Math.round((now - mp4LastTime) * 1000));
        mp4LastTime = now;
        let frame;
        try { frame = new VideoFrame(recCanvas, { timestamp: timestampUs, duration: durationUs }); }
        catch (_) { return; }
        mp4Video.encode(frame, { keyFrame: mp4FrameCount % 60 === 0 });
        frame.close();
        mp4FrameCount++;
    }
}

// ── Buttons ──
recordBtn.addEventListener('click', async () => {
    const fmt = formatSelect ? formatSelect.value : 'mp4';
    if (state.isRecording) {
        fmt === 'mp4' ? stopMP4Recording() : stopWebMRecording();
    } else {
        fmt === 'mp4' ? startMP4Recording() : startWebMRecording();
    }
});

frameBtn.addEventListener('click', async () => {
    captureStatus.textContent = 'Saving frame (4K)…';
    try { await exportFrame(); captureStatus.textContent = 'Frame saved (4K).'; }
    catch (e) { captureStatus.textContent = 'Frame capture failed.'; }
});

// ── UI sync ──
function syncFormatUI() {
    const isMp4 = !formatSelect || formatSelect.value === 'mp4';
    if (bitrateRow) bitrateRow.style.display = isMp4 ? '' : 'none';
    const noteEl = document.getElementById('capture-note');
    if (noteEl) noteEl.textContent = isMp4
        ? '4K MP4: Chrome/Edge · H.264'
        : '4K WebM: all browsers · VP9';
}
if (formatSelect) { formatSelect.addEventListener('change', syncFormatUI); syncFormatUI(); }

// ── Collapsible toggle ──
(function () {
    const row   = document.getElementById('capture-toggle-row');
    const body  = document.getElementById('capture-body');
    const arrow = document.getElementById('capture-arrow');
    if (!row || !body || !arrow) return;
    row.addEventListener('click', () => {
        const collapsed = body.classList.toggle('collapsed');
        arrow.classList.toggle('open', !collapsed);
    });
})();
