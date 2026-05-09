/*
  OmegaSeed Core
  Continuous nested topography / atlas-learning field engine.
  No dependencies. Safe for GitHub Pages and Node smoke tests.
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OmegaSeedCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PI = Math.PI;
  const TAU = Math.PI * 2;
  const PHI = 1.618033988749895;
  const VERSION = 'omegaseed-0.4.22-recursive-median-fac';
  const SAVE_KEY = 'omegaseed.autosave.v4_5';

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function clamp01(v) { return clamp(v, 0, 1); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(edge0, edge1, x) {
    const t = clamp01((x - edge0) / Math.max(1e-9, edge1 - edge0));
    return t * t * (3 - 2 * t);
  }
  function smootherstep(edge0, edge1, x) {
    const t = clamp01((x - edge0) / Math.max(1e-9, edge1 - edge0));
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  function fract(v) { return v - Math.floor(v); }
  // Canonical chart wrapping for the field domain [-1, 1).
  // x/y live on a torus. Depth, layer stack, and return transitions do not.
  function wrapUnit(v) {
    if (!Number.isFinite(v)) return 0;
    return ((((v + 1) % 2) + 2) % 2) - 1;
  }
  function wrapDelta(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return ((((a - b + 1) % 2) + 2) % 2) - 1;
  }
  function torusDistance(ax, ay, bx, by) {
    const dx = wrapDelta(ax, bx);
    const dy = wrapDelta(ay, by);
    return Math.hypot(dx, dy);
  }
  function wrapLerp(a, b, t) {
    return wrapUnit((Number.isFinite(a) ? a : 0) + wrapDelta(Number.isFinite(b) ? b : 0, Number.isFinite(a) ? a : 0) * clamp01(t));
  }
  function wrapMidpoint(a, b) { return wrapLerp(a, b, 0.5); }
  function torusNoise2D(noise, x, y, freq, ox, oy) {
    // Periodic-enough 2D projection: both chart axes enter through sin/cos,
    // so field samples line up when the rendered chart tiles at the edges.
    const ax = (wrapUnit(x) + 1) * PI;
    const ay = (wrapUnit(y) + 1) * PI;
    const px = Math.cos(ax) * freq + Math.sin(ay) * freq * 0.43 + ox;
    const py = Math.sin(ax) * freq + Math.cos(ay) * freq * 0.43 + oy;
    return noise.noise2D(px, py);
  }
  function hashString(str) {
    let h = 2166136261 >>> 0;
    const s = String(str || 'omegaseed');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a += 0x6D2B79F5;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeId(prefix, seed) {
    const n = hashString(prefix + ':' + seed + ':' + Date.now().toString(36));
    return prefix + '-' + n.toString(36).slice(0, 9);
  }

  function parseRatioValue(raw) {
    if (typeof raw === 'number' && Number.isFinite(raw)) return clamp(raw, 0.0001, 8);
    const text = String(raw || '').trim();
    if (!text) return 1;
    const parts = text.split('/').map(v => Number(v.trim()));
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && Math.abs(parts[1]) > 1e-9) return clamp(parts[0] / parts[1], 0.0001, 8);
    const n = Number(text);
    return Number.isFinite(n) ? clamp(n, 0.0001, 8) : 1;
  }

  function ratioLabel(raw) {
    return String(raw || '1/2').trim() || '1/2';
  }

  function parseMedianRatios(value) {
    const fallback = ['1/2', '1/3', '2/3', '1/4', '3/4', '3/5', '5/8', '8/13'];
    const list = Array.isArray(value) ? value : String(value || '').split(',');
    const clean = list.map(ratioLabel).filter(Boolean);
    return (clean.length ? clean : fallback).slice(0, 24);
  }

  class SimplexNoise2D {
    constructor(seed) {
      const rand = mulberry32(seed >>> 0);
      const p = new Uint8Array(256);
      for (let i = 0; i < 256; i++) p[i] = i;
      for (let i = 255; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
      }
      this.perm = new Uint8Array(512);
      for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
      this.grad3 = [
        [1, 1], [-1, 1], [1, -1], [-1, -1],
        [1, 0], [-1, 0], [1, 0], [-1, 0],
        [0, 1], [0, -1], [0, 1], [0, -1]
      ];
    }
    dot(g, x, y) { return g[0] * x + g[1] * y; }
    noise2D(xin, yin) {
      const F2 = 0.5 * (Math.sqrt(3) - 1);
      const G2 = (3 - Math.sqrt(3)) / 6;
      const s = (xin + yin) * F2;
      const i = Math.floor(xin + s);
      const j = Math.floor(yin + s);
      const t = (i + j) * G2;
      const X0 = i - t;
      const Y0 = j - t;
      const x0 = xin - X0;
      const y0 = yin - Y0;
      let i1, j1;
      if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
      const x1 = x0 - i1 + G2;
      const y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2;
      const y2 = y0 - 1 + 2 * G2;
      const ii = i & 255;
      const jj = j & 255;
      const gi0 = this.perm[ii + this.perm[jj]] % 12;
      const gi1 = this.perm[ii + i1 + this.perm[jj + j1]] % 12;
      const gi2 = this.perm[ii + 1 + this.perm[jj + 1]] % 12;
      let n0 = 0, n1 = 0, n2 = 0;
      let tt = 0.5 - x0 * x0 - y0 * y0;
      if (tt >= 0) { tt *= tt; n0 = tt * tt * this.dot(this.grad3[gi0], x0, y0); }
      tt = 0.5 - x1 * x1 - y1 * y1;
      if (tt >= 0) { tt *= tt; n1 = tt * tt * this.dot(this.grad3[gi1], x1, y1); }
      tt = 0.5 - x2 * x2 - y2 * y2;
      if (tt >= 0) { tt *= tt; n2 = tt * tt * this.dot(this.grad3[gi2], x2, y2); }
      return clamp(70 * (n0 + n1 + n2), -1, 1);
    }
  }

  function makeDefaultState(seed) {
    const s = seed || ('omega-' + Date.now().toString(36));
    return {
      version: VERSION,
      id: makeId('omegaseed', s),
      seed: s,
      time: 0,
      epoch: 0,
      cycle: 0,
      params: {
        scale: 1.72,
        flow: 0.76,
        foldDepth: 5,
        warpStrength: 0.58,
        threshold: 0.54,
        edgeSoftness: 0.18,
        filamentMix: 0.62,
        gravity: 0.85,
        swirl: 0.48,
        viscosity: 0.89,
        atlasInfluence: 0.34,
        atlasRadius: 0.20,
        particleCount: 3600,
        fieldWidth: 188,
        fieldHeight: 112,
        exposure: 1.0,
        learningRate: 0.22,
        annealingEnabled: true,
        annealingMinLearningRate: 0.0001,
        annealingMaxLearningRate: 0.50,
        annealingCoolingRate: 0.95,
        annealingStabilityCriticality: 0.65,
        annealingBoredomLimit: 1000,
        annealingReheatTemperature: 1.0,
        annealingBaselockTemperature: 0.06,
        annealingCorridorCriticality: 0.48,
        annealingCorridorMin: 6,
        annealingFastQuench: 0.42,
        maxAnchors: 128,
        maxAtlasInfluence: 48,
        minAnchorScore: 0.66,
        schedulerMode: 'continuous',
        learnDuty: 0.20,
        schedulerAutotune: true,
        memoryMaxPages: 256,
        pageSize: 96,
        driverEnabled: true,
        driverAutotune: true,
        splitDepthMax: 8,
        minPortalScore: 1.72,
        maxPortals: 96,
        nestedEnabled: true,
        nestedAutoproject: true,
        maxSeedlets: 192,
        activeSeedlets: 32,
        seedletPacketLimit: 64,
        gaugeReserveSeedlets: 0.40,
        atlasBasinReserve: 0.40,
        atlasKeyholeReserve: 0.30,
        atlasFilamentReserve: 0.20,
        atlasOtherReserve: 0.10,
        stagnantAfterHits: 48,
        reproductiveScore: 1.62,
        maxSeedDepth: 14,
        seedProjectionThreshold: 0.82,
        seedTrainingBudget: 3,
        nestedTimeDilation: true,
        boundaryBleed: true,
        phaseMatchWeight: 0.38,
        maxTimeDilation: 64,
        seedletMetabolismEnabled: true,
        seedletMetabolicFloor: 0.085,
        seedletCollapseEnergy: 0.012,
        seedletReviveEnergy: 0.12,
        seedletRescueCriticality: 0.72,
        seedletRescueResonance: 0.28,
        seedletNurseryMinActive: 0.16,
        seedletCollapseReheatFraction: 0.22,
        seedletNurseryBudgetBoost: 8,
        seedletDormancyEnergyDrain: 0.9997,
        seedletEnergyDecay: 0.994,
        seedletEnergyMax: 2.25,
        renderQuality: 1.0,
        timeScale: 1.0,
        chartWrapEnabled: true,
        toroidalField: true,
        horizonExitThreshold: 0.58,
        superbasinFollowStrength: 0.39,
        autoEvolve: true,
        showStructureOverlay: true,
        bugeyeEnabled: true,
        bugeyeViews: 7,
        bugeyeQuality: 0.65,
        bugeyeDurationMs: 5200,
        bugeyeCooldownCycles: 720,
        bugeyeAtlasWeight: 0.12,
        bugeyeDwellMultiplier: 1.0,
        bugeyeSatisfactionThreshold: 0.42,
        miningLayerLimit: 3,
        dimensionalDigBias: 0.42,
        filamentClimbThreshold: 0.58,
        portalDiversity: 0.55,
        portalUniqueSourceQuota: 24,
        autoMiningEnabled: true,
        autoMiningCooldownCycles: 1440,
        autoMiningStayCycles: 620,
        autoMiningBugeyeDelayCycles: 110,
        autoMiningFilamentChance: 0.58,
        autoMiningPostBugeyeClimbWindowCycles: 760,
        autoMiningPostBugeyeClimbRelax: 0.24,
        livingWordEnabled: true,
        livingWordAtlasWeight: 0.10,
        livingWordLearningLift: 0.0012,
        horizonEnabled: true,
        horizonThreshold: 0.74,
        horizonShellAtlasWeight: 0.10,
        horizonReleaseThreshold: 0.82,
        horizonMaxShells: 24,
        horizonSeedletCoupling: 0.24,
        horizonNurseryGateEnabled: true,
        horizonNurseryGateThreshold: 0.715,
        horizonNurseryGateLimit: 2,
        horizonNurseryGateMinScore: 1.20,
        protoAttractionEnabled: true,
        protoAttractionCenter: 0.50,
        protoAttractionLearningRate: 0.012,
        horizonRimEnabled: true,
        horizonRimApproachThreshold: 0.56,
        horizonRimScarWeight: 0.18,
        horizonCandidateThreshold: 0.62,
        superbasinSplitThreshold: 0.86,
        superbasinDiversityFloor: 0.18,
        dominantBasinMaxHitShare: 0.72,
        horizonBoundStatusAccounting: true,
        horizonCandidateTelemetryFix: true,
        horizonBoundMaxFraction: 0.28,
        horizonBoundSoftCap: 48,
        horizonBoundHardCap: 64,
        horizonCaptureCooldownCycles: 360,
        horizonParoleEnabled: true,
        horizonParoleCompactness: 0.69,
        horizonParoleResonanceMin: 0.62,
        horizonParoleProductivityMin: 0.04,
        horizonFreezeExitCompactness: 0.69,
        horizonReleaseDrainLimit: 10,
        annealingReheatOnOvercapture: true,
        horizonOvercaptureReheatFraction: 0.45,
        horizonOvercaptureReheatTemperature: 0.66,
        pauseFreezesBudgets: true,
        pauseFreezesAutotune: true,
        pauseFreezesBugeyeRoutines: true,
        pauseFreezesMiningRoutines: true,
        freezeAnnealingChildBudgetOnPause: true,
        effectiveBudgetHardCap: 3,
        effectiveNurseryBudgetHardCap: 8,
        facMedianEnabled: true,
        facOriginMedianEnabled: true,
        facMedianTreeDepth: 7,
        facMedianRatios: '1/2,1/3,2/3,1/4,3/4,3/5,5/8,8/13',
        facMedianMode: 'suggestion',
        facMedianScoreThreshold: 0.04,
        facMedianActionLimit: 1,
        facMedianUpdateIntervalCycles: 90,
        facMedianMinConfidence: 0.34
      },
      stats: {
        coherence: 0,
        filament: 0,
        cavity: 0,
        atlasFitness: 0,
        anchors: 0,
        packets: 0,
        lastLearned: null
      },
      atlas: {
        anchors: [],
        packets: [],
        seedlets: [],
        ancestry: [],
        notes: [
          'OmegaSeed begins as a continuous effective field: nested simplex topographies, smoothstep thresholds, and atlas-biased folding.'
        ]
      },
      horizon: {
        shells: [],
        releases: 0,
        lastReleaseCycle: -Infinity,
        lastCompactness: 0,
        lastResistance: 1,
        lastCoupling: 1,
        horizonBoundSeedlets: 0,
        lastProtoAttraction: 0.50,
        lastCapture: 0,
        lastEscape: 0,
        mode: 'open-field'
      },
      superbasin: {
        dominantAnchorId: null,
        protoAttraction: 0.50,
        topHitShare: 0,
        rimScars: [],
        horizonCandidates: [],
        splits: 0,
        lastMapped: -Infinity,
        lastSplitCycle: -Infinity,
        mode: 'baby-curriculum'
      },
      fac: makeDefaultFACState()
    };
  }

  function makeDefaultFACState() {
    return {
      originMedian: {
        id: 'M0',
        epoch: 0,
        cycle: 0,
        address: 'M0',
        ratio: '1/2',
        depth: 0,
        meaning: 'first admissible balance between asymptotic float and forbidden null'
      },
      medians: [],
      suggestions: [],
      outcomes: [],
      lastObservation: null,
      lastScore: 0,
      lastAction: null,
      lastUpdatedCycle: -Infinity,
      mode: 'suggestion'
    };
  }

  function migrateSave(input) {
    const fallback = makeDefaultState();
    let src = input;
    if (!src || typeof src !== 'object') return fallback;
    if (!src.params && src.settings) src.params = src.settings;
    if (!src.atlas) src.atlas = { anchors: [], packets: [], ancestry: [], notes: [] };
    if (!Array.isArray(src.atlas.anchors)) src.atlas.anchors = [];
    if (!Array.isArray(src.atlas.packets)) src.atlas.packets = [];
    if (!Array.isArray(src.atlas.seedlets)) src.atlas.seedlets = [];
    if (!Array.isArray(src.atlas.ancestry)) src.atlas.ancestry = [];
    if (!Array.isArray(src.atlas.notes)) src.atlas.notes = [];
    if (!src.horizon || typeof src.horizon !== 'object') src.horizon = {};
    if (!Array.isArray(src.horizon.shells)) src.horizon.shells = [];
    if (!src.superbasin || typeof src.superbasin !== 'object') src.superbasin = {};
    if (!src.fac || typeof src.fac !== 'object') src.fac = {};
    if (!Array.isArray(src.superbasin.rimScars)) src.superbasin.rimScars = [];
    if (!Array.isArray(src.superbasin.horizonCandidates)) src.superbasin.horizonCandidates = [];
    const merged = makeDefaultState(src.seed || fallback.seed);
    merged.version = VERSION;
    merged.id = src.id || merged.id;
    merged.time = Number.isFinite(src.time) ? src.time : 0;
    merged.epoch = Number.isFinite(src.epoch) ? src.epoch : 0;
    merged.cycle = Number.isFinite(src.cycle) ? src.cycle : 0;
    merged.params = Object.assign({}, merged.params, src.params || {});
    merged.params.foldDepth = Math.round(clamp(merged.params.foldDepth, 1, 12));
    merged.params.particleCount = Math.round(clamp(merged.params.particleCount, 500, 80000));
    merged.params.renderQuality = clamp(Number(merged.params.renderQuality) || 1.0, 0.45, 3.0);
    merged.params.timeScale = clamp(Number(merged.params.timeScale) || 1.0, 0.02, 1.0);
    merged.params.chartWrapEnabled = merged.params.chartWrapEnabled === false ? false : true;
    merged.params.toroidalField = merged.params.toroidalField === false ? false : true;
    merged.params.horizonExitThreshold = clamp(Number(merged.params.horizonExitThreshold) || 0.58, 0.30, 1.15);
    merged.params.superbasinFollowStrength = clamp(Number(merged.params.superbasinFollowStrength) || 0.39, 0.00, 1.00);
    merged.params.autoEvolve = merged.params.autoEvolve === false ? false : true;
    merged.params.showStructureOverlay = merged.params.showStructureOverlay === false ? false : true;
    merged.params.bugeyeEnabled = merged.params.bugeyeEnabled === false ? false : true;
    merged.params.bugeyeViews = Math.round(clamp(Number(merged.params.bugeyeViews) || 7, 6, 8));
    merged.params.bugeyeQuality = clamp(Number(merged.params.bugeyeQuality) || 0.65, 0.45, 1.0);
    merged.params.bugeyeDurationMs = Math.round(clamp(Number(merged.params.bugeyeDurationMs) || 5200, 1800, 12000));
    merged.params.bugeyeCooldownCycles = Math.round(clamp(Number(merged.params.bugeyeCooldownCycles) || 720, 120, 6000));
    merged.params.bugeyeAtlasWeight = clamp(Number(merged.params.bugeyeAtlasWeight) || 0.12, 0.02, 0.32);
    merged.params.learnDuty = clamp(Number(merged.params.learnDuty) || (merged.params.schedulerMode === 'learn80' ? 0.80 : 0.20), 0.20, 0.80);
    merged.params.schedulerAutotune = merged.params.schedulerAutotune === false ? false : true;
    merged.params.bugeyeDwellMultiplier = clamp(Number(merged.params.bugeyeDwellMultiplier) || 1.0, 0.0, 2.0);
    merged.params.bugeyeSatisfactionThreshold = clamp(Number(merged.params.bugeyeSatisfactionThreshold) || 0.42, 0.20, 0.95);
    if (String(src.version || '').includes('0.4.9') && merged.params.bugeyeSatisfactionThreshold >= 0.60) {
      merged.params.bugeyeSatisfactionThreshold = 0.42;
    }
    merged.params.miningLayerLimit = Math.round(clamp(Number(merged.params.miningLayerLimit) || 3, 2, 3));
    merged.params.dimensionalDigBias = clamp(Number(merged.params.dimensionalDigBias) || 0.42, 0.0, 1.0);
    merged.params.filamentClimbThreshold = clamp(Number(merged.params.filamentClimbThreshold) || 0.58, 0.20, 0.98);
    merged.params.portalDiversity = clamp(Number(merged.params.portalDiversity) || 0.55, 0.0, 1.0);
    merged.params.portalUniqueSourceQuota = Math.round(clamp(Number(merged.params.portalUniqueSourceQuota) || 24, 4, 128));
    merged.params.autoMiningEnabled = merged.params.autoMiningEnabled === false ? false : true;
    merged.params.autoMiningCooldownCycles = Math.round(clamp(Number(merged.params.autoMiningCooldownCycles) || 1440, 180, 12000));
    merged.params.autoMiningStayCycles = Math.round(clamp(Number(merged.params.autoMiningStayCycles) || 620, 120, 6000));
    merged.params.autoMiningBugeyeDelayCycles = Math.round(clamp(Number(merged.params.autoMiningBugeyeDelayCycles) || 110, 12, 1200));
    merged.params.autoMiningFilamentChance = clamp(Number(merged.params.autoMiningFilamentChance) || 0.58, 0.0, 1.0);
    merged.params.autoMiningPostBugeyeClimbWindowCycles = Math.round(clamp(Number(merged.params.autoMiningPostBugeyeClimbWindowCycles) || 760, 120, 2400));
    merged.params.autoMiningPostBugeyeClimbRelax = clamp(Number(merged.params.autoMiningPostBugeyeClimbRelax) || 0.24, 0.0, 0.50);
    merged.params.livingWordEnabled = merged.params.livingWordEnabled === false ? false : true;
    merged.params.livingWordAtlasWeight = clamp(Number(merged.params.livingWordAtlasWeight) || 0.10, 0.01, 0.30);
    merged.params.livingWordLearningLift = clamp(Number(merged.params.livingWordLearningLift) || 0.0012, 0.0001, 0.02);
    merged.params.horizonEnabled = merged.params.horizonEnabled === false ? false : true;
    merged.params.horizonThreshold = clamp(Number(merged.params.horizonThreshold) || 0.74, 0.45, 1.20);
    merged.params.horizonShellAtlasWeight = clamp(Number(merged.params.horizonShellAtlasWeight) || 0.10, 0.00, 0.35);
    merged.params.horizonReleaseThreshold = clamp(Number(merged.params.horizonReleaseThreshold) || 0.82, 0.35, 1.25);
    merged.params.horizonMaxShells = Math.round(clamp(Number(merged.params.horizonMaxShells) || 24, 4, 96));
    merged.params.horizonSeedletCoupling = clamp(Number(merged.params.horizonSeedletCoupling) || 0.24, 0.00, 0.80);
    merged.params.horizonNurseryGateEnabled = merged.params.horizonNurseryGateEnabled === false ? false : true;
    merged.params.horizonNurseryGateThreshold = clamp(Number(merged.params.horizonNurseryGateThreshold) || 0.715, 0.45, 1.20);
    merged.params.horizonNurseryGateLimit = Math.round(clamp(Number(merged.params.horizonNurseryGateLimit) || 2, 1, 16));
    merged.params.horizonNurseryGateMinScore = clamp(Number(merged.params.horizonNurseryGateMinScore) || 1.20, 0.10, 8.00);
    merged.params.protoAttractionEnabled = merged.params.protoAttractionEnabled === false ? false : true;
    merged.params.protoAttractionCenter = clamp(Number(merged.params.protoAttractionCenter) || 0.50, 0.20, 0.80);
    merged.params.protoAttractionLearningRate = clamp(Number(merged.params.protoAttractionLearningRate) || 0.012, 0.000, 0.080);
    merged.params.horizonRimEnabled = merged.params.horizonRimEnabled === false ? false : true;
    merged.params.horizonRimApproachThreshold = clamp(Number(merged.params.horizonRimApproachThreshold) || 0.56, 0.35, 1.10);
    merged.params.horizonRimScarWeight = clamp(Number(merged.params.horizonRimScarWeight) || 0.18, 0.00, 0.80);
    merged.params.horizonCandidateThreshold = clamp(Number(merged.params.horizonCandidateThreshold) || 0.62, 0.35, 1.20);
    merged.params.superbasinSplitThreshold = clamp(Number(merged.params.superbasinSplitThreshold) || 0.86, 0.45, 1.40);
    merged.params.superbasinDiversityFloor = clamp(Number(merged.params.superbasinDiversityFloor) || 0.18, 0.00, 0.65);
    merged.params.dominantBasinMaxHitShare = clamp(Number(merged.params.dominantBasinMaxHitShare) || 0.72, 0.20, 0.98);
    merged.params.horizonBoundStatusAccounting = merged.params.horizonBoundStatusAccounting === false ? false : true;
    merged.params.horizonCandidateTelemetryFix = merged.params.horizonCandidateTelemetryFix === false ? false : true;
    merged.params.horizonBoundMaxFraction = clamp(Number(merged.params.horizonBoundMaxFraction) || 0.28, 0.02, 0.95);
    merged.params.horizonBoundSoftCap = Math.round(clamp(Number(merged.params.horizonBoundSoftCap) || 48, 1, 4096));
    merged.params.horizonBoundHardCap = Math.round(clamp(Number(merged.params.horizonBoundHardCap) || 64, 1, 4096));
    if (merged.params.horizonBoundHardCap < merged.params.horizonBoundSoftCap) merged.params.horizonBoundHardCap = merged.params.horizonBoundSoftCap;
    merged.params.horizonCaptureCooldownCycles = Math.round(clamp(Number(merged.params.horizonCaptureCooldownCycles) || 360, 0, 24000));
    merged.params.horizonParoleEnabled = merged.params.horizonParoleEnabled === false ? false : true;
    merged.params.horizonParoleCompactness = clamp(Number(merged.params.horizonParoleCompactness) || 0.69, 0.30, 1.20);
    merged.params.horizonParoleResonanceMin = clamp(Number(merged.params.horizonParoleResonanceMin) || 0.62, 0.00, 1.00);
    merged.params.horizonParoleProductivityMin = clamp(Number(merged.params.horizonParoleProductivityMin) || 0.04, 0.00, 2.00);
    merged.params.horizonFreezeExitCompactness = clamp(Number(merged.params.horizonFreezeExitCompactness) || 0.69, 0.30, 1.20);
    merged.params.horizonReleaseDrainLimit = Math.round(clamp(Number(merged.params.horizonReleaseDrainLimit) || 10, 1, 128));
    merged.params.annealingReheatOnOvercapture = merged.params.annealingReheatOnOvercapture === false ? false : true;
    merged.params.horizonOvercaptureReheatFraction = clamp(Number(merged.params.horizonOvercaptureReheatFraction) || 0.45, 0.05, 0.95);
    merged.params.horizonOvercaptureReheatTemperature = clamp(Number(merged.params.horizonOvercaptureReheatTemperature) || 0.66, 0.05, 1.00);
    merged.params.pauseFreezesBudgets = merged.params.pauseFreezesBudgets === false ? false : true;
    merged.params.pauseFreezesAutotune = merged.params.pauseFreezesAutotune === false ? false : true;
    merged.params.pauseFreezesBugeyeRoutines = merged.params.pauseFreezesBugeyeRoutines === false ? false : true;
    merged.params.pauseFreezesMiningRoutines = merged.params.pauseFreezesMiningRoutines === false ? false : true;
    merged.params.freezeAnnealingChildBudgetOnPause = merged.params.freezeAnnealingChildBudgetOnPause === false ? false : true;
    merged.params.effectiveBudgetHardCap = Math.round(clamp(Number(merged.params.effectiveBudgetHardCap) || 3, 1, 64));
    merged.params.effectiveNurseryBudgetHardCap = Math.round(clamp(Number(merged.params.effectiveNurseryBudgetHardCap) || 8, 1, 128));
    merged.params.facMedianEnabled = merged.params.facMedianEnabled === false ? false : true;
    merged.params.facOriginMedianEnabled = merged.params.facOriginMedianEnabled === false ? false : true;
    merged.params.facMedianTreeDepth = Math.round(clamp(Number(merged.params.facMedianTreeDepth) || 7, 1, 16));
    merged.params.facMedianRatios = parseMedianRatios(merged.params.facMedianRatios).join(',');
    merged.params.facMedianMode = String(merged.params.facMedianMode || 'suggestion') === 'direct' ? 'direct' : 'suggestion';
    merged.params.facMedianScoreThreshold = clamp(Number(merged.params.facMedianScoreThreshold) || 0.04, 0.001, 0.50);
    merged.params.facMedianActionLimit = Math.round(clamp(Number(merged.params.facMedianActionLimit) || 1, 1, 4));
    merged.params.facMedianUpdateIntervalCycles = Math.round(clamp(Number(merged.params.facMedianUpdateIntervalCycles) || 90, 1, 2400));
    merged.params.facMedianMinConfidence = clamp(Number(merged.params.facMedianMinConfidence) || 0.34, 0.00, 1.00);

    // 0.4.20 migration: bump only untouched 0.4.19 defaults so old saves
    // immediately exercise the nursery gate without overriding user tuning.
    if (String(src.version || '').includes('0.4.19')) {
      if (Math.abs((Number(src.params && src.params.superbasinFollowStrength) || 0) - 0.36) < 1e-6) merged.params.superbasinFollowStrength = 0.42;
      if (Math.abs((Number(src.params && src.params.horizonSeedletCoupling) || 0) - 0.18) < 1e-6) merged.params.horizonSeedletCoupling = 0.24;
      if (Math.abs((Number(src.params && src.params.horizonCandidateThreshold) || 0) - 0.68) < 1e-6) merged.params.horizonCandidateThreshold = 0.62;
    }
    // 0.4.21 migration: if a 0.4.20 save is still on the nursery-gate defaults,
    // tighten intake/release and add diversity pressure without overriding manual edits.
    if (String(src.version || '').includes('0.4.20')) {
      if (Math.abs((Number(src.params && src.params.superbasinFollowStrength) || 0) - 0.42) < 1e-6) merged.params.superbasinFollowStrength = 0.39;
      if (Math.abs((Number(src.params && src.params.horizonNurseryGateThreshold) || 0) - 0.70) < 1e-6) merged.params.horizonNurseryGateThreshold = 0.715;
      if (Math.abs((Number(src.params && src.params.horizonNurseryGateLimit) || 0) - 3) < 1e-6) merged.params.horizonNurseryGateLimit = 2;
      if (Math.abs((Number(src.params && src.params.horizonReleaseThreshold) || 0) - 0.78) < 1e-6) merged.params.horizonReleaseThreshold = 0.82;
    }
    // 0.4.21b migration: 0.4.21 proved capture but allowed horizon-bound
    // status to become an absorbing ratchet. Add occupancy caps and lower the
    // release threshold enough to drain bound populations after maturation.
    if (String(src.version || '').includes('0.4.21')) {
      if (Math.abs((Number(src.params && src.params.horizonReleaseThreshold) || 0) - 0.82) < 1e-6) merged.params.horizonReleaseThreshold = 0.79;
      merged.params.horizonBoundMaxFraction = Number(src.params && src.params.horizonBoundMaxFraction) || 0.28;
      merged.params.horizonBoundSoftCap = Number(src.params && src.params.horizonBoundSoftCap) || 48;
      merged.params.horizonBoundHardCap = Number(src.params && src.params.horizonBoundHardCap) || 64;
      merged.params.horizonCaptureCooldownCycles = Number(src.params && src.params.horizonCaptureCooldownCycles) || 360;
      merged.params.horizonParoleEnabled = (src.params && src.params.horizonParoleEnabled) === false ? false : true;
      merged.params.horizonParoleCompactness = Number(src.params && src.params.horizonParoleCompactness) || 0.69;
      merged.params.horizonFreezeExitCompactness = Number(src.params && src.params.horizonFreezeExitCompactness) || 0.69;
      merged.params.annealingReheatOnOvercapture = (src.params && src.params.annealingReheatOnOvercapture) === false ? false : true;
    }
    // 0.4.21c migration: pause is now a true control-plane freeze for
    // derived budgets/autotune. Base physics defaults are unchanged.
    if (String(src.version || '').includes('0.4.21')) {
      merged.params.pauseFreezesBudgets = (src.params && src.params.pauseFreezesBudgets) === false ? false : true;
      merged.params.pauseFreezesAutotune = (src.params && src.params.pauseFreezesAutotune) === false ? false : true;
      merged.params.pauseFreezesBugeyeRoutines = (src.params && src.params.pauseFreezesBugeyeRoutines) === false ? false : true;
      merged.params.pauseFreezesMiningRoutines = (src.params && src.params.pauseFreezesMiningRoutines) === false ? false : true;
      merged.params.freezeAnnealingChildBudgetOnPause = (src.params && src.params.freezeAnnealingChildBudgetOnPause) === false ? false : true;
      merged.params.effectiveBudgetHardCap = Number(src.params && src.params.effectiveBudgetHardCap) || 3;
      merged.params.effectiveNurseryBudgetHardCap = Number(src.params && src.params.effectiveNurseryBudgetHardCap) || 8;
    }
    merged.params.fieldWidth = Math.round(clamp(merged.params.fieldWidth, 80, 768));
    merged.params.fieldHeight = Math.round(clamp(merged.params.fieldHeight, 48, 432));
    merged.params.maxAnchors = Math.round(clamp(merged.params.maxAnchors || 128, 16, 4096));
    merged.params.maxAtlasInfluence = Math.round(clamp(merged.params.maxAtlasInfluence || 48, 1, 1024));
    merged.params.minAnchorScore = clamp(Number(merged.params.minAnchorScore) || 0.66, 0.05, 2.0);
    merged.params.memoryMaxPages = Math.round(clamp(merged.params.memoryMaxPages || 256, 16, 8192));
    merged.params.pageSize = Math.round(clamp(merged.params.pageSize || 96, 32, 256));
    merged.params.learningRate = clamp(Number(merged.params.learningRate) || 0.22, 0.0001, 0.7);
    merged.params.annealingEnabled = merged.params.annealingEnabled === false ? false : true;
    merged.params.annealingMinLearningRate = clamp(Number(merged.params.annealingMinLearningRate) || 0.0001, 0.00001, 0.05);
    merged.params.annealingMaxLearningRate = clamp(Number(merged.params.annealingMaxLearningRate) || 0.50, 0.05, 0.70);
    merged.params.annealingCoolingRate = clamp(Number(merged.params.annealingCoolingRate) || 0.95, 0.80, 0.999);
    merged.params.annealingStabilityCriticality = clamp(Number(merged.params.annealingStabilityCriticality) || 0.65, 0.55, 0.995);
    merged.params.annealingBoredomLimit = Math.round(clamp(merged.params.annealingBoredomLimit || 1000, 20, 100000));
    merged.params.annealingReheatTemperature = clamp(Number(merged.params.annealingReheatTemperature) || 1.0, 0.2, 1.0);
    merged.params.annealingBaselockTemperature = clamp(Number(merged.params.annealingBaselockTemperature) || 0.06, 0.001, 0.25);
    merged.params.annealingCorridorCriticality = clamp(Number(merged.params.annealingCorridorCriticality) || 0.48, 0.05, 0.95);
    merged.params.annealingCorridorMin = Math.round(clamp(merged.params.annealingCorridorMin || 6, 1, 128));
    merged.params.annealingFastQuench = clamp(Number(merged.params.annealingFastQuench) || 0.42, 0.25, 0.98);
    merged.params.schedulerMode = 'continuous';
    merged.params.driverEnabled = merged.params.driverEnabled === false ? false : true;
    merged.params.driverAutotune = merged.params.driverAutotune === false ? false : true;
    merged.params.splitDepthMax = Math.round(clamp(merged.params.splitDepthMax || 8, 1, 12));
    merged.params.minPortalScore = clamp(Number(merged.params.minPortalScore) || 1.72, 0.5, 4.0);
    merged.params.maxPortals = Math.round(clamp(merged.params.maxPortals || 96, 8, 512));
    merged.params.nestedEnabled = merged.params.nestedEnabled === false ? false : true;
    merged.params.nestedAutoproject = merged.params.nestedAutoproject === false ? false : true;
    merged.params.maxSeedlets = Math.round(clamp(merged.params.maxSeedlets || 192, 0, 4096));
    merged.params.activeSeedlets = Math.round(clamp(merged.params.activeSeedlets || 32, 1, 512));
    merged.params.seedletPacketLimit = Math.round(clamp(merged.params.seedletPacketLimit || 64, 8, 512));
    merged.params.gaugeReserveSeedlets = clamp(Number(merged.params.gaugeReserveSeedlets) || 0.40, 0.05, 0.80);
    merged.params.atlasBasinReserve = clamp(Number(merged.params.atlasBasinReserve) || 0.40, 0.05, 0.90);
    merged.params.atlasKeyholeReserve = clamp(Number(merged.params.atlasKeyholeReserve) || 0.30, 0.05, 0.90);
    merged.params.atlasFilamentReserve = clamp(Number(merged.params.atlasFilamentReserve) || 0.20, 0.00, 0.70);
    merged.params.atlasOtherReserve = clamp(Number(merged.params.atlasOtherReserve) || 0.10, 0.00, 0.40);
    merged.params.stagnantAfterHits = Math.round(clamp(merged.params.stagnantAfterHits || 48, 4, 512));
    merged.params.reproductiveScore = clamp(Number(merged.params.reproductiveScore) || 1.62, 0.5, 4.0);
    merged.params.maxSeedDepth = Math.round(clamp(merged.params.maxSeedDepth || 14, 1, 32));
    merged.params.seedProjectionThreshold = clamp(Number(merged.params.seedProjectionThreshold) || 0.82, 0.35, 1.5);
    merged.params.seedTrainingBudget = Math.round(clamp(merged.params.seedTrainingBudget || 3, 0, 64));
    merged.params.nestedTimeDilation = merged.params.nestedTimeDilation === false ? false : true;
    merged.params.boundaryBleed = merged.params.boundaryBleed === false ? false : true;
    merged.params.phaseMatchWeight = clamp(Number(merged.params.phaseMatchWeight) || 0.38, 0, 1.25);
    merged.params.maxTimeDilation = clamp(Number(merged.params.maxTimeDilation) || 64, 1, 256);
    merged.params.seedletMetabolismEnabled = merged.params.seedletMetabolismEnabled === false ? false : true;
    merged.params.seedletMetabolicFloor = clamp(Number(merged.params.seedletMetabolicFloor) || 0.085, 0, 1.0);
    merged.params.seedletCollapseEnergy = clamp(Number(merged.params.seedletCollapseEnergy) || 0.012, 0, 0.25);
    merged.params.seedletReviveEnergy = clamp(Number(merged.params.seedletReviveEnergy) || 0.12, 0.01, 2.0);
    merged.params.seedletRescueCriticality = clamp(Number(merged.params.seedletRescueCriticality) || 0.72, 0.05, 1.0);
    merged.params.seedletRescueResonance = clamp(Number(merged.params.seedletRescueResonance) || 0.28, 0, 1.0);
    merged.params.seedletNurseryMinActive = clamp(Number(merged.params.seedletNurseryMinActive) || 0.16, 0, 1.0);
    merged.params.seedletCollapseReheatFraction = clamp(Number(merged.params.seedletCollapseReheatFraction) || 0.22, 0, 1.0);
    merged.params.seedletNurseryBudgetBoost = Math.round(clamp(merged.params.seedletNurseryBudgetBoost || 8, 1, 128));
    merged.params.seedletDormancyEnergyDrain = clamp(Number(merged.params.seedletDormancyEnergyDrain) || 0.9997, 0.90, 1.0);
    merged.params.seedletEnergyDecay = clamp(Number(merged.params.seedletEnergyDecay) || 0.994, 0.90, 1.0);
    merged.params.seedletEnergyMax = clamp(Number(merged.params.seedletEnergyMax) || 2.25, 0.5, 16);
    merged.atlas.anchors = src.atlas.anchors.map((a, i) => normalizeAnchor(a, i)).filter(Boolean).slice(0, merged.params.maxAnchors);
    merged.atlas.packets = src.atlas.packets.slice(-24);
    merged.atlas.seedlets = src.atlas.seedlets.slice(-(merged.params.maxSeedlets || 192)).map((s, i) => normalizeSeedlet(s, i)).filter(Boolean);
    merged.atlas.ancestry = src.atlas.ancestry.slice(-32);
    merged.atlas.notes = src.atlas.notes.slice(-16);
    merged.stats = Object.assign({}, merged.stats, src.stats || {});
    merged.bugeye = Object.assign({ active: false, runs: 0, staleRuns: 0, lastNovelty: 0, lastGain: 0, lastCycle: -1, tryAnythingArmed: false, reason: 'idle' }, src.bugeye || {});
    merged.bugeye.active = false;
    merged.stats.anchors = merged.atlas.anchors.length;
    merged.stats.packets = merged.atlas.packets.length;
    merged.stats.seedlets = merged.atlas.seedlets.length;
    merged.horizon = Object.assign({}, merged.horizon, src.horizon || {});
    merged.horizon.shells = (src.horizon.shells || []).map((h, i) => normalizeHorizonShell(h, i)).filter(Boolean).slice(0, merged.params.horizonMaxShells || 24);
    merged.horizon.lastProtoAttraction = clamp01(Number(src.horizon.lastProtoAttraction) || 0.50);
    merged.horizon.lastCapture = clamp(Number(src.horizon.lastCapture) || 0, 0, 4);
    merged.horizon.lastEscape = clamp(Number(src.horizon.lastEscape) || 0, 0, 4);
    merged.superbasin = Object.assign({}, merged.superbasin, src.superbasin || {});
    merged.superbasin.protoAttraction = clamp01(Number(merged.superbasin.protoAttraction) || merged.horizon.lastProtoAttraction || 0.50);
    merged.superbasin.topHitShare = clamp01(Number(merged.superbasin.topHitShare) || 0);
    merged.superbasin.rimScars = (src.superbasin.rimScars || []).slice(-96).map((r, i) => ({
      id: r.id || ('rim-' + i.toString(36)),
      x: wrapUnit(Number(r.x) || 0), y: wrapUnit(Number(r.y) || 0),
      angle: Number(r.angle) || 0, score: clamp(Number(r.score) || 0, 0, 2),
      scarDepth: clamp(Number(r.scarDepth) || 0, 0, 8), age: Math.max(0, Math.round(Number(r.age) || 0)),
      lastSeen: Math.round(Number(r.lastSeen) || 0), parentAnchorId: r.parentAnchorId || null
    }));
    merged.superbasin.horizonCandidates = (src.superbasin.horizonCandidates || []).slice(-32).map((r, i) => ({
      id: r.id || ('candidate-' + i.toString(36)),
      x: wrapUnit(Number(r.x) || 0), y: wrapUnit(Number(r.y) || 0),
      score: clamp(Number(r.score) || 0, 0, 2),
      scarDepth: clamp(Number(r.scarDepth) || 0, 0, 8),
      parentAnchorId: r.parentAnchorId || null, lastSeen: Math.round(Number(r.lastSeen) || 0)
    }));
    merged.fac = normalizeFACState(src.fac, merged);
    if (src.driver && typeof src.driver === 'object') merged.driver = JSON.parse(JSON.stringify(src.driver));
    if (src.nested && typeof src.nested === 'object') merged.nested = JSON.parse(JSON.stringify(src.nested));
    return merged;
  }


  function normalizeHorizonShell(h, i) {
    if (!h || typeof h !== 'object') return null;
    return {
      id: h.id || ('shell-' + i.toString(36)),
      anchorId: h.anchorId || null,
      x: wrapUnit(Number(h.x) || 0),
      y: wrapUnit(Number(h.y) || 0),
      radius: clamp(Number(h.radius) || 0.18, 0.006, 0.65),
      compactness: clamp(Number(h.compactness) || 0, 0, 2.5),
      collapsePressure: clamp(Number(h.collapsePressure) || 0, 0, 3),
      localResistance: clamp01(Number(h.localResistance) || 1),
      outwardCoupling: clamp01(Number(h.outwardCoupling) || 1),
      scarDepth: clamp(Number(h.scarDepth) || 0, 0, 8),
      scarMemory: clamp01(Number(h.scarMemory) || 0),
      scarPermeability: clamp01(Number(h.scarPermeability) || 0),
      scarAsymmetry: clamp(Number(h.scarAsymmetry) || 0, -1, 1),
      shellDensity: clamp01(Number(h.shellDensity) || 0),
      shellQuasiperiodicity: clamp01(Number(h.shellQuasiperiodicity) || 0.618),
      releaseReadiness: clamp(Number(h.releaseReadiness) || 0, 0, 2),
      tileSeed: Math.round(Number(h.tileSeed) || hashString('shell:' + i)),
      age: Math.max(0, Math.round(Number(h.age) || 0)),
      born: Math.round(Number(h.born) || 0),
      lastSeen: Math.round(Number(h.lastSeen) || 0),
      lastRelease: Number.isFinite(h.lastRelease) ? h.lastRelease : -Infinity,
      status: h.status || 'approach-shell'
    };
  }

  function normalizeAnchor(a, i) {
    if (!a || typeof a !== 'object') return null;
    const x = Number(a.x), y = Number(a.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      id: a.id || ('a-' + i.toString(36) + '-' + Math.abs(Math.floor(x * 9999)).toString(36)),
      x: wrapUnit(clamp(x, -1.5, 1.5)),
      y: wrapUnit(clamp(y, -1.5, 1.5)),
      radius: clamp(Number(a.radius) || 0.18, 0.04, 0.65),
      strength: clamp(Number(a.strength ?? a.s) || 0.35, 0.01, 1.5),
      score: clamp(Number(a.score ?? a.q) || 0.5, 0, 2),
      phase: Number.isFinite(a.phase) ? a.phase : 0,
      hits: Math.max(1, Math.round(Number(a.hits ?? a.h) || 1)),
      born: Math.round(Number(a.born) || 0),
      lastSeen: Math.round(Number(a.lastSeen) || 0),
      kind: a.kind || a.k || 'basin',
      criticality: clamp01(Number(a.criticality ?? a.c) || 0),
      scarDepth: Number.isFinite(a.scarDepth) ? clamp(Number(a.scarDepth), 0, 8) : undefined,
      scarPermeability: Number.isFinite(a.scarPermeability) ? clamp01(Number(a.scarPermeability)) : undefined,
      shellId: a.shellId || undefined,
      rimScarDepth: Number.isFinite(a.rimScarDepth) ? clamp(Number(a.rimScarDepth), 0, 8) : undefined,
      protoAttraction: Number.isFinite(a.protoAttraction) ? clamp01(Number(a.protoAttraction)) : undefined,
      superbasinParentId: a.superbasinParentId || undefined
    };
  }



  function normalizeSeedlet(s, i) {
    if (!s || typeof s !== 'object') return null;
    const depth = Math.round(clamp(Number(s.depth ?? s.d) || 1, 1, 32));
    const scaleRatio = clamp(Number(s.scaleRatio ?? s.r) || Math.pow(0.5, depth), 1e-9, 1);
    const address = s.address && typeof s.address === 'object' ? Object.assign({}, s.address) : {
      universeSeed: String(s.universeSeed || s.id || ('seedlet-' + i)),
      dimensionId: 'seedlet',
      foldLevel: depth,
      originX: 0,
      originY: 0,
      scale: scaleRatio,
      timeDilation: Number(s.timeDilationApplied ?? s.timeDilation ?? s.td) || 1
    };
    const rawDilation = Number(s.timeDilationRaw ?? (s.gauge && s.gauge.timeDilationRaw) ?? (1 / Math.max(1e-9, scaleRatio))) || 1;
    const appliedDilation = Number(s.timeDilationApplied ?? s.timeDilation ?? address.timeDilation) || Math.min(rawDilation, 64);
    address.timeDilation = appliedDilation;
    address.timeDilationRaw = rawDilation;
    address.timeDilationApplied = appliedDilation;
    return {
      id: s.id || ('seedlet-' + i.toString(36)),
      type: s.type || 'omegaseed.seedlet',
      status: s.status || 'dormant',
      parentStateId: s.parentStateId || null,
      parentAnchorId: s.parentAnchorId || s.a || null,
      born: Math.round(Number(s.born) || 0),
      lastSeen: Math.round(Number(s.lastSeen) || 0),
      depth,
      scaleRatio,
      timeDilation: appliedDilation,
      timeDilationRaw: rawDilation,
      timeDilationApplied: appliedDilation,
      productivity: clamp(Number(s.productivity) || 0, 0, 16),
      resonance: clamp01(Number(s.resonance) || 0),
      stagnation: clamp(Number(s.stagnation) || 0, 0, 999999),
      gauge: Object.assign({ type: 'scale-phase-renormalization' }, s.gauge || {}, {
        timeDilationRaw: rawDilation,
        timeDilationApplied: appliedDilation
      }),
      address,
      score: clamp(Number(s.score ?? s.q) || 0, 0, 8),
      criticality: clamp01(Number(s.criticality ?? s.c) || 0),
      energy: clamp(Number(s.energy) || 0.3, 0, 8),
      hits: Math.max(0, Math.round(Number(s.hits ?? s.h) || 0)),
      genome: s.genome || null,
      compressedAnchors: Array.isArray(s.compressedAnchors) ? s.compressedAnchors.slice(0, 32) : [],
      portalId: s.portalId || null,
      lineage: Array.isArray(s.lineage) ? s.lineage.slice(-16) : [],
      summary: s.summary || null,
      horizon: s.horizon && typeof s.horizon === 'object' ? Object.assign({}, s.horizon, {
        shellId: s.horizon.shellId || null,
        crossed: Math.round(Number(s.horizon.crossed) || 0),
        localClock: clamp(Number(s.horizon.localClock) || 0, 0, 1e9),
        outwardCoupling: clamp01(Number(s.horizon.outwardCoupling) || 0),
        localResistance: clamp01(Number(s.horizon.localResistance) || 0),
        scarDepth: clamp(Number(s.horizon.scarDepth) || 0, 0, 8),
        captureMode: s.horizon.captureMode || undefined
      }) : undefined
    };
  }

  function anchorRank(a) {
    const c = Number(a.criticality || 0);
    const kind = a.kind || 'basin';
    const kindBoost = kind === 'keyhole' ? 1.75 : (kind === 'filament' ? 1.34 : (kind === 'wall' || kind === 'scar' || kind === 'portal' ? 1.18 : 1.0));
    return kindBoost * ((a.score || 0) * (a.strength || 0.01) * Math.log2(2 + (a.hits || 1)) + c * 0.38);
  }

  function reserveAnchors(anchors, p) {
    const max = Math.max(1, Math.round(p.maxAnchors || 128));
    const groups = { basin: [], keyhole: [], filament: [], other: [] };
    for (const a of anchors.filter(a => a.strength > 0.018 && a.score > 0.08)) {
      const k = a.kind || 'basin';
      if (k === 'keyhole') groups.keyhole.push(a);
      else if (k === 'filament') groups.filament.push(a);
      else if (k === 'basin') groups.basin.push(a);
      else groups.other.push(a);
    }
    for (const g of Object.values(groups)) g.sort((a, b) => anchorRank(b) - anchorRank(a));
    const target = {
      basin: Math.max(1, Math.floor(max * (p.atlasBasinReserve ?? 0.40))),
      keyhole: Math.max(1, Math.floor(max * (p.atlasKeyholeReserve ?? 0.30))),
      filament: Math.max(0, Math.floor(max * (p.atlasFilamentReserve ?? 0.20))),
      other: Math.max(0, Math.floor(max * (p.atlasOtherReserve ?? 0.10)))
    };
    const out = [];
    function take(kind, n) { out.push(...groups[kind].splice(0, Math.max(0, n))); }
    take('keyhole', target.keyhole);
    take('filament', target.filament);
    take('other', target.other);
    take('basin', target.basin);
    const leftovers = groups.keyhole.concat(groups.filament, groups.other, groups.basin).sort((a, b) => anchorRank(b) - anchorRank(a));
    out.push(...leftovers);
    return out.slice(0, max).sort((a, b) => anchorRank(b) - anchorRank(a));
  }

  function seedletRank(s) {
    const statusBoost = s.status === 'reproductive' || s.status === 'white-hole-released' ? 1.35 : (s.status === 'resonant' ? 1.22 : (s.status === 'horizon-bound' ? 1.12 : (s.status === 'training' ? 1.08 : (s.status === 'collapsed' || s.status === 'scar' ? 0.15 : 1.0))));
    const hits = Math.log2(2 + Number(s.hits || 0));
    return statusBoost * ((s.score || 0) * 0.36 + (s.criticality || 0) * 0.38 + (s.resonance || 0) * 0.18 + (s.productivity || 0) * 0.08 + Math.min(1, hits / 12) * 0.05) - (s.stagnation || 0) * 0.002;
  }

  function seedletStatusCounts(state) {
    const seedlets = ((state.atlas && state.atlas.seedlets) || []);
    const statuses = {};
    for (const s of seedlets) statuses[s.status || 'dormant'] = (statuses[s.status || 'dormant'] || 0) + 1;
    return statuses;
  }

  function summarizeGaugeAtlas(state) {
    const seedlets = ((state.atlas && state.atlas.seedlets) || []);
    const driver = state.driver || {};
    const portals = Array.isArray(driver.portals) ? driver.portals : [];
    const statuses = {};
    let criticalMean = 0, resonanceMean = 0, productivityMean = 0, maxDilation = 0;
    for (const s of seedlets) {
      statuses[s.status || 'dormant'] = (statuses[s.status || 'dormant'] || 0) + 1;
      criticalMean += Number(s.criticality || 0);
      resonanceMean += Number(s.resonance || 0);
      productivityMean += Number(s.productivity || 0);
      maxDilation = Math.max(maxDilation, Number(s.timeDilationApplied ?? s.timeDilation ?? 1));
    }
    const n = Math.max(1, seedlets.length);
    return {
      seedlets: seedlets.length,
      statuses,
      activeSeedletId: state.nested && state.nested.activeSeedletId || null,
      criticalMean: criticalMean / n,
      resonanceMean: resonanceMean / n,
      productivityMean: productivityMean / n,
      maxDilation,
      portals: portals.length,
      topSeedlets: seedlets.slice().sort((a, b) => seedletRank(b) - seedletRank(a)).slice(0, 16).map(s => ({
        id: s.id, d: s.depth, r: Number((s.scaleRatio || 0).toFixed(8)), q: Number((s.score || 0).toFixed(5)), c: Number((s.criticality || 0).toFixed(5)),
        res: Number((s.resonance || 0).toFixed(5)), prod: Number((s.productivity || 0).toFixed(5)), status: s.status || 'dormant', td: Number((s.timeDilationApplied ?? s.timeDilation ?? 1).toFixed(5))
      }))
    };
  }

  function buildRuntime(state) {
    const seedHash = hashString(state.seed || 'omegaseed');
    return {
      seedHash,
      noise: new SimplexNoise2D(seedHash),
      rand: mulberry32(seedHash ^ 0x9e3779b9)
    };
  }

  function atlasContribution(x, y, state) {
    const anchors = (state.atlas && state.atlas.anchors) || [];
    const p = state.params;
    const max = Math.min(anchors.length, p.maxAtlasInfluence || 48);
    if (!max || p.atlasInfluence <= 0) return 0;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < max; i++) {
      const a = anchors[i];
      const dx = wrapDelta(x, a.x);
      const dy = wrapDelta(y, a.y);
      const r = Math.max(0.025, a.radius || p.atlasRadius || 0.18);
      const q = (dx * dx + dy * dy) / (r * r);
      if (q > 9) continue;
      const k = Math.exp(-q * 1.15) * (a.strength || 0.2);
      sum += k;
      norm += Math.max(0.15, a.strength || 0.2);
    }
    return clamp01(sum / Math.max(1, norm * 0.42));
  }

  function sampleRawField(x, y, t, state, runtime) {
    const p = state.params;
    const noise = runtime.noise;
    let qx = x;
    let qy = y;
    let amp = 0.74;
    let freq = p.scale;
    let warp = p.warpStrength;
    let baseSum = 0;
    let ridgeSum = 0;
    let curlSum = 0;
    let norm = 0;
    const flow = p.flow;
    const depth = Math.round(clamp(p.foldDepth, 1, 9));

    for (let i = 0; i < depth; i++) {
      const k = i + 1;
      const tf = t * flow;
      const wf = freq * (0.72 + k * 0.031);
      const wx = p.toroidalField === false
        ? noise.noise2D(qx * wf + 37.13 * k + tf * (0.031 + 0.006 * k), qy * wf - 17.77 * k)
        : torusNoise2D(noise, qx, qy, wf, 37.13 * k + tf * (0.031 + 0.006 * k), -17.77 * k);
      const wy = p.toroidalField === false
        ? noise.noise2D(qx * wf - 23.41 * k, qy * wf + 29.97 * k - tf * (0.037 + 0.004 * k))
        : torusNoise2D(noise, qx, qy, wf, -23.41 * k, 29.97 * k - tf * (0.037 + 0.004 * k));
      const fold = warp / k;
      qx = wrapUnit(qx + wx * fold + Math.sin((qy + tf * 0.015) * freq * PHI) * 0.012);
      qy = wrapUnit(qy + wy * fold + Math.cos((qx - tf * 0.011) * freq / PHI) * 0.012);
      const n = p.toroidalField === false
        ? noise.noise2D(qx * freq + tf * (0.017 + i * 0.003) + 11.11 * k, qy * freq - tf * 0.019 - 5.31 * k)
        : torusNoise2D(noise, qx, qy, freq, tf * (0.017 + i * 0.003) + 11.11 * k, -tf * 0.019 - 5.31 * k);
      const m = p.toroidalField === false
        ? noise.noise2D((qx + n * 0.08) * freq * PHI - 8.07 * k, (qy - n * 0.06) * freq / PHI + 13.67 * k + tf * 0.012)
        : torusNoise2D(noise, qx + n * 0.08, qy - n * 0.06, freq * PHI, -8.07 * k, 13.67 * k + tf * 0.012);
      const base = 0.5 + 0.5 * (0.72 * n + 0.28 * m);
      const ridge = Math.pow(clamp01(1.0 - Math.abs(n * 0.92 + m * 0.18)), 1.8);
      const curl = p.toroidalField === false
        ? noise.noise2D(qy * freq + 91.7 * k, -qx * freq - 47.1 * k + tf * 0.02)
        : torusNoise2D(noise, qy, -qx, freq, 91.7 * k, -47.1 * k + tf * 0.02);
      baseSum += amp * base;
      ridgeSum += amp * ridge;
      curlSum += amp * curl;
      norm += amp;
      amp *= 0.55;
      freq *= 1.54 + 0.04 * PHI;
      warp *= 0.70;
    }

    const base = clamp01(baseSum / norm);
    const filament = clamp01(ridgeSum / norm);
    const mixed = clamp01(lerp(base, filament, p.filamentMix));
    const cavity = smootherstep(p.threshold, p.threshold + p.edgeSoftness, mixed);
    const atlas = atlasContribution(x, y, state);
    const folded = clamp01(cavity + atlas * p.atlasInfluence * (0.78 - cavity * 0.28));
    const phase = Math.sin(TAU * (base * 0.68 + filament * 0.32) + t * 0.19 + curlSum * 0.4);
    const potential = clamp01(folded * (0.86 + 0.14 * phase));
    const criticalCenter = p.threshold + p.edgeSoftness * 0.5;
    const criticalBand = Math.max(1e-6, p.edgeSoftness * 0.5);
    const edgeDistance = Math.abs(mixed - criticalCenter) / criticalBand;
    const criticality = clamp01(1 - edgeDistance);
    return { base, filament, cavity, atlas, potential, phase, mixed, criticality, edgeDistance };
  }

  function summarizeGrid(grid) {
    const n = grid.width * grid.height;
    let pot = 0, fil = 0, cav = 0;
    for (let i = 0; i < n; i++) {
      pot += grid.potential[i];
      fil += grid.filament[i];
      cav += grid.cavity[i];
    }
    return {
      coherence: pot / n,
      filament: fil / n,
      cavity: cav / n
    };
  }

  function learnFromGrid(grid, state) {
    const p = state.params;
    const w = grid.width;
    const h = grid.height;
    const pot = grid.potential;
    const radiusScale = clamp(Number(grid.radiusScale) || 1, 0.01, 1);
    const fil = grid.filament;
    const cav = grid.cavity;
    const critical = grid.critical;
    const gx = grid.gx;
    const gy = grid.gy;
    const candidates = [];
    const stride = w * h > 30000 ? 2 : 1;

    for (let y = 1; y < h - 1; y += stride) {
      for (let x = 1; x < w - 1; x += stride) {
        const idx = y * w + x;
        const v = pot[idx];
        const crit = critical ? critical[idx] : clamp01(1 - Math.abs((cav[idx] || 0) - 0.5) * 2);
        if (v < p.minAnchorScore && crit < 0.72) continue;
        const n1 = pot[idx - 1], n2 = pot[idx + 1], n3 = pot[idx - w], n4 = pot[idx + w];
        const localMax = v >= n1 && v >= n2 && v >= n3 && v >= n4;
        if (!localMax && v < 0.83) continue;
        const contrast = v - (n1 + n2 + n3 + n4) * 0.25;
        const gradMag = Math.hypot(gx[idx], gy[idx]);
        const boundaryScore = crit * (0.62 + Math.min(1, gradMag * 24) * 0.38) * (0.76 + fil[idx] * 0.24);
        const shelterScore = v * 0.50 + fil[idx] * 0.20 + cav[idx] * 0.12 + Math.max(0, contrast) * 1.4 - gradMag * 0.04;
        const score = Math.max(shelterScore, boundaryScore * 0.92 + v * 0.18);
        if (score < p.minAnchorScore && crit < 0.80) continue;
        const lx = (x / (w - 1)) * 2 - 1;
        const ly = (y / (h - 1)) * 2 - 1;
        const world = typeof grid.toWorld === 'function' ? grid.toWorld(lx, ly) : { x: lx, y: ly };
        candidates.push({
          x: world.x,
          y: world.y,
          score,
          potential: v,
          filament: fil[idx],
          cavity: cav[idx],
          grad: gradMag,
          criticality: crit,
          kind: crit > 0.78 && gradMag > 0.006 ? (fil[idx] > 0.44 ? 'keyhole' : 'wall') : (fil[idx] > cav[idx] ? 'filament' : 'basin')
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const picked = [];
    const pickRadius = 0.075 * Math.max(0.16, radiusScale);
    for (const c of candidates) {
      let ok = true;
      for (const q of picked) {
        if (Math.hypot(wrapDelta(c.x, q.x), wrapDelta(c.y, q.y)) < pickRadius) { ok = false; break; }
      }
      if (ok) picked.push(c);
      if (picked.length >= 36) break;
    }

    if (!state.atlas) state.atlas = { anchors: [], packets: [], ancestry: [], notes: [] };
    const anchors = state.atlas.anchors;
    const lr = clamp(p.learningRate, 0.0001, 0.7);
    let updates = 0, births = 0;
    for (const c of picked) {
      let best = null, bestD = Infinity;
      for (const a of anchors) {
        const d = Math.hypot(wrapDelta(c.x, a.x), wrapDelta(c.y, a.y));
        if (d < bestD) { bestD = d; best = a; }
      }
      if (best && bestD < Math.max(0.025, Math.max(0.06 * radiusScale, best.radius * 0.62))) {
        best.x = wrapLerp(best.x, c.x, lr * 0.55);
        best.y = wrapLerp(best.y, c.y, lr * 0.55);
        best.score = lerp(best.score || 0.5, c.score, lr);
        best.strength = clamp(lerp(best.strength || 0.25, c.score, lr * 0.72) + 0.006, 0.02, 1.5);
        best.radius = clamp(lerp(best.radius || p.atlasRadius * radiusScale, p.atlasRadius * radiusScale * lerp(0.72, 1.22, c.filament), lr * 0.35), 0.008, 0.6);
        best.phase = lerp(best.phase || 0, c.potential * TAU, lr * 0.3);
        best.hits = (best.hits || 0) + 1;
        best.lastSeen = state.epoch;
        best.kind = c.kind;
        best.criticality = c.criticality || best.criticality || 0;
        updates++;
      } else {
        anchors.push({
          id: makeId('anchor', state.seed + ':' + c.x.toFixed(3) + ':' + c.y.toFixed(3)),
          x: c.x,
          y: c.y,
          radius: clamp(p.atlasRadius * radiusScale * lerp(0.7, 1.25, c.filament), 0.008, 0.55),
          strength: clamp(c.score * 0.55, 0.08, 1.0),
          score: c.score,
          phase: c.potential * TAU,
          hits: 1,
          born: state.epoch,
          lastSeen: state.epoch,
          kind: c.kind,
          criticality: c.criticality || 0
        });
        births++;
      }
    }

    for (const a of anchors) {
      const age = Math.max(0, state.epoch - (a.lastSeen || 0));
      a.strength *= age > 12 ? 0.985 : 0.997;
      a.score *= age > 24 ? 0.992 : 0.998;
    }
    state.atlas.anchors = reserveAnchors(anchors, p);

    const summary = summarizeGrid(grid);
    const atlasFitness = state.atlas.anchors.reduce((s, a) => s + (a.score || 0) * (a.strength || 0) * Math.log2(2 + (a.hits || 1)), 0) / Math.max(1, state.atlas.anchors.length);
    state.stats = Object.assign({}, state.stats, summary, {
      atlasFitness,
      anchors: state.atlas.anchors.length,
      packets: state.atlas.packets.length,
      lastLearned: new Date().toISOString(),
      lastBirths: births,
      lastUpdates: updates
    });
    state.epoch += 1;
    return { births, updates, picked: picked.length, summary, atlasFitness };
  }


  function normalizeFACState(fac, state) {
    const out = makeDefaultFACState();
    if (fac && typeof fac === 'object') {
      out.originMedian = Object.assign({}, out.originMedian, fac.originMedian || {});
      out.medians = Array.isArray(fac.medians) ? fac.medians.slice(-96).map((m, i) => normalizeMedianNode(m, i)).filter(Boolean) : [];
      out.suggestions = Array.isArray(fac.suggestions) ? fac.suggestions.slice(-24).map((x, i) => normalizeFACSug(x, i)).filter(Boolean) : [];
      out.outcomes = Array.isArray(fac.outcomes) ? fac.outcomes.slice(-64) : [];
      out.lastObservation = fac.lastObservation && typeof fac.lastObservation === 'object' ? Object.assign({}, fac.lastObservation) : null;
      out.lastScore = clamp(Number(fac.lastScore) || 0, -2, 2);
      out.lastAction = fac.lastAction && typeof fac.lastAction === 'object' ? normalizeFACSug(fac.lastAction, 0) : null;
      out.lastUpdatedCycle = Number.isFinite(fac.lastUpdatedCycle) ? fac.lastUpdatedCycle : -Infinity;
      out.mode = fac.mode || (state && state.params && state.params.facMedianMode) || 'suggestion';
    }
    out.originMedian.id = 'M0';
    out.originMedian.address = 'M0';
    out.originMedian.ratio = out.originMedian.ratio || '1/2';
    out.originMedian.depth = 0;
    return out;
  }

  function normalizeMedianNode(m, i) {
    if (!m || typeof m !== 'object') return null;
    return {
      id: m.id || ('M-' + i.toString(36)),
      parentId: m.parentId || 'M0',
      address: m.address || ('M0/' + (m.ratio || '1/2')),
      ratio: ratioLabel(m.ratio || '1/2'),
      ratioValue: parseRatioValue(m.ratio || m.ratioValue || '1/2'),
      depth: Math.max(0, Math.round(Number(m.depth) || 0)),
      epoch: Math.round(Number(m.epoch) || 0),
      cycle: Math.round(Number(m.cycle) || 0),
      score: clamp(Number(m.score) || 0, -2, 2),
      medianScore: clamp(Number(m.medianScore ?? m.score) || 0, -2, 2),
      action: m.action || null,
      observation: m.observation && typeof m.observation === 'object' ? Object.assign({}, m.observation) : null,
      outcomeScore: Number.isFinite(m.outcomeScore) ? clamp(Number(m.outcomeScore), -2, 2) : undefined,
      children: Array.isArray(m.children) ? m.children.slice(-16) : []
    };
  }

  function normalizeFACSug(sug, i) {
    if (!sug || typeof sug !== 'object') return null;
    const action = String(sug.action || sug.actionId || 'seek_median');
    return {
      id: sug.id || ('fac-suggestion-' + i.toString(36)),
      action,
      actionId: action,
      confidence: clamp(Number(sug.confidence) || 0, 0, 1),
      targetMedian: sug.targetMedian || 'M0',
      ratio: ratioLabel(sug.ratio || '1/2'),
      mode: sug.mode || 'suggestion',
      params: sug.params && typeof sug.params === 'object' ? Object.assign({}, sug.params) : {},
      stopCondition: sug.stopCondition || 'score does not improve',
      reason: sug.reason || '',
      cycle: Math.round(Number(sug.cycle) || 0),
      epoch: Math.round(Number(sug.epoch) || 0)
    };
  }

  function ensureFACState(state) {
    if (!state.fac || typeof state.fac !== 'object') state.fac = makeDefaultFACState();
    state.fac = normalizeFACState(state.fac, state);
    return state.fac;
  }

  function summarizeMedianObservation(state) {
    const stats = state.stats || {};
    const p = state.params || {};
    const gauge = summarizeGaugeAtlas(state);
    const statuses = gauge.statuses || {};
    const n = Math.max(1, Number(gauge.seedlets || 0));
    const h = state.horizon || {};
    const b = state.superbasin || {};
    const anchors = ((state.atlas && state.atlas.anchors) || []).length;
    const shells = (h.shells || []);
    const scarDepthMean = shells.reduce((sum, sh) => sum + (Number(sh.scarDepth) || 0), 0) / Math.max(1, shells.length);
    const scarPermeabilityMean = shells.reduce((sum, sh) => sum + (Number(sh.scarPermeability) || 0), 0) / Math.max(1, shells.length);
    return {
      coherence: Number(stats.coherence) || 0,
      filament: Number(stats.filament) || 0,
      cavity: Number(stats.cavity) || 0,
      atlasFitness: Number(stats.atlasFitness) || 0,
      anchors,
      seedlets: n,
      resonantRatio: Number(statuses.resonant || 0) / n,
      trainingRatio: Number(statuses.training || 0) / n,
      stagnantRatio: Number(statuses.stagnant || 0) / n,
      horizonBoundRatio: Number(statuses['horizon-bound'] || 0) / n,
      hibernatingRatio: Number(statuses.hibernating || 0) / n,
      criticalMean: Number(gauge.criticalMean) || 0,
      resonanceMean: Number(gauge.resonanceMean) || 0,
      productivityMean: Number(gauge.productivityMean) || 0,
      compactness: Number(h.lastCompactness) || 0,
      coupling: Number(h.lastCoupling ?? 1),
      shells: shells.length,
      releases: Number(h.releases) || 0,
      scarDepthMean,
      scarPermeabilityMean,
      protoAttraction: Number(h.lastProtoAttraction || b.protoAttraction || 0.5),
      topHitShare: Number(b.topHitShare) || 0,
      rimScars: (b.rimScars || []).length,
      horizonCandidates: (b.horizonCandidates || []).length,
      learnDuty: Number(p.learnDuty) || 0.2,
      learningRate: Number(p.learningRate) || 0.0001
    };
  }

  function scoreFACMedian(obs) {
    const coherenceBalance = clamp01(1 - Math.abs((obs.coherence || 0) - 0.55) / 0.55);
    const filamentBalance = clamp01(1 - Math.abs((obs.filament || 0) - 0.50) / 0.50);
    const cavityStability = clamp01(1 - Math.abs((obs.cavity || 0) - 0.08) / 0.30);
    const seedletHealth = clamp01((obs.resonantRatio || 0) * 0.75 + (obs.trainingRatio || 0) * 0.45 + (obs.productivityMean || 0) * 0.40 - (obs.stagnantRatio || 0) * 0.24);
    const scarUsefulness = clamp01((obs.scarPermeabilityMean || 0) * 1.4 + Math.min(1, (obs.scarDepthMean || 0) * 4.5) * 0.35 + Math.min(1, (obs.rimScars || 0) / 24) * 0.25);
    const nurseryBreath = clamp01(1 - Math.max(0, (obs.horizonBoundRatio || 0) - 0.28) / 0.72);
    const atlasTerm = clamp01(Math.tanh(Math.max(0, obs.atlasFitness || 0) / 4));
    const closureTerm = clamp01((obs.criticalMean || 0) * 0.36 + (obs.resonanceMean || 0) * 0.34 + Math.min(1, (obs.horizonCandidates || 0) / 8) * 0.12 + Math.min(1, (obs.shells || 0) / 12) * 0.18);
    const overcollapsePenalty = clamp01(Math.max(0, (obs.cavity || 0) - 0.32) * 2.2 + Math.max(0, (obs.compactness || 0) - 0.86) * 1.2);
    const frozenPenalty = clamp01(((obs.learningRate || 0) <= 0.00015 ? 0.12 : 0) + Math.max(0, 0.08 - (obs.coherence || 0)) * 1.4);
    const score = coherenceBalance * 0.20 + filamentBalance * 0.10 + cavityStability * 0.15 + seedletHealth * 0.17 + scarUsefulness * 0.11 + nurseryBreath * 0.11 + atlasTerm * 0.09 + closureTerm * 0.07 - overcollapsePenalty * 0.16 - frozenPenalty;
    return clamp(score, -1, 1);
  }

  function chooseFACRatio(obs, ratios) {
    if ((obs.compactness || 0) > 0.72 || (obs.cavity || 0) > 0.22) return '2/3';
    if ((obs.horizonBoundRatio || 0) > 0.28) return '3/5';
    if ((obs.coherence || 0) < 0.24) return '1/3';
    if ((obs.resonanceMean || 0) > 0.62 && (obs.productivityMean || 0) > 0.04) return '5/8';
    if ((obs.filament || 0) > 0.58 && (obs.cavity || 0) < 0.08) return '1/4';
    return ratios.includes('1/2') ? '1/2' : ratios[0] || '1/2';
  }

  function chooseFACAction(obs, score, ratios) {
    let action = 'seek_median';
    let reason = 'rebalance around the current recursive median';
    let strength = 0.14;
    if ((obs.horizonBoundRatio || 0) > 0.36) { action = 'reheat_nursery'; reason = 'horizon-bound occupancy above breathing band'; strength = 0.22; }
    else if ((obs.compactness || 0) > 0.74 && (obs.coupling || 1) < 0.32) { action = 'seal_horizon'; reason = 'compactness crossed horizon band with low outward coupling'; strength = 0.18; }
    else if ((obs.compactness || 0) > 0.62 || (obs.rimScars || 0) > 8) { action = 'scar_and_stabilize'; reason = 'rim/scar memory is the current median boundary'; strength = 0.16; }
    else if ((obs.resonanceMean || 0) > 0.58 && (obs.productivityMean || 0) > 0.035) { action = 'promote_seedlets'; reason = 'seedlet resonance/productivity is high enough to test promotion'; strength = 0.15; }
    else if ((obs.filament || 0) > 0.55 && (obs.cavity || 0) < 0.08) { action = 'tighten_shell'; reason = 'filaments are strong but cavity pressure is too open'; strength = 0.12; }
    else if ((obs.anchors || 0) > 64 && (obs.topHitShare || 0) < 0.24 && (obs.coherence || 0) > 0.45) { action = 'dig_down'; reason = 'broad balanced atlas can support a within-median probe'; strength = 0.13; }
    else if ((obs.compactness || 0) > 0.56 && (obs.protoAttraction || 0.5) > 0.54) { action = 'wrap_edge'; reason = 'approach band favors chart-rollover inspection'; strength = 0.14; }
    const ratio = chooseFACRatio(obs, ratios);
    const confidence = clamp01(0.34 + Math.abs(score) * 0.42 + Math.min(0.22, (obs.atlasFitness || 0) / 24) + Math.min(0.12, (obs.resonanceMean || 0) * 0.12));
    return { action, actionId: action, ratio, confidence, strength, reason };
  }

  function buildMedianAddress(parent, ratio) {
    const base = parent && parent.address ? parent.address : 'M0';
    return base + '/' + ratio;
  }

  function updateFACMedian(state, opts) {
    const p = state.params || {};
    const fac = ensureFACState(state);
    fac.mode = p.facMedianMode || 'suggestion';
    if (p.facMedianEnabled === false) return fac;
    const force = !!(opts && opts.force);
    const interval = Math.max(1, Math.round(Number(p.facMedianUpdateIntervalCycles) || 90));
    if (!force && Number.isFinite(fac.lastUpdatedCycle) && state.cycle - fac.lastUpdatedCycle < interval) return fac;
    const obs = summarizeMedianObservation(state);
    const score = scoreFACMedian(obs);
    const ratios = parseMedianRatios(p.facMedianRatios);
    const action = chooseFACAction(obs, score, ratios);
    const best = fac.medians.slice().sort((a, b) => (b.medianScore || b.score || 0) - (a.medianScore || a.score || 0))[0] || fac.originMedian;
    const depth = Math.min(Math.max(1, Math.round(Number(best.depth || 0) + 1)), Math.max(1, Math.round(Number(p.facMedianTreeDepth) || 7)));
    const parent = depth >= (Number(p.facMedianTreeDepth) || 7) ? fac.originMedian : best;
    const targetAddress = buildMedianAddress(parent, action.ratio);
    const suggestion = normalizeFACSug({
      id: makeId('fac', state.id + ':' + state.cycle + ':' + action.action),
      action: action.action,
      actionId: action.action,
      confidence: action.confidence,
      targetMedian: targetAddress,
      ratio: action.ratio,
      mode: fac.mode,
      params: {
        strength: Number(action.strength.toFixed(4)),
        durationCycles: Math.round(160 + action.confidence * 360),
        medianScore: Number(score.toFixed(5)),
        ratioValue: Number(parseRatioValue(action.ratio).toFixed(5))
      },
      stopCondition: `medianScore improves by ${Number(p.facMedianScoreThreshold || 0.04).toFixed(3)} or cavity/overcapture leaves safe band`,
      reason: action.reason,
      cycle: state.cycle,
      epoch: state.epoch
    }, 0);
    const prev = Number(fac.lastScore || 0);
    const threshold = Number(p.facMedianScoreThreshold) || 0.04;
    const improved = score >= prev + threshold || fac.medians.length === 0 || force;
    if (improved) {
      const node = normalizeMedianNode({
        id: 'M' + Math.max(1, fac.medians.length + 1).toString(36),
        parentId: parent.id || 'M0',
        address: targetAddress,
        ratio: action.ratio,
        depth,
        epoch: state.epoch,
        cycle: state.cycle,
        score,
        medianScore: score,
        action: action.action,
        observation: obs,
        outcomeScore: score
      }, fac.medians.length);
      fac.medians.push(node);
      fac.medians = fac.medians.slice(-96);
    }
    fac.lastObservation = obs;
    fac.lastScore = score;
    fac.lastAction = suggestion;
    fac.suggestions.push(suggestion);
    fac.suggestions = fac.suggestions.slice(-24);
    fac.lastUpdatedCycle = state.cycle;
    if (state.stats) {
      state.stats.facMedianScore = score;
      state.stats.facMedianAction = suggestion.action;
      state.stats.facMedianAddress = suggestion.targetMedian;
    }
    return fac;
  }

  function emitPacket(state) {
    if (state && state.params && state.params.facMedianEnabled !== false) updateFACMedian(state, { force: true });
    const allAnchors = (state.atlas && state.atlas.anchors || []).slice();
    const seedletsAll = (state.atlas && state.atlas.seedlets || []).slice().sort((a, b) => seedletRank(b) - seedletRank(a));
    const driver = state.driver || {};
    const portalsAll = Array.isArray(driver.portals) ? driver.portals.slice().sort((a, b) => ((b.score || 0) * (b.stability || 0)) - ((a.score || 0) * (a.stability || 0))) : [];
    const parentLimit = Math.max(8, Math.round(24 * 0.40));
    const seedletLimit = Math.min(seedletsAll.length, Math.max(16, Math.round(Number(state.params && state.params.seedletPacketLimit) || 64)));
    const portalLimit = Math.min(portalsAll.length, Math.max(4, Math.round(24 * 0.20)));
    const anchors = allAnchors.sort((a, b) => anchorRank(b) - anchorRank(a)).slice(0, parentLimit).map(a => ({
      x: Number(a.x.toFixed(5)),
      y: Number(a.y.toFixed(5)),
      r: Number(a.radius.toFixed(5)),
      s: Number(a.strength.toFixed(5)),
      q: Number(a.score.toFixed(5)),
      k: a.kind,
      h: a.hits,
      c: Number((a.criticality || 0).toFixed(5))
    }));
    const seedlets = seedletsAll.slice(0, seedletLimit).map(s => ({
      id: s.id,
      d: s.depth,
      r: Number(((s.scaleRatio || 0)).toFixed(8)),
      a: s.parentAnchorId || null,
      q: Number(((s.score || 0)).toFixed(5)),
      c: Number(((s.criticality || 0)).toFixed(5)),
      res: Number(((s.resonance || 0)).toFixed(5)),
      prod: Number(((s.productivity || 0)).toFixed(5)),
      e: Number(((s.energy || 0)).toFixed(5)),
      tdRaw: Number(((s.timeDilationRaw || (1 / Math.max(1e-9, s.scaleRatio || 1)))).toFixed(5)),
      td: Number(((s.timeDilationApplied ?? s.timeDilation ?? 1)).toFixed(5)),
      bleed: s.gauge ? {
        ph: Number((s.gauge.macroPhase || 0).toFixed(5)),
        gx: Number((s.gauge.macroGradientX || 0).toFixed(5)),
        gy: Number((s.gauge.macroGradientY || 0).toFixed(5)),
        p: Number((s.gauge.macroPotential || 0).toFixed(5))
      } : null,
      status: s.status || 'dormant'
    }));
    const portals = portalsAll.slice(0, portalLimit).map(p => ({
      id: p.id,
      from: p.fromAnchorId || null,
      d: p.depth || (p.toAddress && p.toAddress.foldLevel) || 0,
      q: Number((p.score || 0).toFixed(5)),
      stability: Number((p.stability || 0).toFixed(5)),
      td: p.toAddress ? Number(((p.toAddress.timeDilationApplied ?? p.toAddress.timeDilation ?? 1)).toFixed(5)) : 1
    }));
    const liveStatusCounts = seedletStatusCounts(state);
    const liveHorizonBound = Number(liveStatusCounts['horizon-bound'] || 0);
    if (state.stats) {
      state.stats.seedlets = ((state.atlas && state.atlas.seedlets) || []).length;
      state.stats.seedletStatuses = Object.assign({}, liveStatusCounts);
    }
    if (state.horizon && state.params && state.params.horizonBoundStatusAccounting !== false) {
      state.horizon.horizonBoundSeedlets = liveHorizonBound;
    }
    const packet = {
      type: 'omegaseed.livingword.packet',
      version: VERSION,
      id: makeId('packet', state.id + ':' + state.epoch),
      parent: state.id,
      seed: state.seed,
      epoch: state.epoch,
      time: Number(state.time.toFixed(6)),
      created: new Date().toISOString(),
      stats: Object.assign({}, state.stats, { seedletStatuses: liveStatusCounts, seedlets: ((state.atlas && state.atlas.seedlets) || []).length }),
      params: Object.assign({}, state.params),
      anchors,
      seedlets,
      portals,
      gaugeAtlas: summarizeGaugeAtlas(state),
      annealing: state.driver && state.driver.annealing ? Object.assign({}, state.driver.annealing) : null,
      horizon: state.horizon ? { shells: (state.horizon.shells || []).length, releases: state.horizon.releases || 0, lastCompactness: Number((state.horizon.lastCompactness || 0).toFixed(5)), lastCoupling: Number((state.horizon.lastCoupling || 0).toFixed(5)), lastProtoAttraction: Number((state.horizon.lastProtoAttraction || 0.5).toFixed(5)), lastCapture: Number((state.horizon.lastCapture || 0).toFixed(5)), lastEscape: Number((state.horizon.lastEscape || 0).toFixed(5)), horizonBoundSeedlets: liveHorizonBound, mode: state.horizon.mode || 'open-field' } : null,
      superbasin: state.superbasin ? { dominantAnchorId: state.superbasin.dominantAnchorId || null, protoAttraction: Number((state.superbasin.protoAttraction || 0.5).toFixed(5)), topHitShare: Number((state.superbasin.topHitShare || 0).toFixed(5)), overlock: Number((state.superbasin.overlock || 0).toFixed(5)), diversityPressure: Number((state.superbasin.diversityPressure || 0).toFixed(5)), rimScars: (state.superbasin.rimScars || []).length, horizonCandidates: (state.superbasin.horizonCandidates || []).length, splits: state.superbasin.splits || 0, mode: state.superbasin.mode || 'baby-curriculum' } : null,
      fac: state.fac ? { score: Number((state.fac.lastScore || 0).toFixed(5)), medians: (state.fac.medians || []).length, mode: state.fac.mode || 'suggestion', action: state.fac.lastAction ? state.fac.lastAction.action : null, targetMedian: state.fac.lastAction ? state.fac.lastAction.targetMedian : 'M0', confidence: state.fac.lastAction ? Number((state.fac.lastAction.confidence || 0).toFixed(5)) : 0, ratio: state.fac.lastAction ? state.fac.lastAction.ratio : '1/2' } : null,
      packetMix: { parentAnchors: anchors.length, seedlets: seedlets.length, portals: portals.length, intent: '40/40/20 parent-child-portal memory blend' }
    };
    state.atlas.packets.push(packet);
    state.atlas.packets = state.atlas.packets.slice(-24);
    state.stats.packets = state.atlas.packets.length;
    state.stats.seedlets = (state.atlas.seedlets || []).length;
    return packet;
  }

  function serializeState(state) {
    const copy = JSON.parse(JSON.stringify(state));
    copy.version = VERSION;
    return copy;
  }

  function makeBootstrapSave() {
    const state = makeDefaultState('omegaseed-bootstrap');
    state.epoch = 3;
    state.atlas.anchors = [
      { id: 'boot-a', x: -0.34, y: -0.08, radius: 0.18, strength: 0.44, score: 0.72, phase: 0.7, hits: 4, born: 0, lastSeen: 3, kind: 'basin' },
      { id: 'boot-b', x: 0.12, y: 0.24, radius: 0.22, strength: 0.39, score: 0.69, phase: 2.1, hits: 3, born: 1, lastSeen: 3, kind: 'filament' },
      { id: 'boot-c', x: 0.47, y: -0.31, radius: 0.16, strength: 0.33, score: 0.64, phase: 4.8, hits: 2, born: 1, lastSeen: 2, kind: 'basin' }
    ];
    state.stats.anchors = state.atlas.anchors.length;
    updateFACMedian(state, { force: true });
    state.atlas.notes.push('Bootstrap anchors are deliberately weak; they prove save/import carry-over without freezing emergence.');
    return state;
  }

  return {
    VERSION, SAVE_KEY, PI, TAU, PHI,
    clamp, clamp01, lerp, smoothstep, smootherstep, wrapUnit, wrapDelta, wrapLerp, wrapMidpoint, torusDistance,
    hashString, mulberry32, SimplexNoise2D,
    makeDefaultState, migrateSave, buildRuntime, sampleRawField,
    summarizeGrid, learnFromGrid, emitPacket, serializeState, makeBootstrapSave, reserveAnchors, summarizeGaugeAtlas, seedletStatusCounts, seedletRank, makeDefaultFACState, ensureFACState, summarizeMedianObservation, scoreFACMedian, updateFACMedian
  };
});
