import { DEFAULT_CMAP_INDEX, GALAXY_TYPES, BEAT_HISTORY } from './constants.js';

// ── Single shared mutable state object ──
export const state = {
    // Camera & controls
    autoRotateEnabled:  false,
    autoRotateSpeed:    0.20,
    cameraFov:          60,
    camLerpFrom:        null,
    camLerpTo:          null,
    camLerpT:           1.0,
    cameraT:            0,
    cameraAzimuth:      0,

    // Galaxy appearance
    galaxyScaleFactor:  1.0,
    galaxyCoreSize:     1.0,
    galaxyFlatness:     1.0,
    dustLaneIntensity:  1.0,
    gasDensity:         1.0,
    galaxyInclinationDeg: 0,
    galaxyArmCount:     -1,
    galaxyArmTwist:     0.50,
    galaxyTypeKey:      'core',
    galaxyStarAmountMultiplier: 1.0,
    maxGalaxyRxy:       0,

    // Performance & rendering (always 1080p live, 4K export)
    performancePreset:  'quality',
    liveRenderPixelRatio: 1.0,
    liveBloomPixelRatio:  1.0,
    baseGalaxyCount:    75000,
    activeGalaxyCount:  75000,
    activeStarCount:    20000,
    activeScatterCount: 10000,
    activeHaloCount:    12000,
    activeNebulaCount:  4500,
    lastFrameTime:      performance.now(),
    fpsFrameCount:      0,
    fpsLastTime:        performance.now(),

    // Beam / visuals
    beamVisibilityThreshold: 0.80,
    beamThicknessMultiplier: 1.0,
    beamLengthMultiplier:    1.5,
    coreGlowIntensity:       1.0,
    coreGlowScale:           0.50,

    // Audio reactivity
    reactivityMultiplier: 1.0,
    bassBloomWeight:      1.0,
    midRotationWeight:    0.0,
    highLightningWeight:  0.0,
    currentAudioInfluence: 0.0,
    currentLowFreq:       0,
    currentMidFreq:       0,
    currentHighFreq:      0,
    beatSensitivity:      1.6,
    beatHistory:          new Array(BEAT_HISTORY).fill(0),
    beatHistoryIdx:       0,
    beatCooldown:         0,
    smoothedBloom:        1.0,
    smoothedBeamDrive:    0.0,

    // Colormap
    lockedCmapIndex:         DEFAULT_CMAP_INDEX,
    cmapA:                   DEFAULT_CMAP_INDEX,
    cmapB:                   DEFAULT_CMAP_INDEX,
    cmapMix:                 0,
    colorMapDistributionMode: 'traditional',
    reverseColorMap:          true,

    // Lightning
    lightningEnabled:      true,
    lightningFrequencyMultiplier: 1.0,
    lightningDepth:        6,
    lightningMaxOffset:    4.00,
    lightningBranchProb:   0.15,
    lightningBranchLength: 1.42,
    lightningBloomBoost:   4.0,
    lightningGlowDrive:    0.0,
    lightningStrikeLength: 1.0,

    // Audio system
    audioContext:      null,
    analyser:          null,
    audioElement:      null,
    audioSource:       null,
    gainNode:          null,
    gainNodeConnected: false,
    mediaDest:         null,
    mediaDestConnected: false,
    audioLoaded:       false,
    isPlaying:         false,
    isMuted:           false,
    audioFile:         null,  // raw File object for BPM popup

    // Loop region (set by BPM popup)
    loopEnabled:    false,
    loopStart:      0,
    loopEnd:        0,
    detectedBpm:    0,

    // Capture / recording
    mediaRecorder:  null,
    recordedChunks: [],
    isRecording:    false,

    // Cinema camera
    cinemaMode:            false,
    cinemaPathType:        'orbit',
    cinemaSpeed:           0.5,
    cinemaElevation:       0.35,
    cinemaDistance:        1.0,
    cinemaAutoAdvance:     false,
    cinemaAutoAdvanceTimer: 0,
    cinemaT:               0,

    // Animation
    time:       0,
    frameCount: 0,
};
