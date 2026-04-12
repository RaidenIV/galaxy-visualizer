import * as THREE from 'three';
import { N_SCATTER, BLOOM_LAYER, BONE_R } from './constants.js';
import { gaussianRandom, sampleColormap } from './utils.js';
import { state } from './state.js';
import { scene, BEAM_TILT_AXIS } from './renderer.js';
import { circleTexture } from './galaxy.js';

const scatterPosBuf   = new Float32Array(N_SCATTER * 3);
const scatterColBuf   = new Float32Array(N_SCATTER * 3);
const scatterAlphaBuf = new Float32Array(N_SCATTER);

export const scatterGeo = new THREE.BufferGeometry();
scatterGeo.setAttribute('position', new THREE.BufferAttribute(scatterPosBuf, 3));
scatterGeo.setAttribute('aColor',   new THREE.BufferAttribute(scatterColBuf, 3));
scatterGeo.setAttribute('aAlpha',   new THREE.BufferAttribute(scatterAlphaBuf, 1));

export const scatterMat = new THREE.ShaderMaterial({
    uniforms: { pointTexture: { value: circleTexture }, uPointScale: { value: 1.0 } },
    vertexShader: `
        attribute vec3  aColor;
        attribute float aAlpha;
        varying   vec3  vColor;
        varying   float vAlpha;
        uniform   float uPointScale;
        void main() {
            vColor = aColor; vAlpha = aAlpha;
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = 1.0 * uPointScale;
            gl_Position  = projectionMatrix * mvPos;
        }
    `,
    fragmentShader: `
        uniform sampler2D pointTexture;
        varying vec3  vColor;
        varying float vAlpha;
        void main() {
            vec4 tex = texture2D(pointTexture, gl_PointCoord);
            gl_FragColor = vec4(vColor, vAlpha * tex.a);
            if (gl_FragColor.a < 0.005) discard;
        }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
});

export const scatterMesh = new THREE.Points(scatterGeo, scatterMat);
scatterMesh.rotateOnAxis(BEAM_TILT_AXIS, -40 * Math.PI / 180);
scene.add(scatterMesh);
scatterMesh.layers.enable(BLOOM_LAYER);
scatterGeo.setDrawRange(0, state.activeScatterCount);

export function updateDynamicScatter(ai) {
    const drivenAI      = Math.max(0, Math.min(1, ai));
    const galaxyDiameter = 2 * state.maxGalaxyRxy;
    const lineLength    = galaxyDiameter * drivenAI * state.beamLengthMultiplier;
    scatterGeo.setDrawRange(0, state.activeScatterCount);

    if (lineLength < 0.01 || state.activeScatterCount <= 0) {
        scatterPosBuf.fill(0);
        scatterAlphaBuf.fill(0);
        scatterGeo.attributes.position.needsUpdate = true;
        scatterGeo.attributes.aAlpha.needsUpdate   = true;
        return;
    }

    const half = lineLength / 2;
    const thicknessScale = state.beamThicknessMultiplier;
    for (let i = 0; i < state.activeScatterCount; i++) {
        const t = i / Math.max(1, state.activeScatterCount - 1);
        const sy = half * (2 * t - 1);
        const distFrac = Math.abs(sy) / (half + 1e-5);
        const ns = distFrac * 0.06 * drivenAI * thicknessScale;
        const px = gaussianRandom() * ns;
        const py = sy + gaussianRandom() * ns;
        const pz = gaussianRandom() * ns;
        scatterPosBuf[i*3] = px; scatterPosBuf[i*3+1] = py; scatterPosBuf[i*3+2] = pz;
        const dist = Math.sqrt(px*px + py*py + pz*pz);
        const nd = Math.min(dist / (half + 1e-5), 1);
        const c = sampleColormap(BONE_R, nd);
        scatterColBuf[i*3] = c[0]; scatterColBuf[i*3+1] = c[1]; scatterColBuf[i*3+2] = c[2];
        scatterAlphaBuf[i] = Math.max(0, (1 - nd) * drivenAI);
    }
    for (let i = state.activeScatterCount; i < N_SCATTER; i++) scatterAlphaBuf[i] = 0;
    scatterGeo.attributes.position.needsUpdate = true;
    scatterGeo.attributes.aColor.needsUpdate   = true;
    scatterGeo.attributes.aAlpha.needsUpdate   = true;
}
