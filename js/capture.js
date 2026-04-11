import * as THREE from 'three';
import { downloadBlob } from './utils.js';
import { state } from './state.js';
import { camera, renderer, bloomComposer, finalComposer, bloomPass } from './renderer.js';
import { BLOOM_LAYER } from './constants.js';

// ── DOM refs ──
const captureStatus  = document.getElementById('capture-status');
const recordBtn      = document.getElementById('record-btn');
const frameBtn       = document.getElementById('frame-btn');
const frameSizeSelect= document.getElementById('frame-size-select');
const formatSelect   = document.getElementById('record-format-select');
const resSelect      = document.getElementById('record-resolution-select');
const orientSelect   = document.getElementById('record-orientation-select');
const bitrateSelect  = document.getElementById('record-bitrate-select');
const orientRow      = document.getElementById('record-orientation-row');
const bitrateRow     = document.getElementById('record-bitrate-row');

// ── Saved renderer state ──
let savedSize    = null;
let savedAspect  = null;
let savedPxRatio = null;

// ── WebM state ──
let webmRecorder = null;
let webmChunks   = [];

// ── MP4 state ──
let mp4Muxer      = null;
let mp4Encoder    = null;
let mp4FrameCount = 0;
let mp4StartTime  = null;
let mp4LastTime   = null;
export let isMP4Recording = false;

// ── Lazy-load mp4-muxer ──
let Mp4MuxerLib = null;
async function loadMp4Muxer() {
    if (!Mp4MuxerLib) Mp4MuxerLib = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5/+esm');
    return Mp4MuxerLib;
}

// ── Dimensions ──
function getRecordingDimensions() {
    const res    = resSelect  ? resSelect.value  : 'current';
    const orient = orientSelect ? orientSelect.value : 'landscape';
    if (res === 'current') return { w: Math.floor(window.innerWidth), h: Math.floor(window.innerHeight) };
    let w = res === '4k' ? 3840 : 1920;
    let h = res === '4k' ? 2160 : 1080;
    if (orient === 'portrait') [w, h] = [h, w];
    return { w, h };
}

function pickAvcCodec(w, h) {
    return (w > 1920 || h > 1920) ? 'avc1.640033' : 'avc1.640028';
}

// ── Renderer resize helpers ──
function beginResolutionOverride(w, h) {
    savedPxRatio = renderer.getPixelRatio();
    savedSize    = new THREE.Vector2();
    renderer.getSize(savedSize);
    savedAspect  = camera.aspect;
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false); // false = keep CSS size, only change canvas pixel dims
    bloomComposer.setSize(w, h);
    finalComposer.setSize(w, h);
    bloomPass.resolution = new THREE.Vector2(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}

function endResolutionOverride() {
    if (!savedSize) return;
    renderer.setPixelRatio(savedPxRatio);
    renderer.setSize(savedSize.x, savedSize.y, false);
    bloomComposer.setSize(savedSize.x, savedSize.y);
    finalComposer.setSize(savedSize.x, savedSize.y);
    bloomPass.resolution = savedSize.clone();
    camera.aspect = savedAspect;
    camera.updateProjectionMatrix();
    savedSize = savedPxRatio = savedAspect = null;
}

// ── PNG frame export ──
function renderForCapture() {
    camera.layers.set(BLOOM_LAYER);
    bloomComposer.render();
    camera.layers.set(0);
    finalComposer.render();
}

async function exportFrameAtSize(w, h) {
    beginResolutionOverride(w, h);
    try {
        renderForCapture();
        await new Promise((resolve, reject) => {
            const finish = (blob) => {
                if (!blob) {
                    const a = document.createElement('a');
                    a.href = renderer.domElement.toDataURL('image/png');
                    a.download = `galaxy_frame_${w}x${h}_${Date.now()}.png`;
                    document.body.appendChild(a); a.click(); a.remove();
                    return resolve();
                }
                downloadBlob(blob, `galaxy_frame_${w}x${h}_${Date.now()}.png`);
                resolve();
            };
            if (renderer.domElement.toBlob) renderer.domElement.toBlob(finish, 'image/png');
            else finish(null);
        });
    } finally {
        endResolutionOverride();
        renderForCapture();
    }
}

// ── WebM recording ──
function pickWebMType() {
    const c = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
    return c.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
}

async function startWebMRecording() {
    if (!window.MediaRecorder) { captureStatus.textContent = 'MediaRecorder not supported.'; return; }
    const { w, h } = getRecordingDimensions();
    if (state.audioContext && state.audioContext.state === 'suspended') {
        try { await state.audioContext.resume(); } catch (_) {}
    }
    beginResolutionOverride(w, h);
    const videoTracks = renderer.domElement.captureStream(60).getVideoTracks();
    const audioTracks = (state.mediaDest && state.mediaDest.stream) ? state.mediaDest.stream.getAudioTracks() : [];
    const stream   = new MediaStream([...videoTracks, ...audioTracks]);
    const mimeType = pickWebMType();
    webmChunks = [];
    webmRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    webmRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) webmChunks.push(e.data); };
    webmRecorder.onstop = () => {
        endResolutionOverride();
        const blob = new Blob(webmChunks, { type: mimeType || 'video/webm' });
        downloadBlob(blob, `galaxy_${Date.now()}.webm`);
        captureStatus.textContent = 'WebM saved.';
        state.isRecording = false;
        recordBtn.textContent = '● Start Recording';
    };
    webmRecorder.start();
    state.isRecording = true;
    recordBtn.textContent = '■ Stop Recording';
    captureStatus.textContent = `Recording WebM (${w}×${h})…`;
}

function stopWebMRecording() { if (webmRecorder) webmRecorder.stop(); }

// ── MP4 recording via Web Codecs + mp4-muxer ──
async function startMP4Recording() {
    if (!window.VideoEncoder) {
        captureStatus.textContent = 'MP4 requires Chrome 94+ or Edge. Try WebM instead.'; return;
    }
    const { w, h } = getRecordingDimensions();
    const bitrateMbps = bitrateSelect ? parseInt(bitrateSelect.value) : 16;
    const bitrate     = bitrateMbps * 1_000_000;
    const codec       = pickAvcCodec(w, h);

    const support = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate, framerate: 60 });
    if (!support.supported) {
        captureStatus.textContent = `Codec unsupported at ${w}×${h}. Try a lower resolution.`; return;
    }

    const { Muxer, ArrayBufferTarget } = await loadMp4Muxer();
    beginResolutionOverride(w, h);

    mp4Muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video:  { codec: 'avc', width: w, height: h },
        fastStart: 'in-memory',
    });

    mp4Encoder = new VideoEncoder({
        output: (chunk, meta) => mp4Muxer.addVideoChunk(chunk, meta),
        error:  (e) => { captureStatus.textContent = 'Encode error: ' + e.message; stopMP4Recording(); },
    });
    mp4Encoder.configure({ codec, width: w, height: h, bitrate, framerate: 60, latencyMode: 'quality' });

    mp4FrameCount = 0; mp4StartTime = null; mp4LastTime = null;
    isMP4Recording = true; state.isRecording = true;
    recordBtn.textContent = '■ Stop Recording';
    captureStatus.textContent = `Recording MP4 (${w}×${h} · ${bitrateMbps} Mbps)…`;
}

async function stopMP4Recording() {
    if (!isMP4Recording) return;
    isMP4Recording = false;
    captureStatus.textContent = 'Finalising…';
    try {
        await mp4Encoder.flush();
        mp4Muxer.finalize();
        const blob = new Blob([mp4Muxer.target.buffer], { type: 'video/mp4' });
        downloadBlob(blob, `galaxy_${Date.now()}.mp4`);
        captureStatus.textContent = `MP4 saved (${mp4FrameCount} frames).`;
    } catch (e) {
        console.error(e);
        captureStatus.textContent = 'Export failed: ' + e.message;
    } finally {
        mp4Encoder = null; mp4Muxer = null;
        endResolutionOverride();
        state.isRecording = false;
        recordBtn.textContent = '● Start Recording';
    }
}

// Called by main.js after every render when MP4 recording is active
export function captureFrame(now) {
    if (!isMP4Recording || !mp4Encoder || mp4Encoder.encodeQueueSize > 15) return;
    if (mp4StartTime === null) { mp4StartTime = now; mp4LastTime = now; }
    const timestampMicros = Math.round((now - mp4StartTime) * 1000);
    const durationMicros  = Math.max(1, Math.round((now - mp4LastTime) * 1000));
    mp4LastTime = now;
    let frame;
    try {
        frame = new VideoFrame(renderer.domElement, { timestamp: timestampMicros, duration: durationMicros });
    } catch (_) { return; }
    mp4Encoder.encode(frame, { keyFrame: mp4FrameCount % 60 === 0 });
    frame.close();
    mp4FrameCount++;
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
    const preset = frameSizeSelect ? frameSizeSelect.value : 'current';
    let w = Math.floor(window.innerWidth), h = Math.floor(window.innerHeight);
    if (preset === '1080p') { w = 1920; h = 1080; }
    else if (preset === '4k') { w = 3840; h = 2160; }
    captureStatus.textContent = `Saving frame (${w}×${h})…`;
    try { await exportFrameAtSize(w, h); captureStatus.textContent = 'Frame saved.'; }
    catch (e) { captureStatus.textContent = 'Frame capture failed.'; }
});

// ── Show/hide orientation row when "Current Window" selected ──
function syncOrientRow() {
    if (orientRow) orientRow.style.display = (resSelect && resSelect.value === 'current') ? 'none' : '';
}
if (resSelect) { resSelect.addEventListener('change', syncOrientRow); syncOrientRow(); }

// ── Show/hide bitrate row and update note when format changes ──
function syncFormatUI() {
    const isMp4  = !formatSelect || formatSelect.value === 'mp4';
    if (bitrateRow) bitrateRow.style.display = isMp4 ? '' : 'none';
    const noteEl = document.getElementById('capture-note');
    if (noteEl) noteEl.textContent = isMp4
        ? 'MP4: Chrome/Edge only · video only · no audio'
        : 'WebM: all browsers · includes audio';
    syncOrientRow();
}
if (formatSelect) { formatSelect.addEventListener('change', syncFormatUI); syncFormatUI(); }

// ── frame-size-select label ──
if (frameSizeSelect) frameSizeSelect.addEventListener('change', (e) => {
    const el = document.getElementById('frame-size-value');
    if (el) el.textContent = e.target.options[e.target.selectedIndex].text;
});
