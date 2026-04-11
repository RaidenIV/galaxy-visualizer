import * as THREE from 'three';
import { downloadBlob } from './utils.js';
import { state } from './state.js';
import { camera, renderer, bloomComposer, finalComposer, bloomPass } from './renderer.js';
import { BLOOM_LAYER } from './constants.js';

const captureStatus = document.getElementById('capture-status');
const recordBtn     = document.getElementById('record-btn');
const frameBtn      = document.getElementById('frame-btn');
const frameSizeSelect = document.getElementById('frame-size-select');

function pickRecordingMimeType() {
    const candidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
    ];
    return candidates.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
}

function renderCurrentFrameForCapture() {
    camera.layers.set(BLOOM_LAYER);
    bloomComposer.render();
    camera.layers.set(0);
    finalComposer.render();
}

function getFrameExportDimensions() {
    const preset = frameSizeSelect.value;
    if (preset === '1080p') return { width: 1920, height: 1080, label: '1080p' };
    if (preset === '4k')    return { width: 3840, height: 2160, label: '4K' };
    const width  = Math.max(2, Math.floor(window.innerWidth));
    const height = Math.max(2, Math.floor(window.innerHeight));
    return { width, height, label: `${width}x${height}` };
}

function saveCurrentCanvasAsPng(filename) {
    return new Promise((resolve, reject) => {
        const canvasEl = renderer.domElement;
        const finish = (blob) => {
            if (!blob) {
                try {
                    const dataURL = canvasEl.toDataURL('image/png');
                    const link = document.createElement('a');
                    link.href = dataURL; link.download = filename;
                    document.body.appendChild(link); link.click(); link.remove();
                    resolve();
                } catch (err) { reject(err); }
                return;
            }
            downloadBlob(blob, filename);
            resolve();
        };
        if (canvasEl.toBlob) canvasEl.toBlob(finish, 'image/png');
        else finish(null);
    });
}

async function saveFrameAtResolution(width, height) {
    const originalAspect      = camera.aspect;
    const originalSize        = new THREE.Vector2();
    renderer.getSize(originalSize);
    const originalPixelRatio  = renderer.getPixelRatio();
    const originalBloomRes    = bloomPass.resolution.clone();
    try {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(1);
        renderer.setSize(width, height, false);
        bloomComposer.setSize(width, height);
        finalComposer.setSize(width, height);
        bloomPass.resolution = new THREE.Vector2(width, height);
        renderCurrentFrameForCapture();
        await saveCurrentCanvasAsPng(`galaxy_visualizer_frame_${width}x${height}_${Date.now()}.png`);
    } finally {
        camera.aspect = originalAspect;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(originalPixelRatio);
        renderer.setSize(originalSize.x, originalSize.y, false);
        bloomComposer.setSize(originalSize.x, originalSize.y);
        finalComposer.setSize(originalSize.x, originalSize.y);
        bloomPass.resolution = originalBloomRes;
        renderCurrentFrameForCapture();
    }
}

// ── Record button ──
recordBtn.addEventListener('click', async () => {
    if (!window.MediaRecorder) {
        captureStatus.textContent = 'MediaRecorder not supported in this browser.';
        return;
    }
    if (state.isRecording) {
        state.mediaRecorder.stop();
        return;
    }
    if (state.audioContext && state.audioContext.state === 'suspended') {
        try { await state.audioContext.resume(); } catch (_) {}
    }
    const canvasStream = renderer.domElement.captureStream(60);
    const streamTracks = [...canvasStream.getVideoTracks()];
    if (state.mediaDest && state.mediaDest.stream) {
        streamTracks.push(...state.mediaDest.stream.getAudioTracks());
    }
    const mixedStream = new MediaStream(streamTracks);
    const mimeType    = pickRecordingMimeType();

    state.recordedChunks = [];
    state.mediaRecorder  = new MediaRecorder(mixedStream, mimeType ? { mimeType } : undefined);
    state.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) state.recordedChunks.push(event.data);
    };
    state.mediaRecorder.onstop = () => {
        const blob = new Blob(state.recordedChunks, { type: mimeType || 'video/webm' });
        downloadBlob(blob, `galaxy_visualizer_capture_${Date.now()}.webm`);
        captureStatus.textContent  = 'Recording saved.';
        state.isRecording          = false;
        recordBtn.textContent      = '● Start Recording';
    };
    state.mediaRecorder.start();
    state.isRecording     = true;
    recordBtn.textContent = '■ Stop Recording';
    captureStatus.textContent = 'Recording…';
});

// ── Frame button ──
frameBtn.addEventListener('click', async () => {
    const dims = getFrameExportDimensions();
    captureStatus.textContent = `Saving frame (${dims.label})…`;
    try {
        await saveFrameAtResolution(dims.width, dims.height);
        captureStatus.textContent = `Frame saved (${dims.label}).`;
    } catch (err) {
        console.error(err);
        captureStatus.textContent = 'Frame capture failed.';
    }
});

// ── Frame size selector ──
frameSizeSelect.addEventListener('change', (e) => {
    document.getElementById('frame-size-value').textContent =
        e.target.options[e.target.selectedIndex].text;
});
