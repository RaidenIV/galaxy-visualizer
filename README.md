# Galaxy Visualizer

A real-time 3D audio-reactive galaxy visualizer built with Three.js. Load an audio file, sculpt the galaxy and camera in real time, dial in loop points with the BPM Detective, and export either H.264 MP4 video or high-resolution PNG output.

## Current Features

- **14 galaxy types** — Barred Spiral, Grand Design Spiral, Flocculent Spiral, Multi-Arm Spiral, Open Spiral, Pinwheel, Tight Spiral, Anemic Spiral, Ring Galaxy, Lenticular (S0), Elliptical, Polar Ring, Irregular, and Eye
- **22 color maps** — alphabetized in the UI, with auto-cycle, reverse, and distribution controls
- **Eye galaxy default** — the app now boots directly into the Eye galaxy type
- **Cinema camera system** — 5 camera presets plus 8 animated cinema paths with speed, elevation, distance, and auto-advance controls
- **Manual camera control** — orbit the scene directly when Cinema Mode is off
- **Audio-reactive rendering** — galaxy brightness, core glow, beam activity, star response, and lightning all react to the loaded track
- **Fractal lightning controls** — enable/disable lightning and adjust frequency, recursion depth, branch probability, offset, branch length, bloom, and strike length
- **Galaxy shaping controls** — reactivity, galaxy star amount, auto-rotate, scale, core size, flatness, dust lane intensity, gas / nebula density, disc inclination, field of view, beam threshold, beam thickness, beam length, and performance preset
- **BPM Detective / loop editor** — waveform-based loop selection with beat-aware bar length control, zoom, beat/BPM estimation, loop playback, and “Always start preview from loop start” behavior
- **Preset manager** — save up to 4 named presets in browser storage, load them on demand, and export/import presets as JSON
- **Preset load highlighting** — the currently loaded preset slot is highlighted blue; saved-but-not-loaded presets stay neutral
- **Single-frame PNG export** — save a still frame in 1080p or 4K, landscape or portrait
- **PNG sequence export** — export a frame sequence at 30 or 60 fps in 1080p or 4K, landscape or portrait
- **MP4 export** — export H.264 MP4 at 1080p or 4K with selectable frame rate, quality, and export range
- **Loop-range export support** — export the full track or only the active loop region
- **Camera-faithful PNG sequence export** — static camera framing is preserved in PNG sequence exports so the exported sequence matches the live view
- **Progress overlays during export** — export runs with a dedicated progress modal instead of leaving the live visualizer running visibly in the background

## Export Overview

### MP4 export

The MP4 exporter supports:

- **1080p MP4** and **4K MP4** presets
- **30 fps** or **60 fps** export
- H.264 video encoding
- optional export of the **full track** or the **selected loop only**
- estimated file size display in the export panel and progress modal
- audio included in the exported MP4 when browser support is available

### PNG export

PNG export has two modes:

- **Single Frame** — save one PNG still
- **Sequence** — save a numbered PNG frame sequence

For PNG sequences, the app can:

- write directly to a chosen folder when the browser supports the File System Access API
- fall back to an in-memory ZIP download when direct folder writing is unavailable
- export at **30 fps** or **60 fps**
- export in **1080p** or **4K**
- export in **landscape** or **portrait**

## Audio and Loop Workflow

1. Load an audio file.
2. Use **Play** to audition the track.
3. Open **Loop** to launch the BPM Detective popup.
4. Let the app estimate BPM, then adjust BPM or bar count if needed.
5. Drag the loop region over the waveform.
6. Apply the loop back to the main visualizer.
7. Export either the full track or only the selected loop.

## Presets

The preset system stores named snapshots of the visual state in browser local storage. Presets include galaxy settings, camera preset selection, cinema path settings, color-map settings, beam/lightning values, and related visual controls.

Available preset actions:

- **Save** a named preset into one of 4 slots
- **Load** a preset from a slot
- **Export JSON** to back up presets externally
- **Import JSON** to restore presets later
- visually identify the **currently loaded** slot by its blue label state

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `F` | Toggle fullscreen |
| `H` | Hide / show UI |
| `C` | Toggle Cinema Mode |

## Project Structure

```text
galaxy-visualizer/
├── index.html          # Main HTML shell and UI layout
├── css/
│   └── styles.css      # App styling
└── js/
    ├── constants.js    # Colormaps, galaxy definitions, camera presets, counts
    ├── utils.js        # Math helpers, downloads, utility functions
    ├── state.js        # Shared mutable runtime state
    ├── renderer.js     # Three.js renderer, composers, camera, controls
    ├── galaxy.js       # Galaxy particle generation and morphing
    ├── nebula.js       # Halo and nebula layers
    ├── stars.js        # Background starfield
    ├── scatter.js      # Beam / scatter system
    ├── lightning.js    # Lightning generation and display
    ├── audio.js        # Audio loading, playback, analysis, loop enforcement
    ├── loop.js         # BPM Detective popup and waveform loop editor
    ├── capture.js      # MP4 export, PNG frame export, PNG sequence export
    ├── controls.js     # UI bindings, preset management, keyboard shortcuts
    └── main.js         # Main animation loop and runtime orchestration
```

## Browser Compatibility

For the best experience, use a current Chromium-based browser.

### Works best in Chrome / Edge

- MP4 export uses the browser video encoder pipeline and is intended for **Chrome / Edge**
- PNG sequence export can save directly to a folder when the **File System Access API** is available

### General requirements

- ES Modules + Import Maps
- WebGL 2
- Web Audio API
- modern JavaScript support for `VideoEncoder`, `AudioEncoder`, `OffscreenCanvas`-style rendering paths, and large Blob downloads

## Notes

- The UI defaults to the **Eye** galaxy type on startup.
- Cinema Mode overrides manual orbit until disabled.
- Export uses a separate offscreen render pipeline so output resolution and framing can differ from the live canvas without altering the on-screen experience.
- PNG sequence exports now preserve current camera framing for static camera setups.

