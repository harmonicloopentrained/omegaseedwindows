/*
  OmegaSeed Memory
  Lazy folded page cache + nested seed address runtime for observer-bound topography. This is not dense RAM for
  a whole universe; it is a sparse virtual address space with resident pages.
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const Core = require('./omegaseed-core.js');
    module.exports = factory(Core);
  } else {
    root.OmegaSeedMemory = factory(root.OmegaSeedCore);
  }
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';

  function nowCycle(state) { return Number(state && state.cycle) || 0; }
  function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v))); }

  function makeAddress(opts) {
    const o = opts || {};
    return {
      universeSeed: String(o.universeSeed || o.seed || 'omegaseed-bootstrap'),
      dimensionId: String(o.dimensionId || 'root'),
      foldLevel: clampInt(o.foldLevel || 0, 0, 32),
      pageX: Math.round(Number(o.pageX) || 0),
      pageY: Math.round(Number(o.pageY) || 0),
      scale: Number.isFinite(o.scale) ? o.scale : Math.pow(0.5, clampInt(o.foldLevel || 0, 0, 32)),
      originX: Number.isFinite(o.originX) ? o.originX : 0,
      originY: Number.isFinite(o.originY) ? o.originY : 0,
      anchorId: o.anchorId || null,
      parent: o.parent || null,
      timeDilation: Number.isFinite(o.timeDilationApplied ?? o.timeDilation) ? Math.max(1, Math.min(256, o.timeDilationApplied ?? o.timeDilation)) : 1,
      timeDilationRaw: Number.isFinite(o.timeDilationRaw) ? Math.max(1, o.timeDilationRaw) : (Number.isFinite(o.timeDilation) ? Math.max(1, o.timeDilation) : 1),
      timeDilationApplied: Number.isFinite(o.timeDilationApplied ?? o.timeDilation) ? Math.max(1, Math.min(256, o.timeDilationApplied ?? o.timeDilation)) : 1,
      macroPhase: Number.isFinite(o.macroPhase) ? o.macroPhase : 0,
      macroGradientX: Number.isFinite(o.macroGradientX) ? o.macroGradientX : 0,
      macroGradientY: Number.isFinite(o.macroGradientY) ? o.macroGradientY : 0,
      macroPotential: Number.isFinite(o.macroPotential) ? Math.max(0, Math.min(1, o.macroPotential)) : 0,
      parentScale: Number.isFinite(o.parentScale) ? o.parentScale : null,
      reduction: Number.isFinite(o.reduction) ? o.reduction : 1,
      gaugeParentAnchorId: o.gaugeParentAnchorId || null
    };
  }

  function pageKey(address) {
    const a = makeAddress(address);
    return [a.universeSeed, a.dimensionId, a.foldLevel, a.pageX, a.pageY, a.anchorId || 'free'].join('/');
  }

  function addressFromAnchor(anchor, state, foldLevel) {
    const scale = Math.max(0.018, Math.min(1, (anchor.radius || 0.18) * 2.4));
    return makeAddress({
      universeSeed: state.seed,
      dimensionId: 'atlas',
      foldLevel: foldLevel || 1,
      pageX: Math.round(anchor.x / scale),
      pageY: Math.round(anchor.y / scale),
      scale,
      originX: anchor.x,
      originY: anchor.y,
      anchorId: anchor.id || null
    });
  }

  function toWorld(address, lx, ly) {
    const a = makeAddress(address);
    const scale = Math.max(1e-6, a.scale);
    return {
      x: Core.wrapUnit(a.originX + lx * scale),
      y: Core.wrapUnit(a.originY + ly * scale)
    };
  }

  function materializePage(state, runtime, address, size) {
    const n = clampInt(size || state.params.pageSize || 96, 32, 256);
    const a = makeAddress(address);
    const len = n * n;
    const grid = {
      width: n,
      height: n,
      address: a,
      potential: new Float32Array(len),
      base: new Float32Array(len),
      filament: new Float32Array(len),
      cavity: new Float32Array(len),
      critical: new Float32Array(len),
      phase: new Float32Array(len),
      gx: new Float32Array(len),
      gy: new Float32Array(len),
      toWorld: function (lx, ly) { return toWorld(a, lx, ly); }
    };
    const t = state.time * Math.max(1, a.timeDilationApplied || a.timeDilation || 1) + a.foldLevel * 0.037 + (a.macroPhase || 0) * 0.017;
    const bleedEnabled = state.params && state.params.boundaryBleed !== false && a.dimensionId === 'seedlet';
    const phaseWeight = bleedEnabled ? (Number(state.params.phaseMatchWeight) || 0.38) : 0;
    const macroWindX = bleedEnabled ? (a.macroGradientX || 0) : 0;
    const macroWindY = bleedEnabled ? (a.macroGradientY || 0) : 0;
    const macroPhase = bleedEnabled ? (a.macroPhase || 0) : 0;
    const macroPotential = bleedEnabled ? (a.macroPotential || 0) : 0;
    // A nested seed address gets its own deterministic noise basis without
    // allocating a separate dense universe. This is the procedural lower-world
    // trick: different address, finite local page.
    let localRuntime = runtime;
    if (a.universeSeed && a.universeSeed !== state.seed) {
      const seedHash = Core.hashString(a.universeSeed);
      localRuntime = {
        seedHash,
        noise: new Core.SimplexNoise2D(seedHash),
        rand: Core.mulberry32(seedHash ^ 0x9e3779b9)
      };
    }
    for (let y = 0; y < n; y++) {
      const ly = (y / (n - 1)) * 2 - 1;
      for (let x = 0; x < n; x++) {
        const lx = (x / (n - 1)) * 2 - 1;
        const w = toWorld(a, lx + macroWindX * 0.045, ly + macroWindY * 0.045);
        const s = Core.sampleRawField(w.x, w.y, t, state, localRuntime);
        const idx = y * n + x;
        if (bleedEnabled) {
          const wind = Math.max(-1, Math.min(1, macroWindX * lx + macroWindY * ly));
          const macroWave = Math.sin(macroPhase + wind * 8.0);
          const resonance = 0.5 + 0.5 * (s.phase * macroWave);
          const phaseGain = 1.0 + phaseWeight * (resonance - 0.5);
          grid.potential[idx] = Core.clamp01(s.potential * phaseGain + macroPotential * 0.035 + wind * 0.018);
          grid.base[idx] = Core.clamp01(s.base * (0.965 + 0.07 * resonance) + macroPotential * 0.025);
          grid.filament[idx] = Core.clamp01(s.filament * (0.94 + 0.13 * resonance));
          grid.cavity[idx] = Core.clamp01(s.cavity * (0.94 + 0.12 * resonance) + macroPotential * 0.02);
          grid.critical[idx] = Core.clamp01((s.criticality || 0) * (0.90 + 0.15 * resonance) + (1 - Math.abs(resonance - 0.5) * 2) * 0.04);
          grid.phase[idx] = Math.max(-1, Math.min(1, s.phase * 0.86 + macroWave * 0.14));
        } else {
          grid.potential[idx] = s.potential;
          grid.base[idx] = s.base;
          grid.filament[idx] = s.filament;
          grid.cavity[idx] = s.cavity;
          grid.critical[idx] = s.criticality || 0;
          grid.phase[idx] = s.phase;
        }
      }
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const idx = y * n + x;
        const xm = y * n + Math.max(0, x - 1);
        const xp = y * n + Math.min(n - 1, x + 1);
        const ym = Math.max(0, y - 1) * n + x;
        const yp = Math.min(n - 1, y + 1) * n + x;
        grid.gx[idx] = (grid.potential[xp] - grid.potential[xm]) * 0.5;
        grid.gy[idx] = (grid.potential[yp] - grid.potential[ym]) * 0.5;
      }
    }
    const summary = Core.summarizeGrid(grid);
    let crit = 0;
    for (let i = 0; i < len; i++) crit += grid.critical[i];
    summary.criticality = crit / len;
    return grid;
  }

  class PageCache {
    constructor(state, runtime, opts) {
      const o = opts || {};
      this.state = state;
      this.runtime = runtime;
      this.maxPages = clampInt(o.maxPages || state.params.memoryMaxPages || 256, 16, 8192);
      this.pageSize = clampInt(o.pageSize || state.params.pageSize || 96, 32, 256);
      this.pages = new Map();
      this.touches = 0;
      this.evictions = 0;
      this.materializations = 0;
    }
    estimatedBytesPerPage() {
      const channels = 8;
      return this.pageSize * this.pageSize * channels * 4;
    }
    touch(address, priority) {
      const key = pageKey(address);
      let rec = this.pages.get(key);
      if (rec) {
        rec.lastTouched = nowCycle(this.state);
        rec.priority = Math.max(rec.priority || 0, priority || 0);
        this.touches++;
        return rec;
      }
      const grid = materializePage(this.state, this.runtime, address, this.pageSize);
      rec = {
        key,
        address: makeAddress(address),
        grid,
        summary: summarizePage(grid),
        priority: priority || 0,
        born: nowCycle(this.state),
        lastTouched: nowCycle(this.state)
      };
      this.pages.set(key, rec);
      this.materializations++;
      this.evictIfNeeded();
      return rec;
    }
    evictIfNeeded() {
      while (this.pages.size > this.maxPages) {
        let worstKey = null;
        let worstScore = Infinity;
        for (const [key, rec] of this.pages.entries()) {
          const age = nowCycle(this.state) - rec.lastTouched;
          const score = (rec.priority || 0) - age * 0.01;
          if (score < worstScore) { worstScore = score; worstKey = key; }
        }
        if (!worstKey) break;
        this.pages.delete(worstKey);
        this.evictions++;
      }
    }
    touchObserver(observer, radius) {
      const o = observer || { x: 0, y: 0, foldLevel: 0 };
      const r = Math.max(0, Math.round(radius || 1));
      const scale = Math.max(0.04, Number(o.scale) || 0.18);
      const out = [];
      for (let yy = -r; yy <= r; yy++) {
        for (let xx = -r; xx <= r; xx++) {
          out.push(this.touch(makeAddress({
            universeSeed: this.state.seed,
            dimensionId: 'observer',
            foldLevel: o.foldLevel || 0,
            pageX: Math.round((o.x || 0) / scale) + xx,
            pageY: Math.round((o.y || 0) / scale) + yy,
            scale,
            originX: Core.wrapUnit((o.x || 0) + xx * scale),
            originY: Core.wrapUnit((o.y || 0) + yy * scale)
          }), 1.0));
        }
      }
      return out;
    }
    touchStrongAnchors(limit) {
      const anchors = (this.state.atlas && this.state.atlas.anchors || []).slice(0, limit || 32);
      return anchors.map((a, i) => this.touch(addressFromAnchor(a, this.state, 1 + (i % 4)), Math.max(0.1, (a.score || 0) * (a.strength || 0.2))));
    }
    stats() {
      return {
        residentPages: this.pages.size,
        maxPages: this.maxPages,
        pageSize: this.pageSize,
        estimatedResidentMB: Number((this.pages.size * this.estimatedBytesPerPage() / (1024 * 1024)).toFixed(2)),
        materializations: this.materializations,
        evictions: this.evictions,
        touches: this.touches
      };
    }
  }

  function summarizePage(grid) {
    const s = Core.summarizeGrid(grid);
    let crit = 0;
    if (grid.critical) {
      for (let i = 0; i < grid.critical.length; i++) crit += grid.critical[i];
      crit /= grid.critical.length;
    }
    return Object.assign({}, s, { criticality: crit });
  }

  function bootstrapObserverFromAtlas(state) {
    const a = (state.atlas && state.atlas.anchors && state.atlas.anchors[0]) || { x: 0, y: 0, radius: 0.18 };
    return { x: a.x || 0, y: a.y || 0, scale: Math.max(0.06, (a.radius || 0.18) * 2.2), foldLevel: 0 };
  }

  return {
    makeAddress, pageKey, toWorld, addressFromAnchor, materializePage,
    PageCache, summarizePage, bootstrapObserverFromAtlas
  };
});
