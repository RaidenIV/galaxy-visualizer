# Galaxy Visualizer

A real-time 3D audio-reactive galaxy visualizer built with Three.js. Load any audio file and watch the galaxy pulse, rotate, and fire lightning in sync with the music.

## Features

- **9 galaxy types** — Barred Spiral, Grand Design, Flocculent, Multi-Arm, Ring, Lenticular, Elliptical, Irregular, Eye
- **21 color maps** — with auto-cycling and reverse modes
- **Cinema camera** — 8 cinematic paths (Orbit, Zoom Pulse, Arc Sweep, Polar Dive, Figure-8, Crane Shot, Spiral Approach, Pendulum)
- **Fractal lightning** system tied to audio bass
- **Beat detection** with visual flash
- **Preset manager** — save/load up to 4 named presets, export/import as JSON
- **Frame capture** — PNG export at current, 1080p, or 4K resolution
- **Video recording** — WebM capture of the live canvas with audio

## Project Structure

```
galaxy-visualizer/
├── index.html          # HTML shell — no inline scripts
├── css/
│   └── styles.css      # All UI styles
└── js/
    ├── constants.js    # Pure constants (colormaps, presets, particle counts)
    ├── utils.js        # Math helpers, colormap sampling, fractal arc generator
    ├── state.js        # Single shared mutable state object
    ├── renderer.js     # Three.js scene, camera, bloom composers, resize handler
    ├── galaxy.js       # Galaxy particle system — all 9 types, color logic, rotation
    ├── nebula.js       # Halo envelope + nebula haze layers
    ├── stars.js        # Background star field with spectral classes & twinkling
    ├── scatter.js      # Quasar beam / dynamic scatter effect
    ├── lightning.js    # Fractal Lichtenberg lightning system
    ├── audio.js        # Web Audio API — load, analyse, playback
    ├── capture.js      # WebM recording + PNG frame export
    ├── controls.js     # All UI event listeners, preset manager, keyboard shortcuts
    └── main.js         # Entry point — animate loop, cinema camera paths
```

## Keyboard Shortcuts

| Key     | Action              |
|---------|---------------------|
| `SPACE` | Play / Pause        |
| `F`     | Toggle fullscreen   |
| `H`     | Hide / show UI      |
| `C`     | Toggle Cinema Mode  |

## Browser Compatibility

Requires a modern browser with support for:
- ES Modules + Import Maps (Chrome 89+, Firefox 108+, Safari 16.4+)
- WebGL 2
- Web Audio API
- `MediaRecorder` API (for video recording — Chrome/Edge only)
