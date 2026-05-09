/*
  OmegaSeed Driver
  Autonomous bounded governor for critical-line seeking, recursive split probes,
  and observer guidance. The driver mutates only parameters/data inside clamps;
  it never rewrites executable code.
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const Core = require('./omegaseed-core.js');
    const Memory = require('./omegaseed-memory.js');
    let Seedlets = null;
    try { Seedlets = require('./omegaseed-seedlet.js'); } catch (err) { Seedlets = null; }
    module.exports = factory(Core, Memory, Seedlets);
  } else {
    root.OmegaSeedDriver = factory(root.OmegaSeedCore, root.OmegaSeedMemory, root.OmegaSeedSeedlets);
  }
})(typeof self !== 'undefined' ? self : this, function (Core, Memory, Seedlets) {
  'use strict';

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function clamp01(v) { return clamp(v, 0, 1); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function wrapUnit(v) { return Core.wrapUnit(v); }
  function wrapDelta(a, b) { return Core.wrapDelta(a, b); }
  function wrapLerp(a, b, t) { return Core.wrapLerp ? Core.wrapLerp(a, b, t) : wrapUnit(a + wrapDelta(b, a) * clamp01(t)); }
  function nowEpoch(state) { return Number(state && state.epoch) || 0; }

  function portalSourceKey(p) {
    return String((p && (p.fromAnchorId || p.anchorId || p.sourceAnchorId)) || 'unknown');
  }

  function portalAddressKey(p) {
    const a = p && (p.toAddress || p.address || {});
    const x = Math.round((Number(a.originX) || 0) / 0.018);
    const y = Math.round((Number(a.originY) || 0) / 0.018);
    const sc = Math.round(Math.log2(Math.max(0.002, Number(a.scale) || 0.08)) * 5);
    const f = Math.round(Number(a.foldLevel || p.depth || 0));
    return `${portalSourceKey(p)}:${x}:${y}:${sc}:${f}`;
  }

  function normalizePortals(state) {
    const driver = state.driver || {};
    const params = state.params || {};
    const maxPortals = Math.max(8, Math.min(512, Math.round(params.maxPortals || 96)));
    const diversity = clamp01(Number(params.portalDiversity) || 0.55);
    const uniqueQuota = Math.max(4, Math.min(maxPortals, Math.round(Number(params.portalUniqueSourceQuota) || 24)));
    const maxSourceShare = lerp(0.58, 0.14, diversity);
    const maxPerSource = Math.max(2, Math.ceil(maxPortals * maxSourceShare));
    const sorted = (Array.isArray(driver.portals) ? driver.portals : [])
      .filter(p => p && p.toAddress)
      .sort((a, b) => ((b.score || 0) * (b.stability || 1)) - ((a.score || 0) * (a.stability || 1)));

    const seenAddress = new Set();
    const deduped = [];
    for (const p of sorted) {
      const key = portalAddressKey(p);
      if (seenAddress.has(key)) continue;
      seenAddress.add(key);
      p.fromAnchorId = p.fromAnchorId || p.anchorId || p.sourceAnchorId || null;
      p.portalKey = key;
      p.sourceKey = portalSourceKey(p);
      p.diversityScore = Number((((p.score || 0) * (p.stability || 1)) / (1 + (p.useCount || 0) * 0.06)).toFixed(5));
      deduped.push(p);
    }

    const selected = [];
    const sourceCounts = new Map();
    const usedSources = new Set();
    const canAdd = p => {
      const src = portalSourceKey(p);
      return (sourceCounts.get(src) || 0) < maxPerSource;
    };
    const add = p => {
      if (!p || selected.includes(p) || !canAdd(p)) return false;
      selected.push(p);
      const src = portalSourceKey(p);
      sourceCounts.set(src, (sourceCounts.get(src) || 0) + 1);
      usedSources.add(src);
      return true;
    };

    // First pass: one good portal per source until the unique-source quota is met or exhausted.
    for (const p of deduped) {
      if (selected.length >= maxPortals || usedSources.size >= uniqueQuota) break;
      const src = portalSourceKey(p);
      if (!usedSources.has(src)) add(p);
    }
    // Second pass: fill by score, but enforce source-share pressure.
    for (const p of deduped) {
      if (selected.length >= maxPortals) break;
      add(p);
    }
    driver.portals = selected;
    driver.portalDiversityStats = {
      uniqueSources: usedSources.size,
      maxPerSource,
      uniqueQuota,
      deduped: deduped.length,
      total: selected.length,
      diversity: Number(diversity.toFixed(3))
    };
    return driver.portals;
  }

  function ensureDriverState(state) {
    if (!state.driver) {
      state.driver = {
        enabled: true,
        generation: 0,
        mode: 'auto',
        activeAnchorId: null,
        activeAddress: null,
        phase: 'seek-critical-line',
        splitDepth: 0,
        splitProbes: [],
        portals: [],
        scars: [],
        history: [],
        annealing: {
          enabled: true,
          temperature: 0.42,
          learningRate: 0.22,
          stabilityStreak: 0,
          boredom: 0,
          maturity: 0,
          reheatCount: 0,
          lastReheatEpoch: null,
          state: 'warm-start',
          lastSuccess: 0,
          lastJolt: null,
          childTemperature: 0.42,
          childBudgetMultiplier: 1,
          nurseryState: 'warm-start'
        }
      };
    }
    if (!Array.isArray(state.driver.splitProbes)) state.driver.splitProbes = [];
    if (!Array.isArray(state.driver.portals)) state.driver.portals = [];
    if (!Array.isArray(state.driver.scars)) state.driver.scars = [];
    if (!Array.isArray(state.driver.history)) state.driver.history = [];
    if (!state.driver.annealing) {
      state.driver.annealing = {
        enabled: true, temperature: 0.42, learningRate: Number(state.params && state.params.learningRate) || 0.22,
        stabilityStreak: 0, boredom: 0, maturity: 0, reheatCount: 0, lastReheatEpoch: null,
        state: 'warm-start', lastSuccess: 0, lastJolt: null,
        childTemperature: 0.42, childBudgetMultiplier: 1, nurseryState: 'warm-start'
      };
    }
    normalizePortals(state);
    return state.driver;
  }

  function anchorValue(a) {
    const c = Number(a.criticality || a.c || 0);
    const hits = Math.log2(2 + Number(a.hits || a.h || 0));
    const kindBoost = a.kind === 'keyhole' || a.k === 'keyhole' ? 1.85 : (a.kind === 'filament' || a.k === 'filament' ? 1.35 : 1.0);
    const score = Number(a.score || a.q || 0.5);
    const strength = Number(a.strength || a.s || 0.5);
    return kindBoost * (0.55 * c + 0.20 * score + 0.15 * strength + 0.10 * Math.min(1, hits / 14));
  }

  function summarizeAtlas(state) {
    const anchors = (state.atlas && state.atlas.anchors || []);
    const out = {
      total: anchors.length,
      kinds: {},
      criticalMean: 0,
      criticalMax: 0,
      keyholeCount: 0,
      filamentCount: 0,
      basinCount: 0,
      corridorCount: 0,
      corridorMean: 0,
      corridorMass: 0,
      topCritical: null,
      topDriver: null,
      criticalMass: 0
    };
    if (!anchors.length) return out;
    let critSum = 0;
    let corridorCritSum = 0;
    for (const a of anchors) {
      const kind = a.kind || a.k || 'basin';
      out.kinds[kind] = (out.kinds[kind] || 0) + 1;
      const c = Number(a.criticality || a.c || 0);
      if (kind === 'keyhole') out.keyholeCount++;
      if (kind === 'filament') out.filamentCount++;
      if (kind === 'basin') out.basinCount++;
      const isCorridor = kind === 'keyhole' || (kind === 'filament' && c >= 0.48);
      if (isCorridor) {
        out.corridorCount++;
        corridorCritSum += c;
        out.corridorMass += Math.log2(2 + Number(a.hits || a.h || 1)) * (0.55 + c);
      }
      critSum += c;
      if (c > out.criticalMax) out.criticalMax = c;
      if (!out.topCritical || c > Number(out.topCritical.criticality || 0)) out.topCritical = a;
      if (!out.topDriver || anchorValue(a) > anchorValue(out.topDriver)) out.topDriver = a;
      if (c >= 0.72) out.criticalMass += Math.log2(2 + Number(a.hits || 1));
    }
    out.criticalMean = critSum / anchors.length;
    out.corridorMean = out.corridorCount ? corridorCritSum / out.corridorCount : 0;
    return out;
  }

  function criticalTarget(state) {
    // The running field can drift, but this keeps the driver looking for the
    // event horizon: not zero, not saturation, close to the 1/2 splitting line.
    const p = state.params || {};
    const smoothCenter = (Number(p.threshold) || 0.44) + (Number(p.edgeSoftness) || 0.41) * 0.5;
    const observed = state.stats && Number.isFinite(state.stats.filament) ? state.stats.filament : 0.5;
    return clamp(lerp(0.5, observed, 0.55) * 0.66 + smoothCenter * 0.34, 0.42, 0.68);
  }


  function seedletSignals(state) {
    const seedlets = state && state.atlas && Array.isArray(state.atlas.seedlets) ? state.atlas.seedlets : [];
    const out = {
      total: seedlets.length,
      resonant: 0, reproductive: 0, training: 0, stagnant: 0, stable: 0, dormant: 0,
      hibernating: 0, collapsed: 0, scar: 0, horizonBound: 0,
      resonanceMean: 0, productivityMean: 0, energyMean: 0,
      activeFraction: 0, stagnantFraction: 0, collapseFraction: 0, hibernatingFraction: 0,
      livingFraction: 0
    };
    if (!seedlets.length) return out;
    for (const s of seedlets) {
      const status = s.status || 'stable';
      if (status === 'horizon-bound') out.horizonBound++;
      else if (out[status] !== undefined) out[status]++;
      out.resonanceMean += Number(s.resonance || s.res || 0);
      out.productivityMean += Number(s.productivity || s.prod || 0);
      out.energyMean += Number(s.energy || s.e || 0);
    }
    out.resonanceMean /= seedlets.length;
    out.productivityMean /= seedlets.length;
    out.energyMean /= seedlets.length;
    out.activeFraction = (out.resonant + out.reproductive + out.training) / seedlets.length;
    out.stagnantFraction = out.stagnant / seedlets.length;
    out.collapseFraction = (out.collapsed + out.scar) / seedlets.length;
    out.hibernatingFraction = out.hibernating / seedlets.length;
    out.horizonBoundFraction = out.horizonBound / seedlets.length;
    out.livingFraction = 1 - out.collapseFraction;
    return out;
  }


  function updateChildThermostat(state, anneal, seed, stable, lost) {
    const p = state.params || {};
    const collapseTrigger = Number(p.seedletCollapseReheatFraction) || 0.22;
    const minActive = Number(p.seedletNurseryMinActive) || 0.16;
    const starving = seed.total > 0 && (seed.collapseFraction >= collapseTrigger || (seed.activeFraction < minActive && seed.livingFraction < 0.82));
    const fertile = seed.total > 0 && seed.activeFraction >= minActive && seed.resonanceMean >= 0.42 && seed.collapseFraction < collapseTrigger * 0.45;
    if (starving) {
      anneal.childTemperature = clamp(Math.max(Number(anneal.childTemperature) || 0, 0.72 + seed.collapseFraction * 0.28), 0, 1);
      anneal.childBudgetMultiplier = Math.max(2, Math.min(Number(p.seedletNurseryBudgetBoost) || 8, 4 + Math.round(seed.collapseFraction * 12)));
      anneal.nurseryState = 'nursery-rescue';
      // Do not let a frozen parent continue starving the child layer. This is
      // not a full parent reheat; it is a low-amplitude metabolic pulse.
      anneal.temperature = clamp(Math.max(Number(anneal.temperature) || 0, 0.075 + seed.collapseFraction * 0.08), 0, 0.32);
      anneal.boredom = Math.max(0, Math.floor((anneal.boredom || 0) * 0.5));
    } else if (fertile && stable && !lost) {
      anneal.childTemperature = clamp((Number(anneal.childTemperature) || 0.35) * 0.93, 0.08, 1);
      anneal.childBudgetMultiplier = Math.max(1, Math.round((Number(anneal.childBudgetMultiplier) || 1) * 0.88));
      anneal.nurseryState = anneal.childTemperature <= 0.12 ? 'nursery-cruise' : 'nursery-cooling';
    } else {
      const target = seed.total ? (0.18 + (1 - seed.livingFraction) * 0.55 + (1 - seed.activeFraction) * 0.12) : 0.24;
      anneal.childTemperature = clamp(lerp(Number(anneal.childTemperature) || 0.35, target, 0.09), 0.08, 1);
      anneal.childBudgetMultiplier = Math.max(1, Math.round(1 + anneal.childTemperature * 3));
      anneal.nurseryState = 'nursery-tempered';
    }
  }

  function annealingSuccessScore(state, summary) {
    const fil = Number(state.stats && state.stats.filament) || 0.5;
    const cav = Number(state.stats && state.stats.cavity) || 0;
    const filamentLock = clamp01(1 - Math.abs(fil - 0.5) / 0.10);
    const cavityLive = clamp01(1 - Math.abs(cav - 0.22) / 0.34);
    // A mature run may convert doors into corridors. 0.4.3 overheated because
    // it demanded literal keyholes even after the atlas stabilized into
    // filaments. Treat high-critical filaments as valid computational doors.
    const corridorCount = Number(summary.corridorCount || 0);
    const corridorScore = clamp01(corridorCount / Math.max(1, Number(state.params && state.params.annealingCorridorMin) || 6));
    const corridorQuality = clamp01(summary.corridorMean || summary.criticalMax || 0);
    const keyholeMass = clamp01((summary.keyholeCount || 0) / 16);
    const criticalPeak = clamp01(Number(summary.criticalMax || 0));
    const seed = seedletSignals(state);
    const seedletResonance = clamp01(seed.resonanceMean || 0);
    const activeChildren = clamp01(seed.activeFraction || 0);
    const stagnationDrag = clamp01((seed.stagnantFraction || 0) * 0.35);
    return clamp01(
      filamentLock * 0.26 +
      corridorScore * 0.22 +
      corridorQuality * 0.16 +
      criticalPeak * 0.13 +
      seedletResonance * 0.11 +
      activeChildren * 0.05 +
      cavityLive * 0.05 +
      keyholeMass * 0.04 -
      stagnationDrag
    );
  }

  function boundedJolt(state, anneal) {
    const p = state.params || {};
    const epoch = nowEpoch(state);
    const names = ['threshold', 'edgeSoftness', 'flow', 'swirl', 'atlasInfluence', 'warpStrength', 'gravity'];
    const idx = Math.abs(Core.hashString(String(state.seed) + ':jolt:' + epoch + ':' + (anneal.reheatCount || 0))) % names.length;
    const name = names[idx];
    const sign = (Core.hashString(name + ':' + epoch) & 1) ? 1 : -1;
    const before = Number(p[name]) || 0;
    const span = name === 'flow' ? 0.18 : name === 'swirl' ? 0.16 : name === 'atlasInfluence' ? 0.12 : name === 'gravity' ? 0.08 : 0.035;
    const bounds = {
      threshold: [0.30, 0.62], edgeSoftness: [0.18, 0.62], flow: [1.0, 2.8], swirl: [0.15, 1.8],
      atlasInfluence: [0.02, 0.95], warpStrength: [0.05, 0.85], gravity: [0.32, 0.92]
    }[name] || [0, 2];
    const after = clamp(before + sign * span, bounds[0], bounds[1]);
    p[name] = Number(after.toFixed(5));
    anneal.lastJolt = { epoch, name, before, after: p[name], sign };
    return anneal.lastJolt;
  }

  function updateAnnealing(state, summary) {
    const driver = ensureDriverState(state);
    const p = state.params || {};
    const a = driver.annealing;
    a.enabled = p.annealingEnabled !== false;
    if (!a.enabled) {
      a.temperature = clamp01(Number(a.temperature) || 0.35);
      a.learningRate = clamp(Number(p.learningRate) || 0.22, 0.0001, 0.7);
      return { annealing: a, success: 0, hot: false, stable: false, jolt: null };
    }

    const minLR = Number(p.annealingMinLearningRate) || 0.0001;
    const maxLR = Number(p.annealingMaxLearningRate) || 0.50;
    const cooling = Number(p.annealingCoolingRate) || 0.95;
    const boredomLimit = Math.max(20, Math.round(Number(p.annealingBoredomLimit) || 1000));
    const stableTarget = Number(p.annealingStabilityCriticality) || 0.88;
    const fil = Number(state.stats && state.stats.filament) || 0.5;
    const keyholes = summary.keyholeCount || 0;
    const corridors = summary.corridorCount || 0;
    const success = annealingSuccessScore(state, summary);
    const corridorMin = Math.max(1, Math.round(Number(p.annealingCorridorMin) || 6));
    const corridorFloor = Number(p.annealingCorridorCriticality) || 0.48;
    const seed = seedletSignals(state);
    const seamDistance = Math.abs(fil - 0.5);
    const seamLost = seamDistance > 0.14;
    const lost = seamLost || (summary.criticalMax < 0.50 && corridors < 2) || (corridors < 1 && keyholes < 1);
    const corridorStable = seamDistance < 0.095 && corridors >= corridorMin && (summary.corridorMean >= corridorFloor || summary.criticalMax >= 0.62);
    const stable = corridorStable && (success >= Math.min(stableTarget, 0.60) || (seed.resonanceMean || 0) > 0.22 || corridors >= corridorMin * 2);
    let jolt = null;

    if (lost) {
      a.temperature = clamp(Math.max(a.temperature * 1.28, 0.42), 0.0, 1.0);
      a.stabilityStreak = 0;
      a.boredom = Math.max(0, Math.floor((a.boredom || 0) * 0.35));
      a.state = 'heated-search';
    } else if (stable) {
      a.stabilityStreak = (a.stabilityStreak || 0) + 1;
      const fastQuench = Number(p.annealingFastQuench) || 0.42;
      const coolFactor = a.temperature > 0.55 ? Math.min(cooling, fastQuench) : cooling;
      const quenchCeiling = 0.24 + (1 - success) * 0.22;
      a.temperature = clamp(Math.min(a.temperature * coolFactor, quenchCeiling), 0.0, 1.0);
      a.boredom = (a.boredom || 0) + 1;
      a.state = a.temperature <= (Number(p.annealingBaselockTemperature) || 0.06) ? 'superbasin-lock' : 'corridor-cooling';
    } else {
      const temperTarget = 0.08 + (1 - success) * 0.20;
      a.temperature = clamp(lerp(a.temperature, temperTarget, 0.055), 0.0, 1.0);
      a.stabilityStreak = Math.max(0, (a.stabilityStreak || 0) - 1);
      a.boredom = Math.max(0, (a.boredom || 0) - 2);
      a.state = 'tempered-search';
    }

    const overcapture = p.annealingReheatOnOvercapture !== false && seed.total > 0 && (seed.horizonBoundFraction || 0) >= (Number(p.horizonOvercaptureReheatFraction) || 0.45);
    if (overcapture) {
      a.temperature = clamp(Math.max(Number(a.temperature) || 0, Number(p.horizonOvercaptureReheatTemperature) || 0.66), 0.0, 1.0);
      a.stabilityStreak = 0;
      a.boredom = 0;
      a.reheatCount = (a.reheatCount || 0) + 1;
      a.lastReheatEpoch = nowEpoch(state);
      a.state = 'horizon-overcapture-reheat';
    }

    if ((a.boredom || 0) >= boredomLimit) {
      a.temperature = clamp(Number(p.annealingReheatTemperature) || 1.0, 0.2, 1.0);
      a.boredom = 0;
      a.stabilityStreak = 0;
      a.reheatCount = (a.reheatCount || 0) + 1;
      a.lastReheatEpoch = nowEpoch(state);
      a.state = 'punctuated-reheat';
      jolt = boundedJolt(state, a);
    }

    updateChildThermostat(state, a, seed, stable, lost);

    // Use a curved mapping so the hot state can jump, but cooling rapidly
    // becomes microscopic; this is the driver-level simulated annealing gate.
    // Child rescue adds only a small parent floor; the heavy work happens in the
    // Gauge Atlas nursery budget, not in broad parameter thrashing.
    const curved = Math.pow(clamp01(a.temperature), 1.65);
    const childFloor = (a.nurseryState === 'nursery-rescue') ? Math.min(maxLR, 0.018 + (a.childTemperature || 0) * 0.022) : minLR;
    a.learningRate = Number(clamp(Math.max(childFloor, minLR + (maxLR - minLR) * curved), minLR, maxLR).toFixed(6));
    a.lastSuccess = Number(success.toFixed(5));
    a.maturity = Number(clamp01(1 - a.temperature).toFixed(5));
    p.learningRate = a.learningRate;
    return { annealing: a, success, hot: lost, stable, jolt };
  }

  function tuneParameters(state, summary, annealInfo) {
    const p = state.params;
    if (!p) return { changes: [] };
    const changes = [];
    const temp = state.driver && state.driver.annealing ? clamp01(Number(state.driver.annealing.temperature) || 0) : 0.35;
    const tuneScale = clamp(0.001 + Math.pow(temp, 2.2) * 0.999, 0.0005, 1.0);
    const fil = Number(state.stats && state.stats.filament) || 0.5;
    const cav = Number(state.stats && state.stats.cavity) || 0.25;
    const coh = Number(state.stats && state.stats.coherence) || 0.3;
    const keyholes = summary.keyholeCount;
    const corridors = summary.corridorCount || keyholes;
    const highCrit = summary.criticalMass + (summary.corridorMass || 0);

    function nudge(name, target, rate, lo, hi) {
      const before = Number(p[name]);
      const after = clamp(lerp(before, target, rate), lo, hi);
      if (Math.abs(after - before) > 1e-5) {
        p[name] = Number(after.toFixed(5));
        changes.push({ name, before, after: p[name] });
      }
    }

    // Keep the "universe look" found by the user: lower gravity, lighter warp,
    // more filament dominance, but prevent collapse into flat dust.
    if (p.driverAutotune !== false) {
      const desiredGravity = clamp(0.54 + (cav - 0.28) * 0.22 + (0.5 - fil) * 0.12, 0.42, 0.82);
      nudge('gravity', desiredGravity, 0.045 * tuneScale, 0.32, 1.15);
      nudge('filamentMix', clamp(0.92 + (0.5 - fil) * 0.18, 0.72, 1.0), 0.05 * tuneScale, 0.25, 1.0);
      nudge('warpStrength', clamp(0.22 + Math.max(0, 0.40 - highCrit / 200) * 0.22, 0.12, 0.72), 0.035 * tuneScale, 0.05, 1.5);
      if (corridors < 4) nudge('edgeSoftness', clamp(p.edgeSoftness * 1.012, 0.22, 0.58), 0.06 * tuneScale, 0.08, 0.72);
      else nudge('edgeSoftness', clamp(p.edgeSoftness * 0.996, 0.24, 0.56), 0.035 * tuneScale, 0.08, 0.72);
      nudge('threshold', clamp(0.42 + (fil - 0.5) * 0.16 + (0.28 - cav) * 0.08, 0.32, 0.58), 0.025 * tuneScale, 0.05, 0.9);
      nudge('flow', clamp(1.64 + (summary.criticalMean - 0.35) * 0.42, 1.1, 2.35), 0.03 * tuneScale, 0.05, 3.5);
    }
    return { changes };
  }

  function chooseActiveAnchor(state, summary) {
    const anchors = (state.atlas && state.atlas.anchors || []);
    if (!anchors.length) return null;
    const driver = ensureDriverState(state);
    const current = anchors.find(a => a.id === driver.activeAnchorId);
    const best = summary.topDriver || summary.topCritical || anchors[0];
    if (!current) return best;
    const temp = state.driver && state.driver.annealing ? clamp01(Number(state.driver.annealing.temperature) || 0.35) : 0.35;
    const basinLock = 1.07 + (1 - temp) * 0.42;
    const stayScore = anchorValue(current) * basinLock;
    const bestScore = anchorValue(best);
    return bestScore > stayScore ? best : current;
  }

  function makeProbeAddress(state, anchor, depth, branch) {
    const split = Math.pow(0.5, depth);
    const angle = (branch / Math.max(1, Math.pow(2, depth))) * Math.PI * 2 + (anchor.phase || 0) * 0.13;
    const baseRadius = Number(anchor.radius || 0.2);
    const offset = baseRadius * split * 1.35;
    const x = wrapUnit((anchor.x || 0) + Math.cos(angle) * offset);
    const y = wrapUnit((anchor.y || 0) + Math.sin(angle) * offset);
    return Memory.makeAddress({
      universeSeed: state.seed,
      dimensionId: 'split',
      foldLevel: depth,
      pageX: Math.round(x / Math.max(0.006, baseRadius * split)),
      pageY: Math.round(y / Math.max(0.006, baseRadius * split)),
      scale: clamp(baseRadius * 2.4 * split, 0.004, 0.42),
      originX: x,
      originY: y,
      anchorId: anchor.id || null,
      parent: anchor.id || null
    });
  }

  function evaluateProbe(rec) {
    const s = rec.summary || {};
    const grid = rec.grid;
    let grad = 0;
    if (grid && grid.gx && grid.gy) {
      const step = Math.max(1, Math.floor(grid.gx.length / 512));
      let n = 0;
      for (let i = 0; i < grid.gx.length; i += step) { grad += Math.hypot(grid.gx[i], grid.gy[i]); n++; }
      grad /= Math.max(1, n);
    }
    const filament = Number(s.filament || 0);
    const cavity = Number(s.cavity || 0);
    const crit = Number(s.criticality || 0);
    return crit * 1.8 + filament * 0.8 + grad * 36 + (1 - Math.abs(cavity - 0.28)) * 0.25;
  }

  function driveSplits(state, runtime, memory, activeAnchor) {
    const driver = ensureDriverState(state);
    const maxDepth = Math.max(1, Math.min(12, Math.round(state.params.splitDepthMax || 8)));
    const depth = Math.max(1, Math.min(maxDepth, (driver.splitDepth || 0) + 1));
    if (!activeAnchor || !memory) return { probes: [], bestProbe: null, newPortal: null };
    const temp = state.driver && state.driver.annealing ? clamp01(Number(state.driver.annealing.temperature) || 0.35) : 0.35;
    const maxBranches = Math.round(2 + temp * 14);
    const branchCount = Math.min(maxBranches, Math.max(2, Math.pow(2, Math.min(depth, 4))));
    const probes = [];
    let best = null;
    for (let branch = 0; branch < branchCount; branch++) {
      const address = makeProbeAddress(state, activeAnchor, depth, branch);
      const rec = memory.touch(address, 1.4 + depth * 0.05);
      const score = evaluateProbe(rec);
      const probe = { address, score, summary: rec.summary, depth, branch };
      probes.push(probe);
      if (!best || score > best.score) best = probe;
    }
    driver.splitDepth = best && best.score > 1.62 ? depth : Math.max(0, depth - 1);
    driver.splitProbes = probes
      .concat(driver.splitProbes || [])
      .sort((a, b) => b.score - a.score)
      .slice(0, 64);

    let newPortal = null;
    if (best && best.score > (state.params.minPortalScore || 1.72)) {
      newPortal = {
        id: 'portal-' + nowEpoch(state).toString(36) + '-' + Math.round(best.score * 1000).toString(36),
        fromAnchorId: activeAnchor.id || null,
        toAddress: best.address,
        score: Number(best.score.toFixed(5)),
        depth,
        born: nowEpoch(state),
        lastSeen: nowEpoch(state),
        stability: Number(clamp01((best.summary.criticality || 0) * 0.7 + (best.summary.filament || 0) * 0.3).toFixed(5))
      };
      newPortal.fromAnchorId = newPortal.fromAnchorId || activeAnchor.id || null;
      newPortal.sourceKey = portalSourceKey(newPortal);
      newPortal.portalKey = portalAddressKey(newPortal);
      driver.portals.push(newPortal);
      normalizePortals(state);
    }
    return { probes, bestProbe: best, newPortal };
  }

  function updateObserver(observer, activeAnchor, bestProbe, state) {
    if (!observer || !activeAnchor) return observer;
    const target = bestProbe && bestProbe.address ? bestProbe.address : null;
    let tx = activeAnchor.x || 0;
    let ty = activeAnchor.y || 0;
    let ts = Math.max(0.03, (activeAnchor.radius || 0.18) * 2.0);
    let tf = observer.foldLevel || 0;
    if (target) {
      tx = target.originX;
      ty = target.originY;
      ts = target.scale;
      tf = target.foldLevel;
    }
    const temp = state.driver && state.driver.annealing ? clamp01(Number(state.driver.annealing.temperature) || 0.35) : 0.35;
    const duty = clamp(Number(state.params && state.params.learnDuty) || 0.20, 0.20, 0.80);
    const rate = (0.038 + duty * 0.045) * (0.18 + temp * 0.82);
    observer.x = wrapLerp(observer.x || 0, tx, rate);
    observer.y = wrapLerp(observer.y || 0, ty, rate);
    observer.scale = clamp(lerp(observer.scale || 0.2, ts, rate), 0.006, 0.65);
    observer.foldLevel = Math.round(lerp(observer.foldLevel || 0, tf, rate * 0.55));
    return observer;
  }

  function step(state, runtime, memory, observer, opts) {
    const driver = ensureDriverState(state);
    if (state.params && state.params.driverEnabled === false) {
      driver.enabled = false;
      return { enabled: false };
    }
    driver.enabled = true;
    const summary = summarizeAtlas(state);
    const active = chooseActiveAnchor(state, summary);
    if (active) driver.activeAnchorId = active.id || null;
    const anneal = updateAnnealing(state, summary);
    const tuning = tuneParameters(state, summary, anneal);
    const splits = driveSplits(state, runtime, memory, active);
    let seedlet = null;
    let seedletTraining = null;
    if (Seedlets && active && splits.bestProbe) {
      seedlet = Seedlets.projectSeed(state, active, splits.bestProbe, splits.newPortal);
      const childMult = state.driver && state.driver.annealing ? Math.max(1, Math.round(state.driver.annealing.childBudgetMultiplier || 1)) : 1;
      const duty = clamp(Number(state.params && state.params.learnDuty) || 0.20, 0.20, 0.80);
      const baseBudget = Math.max(1, Math.round((state.params.seedTrainingBudget || 3) * (0.45 + duty * 0.95)));
      const budget = Math.min(Math.round(state.params.activeSeedlets || 32), Math.max(1, baseBudget * childMult));
      seedletTraining = Seedlets.trainSeedlets(state, runtime, memory, budget);
    }
    updateObserver(observer, active, splits.bestProbe, state);

    const target = criticalTarget(state);
    const phase = summary.keyholeCount >= 4 ? 'drive-through-keyholes' : (summary.corridorCount >= 4 ? 'trace-stable-corridors' : (summary.filamentCount > 4 ? 'trace-filaments' : 'seek-critical-line'));
    driver.phase = phase;
    driver.generation = (driver.generation || 0) + 1;
    driver.activeAddress = splits.bestProbe && splits.bestProbe.address || driver.activeAddress || null;
    const record = {
      epoch: nowEpoch(state),
      cycle: Number(state.cycle) || 0,
      phase,
      targetCritical: Number(target.toFixed(5)),
      activeAnchorId: driver.activeAnchorId,
      keyholes: summary.keyholeCount,
      filaments: summary.filamentCount,
      corridors: summary.corridorCount,
      corridorMean: Number((summary.corridorMean || 0).toFixed(5)),
      criticalMean: Number(summary.criticalMean.toFixed(5)),
      criticalMax: Number(summary.criticalMax.toFixed(5)),
      splitDepth: driver.splitDepth || 0,
      bestProbeScore: splits.bestProbe ? Number(splits.bestProbe.score.toFixed(5)) : 0,
      portals: driver.portals.length,
      seedlets: state.atlas && state.atlas.seedlets ? state.atlas.seedlets.length : 0,
      activeSeedletId: state.nested && state.nested.activeSeedletId || null,
      nestedTouched: seedletTraining ? seedletTraining.touched : 0,
      annealing: {
        state: anneal.annealing.state,
        temperature: Number((anneal.annealing.temperature || 0).toFixed(5)),
        learningRate: Number((anneal.annealing.learningRate || 0).toFixed(6)),
        boredom: anneal.annealing.boredom || 0,
        maturity: Number((anneal.annealing.maturity || 0).toFixed(5)),
        reheatCount: anneal.annealing.reheatCount || 0,
        success: Number((anneal.success || 0).toFixed(5)),
        jolt: anneal.jolt || null,
        childTemperature: Number((anneal.annealing.childTemperature || 0).toFixed(5)),
        childBudgetMultiplier: anneal.annealing.childBudgetMultiplier || 1,
        nurseryState: anneal.annealing.nurseryState || 'none'
      },
      tuning: tuning.changes
    };
    driver.history.push(record);
    driver.history = driver.history.slice(-256);
    return Object.assign({ enabled: true, summary, activeAnchor: active, seedlet, seedletTraining }, splits, { record });
  }

  function exportDriverReport(state) {
    const driver = ensureDriverState(state);
    return {
      version: Core.VERSION,
      generated: new Date().toISOString(),
      stateId: state.id,
      epoch: state.epoch,
      cycle: state.cycle,
      phase: driver.phase,
      activeAnchorId: driver.activeAnchorId,
      splitDepth: driver.splitDepth || 0,
      portals: (driver.portals || []).slice(0, 32),
      topSplits: (driver.splitProbes || []).slice(0, 32),
      history: (driver.history || []).slice(-64),
      atlas: summarizeAtlas(state),
      stats: state.stats,
      params: state.params,
      annealing: driver.annealing || null,
      seedlets: Seedlets ? Seedlets.exportSeedletReport(state) : null
    };
  }

  return {
    ensureDriverState,
    summarizeAtlas,
    criticalTarget,
    anchorValue,
    updateAnnealing,
    step,
    updateObserver,
    exportDriverReport
  };
});
