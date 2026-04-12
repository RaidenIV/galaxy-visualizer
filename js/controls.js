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
import { loadAudioFile, updateAudioGain, clearAudioLoop } from './audio.js';
import { openLoopPopup } from './loop.js';

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

playBtn.addEventListener('click', async () => {
    if (!state.audioLoaded) return;
    if (state.isPlaying) {
        state.audioElement.pause();
        state.isPlaying = false;
        playBtn.textContent = '▶ Play';
        playBtn.className   = 'play';
    } else {
        if (state.audioContext.state === 'suspended') await state.audioContext.resume();
        // Respect loop region if active
        if (state.loopEnabled && state.audioElement.currentTime >= state.loopEnd) {
            state.audioElement.currentTime = state.loopStart;
        }
        await state.audioElement.play();
        state.isPlaying = true;
        playBtn.textContent = '⏸ Pause';
        playBtn.className   = 'pause';
    }
});

// ── Loop button ──
if (loopBtn) {
    loopBtn.addEventListener('click', () => {
        if (!state.audioFile) return;
        openLoopPopup();
    });
}

// ── Progress bar scrubbing ──
const progressBar = document.getElementById('progress-bar');
let isScrubbing = false;
function scrubTo(clientX) {
    if (!state.audioLoaded || !state.audioElement) return;
    const rect = progressBar.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    state.audioElement.currentTime = pct * state.audioElement.duration;
}
progressBar.addEventListener('mousedown', (e) => { isScrubbing = true; scrubTo(e.clientX); e.preventDefault(); });
progressBar.addEventListener('touchstart', (e) => { isScrubbing = true; scrubTo(e.touches[0].clientX); }, { passive: true });
document.addEventListener('mousemove',  (e) => { if (isScrubbing) scrubTo(e.clientX); });
document.addEventListener('touchmove',  (e) => { if (isScrubbing) scrubTo(e.touches[0].clientX); }, { passive: true });
document.addEventListener('mouseup',   () => { isScrubbing = false; });
document.addEventListener('touchend',  () => { isScrubbing = false; });

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

function applyCurrentPerformanceCounts() {
    updateGalaxyDrawRange();
    starGeo.setDrawRange(0, state.activeStarCount);
    scatterGeo.setDrawRange(0, state.activeScatterCount);
    haloGeo.setDrawRange(0, state.activeHaloCount);
    nebulaGeo.setDrawRange(0, state.activeNebulaCount);
}

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
    applyPerformancePreset(e.target.value, { applyPerformanceCounts: applyCurrentPerformanceCounts });
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
const PRESET_COUNT   = 4;
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

    clearAudioLoop();
    if (loopBtn) { loopBtn.textContent = '⌁ Loop'; loopBtn.classList.remove('loop-active'); }

    performancePresetSelect.value = 'quality';
    performancePresetSelect.dispatchEvent(new Event('change'));
    cameraPresetSelect.value = 'threeQuarter';
    cameraPresetSelect.dispatchEvent(new Event('change'));
    if (captureStatus) captureStatus.textContent = 'Idle';
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
setupSectionToggle('lightning-toggle-row','lightning-body','lightning-arrow', true);
setupSectionToggle('cmap-toggle-row',     'cmap-body',     'cmap-arrow',     true);
setupSectionToggle('keyboard-toggle-row', 'keyboard-body', 'keyboard-arrow', true);

// ── Button grids for selects ──
enhanceSelectAsButtonGrid('performance-preset-select', 'performance-preset-value');
enhanceSelectAsButtonGrid('camera-preset-select',      'camera-preset-value');
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
applyPerformancePreset('quality', { applyPerformanceCounts: applyCurrentPerformanceCounts });
setCameraFromPreset('threeQuarter');
