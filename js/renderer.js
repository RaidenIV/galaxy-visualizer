import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }     from 'three/addons/postprocessing/ShaderPass.js';
import { OrbitControls }  from 'three/addons/controls/OrbitControls.js';

import { INITIAL_CAMERA_DISTANCE, INITIAL_CAMERA_ELEVATION, INITIAL_CAMERA_AZIMUTH, BLOOM_LAYER, CAMERA_PRESETS, CAM_LERP_DUR } from './constants.js';
import { state } from './state.js';

// ── Canvas & scene ──
export const canvas   = document.getElementById('canvas');
export const scene    = new THREE.Scene();
export const camera   = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 2000);
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

// ── Pixel ratio helper ──
export function setRendererPixelRatioFromPreset() {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, state.renderPixelRatioCap));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    bloomComposer.setSize(window.innerWidth, window.innerHeight);
    finalComposer.setSize(window.innerWidth, window.innerHeight);
    bloomPass.resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
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
        state.baseGalaxyCount   = 75000;
        state.activeStarCount   = 20000;
        state.activeScatterCount = 10000;
        state.activeHaloCount   = 12000;
        state.activeNebulaCount = 4500;
        state.renderPixelRatioCap = 2.0;
        bloomPass.radius    = 0.58;
        bloomPass.threshold = 0.22;
    } else if (preset === 'performance') {
        state.baseGalaxyCount   = Math.floor(75000 * 0.52);
        state.activeStarCount   = Math.floor(20000 * 0.50);
        state.activeScatterCount = Math.floor(10000 * 0.60);
        state.activeHaloCount   = Math.floor(12000 * 0.55);
        state.activeNebulaCount = Math.floor(4500  * 0.55);
        state.renderPixelRatioCap = 1.0;
        bloomPass.radius    = 0.42;
        bloomPass.threshold = 0.32;
    } else {
        state.baseGalaxyCount   = Math.floor(75000 * 0.82);
        state.activeStarCount   = Math.floor(20000 * 0.78);
        state.activeScatterCount = Math.floor(10000 * 0.82);
        state.activeHaloCount   = Math.floor(12000 * 0.82);
        state.activeNebulaCount = Math.floor(4500  * 0.80);
        state.renderPixelRatioCap = 1.5;
        bloomPass.radius    = 0.55;
        bloomPass.threshold = 0.25;
    }
    setRendererPixelRatioFromPreset();
    if (galaxy) galaxy.applyPerformanceCounts();
}

// ── Window resize ──
window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    bloomComposer.setSize(w, h);
    finalComposer.setSize(w, h);
    bloomPass.resolution = new THREE.Vector2(w, h);
    setRendererPixelRatioFromPreset();
});
