import { state } from './state.js';

// ── Loop enforcement on the HTMLMediaElement ──
let _loopCheckFn = null;

export function applyAudioLoop(loopStart, loopEnd) {
    state.loopEnabled = true;
    state.loopStart   = loopStart;
    state.loopEnd     = loopEnd;

    if (!state.audioElement) return;

    // Remove any previous listener
    if (_loopCheckFn) {
        state.audioElement.removeEventListener('timeupdate', _loopCheckFn);
        _loopCheckFn = null;
    }

    _loopCheckFn = () => {
        if (!state.loopEnabled) return;
        if (state.audioElement.currentTime >= state.loopEnd - 0.08) {
            state.audioElement.currentTime = state.loopStart;
        }
    };
    state.audioElement.addEventListener('timeupdate', _loopCheckFn);

    // Jump into the loop region if currently outside it
    if (state.audioElement.currentTime < loopStart ||
        state.audioElement.currentTime >= loopEnd) {
        state.audioElement.currentTime = loopStart;
    }
}

export function clearAudioLoop() {
    state.loopEnabled = false;
    state.loopStart   = 0;
    state.loopEnd     = 0;
    if (_loopCheckFn && state.audioElement) {
        state.audioElement.removeEventListener('timeupdate', _loopCheckFn);
        _loopCheckFn = null;
    }
    // Update loop button UI
    const loopBtn = document.getElementById('loop-btn');
    if (loopBtn) {
        loopBtn.textContent = 'Loop';
        loopBtn.classList.remove('loop-active');
    }
}

// ── Audio analysis loop ──
export function analyzeAudio() {
    requestAnimationFrame(analyzeAudio);
    if (!state.analyser || !state.isPlaying) return;
    const buf = new Uint8Array(state.analyser.frequencyBinCount);
    state.analyser.getByteFrequencyData(buf);
    const sr  = state.audioContext.sampleRate;
    const bin = sr / state.analyser.fftSize;
    const lo20   = Math.floor(20   / bin);
    const hi100  = Math.floor(100  / bin);
    const hi150  = Math.floor(150  / bin);
    const hi2000 = Math.floor(2000 / bin);
    const hi8000 = Math.floor(8000 / bin);

    let sum20to100 = 0, max20to100 = 0;
    for (let i = lo20; i <= hi100 && i < buf.length; i++) {
        sum20to100 += buf[i];
        if (buf[i] > max20to100) max20to100 = buf[i];
    }
    const cnt20to100 = Math.max(1, hi100 - lo20 + 1);
    const avg = sum20to100 / cnt20to100;
    state.currentAudioInfluence = max20to100 > 0 ? Math.min(1, avg / max20to100) : 0.0;

    let sum20to150 = 0;
    for (let i = lo20; i <= hi150 && i < buf.length; i++) sum20to150 += buf[i];
    state.currentLowFreq = sum20to150 / (Math.max(1, hi150 - lo20 + 1) * 255);

    let sumMid = 0;
    for (let i = hi150; i <= hi2000 && i < buf.length; i++) sumMid += buf[i];
    state.currentMidFreq = sumMid / (Math.max(1, hi2000 - hi150 + 1) * 255);

    let sumHigh = 0;
    for (let i = hi2000; i <= hi8000 && i < buf.length; i++) sumHigh += buf[i];
    state.currentHighFreq = sumHigh / (Math.max(1, hi8000 - hi2000 + 1) * 255);
}

// ── Load audio file ──
export async function loadAudioFile(file) {
    const loadBtn     = document.getElementById('load-btn');
    const playBtn     = document.getElementById('play-btn');
    const loopBtn     = document.getElementById('loop-btn');
    const audioNameEl = document.getElementById('audio-name');

    loadBtn.textContent = 'Loading...';
    loadBtn.disabled    = true;
    try {
        if (!state.audioContext) {
            state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (!state.analyser) {
            state.analyser = state.audioContext.createAnalyser();
            state.analyser.fftSize = 4096;
            state.analyser.smoothingTimeConstant = 0.8;
        }
        if (!state.gainNode) {
            state.gainNode = state.audioContext.createGain();
            updateAudioGain();
        }
        if (!state.mediaDest && state.audioContext.createMediaStreamDestination) {
            state.mediaDest = state.audioContext.createMediaStreamDestination();
        }

        if (state.audioElement) { state.audioElement.pause(); state.audioElement.currentTime = 0; }
        if (state.audioSource)  { try { state.audioSource.disconnect(); } catch (_) {} state.audioSource = null; }

        // Clear any previous loop
        clearAudioLoop();

        state.audioElement = new Audio();
        state.audioElement.crossOrigin = 'anonymous';
        const url = URL.createObjectURL(file);
        await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('timeout')), 10000);
            state.audioElement.addEventListener('loadedmetadata', () => { clearTimeout(t); resolve(); }, { once: true });
            state.audioElement.addEventListener('error', () => { clearTimeout(t); reject(); }, { once: true });
            state.audioElement.src = url;
            state.audioElement.load();
        });

        state.audioSource = state.audioContext.createMediaElementSource(state.audioElement);
        state.audioSource.connect(state.analyser);
        state.audioSource.connect(state.gainNode);
        if (!state.gainNodeConnected) {
            state.gainNode.connect(state.audioContext.destination);
            state.gainNodeConnected = true;
        }
        if (state.mediaDest && !state.mediaDestConnected) {
            state.gainNode.connect(state.mediaDest);
            state.mediaDestConnected = true;
        }

        // Store file reference for BPM popup
        state.audioFile = file;

        state.audioLoaded = true;
        state.isPlaying   = false;
        playBtn.disabled    = false;
        playBtn.textContent = '▶ Play';
        playBtn.className   = 'play';
        if (loopBtn) {
            loopBtn.disabled    = false;
            loopBtn.textContent = 'Loop';
            loopBtn.classList.remove('loop-active');
        }
        audioNameEl.textContent = file.name;
        document.getElementById('progress-container').style.display = 'block';

        state.audioElement.addEventListener('ended', () => {
            state.isPlaying = false;
            playBtn.textContent = '▶ Play';
            playBtn.className   = 'play';
        });
    } catch (err) {
        console.error(err);
        audioNameEl.textContent = 'Load failed – try again';
    } finally {
        loadBtn.textContent = 'Load Audio File';
        loadBtn.disabled    = false;
    }
}

export function updateAudioGain() {
    if (state.gainNode) {
        state.gainNode.gain.value = state.isMuted ? 0 : (document.getElementById('volume-slider').value / 100);
    }
}
