import * as THREE from 'three';
import { N_GALAXY, BLOOM_LAYER, GALAXY_OUTER_FLARE, GALAXY_HALO_EXTENT, GALAXY_COLORMAPS, DEFAULT_CMAP_INDEX } from './constants.js';
import { gaussianRandom, saturate, sampleColormap } from './utils.js';
import { state } from './state.js';
import { scene, BEAM_TILT_AXIS, bloomPass } from './renderer.js';

// ── Soft gaussian circle texture ──
function makeCircleTexture() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0.0, 'rgba(255,255,255,1.0)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.85)');
    g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
}
export const circleTexture = makeCircleTexture();

// ── Particle data arrays ──
export const galaxyNormR     = new Float32Array(N_GALAXY);
export const gx              = new Float32Array(N_GALAXY);
export const gz              = new Float32Array(N_GALAXY);
export const gy              = new Float32Array(N_GALAXY);
export const galaxyRxy       = new Float32Array(N_GALAXY);
export const galaxyTheta     = new Float32Array(N_GALAXY);
export const galaxyArmGlow   = new Float32Array(N_GALAXY);
export const galaxyDustWeight= new Float32Array(N_GALAXY);
export const galaxyWarmCore  = new Float32Array(N_GALAXY);
export const galaxyMidBlue   = new Float32Array(N_GALAXY);
export const galaxyOuterCool = new Float32Array(N_GALAXY);
export const galaxyNebulaWeight = new Float32Array(N_GALAXY);
export const galaxySizeScale = new Float32Array(N_GALAXY);
export const galaxyAlphaScale= new Float32Array(N_GALAXY);

export const galaxyPositionsBuf = new Float32Array(N_GALAXY * 3);
export const galaxyColorsBuf    = new Float32Array(N_GALAXY * 3);
export const galaxyAlphasBuf    = new Float32Array(N_GALAXY);
export const galaxySizesBuf     = new Float32Array(N_GALAXY);

// ── LUT texture helpers (#5) ──
function makeLutData(stops) {
    const W = 256, data = new Uint8Array(W * 4);
    for (let x = 0; x < W; x++) {
        const t = x / (W - 1);
        const c = sampleColormap(stops, t);
        data[x*4]   = Math.round(Math.min(1, Math.max(0, c[0])) * 255);
        data[x*4+1] = Math.round(Math.min(1, Math.max(0, c[1])) * 255);
        data[x*4+2] = Math.round(Math.min(1, Math.max(0, c[2])) * 255);
        data[x*4+3] = 255;
    }
    return data;
}
function makeLutTexture(stops) {
    const tex = new THREE.DataTexture(makeLutData(stops), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}
function updateLutTexture(tex, stops) {
    tex.image.data.set(makeLutData(stops));
    tex.needsUpdate = true;
}

// Persistent LUT textures — updated in-place to avoid per-frame allocation
const _lutTexA = makeLutTexture(GALAXY_COLORMAPS[DEFAULT_CMAP_INDEX].stops);
const _lutTexB = makeLutTexture(GALAXY_COLORMAPS[DEFAULT_CMAP_INDEX].stops);
let _lastLutA = DEFAULT_CMAP_INDEX, _lastLutB = DEFAULT_CMAP_INDEX;

// Called by main.js during auto-cycling instead of the CPU color loop
export function setColormapLut(indexA, indexB, mix, reverse) {
    if (indexA !== _lastLutA) { updateLutTexture(_lutTexA, GALAXY_COLORMAPS[indexA % GALAXY_COLORMAPS.length].stops); _lastLutA = indexA; }
    if (indexB !== _lastLutB) { updateLutTexture(_lutTexB, GALAXY_COLORMAPS[indexB % GALAXY_COLORMAPS.length].stops); _lastLutB = indexB; }
    galaxyMat.uniforms.uLutMix.value     = mix;
    galaxyMat.uniforms.uLutReverse.value = reverse ? 1.0 : 0.0;
}

// ── Shaders ──
// Vertex shader: samples LUT on GPU — eliminates 75k-particle CPU color loop each frame (#5)
const galaxyVertShader = `
    attribute float aNormR;
    attribute float aWarmCore;
    attribute float aArmGlow;
    attribute float aDust;
    attribute float aMidBlue;
    attribute float aOuterCool;
    attribute float aAlpha;
    attribute float aSize;
    uniform sampler2D uLutA;
    uniform sampler2D uLutB;
    uniform float     uLutMix;
    uniform float     uLutReverse;
    uniform float     uDustIntensity;
    uniform float     uTraditional;
    uniform float     uMorphFade;
    uniform float     uBrightness;
    uniform float     uPointScale;
    varying vec3  vColor;
    varying float vAlpha;
    void main() {
        float t = pow(aNormR, 0.82);
        t = uLutReverse > 0.5 ? (1.0 - t) : t;
        t = clamp(t, 0.001, 0.999);
        vec3 col = mix(texture2D(uLutA, vec2(t, 0.5)).rgb,
                       texture2D(uLutB, vec2(t, 0.5)).rgb, uLutMix);
        if (uTraditional > 0.5) {
            float bright = (1.0 + 0.42*aWarmCore) * (1.0 + 0.10*aArmGlow)
                         * (1.0 - aDust * 0.72 * uDustIntensity);
            col = min(vec3(1.6), col * bright);
        } else {
            float warm=aWarmCore, arm=aArmGlow, dust=aDust, mid=aMidBlue, outer=aOuterCool;
            col.r += (1.00-col.r)*0.78*warm; col.g += (0.94-col.g)*0.64*warm; col.b += (0.85-col.b)*0.40*warm;
            col.r  = col.r*(1.0-0.08*mid-0.16*outer)+0.10*mid+0.04*outer;
            col.g  = col.g*(1.0-0.03*mid           )+0.18*mid+0.07*outer;
            col.b  = col.b*(1.0+0.10*mid+0.18*outer)+0.20*mid+0.12*outer;
            col   *= vec3(0.94+0.14*arm, 0.96+0.18*arm, 1.00+0.30*arm);
            float dm = 1.0 - dust*0.72*uDustIntensity;
            col.r  *= dm*(1.0-0.08*outer); col.g *= dm*(0.98+0.03*mid); col.b *= dm*(0.98+0.08*mid+0.10*outer);
        }
        vColor = col * uBrightness;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        float viewDist = -mvPos.z;
        float depthBoost = clamp(1.22 - viewDist * 0.045, 0.68, 1.22);
        vAlpha = aAlpha * depthBoost * uMorphFade;
        gl_PointSize = aSize * uPointScale * (350.0 / max(0.001, viewDist));
        gl_Position  = projectionMatrix * mvPos;
    }
`;
const galaxyFragShader = `
    uniform sampler2D pointTexture;
    varying vec3  vColor;
    varying float vAlpha;
    void main() {
        vec4 tex = texture2D(pointTexture, gl_PointCoord);
        gl_FragColor = vec4(vColor, vAlpha * tex.a);
        if (gl_FragColor.a < 0.005) discard;
    }
`;

export const galaxyMat = new THREE.ShaderMaterial({
    uniforms: {
        pointTexture:   { value: circleTexture },
        uBrightness:    { value: 1.0 },
        uPointScale:    { value: 1.0 },
        uLutA:          { value: _lutTexA },
        uLutB:          { value: _lutTexB },
        uLutMix:        { value: 0.0 },
        uLutReverse:    { value: 1.0 },   // matches default state.reverseColorMap = true
        uDustIntensity: { value: 1.0 },
        uTraditional:   { value: 1.0 },   // matches default colorMapDistributionMode = 'traditional'
        uMorphFade:     { value: 1.0 },   // #4 morph: fades to 0 on type change, back to 1 after rebuild
    },
    vertexShader: galaxyVertShader,
    fragmentShader: galaxyFragShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
});

export const galaxyGeo = new THREE.BufferGeometry();
galaxyGeo.setAttribute('position', new THREE.BufferAttribute(galaxyPositionsBuf, 3));
// LUT attributes — per-particle data the GPU shader uses for colour stylization (#5)
galaxyGeo.setAttribute('aNormR',    new THREE.BufferAttribute(galaxyNormR,       1));
galaxyGeo.setAttribute('aWarmCore', new THREE.BufferAttribute(galaxyWarmCore,    1));
galaxyGeo.setAttribute('aArmGlow',  new THREE.BufferAttribute(galaxyArmGlow,     1));
galaxyGeo.setAttribute('aDust',     new THREE.BufferAttribute(galaxyDustWeight,  1));
galaxyGeo.setAttribute('aMidBlue',  new THREE.BufferAttribute(galaxyMidBlue,     1));
galaxyGeo.setAttribute('aOuterCool',new THREE.BufferAttribute(galaxyOuterCool,   1));
galaxyGeo.setAttribute('aAlpha',    new THREE.BufferAttribute(galaxyAlphasBuf,   1));
galaxyGeo.setAttribute('aSize',     new THREE.BufferAttribute(galaxySizesBuf,    1));

export const galaxyGroup = new THREE.Group();
galaxyGroup.rotateOnAxis(BEAM_TILT_AXIS, -40 * Math.PI / 180);
scene.add(galaxyGroup);
export let galaxyBaseQuaternion = galaxyGroup.quaternion.clone();

const galaxyMesh = new THREE.Points(galaxyGeo, galaxyMat);
galaxyGroup.add(galaxyMesh);
galaxyMesh.layers.enable(BLOOM_LAYER);

// ── Colormap helpers ──
export function getCurrentColorStops() {
    if (state.lockedCmapIndex >= 0 && GALAXY_COLORMAPS[state.lockedCmapIndex]) return GALAXY_COLORMAPS[state.lockedCmapIndex].stops;
    if (GALAXY_COLORMAPS[state.cmapA]) return GALAXY_COLORMAPS[state.cmapA].stops;
    return GALAXY_COLORMAPS[DEFAULT_CMAP_INDEX].stops;
}

export function getGalaxyColorT(i) {
    const t = Math.pow(galaxyNormR[i], 0.82);
    return state.reverseColorMap ? (1.0 - t) : t;
}

// #5: replaces per-particle CPU color write with LUT texture update + mode uniform sync.
// Alpha and size still computed on CPU since they depend on per-particle fields, not the colormap.
export function rebuildGalaxyColors(stops) {
    // Update LUT uniforms (GPU samples these each vertex)
    updateLutTexture(_lutTexA, stops);
    updateLutTexture(_lutTexB, stops);
    _lastLutA = -1; _lastLutB = -1; // force re-upload on next setColormapLut call
    galaxyMat.uniforms.uLutMix.value      = 0;
    galaxyMat.uniforms.uLutReverse.value  = state.reverseColorMap ? 1.0 : 0.0;
    galaxyMat.uniforms.uDustIntensity.value = state.dustLaneIntensity;
    galaxyMat.uniforms.uTraditional.value = state.colorMapDistributionMode === 'traditional' ? 1.0 : 0.0;
    // Alpha and size: still per-particle, upload to GPU
    for (let i = 0; i < N_GALAXY; i++) {
        galaxyAlphasBuf[i] = galaxyAlphaScale[i];
        const rNorm = galaxyNormR[i], armGlow = galaxyArmGlow[i], warm = galaxyWarmCore[i];
        galaxySizesBuf[i] = Math.max(0.004, Math.min(0.125,
            (0.010 + 0.010 * (1.0 - rNorm) + 0.006 * armGlow + 0.010 * warm) * galaxySizeScale[i]
        ));
    }
}

export function refreshCurrentGalaxyColors() {
    rebuildGalaxyColors(getCurrentColorStops());
    // LUT and mode uniforms updated inside rebuildGalaxyColors; mark per-particle arrays dirty
    ['aNormR','aWarmCore','aArmGlow','aDust','aMidBlue','aOuterCool','aAlpha','aSize'].forEach(a => {
        if (galaxyGeo.attributes[a]) galaxyGeo.attributes[a].needsUpdate = true;
    });
}

export function updateGalaxyDrawRange() {
    state.activeGalaxyCount = Math.max(1000, Math.min(N_GALAXY, Math.floor(state.baseGalaxyCount * state.galaxyStarAmountMultiplier)));
    galaxyGeo.setDrawRange(0, state.activeGalaxyCount);
}

export function applyPerformanceCounts(starGeo, scatterGeo, haloGeo, nebulaGeo) {
    updateGalaxyDrawRange();
    if (starGeo)    starGeo.setDrawRange(0, state.activeStarCount);
    if (scatterGeo) scatterGeo.setDrawRange(0, state.activeScatterCount);
    if (haloGeo)    haloGeo.setDrawRange(0, state.activeHaloCount);
    if (nebulaGeo)  nebulaGeo.setDrawRange(0, state.activeNebulaCount);
}

export function applyGalaxyInclination(deg) {
    const incQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deg * Math.PI / 180);
    galaxyGroup.quaternion.multiplyQuaternions(galaxyBaseQuaternion, incQ);
}

export function applyGalaxyScaleAndFlatness() {
    galaxyGroup.scale.set(state.galaxyScaleFactor, state.galaxyScaleFactor * state.galaxyFlatness, state.galaxyScaleFactor);
}

// ── Galaxy particle pass-1 init ──
function initGalaxyPass1() {
    let maxR = 0;
    for (let i = 0; i < N_GALAXY; i++) {
        gx[i] = gaussianRandom() + gaussianRandom();
        gz[i] = gaussianRandom() + gaussianRandom();
        gy[i] = gaussianRandom() + gaussianRandom();
        galaxyRxy[i] = Math.sqrt(gx[i]*gx[i] + gz[i]*gz[i]);
        galaxyTheta[i] = Math.atan2(gz[i], gx[i]);
        if (galaxyRxy[i] > maxR) maxR = galaxyRxy[i];
    }
    state.maxGalaxyRxy = maxR;
}

// ── Galaxy type morph (#4) ──
let _morphState  = 'idle';   // 'fadeout' | 'fadein' | 'idle'
let _morphT      = 0;
let _pendingArgs = null;
let _builtOnce   = false;
const MORPH_OUT_DUR = 0.28;
const MORPH_IN_DUR  = 0.48;

// Steps the fade transition — called from animate() each frame
export function updateGalaxyMorph(dt) {
    if (_morphState === 'idle') return;
    if (_morphState === 'fadeout') {
        _morphT += dt / MORPH_OUT_DUR;
        galaxyMat.uniforms.uMorphFade.value = Math.max(0, 1 - _morphT);
        if (_morphT >= 1) {
            _buildGalaxyNow(..._pendingArgs);
            _pendingArgs = null;
            _morphState  = 'fadein';
            _morphT      = 0;
        }
    } else if (_morphState === 'fadein') {
        _morphT += dt / MORPH_IN_DUR;
        galaxyMat.uniforms.uMorphFade.value = Math.min(1, _morphT);
        if (_morphT >= 1) { galaxyMat.uniforms.uMorphFade.value = 1.0; _morphState = 'idle'; }
    }
}

// ── Full galaxy rebuild ──
// Public entry point: immediate on first call, smooth morph on subsequent calls (#4)
export function buildGalaxy(armCount, armTwist, typeKey) {
    if (!_builtOnce) {
        _buildGalaxyNow(armCount, armTwist, typeKey);
        _builtOnce = true;
        return;
    }
    // Subsequent type changes → fade-out → rebuild → fade-in
    _pendingArgs = [armCount, armTwist, typeKey];
    _morphState  = 'fadeout';
    _morphT      = 0;
}

function _buildGalaxyNow(armCount, armTwist, typeKey) {
    initGalaxyPass1();
    const type = typeKey || 'barred';

    function finalize() {
        ['position','aNormR','aWarmCore','aArmGlow','aDust','aMidBlue','aOuterCool','aAlpha','aSize']
            .forEach(a => { if (galaxyGeo.attributes[a]) galaxyGeo.attributes[a].needsUpdate = true; });
        rebuildGalaxyColors(getCurrentColorStops());
    }

    if (type === 'elliptical') {
        let fmx = 0;
        for (let i = 0; i < N_GALAXY; i++) {
            const sphereR = state.maxGalaxyRxy * Math.pow(Math.random(), 0.45);
            const cosT = 2 * Math.random() - 1, sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
            const phi = Math.random() * Math.PI * 2;
            gx[i] = sphereR * sinT * Math.cos(phi); gz[i] = sphereR * sinT * Math.sin(phi); gy[i] = sphereR * cosT * 0.7;
            galaxyRxy[i] = Math.sqrt(gx[i]*gx[i] + gz[i]*gz[i]); galaxyTheta[i] = Math.atan2(gz[i], gx[i]);
            if (galaxyRxy[i] > fmx) fmx = galaxyRxy[i];
            const rn2 = saturate(galaxyRxy[i] / (state.maxGalaxyRxy + 1e-5));
            galaxyNormR[i] = rn2;
            const bulge = Math.exp(-Math.pow(rn2 / 0.45, 2.0));
            galaxyDustWeight[i] = 0; galaxyWarmCore[i] = bulge; galaxyArmGlow[i] = 0;
            galaxyMidBlue[i] = Math.exp(-Math.pow((rn2 - 0.56) / 0.18, 2.0));
            galaxyOuterCool[i] = Math.pow(saturate((rn2 - 0.70) / 0.30), 1.20); galaxyNebulaWeight[i] = 0;
            let sr = Math.exp((Math.random() * 2.0 - 1.0) * 0.78);
            galaxySizeScale[i] = Math.max(0.35, Math.min(4.8, sr * (0.75 + bulge * 0.95)));
            galaxyAlphaScale[i] = saturate((0.25 + 0.55 * bulge + 0.20 * (1 - rn2)));
            galaxyPositionsBuf[i*3] = gx[i]; galaxyPositionsBuf[i*3+1] = gy[i]; galaxyPositionsBuf[i*3+2] = gz[i];
        }
        state.maxGalaxyRxy = fmx; finalize(); return;
    }

    if (type === 'lenticular') {
        let fmx = 0;
        for (let i = 0; i < N_GALAXY; i++) {
            const rNorm = saturate(galaxyRxy[i] / (state.maxGalaxyRxy + 1e-5));
            galaxyNormR[i] = rNorm;
            gy[i] = gy[i] * (0.012 + 0.025 * rNorm);
            if (galaxyRxy[i] > fmx) fmx = galaxyRxy[i];
            const bulge = Math.exp(-Math.pow(rNorm / 0.20, 2.0));
            galaxyDustWeight[i] = 0; galaxyWarmCore[i] = bulge; galaxyArmGlow[i] = 0;
            galaxyMidBlue[i] = Math.exp(-Math.pow((rNorm - 0.56) / 0.18, 2.0));
            galaxyOuterCool[i] = Math.pow(saturate((rNorm - 0.70) / 0.30), 1.20); galaxyNebulaWeight[i] = 0;
            let sr = Math.exp((Math.random() * 2.0 - 1.0) * 0.78);
            galaxySizeScale[i] = Math.max(0.35, Math.min(4.8, sr * (0.75 + bulge * 0.95)));
            galaxyAlphaScale[i] = saturate((0.18 + 0.55 * bulge + 0.18 * (1 - rNorm)));
            gx[i] = galaxyRxy[i] * Math.cos(galaxyTheta[i]); gz[i] = galaxyRxy[i] * Math.sin(galaxyTheta[i]);
            galaxyPositionsBuf[i*3] = gx[i]; galaxyPositionsBuf[i*3+1] = gy[i]; galaxyPositionsBuf[i*3+2] = gz[i];
        }
        state.maxGalaxyRxy = fmx; finalize(); return;
    }

    if (type === 'ring') {
        let fmx = 0;
        for (let i = 0; i < N_GALAXY; i++) {
            const ringR = state.maxGalaxyRxy * (0.55 + 0.30 * Math.pow(Math.random(), 2.0));
            const phi = Math.random() * Math.PI * 2, jitter = (Math.random() - 0.5) * state.maxGalaxyRxy * 0.08;
            gx[i] = (ringR + jitter) * Math.cos(phi); gz[i] = (ringR + jitter) * Math.sin(phi); gy[i] = gy[i] * 0.03;
            galaxyRxy[i] = Math.sqrt(gx[i]*gx[i] + gz[i]*gz[i]); galaxyTheta[i] = phi;
            if (galaxyRxy[i] > fmx) fmx = galaxyRxy[i];
            const rNorm = saturate(galaxyRxy[i] / (state.maxGalaxyRxy + 1e-5)); galaxyNormR[i] = rNorm;
            const ringGlow = Math.exp(-Math.pow((rNorm - 0.70) / 0.12, 2.0));
            galaxyDustWeight[i] = ringGlow * 0.3; galaxyWarmCore[i] = Math.exp(-Math.pow(rNorm / 0.18, 2.0)) * 0.4;
            galaxyArmGlow[i] = ringGlow; galaxyMidBlue[i] = ringGlow * 0.6;
            galaxyOuterCool[i] = Math.pow(saturate((rNorm - 0.80) / 0.20), 1.20); galaxyNebulaWeight[i] = ringGlow * 0.5;
            let sr = Math.exp((Math.random() * 2.0 - 1.0) * 0.78);
            galaxySizeScale[i] = Math.max(0.35, Math.min(4.8, sr * (0.75 + ringGlow * 0.42)));
            galaxyAlphaScale[i] = saturate((0.10 + 0.60 * ringGlow + 0.10 * (1 - rNorm)));
            galaxyPositionsBuf[i*3] = gx[i]; galaxyPositionsBuf[i*3+1] = gy[i]; galaxyPositionsBuf[i*3+2] = gz[i];
        }
        state.maxGalaxyRxy = fmx; finalize(); return;
    }

    if (type === 'core') {
        const coreSizeScale       = 1.0;
        const barrenCoreNorm      = Math.max(0.05, Math.min(0.35, 0.13 * coreSizeScale));
        const outerCoreNorm       = Math.max(barrenCoreNorm + 0.15, Math.min(0.98, 0.86 * Math.pow(coreSizeScale, 0.28)));
        const innerCrowdingCenter = Math.max(barrenCoreNorm + 0.03, Math.min(0.70, 0.24 * coreSizeScale));
        const innerCrowdingWidth  = 0.10 + 0.06 * coreSizeScale;
        const bulgeRadius         = Math.max(0.08, Math.min(0.42, 0.22 * coreSizeScale));
        const holeRadius          = Math.max(0.05, Math.min(0.24, 0.11 * coreSizeScale));

        // Pass 1 — scatter particles into clumps, store provisional luminance
        let fmx = 0;
        for (let i = 0; i < N_GALAXY; i++) {
            const clumpAngle = Math.floor(Math.random() * 7) * (Math.PI * 2 / 7) + (Math.random() - 0.5) * 0.9;
            const inwardBias = Math.pow(Math.random(), 1.85);
            const clumpRNorm = barrenCoreNorm + (outerCoreNorm - barrenCoreNorm) * inwardBias;
            const clumpR     = state.maxGalaxyRxy * clumpRNorm;
            const scatter    = state.maxGalaxyRxy * (0.04 + 0.14 * clumpRNorm) * (0.55 + Math.random() * 0.85);
            const lum        = 0.24 + Math.random() * 0.76;

            gx[i] = clumpR * Math.cos(clumpAngle) + (Math.random() - 0.5) * scatter;
            gz[i] = clumpR * Math.sin(clumpAngle) * (0.6 + Math.random() * 0.7) + (Math.random() - 0.5) * scatter;
            gy[i] = gy[i] * (0.04 + 0.12 * Math.pow(Math.random(), 1.5));

            galaxyRxy[i]   = Math.sqrt(gx[i]*gx[i] + gz[i]*gz[i]);
            galaxyTheta[i] = Math.atan2(gz[i], gx[i]);
            if (galaxyRxy[i] > fmx) fmx = galaxyRxy[i];

            galaxyArmGlow[i]      = lum;
            galaxyMidBlue[i]      = lum;
            galaxyDustWeight[i]   = 0.0;
            galaxyWarmCore[i]     = 0.0;
            galaxyOuterCool[i]    = 0.0;
            galaxyNebulaWeight[i] = lum * 0.5;
        }
        state.maxGalaxyRxy = fmx;

        // Pass 2 — derive final color fields from redistributed radii
        for (let i = 0; i < N_GALAXY; i++) {
            const rn2  = saturate(galaxyRxy[i] / (state.maxGalaxyRxy + 1e-5));
            const lum  = galaxyArmGlow[i];
            const coreHole   = 1.0 - Math.exp(-Math.pow(rn2 / holeRadius, 4.2));
            const innerCrowd = 1.0 + 1.0 * Math.exp(-Math.pow((rn2 - innerCrowdingCenter) / innerCrowdingWidth, 2.0));
            const bulge      = Math.exp(-Math.pow(rn2 / bulgeRadius, 2.0)) * coreHole;

            galaxyNormR[i]        = rn2;
            galaxyDustWeight[i]   = (1.0 - lum) * 0.42 * Math.exp(-Math.pow((rn2 - 0.30) / 0.28, 2.0));
            galaxyWarmCore[i]     = bulge;
            galaxyArmGlow[i]      = lum * innerCrowd * (0.35 + 0.65 * (1.0 - rn2));
            galaxyMidBlue[i]      = lum * (0.18 + 0.82 * Math.exp(-Math.pow((rn2 - 0.52) / 0.30, 2.0)));
            galaxyOuterCool[i]    = Math.pow(saturate((rn2 - 0.68) / 0.32), 1.15);
            galaxyNebulaWeight[i] = lum * innerCrowd * (0.25 + 0.35 * (1.0 - rn2));

            // ── Size & alpha (missing from original pass 2 — caused all Eye particles to be invisible) ──
            let sr2 = Math.exp((Math.random() * 2.0 - 1.0) * 0.78);
            if (Math.random() < 0.016) sr2 *= 2.2 + Math.random() * 2.5;
            galaxySizeScale[i]  = Math.max(0.35, Math.min(4.8, sr2 * (0.75 + lum * 0.52 + bulge * 0.95)));
            galaxyAlphaScale[i] = saturate(0.12 + 0.40 * lum * innerCrowd + 0.42 * bulge + 0.10 * (1.0 - rn2));

            galaxyPositionsBuf[i*3]   = gx[i];
            galaxyPositionsBuf[i*3+1] = gy[i];
            galaxyPositionsBuf[i*3+2] = gz[i];
        }

        finalize(); return;
    }

    if (type === 'irregular') {
        const N_CLUMPS = 12;
        const clumpCx = new Float32Array(N_CLUMPS), clumpCz = new Float32Array(N_CLUMPS);
        const clumpWeight = new Float32Array(N_CLUMPS), clumpBulge = new Float32Array(N_CLUMPS);
        for (let c = 0; c < N_CLUMPS; c++) {
            const angle = Math.random() * Math.PI * 2, r = state.maxGalaxyRxy * (0.05 + 0.78 * Math.pow(Math.random(), 0.55));
            clumpCx[c] = r * Math.cos(angle) * (0.75 + Math.random() * 0.55);
            clumpCz[c] = r * Math.sin(angle) * (0.55 + Math.random() * 0.80);
            clumpWeight[c] = 0.35 + Math.random() * 0.65; clumpBulge[c] = c === 0 ? 1.0 : Math.random() * 0.4;
        }
        let minR = Infinity, nucleusIdx = 0;
        for (let c = 0; c < N_CLUMPS; c++) { const cr = Math.sqrt(clumpCx[c]**2 + clumpCz[c]**2); if (cr < minR) { minR = cr; nucleusIdx = c; } }
        clumpBulge[nucleusIdx] = 1.0;
        let totalW = 0; const clumpCDF = new Float32Array(N_CLUMPS);
        for (let c = 0; c < N_CLUMPS; c++) { totalW += clumpWeight[c]; clumpCDF[c] = totalW; }
        let fmx = 0;
        for (let i = 0; i < N_GALAXY; i++) {
            const pick = Math.random() * totalW; let c = 0;
            while (c < N_CLUMPS - 1 && clumpCDF[c] < pick) c++;
            const spread = state.maxGalaxyRxy * (0.06 + 0.20 * (1 - clumpWeight[c]));
            gx[i] = clumpCx[c] + gaussianRandom() * spread; gz[i] = clumpCz[c] + gaussianRandom() * spread * 0.85; gy[i] = gy[i] * (0.03 + 0.08 * Math.random());
            galaxyRxy[i] = Math.sqrt(gx[i]**2 + gz[i]**2); galaxyTheta[i] = Math.atan2(gz[i], gx[i]);
            if (galaxyRxy[i] > fmx) fmx = galaxyRxy[i];
            const rn2 = saturate(galaxyRxy[i] / (state.maxGalaxyRxy + 1e-5)); galaxyNormR[i] = rn2;
            const lum = clumpWeight[c], isNucleus = (c === nucleusIdx);
            const bulge = isNucleus ? Math.exp(-Math.pow(rn2 / 0.18, 2.0)) : clumpBulge[c] * Math.exp(-Math.pow(rn2 / 0.30, 2.0));
            galaxyDustWeight[i] = (1 - lum) * 0.5 * Math.exp(-Math.pow((rn2 - 0.30) / 0.25, 2.0));
            galaxyWarmCore[i] = bulge; galaxyArmGlow[i] = lum * (0.4 + 0.6 * (1 - rn2));
            galaxyMidBlue[i] = lum * 0.55; galaxyOuterCool[i] = Math.pow(saturate((rn2 - 0.70) / 0.30), 1.20); galaxyNebulaWeight[i] = lum * 0.5;
            let sr = Math.exp((Math.random() * 2.0 - 1.0) * 0.78); if (Math.random() < 0.018) sr *= 2.2 + Math.random() * 2.5;
            galaxySizeScale[i] = Math.max(0.35, Math.min(4.8, sr * (0.75 + lum * 0.45 + bulge * 0.90)));
            galaxyAlphaScale[i] = saturate((0.15 + 0.35 * lum + 0.42 * bulge + 0.12 * (1 - rn2)));
            galaxyPositionsBuf[i*3] = gx[i]; galaxyPositionsBuf[i*3+1] = gy[i]; galaxyPositionsBuf[i*3+2] = gz[i];
        }
        state.maxGalaxyRxy = fmx; finalize(); return;
    }

    if (type === 'polarring') {
        // ── Polar Ring Galaxy — flat lenticular host + perpendicular stellar ring ──
        // ~58% particles form the flat lenticular host disc in the XZ plane
        // ~42% form a luminous ring perpendicular to the host (the polar ring, in XY plane)
        let fmx = 0;
        const RING_FRAC = 0.42;
        for (let i = 0; i < N_GALAXY; i++) {
            const inPolarRing = Math.random() < RING_FRAC;
            if (inPolarRing) {
                // Ring: centred in XY plane (appears as a vertical hoop around the host)
                const ringNorm = 0.50 + 0.32 * Math.pow(Math.random(), 1.8);
                const ringR    = state.maxGalaxyRxy * ringNorm;
                const phi      = Math.random() * Math.PI * 2;
                const jitter   = (Math.random() - 0.5) * state.maxGalaxyRxy * 0.06;
                gx[i] = (ringR + jitter) * Math.cos(phi);
                gy[i] = (ringR + jitter) * Math.sin(phi); // vertical extent
                gz[i] = (Math.random() - 0.5) * state.maxGalaxyRxy * 0.10; // thin lateral spread
                galaxyRxy[i]   = Math.sqrt(gx[i]*gx[i] + gz[i]*gz[i]);
                galaxyTheta[i] = Math.atan2(gz[i], gx[i]);
                if (galaxyRxy[i] > fmx) fmx = galaxyRxy[i];
                const rNorm = saturate(ringNorm);
                galaxyNormR[i] = rNorm;
                const ringGlow  = Math.exp(-Math.pow((rNorm - 0.68) / 0.16, 2.0));
                const ringEdge  = Math.pow(saturate((rNorm - 0.80) / 0.20), 1.2);
                galaxyDustWeight[i]   = ringGlow * 0.15;
                galaxyWarmCore[i]     = Math.exp(-Math.pow(rNorm / 0.22, 2.0)) * 0.25;
                galaxyArmGlow[i]      = ringGlow * 1.1;
                galaxyMidBlue[i]      = ringGlow * 0.90; // polar rings are actively star-forming → blue
                galaxyOuterCool[i]    = ringEdge;
                galaxyNebulaWeight[i] = ringGlow * 0.55;
                let sr = Math.exp((Math.random() * 2.0 - 1.0) * 0.78);
                galaxySizeScale[i]  = Math.max(0.35, Math.min(4.8, sr * (0.75 + ringGlow * 0.60)));
                galaxyAlphaScale[i] = saturate(0.08 + 0.65 * ringGlow + 0.10 * (1.0 - rNorm));
            } else {
                // Host: lenticular — very flat disc in XZ plane
                const rNorm = saturate(galaxyRxy[i] / (state.maxGalaxyRxy + 1e-5));
                galaxyNormR[i] = rNorm;
                gy[i] = gy[i] * (0.010 + 0.016 * rNorm);
                if (galaxyRxy[i] > fmx) fmx = galaxyRxy[i];
                const bulge = Math.exp(-Math.pow(rNorm / 0.20, 2.0));
                galaxyDustWeight[i]   = 0;
                galaxyWarmCore[i]     = bulge;
                galaxyArmGlow[i]      = 0;
                galaxyMidBlue[i]      = Math.exp(-Math.pow((rNorm - 0.56) / 0.18, 2.0)) * 0.5;
                galaxyOuterCool[i]    = Math.pow(saturate((rNorm - 0.70) / 0.30), 1.20);
                galaxyNebulaWeight[i] = 0;
                let sr = Math.exp((Math.random() * 2.0 - 1.0) * 0.78);
                galaxySizeScale[i]  = Math.max(0.35, Math.min(4.8, sr * (0.75 + bulge * 0.95)));
                galaxyAlphaScale[i] = saturate(0.18 + 0.55 * bulge + 0.18 * (1.0 - rNorm));
                gx[i] = galaxyRxy[i] * Math.cos(galaxyTheta[i]);
                gz[i] = galaxyRxy[i] * Math.sin(galaxyTheta[i]);
            }
            galaxyPositionsBuf[i*3]   = gx[i];
            galaxyPositionsBuf[i*3+1] = gy[i];
            galaxyPositionsBuf[i*3+2] = gz[i];
        }
        state.maxGalaxyRxy = fmx; finalize(); return;
    }

    // ── Standard spiral types ──
    const typeParams = {
        barred:     { armStrength: 0.30, armPow: 2.2, bulgeFrac: 0.18, dustStr: 0.45, vertMul: 1.0,  hasBar: true,  clumpMix: 0.30 },
        grand:      { armStrength: 0.48, armPow: 5.0, bulgeFrac: 0.24, dustStr: 0.68, vertMul: 0.8,  hasBar: false, clumpMix: 0.02 },
        flocculent: { armStrength: 0.06, armPow: 0.5, bulgeFrac: 0.12, dustStr: 0.22, vertMul: 1.2,  hasBar: false, clumpMix: 0.90 },
        multiarm:   { armStrength: 0.18, armPow: 1.6, bulgeFrac: 0.15, dustStr: 0.35, vertMul: 1.05, hasBar: false, clumpMix: 0.55 },
        open:       { armStrength: 0.24, armPow: 1.35, bulgeFrac: 0.15, dustStr: 0.30, vertMul: 1.10, hasBar: false, clumpMix: 0.24 },
        pinwheel:   { armStrength: 0.34, armPow: 3.0,  bulgeFrac: 0.17, dustStr: 0.54, vertMul: 0.92, hasBar: false, clumpMix: 0.10 },
        tight:      { armStrength: 0.42, armPow: 4.2,  bulgeFrac: 0.21, dustStr: 0.62, vertMul: 0.76, hasBar: false, clumpMix: 0.08 },
        anemic:     { armStrength: 0.10, armPow: 1.1,  bulgeFrac: 0.16, dustStr: 0.16, vertMul: 0.98, hasBar: false, clumpMix: 0.18 },
    };
    const tp = typeParams[type] || typeParams.barred;
    const nArms = Math.max(1, armCount);
    let fmx = 0;
    for (let i = 0; i < N_GALAXY; i++) {
        const baseTheta = galaxyTheta[i], baseR = galaxyRxy[i];
        let rNorm = saturate(baseR / (state.maxGalaxyRxy + 1e-5));
        const bulge = Math.exp(-Math.pow(rNorm / tp.bulgeFrac, 2.0));
        const discBlend = saturate(rNorm / 0.12) * (1.0 - bulge * 0.85);
        const lanePhase = baseTheta - armTwist * Math.log(rNorm * 6.0 + 1.0);
        const armGrad = Math.sin(nArms * lanePhase);
        const thetaNudge = -armGrad * tp.armStrength * discBlend;
        const cosArmRaw = (1.0 + Math.cos(nArms * lanePhase)) * 0.5;
        const armProfile = Math.pow(cosArmRaw, tp.armPow);
        const clumpA = 0.5 + 0.5 * Math.sin(baseTheta * (nArms * 2.1) + rNorm * 9.0 + (i % 97) * 0.13);
        const clumpB = 0.5 + 0.5 * Math.sin(baseTheta * (nArms + 1.1) - rNorm * 6.5 + (i % 71) * 0.18);
        const clump = 0.55 * clumpA + 0.45 * clumpB;
        const combinedNudge = thetaNudge * (1.0 - tp.clumpMix) + (clump - 0.5) * 0.18 * tp.clumpMix * discBlend;
        let barNudge = 0;
        if (tp.hasBar && rNorm < 0.30) {
            const barBlend = saturate(1.0 - rNorm / 0.30) * discBlend;
            let barDelta = ((baseTheta % Math.PI) + Math.PI) % Math.PI;
            if (barDelta > Math.PI * 0.5) barDelta -= Math.PI;
            barNudge = -barDelta * 0.70 * barBlend;
        }
        galaxyTheta[i] = baseTheta + combinedNudge + barNudge;
        galaxyRxy[i] = baseR * (1.0 - armProfile * 0.06 * discBlend);
        if (galaxyRxy[i] > fmx) fmx = galaxyRxy[i];
        rNorm = saturate(galaxyRxy[i] / (state.maxGalaxyRxy + 1e-5)); galaxyNormR[i] = rNorm;
        const outerMask = saturate((rNorm - 0.55) / 0.45);
        const flareBoost = 1.0 + GALAXY_OUTER_FLARE * Math.pow(outerMask, 1.6);
        const verticalScale = (0.018 + 0.110 * Math.pow(rNorm, 1.32)) * flareBoost * tp.vertMul;
        gy[i] = gy[i] * verticalScale + state.maxGalaxyRxy * 0.016 * Math.pow(outerMask, 1.75) * Math.sin(baseTheta * 1.55 + rNorm * 7.5);
        const interArmDust = (1.0 - armProfile) * Math.exp(-Math.pow((rNorm - 0.28) / 0.20, 2.0));
        const dustNoise = 0.65 + 0.35 * Math.sin(baseTheta * (nArms * 3.1) + rNorm * 12.0);
        const dust = saturate(interArmDust * dustNoise * tp.dustStr * (1.0 - bulge * 0.7));
        galaxyDustWeight[i] = dust; galaxyWarmCore[i] = bulge;
        galaxyArmGlow[i] = armProfile * (1.0 - tp.clumpMix) + clump * tp.clumpMix;
        galaxyMidBlue[i] = Math.exp(-Math.pow((rNorm - 0.56) / 0.18, 2.0));
        galaxyOuterCool[i] = Math.pow(saturate((rNorm - 0.70) / 0.30), 1.20);
        galaxyNebulaWeight[i] = galaxyArmGlow[i] * Math.exp(-Math.pow((rNorm - 0.38) / 0.24, 2.0));
        let sizeRand = Math.exp((Math.random() * 2.0 - 1.0) * 0.78);
        if (Math.random() < 0.014) sizeRand *= 2.0 + Math.random() * 2.8;
        galaxySizeScale[i] = Math.max(0.35, Math.min(4.8, sizeRand * (0.75 + galaxyArmGlow[i] * 0.52 + bulge * 0.95)));
        galaxyAlphaScale[i] = saturate((0.14 + 0.35 * galaxyArmGlow[i] + 0.44 * bulge + 0.16 * (1.0 - rNorm)) * (1.0 - dust * 0.80));
        gx[i] = galaxyRxy[i] * Math.cos(galaxyTheta[i]); gz[i] = galaxyRxy[i] * Math.sin(galaxyTheta[i]);
        galaxyPositionsBuf[i*3] = gx[i]; galaxyPositionsBuf[i*3+1] = gy[i]; galaxyPositionsBuf[i*3+2] = gz[i];
    }
    state.maxGalaxyRxy = fmx; finalize();
}

// ── Rotation update (called each frame) ──
export function rotateGalaxyParticles(rotSpeed) {
    for (let i = 0; i < state.activeGalaxyCount; i++) {
        const galaxyNorm = Math.min(1, galaxyRxy[i] / (state.maxGalaxyRxy + 1e-5));
        const differentialFactor = 1 - Math.pow(galaxyNorm, 1.18);
        let rotAmt;
        const t = state.galaxyTypeKey;
        if (t === 'elliptical')  rotAmt = rotSpeed * 0.04;
        else if (t === 'lenticular') rotAmt = rotSpeed * 0.25;
        else if (t === 'ring')   rotAmt = rotSpeed * 0.30;
        else if (t === 'polarring') rotAmt = rotSpeed * 0.20;
        else if (t === 'irregular') rotAmt = rotSpeed * 0.18 + (Math.sin(galaxyTheta[i] * 3.7) * 0.0002);
        else rotAmt = rotSpeed * differentialFactor;
        galaxyTheta[i] += rotAmt;
        galaxyPositionsBuf[i*3]   = galaxyRxy[i] * Math.cos(galaxyTheta[i]);
        galaxyPositionsBuf[i*3+2] = galaxyRxy[i] * Math.sin(galaxyTheta[i]);
    }
    galaxyGeo.attributes.position.needsUpdate = true;
}

// ── Initial build ──
{
    // Build the same galaxy type that the app exposes as its default so startup
    // does not briefly show one morphology and then morph to another a moment later.
    _buildGalaxyNow(state.galaxyArmCount, state.galaxyArmTwist, state.galaxyTypeKey);
    _builtOnce = true;

    // Fade the galaxy in on first load using the same mechanism as type-switching
    galaxyMat.uniforms.uMorphFade.value = 0.0;
    _morphState = 'fadein';
    _morphT     = 0;

    // Central sphere
    const sphereGeo = new THREE.SphereGeometry(0.09, 24, 24);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    const centralSphere = new THREE.Mesh(sphereGeo, sphereMat);
    scene.add(centralSphere);
    centralSphere.layers.enable(BLOOM_LAYER);
    // Export for animate loop
    galaxyGroup._sphereMat = sphereMat;
    galaxyGroup._sphere    = centralSphere;
}

export const centralSphere = galaxyGroup._sphere;
export const sphereMat     = galaxyGroup._sphereMat;
