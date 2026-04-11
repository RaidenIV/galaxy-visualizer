import * as THREE from 'three';
import { N_HALO, N_NEBULA, BLOOM_LAYER, GALAXY_HALO_EXTENT } from './constants.js';
import { gaussianRandom } from './utils.js';
import { state } from './state.js';
import { scene } from './renderer.js';
import { circleTexture, galaxyGroup } from './galaxy.js';

// Shared point-cloud shader used by halo and nebula layers
const haloVertShader = `
    attribute vec3  aColor;
    attribute float aAlpha;
    attribute float aSize;
    uniform   float uBrightness;
    varying   vec3  vColor;
    varying   float vAlpha;
    void main() {
        vColor = aColor * uBrightness;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        float viewDist = -mvPos.z;
        float depthBoost = clamp(1.22 - viewDist * 0.045, 0.68, 1.22);
        vAlpha = aAlpha * depthBoost;
        gl_PointSize = aSize * (350.0 / max(0.001, viewDist));
        gl_Position  = projectionMatrix * mvPos;
    }
`;
const haloFragShader = `
    uniform sampler2D pointTexture;
    varying vec3  vColor;
    varying float vAlpha;
    void main() {
        vec4 tex = texture2D(pointTexture, gl_PointCoord);
        gl_FragColor = vec4(vColor, vAlpha * tex.a);
        if (gl_FragColor.a < 0.005) discard;
    }
`;

// ── Halo ──
export const haloPositionsBuf = new Float32Array(N_HALO * 3);
const haloColorsBuf           = new Float32Array(N_HALO * 3);
const haloAlphasBuf           = new Float32Array(N_HALO);
const haloSizesBuf            = new Float32Array(N_HALO);
export const haloTheta        = new Float32Array(N_HALO);
export const haloRxy          = new Float32Array(N_HALO);
export const haloY            = new Float32Array(N_HALO);

for (let i = 0; i < N_HALO; i++) {
    const u = Math.random(), v = Math.random();
    const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
    const radius = state.maxGalaxyRxy * (1.10 + Math.pow(Math.random(), 0.58) * (GALAXY_HALO_EXTENT - 1.10));
    const stretch = 0.88 + 0.22 * Math.random();
    const x = Math.sin(phi) * Math.cos(theta) * radius * stretch;
    const y = Math.cos(phi) * radius * (0.80 + 0.35 * Math.random());
    const z = Math.sin(phi) * Math.sin(theta) * radius * stretch;
    haloPositionsBuf[i*3] = x; haloPositionsBuf[i*3+1] = y; haloPositionsBuf[i*3+2] = z;
    haloTheta[i] = Math.atan2(z, x); haloRxy[i] = Math.sqrt(x*x + z*z); haloY[i] = y;
    const coolMix = Math.random();
    haloColorsBuf[i*3]   = 0.55 + 0.18 * (1.0 - coolMix);
    haloColorsBuf[i*3+1] = 0.63 + 0.18 * (1.0 - coolMix);
    haloColorsBuf[i*3+2] = 0.82 + 0.16 * coolMix;
    haloAlphasBuf[i] = 0.018 + Math.random() * 0.040;
    haloSizesBuf[i]  = 0.010 + Math.random() * 0.028;
}

export const haloGeo = new THREE.BufferGeometry();
haloGeo.setAttribute('position', new THREE.BufferAttribute(haloPositionsBuf, 3));
haloGeo.setAttribute('aColor',   new THREE.BufferAttribute(haloColorsBuf, 3));
haloGeo.setAttribute('aAlpha',   new THREE.BufferAttribute(haloAlphasBuf, 1));
haloGeo.setAttribute('aSize',    new THREE.BufferAttribute(haloSizesBuf, 1));

const haloVertShader = `
    attribute vec3  aColor;
    attribute float aAlpha;
    attribute float aSize;
    uniform   float uBrightness;
    varying   vec3  vColor;
    varying   float vAlpha;
    void main() {
        vColor = aColor * uBrightness;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        float viewDist = -mvPos.z;
        float depthBoost = clamp(1.22 - viewDist * 0.045, 0.68, 1.22);
        vAlpha = aAlpha * depthBoost;
        gl_PointSize = aSize * (350.0 / max(0.001, viewDist));
        gl_Position  = projectionMatrix * mvPos;
    }
`;
const haloFragShader = `
    uniform sampler2D pointTexture;
    varying vec3  vColor;
    varying float vAlpha;
    void main() {
        vec4 tex = texture2D(pointTexture, gl_PointCoord);
        gl_FragColor = vec4(vColor, vAlpha * tex.a);
        if (gl_FragColor.a < 0.005) discard;
    }
`;

export const haloMat = new THREE.ShaderMaterial({
    uniforms: { pointTexture: { value: circleTexture }, uBrightness: { value: 0.55 } },
    vertexShader: haloVertShader, fragmentShader: haloFragShader,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
});
const haloMesh = new THREE.Points(haloGeo, haloMat);
galaxyGroup.add(haloMesh);
haloMesh.layers.enable(BLOOM_LAYER);
haloGeo.setDrawRange(0, state.activeHaloCount);

// ── Nebula ──
export const nebulaPositionsBuf = new Float32Array(N_NEBULA * 3);
const nebulaColorsBuf           = new Float32Array(N_NEBULA * 3);
const nebulaAlphasBuf           = new Float32Array(N_NEBULA);
const nebulaSizesBuf            = new Float32Array(N_NEBULA);
export const nebulaTheta        = new Float32Array(N_NEBULA);
export const nebulaRxy          = new Float32Array(N_NEBULA);
export const nebulaY            = new Float32Array(N_NEBULA);

for (let i = 0; i < N_NEBULA; i++) {
    const useCore = Math.random() < 0.36;
    let rNorm, theta, radius;
    if (useCore) {
        rNorm = Math.pow(Math.random(), 1.65) * 0.26; theta = Math.random() * Math.PI * 2;
        radius = state.maxGalaxyRxy * rNorm;
    } else {
        rNorm = 0.18 + Math.pow(Math.random(), 0.82) * 0.46; theta = Math.random() * Math.PI * 2;
        const lopsided = 1.0 + 0.10 * Math.sin(theta * 2.0 + rNorm * 6.2) + 0.06 * Math.sin(theta * 3.6 - rNorm * 4.8);
        radius = state.maxGalaxyRxy * rNorm * lopsided;
    }
    nebulaPositionsBuf[i*3]   = Math.cos(theta) * radius + gaussianRandom() * state.maxGalaxyRxy * 0.020;
    nebulaPositionsBuf[i*3+1] = gaussianRandom() * (0.030 + 0.060 * rNorm);
    nebulaPositionsBuf[i*3+2] = Math.sin(theta) * radius + gaussianRandom() * state.maxGalaxyRxy * 0.020;
    nebulaTheta[i] = Math.atan2(nebulaPositionsBuf[i*3+2], nebulaPositionsBuf[i*3]);
    nebulaRxy[i]   = Math.sqrt(nebulaPositionsBuf[i*3]**2 + nebulaPositionsBuf[i*3+2]**2);
    nebulaY[i]     = nebulaPositionsBuf[i*3+1];
    const warmMix = Math.exp(-Math.pow(rNorm / 0.22, 2.0));
    nebulaColorsBuf[i*3]   = 0.36 + 0.36 * warmMix;
    nebulaColorsBuf[i*3+1] = 0.32 + 0.24 * warmMix;
    nebulaColorsBuf[i*3+2] = 0.58 + 0.24 * (1.0 - warmMix);
    nebulaAlphasBuf[i] = 0.010 + 0.028 * (useCore ? 1.0 : 0.65) * (0.65 + Math.random() * 0.55);
    nebulaSizesBuf[i]  = 0.060 + Math.random() * 0.220 * (useCore ? 1.10 : 0.92);
}

export const nebulaGeo = new THREE.BufferGeometry();
nebulaGeo.setAttribute('position', new THREE.BufferAttribute(nebulaPositionsBuf, 3));
nebulaGeo.setAttribute('aColor',   new THREE.BufferAttribute(nebulaColorsBuf, 3));
nebulaGeo.setAttribute('aAlpha',   new THREE.BufferAttribute(nebulaAlphasBuf, 1));
nebulaGeo.setAttribute('aSize',    new THREE.BufferAttribute(nebulaSizesBuf, 1));

export const nebulaMat = new THREE.ShaderMaterial({
    uniforms: { pointTexture: { value: circleTexture }, uBrightness: { value: 0.62 } },
    vertexShader: haloVertShader, fragmentShader: haloFragShader,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
});
const nebulaMesh = new THREE.Points(nebulaGeo, nebulaMat);
galaxyGroup.add(nebulaMesh);
nebulaMesh.layers.enable(BLOOM_LAYER);
nebulaGeo.setDrawRange(0, state.activeNebulaCount);

// ── Rotation updates ──
export function rotateHaloParticles(rotSpeed) {
    const haloMaxR = state.maxGalaxyRxy * GALAXY_HALO_EXTENT;
    for (let i = 0; i < state.activeHaloCount; i++) {
        const haloNorm = Math.min(1, haloRxy[i] / (haloMaxR + 1e-5));
        haloTheta[i] += rotSpeed * 0.34 * (1 - haloNorm);
        haloPositionsBuf[i*3]   = haloRxy[i] * Math.cos(haloTheta[i]);
        haloPositionsBuf[i*3+1] = haloY[i];
        haloPositionsBuf[i*3+2] = haloRxy[i] * Math.sin(haloTheta[i]);
    }
    haloGeo.attributes.position.needsUpdate = true;
}

export function rotateNebulaParticles(rotSpeed) {
    const nebulaMaxR = state.maxGalaxyRxy * 0.78;
    for (let i = 0; i < state.activeNebulaCount; i++) {
        const nebulaNorm = Math.min(1, nebulaRxy[i] / (nebulaMaxR + 1e-5));
        nebulaTheta[i] += rotSpeed * 0.62 * (1 - nebulaNorm);
        nebulaPositionsBuf[i*3]   = nebulaRxy[i] * Math.cos(nebulaTheta[i]);
        nebulaPositionsBuf[i*3+1] = nebulaY[i];
        nebulaPositionsBuf[i*3+2] = nebulaRxy[i] * Math.sin(nebulaTheta[i]);
    }
    nebulaGeo.attributes.position.needsUpdate = true;
}
