import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }     from 'three/addons/postprocessing/ShaderPass.js';
import { OrbitControls }  from 'three/addons/controls/OrbitControls.js';

import {
    INITIAL_CAMERA_DISTANCE,
    INITIAL_CAMERA_ELEVATION,
    INITIAL_CAMERA_AZIMUTH,
    BLOOM_LAYER,
    CAMERA_PRESETS,
    CAM_LERP_DUR,
    BASE_GALAXY_COUNT,
    BASE_STAR_COUNT,
    BASE_SCATTER_COUNT,
    BASE_HALO_COUNT,
    BASE_NEBULA_COUNT,
    N_GALAXY,
    N_STARS,
    N_SCATTER,
    N_HALO,
    N_NEBULA,
} from './constants.js';
import { state } from './state.js';

// ── Canvas & scene ──
export const canvas   = document.getElementById('canvas');
export const scene    = new THREE.Scene();
export const camera   = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 2000);
export const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(1);
scene.background = new THREE.Color(0x000000);

export const BEAM_TILT_AXIS = new THREE.Vector3(1, 0, 1).normalize();

// ── Camera initial position ──
camera.position.set(
    INITIAL_CAMERA_DISTANCE * Math.cos(INITIAL_CAMERA_ELEVATION) * Math.sin(INITIAL_CAMERA_AZIMUTH),
    INITIAL_CAMERA_DISTANCE * Math.sin(INITIAL_CAMERA_ELEVATION),
    INITIAL_CAMERA_DISTANCE * Math.cos(INITIAL_CAMERA_ELEVATION) * Math.cos(INITIAL_CAMERA_AZIMUTH)
);
camera.lookAt(0, 0, 0);

// ── Orbit Controls ──
export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping   = true;
controls.dampingFactor   = 0.045;
controls.enablePan       = false;
controls.minDistance     = 5;
controls.maxDistance     = 40;
controls.autoRotate      = false;
controls.autoRotateSpeed = 0.0;
controls.target.set(0, 0, 0);
controls.update();

// ── Bloom post-processing ──
export const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(new RenderPass(scene, camera));

export const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.5, 0.55, 0.25
);
bloomComposer.addPass(bloomPass);

export const finalComposer = new EffectComposer(renderer);
finalComposer.addPass(new RenderPass(scene, camera));

const finalPass = new ShaderPass(new THREE.ShaderMaterial({
    uniforms: {
        baseTexture:  { value: null },
        bloomTexture: { value: bloomComposer.renderTarget2.texture },
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
}), 'baseTexture');
finalComposer.addPass(finalPass);

function setComposerResolution(composer, cssW, cssH, pixelRatio) {
    if (typeof composer.setPixelRatio === 'function') {
        composer.setPixelRatio(pixelRatio);
        composer.setSize(cssW, cssH);
        return;
    }
    composer.setSize(Math.round(cssW * pixelRatio), Math.round(cssH * pixelRatio));
}

function applyScaledCounts(baseGalaxy, baseStars, baseScatter, baseHalo, baseNebula) {
    state.baseGalaxyCount    = Math.min(N_GALAXY,  Math.floor(baseGalaxy));
    state.activeStarCount    = Math.min(N_STARS,   Math.floor(baseStars));
    state.activeScatterCount = Math.min(N_SCATTER, Math.floor(baseScatter));
    state.activeHaloCount    = Math.min(N_HALO,    Math.floor(baseHalo));
    state.activeNebulaCount  = Math.min(N_NEBULA,  Math.floor(baseNebula));
}

// ── Pixel ratio helper — always targets 1080p for live render ──
export function setRendererPixelRatioFromPreset() {
    const cssW = Math.max(1, window.innerWidth);
    const cssH = Math.max(1, window.innerHeight);
    const targetPixels = 1920 * 1080;
    const desiredPixelRatio = Math.min(4, Math.max(0.5, Math.sqrt(targetPixels / (cssW * cssH))));
    const presetScale = state.performancePreset === 'quality'
        ? 1.0
        : state.performancePreset === 'balanced'
            ? 0.90
            : 0.78;
    const bloomPixelRatio = Math.min(desiredPixelRatio, Math.max(0.5, desiredPixelRatio * presetScale));

    state.liveRenderPixelRatio = desiredPixelRatio;
    state.liveBloomPixelRatio  = bloomPixelRatio;

    renderer.setPixelRatio(desiredPixelRatio);
    renderer.setSize(cssW, cssH, false);
    setComposerResolution(bloomComposer, cssW, cssH, bloomPixelRatio);
    setComposerResolution(finalComposer, cssW, cssH, desiredPixelRatio);
    bloomPass.resolution.set(
        Math.round(cssW * bloomPixelRatio),
        Math.round(cssH * bloomPixelRatio)
    );
    if (finalPass?.material?.uniforms?.bloomTexture) {
        finalPass.material.uniforms.bloomTexture.value = bloomComposer.renderTarget2.texture;
    }
}

// ── Camera preset transition ──
export function setCameraFromPreset(name) {
    const preset = CAMERA_PRESETS[name] || CAMERA_PRESETS.threeQuarter;
    const elev = preset.elevationDeg * Math.PI / 180;
    const azim = preset.azimuthDeg   * Math.PI / 180;
    const target = new THREE.Vector3(
        preset.distance * Math.cos(elev) * Math.sin(azim),
        preset.distance * Math.sin(elev),
        preset.distance * Math.cos(elev) * Math.cos(azim)
    );
    state.camLerpFrom = camera.position.clone();
    state.camLerpTo   = target;
    state.camLerpT    = 0.0;
    controls.target.set(0, 0, 0);
    controls.update();
}

// ── Performance presets ──
export function applyPerformancePreset(preset, galaxy) {
    state.performancePreset = preset;
    if (preset === 'quality') {
        applyScaledCounts(
            BASE_GALAXY_COUNT,
            BASE_STAR_COUNT,
            BASE_SCATTER_COUNT,
            BASE_HALO_COUNT,
            BASE_NEBULA_COUNT,
        );
        bloomPass.radius    = 0.58;
        bloomPass.threshold = 0.22;
    } else if (preset === 'performance') {
        applyScaledCounts(
            Math.floor(BASE_GALAXY_COUNT  * 0.52),
            Math.floor(BASE_STAR_COUNT    * 0.50),
            Math.floor(BASE_SCATTER_COUNT * 0.60),
            Math.floor(BASE_HALO_COUNT    * 0.55),
            Math.floor(BASE_NEBULA_COUNT  * 0.55),
        );
        bloomPass.radius    = 0.42;
        bloomPass.threshold = 0.32;
    } else {
        applyScaledCounts(
            Math.floor(BASE_GALAXY_COUNT  * 0.82),
            Math.floor(BASE_STAR_COUNT    * 0.78),
            Math.floor(BASE_SCATTER_COUNT * 0.82),
            Math.floor(BASE_HALO_COUNT    * 0.82),
            Math.floor(BASE_NEBULA_COUNT  * 0.80),
        );
        bloomPass.radius    = 0.55;
        bloomPass.threshold = 0.25;
    }
    setRendererPixelRatioFromPreset();
    if (galaxy) galaxy.applyPerformanceCounts();
}

function syncViewportSize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    setRendererPixelRatioFromPreset();
}

// ── Window resize / fullscreen sync ──
window.addEventListener('resize', syncViewportSize);
document.addEventListener('fullscreenchange', syncViewportSize);
