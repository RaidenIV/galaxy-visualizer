import * as THREE from 'three';
import { N_STARS, STAR_SPHERE_R, STAR_SPECTRAL_CLASSES, BLOOM_LAYER } from './constants.js';
import { state } from './state.js';
import { scene } from './renderer.js';
import { circleTexture } from './galaxy.js';

// ── Spectral class CDF for sampling ──
const starClassCDF = [];
let wSum = 0;
for (const sc of STAR_SPECTRAL_CLASSES) { wSum += sc.weight; starClassCDF.push(wSum); }

function sampleSpectralClass() {
    const r = Math.random() * wSum;
    for (let i = 0; i < starClassCDF.length; i++) if (r <= starClassCDF[i]) return STAR_SPECTRAL_CLASSES[i];
    return STAR_SPECTRAL_CLASSES[STAR_SPECTRAL_CLASSES.length - 1];
}

// ── Buffers ──
const starPositions = new Float32Array(N_STARS * 3);
const starColorsBuf = new Float32Array(N_STARS * 3);
const starSizesBuf  = new Float32Array(N_STARS);
const starBrightBuf = new Float32Array(N_STARS);
const starPhaseBuf  = new Float32Array(N_STARS);
const starSpikeBuf  = new Float32Array(N_STARS);

for (let i = 0; i < N_STARS; i++) {
    const cosTheta = 2 * Math.random() - 1;
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = Math.random() * Math.PI * 2;
    const r   = STAR_SPHERE_R * (0.70 + 0.30 * Math.random());
    starPositions[i*3]   = r * sinTheta * Math.cos(phi);
    starPositions[i*3+1] = r * cosTheta;
    starPositions[i*3+2] = r * sinTheta * Math.sin(phi);
    const sc = sampleSpectralClass();
    const u = Math.random();
    const brightness = Math.min(1.35, (sc.minBright + (sc.maxBright - sc.minBright) * Math.pow(u, 2.8)) * 1.65);
    const jit = 0.04;
    starColorsBuf[i*3]   = Math.min(1, sc.r + (Math.random() - 0.5) * jit);
    starColorsBuf[i*3+1] = Math.min(1, sc.g + (Math.random() - 0.5) * jit);
    starColorsBuf[i*3+2] = Math.min(1, sc.b + (Math.random() - 0.5) * jit);
    starBrightBuf[i] = brightness;
    const sizeBase = 0.0008 + brightness * 0.0072;
    starSizesBuf[i]  = sizeBase * Math.exp((Math.random() - 0.5) * 0.9);
    starPhaseBuf[i]  = Math.random() * Math.PI * 2;
    starSpikeBuf[i]  = (
        (brightness > 0.72 && sc === STAR_SPECTRAL_CLASSES[0]) ||
        (brightness > 0.80 && sc === STAR_SPECTRAL_CLASSES[1]) ||
        (brightness > 0.90 && sc === STAR_SPECTRAL_CLASSES[2])
    ) ? 1.0 : 0.0;
}

export const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
starGeo.setAttribute('aColor',   new THREE.BufferAttribute(starColorsBuf, 3));
starGeo.setAttribute('aSize',    new THREE.BufferAttribute(starSizesBuf, 1));
starGeo.setAttribute('aBright',  new THREE.BufferAttribute(starBrightBuf, 1));
starGeo.setAttribute('aPhase',   new THREE.BufferAttribute(starPhaseBuf, 1));
starGeo.setAttribute('aSpike',   new THREE.BufferAttribute(starSpikeBuf, 1));

export const starMat = new THREE.ShaderMaterial({
    uniforms: {
        pointTexture:    { value: circleTexture },
        uAudioInfluence: { value: 0.75 },
        uTime:           { value: 0.0 },
    },
    vertexShader: `
        attribute float aSize;
        attribute vec3  aColor;
        attribute float aBright;
        attribute float aPhase;
        attribute float aSpike;
        uniform   float uAudioInfluence;
        uniform   float uTime;
        varying   vec3  vColor;
        varying   float vBright;
        varying   float vSpike;
        varying   float vGlow;
        void main() {
            // Multi-frequency base twinkle — much more pronounced than before
            float baseTwinkle = 1.0
                + 0.38 * sin(uTime * 3.8  + aPhase)
                + 0.20 * sin(uTime * 11.3 + aPhase * 1.7)
                + 0.10 * sin(uTime * 24.7 + aPhase * 2.3);

            // Per-star random flicker that changes bucket every ~0.2–0.5 s
            float flickerRate   = 2.8 + 3.5 * fract(sin(aPhase * 12.9898) * 43758.5453);
            float flickerBucket = floor(uTime * flickerRate + aPhase * 23.0);
            float randomFlicker = fract(sin(flickerBucket * 78.233 + aPhase * 37.719) * 43758.5453);
            // Wide range: some stars nearly go dark, others flare bright
            float flicker = mix(0.28, 2.10, randomFlicker);
            float twinkle = baseTwinkle * mix(1.0, flicker, 0.88);

            vColor  = aColor;
            vBright = aBright * twinkle;
            vSpike  = aSpike;
            vGlow   = aBright * twinkle;

            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * uAudioInfluence * (0.80 + twinkle * 0.55) * (390.0 / -mvPos.z);
            gl_Position  = projectionMatrix * mvPos;
        }
    `,
    fragmentShader: `
        uniform sampler2D pointTexture;
        varying vec3  vColor;
        varying float vBright;
        varying float vSpike;
        varying float vGlow;
        void main() {
            vec2 uv = gl_PointCoord - 0.5;
            vec4 tex = texture2D(pointTexture, gl_PointCoord);
            float core = tex.a;
            float spike = 0.0;
            if (vSpike > 0.5) {
                float ax = abs(uv.x), ay = abs(uv.y);
                float hArm = smoothstep(0.006, 0.0, ay) * smoothstep(0.5, 0.05, ax);
                float vArm = smoothstep(0.006, 0.0, ax) * smoothstep(0.5, 0.05, ay);
                spike = (hArm + vArm) * 0.65;
            }
            float alpha = (core + spike) * vBright * 1.42;
            if (alpha < 0.004) discard;
            vec3 bloomColor = vColor * (1.05 + vGlow * 1.35 + spike * 0.55);
            gl_FragColor = vec4(bloomColor, alpha);
        }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
});

const starMesh = new THREE.Points(starGeo, starMat);
scene.add(starMesh);
starMesh.layers.enable(BLOOM_LAYER);
starGeo.setDrawRange(0, state.activeStarCount);
