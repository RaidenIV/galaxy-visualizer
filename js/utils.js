import * as THREE from 'three';

// ── Math helpers ──
export function gaussianRandom() {
    return Math.sqrt(-2 * Math.log(Math.random() + 1e-10)) * Math.cos(2 * Math.PI * Math.random());
}

export function saturate(x) {
    return Math.max(0, Math.min(1, x));
}

export function sampleColormap(stops, t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < stops.length - 1; i++) {
        const [t0, c0] = stops[i];
        const [t1, c1] = stops[i + 1];
        if (t >= t0 && t <= t1) {
            const u = (t - t0) / Math.max(1e-6, t1 - t0);
            return [
                c0[0] + (c1[0] - c0[0]) * u,
                c0[1] + (c1[1] - c0[1]) * u,
                c0[2] + (c1[2] - c0[2]) * u,
            ];
        }
    }
    return stops[stops.length - 1][1];
}

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── Lichtenberg / fractal arc helpers ──
export function randomPerpendicularVector(v) {
    const len = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
    if (len < 1e-10) return new THREE.Vector3(1, 0, 0);
    const vn = new THREE.Vector3(v.x/len, v.y/len, v.z/len);
    let helper;
    if (Math.abs(vn.x) <= Math.abs(vn.y) && Math.abs(vn.x) <= Math.abs(vn.z)) {
        helper = new THREE.Vector3(1, 0, 0);
    } else if (Math.abs(vn.y) <= Math.abs(vn.x) && Math.abs(vn.y) <= Math.abs(vn.z)) {
        helper = new THREE.Vector3(0, 1, 0);
    } else {
        helper = new THREE.Vector3(0, 0, 1);
    }
    const perp = new THREE.Vector3().crossVectors(vn, helper);
    const pLen = Math.sqrt(perp.x*perp.x + perp.y*perp.y + perp.z*perp.z);
    perp.multiplyScalar(1 / (pLen + 1e-10));
    if (Math.random() < 0.5) perp.negate();
    return perp;
}

export function generateFractalArc(start, end, depth, maxOffset) {
    if (depth <= 0) return [start.clone(), end.clone()];
    const mid = new THREE.Vector3(
        (start.x + end.x) * 0.5,
        (start.y + end.y) * 0.5,
        (start.z + end.z) * 0.5
    );
    const dir    = new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z);
    const offset = maxOffset * (Math.random() - 0.5) * 2.0;
    const perp   = randomPerpendicularVector(dir);
    mid.x += perp.x * offset;
    mid.y += perp.y * offset;
    mid.z += perp.z * offset;
    const left  = generateFractalArc(start, mid, depth - 1, maxOffset / 2);
    const right = generateFractalArc(mid, end, depth - 1, maxOffset / 2);
    return [...left.slice(0, -1), ...right];
}
