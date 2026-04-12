import * as THREE from 'three';
import { BLOOM_LAYER, CINEMA_PATHS, CAM_LERP_DUR, CORE_CENTER_BLOOM_REDUCTION, BEAT_HISTORY, GALAXY_COLORMAPS } from './constants.js';
import { state } from './state.js';
import { camera, controls, bloomComposer, finalComposer, bloomPass } from './renderer.js';
import {
    galaxyGeo, galaxyMat, galaxyColorsBuf, galaxyRxy, galaxyTheta,
    getCurrentColorStops, getGalaxyColorT, rebuildGalaxyColors,
    rotateGalaxyParticles, centralSphere, sphereMat,
} from './galaxy.js';
import { haloGeo, haloMat, nebulaGeo, nebulaMat, rotateHaloParticles, rotateNebulaParticles } from './nebula.js';
import { starMat } from './stars.js';
import { scatterMesh, updateDynamicScatter } from './scatter.js';
import { updateLightningSystem, hideLightning } from './lightning.js';
import { analyzeAudio } from './audio.js';
import { sampleColormap } from './utils.js';

// Side-effect imports (register all event listeners)
import { captureFrame } from './capture.js';
import './controls.js';

// ── Animation loop ──
function animate(now = performance.now()) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, Math.max(0.001, (now - state.lastFrameTime) / 1000));
    state.lastFrameTime = now;

    // FPS counter
    state.fpsFrameCount++;
    if (now - state.fpsLastTime >= 500) {
        const fps = Math.round(state.fpsFrameCount * 1000 / (now - state.fpsLastTime));
        const el  = document.getElementById('fps-display');
        if (el) el.textContent = fps + ' fps';
        state.fpsFrameCount = 0;
        state.fpsLastTime   = now;
    }

    // Progress bar
    if (state.audioLoaded && state.audioElement && state.audioElement.duration) {
        const pct = (state.audioElement.currentTime / state.audioElement.duration) * 100;
        document.getElementById('progress-fill').style.width = pct + '%';
        const cm = Math.floor(state.audioElement.currentTime / 60);
        const cs = Math.floor(state.audioElement.currentTime % 60);
        const dm = Math.floor(state.audioElement.duration / 60);
        const ds = Math.floor(state.audioElement.duration % 60);
        document.getElementById('current-time').textContent  = `${cm}:${cs.toString().padStart(2,'0')}`;
        document.getElementById('duration-time').textContent = `${dm}:${ds.toString().padStart(2,'0')}`;
    }

    // Keep the galaxy alive when audio is loaded but paused.
    // Audio-reactive values below already fall back to gentle idle motion when not playing.

    state.frameCount++;
    state.time += dt;

    // Sample audio analyser every frame so reactive values stay current
    analyzeAudio(dt);

    // Effective audio values
    const rawAI = state.isPlaying ? state.currentAudioInfluence : 0.3;
    const ai    = Math.min(1, rawAI * state.reactivityMultiplier);
    const lowAI = state.isPlaying ? Math.min(1, state.currentLowFreq  * state.reactivityMultiplier) : 0.2;
    const midAI = state.isPlaying ? Math.min(1, state.currentMidFreq  * state.reactivityMultiplier) : 0.0;
    const highAI= state.isPlaying ? Math.min(1, state.currentHighFreq * state.reactivityMultiplier) : 0.0;

    // Restore the earlier punchier beam behavior: drive the scatter from bass response
    // with a faster attack than release. This keeps the BPM/loop audio path intact, but
    // brings back the stronger low-end visual hits.
    const beamDriveTarget = state.isPlaying ? Math.max(0, Math.min(1, (lowAI - 0.12) / 0.88)) : 0.0;
    const beamDriveLerp   = beamDriveTarget > state.smoothedBeamDrive ? 0.22 : 0.10;
    state.smoothedBeamDrive += (beamDriveTarget - state.smoothedBeamDrive) * beamDriveLerp;
    const beamDrive        = Math.max(0, Math.min(1, state.smoothedBeamDrive));
    const visibleBeamDrive = Math.max(0, Math.min(1, (beamDrive - state.beamVisibilityThreshold) / Math.max(0.001, 1 - state.beamVisibilityThreshold)));

    // ── Cinema camera ──
    if (state.cinemaMode) {
        state.cinemaT += dt * state.cinemaSpeed * 0.12;
        if (state.cinemaAutoAdvance) {
            state.cinemaAutoAdvanceTimer += dt;
            if (state.cinemaAutoAdvanceTimer > 28) {
                state.cinemaAutoAdvanceTimer = 0;
                const idx = CINEMA_PATHS.indexOf(state.cinemaPathType);
                state.cinemaPathType = CINEMA_PATHS[(idx + 1) % CINEMA_PATHS.length];
                const sel = document.getElementById('cinema-path-select');
                if (sel) { sel.value = state.cinemaPathType; sel.dispatchEvent(new Event('change')); }
                state.cinemaT = 0;
            }
        }
        const baseD = 10.75 * state.cinemaDistance;
        const eb    = state.cinemaElevation;
        const t     = state.cinemaT;
        let cp;
        if (state.cinemaPathType === 'orbit') {
            const y = baseD * (eb * 0.8 - 0.1), r = Math.sqrt(Math.max(0, baseD*baseD - y*y));
            cp = new THREE.Vector3(Math.sin(t)*r, y, Math.cos(t)*r);
        } else if (state.cinemaPathType === 'zoom') {
            const zd = baseD*(0.55+0.45*Math.sin(t*0.45)), y = zd*(eb*0.6-0.05), r = Math.sqrt(Math.max(0.1, zd*zd-y*y));
            cp = new THREE.Vector3(Math.sin(t*0.18)*r, y, Math.cos(t*0.18)*r);
        } else if (state.cinemaPathType === 'sweep') {
            const elev = (eb*0.4+0.3)*Math.PI*(0.5+0.5*Math.sin(t*0.28));
            cp = new THREE.Vector3(Math.sin(t*0.55)*baseD*Math.cos(elev), baseD*Math.sin(elev), Math.cos(t*0.55)*baseD*Math.cos(elev));
        } else if (state.cinemaPathType === 'dive') {
            const phase = Math.sin(t*0.32), elev = Math.PI*0.5*(0.08+eb*0.5+(0.5-eb*0.4)*phase);
            cp = new THREE.Vector3(Math.sin(t*0.4)*baseD*Math.cos(elev), baseD*Math.sin(elev), Math.cos(t*0.4)*baseD*Math.cos(elev));
        } else if (state.cinemaPathType === 'figure8') {
            const sc = baseD*0.92, denom = 1+Math.sin(t)*Math.sin(t);
            const lx = sc*Math.cos(t)/denom, lz = sc*Math.sin(t)*Math.cos(t)/denom;
            cp = new THREE.Vector3(lx, lx*(eb*0.5-0.1), lz);
        } else if (state.cinemaPathType === 'crane') {
            const cy = baseD*(-0.15+eb*0.6+0.25*Math.sin(t*0.22)), cr = Math.sqrt(Math.max(0.1, baseD*baseD-cy*cy));
            cp = new THREE.Vector3(Math.sin(t*0.38)*cr, cy, Math.cos(t*0.38)*cr);
        } else if (state.cinemaPathType === 'spiral') {
            const sd = baseD*(0.55+0.45*Math.abs(Math.sin(t*0.18))), se = eb*0.5*Math.sin(t*0.38), sr = sd*Math.cos(se);
            cp = new THREE.Vector3(Math.sin(t*0.9)*sr, sd*Math.sin(se), Math.cos(t*0.9)*sr);
        } else {
            const swingAngle = Math.sin(t*0.38)*Math.PI*(0.3+eb*0.35);
            cp = new THREE.Vector3(Math.sin(swingAngle)*baseD, baseD*(0.1+eb*0.5+0.2*Math.cos(t*0.22)), Math.cos(swingAngle)*baseD);
        }
        camera.position.lerp(cp, Math.min(1, dt * 1.8));
        camera.lookAt(0, 0, 0);
        controls.target.set(0, 0, 0);
    } else if (state.autoRotateEnabled) {
        const offset = camera.position.clone().sub(controls.target);
        offset.applyAxisAngle(camera.up, dt * state.autoRotateSpeed * 0.90);
        camera.position.copy(controls.target.clone().add(offset));
    }

    // Camera lerp for preset transitions
    if (state.camLerpT < 1.0 && !state.cinemaMode) {
        state.camLerpT = Math.min(1.0, state.camLerpT + dt / CAM_LERP_DUR);
        const ease = 1 - Math.pow(1 - state.camLerpT, 3);
        camera.position.lerpVectors(state.camLerpFrom, state.camLerpTo, ease);
        controls.target.set(0, 0, 0);
    }
    controls.update();

    // ── Galaxy rotation ──
    // Always rotate — ai/midAI already fall back to gentle idle values when paused,
    // so no need to gate on isPlaying. This also prevents the freeze on audio load.
    {
        const rotAI    = Math.min(1, ai + midAI * state.midRotationWeight);
        const rotSpeed = 0.05 * rotAI * dt * 60 * 0.5;
        rotateGalaxyParticles(rotSpeed);
        rotateHaloParticles(rotSpeed);
        rotateNebulaParticles(rotSpeed);
    }

    // ── Colormap auto-cycling ──
    const cycleSpeed = 0.06 + lowAI * 0.30;
    if (state.lockedCmapIndex < 0) {
        state.cmapMix += 0.016 * cycleSpeed;
        if (state.cmapMix >= 1) {
            state.cmapMix = 0;
            state.cmapA = state.cmapB;
            state.cmapB = (state.cmapB + 1) % GALAXY_COLORMAPS.length;
        }
        if (state.frameCount % 3 === 0) {
            const stopsA = GALAXY_COLORMAPS[state.cmapA].stops;
            const stopsB = GALAXY_COLORMAPS[state.cmapB].stops;
            for (let i = 0; i < state.activeGalaxyCount; i++) {
                const t  = getGalaxyColorT(i);
                const cA = sampleColormap(stopsA, t);
                const cB = sampleColormap(stopsB, t);
                galaxyColorsBuf[i*3]   = cA[0] + (cB[0]-cA[0]) * state.cmapMix;
                galaxyColorsBuf[i*3+1] = cA[1] + (cB[1]-cA[1]) * state.cmapMix;
                galaxyColorsBuf[i*3+2] = cA[2] + (cB[2]-cA[2]) * state.cmapMix;
            }
            galaxyGeo.attributes.aColor.needsUpdate = true;
        }
    }

    // ── Uniforms ──
    galaxyMat.uniforms.uBrightness.value    = 0.5 + 0.5 * ai;
    starMat.uniforms.uAudioInfluence.value  = 0.6 + 0.4 * ai;
    starMat.uniforms.uTime.value            = state.time;
    haloMat.uniforms.uBrightness.value      = (0.42 + 0.18 * ai)  * state.gasDensity;
    nebulaMat.uniforms.uBrightness.value    = (0.52 + 0.36 * ai + 0.10 * visibleBeamDrive) * state.gasDensity;

    // ── Beam ──
    updateDynamicScatter(visibleBeamDrive);
    scatterMesh.visible = visibleBeamDrive > 0.01;

    // ── Central sphere ──
    const sScale = (0.09 + 0.04 * lowAI) * state.coreGlowScale * state.galaxyCoreSize;
    centralSphere.scale.setScalar(sScale / 0.09);
    sphereMat.opacity = Math.min(1.0, 0.32 + state.coreGlowIntensity * CORE_CENTER_BLOOM_REDUCTION * (0.38 + lowAI * 0.22));

    // ── Beat detection ──
    // audio.js owns beatHistory/beatCooldown — read state.audioBeat directly to avoid
    // double-advancing the ring buffer (which was halving beat detection sensitivity).
    const beatPulseThisFrame = state.isPlaying && !!state.audioBeat;
    if (beatPulseThisFrame) {
        const flash = document.getElementById('beat-flash');
        flash.classList.remove('flash'); void flash.offsetWidth; flash.classList.add('flash');
    }

    // ── Lightning ──
    const effectiveLightningFreq = state.lightningEnabled
        ? state.lightningFrequencyMultiplier * (1 + highAI * state.highLightningWeight)
        : 0;
    if (state.lightningEnabled) updateLightningSystem(visibleBeamDrive, beatPulseThisFrame, effectiveLightningFreq);
    else hideLightning();

    // ── Bloom ──
    // audio.js already lerped state.smoothedBloom this frame; use it directly.
    // We still factor in core glow and lightning since those are driven here.
    const bloomAI = Math.min(1, ai * state.bassBloomWeight);
    const bloomBoost = bloomAI * state.reactivityMultiplier * 1.8
        + state.lightningGlowDrive * state.lightningBloomBoost * 0.68
        + state.coreGlowIntensity * CORE_CENTER_BLOOM_REDUCTION * (0.22 + lowAI * 0.18);
    bloomPass.strength = state.smoothedBloom + bloomBoost * 0.5;

    // ── Render ──
    camera.layers.set(BLOOM_LAYER);
    bloomComposer.render();
    camera.layers.set(0);
    finalComposer.render();

    // ── MP4 frame capture ──
    captureFrame(now);
}

// ── Kick off ──
analyzeAudio();
animate();
updateDynamicScatter(0);
scatterMesh.visible = false;
hideLightning();
