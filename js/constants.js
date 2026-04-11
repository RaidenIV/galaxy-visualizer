// ============================================================
// CONSTANTS — pure, never mutated
// ============================================================

export const BASE_GALAXY_COUNT  = 75000;
export const BASE_STAR_COUNT    = 20000;
export const BASE_SCATTER_COUNT = 10000;
export const BASE_HALO_COUNT    = 12000;
export const BASE_NEBULA_COUNT  = 4500;

export const VISUAL_MODES = {
    '1080p': {
        label: '1080p',
        width: 1920,
        height: 1080,
        densityMultiplier: 1.0,
        bloomResolutionScale: 1.0,
    },
    '4k': {
        label: '4K',
        width: 3840,
        height: 2160,
        densityMultiplier: 4.0,
        bloomResolutionScale: 0.75,
    },
};

export const N_GALAXY  = Math.floor(BASE_GALAXY_COUNT  * VISUAL_MODES['4k'].densityMultiplier);
export const N_STARS   = Math.floor(BASE_STAR_COUNT    * VISUAL_MODES['4k'].densityMultiplier);
export const N_SCATTER = Math.floor(BASE_SCATTER_COUNT * VISUAL_MODES['4k'].densityMultiplier);
export const N_HALO    = Math.floor(BASE_HALO_COUNT    * VISUAL_MODES['4k'].densityMultiplier);
export const N_NEBULA  = Math.floor(BASE_NEBULA_COUNT  * VISUAL_MODES['4k'].densityMultiplier);

export const BLOOM_LAYER = 1;
export const CORE_CENTER_BLOOM_REDUCTION = 0.5;
export const BEAT_HISTORY  = 43;
export const MAX_LIGHTNING_VERTS = 4096;
export const STAR_SPHERE_R = 80;
export const CAM_LERP_DUR  = 1.2;

export const GALAXY_ARM_COUNT    = 3;
export const GALAXY_ARM_TWIST    = 1.15;
export const GALAXY_ARM_STRENGTH = 0.18;
export const GALAXY_CLUMP_STRENGTH = 0.44;
export const GALAXY_DUST_STRENGTH  = 0.42;
export const GALAXY_OUTER_FLARE   = 1.18;
export const GALAXY_WARP_STRENGTH  = 1.0;
export const GALAXY_HALO_EXTENT   = 2.35;

export const INITIAL_CAMERA_DISTANCE  = 10.75;
export const INITIAL_CAMERA_ELEVATION = 25 * Math.PI / 180;
export const INITIAL_CAMERA_AZIMUTH   = 28 * Math.PI / 180;

export const CINEMA_PATHS = ['orbit','zoom','sweep','dive','figure8','crane','spiral','pendulum'];

// ── Colormaps ──
const GNUPLOT2_R = [
    [0.00, [0.97, 0.97, 0.80]],
    [0.08, [0.99, 0.92, 0.10]],
    [0.20, [0.97, 0.62, 0.02]],
    [0.35, [0.88, 0.14, 0.32]],
    [0.52, [0.58, 0.04, 0.65]],
    [0.70, [0.22, 0.02, 0.58]],
    [0.86, [0.06, 0.01, 0.35]],
    [1.00, [0.00, 0.00, 0.00]],
];

export const BONE_R = [
    [0.00, [1.00, 1.00, 1.00]],
    [0.25, [0.85, 0.88, 0.92]],
    [0.50, [0.60, 0.67, 0.78]],
    [0.75, [0.32, 0.42, 0.60]],
    [1.00, [0.04, 0.05, 0.10]],
];

export const GALAXY_COLORMAPS = [
    { name: 'Gnuplot2',       stops: GNUPLOT2_R },
    { name: 'Turbo',          stops: [[0.00,[0.19,0.07,0.23]],[0.25,[0.10,0.55,0.95]],[0.50,[0.30,0.95,0.55]],[0.75,[0.98,0.86,0.20]],[1.00,[0.93,0.20,0.10]]] },
    { name: 'Plasma',         stops: [[0.00,[0.05,0.03,0.53]],[0.33,[0.62,0.15,0.69]],[0.66,[0.96,0.45,0.41]],[1.00,[0.94,0.98,0.13]]] },
    { name: 'Inferno',        stops: [[0.00,[0.00,0.00,0.04]],[0.33,[0.42,0.04,0.33]],[0.66,[0.92,0.35,0.13]],[1.00,[0.99,0.99,0.75]]] },
    { name: 'Viridis',        stops: [[0.00,[0.27,0.00,0.33]],[0.33,[0.13,0.56,0.55]],[0.66,[0.37,0.79,0.38]],[1.00,[0.99,0.91,0.14]]] },
    { name: 'Magma',          stops: [[0.00,[0.00,0.00,0.04]],[0.33,[0.35,0.07,0.44]],[0.66,[0.92,0.45,0.35]],[1.00,[0.99,0.99,0.82]]] },
    { name: 'Cividis',        stops: [[0.00,[0.00,0.13,0.30]],[0.33,[0.25,0.33,0.44]],[0.66,[0.61,0.57,0.38]],[1.00,[0.99,0.91,0.35]]] },
    { name: 'Cubehelix',      stops: [[0.00,[0.02,0.02,0.05]],[0.30,[0.28,0.18,0.48]],[0.60,[0.53,0.63,0.38]],[1.00,[0.98,0.97,0.92]]] },
    { name: 'Aurora',         stops: [[0.00,[0.00,0.02,0.08]],[0.28,[0.05,0.34,0.50]],[0.55,[0.00,0.72,0.60]],[0.80,[0.55,0.96,0.74]],[1.00,[0.98,1.00,0.95]]] },
    { name: 'Icefire',        stops: [[0.00,[0.02,0.05,0.20]],[0.25,[0.12,0.45,0.90]],[0.50,[0.82,0.94,1.00]],[0.75,[0.95,0.45,0.22]],[1.00,[0.20,0.02,0.02]]] },
    { name: 'Electric Violet',stops: [[0.00,[0.02,0.00,0.10]],[0.25,[0.20,0.03,0.50]],[0.55,[0.55,0.12,0.96]],[0.82,[0.96,0.42,1.00]],[1.00,[1.00,0.90,1.00]]] },
    { name: 'Emerald Haze',   stops: [[0.00,[0.00,0.04,0.04]],[0.28,[0.02,0.22,0.14]],[0.56,[0.00,0.58,0.34]],[0.82,[0.46,0.90,0.62]],[1.00,[0.95,1.00,0.96]]] },
    { name: 'Sunset Nebula',  stops: [[0.00,[0.03,0.00,0.08]],[0.25,[0.28,0.02,0.20]],[0.50,[0.75,0.18,0.28]],[0.75,[0.98,0.55,0.18]],[1.00,[1.00,0.92,0.72]]] },
    { name: 'Hot',            stops: [[0.00,[0.04,0.00,0.00]],[0.33,[1.00,0.00,0.00]],[0.66,[1.00,1.00,0.00]],[1.00,[1.00,1.00,1.00]]] },
    { name: 'Amber Frost',    stops: [[0.00,[0.02,0.03,0.10]],[0.25,[0.10,0.24,0.46]],[0.55,[0.56,0.78,0.98]],[0.80,[0.98,0.74,0.30]],[1.00,[1.00,0.96,0.88]]] },
    { name: 'Crimson Dusk',   stops: [[0.00,[0.02,0.00,0.03]],[0.24,[0.18,0.02,0.14]],[0.52,[0.62,0.06,0.24]],[0.78,[0.98,0.38,0.20]],[1.00,[1.00,0.88,0.72]]] },
    { name: 'Deep Ocean',     stops: [[0.00,[0.00,0.01,0.08]],[0.22,[0.00,0.12,0.30]],[0.50,[0.00,0.42,0.62]],[0.78,[0.18,0.78,0.84]],[1.00,[0.88,1.00,0.98]]] },
    { name: 'Rose Gold',      stops: [[0.00,[0.04,0.02,0.03]],[0.28,[0.22,0.10,0.16]],[0.56,[0.62,0.32,0.38]],[0.82,[0.92,0.70,0.58]],[1.00,[1.00,0.95,0.90]]] },
    { name: 'Bone',           stops: [[0.00,[0.00,0.00,0.02]],[0.30,[0.22,0.24,0.28]],[0.62,[0.58,0.64,0.66]],[0.84,[0.84,0.88,0.82]],[1.00,[1.00,1.00,0.90]]] },
    { name: 'Jet',            stops: [[0.00,[0.00,0.00,0.50]],[0.35,[0.00,0.70,1.00]],[0.50,[0.50,1.00,0.50]],[0.70,[1.00,1.00,0.00]],[1.00,[0.50,0.00,0.00]]] },
    { name: 'Twilight Mint',  stops: [[0.00,[0.04,0.02,0.10]],[0.28,[0.18,0.12,0.40]],[0.56,[0.30,0.56,0.72]],[0.82,[0.56,0.92,0.78]],[1.00,[0.95,1.00,0.98]]] },
];
GALAXY_COLORMAPS.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

export const DEFAULT_CMAP_INDEX = Math.max(0, GALAXY_COLORMAPS.findIndex(cm => cm.name === 'Electric Violet'));

export const GALAXY_TYPES = {
    barred:     { armCount: 4,  armTwist: 1.15, label: 'Barred Spiral'      },
    grand:      { armCount: 2,  armTwist: 1.60, label: 'Grand Design Spiral' },
    flocculent: { armCount: 6,  armTwist: 0.55, label: 'Flocculent Spiral'  },
    multiarm:   { armCount: 5,  armTwist: 1.00, label: 'Multi-Arm Spiral'   },
    ring:       { armCount: 0,  armTwist: 0.00, label: 'Ring Galaxy'        },
    lenticular: { armCount: 0,  armTwist: 0.00, label: 'Lenticular (S0)'    },
    elliptical: { armCount: 0,  armTwist: 0.00, label: 'Elliptical'         },
    irregular:  { armCount: -1, armTwist: 0.50, label: 'Irregular'          },
    core:       { armCount: -1, armTwist: 0.50, label: 'Eye'                },
};

export const CAMERA_PRESETS = {
    threeQuarter: { label: 'Three-Quarter', distance: 10.75, elevationDeg: 25, azimuthDeg:  28 },
    wide:         { label: 'Wide',          distance: 14.5,  elevationDeg: 18, azimuthDeg:  32 },
    side:         { label: 'Side Profile',  distance: 11.5,  elevationDeg: 8,  azimuthDeg:  90 },
    polar:        { label: 'Polar',         distance: 12.5,  elevationDeg: 62, azimuthDeg:  25 },
    low:          { label: 'Low Angle',     distance: 10.0,  elevationDeg: 10, azimuthDeg: -28 },
};

export const STAR_SPECTRAL_CLASSES = [
    { weight: 0.003, r: 0.64, g: 0.75, b: 1.00, minBright: 0.70, maxBright: 1.00 },
    { weight: 0.013, r: 0.75, g: 0.85, b: 1.00, minBright: 0.55, maxBright: 0.95 },
    { weight: 0.060, r: 0.92, g: 0.95, b: 1.00, minBright: 0.35, maxBright: 0.80 },
    { weight: 0.120, r: 1.00, g: 0.98, b: 0.92, minBright: 0.18, maxBright: 0.60 },
    { weight: 0.200, r: 1.00, g: 0.93, b: 0.72, minBright: 0.08, maxBright: 0.45 },
    { weight: 0.240, r: 1.00, g: 0.78, b: 0.50, minBright: 0.04, maxBright: 0.30 },
    { weight: 0.364, r: 1.00, g: 0.55, b: 0.35, minBright: 0.01, maxBright: 0.18 },
];
