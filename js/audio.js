import { state } from './state.js';

const $ = (id) => document.getElementById(id);
let uiTickRaf = 0;

export let audioFreqData = new Uint8Array(0);
export let audioTimeData = new Uint8Array(0);

function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

export function ensureAudioContext() {
    if (!state.audioContext) {
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (!state.analyser) {
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = 2048;
        state.analyser.smoothingTimeConstant = 0.72;
    }
    if (!state.gainNode) {
        state.gainNode = state.audioContext.createGain();
    }
    if (!state.mediaDest) {
        state.mediaDest = state.audioContext.createMediaStreamDestination();
    }
    if (!state.gainNodeConnected) {
        state.gainNode.connect(state.audioContext.destination);
        state.gainNodeConnected = true;
    }
    if (!state._analyserToGainConnected) {
        state.analyser.connect(state.gainNode);
        state._analyserToGainConnected = true;
    }
    if (!state.mediaDestConnected) {
        state.gainNode.connect(state.mediaDest);
        state.mediaDestConnected = true;
    }
    ensureAnalysisBuffers();
    return state.audioContext;
}

function ensureAnalysisBuffers() {
    const bins = state.analyser ? state.analyser.frequencyBinCount : 1024;
    if (audioFreqData.length !== bins) audioFreqData = new Uint8Array(bins);
    if (audioTimeData.length !== bins) audioTimeData = new Uint8Array(bins);
    state.audioFreqData = audioFreqData;
    state.audioTimeData = audioTimeData;
}

function fmtTime(sec) {
    if (!Number.isFinite(sec)) return '0:00';
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${String(r).padStart(2, '0')}`;
}

function getLoopFallbackEnd() {
    const dur = state.audioBuffer?.duration || state.audioElement?.duration || 0;
    if (!dur) return 0;
    if (state.detectedBpm > 0) {
        const bars = Math.max(1, state.loopBars || 4);
        const barDur = (60 / state.detectedBpm) * 4;
        return clamp(state.loopStart + bars * barDur, 0, dur);
    }
    return clamp(state.loopStart + 8, 0, dur);
}

function syncProgressUI() {
    const el = state.audioElement;
    const progressContainer = $('progress-container');
    const currentTimeEl = $('current-time');
    const durationTimeEl = $('duration-time');
    const progressFill = $('progress-fill');
    if (!el) return;

    if (progressContainer && state.audioLoaded) progressContainer.style.display = 'block';
    if (currentTimeEl) currentTimeEl.textContent = fmtTime(el.currentTime || 0);
    if (durationTimeEl) durationTimeEl.textContent = fmtTime(el.duration || 0);
    if (progressFill && Number.isFinite(el.duration) && el.duration > 0) {
        const pct = clamp((el.currentTime / el.duration) * 100, 0, 100);
        progressFill.style.width = `${pct}%`;
    }
}

function loopPlaybackGuard() {
    const el = state.audioElement;
    if (!el || !state.audioLoaded) return;

    if (state.loopEnabled && Number.isFinite(state.loopEnd) && state.loopEnd > state.loopStart) {
        const threshold = Math.max(0.02, Math.min(0.05, (state.loopEnd - state.loopStart) * 0.02));
        if (el.currentTime < state.loopStart - 0.001 && !el.paused) {
            el.currentTime = state.loopStart;
        }
        if (el.currentTime >= state.loopEnd - threshold) {
            const overflow = Math.max(0, el.currentTime - state.loopEnd);
            el.currentTime = clamp(state.loopStart + overflow, state.loopStart, state.loopEnd);
        }
    }

    syncProgressUI();
    emit('audio-progress', { currentTime: el.currentTime || 0, duration: el.duration || 0 });

    if (!el.paused && !el.ended) {
        uiTickRaf = requestAnimationFrame(loopPlaybackGuard);
    } else {
        uiTickRaf = 0;
    }
}

function startUiTick() {
    if (!uiTickRaf) uiTickRaf = requestAnimationFrame(loopPlaybackGuard);
}

function stopUiTick() {
    if (uiTickRaf) cancelAnimationFrame(uiTickRaf);
    uiTickRaf = 0;
}

function attachElementEvents(audioEl) {
    audioEl.addEventListener('loadedmetadata', () => {
        syncProgressUI();
        emit('audio-metadata', { duration: audioEl.duration || 0 });
    });
    audioEl.addEventListener('timeupdate', () => {
        if (state.loopEnabled && audioEl.currentTime >= state.loopEnd && state.loopEnd > state.loopStart) {
            audioEl.currentTime = state.loopStart;
        }
        syncProgressUI();
        emit('audio-progress', { currentTime: audioEl.currentTime || 0, duration: audioEl.duration || 0 });
    });
    audioEl.addEventListener('play', () => {
        state.isPlaying = true;
        if (state.loopEnabled && state.loopEnd > state.loopStart) {
            if (audioEl.currentTime < state.loopStart || audioEl.currentTime >= state.loopEnd) {
                audioEl.currentTime = state.loopStart;
            }
        }
        startUiTick();
        emit('audio-playstate', { isPlaying: true });
    });
    audioEl.addEventListener('pause', () => {
        state.isPlaying = false;
        stopUiTick();
        emit('audio-playstate', { isPlaying: false });
    });
    audioEl.addEventListener('ended', () => {
        state.isPlaying = false;
        stopUiTick();
        emit('audio-playstate', { isPlaying: false });
    });
}

export function updateAudioGain() {
    if (!state.gainNode) return;
    const slider = $('volume-slider');
    const sliderValue = slider ? parseFloat(slider.value) : 100;
    const gain = state.isMuted ? 0 : clamp(sliderValue / 100, 0, 1);
    state.gainNode.gain.value = gain;
    emit('audio-volume', { gain, muted: state.isMuted, sliderValue });
}

export async function resumeAudioContext() {
    const ctx = ensureAudioContext();
    if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch (_) {}
    }
    return ctx;
}

export function seekTo(timeSec) {
    if (!state.audioElement) return;
    const dur = state.audioElement.duration || state.audioBuffer?.duration || 0;
    state.audioElement.currentTime = clamp(timeSec, 0, dur || timeSec);
    syncProgressUI();
    emit('audio-progress', { currentTime: state.audioElement.currentTime || 0, duration: dur || 0 });
}

export function stopAudioPlayback(resetToLoopStart = true) {
    if (!state.audioElement) return;
    state.audioElement.pause();
    if (resetToLoopStart) {
        state.audioElement.currentTime = state.loopEnabled ? state.loopStart : 0;
    }
    syncProgressUI();
    emit('audio-playstate', { isPlaying: false });
}

export async function toggleAudioPlayback() {
    if (!state.audioElement || !state.audioLoaded) return;
    await resumeAudioContext();
    if (state.isPlaying) {
        state.audioElement.pause();
        return;
    }
    if (state.loopEnabled && state.loopEnd > state.loopStart) {
        if (state.audioElement.currentTime < state.loopStart || state.audioElement.currentTime >= state.loopEnd) {
            state.audioElement.currentTime = state.loopStart;
        }
    }
    await state.audioElement.play();
}

export async function playAudio() {
    if (!state.isPlaying) await toggleAudioPlayback();
}

export function pauseAudio() {
    if (state.audioElement) state.audioElement.pause();
}

export function setLoopEnabled(enabled) {
    state.loopEnabled = !!enabled;
    const el = state.audioElement;
    if (el && state.loopEnabled && state.loopEnd > state.loopStart) {
        if (el.currentTime < state.loopStart || el.currentTime >= state.loopEnd) {
            el.currentTime = state.loopStart;
        }
    }
    emit('loop-updated', {
        loopEnabled: state.loopEnabled,
        loopStart: state.loopStart,
        loopEnd: state.loopEnd,
        loopBars: state.loopBars,
        bpm: state.detectedBpm,
    });
}

export function setDetectedBpm(nextBpm, preserveLoopLength = true) {
    const bpm = clamp(Math.round(Number(nextBpm) || 0), 0, 400);
    state.detectedBpm = bpm;
    if (preserveLoopLength) {
        const dur = state.audioBuffer?.duration || state.audioElement?.duration || 0;
        state.loopEnd = clamp(getLoopFallbackEnd(), state.loopStart, dur || getLoopFallbackEnd());
    }
    emit('loop-updated', {
        loopEnabled: state.loopEnabled,
        loopStart: state.loopStart,
        loopEnd: state.loopEnd,
        loopBars: state.loopBars,
        bpm: state.detectedBpm,
    });
}

export function setLoopBars(nextBars) {
    state.loopBars = clamp(Math.round(Number(nextBars) || 1), 1, 999);
    const dur = state.audioBuffer?.duration || state.audioElement?.duration || 0;
    state.loopEnd = clamp(getLoopFallbackEnd(), state.loopStart, dur || getLoopFallbackEnd());
    emit('loop-updated', {
        loopEnabled: state.loopEnabled,
        loopStart: state.loopStart,
        loopEnd: state.loopEnd,
        loopBars: state.loopBars,
        bpm: state.detectedBpm,
    });
}

export function setLoopRegion(startSec, endSec) {
    const dur = state.audioBuffer?.duration || state.audioElement?.duration || 0;
    const start = clamp(Number(startSec) || 0, 0, dur || Number(startSec) || 0);
    let end = clamp(Number(endSec) || start, 0, dur || Number(endSec) || start);
    if (end <= start) end = Math.min(dur || start + 0.1, start + 0.1);
    state.loopStart = start;
    state.loopEnd = end;
    if (state.detectedBpm > 0) {
        const bars = (end - start) / ((60 / state.detectedBpm) * 4);
        state.loopBars = Math.max(1, Math.round(bars));
    }
    if (state.audioElement && state.loopEnabled) {
        if (state.audioElement.currentTime < state.loopStart || state.audioElement.currentTime >= state.loopEnd) {
            state.audioElement.currentTime = state.loopStart;
        }
    }
    emit('loop-updated', {
        loopEnabled: state.loopEnabled,
        loopStart: state.loopStart,
        loopEnd: state.loopEnd,
        loopBars: state.loopBars,
        bpm: state.detectedBpm,
    });
}

async function detectBPM(audioBuffer) {
    const sr = audioBuffer.sampleRate;
    const maxLen = Math.min(audioBuffer.length, sr * 90);
    const mono = new Float32Array(maxLen);
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
        const ch = audioBuffer.getChannelData(c);
        for (let i = 0; i < maxLen; i++) mono[i] += ch[i] || 0;
    }
    if (audioBuffer.numberOfChannels > 1) {
        for (let i = 0; i < maxLen; i++) mono[i] /= audioBuffer.numberOfChannels;
    }
    const offCtx = new OfflineAudioContext(1, maxLen, sr);
    const ob = offCtx.createBuffer(1, maxLen, sr);
    ob.getChannelData(0).set(mono);
    const src = offCtx.createBufferSource();
    src.buffer = ob;
    const lp = offCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    lp.Q.value = 0.8;
    src.connect(lp);
    lp.connect(offCtx.destination);
    src.start(0);
    const rendered = await offCtx.startRendering();
    const fd = rendered.getChannelData(0);
    const hop = 512;
    const nF = Math.floor(fd.length / hop);
    const eng = new Float32Array(nF);
    for (let i = 0; i < nF; i++) {
        let e = 0;
        const off = i * hop;
        for (let j = 0; j < hop; j++) {
            const s = fd[off + j];
            e += s * s;
        }
        eng[i] = e;
    }
    let maxEnergy = 0;
    for (let i = 0; i < nF; i++) if (eng[i] > maxEnergy) maxEnergy = eng[i];
    if (maxEnergy > 0) {
        for (let i = 0; i < nF; i++) eng[i] /= maxEnergy;
    }
    const fps = sr / hop;
    const minLag = Math.max(2, Math.floor((fps * 60) / 200));
    const maxLag = Math.ceil((fps * 60) / 60);
    let bestLag = minLag;
    let bestCorr = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
        let corr = 0;
        const limit = nF - lag;
        for (let i = 0; i < limit; i++) corr += eng[i] * eng[i + lag];
        if (corr > bestCorr) {
            bestCorr = corr;
            bestLag = lag;
        }
    }
    let raw = (60 * fps) / bestLag;
    while (raw < 80) raw *= 2;
    while (raw > 160) raw /= 2;
    return Math.round(raw);
}

export async function loadAudioFile(file) {
    const audioCtx = ensureAudioContext();
    stopAudioPlayback(false);

    if (state.audioObjectUrl) {
        try { URL.revokeObjectURL(state.audioObjectUrl); } catch (_) {}
        state.audioObjectUrl = null;
    }
    if (state.audioSource) {
        try { state.audioSource.disconnect(); } catch (_) {}
        state.audioSource = null;
    }

    const fileBuf = await file.arrayBuffer();
    state.audioBuffer = await audioCtx.decodeAudioData(fileBuf.slice(0));
    state.detectedBpm = await detectBPM(state.audioBuffer);
    state.audioFileName = file.name;
    state.loopBars = 4;
    state.loopStart = 0;
    state.loopEnd = clamp(getLoopFallbackEnd(), 0, state.audioBuffer.duration);
    state.loopEnabled = false;

    const audioEl = new Audio();
    audioEl.preload = 'auto';
    audioEl.crossOrigin = 'anonymous';
    audioEl.src = URL.createObjectURL(file);
    state.audioObjectUrl = audioEl.src;
    state.audioElement = audioEl;
    state.audioSource = audioCtx.createMediaElementSource(audioEl);
    state.audioSource.connect(state.analyser);

    state.audioLoaded = true;
    state.isPlaying = false;
    attachElementEvents(audioEl);
    updateAudioGain();

    const audioNameEl = $('audio-name');
    if (audioNameEl) audioNameEl.textContent = file.name;

    emit('audio-loaded', {
        fileName: file.name,
        duration: state.audioBuffer.duration,
        bpm: state.detectedBpm,
        loopStart: state.loopStart,
        loopEnd: state.loopEnd,
        loopBars: state.loopBars,
    });

    syncProgressUI();
    updateAudioAnalysis();
}

export function getAnalyser() {
    ensureAudioContext();
    return state.analyser;
}

export function getFrequencyData() {
    ensureAudioContext();
    return audioFreqData;
}

export function getWaveformData() {
    ensureAudioContext();
    return audioTimeData;
}


function snapshotAudioData() {
    return {
        frequency: audioFreqData,
        waveform: audioTimeData,
        low: state.currentLowFreq,
        mid: state.currentMidFreq,
        high: state.currentHighFreq,
        influence: state.currentAudioInfluence,
    };
}

export function getAudioData() {
    ensureAudioContext();
    ensureAnalysisBuffers();
    return snapshotAudioData();
}

export function updateAudioAnalysis(dt = 1 / 60) {
    ensureAudioContext();
    ensureAnalysisBuffers();

    if (!state.audioLoaded || !state.analyser) {
        state.currentLowFreq = lerp(state.currentLowFreq, 0, 0.12);
        state.currentMidFreq = lerp(state.currentMidFreq, 0, 0.12);
        state.currentHighFreq = lerp(state.currentHighFreq, 0, 0.12);
        state.currentAudioInfluence = lerp(state.currentAudioInfluence, 0, 0.12);
        state.lightningGlowDrive = lerp(state.lightningGlowDrive, 0, 0.08);
        state.smoothedBeamDrive = lerp(state.smoothedBeamDrive, 0, 0.08);
        return snapshotAudioData();
    }

    state.analyser.getByteFrequencyData(audioFreqData);
    state.analyser.getByteTimeDomainData(audioTimeData);

    const n = audioFreqData.length;
    const lowEnd = Math.max(1, Math.floor(n * 0.08));
    const midEnd = Math.max(lowEnd + 1, Math.floor(n * 0.28));
    const highEnd = Math.max(midEnd + 1, Math.floor(n * 0.78));

    let low = 0, mid = 0, high = 0;
    for (let i = 0; i < lowEnd; i++) low += audioFreqData[i];
    for (let i = lowEnd; i < midEnd; i++) mid += audioFreqData[i];
    for (let i = midEnd; i < highEnd; i++) high += audioFreqData[i];

    low /= Math.max(1, lowEnd * 255);
    mid /= Math.max(1, (midEnd - lowEnd) * 255);
    high /= Math.max(1, (highEnd - midEnd) * 255);

    const influenceRaw = clamp((low * 0.68 + mid * 0.24 + high * 0.08) * state.reactivityMultiplier, 0, 1.4);
    state.currentLowFreq = lerp(state.currentLowFreq, low, 0.34);
    state.currentMidFreq = lerp(state.currentMidFreq, mid, 0.24);
    state.currentHighFreq = lerp(state.currentHighFreq, high, 0.20);
    state.currentAudioInfluence = lerp(state.currentAudioInfluence, influenceRaw, 0.24);

    const energy = low * 1.15 + mid * 0.55 + high * 0.35;
    const history = state.beatHistory;
    const idx = state.beatHistoryIdx % history.length;
    history[idx] = energy;
    state.beatHistoryIdx = (idx + 1) % history.length;
    const avg = history.reduce((a, b) => a + b, 0) / history.length;
    state.beatCooldown = Math.max(0, state.beatCooldown - dt);
    const beat = avg > 0.001 && energy > avg * state.beatSensitivity && state.beatCooldown <= 0;
    if (beat) state.beatCooldown = 0.14;

    const beatBoost = beat ? clamp((energy - avg) * 1.8, 0, 1) : 0;

    // Restore a punchier, bass-led feel closer to the earlier visualizer behavior.
    const beamTarget = clamp((low * state.reactivityMultiplier - 0.12) / 0.88, 0, 1);
    const beamLerp = beamTarget > state.smoothedBeamDrive ? 0.22 : 0.10;
    state.smoothedBeamDrive += (beamTarget - state.smoothedBeamDrive) * beamLerp;

    const bloomTarget = 0.95 + low * 0.62 + beatBoost * 0.42;
    state.smoothedBloom = lerp(state.smoothedBloom, bloomTarget, 0.14);

    state.lightningGlowDrive = lerp(state.lightningGlowDrive, high * 0.82 + beatBoost * 0.72, 0.20);

    state.audioPeak = Math.max(low, mid, high);
    state.audioBeat = beat;
    state.audioEnergy = energy;

    return snapshotAudioData();
}

// Compatibility aliases for the original main.js, whose exact imports were not uploaded.
export const analyseAudio = updateAudioAnalysis;
export const analyzeAudio = updateAudioAnalysis;
export const updateAudioData = updateAudioAnalysis;
export const updateAnalyzerData = updateAudioAnalysis;
export const updateAnalyserData = updateAudioAnalysis;
export const updateAudioFrame = updateAudioAnalysis;
export const updateAudioState = updateAudioAnalysis;
export const updateAudioReactiveState = updateAudioAnalysis;
export const updateAudioReactivity = updateAudioAnalysis;
export const processAudio = updateAudioAnalysis;
export const processAudioFrame = updateAudioAnalysis;
export const tickAudio = updateAudioAnalysis;
export const tickAudioAnalysis = updateAudioAnalysis;
export const initAudio = ensureAudioContext;
export const initializeAudio = ensureAudioContext;
export const ensureAudio = ensureAudioContext;

export default {
    ensureAudioContext,
    loadAudioFile,
    updateAudioGain,
    updateAudioAnalysis,
    toggleAudioPlayback,
    stopAudioPlayback,
    seekTo,
    setLoopEnabled,
    setLoopRegion,
    setLoopBars,
    setDetectedBpm,
    getAnalyser,
    getAudioData,
    getFrequencyData,
    getWaveformData,
};
