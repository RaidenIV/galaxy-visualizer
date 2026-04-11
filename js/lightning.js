import * as THREE from 'three';
import { BLOOM_LAYER, MAX_LIGHTNING_VERTS } from './constants.js';
import { generateFractalArc } from './utils.js';
import { state } from './state.js';
import { scene, BEAM_TILT_AXIS } from './renderer.js';

// ── Lightning geometry ──
const lightningPosBuf = new Float32Array(MAX_LIGHTNING_VERTS * 3);
const lightningGeo    = new THREE.BufferGeometry();
lightningGeo.setAttribute('position', new THREE.BufferAttribute(lightningPosBuf, 3));

const lightningMat = new THREE.LineBasicMaterial({
    color: 0xdfeeff, transparent: true, opacity: 0.0, vertexColors: false,
});
const lightningLines = new THREE.LineSegments(lightningGeo, lightningMat);

const lightningGlowMat = new THREE.LineBasicMaterial({
    color: 0x4a9bff, transparent: true, opacity: 0.0,
    blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: false,
});
const lightningGlowLines = new THREE.LineSegments(lightningGeo, lightningGlowMat);
lightningGlowLines.layers.set(BLOOM_LAYER);

const lightningGroup = new THREE.Group();
lightningGroup.rotateOnAxis(BEAM_TILT_AXIS, -40 * Math.PI / 180);
scene.add(lightningGroup);
lightningGroup.add(lightningLines);
lightningGroup.add(lightningGlowLines);

// ── Per-side state ──
export const lightningState = {
    '1':  { active: false, cooldown: 0, ttl: 0, duration: 0, strength: 0, paths: [] },
    '-1': { active: false, cooldown: 0, ttl: 0, duration: 0, strength: 0, paths: [] },
};

function generateCoreLightningPaths(side, ai) {
    const mainPoints = [];
    const beamHalf = Math.max(0.8, state.maxGalaxyRxy * ai) * state.lightningStrikeLength;
    const endY = side * beamHalf * (0.72 + ai * 0.22);
    const steps = Math.max(12, 8 + state.lightningDepth * 3);
    const coreRadius = 0.006 + ai * 0.016;
    const farRadius  = coreRadius + (0.12 + state.lightningMaxOffset * 0.34 + ai * 0.42);
    let angle = Math.random() * Math.PI * 2;

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const y = endY * t;
        const spread = coreRadius + (farRadius - coreRadius) * Math.pow(t, 1.6);
        angle += (Math.random() - 0.5) * (0.12 + state.lightningBranchLength * 0.55);
        const radialJitter = (Math.random() - 0.5) * state.lightningMaxOffset * (0.012 + 0.14 * t * t);
        const radius = Math.max(0, spread + radialJitter);
        mainPoints.push(new THREE.Vector3(
            Math.cos(angle) * radius + (Math.random() - 0.5) * 0.01 * t,
            y,
            Math.sin(angle) * radius + (Math.random() - 0.5) * 0.01 * t
        ));
    }
    mainPoints[0].set(0, 0, 0);
    for (let i = 1; i < mainPoints.length - 1; i++) {
        const t = i / (mainPoints.length - 1);
        const lateralScale = (0.008 + state.lightningMaxOffset * 0.045) * (0.22 + 2.35 * t * t);
        mainPoints[i].x += (Math.random() - 0.5) * lateralScale;
        mainPoints[i].z += (Math.random() - 0.5) * lateralScale;
    }

    const paths = [mainPoints];
    const branchProb = Math.min(0.9, state.lightningBranchProb * (0.60 + ai * 0.95));
    const maxBranches = Math.max(1, Math.round(2 + ai * 4 + state.lightningDepth * 0.35));

    for (let i = 2; i < mainPoints.length - 2 && paths.length - 1 < maxBranches; i++) {
        const t = i / (mainPoints.length - 1);
        if (Math.random() > branchProb * (0.30 + 0.95 * t)) continue;
        const branchStart = mainPoints[i].clone();
        let radialDir = new THREE.Vector3(branchStart.x, 0, branchStart.z);
        if (radialDir.lengthSq() < 1e-6) {
            const fa = Math.random() * Math.PI * 2;
            radialDir.set(Math.cos(fa), 0, Math.sin(fa));
        } else { radialDir.normalize(); }
        const tangentDir = new THREE.Vector3(-radialDir.z, 0, radialDir.x).multiplyScalar((Math.random() - 0.5) * 0.65);
        const branchDir = radialDir.clone().add(tangentDir);
        branchDir.y = side * (0.04 + 0.22 * Math.random()) * (0.35 + 0.65 * t);
        branchDir.normalize();
        const branchLength = (0.05 + state.lightningBranchLength * 0.85 + ai * 0.22) * (0.30 + 0.95 * t);
        const branchEnd = branchStart.clone().add(branchDir.multiplyScalar(branchLength));
        const branchDepth = Math.max(1, state.lightningDepth - 2);
        const branchOffset = Math.max(0.01, state.lightningMaxOffset * (0.05 + 0.12 * t));
        const branchArc = generateFractalArc(branchStart, branchEnd, branchDepth, branchOffset);
        if (branchArc.length > 1) paths.push(branchArc);
    }
    return paths;
}

function triggerLightningStrike(side, drive) {
    const ls = lightningState[String(side)];
    const strikeStrength = Math.max(0.2, Math.min(1, drive));
    ls.paths    = generateCoreLightningPaths(side, strikeStrength);
    ls.active   = true;
    ls.duration = 2 + Math.floor(Math.random() * 3);
    ls.ttl      = ls.duration;
    ls.cooldown = 3 + Math.floor((1 - strikeStrength) * 16 + Math.random() * 10);
    ls.strength = strikeStrength;
}

export function hideLightning() {
    lightningGeo.setDrawRange(0, 0);
    lightningMat.opacity = 0.0;
    lightningGlowMat.opacity = 0.0;
    state.lightningGlowDrive = 0.0;
}

export function updateLightningSystem(beamDrive, beatPulseThisFrame, effectiveFreqMult) {
    const freqMult = effectiveFreqMult !== undefined ? effectiveFreqMult : state.lightningFrequencyMultiplier;
    let vIdx = 0, strongestLife = 0, strongestStrike = 0;
    const canStrike = state.isPlaying && beamDrive > 0.10;

    function addPath(points) {
        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i], b = points[i + 1];
            if (vIdx + 6 > MAX_LIGHTNING_VERTS * 3) return;
            lightningPosBuf[vIdx++] = a.x; lightningPosBuf[vIdx++] = a.y; lightningPosBuf[vIdx++] = a.z;
            lightningPosBuf[vIdx++] = b.x; lightningPosBuf[vIdx++] = b.y; lightningPosBuf[vIdx++] = b.z;
        }
    }

    [1, -1].forEach((side) => {
        const ls = lightningState[String(side)];
        if (ls.active) {
            const life = ls.ttl / Math.max(1, ls.duration);
            strongestLife = Math.max(strongestLife, life);
            strongestStrike = Math.max(strongestStrike, ls.strength);
            ls.paths.forEach(addPath);
            ls.ttl -= 1;
            if (ls.ttl <= 0) ls.active = false;
            return;
        }
        ls.cooldown = Math.max(0, ls.cooldown - 1);
        if (!canStrike || ls.cooldown > 0) return;
        const strikeBias = Math.pow(Math.max(0, Math.min(1, beamDrive)), 2.15);
        const ambientChance = (0.0005 + strikeBias * 0.11) * freqMult;
        const beatChance = beatPulseThisFrame ? (0.045 + strikeBias * 0.30) * freqMult : 0.0;
        if (Math.random() < Math.min(0.95, ambientChance + beatChance)) {
            triggerLightningStrike(side, beamDrive * (0.9 + Math.random() * 0.28));
        }
    });

    if (vIdx === 0) { hideLightning(); return; }
    lightningGeo.attributes.position.needsUpdate = true;
    lightningGeo.setDrawRange(0, vIdx / 3);
    const coreOpacity = Math.min(0.78, (0.20 + strongestStrike * 0.28 + strongestLife * 0.12) * (0.88 + Math.random() * 0.12));
    const glowOpacity = Math.min(1.0, (0.16 + strongestStrike * 0.26 + strongestLife * 0.10) * state.lightningBloomBoost);
    lightningMat.opacity = coreOpacity;
    lightningGlowMat.opacity = glowOpacity;
    state.lightningGlowDrive = Math.max(state.lightningGlowDrive, glowOpacity * (0.45 + strongestStrike * 0.55));
}
