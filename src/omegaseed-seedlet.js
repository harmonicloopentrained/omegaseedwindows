/*
  OmegaSeed Seedlets
  Nested seed projection layer. Seedlets are dormant child-universe descriptors:
  they do not allocate/render dense lower worlds until a driver, observer, or
  trainer touches their folded address. This keeps autonomy bounded and lazy.
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const Core = require('./omegaseed-core.js');
    const Memory = require('./omegaseed-memory.js');
    module.exports = factory(Core, Memory);
  } else {
    root.OmegaSeedSeedlets = factory(root.OmegaSeedCore, root.OmegaSeedMemory);
  }
})(typeof self !== 'undefined' ? self : this, function (Core, Memory) {
  'use strict';

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function clamp01(v) { return clamp(v, 0, 1); }
  function nowEpoch(state) { return Number(state && state.epoch) || 0; }
  function hashId(parts) { return Math.abs(Core.hashString(parts.join(':'))).toString(36); }

  function ensureSeedlets(state) {
    if (!state.atlas) state.atlas = { anchors: [], packets: [], seedlets: [], ancestry: [], notes: [] };
    if (!Array.isArray(state.atlas.seedlets)) state.atlas.seedlets = [];
    if (!state.nested) {
      state.nested = {
        enabled: true,
        generation: 0,
        activeSeedletId: null,
        phase: 'dormant-projection',
        history: []
      };
    }
    if (!Array.isArray(state.nested.history)) state.nested.history = [];
    return state.atlas.seedlets;
  }

  function reductionForDepth(depth) {
    return Math.pow(0.5, clamp(Math.round(depth || 1), 1, 32));
  }

  function anchorKind(anchor) { return anchor && (anchor.kind || anchor.k) || 'basin'; }
  function anchorCriticality(anchor) { return clamp01(Number(anchor && (anchor.criticality ?? anchor.c)) || 0); }

  function seedletRank(s) {
    const statusBoost = s.status === 'reproductive' || s.status === 'white-hole-released' ? 1.38 : (s.status === 'resonant' ? 1.26 : (s.status === 'horizon-bound' ? 1.16 : (s.status === 'training' ? 1.08 : (s.status === 'stagnant' ? 0.72 : (s.status === 'hibernating' ? 0.78 : (s.status === 'collapsed' || s.status === 'scar' ? 0.18 : 1.0))))));
    const hits = Math.log2(2 + Number(s.hits || 0));
    return statusBoost * ((s.score || 0) * 0.36 + (s.criticality || 0) * 0.36 + (s.resonance || 0) * 0.16 + (s.productivity || 0) * 0.10 + Math.min(1, hits / 12) * 0.06) - (s.stagnation || 0) * 0.002;
  }

  function statusFromMetrics(s, p) {
    if (s && s.status === 'horizon-bound' && s.horizon && !s.horizon.released) return 'horizon-bound';
    if (s && s.status === 'white-hole-released') return 'white-hole-released';
    const reproductiveScore = Number(p && p.reproductiveScore) || 1.62;
    const stagnantAfter = Number(p && p.stagnantAfterHits) || 48;
    const collapseEnergy = Number(p && p.seedletCollapseEnergy) || 0.012;
    const rescueCrit = Number(p && p.seedletRescueCriticality) || 0.72;
    const rescueRes = Number(p && p.seedletRescueResonance) || 0.28;
    const energy = Number(s.energy || 0);
    const crit = Number(s.criticality || 0);
    const res = Number(s.resonance || 0);
    const prod = Number(s.productivity || 0);
    // In 0.4.4 the nursery froze because low energy overrode excellent
    // resonance/criticality. Collapse is now reserved for genuinely dead
    // children; resonant low-energy seedlets hibernate and can be rescued.
    if ((crit < 0.08) || (energy < collapseEnergy && res < rescueRes && prod < 0.012 && crit < rescueCrit)) return 'collapsed';
    if (energy < collapseEnergy * 2.2 && (res >= rescueRes || crit >= rescueCrit)) return 'hibernating';
    if (prod > 0.88 && (s.score || 0) > reproductiveScore && res > 0.62) return 'reproductive';
    if (res > 0.72 && crit > 0.74) return 'resonant';
    if ((s.hits || 0) > stagnantAfter * 3 && prod < 0.04 && res < 0.34) return 'hibernating';
    if ((s.hits || 0) > stagnantAfter && prod < 0.08 && res < 0.42) return 'stagnant';
    if ((s.hits || 0) > 0) return 'training';
    return 'dormant';
  }

  function seedletScore(anchor, probe, portal) {
    const crit = Math.max(anchorCriticality(anchor), Number(probe && probe.summary && probe.summary.criticality) || 0);
    const fil = Number(probe && probe.summary && probe.summary.filament) || 0;
    const pscore = Number(probe && probe.score) || 0;
    const stability = Number(portal && portal.stability) || 0;
    const kindBoost = anchorKind(anchor) === 'keyhole' ? 0.35 : (anchorKind(anchor) === 'filament' ? 0.18 : 0);
    return crit * 0.85 + fil * 0.26 + pscore * 0.12 + stability * 0.24 + kindBoost;
  }

  function makeChildGenome(state, anchor, depth, reduction) {
    const p = state.params || {};
    const h = Core.hashString([state.seed, anchor && anchor.id, depth, nowEpoch(state)].join(':'));
    const rnd = Core.mulberry32(h);
    function jitter(v, amount, lo, hi) {
      return Number(clamp(v * (1 + (rnd() - 0.5) * amount), lo, hi).toFixed(5));
    }
    return {
      version: Core.VERSION,
      parentStateId: state.id,
      parentSeed: state.seed,
      scaleRatio: reduction,
      params: {
        // The child sees a smaller chart, not a fully allocated universe. Its
        // field frequency is gently increased while damping gravity/warp into
        // the nested keyhole regime discovered by the parent.
        scale: jitter(Math.max(0.08, Number(p.scale) || 0.6) * (1 + depth * 0.018), 0.10, 0.05, 8.0),
        flow: jitter(Number(p.flow) || 1.8, 0.06, 0.05, 4.0),
        foldDepth: Math.min(12, Math.max(1, Math.round((p.foldDepth || 5) + (depth % 3 === 0 ? 1 : 0)))),
        warpStrength: jitter(Number(p.warpStrength) || 0.22, 0.12, 0.02, 1.4),
        threshold: jitter(Number(p.threshold) || 0.43, 0.05, 0.05, 0.9),
        edgeSoftness: jitter(Number(p.edgeSoftness) || 0.5, 0.05, 0.04, 0.72),
        filamentMix: jitter(Number(p.filamentMix) || 0.92, 0.04, 0.0, 1.0),
        gravity: jitter(Number(p.gravity) || 0.5, 0.08, 0.12, 1.2),
        swirl: jitter(Number(p.swirl) || 1.6, 0.06, 0.0, 2.0)
      }
    };
  }

  function compressLocalAnchors(state, anchor, limit) {
    const anchors = (state.atlas && state.atlas.anchors) || [];
    if (!anchor) return [];
    const nearby = anchors.map(a => {
      const dx = Core.wrapDelta(a.x, anchor.x);
      const dy = Core.wrapDelta(a.y, anchor.y);
      const d = Math.hypot(dx, dy);
      return { a, d, dx, dy };
    }).sort((u, v) => u.d - v.d).slice(0, limit || 12);
    const scale = Math.max(0.03, anchor.radius || 0.2);
    return nearby.map(n => ({
      x: Number(clamp(n.dx / scale, -1, 1).toFixed(5)),
      y: Number(clamp(n.dy / scale, -1, 1).toFixed(5)),
      r: Number(((n.a.radius || 0.18) / scale).toFixed(5)),
      s: Number((n.a.strength || 0).toFixed(5)),
      q: Number((n.a.score || 0).toFixed(5)),
      k: n.a.kind || 'basin',
      c: Number((n.a.criticality || 0).toFixed(5)),
      h: n.a.hits || 1
    }));
  }

  function sampleMacroBleed(state, anchor, originX, originY) {
    const runtime = Core.buildRuntime(state);
    const t = Number(state.time) || 0;
    const eps = 0.004;
    const c = Core.sampleRawField(originX, originY, t, state, runtime);
    const x0 = Core.sampleRawField(Core.wrapUnit(originX - eps), originY, t, state, runtime);
    const x1 = Core.sampleRawField(Core.wrapUnit(originX + eps), originY, t, state, runtime);
    const y0 = Core.sampleRawField(originX, Core.wrapUnit(originY - eps), t, state, runtime);
    const y1 = Core.sampleRawField(originX, Core.wrapUnit(originY + eps), t, state, runtime);
    return {
      macroPhase: Number.isFinite(anchor && anchor.phase) ? anchor.phase : Math.asin(Core.clamp(c.phase || 0, -1, 1)),
      macroPotential: Core.clamp01(c.potential || 0),
      macroGradientX: Core.clamp((x1.potential - x0.potential) / (2 * eps), -4, 4),
      macroGradientY: Core.clamp((y1.potential - y0.potential) / (2 * eps), -4, 4),
      macroCriticality: Core.clamp01(c.criticality || 0),
      macroMixed: Core.clamp01(c.mixed || 0)
    };
  }

  function makeSeedletAddress(state, anchor, probe, depth, id) {
    const reduction = reductionForDepth(depth);
    const source = (probe && probe.address) || {};
    const originX = Number.isFinite(source.originX) ? source.originX : (anchor && anchor.x || 0);
    const originY = Number.isFinite(source.originY) ? source.originY : (anchor && anchor.y || 0);
    const parentScale = Math.max(0.0125, (anchor && anchor.radius) || Number(source.scale) || 0.2);
    const scale = Math.max(0.00075, (Number(source.scale) || parentScale) * reduction);
    const bleed = sampleMacroBleed(state, anchor, originX, originY);
    const timeDilationRaw = state.params && state.params.nestedTimeDilation === false
      ? 1
      : (1 / Math.max(0.015, parentScale)) * Math.pow(2, Math.max(0, depth - 1));
    const timeDilationApplied = Core.clamp(timeDilationRaw, 1, Number(state.params && state.params.maxTimeDilation) || 64);
    return Memory.makeAddress({
      universeSeed: `${state.seed}/${id}`,
      dimensionId: 'seedlet',
      foldLevel: Math.min(32, Math.max(1, depth)),
      pageX: Math.round(originX / Math.max(0.001, scale)),
      pageY: Math.round(originY / Math.max(0.001, scale)),
      scale,
      originX,
      originY,
      anchorId: anchor && anchor.id || null,
      parent: anchor && anchor.id || null,
      timeDilation: timeDilationApplied,
      timeDilationRaw,
      timeDilationApplied,
      macroPhase: bleed.macroPhase,
      macroGradientX: bleed.macroGradientX,
      macroGradientY: bleed.macroGradientY,
      macroPotential: bleed.macroPotential,
      parentScale,
      reduction,
      gaugeParentAnchorId: anchor && anchor.id || null
    });
  }

  function duplicateNear(seedlets, anchor, depth) {
    if (!anchor) return null;
    return seedlets.find(s => s.parentAnchorId === anchor.id && Math.abs((s.depth || 0) - depth) <= 1);
  }

  function projectSeed(state, activeAnchor, bestProbe, portal, opts) {
    const p = state.params || {};
    if (p.nestedEnabled === false || p.nestedAutoproject === false) return null;
    const seedlets = ensureSeedlets(state);
    const depth = Math.min(Math.max(1, Math.round((bestProbe && bestProbe.depth) || (state.driver && state.driver.splitDepth) || 1) + 1), Math.round(p.maxSeedDepth || 14));
    const score = seedletScore(activeAnchor, bestProbe, portal);
    const threshold = Number(p.seedProjectionThreshold) || 0.82;
    if (score < threshold && anchorKind(activeAnchor) !== 'keyhole') return null;
    const existing = duplicateNear(seedlets, activeAnchor, depth);
    if (existing) {
      existing.lastSeen = nowEpoch(state);
      existing.score = Number(Math.max(existing.score || 0, score).toFixed(5));
      existing.criticality = Number(Math.max(existing.criticality || 0, anchorCriticality(activeAnchor)).toFixed(5));
      existing.hits = (existing.hits || 1) + 1;
      existing.stagnation = Math.max(0, (existing.stagnation || 0) + (score <= (existing.score || 0) + 0.004 ? 1 : -3));
      existing.productivity = Number(Core.clamp((existing.productivity || 0) * 0.94 + Math.max(0, score - (existing.score || 0)) * 0.65, 0, 4).toFixed(5));
      existing.status = statusFromMetrics(existing, p);
      return existing;
    }
    const id = 'seedlet-' + hashId([state.id, activeAnchor && activeAnchor.id, depth, nowEpoch(state), seedlets.length]).slice(0, 9);
    const reduction = reductionForDepth(depth);
    const address = makeSeedletAddress(state, activeAnchor, bestProbe, depth, id);
    const child = {
      id,
      type: 'omegaseed.seedlet',
      status: 'dormant',
      parentStateId: state.id,
      parentAnchorId: activeAnchor && activeAnchor.id || null,
      born: nowEpoch(state),
      lastSeen: nowEpoch(state),
      depth,
      scaleRatio: reduction,
      timeDilation: Number((address.timeDilationApplied || address.timeDilation || 1).toFixed(5)),
      timeDilationRaw: Number((address.timeDilationRaw || address.timeDilation || 1).toFixed(5)),
      timeDilationApplied: Number((address.timeDilationApplied || address.timeDilation || 1).toFixed(5)),
      productivity: 0,
      resonance: 0,
      stagnation: 0,
      gauge: {
        type: 'scale-phase-renormalization',
        macroPhase: Number((address.macroPhase || 0).toFixed(5)),
        macroGradientX: Number((address.macroGradientX || 0).toFixed(5)),
        macroGradientY: Number((address.macroGradientY || 0).toFixed(5)),
        macroPotential: Number((address.macroPotential || 0).toFixed(5)),
        parentScale: Number((address.parentScale || 0).toFixed(5)),
        reduction: Number((address.reduction || reduction).toFixed(8)),
        timeDilationRaw: Number((address.timeDilationRaw || 1).toFixed(5)),
        timeDilationApplied: Number((address.timeDilationApplied || address.timeDilation || 1).toFixed(5))
      },
      address,
      score: Number(score.toFixed(5)),
      criticality: Number(Math.max(anchorCriticality(activeAnchor), bestProbe && bestProbe.summary && bestProbe.summary.criticality || 0).toFixed(5)),
      energy: Number(clamp(score * 0.5 + reduction * 4, 0.15, 1.0).toFixed(5)),
      genome: makeChildGenome(state, activeAnchor, depth, reduction),
      compressedAnchors: compressLocalAnchors(state, activeAnchor, 10),
      portalId: portal && portal.id || null,
      lineage: ((state.atlas && state.atlas.ancestry) || []).slice(-8).concat([{ id: state.id, epoch: nowEpoch(state), anchorId: activeAnchor && activeAnchor.id || null }])
    };
    seedlets.push(child);
    seedlets.sort((a, b) => seedletRank(b) - seedletRank(a));
    state.atlas.seedlets = seedlets.slice(0, Math.max(1, Math.round(p.maxSeedlets || 192)));
    state.stats.seedlets = state.atlas.seedlets.length;
    if (state.nested) {
      state.nested.activeSeedletId = child.id;
      state.nested.phase = 'projecting-seeds-within-seed';
      state.nested.generation = (state.nested.generation || 0) + 1;
      state.nested.history.push({ epoch: nowEpoch(state), event: 'project', seedletId: child.id, depth, score: child.score, criticality: child.criticality, timeDilation: child.timeDilation });
      state.nested.history = state.nested.history.slice(-256);
    }
    return child;
  }


  function driverChildTemperature(state) {
    return state && state.driver && state.driver.annealing
      ? clamp01(Number(state.driver.annealing.childTemperature) || 0.24)
      : 0.24;
  }

  function rescueSeedlet(s, p, childTemp) {
    if (!p || p.seedletMetabolismEnabled === false) return false;
    const rescueCrit = Number(p.seedletRescueCriticality) || 0.72;
    const rescueRes = Number(p.seedletRescueResonance) || 0.28;
    const reviveEnergy = Number(p.seedletReviveEnergy) || 0.12;
    const metabolicFloor = Number(p.seedletMetabolicFloor) || 0.085;
    const shouldRescue = (s.status === 'collapsed' || s.status === 'scar' || (Number(s.energy || 0) < (Number(p.seedletCollapseEnergy) || 0.012) * 2.5))
      && ((s.criticality || 0) >= rescueCrit || (s.resonance || 0) >= rescueRes || (s.productivity || 0) > 0.02);
    if (!shouldRescue) return false;
    s.status = 'hibernating';
    s.energy = Number(clamp(Math.max(Number(s.energy || 0), metabolicFloor + childTemp * reviveEnergy), metabolicFloor, Number(p.seedletEnergyMax) || 2.25).toFixed(5));
    s.stagnation = Math.max(0, Math.floor((s.stagnation || 0) * 0.72));
    s.rescued = (s.rescued || 0) + 1;
    return true;
  }

  function nurseryEnergyFloor(s, p, childTemp) {
    if (!p || p.seedletMetabolismEnabled === false) return 0;
    const base = Number(p.seedletMetabolicFloor) || 0.085;
    const status = s.status || 'dormant';
    const statusBoost = status === 'resonant' ? 0.08 : status === 'training' ? 0.045 : status === 'hibernating' ? 0.025 : 0.012;
    const resonanceBoost = clamp01(Number(s.resonance || 0)) * 0.045;
    return base + statusBoost + childTemp * 0.055 + resonanceBoost;
  }

  function trainSeedlets(state, runtime, memory, budget) {
    const seedlets = ensureSeedlets(state);
    if (!memory || !seedlets.length || state.params.nestedEnabled === false) return { touched: 0, promoted: 0, best: null, statuses: {}, rescued: 0 };
    const p = state.params || {};
    const childTemp = driverChildTemperature(state);
    let rescued = 0;
    for (const s of seedlets) if (rescueSeedlet(s, p, childTemp)) rescued++;
    const requested = Math.max(0, Math.round(budget || p.seedTrainingBudget || 0));
    const rescueExtra = rescued > 0 ? Math.min(Math.round(p.activeSeedlets || 32), Math.ceil(rescued / 6)) : 0;
    const n = Math.min(seedlets.length, Math.max(1, Math.min((requested || 1) + rescueExtra, Math.round(p.activeSeedlets || 32))));
    seedlets.sort((a, b) => seedletRank(b) - seedletRank(a));
    let touched = 0, promoted = 0, best = null;
    const statuses = {};
    for (const s of seedlets.slice(0, n)) {
      const beforeScore = Number(s.score || 0);
      const rec = memory.touch(s.address, 2.0 + (s.score || 0) + (s.criticality || 0));
      const summary = rec.summary || {};
      s.lastSeen = nowEpoch(state);
      s.summary = summary;
      const resonance = clamp01(1 - Math.abs((summary.criticality || 0) - (s.criticality || 0)) * 0.72 + (summary.filament || 0) * 0.08 + (summary.cavity || 0) * 0.04);
      const candidateScore = (summary.criticality || 0) * 0.9 + (summary.filament || 0) * 0.4 + (summary.cavity || 0) * 0.2 + resonance * 0.16;
      s.score = Number(Math.max(s.score || 0, candidateScore).toFixed(5));
      s.criticality = Number(Math.max(s.criticality || 0, summary.criticality || 0).toFixed(5));
      s.resonance = Number(clamp01((s.resonance || 0) * 0.86 + resonance * 0.14).toFixed(5));
      s.productivity = Number(clamp((s.productivity || 0) * 0.92 + Math.max(0, candidateScore - beforeScore) * 1.8 + Math.max(0, resonance - 0.62) * 0.05, 0, 6).toFixed(5));
      s.stagnation = Math.max(0, (s.stagnation || 0) + (candidateScore <= beforeScore + 0.002 ? 1 : -4));
      const bleedFuel = s.gauge ? (Number(s.gauge.macroPotential || 0) * 0.006 + Math.hypot(Number(s.gauge.macroGradientX || 0), Number(s.gauge.macroGradientY || 0)) * 0.0009) : 0;
      const floor = nurseryEnergyFloor(s, p, childTemp);
      const energyNext = (s.energy || floor) * (Number(p.seedletEnergyDecay) || 0.994)
        + (summary.filament || 0) * (0.010 + childTemp * 0.010)
        + s.resonance * (0.006 + childTemp * 0.014)
        + s.productivity * 0.004
        + bleedFuel
        - s.stagnation * (0.000035 * (1 - childTemp * 0.55));
      s.energy = Number(clamp(Math.max(floor, energyNext), 0, Number(p.seedletEnergyMax) || 2.25).toFixed(5));
      s.hits = (s.hits || 0) + 1;
      s.status = statusFromMetrics(s, p);
      if (s.status === 'resonant' || s.status === 'reproductive') promoted++;
      statuses[s.status] = (statuses[s.status] || 0) + 1;
      touched++;
      if (!best || seedletRank(s) > seedletRank(best)) best = s;
    }
    // Passive metabolism: idle children hibernate instead of collapsing during
    // parent superbasin cooling. High-critical/resonant seedlets receive a tiny
    // boundary-bleed maintenance current so they remain recoverable.
    for (const s of seedlets.slice(n)) {
      const floor = nurseryEnergyFloor(s, p, childTemp) * 0.72;
      const bleedFuel = s.gauge ? Number(s.gauge.macroPotential || 0) * 0.0025 : 0;
      s.energy = Number(clamp(Math.max(floor, (s.energy || floor) * (Number(p.seedletDormancyEnergyDrain) || 0.9997) + bleedFuel + (s.resonance || 0) * 0.0012), 0, Number(p.seedletEnergyMax) || 2.25).toFixed(5));
      if ((s.status === 'stable' || s.status === 'dormant') && (s.hits || 0) > (p.stagnantAfterHits || 48) && (s.productivity || 0) < 0.05) s.status = 'stagnant';
      if (s.status === 'stagnant' && (s.hits || 0) > (p.stagnantAfterHits || 48) * 3 && (s.resonance || 0) < 0.34) s.status = 'hibernating';
      s.status = statusFromMetrics(s, p);
      statuses[s.status || 'dormant'] = (statuses[s.status || 'dormant'] || 0) + 1;
    }
    seedlets.sort((a, b) => seedletRank(b) - seedletRank(a));
    state.atlas.seedlets = seedlets.slice(0, Math.max(1, Math.round(p.maxSeedlets || 192)));
    state.stats.seedlets = state.atlas.seedlets.length;
    state.stats.seedletStatuses = statuses;
    if (state.nested) {
      state.nested.phase = best ? (best.status === 'reproductive' ? 'seedlet-reproductive-selection' : 'training-gauge-atlas') : state.nested.phase;
      state.nested.activeSeedletId = best && best.id || state.nested.activeSeedletId;
      state.nested.history.push({ epoch: nowEpoch(state), event: 'train', touched, promoted, activeSeedletId: state.nested.activeSeedletId, statuses });
      state.nested.history = state.nested.history.slice(-256);
    }
    return { touched, promoted, best, statuses, rescued, childTemperature: childTemp };
  }

  function exportSeedletReport(state) {
    const seedlets = ensureSeedlets(state);
    const statuses = {};
    let criticalMean = 0, resonanceMean = 0, productivityMean = 0, energyMean = 0, maxDilation = 0;
    for (const s of seedlets) {
      statuses[s.status || 'dormant'] = (statuses[s.status || 'dormant'] || 0) + 1;
      criticalMean += Number(s.criticality || 0);
      resonanceMean += Number(s.resonance || 0);
      productivityMean += Number(s.productivity || 0);
      energyMean += Number(s.energy || 0);
      maxDilation = Math.max(maxDilation, Number(s.timeDilationApplied ?? s.timeDilation ?? 1));
    }
    const denom = Math.max(1, seedlets.length);
    return {
      version: Core.VERSION,
      generated: new Date().toISOString(),
      total: seedlets.length,
      statuses,
      criticalMean: criticalMean / denom,
      resonanceMean: resonanceMean / denom,
      productivityMean: productivityMean / denom,
      energyMean: energyMean / denom,
      maxDilation,
      activeSeedletId: state.nested && state.nested.activeSeedletId || null,
      phase: state.nested && state.nested.phase || 'none',
      top: seedlets.slice().sort((a, b) => seedletRank(b) - seedletRank(a)).slice(0, 48),
      history: state.nested && state.nested.history ? state.nested.history.slice(-64) : []
    };
  }

  return {
    ensureSeedlets,
    reductionForDepth,
    seedletScore,
    seedletRank,
    projectSeed,
    trainSeedlets,
    exportSeedletReport
  };
});
