/* global OmegaSeedCore, OmegaSeedMemory, OmegaSeedDriver, OmegaSeedSeedlets */
(function () {
  'use strict';

  const Core = OmegaSeedCore;
  const Memory = window.OmegaSeedMemory;
  const Driver = window.OmegaSeedDriver;
  const Seedlets = window.OmegaSeedSeedlets;
  const $ = sel => document.querySelector(sel);

  class OmegaSeedApp {
    constructor() {
      this.canvas = $('#field-canvas');
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      this.buffer = document.createElement('canvas');
      this.bctx = this.buffer.getContext('2d', { willReadFrequently: false });
      this.running = true;
      this.autoLearn = true;
      this.lastFrame = performance.now();
      this.lastLearnFrame = 0;
      this.lastAutosave = 0;
      this.frame = 0;
      this.renderTicks = 0;
      this.learnTicks = 0;
      this.schedulerSlot = 0;
      this.learnCredit = 0;
      this.renderMs = 0;
      this.state = this.loadInitialState();
      this.runtime = Core.buildRuntime(this.state);
      this.schedulerMode = this.state.params.schedulerMode || 'continuous';
      this.autoEvolve = this.state.params.autoEvolve !== false;
      this.showStructureOverlay = this.state.params.showStructureOverlay !== false;
      this.ensureBugeyeState();
      this.bugeye = this.state.bugeye;
      this.bugeyeFrames = [];
      this.bugeyeOriginalQuality = null;
      this.camera = { x: 0, y: 0, zoom: 1, targetX: 0, targetY: 0, targetZoom: 1, shot: null };
      this.view = { active: false, originX: 0, originY: 0, scale: 1, depth: 0, label: 'parent' };
      this.viewStack = [];
      this.ensureMiningState();
      this.ensureHorizonState();
      this.ensureSuperbasinState();
      if (Core.ensureFACState) Core.ensureFACState(this.state);
      if (Core.updateFACMedian) Core.updateFACMedian(this.state, { force: true });
      this.boundaryTransit = null;
      this.observer = Memory ? Memory.bootstrapObserverFromAtlas(this.state) : { x: 0, y: 0, scale: 0.2, foldLevel: 0 };
      this.memory = Memory ? new Memory.PageCache(this.state, this.runtime, { maxPages: this.state.params.memoryMaxPages, pageSize: this.state.params.pageSize }) : null;
      if (Driver) Driver.ensureDriverState(this.state);
      if (Seedlets) Seedlets.ensureSeedlets(this.state);
      this.lastDriver = null;
      this.grid = null;
      this.particles = null;
      this.resize();
      this.bindUI();
      this.resetParticles(true);
      this.syncControls();
      this.pauseBudgetSnapshot = null;
      this.toast('OmegaSeed 0.4.22 loaded. Recursive Median FAC suggestion mode active.');
      this.tryLoadPackagedScaffold();
      requestAnimationFrame(t => this.loop(t));
    }

    loadInitialState() {
      this.shouldLoadPackagedScaffold = true;
      try {
        const stored = localStorage.getItem(Core.SAVE_KEY);
        if (stored) { this.shouldLoadPackagedScaffold = false; return Core.migrateSave(JSON.parse(stored)); }
      } catch (err) {
        console.warn('Autosave load failed:', err);
      }
      return Core.migrateSave(Core.makeBootstrapSave());
    }

    tryLoadPackagedScaffold() {
      if (!this.shouldLoadPackagedScaffold || !window.fetch) return;
      fetch('saves/omegaseed_save_epoch_72784.json', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(parsed => {
          if (!parsed || !this.shouldLoadPackagedScaffold) return;
          this.state = Core.migrateSave(parsed);
          this.runtime = Core.buildRuntime(this.state);
          this.schedulerMode = 'continuous';
          this.autoEvolve = this.state.params.autoEvolve !== false;
          this.showStructureOverlay = this.state.params.showStructureOverlay !== false;
          this.ensureBugeyeState();
          this.bugeye = this.state.bugeye;
          this.bugeyeFrames = [];
          this.bugeyeOriginalQuality = null;
          this.applyRenderQuality(this.state.params.renderQuality || 1, false);
          this.view = { active: false, originX: 0, originY: 0, scale: 1, depth: 0, label: 'parent' };
          this.viewStack = [];
          this.ensureMiningState();
          this.ensureHorizonState();
          this.ensureSuperbasinState();
          if (Core.ensureFACState) Core.ensureFACState(this.state);
          if (Core.updateFACMedian) Core.updateFACMedian(this.state, { force: true });
          this.camera = { x: 0, y: 0, zoom: 1, targetX: 0, targetY: 0, targetZoom: 1, shot: null };
          this.boundaryTransit = null;
          this.observer = Memory ? Memory.bootstrapObserverFromAtlas(this.state) : { x: 0, y: 0, scale: 0.2, foldLevel: 0 };
          this.memory = Memory ? new Memory.PageCache(this.state, this.runtime, { maxPages: this.state.params.memoryMaxPages, pageSize: this.state.params.pageSize }) : null;
          if (Driver) Driver.ensureDriverState(this.state);
          if (Seedlets) Seedlets.ensureSeedlets(this.state);
          this.resetParticles(true);
          this.syncControls();
          this.shouldLoadPackagedScaffold = false;
          this.toast(`Loaded packaged Gauge Atlas scaffold: epoch ${this.state.epoch}, ${this.state.stats.seedlets || 0} seedlets.`);
        })
        .catch(() => { /* file:// or offline fallback keeps bootstrap state */ });
    }

    bindUI() {
      window.addEventListener('resize', () => this.resize());
      $('#run-toggle').addEventListener('click', () => {
        this.running = !this.running;
        $('#run-toggle').textContent = this.running ? 'Pause' : 'Run';
        if (this.running) this.exitPauseBudgetFreeze();
        else this.enterPauseBudgetFreeze();
        this.toast(this.running ? 'Simulation running.' : 'Simulation paused. Budgets/autotune frozen.');
      });
      $('#learn-now').addEventListener('click', () => this.learn(true));
      $('#auto-learn').addEventListener('click', () => {
        this.autoLearn = !this.autoLearn;
        $('#auto-learn').textContent = this.autoLearn ? 'Auto learn: on' : 'Auto learn: off';
      });
      $('#auto-evolve').addEventListener('click', () => {
        this.autoEvolve = !this.autoEvolve;
        this.state.params.autoEvolve = this.autoEvolve;
        if (this.autoEvolve) {
          this.autoLearn = true;
          this.state.params.driverEnabled = true;
          this.state.params.nestedEnabled = true;
          if (Driver) Driver.ensureDriverState(this.state);
          if (Seedlets) Seedlets.ensureSeedlets(this.state);
        }
        this.syncControls();
        this.autosave();
        this.toast(this.autoEvolve ? 'Omega auto active: balancing learning, render, driver, and nursery pressure.' : 'Omega auto paused. Manual scheduler restored.');
      });
      $('#cycle-mode').addEventListener('click', () => this.toggleSchedulerMode());
      $('#export-save').addEventListener('click', () => this.exportSave());
      $('#import-save').addEventListener('click', () => $('#save-file').click());
      $('#save-file').addEventListener('change', e => this.importSave(e));
      $('#emit-packet').addEventListener('click', () => this.emitPacket());
      $('#reset-field').addEventListener('click', () => this.resetField());
      $('#clear-atlas').addEventListener('click', () => {
        this.state.atlas.anchors = [];
        this.state.stats.anchors = 0;
        this.autosave();
        this.toast('Atlas cleared. Field remains continuous.');
      });
      $('#cinematic-pan').addEventListener('click', () => this.startCinematicPan());
      $('#boundary-punch').addEventListener('click', () => this.startBoundaryPunch());
      $('#boundary-return').addEventListener('click', () => this.startBoundaryReturn());
      $('#bugeye-survey').addEventListener('click', () => this.startBugeyeSurvey('manual'));
      $('#dimensional-dig').addEventListener('click', () => this.startDimensionalDig());
      $('#filament-climb').addEventListener('click', () => this.startFilamentClimb());
      $('#layer-return').addEventListener('click', () => this.startLayerReturn());
      $('#overlay-toggle').addEventListener('click', () => this.toggleStructureOverlay());
      $('#help-toggle').addEventListener('click', () => document.body.classList.toggle('show-help'));
      this.bindCameraControls();

      const sliderIds = ['scale', 'flow', 'foldDepth', 'warpStrength', 'threshold', 'edgeSoftness', 'filamentMix', 'gravity', 'swirl', 'atlasInfluence', 'particleCount', 'renderQuality', 'timeScale', 'horizonExitThreshold', 'superbasinFollowStrength', 'learnDuty', 'dimensionalDigBias', 'filamentClimbThreshold', 'portalDiversity', 'portalUniqueSourceQuota', 'autoMiningCooldownCycles', 'autoMiningStayCycles', 'autoMiningBugeyeDelayCycles', 'autoMiningFilamentChance', 'autoMiningPostBugeyeClimbWindowCycles', 'autoMiningPostBugeyeClimbRelax', 'bugeyeDwellMultiplier', 'livingWordLearningLift', 'horizonThreshold', 'horizonShellAtlasWeight', 'horizonReleaseThreshold', 'horizonSeedletCoupling', 'horizonNurseryGateThreshold', 'horizonNurseryGateLimit', 'horizonNurseryGateMinScore', 'protoAttractionCenter', 'protoAttractionLearningRate', 'horizonRimApproachThreshold', 'horizonRimScarWeight', 'horizonCandidateThreshold', 'superbasinSplitThreshold', 'superbasinDiversityFloor', 'dominantBasinMaxHitShare', 'horizonBoundSoftCap', 'horizonBoundHardCap', 'horizonParoleCompactness', 'horizonFreezeExitCompactness', 'horizonReleaseDrainLimit', 'effectiveBudgetHardCap', 'effectiveNurseryBudgetHardCap', 'facMedianTreeDepth', 'facMedianScoreThreshold', 'facMedianActionLimit', 'facMedianUpdateIntervalCycles', 'facMedianMinConfidence'];
      for (const id of sliderIds) {
        const el = $('#' + id);
        el.addEventListener('input', () => {
          const val = Number(el.value);
          this.state.params[id] = id === 'foldDepth' || id === 'particleCount' ? Math.round(val) : val;
          if (id === 'renderQuality') this.applyRenderQuality(val, true);
          this.updateSliderReadouts();
          if (id === 'particleCount') this.resetParticles(false);
          if (id === 'timeScale') this.toast(`Observer/capture slow set to ${val.toFixed(2)}x. Physics clock remains local/normal.`);
          if (id === 'foldDepth') this.toast('Fold depth updated: nested topography stack changed.');
        });
      }
      $('#seed-input').addEventListener('change', e => {
        const next = e.target.value.trim();
        if (!next) return;
        this.state.seed = next;
        this.runtime = Core.buildRuntime(this.state);
        this.resetParticles(true);
        this.toast('Seed changed. Noise basis regenerated.');
      });

      window.addEventListener('keydown', e => {
        if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        if (e.code === 'Space') { e.preventDefault(); $('#run-toggle').click(); }
        if (e.key.toLowerCase() === 'm') this.toggleSchedulerMode();
        if (e.key.toLowerCase() === 'l') this.learn(true, 2);
        if (e.key.toLowerCase() === 's') this.exportSave();
        if (e.key.toLowerCase() === 'o') this.startZoomShot('in');
        if (e.key.toLowerCase() === 'p' && e.shiftKey) this.emitPacket();
        else if (e.key.toLowerCase() === 'p') this.startZoomShot('out');
        if (e.key.toLowerCase() === 'c') this.startCinematicPan();
        if (e.key.toLowerCase() === 'b') this.startBoundaryPunch();
        if (e.key.toLowerCase() === 'r') this.startBoundaryReturn();
        if (e.key.toLowerCase() === 'y') this.startBugeyeSurvey('manual');
        if (e.key.toLowerCase() === 'g') this.startDimensionalDig();
        if (e.key.toLowerCase() === 'v') this.startFilamentClimb();
        if (e.key.toLowerCase() === 'u') this.startLayerReturn();
        if (e.key.toLowerCase() === 't') this.toggleStructureOverlay();
        if (e.key.toLowerCase() === 'h') this.toggleUIHidden();
        if (e.key.toLowerCase() === 'f') this.toggleFullscreen();
        if (e.key.toLowerCase() === 'd') this.toggleDriver();
        if (e.key.toLowerCase() === 'n') this.toggleNested();
      });
    }


    bindCameraControls() {
      if (!this.canvas) return;
      const isHudTarget = el => !!(el && el.closest && el.closest('.hud'));
      this.cameraDrag = { active: false, x: 0, y: 0 };
      this.canvas.addEventListener('pointerdown', e => {
        if (isHudTarget(e.target) || this.boundaryTransit) return;
        this.cameraDrag = { active: true, x: e.clientX, y: e.clientY };
        this.camera.shot = null;
        this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId);
      });
      this.canvas.addEventListener('pointermove', e => {
        if (!this.cameraDrag || !this.cameraDrag.active || !this.camera) return;
        const w = Math.max(1, this.canvas.clientWidth || window.innerWidth || 1);
        const h = Math.max(1, this.canvas.clientHeight || window.innerHeight || 1);
        const zoom = Math.max(0.1, this.camera.zoom || 1);
        const dx = (e.clientX - this.cameraDrag.x) / w * (2 / zoom);
        const dy = (e.clientY - this.cameraDrag.y) / h * (2 / zoom);
        this.cameraDrag.x = e.clientX;
        this.cameraDrag.y = e.clientY;
        this.camera.targetX = Core.wrapUnit((this.camera.targetX || this.camera.x || 0) - dx);
        this.camera.targetY = Core.wrapUnit((this.camera.targetY || this.camera.y || 0) - dy);
      });
      const endDrag = e => {
        if (!this.cameraDrag) return;
        this.cameraDrag.active = false;
        try { this.canvas.releasePointerCapture && this.canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      };
      this.canvas.addEventListener('pointerup', endDrag);
      this.canvas.addEventListener('pointercancel', endDrag);
      this.canvas.addEventListener('wheel', e => {
        if (isHudTarget(e.target) || !this.camera || this.boundaryTransit) return;
        e.preventDefault();
        this.camera.shot = null;
        const factor = Math.exp(-e.deltaY * 0.0012);
        this.camera.targetZoom = Core.clamp((this.camera.targetZoom || this.camera.zoom || 1) * factor, 0.72, 7.5);
      }, { passive: false });
    }

    syncControls() {
      const p = this.state.params;
      for (const key of Object.keys(p)) {
        const el = $('#' + key);
        if (el) el.value = p[key];
      }
      $('#seed-input').value = this.state.seed;
      $('#run-toggle').textContent = this.running ? 'Pause' : 'Run';
      $('#auto-learn').textContent = this.autoLearn ? 'Auto learn: on' : 'Auto learn: off';
      const ae = $('#auto-evolve');
      if (ae) ae.textContent = this.autoEvolve ? 'Omega auto: on' : 'Omega auto: off';
      this.updateSchedulerUI();
      this.updateVisualToggleButtons();
      this.updateBugeyeUI();
      this.updateSliderReadouts();
    }

    updateSliderReadouts() {
      const p = this.state.params;
      const map = {
        scale: p.scale.toFixed(2),
        flow: p.flow.toFixed(2),
        foldDepth: String(Math.round(p.foldDepth)),
        warpStrength: p.warpStrength.toFixed(2),
        threshold: p.threshold.toFixed(2),
        edgeSoftness: p.edgeSoftness.toFixed(2),
        filamentMix: p.filamentMix.toFixed(2),
        gravity: p.gravity.toFixed(2),
        swirl: p.swirl.toFixed(2),
        atlasInfluence: p.atlasInfluence.toFixed(2),
        particleCount: String(Math.round(p.particleCount)),
        renderQuality: (p.renderQuality || 1).toFixed(2) + 'x',
        timeScale: (p.timeScale || 1).toFixed(2) + 'x',
        horizonExitThreshold: (p.horizonExitThreshold || 0.58).toFixed(2),
        superbasinFollowStrength: (p.superbasinFollowStrength || 0.39).toFixed(2),
        learnDuty: Math.round((p.learnDuty || 0.2) * 100) + '% learn',
        dimensionalDigBias: (p.dimensionalDigBias || 0).toFixed(2),
        filamentClimbThreshold: (p.filamentClimbThreshold || 0).toFixed(2),
        portalDiversity: (p.portalDiversity || 0).toFixed(2),
        portalUniqueSourceQuota: Math.round(p.portalUniqueSourceQuota || 24) + ' sources',
        bugeyeDwellMultiplier: (p.bugeyeDwellMultiplier || 0).toFixed(2) + 'x',
        autoMiningPostBugeyeClimbWindowCycles: Math.round(p.autoMiningPostBugeyeClimbWindowCycles || 0),
        autoMiningPostBugeyeClimbRelax: (p.autoMiningPostBugeyeClimbRelax || 0).toFixed(2),
        livingWordLearningLift: (p.livingWordLearningLift || 0).toFixed(4),
        horizonThreshold: (p.horizonThreshold || 0).toFixed(2),
        horizonShellAtlasWeight: (p.horizonShellAtlasWeight || 0).toFixed(2),
        horizonReleaseThreshold: (p.horizonReleaseThreshold || 0).toFixed(2),
        horizonSeedletCoupling: (p.horizonSeedletCoupling || 0).toFixed(2),
        horizonNurseryGateThreshold: (p.horizonNurseryGateThreshold || 0.715).toFixed(2),
        horizonNurseryGateLimit: Math.round(p.horizonNurseryGateLimit || 2),
        horizonNurseryGateMinScore: (p.horizonNurseryGateMinScore || 1.20).toFixed(2),
        protoAttractionCenter: (p.protoAttractionCenter || 0.5).toFixed(2),
        protoAttractionLearningRate: (p.protoAttractionLearningRate || 0).toFixed(3),
        horizonRimApproachThreshold: (p.horizonRimApproachThreshold || 0).toFixed(2),
        horizonRimScarWeight: (p.horizonRimScarWeight || 0).toFixed(2),
        horizonCandidateThreshold: (p.horizonCandidateThreshold || 0).toFixed(2),
        superbasinSplitThreshold: (p.superbasinSplitThreshold || 0).toFixed(2),
        superbasinDiversityFloor: (p.superbasinDiversityFloor || 0.18).toFixed(2),
        dominantBasinMaxHitShare: (p.dominantBasinMaxHitShare || 0.72).toFixed(2),
        horizonBoundSoftCap: Math.round(p.horizonBoundSoftCap || 48),
        horizonBoundHardCap: Math.round(p.horizonBoundHardCap || 64),
        horizonParoleCompactness: (p.horizonParoleCompactness || 0.69).toFixed(2),
        horizonFreezeExitCompactness: (p.horizonFreezeExitCompactness || 0.69).toFixed(2),
        horizonReleaseDrainLimit: Math.round(p.horizonReleaseDrainLimit || 10),
        effectiveBudgetHardCap: Math.round(p.effectiveBudgetHardCap || 3),
        effectiveNurseryBudgetHardCap: Math.round(p.effectiveNurseryBudgetHardCap || 8),
        facMedianTreeDepth: Math.round(p.facMedianTreeDepth || 7),
        facMedianScoreThreshold: (p.facMedianScoreThreshold || 0.04).toFixed(3),
        facMedianActionLimit: Math.round(p.facMedianActionLimit || 1),
        facMedianUpdateIntervalCycles: Math.round(p.facMedianUpdateIntervalCycles || 90),
        facMedianMinConfidence: (p.facMedianMinConfidence || 0.34).toFixed(2)
      };
      for (const [id, value] of Object.entries(map)) {
        const el = document.querySelector(`[data-value-for="${id}"]`);
        if (el) el.textContent = value;
      }
    }

    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.floor(window.innerWidth * dpr);
      const h = Math.floor(window.innerHeight * dpr);
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.canvas.style.width = window.innerWidth + 'px';
        this.canvas.style.height = window.innerHeight + 'px';
      }
    }

    applyRenderQuality(q, toast) {
      const p = this.state.params;
      const quality = Core.clamp(Number(q) || 1, 0.45, 3.0);
      p.renderQuality = quality;
      p.fieldWidth = Math.round(Core.clamp(188 * quality, 80, 768));
      p.fieldHeight = Math.round(Core.clamp(112 * quality, 48, 432));
      if (this.grid && (this.grid.width !== p.fieldWidth || this.grid.height !== p.fieldHeight)) this.grid = null;
      if (toast) this.toast(`Render quality ${quality.toFixed(2)}x: ${p.fieldWidth}×${p.fieldHeight} field.`);
    }

    toggleUIHidden() {
      document.body.classList.toggle('ui-hidden');
    }

    toggleFullscreen() {
      if (!document.fullscreenElement) {
        const root = document.documentElement;
        if (root.requestFullscreen) root.requestFullscreen().catch(() => this.toast('Fullscreen request was blocked.'));
      } else if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => this.toast('Could not leave fullscreen.'));
      }
    }

    resetParticles(seedOnly) {
      const p = this.state.params;
      const n = Math.round(p.particleCount);
      const rand = Core.mulberry32(Core.hashString(this.state.seed + ':particles:' + (seedOnly ? 'hard' : 'soft')));
      this.particles = new Float32Array(n * 5);
      for (let i = 0; i < n; i++) {
        const j = i * 5;
        this.particles[j] = rand() * 2 - 1;
        this.particles[j + 1] = rand() * 2 - 1;
        this.particles[j + 2] = (rand() - 0.5) * 0.002;
        this.particles[j + 3] = (rand() - 0.5) * 0.002;
        this.particles[j + 4] = rand();
      }
    }

    resetField() {
      this.state = Core.makeDefaultState('omega-' + Date.now().toString(36));
      this.state.params.schedulerMode = this.schedulerMode;
      this.state.params.autoEvolve = this.autoEvolve;
      this.view = { active: false, originX: 0, originY: 0, scale: 1, depth: 0, label: 'parent' };
      this.viewStack = [];
      this.ensureMiningState();
      this.ensureHorizonState();
      if (Core.ensureFACState) Core.ensureFACState(this.state);
      if (Core.updateFACMedian) Core.updateFACMedian(this.state, { force: true });
      this.camera = { x: 0, y: 0, zoom: 1, targetX: 0, targetY: 0, targetZoom: 1, shot: null };
      this.showStructureOverlay = this.state.params.showStructureOverlay !== false;
      this.ensureBugeyeState();
      this.bugeye = this.state.bugeye;
      this.bugeyeFrames = [];
      this.bugeyeOriginalQuality = null;
      this.boundaryTransit = null;
      this.runtime = Core.buildRuntime(this.state);
      this.observer = Memory ? Memory.bootstrapObserverFromAtlas(this.state) : { x: 0, y: 0, scale: 0.2, foldLevel: 0 };
      this.memory = Memory ? new Memory.PageCache(this.state, this.runtime, { maxPages: this.state.params.memoryMaxPages, pageSize: this.state.params.pageSize }) : null;
      if (Driver) Driver.ensureDriverState(this.state);
      if (Seedlets) Seedlets.ensureSeedlets(this.state);
      this.lastDriver = null;
      this.resetParticles(true);
      this.syncControls();
      this.autosave();
      this.toast('Fresh OmegaSeed created. Bootstrap atlas removed.');
    }

    pauseBudgetFreezeEnabled() {
      const p = this.state && this.state.params || {};
      return this.running === false && p.pauseFreezesBudgets !== false;
    }

    enterPauseBudgetFreeze() {
      if (!this.state) return;
      const p = this.state.params || {};
      const a = this.state.driver && this.state.driver.annealing ? this.state.driver.annealing : null;
      const routine = this.state.mining && this.state.mining.routine ? this.state.mining.routine : null;
      this.pauseBudgetSnapshot = {
        learnCredit: this.learnCredit || 0,
        learnDuty: Number(p.learnDuty) || 0.20,
        learningRate: Number(p.learningRate) || 0.0001,
        childBudgetMultiplier: a ? Math.max(1, Math.round(Number(a.childBudgetMultiplier) || 1)) : 1,
        childTemperature: a ? Number(a.childTemperature) || 0.35 : 0.35,
        annealTemperature: a ? Number(a.temperature) || 0.35 : 0.35,
        nurseryState: a ? (a.nurseryState || 'pause-held') : 'pause-held',
        miningRoutine: routine ? Object.assign({}, routine) : null
      };
      this.learnCredit = 0;
      this.enforcePauseBudgetClamp();
    }

    exitPauseBudgetFreeze() {
      this.pauseBudgetSnapshot = null;
    }

    clampEffectiveBudget(value) {
      const p = this.state && this.state.params || {};
      const base = Math.max(1, Math.round(Number(p.seedTrainingBudget) || 3));
      const cap = Math.max(1, Math.round(Number(p.effectiveBudgetHardCap) || base));
      return Math.max(1, Math.min(Math.round(Number(value) || base), cap));
    }

    enforcePauseBudgetClamp() {
      if (!this.pauseBudgetFreezeEnabled()) return;
      const p = this.state.params || {};
      const snap = this.pauseBudgetSnapshot || {};
      this.learnCredit = 0;
      if (p.pauseFreezesAutotune !== false && Number.isFinite(snap.learnDuty)) p.learnDuty = snap.learnDuty;
      if (Number.isFinite(snap.learningRate)) p.learningRate = snap.learningRate;
      if (this.state.driver && this.state.driver.annealing) {
        const a = this.state.driver.annealing;
        if (p.freezeAnnealingChildBudgetOnPause !== false) {
          a.childBudgetMultiplier = Math.max(1, Math.min(Math.round(Number(snap.childBudgetMultiplier) || 1), Math.round(Number(p.effectiveNurseryBudgetHardCap) || 8)));
          a.childTemperature = Number.isFinite(snap.childTemperature) ? snap.childTemperature : a.childTemperature;
          a.temperature = Number.isFinite(snap.annealTemperature) ? snap.annealTemperature : a.temperature;
          a.learningRate = Number.isFinite(snap.learningRate) ? snap.learningRate : a.learningRate;
          a.nurseryState = snap.nurseryState || a.nurseryState || 'pause-held';
        }
      }
      if (p.pauseFreezesMiningRoutines !== false && snap.miningRoutine && this.state.mining && this.state.mining.routine) {
        this.state.mining.routine = Object.assign({}, this.state.mining.routine, snap.miningRoutine);
      }
    }

    schedulerAction() {
      if (this.pauseBudgetFreezeEnabled()) {
        this.learnCredit = 0;
        return 'render';
      }
      const duty = Core.clamp(Number(this.state.params.learnDuty) || 0.20, 0.20, 0.80);
      this.schedulerMode = 'continuous';
      this.state.params.schedulerMode = 'continuous';
      this.learnCredit = (this.learnCredit || 0) + duty;
      if (!this.grid) return 'render';
      if (this.learnCredit >= 1) {
        this.learnCredit -= 1;
        return 'learn';
      }
      return 'render';
    }

    toggleSchedulerMode() {
      const current = Core.clamp(Number(this.state.params.learnDuty) || 0.20, 0.20, 0.80);
      this.state.params.learnDuty = current < 0.50 ? 0.80 : 0.20;
      this.schedulerMode = 'continuous';
      this.state.params.schedulerMode = 'continuous';
      this.updateSchedulerUI();
      this.syncControls();
      this.autosave();
      this.toast(`Scheduler target: ${Math.round(this.state.params.learnDuty * 100)}% learn / ${Math.round((1 - this.state.params.learnDuty) * 100)}% render.`);
    }

    updateSchedulerUI() {
      const duty = Core.clamp(Number(this.state.params.learnDuty) || 0.20, 0.20, 0.80);
      const learnMode = duty >= 0.5;
      document.body.classList.toggle('sleep-mode', learnMode);
      const b = $('#cycle-mode');
      if (b) b.textContent = `Mode: ${Math.round((1 - duty) * 100)} render / ${Math.round(duty * 100)} learn`;
    }

    updateVisualToggleButtons() {
      const overlay = $('#overlay-toggle');
      if (overlay) overlay.textContent = this.showStructureOverlay ? 'Structure overlay: on' : 'Structure overlay: off';
      const ret = $('#boundary-return');
      if (ret) ret.textContent = this.view && this.view.active ? 'Boundary return' : 'Boundary return (top)';
    }

    toggleStructureOverlay() {
      this.showStructureOverlay = !this.showStructureOverlay;
      this.state.params.showStructureOverlay = this.showStructureOverlay;
      this.updateVisualToggleButtons();
      this.autosave();
      this.toast(this.showStructureOverlay ? 'Structure overlay visible: circles and seedlet triangles on.' : 'Structure overlay hidden: field and particles only.');
    }

    ensureMiningState() {
      if (!this.state.mining || typeof this.state.mining !== 'object') this.state.mining = {};
      const m = this.state.mining;
      if (!Array.isArray(m.originTrace)) m.originTrace = [];
      if (!Array.isArray(m.livingWordTraces)) m.livingWordTraces = [];
      if (!Array.isArray(m.seamEdges)) m.seamEdges = [];
      m.lastRelock = Number.isFinite(m.lastRelock) ? m.lastRelock : 0;
      m.layerDepth = Number.isFinite(m.layerDepth) ? m.layerDepth : 0;
      if (!m.routine || typeof m.routine !== 'object') m.routine = {};
      const r = m.routine;
      r.lastDigCycle = Number.isFinite(r.lastDigCycle) ? r.lastDigCycle : -Infinity;
      r.lastClimbCycle = Number.isFinite(r.lastClimbCycle) ? r.lastClimbCycle : -Infinity;
      r.lastReturnCycle = Number.isFinite(r.lastReturnCycle) ? r.lastReturnCycle : -Infinity;
      r.lastLayerEnterCycle = Number.isFinite(r.lastLayerEnterCycle) ? r.lastLayerEnterCycle : -Infinity;
      r.lastLayerBugeyeCycle = Number.isFinite(r.lastLayerBugeyeCycle) ? r.lastLayerBugeyeCycle : -Infinity;
      r.postBugeyeClimbEligibleCycle = Number.isFinite(r.postBugeyeClimbEligibleCycle) ? r.postBugeyeClimbEligibleCycle : -Infinity;
      r.postBugeyeClimbExpireCycle = Number.isFinite(r.postBugeyeClimbExpireCycle) ? r.postBugeyeClimbExpireCycle : -Infinity;
      r.postBugeyeClimbScore = Number.isFinite(r.postBugeyeClimbScore) ? r.postBugeyeClimbScore : 0;
      r.postBugeyeClimbUsed = !!r.postBugeyeClimbUsed;
      r.pendingPostBugeyeFilamentTarget = r.pendingPostBugeyeFilamentTarget && typeof r.pendingPostBugeyeFilamentTarget === 'object' ? r.pendingPostBugeyeFilamentTarget : null;
      r.pendingPostBugeyeFilamentExpireCycle = Number.isFinite(r.pendingPostBugeyeFilamentExpireCycle) ? r.pendingPostBugeyeFilamentExpireCycle : -Infinity;
      r.successfulDigBugeyeCount = Number.isFinite(r.successfulDigBugeyeCount) ? r.successfulDigBugeyeCount : 0;
      r.lastRoutine = r.lastRoutine || 'idle';
      r.runs = Number.isFinite(r.runs) ? r.runs : 0;
      return m;
    }


    ensureHorizonState() {
      if (!this.state.horizon || typeof this.state.horizon !== 'object') this.state.horizon = {};
      const h = this.state.horizon;
      if (!Array.isArray(h.shells)) h.shells = [];
      h.releases = Number.isFinite(h.releases) ? h.releases : 0;
      h.lastReleaseCycle = Number.isFinite(h.lastReleaseCycle) ? h.lastReleaseCycle : -Infinity;
      h.lastCompactness = Number.isFinite(h.lastCompactness) ? h.lastCompactness : 0;
      h.lastResistance = Number.isFinite(h.lastResistance) ? h.lastResistance : 1;
      h.lastCoupling = Number.isFinite(h.lastCoupling) ? h.lastCoupling : 1;
      h.horizonBoundSeedlets = Number.isFinite(h.horizonBoundSeedlets) ? h.horizonBoundSeedlets : 0;
      h.insideHorizon = !!h.insideHorizon;
      h.chartWraps = Number.isFinite(h.chartWraps) ? h.chartWraps : 0;
      h.lastChartWrapCycle = Number.isFinite(h.lastChartWrapCycle) ? h.lastChartWrapCycle : -Infinity;
      h.mode = h.mode || 'open-field';
      return h;
    }

    ensureSuperbasinState() {
      if (!this.state.superbasin || typeof this.state.superbasin !== 'object') this.state.superbasin = {};
      const s = this.state.superbasin;
      if (!Array.isArray(s.rimScars)) s.rimScars = [];
      if (!Array.isArray(s.horizonCandidates)) s.horizonCandidates = [];
      s.protoAttraction = Number.isFinite(s.protoAttraction) ? s.protoAttraction : 0.5;
      s.topHitShare = Number.isFinite(s.topHitShare) ? s.topHitShare : 0;
      s.splits = Number.isFinite(s.splits) ? s.splits : 0;
      s.lastMapped = Number.isFinite(s.lastMapped) ? s.lastMapped : -Infinity;
      s.lastSplitCycle = Number.isFinite(s.lastSplitCycle) ? s.lastSplitCycle : -Infinity;
      s.mode = s.mode || 'baby-curriculum';
      return s;
    }

    shellTileValue(shell, i) {
      const phi = 0.618033988749895;
      const a = (Number(shell.tileSeed || 1) * 0.000001 + i * phi + (shell.age || 0) * 0.0007) % 1;
      return 0.5 + 0.5 * Math.sin((a * Math.PI * 2) + (shell.scarDepth || 0) * 1.7);
    }

    horizonMetricsForAnchor(anchor) {
      if (!anchor) return null;
      const p = this.state.params || {};
      const sample = Core.sampleRawField(anchor.x || 0, anchor.y || 0, this.state.time || 0, this.state, this.runtime);
      const driver = this.state.driver || {};
      const portals = Array.isArray(driver.portals) ? driver.portals : [];
      const nearbyPortals = portals.filter(pt => pt && pt.fromAnchorId === anchor.id).length;
      const portalMass = Core.clamp01(nearbyPortals / Math.max(1, Math.round((p.portalUniqueSourceQuota || 24) * 0.5)));
      const seedlets = (this.state.atlas && this.state.atlas.seedlets) || [];
      let seedletDensity = 0;
      let dilationMax = 0;
      for (const s of seedlets) {
        const a = s.address || {};
        const sameParent = s.parentAnchorId && anchor.id && s.parentAnchorId === anchor.id;
        const dist = Math.hypot(Core.wrapDelta(Number(a.originX) || 0, anchor.x || 0), Core.wrapDelta(Number(a.originY) || 0, anchor.y || 0));
        if (sameParent || dist < Math.max(0.018, (anchor.radius || 0.18) * 0.9)) {
          seedletDensity += 1;
          dilationMax = Math.max(dilationMax, Number(s.timeDilationApplied ?? s.timeDilation ?? 1));
        }
      }
      seedletDensity = Core.clamp01(seedletDensity / Math.max(8, Number(p.activeSeedlets || 32)));
      const dilation = Core.clamp01(Math.log2(1 + dilationMax) / Math.log2(1 + (Number(p.maxTimeDilation) || 64)));
      const criticality = Core.clamp01(Math.max(Number(anchor.criticality || 0), sample.criticality || 0));
      const cavity = Core.clamp01(Math.max(Number(sample.cavity || 0), Number(this.state.stats && this.state.stats.cavity || 0) * 0.75));
      const filament = Core.clamp01(Math.max(Number(sample.filament || 0), Number(anchor.kind === 'filament' ? 0.72 : 0)));
      const escapeMargin = Core.clamp01(0.55 * (1 - criticality) + 0.25 * Math.max(0, sample.edgeDistance || 0) + 0.20 * (1 - filament));
      const collapsePressure = Core.clamp(0.32 * criticality + 0.22 * cavity + 0.16 * dilation + 0.14 * portalMass + 0.10 * filament + 0.12 * seedletDensity, 0, 2);
      const compactness = Core.clamp(collapsePressure - 0.18 * escapeMargin + 0.08 * (anchor.strength || 0), 0, 2);
      const localResistance = Core.clamp01(escapeMargin / Math.max(0.001, collapsePressure + 0.05));
      const outwardCoupling = Core.clamp01(1 / (1 + compactness * 3.4 + dilation * 1.3 + cavity * 1.4));
      return { anchor, sample, criticality, cavity, filament, portalMass, seedletDensity, dilation, escapeMargin, collapsePressure, compactness, localResistance, outwardCoupling };
    }

    touchHorizonShell(metrics, dt) {
      const h = this.ensureHorizonState();
      const p = this.state.params || {};
      const a = metrics.anchor;
      let shell = h.shells.find(sh => sh.anchorId === a.id || Math.hypot(Core.wrapDelta(sh.x, a.x || 0), Core.wrapDelta(sh.y, a.y || 0)) < Math.max(0.012, (a.radius || 0.18) * 0.36));
      if (!shell) {
        shell = {
          id: 'shell-' + Core.hashString(this.state.seed + ':' + a.id + ':' + this.state.epoch).toString(36),
          anchorId: a.id,
          x: a.x || 0,
          y: a.y || 0,
          radius: Core.clamp((a.radius || 0.18) * 1.12, 0.018, 0.48),
          compactness: 0,
          collapsePressure: 0,
          localResistance: 1,
          outwardCoupling: 1,
          scarDepth: 0,
          scarMemory: 0,
          scarPermeability: 0.05,
          scarAsymmetry: 0,
          shellDensity: 0,
          shellQuasiperiodicity: 0.618,
          releaseReadiness: 0,
          tileSeed: Core.hashString('penrose-shell:' + a.id),
          age: 0,
          born: this.state.epoch,
          lastSeen: this.state.epoch,
          lastRelease: -Infinity,
          status: 'approach-shell'
        };
        h.shells.push(shell);
      }
      shell.x = Core.wrapLerp(shell.x || 0, a.x || 0, 0.08);
      shell.y = Core.wrapLerp(shell.y || 0, a.y || 0, 0.08);
      shell.radius = Core.clamp(Core.lerp(shell.radius || 0.12, (a.radius || 0.18) * (1.04 + metrics.compactness * 0.24), 0.05), 0.012, 0.55);
      shell.compactness = Core.lerp(shell.compactness || 0, metrics.compactness, 0.16);
      shell.collapsePressure = Core.lerp(shell.collapsePressure || 0, metrics.collapsePressure, 0.16);
      shell.localResistance = Core.lerp(shell.localResistance || 1, metrics.localResistance, 0.16);
      shell.outwardCoupling = Core.lerp(shell.outwardCoupling || 1, metrics.outwardCoupling, 0.16);
      const excess = Math.max(0, metrics.compactness - (Number(p.horizonThreshold) || 0.74));
      const rimScar = Math.max(0, Number(a.rimScarDepth || 0));
      const rimWeight = Core.clamp(Number(p.horizonRimScarWeight) || 0.18, 0, 0.80);
      shell.scarDepth = Core.clamp((shell.scarDepth || 0) + excess * (0.022 + Math.min(0.04, dt || 0.016)) + rimScar * rimWeight * 0.004, 0, 8);
      shell.scarMemory = Core.clamp01((shell.scarMemory || 0) * 0.998 + excess * 0.012 + metrics.seedletDensity * 0.003 + rimScar * rimWeight * 0.002);
      shell.scarPermeability = Core.clamp01(0.08 + (1 - shell.outwardCoupling) * 0.18 + Math.max(0, 0.72 - shell.localResistance) * 0.12 + Math.sin((this.state.time || 0) * 0.17 + shell.tileSeed) * 0.015);
      shell.scarAsymmetry = Core.clamp(Core.lerp(shell.scarAsymmetry || 0, Math.sin((a.phase || 0) + metrics.filament * Math.PI) * (1 - shell.outwardCoupling), 0.06), -1, 1);
      shell.shellDensity = Core.clamp01((1 - shell.outwardCoupling) * 0.55 + shell.scarMemory * 0.25 + metrics.filament * 0.20);
      shell.shellQuasiperiodicity = Core.clamp01(0.52 + 0.26 * Math.abs(Math.sin((a.phase || 0) * 1.618 + shell.scarDepth)) + 0.16 * metrics.filament);
      shell.releaseReadiness = Core.clamp((shell.scarPermeability * 0.34 + shell.scarMemory * 0.20 + shell.shellDensity * 0.22 + metrics.filament * 0.16 + Math.max(0, 0.8 - shell.localResistance) * 0.16) - Math.max(0, shell.scarDepth - 2.5) * 0.06, 0, 2);
      shell.age = (shell.age || 0) + 1;
      shell.lastSeen = this.state.epoch;
      shell.status = shell.outwardCoupling < 0.24 && shell.localResistance < 0.34 ? 'horizon-shell' : 'approach-shell';
      a.scarDepth = shell.scarDepth;
      a.scarPermeability = shell.scarPermeability;
      a.shellId = shell.id;
      return shell;
    }


    horizonOccupancyLimits() {
      const p = this.state.params || {};
      const total = Math.max(1, ((this.state.atlas && this.state.atlas.seedlets) || []).length || 1);
      const fractionCap = Math.max(1, Math.floor(total * Core.clamp(Number(p.horizonBoundMaxFraction) || 0.28, 0.02, 0.95)));
      const softCap = Math.max(1, Math.min(fractionCap, Math.round(Number(p.horizonBoundSoftCap) || 48)));
      const hardCap = Math.max(softCap, Math.min(total, Math.round(Number(p.horizonBoundHardCap) || 64), Math.max(softCap, fractionCap)));
      return { total, softCap, hardCap, fractionCap };
    }

    currentHorizonBoundSeedlets() {
      const seedlets = (this.state.atlas && this.state.atlas.seedlets) || [];
      return seedlets.filter(s => s && s.status === 'horizon-bound').length;
    }

    paroleHorizonSeedlets(compactness, reason) {
      const p = this.state.params || {};
      const h = this.ensureHorizonState();
      if (p.horizonParoleEnabled === false) return 0;
      const seedlets = (this.state.atlas && this.state.atlas.seedlets) || [];
      const limits = this.horizonOccupancyLimits();
      const bound = seedlets.filter(s => s && s.status === 'horizon-bound');
      if (!bound.length) return 0;
      const lowCompact = Number(compactness || h.lastCompactness || 0) <= (Number(p.horizonParoleCompactness) || 0.69);
      const overSoft = bound.length > limits.softCap;
      const overHard = bound.length > limits.hardCap;
      if (!lowCompact && !overSoft && !overHard) return 0;
      const target = overHard ? limits.hardCap : (overSoft ? limits.softCap : Math.max(1, Math.floor(limits.softCap * 0.72)));
      const drain = Math.max(1, Math.min(bound.length, bound.length - target, Math.round(Number(p.horizonReleaseDrainLimit) || 10)));
      if (drain <= 0) return 0;
      const resMin = Number(p.horizonParoleResonanceMin) || 0.62;
      const prodMin = Number(p.horizonParoleProductivityMin) || 0.04;
      bound.sort((a, b) => {
        const ap = (a.productivity || 0) * 2.0 + (a.resonance || 0) + ((a.horizon && a.horizon.localClock) || 0) * 0.12 + (a.energy || 0) * 0.05;
        const bp = (b.productivity || 0) * 2.0 + (b.resonance || 0) + ((b.horizon && b.horizon.localClock) || 0) * 0.12 + (b.energy || 0) * 0.05;
        return bp - ap;
      });
      let paroled = 0;
      for (const s of bound) {
        if (paroled >= drain) break;
        const mature = ((this.state.epoch || 0) - Number(s.horizon && s.horizon.crossed || this.state.epoch)) >= 96 || Number(s.horizon && s.horizon.localClock || 0) >= 0.64;
        const productive = Number(s.productivity || 0) >= prodMin || Number(s.resonance || 0) >= resMin;
        if (!overHard && !productive && !mature) continue;
        s.horizon = Object.assign({}, s.horizon || {}, { paroled: this.state.epoch, paroleReason: reason || 'occupancy-governor' });
        s.status = productive || mature ? 'resonant' : 'training';
        s.resonance = Number(Core.clamp01((s.resonance || 0) + 0.025).toFixed(5));
        s.productivity = Number(Core.clamp((s.productivity || 0) + 0.012, 0, 6).toFixed(5));
        s.stagnation = Math.max(0, (s.stagnation || 0) - 6);
        paroled++;
      }
      if (paroled > 0) {
        h.lastParoleCount = paroled;
        h.lastParoleCycle = this.state.cycle || 0;
        h.mode = overHard ? 'horizon-overcapture-parole' : 'horizon-rim-recovery';
        this.recountSeedletStatuses();
      }
      return paroled;
    }

    seedletNurseryScore(s, shell, metrics) {
      if (!s) return 0;
      const q = Number(s.score || 0);
      const c = Number(s.criticality || 0);
      const r = Number(s.resonance || 0);
      const e = Number(s.energy || 0);
      const parentBonus = s.parentAnchorId && s.parentAnchorId === shell.anchorId ? 0.28 : 0;
      const statusBonus = s.status === 'resonant' ? 0.22 : (s.status === 'training' ? 0.08 : (s.status === 'stagnant' ? -0.10 : 0));
      const localClock = Number(s.horizon && s.horizon.localClock || 0);
      const alreadyBound = s.status === 'horizon-bound' ? Math.min(0.18, localClock * 0.002) : 0;
      return q * 0.42 + c * 0.28 + r * 0.18 + Math.min(1, e / Math.max(0.1, Number(this.state.params.seedletEnergyMax) || 2.25)) * 0.10 + parentBonus + statusBonus + alreadyBound + Math.max(0, (metrics.compactness || 0) - 0.60) * 0.35;
    }

    bindSeedletToHorizon(s, shell, metrics, captureMode) {
      const p = this.state.params || {};
      s.status = 'horizon-bound';
      s.horizon = Object.assign({}, s.horizon || {}, {
        shellId: shell.id,
        crossed: s.horizon && s.horizon.crossed || this.state.epoch,
        captureMode: captureMode || 'horizon-crossing',
        localClock: Number(((s.horizon && s.horizon.localClock || 0) + (1 + metrics.compactness) * (Number(p.horizonSeedletCoupling) || 0.24)).toFixed(5)),
        outwardCoupling: Number((shell.outwardCoupling || 0).toFixed(5)),
        localResistance: Number((shell.localResistance || 0).toFixed(5)),
        scarDepth: Number((shell.scarDepth || 0).toFixed(5))
      });
      s.energy = Number(Core.clamp((s.energy || 0.4) + shell.shellDensity * 0.006 + (1 - shell.localResistance) * 0.004 + (captureMode === 'nursery-gate' ? 0.012 : 0), 0, Number(p.seedletEnergyMax) || 2.25).toFixed(5));
      s.resonance = Number(Core.clamp01((s.resonance || 0) * 0.990 + shell.shellQuasiperiodicity * 0.010 + (captureMode === 'nursery-gate' ? 0.006 : 0)).toFixed(5));
      s.stagnation = Math.max(0, (s.stagnation || 0) - (captureMode === 'nursery-gate' ? 3 : 1));
      shell.nurseryCaptures = (shell.nurseryCaptures || 0) + (captureMode === 'nursery-gate' ? 1 : 0);
      shell.scarMemory = Core.clamp01((shell.scarMemory || 0) + 0.006 + (s.resonance || 0) * 0.004);
      shell.releaseReadiness = Core.clamp((shell.releaseReadiness || 0) + 0.006 + (shell.scarPermeability || 0) * 0.004, 0, 2);
    }

    updateHorizonSeedlets(shell, metrics, mode) {
      const p = this.state.params || {};
      const seedlets = (this.state.atlas && this.state.atlas.seedlets) || [];
      const basin = this.ensureSuperbasinState();
      const maxHitShare = Core.clamp(Number(p.dominantBasinMaxHitShare) || 0.72, 0.20, 0.98);
      const overlock = Core.clamp01(((Number(basin.topHitShare || 0) - maxHitShare) / Math.max(0.04, 1 - maxHitShare)));
      const isDominantShell = shell && shell.anchorId && basin.dominantAnchorId && shell.anchorId === basin.dominantAnchorId;
      const diversityFloor = Core.clamp(Number(p.superbasinDiversityFloor) || 0.18, 0, 0.65);
      const nurseryMode = mode === 'nursery-gate';
      const nearThreshold = Number(p.horizonNurseryGateThreshold) || 0.715;
      const minScoreBase = Number(p.horizonNurseryGateMinScore) || 1.20;
      const baseLimit = Math.max(1, Math.round(Number(p.horizonNurseryGateLimit) || 2));
      const limits = this.horizonOccupancyLimits();
      let currentBound = this.currentHorizonBoundSeedlets();
      const cooldown = Math.max(0, Math.round(Number(p.horizonCaptureCooldownCycles) || 360));
      if (currentBound >= limits.hardCap) {
        this.paroleHorizonSeedlets(metrics.compactness || 0, 'hard-cap-before-capture');
        currentBound = this.currentHorizonBoundSeedlets();
      }
      if (currentBound >= limits.hardCap) {
        const h = this.ensureHorizonState();
        h.lastNurseryCaptures = 0;
        h.lastCaptureLimit = 0;
        h.lastCaptureBlocked = 'hard-cap';
        h.horizonBoundSeedlets = currentBound;
        return 0;
      }
      if (currentBound >= limits.softCap && cooldown > 0 && ((this.state.cycle || 0) - (this.ensureHorizonState().lastNurseryCaptureCycle || -Infinity)) < cooldown) {
        const h = this.ensureHorizonState();
        h.lastNurseryCaptures = 0;
        h.lastCaptureLimit = 0;
        h.lastCaptureBlocked = 'soft-cap-cooldown';
        h.horizonBoundSeedlets = currentBound;
        return 0;
      }
      const rawLimit = isDominantShell && overlock > 0.01 ? 1 : (nurseryMode ? baseLimit : Math.min(baseLimit + 1, 4));
      const effectiveLimit = Math.max(0, Math.min(rawLimit, limits.hardCap - currentBound));
      const scorePenalty = isDominantShell ? overlock * 0.28 : -overlock * diversityFloor;
      const candidates = [];
      for (const s of seedlets) {
        const a = s.address || {};
        const dist = Math.hypot(Core.wrapDelta(Number(a.originX) || 0, shell.x || 0), Core.wrapDelta(Number(a.originY) || 0, shell.y || 0));
        const close = dist < Math.max(0.014, (shell.radius || 0.1) * 0.72) || (s.parentAnchorId && s.parentAnchorId === shell.anchorId);
        if (!close) continue;
        const horizonCrossing = metrics.compactness >= (Number(p.horizonThreshold) || 0.74) && metrics.localResistance < 0.52;
        const gateReady = nurseryMode && p.horizonNurseryGateEnabled !== false && metrics.compactness >= nearThreshold && metrics.localResistance < 0.62;
        if (!horizonCrossing && !gateReady && s.status !== 'horizon-bound') continue;
        const score = this.seedletNurseryScore(s, shell, metrics) - scorePenalty + (horizonCrossing ? 0.12 : 0);
        if (horizonCrossing || score >= minScoreBase || s.status === 'horizon-bound') candidates.push({ s, score, horizonCrossing });
      }
      let captured = 0;
      if (candidates.length) {
        candidates.sort((a, b) => b.score - a.score);
        for (const item of candidates) {
          if (captured >= effectiveLimit) break;
          const alreadyOnShell = item.s.status === 'horizon-bound' && item.s.horizon && item.s.horizon.shellId === shell.id;
          const available = item.s.status !== 'horizon-bound' || alreadyOnShell;
          if (!available) continue;
          this.bindSeedletToHorizon(item.s, shell, metrics, item.horizonCrossing ? 'horizon-crossing' : 'nursery-gate');
          captured++;
        }
      }
      const h = this.ensureHorizonState();
      h.lastNurseryCaptures = captured;
      h.lastNurseryCaptureCycle = captured ? (this.state.cycle || 0) : (h.lastNurseryCaptureCycle || -Infinity);
      h.lastCaptureLimit = effectiveLimit;
      h.lastCaptureOverlock = Number(overlock.toFixed(5));
      h.lastCaptureBlocked = captured > 0 ? null : h.lastCaptureBlocked;
      if (captured > 0) h.mode = nurseryMode ? 'horizon-nursery-gate' : 'horizon-capture';
      this.paroleHorizonSeedlets(metrics.compactness || 0, 'post-capture-maintenance');
      const counts = this.recountSeedletStatuses();
      h.horizonBoundSeedlets = counts['horizon-bound'] || 0;
      return captured;
    }

    recountSeedletStatuses() {
      const seedlets = (this.state.atlas && this.state.atlas.seedlets) || [];
      const statuses = {};
      for (const s of seedlets) statuses[s.status || 'dormant'] = (statuses[s.status || 'dormant'] || 0) + 1;
      if (!this.state.stats) this.state.stats = {};
      this.state.stats.seedlets = seedlets.length;
      this.state.stats.seedletStatuses = statuses;
      const h = this.ensureHorizonState();
      h.horizonBoundSeedlets = statuses['horizon-bound'] || 0;
      return statuses;
    }

    maybeWhiteHoleRelease(shell, metrics) {
      const h = this.ensureHorizonState();
      const p = this.state.params || {};
      const threshold = Number(p.horizonReleaseThreshold) || 0.78;
      const cooldown = 520;
      const boundOnShell = (this.state.atlas && this.state.atlas.seedlets || []).filter(s => s.status === 'horizon-bound' && s.horizon && s.horizon.shellId === shell.id);
      const matureBound = boundOnShell.some(s => Number(s.horizon && s.horizon.localClock || 0) >= 0.64 || ((this.state.epoch || 0) - Number(s.horizon && s.horizon.crossed || this.state.epoch)) >= 96);
      if (!matureBound) return false;
      if ((this.state.cycle || 0) - (shell.lastRelease || -Infinity) < cooldown) return false;
      if ((this.state.cycle || 0) - (h.lastReleaseCycle || -Infinity) < Math.floor(cooldown * 0.35)) return false;
      if ((shell.releaseReadiness || 0) < threshold || (shell.age || 0) < 64) return false;
      if (!this.state.atlas) this.state.atlas = { anchors: [], packets: [], seedlets: [], ancestry: [], notes: [] };
      const strength = Core.clamp((shell.releaseReadiness || 0) * 0.42 + (shell.scarMemory || 0) * 0.30, 0.08, 1.0);
      const release = {
        id: 'white-' + Core.hashString(this.state.seed + ':' + shell.id + ':' + this.state.epoch).toString(36),
        x: Core.wrapUnit((shell.x || 0) + Math.cos((shell.tileSeed || 1) * 0.00013 + shell.age * 0.017) * (shell.radius || 0.08) * 0.34),
        y: Core.wrapUnit((shell.y || 0) + Math.sin((shell.tileSeed || 1) * 0.00017 + shell.age * 0.019) * (shell.radius || 0.08) * 0.34),
        radius: Core.clamp((shell.radius || 0.08) * (1.15 + shell.scarPermeability * 0.85), 0.012, 0.42),
        strength,
        score: Core.clamp((shell.releaseReadiness || 0) + (shell.shellDensity || 0) * 0.22, 0.12, 1.4),
        phase: (this.state.time || 0) + (shell.tileSeed || 0) * 0.00001,
        hits: 1,
        born: this.state.epoch,
        lastSeen: this.state.epoch,
        kind: 'white-hole',
        criticality: Core.clamp01((metrics && metrics.criticality || 0) * 0.65 + (shell.shellDensity || 0) * 0.35),
        shellId: shell.id,
        scarDepth: shell.scarDepth,
        scarPermeability: shell.scarPermeability
      };
      this.state.atlas.anchors.push(release);
      const seedlets = (this.state.atlas.seedlets || []);
      const drainLimit = Math.max(1, Math.round(Number(p.horizonReleaseDrainLimit) || 10));
      let drained = 0;
      for (const s of seedlets) {
        if (drained >= drainLimit) break;
        if (s.status === 'horizon-bound' && s.horizon && s.horizon.shellId === shell.id) {
          s.status = 'white-hole-released';
          s.horizon = Object.assign({}, s.horizon || {}, { released: this.state.epoch, releaseShellId: shell.id });
          s.productivity = Number(Core.clamp((s.productivity || 0) + 0.08 + shell.scarPermeability * 0.10, 0, 6).toFixed(5));
          s.resonance = Number(Core.clamp01((s.resonance || 0) + 0.06 + shell.shellDensity * 0.04).toFixed(5));
          s.energy = Number(Core.clamp((s.energy || 0.5) + 0.12, 0, Number(p.seedletEnergyMax) || 2.25).toFixed(5));
          drained++;
        }
      }
      release.drainedSeedlets = drained;
      shell.lastRelease = this.state.cycle || 0;
      shell.scarDepth *= 0.82;
      shell.scarPermeability *= 0.70;
      shell.status = 'white-hole-release';
      h.releases = (h.releases || 0) + 1;
      h.lastReleaseCycle = this.state.cycle || 0;
      h.mode = 'white-hole-release';
      if (Core.reserveAnchors) this.state.atlas.anchors = Core.reserveAnchors(this.state.atlas.anchors, this.state.params);
      this.maybeSplitSuperbasinFromShell(shell, release);
      this.toast('White-hole release: compressed shell signature recoupled into the field.');
      return true;
    }

    dominantSuperbasinAnchor() {
      const anchors = (this.state.atlas && this.state.atlas.anchors || []).filter(a => a && a.kind !== 'white-hole');
      if (!anchors.length) return null;
      const ranked = anchors.slice().sort((a, b) => {
        const ar = Math.log2(2 + (a.hits || 0)) * 0.42 + (a.criticality || 0) * 0.28 + (a.strength || 0) * 0.18 + (a.score || 0) * 0.12;
        const br = Math.log2(2 + (b.hits || 0)) * 0.42 + (b.criticality || 0) * 0.28 + (b.strength || 0) * 0.18 + (b.score || 0) * 0.12;
        return br - ar;
      });
      return ranked[0];
    }

    updateProtoAttractionBalance() {
      const p = this.state.params || {};
      const basin = this.ensureSuperbasinState();
      const h = this.ensureHorizonState();
      const anchors = (this.state.atlas && this.state.atlas.anchors || []).filter(a => a && a.kind !== 'white-hole');
      const top = this.dominantSuperbasinAnchor();
      const totalHits = anchors.reduce((acc, a) => acc + Math.max(1, Number(a.hits || 1)), 0);
      const topShare = top ? Core.clamp01((Number(top.hits || 1)) / Math.max(1, totalHits)) : 0;
      const shells = (h.shells || []);
      const scarMean = shells.length ? shells.reduce((acc, sh) => acc + Core.clamp01((sh.scarDepth || 0) / 0.24 + (sh.scarMemory || 0) * 0.45), 0) / shells.length : 0;
      const portals = (this.state.driver && this.state.driver.portals) || [];
      const uniqueSources = new Set(portals.map(p => this.portalSourceKey(p))).size;
      const portalDiversity = portals.length ? Core.clamp01(uniqueSources / Math.max(6, Math.min(64, Number(this.state.params.portalUniqueSourceQuota) || 24))) : 0;
      const avgCoupling = shells.length ? shells.reduce((acc, sh) => acc + Core.clamp01(sh.outwardCoupling == null ? 1 : sh.outwardCoupling), 0) / shells.length : 1;
      const s = this.state.stats || {};
      const seedlets = (this.state.atlas && this.state.atlas.seedlets || []);
      const resonant = seedlets.filter(s => s.status === 'resonant' || s.status === 'reproductive').length;
      const seedletDensity = Core.clamp01(seedlets.length / Math.max(1, Number(p.maxSeedlets) || 192));
      const nurseryReadiness = Core.clamp01(resonant / Math.max(1, seedlets.length));
      const maxHitShare = Core.clamp(Number(p.dominantBasinMaxHitShare) || 0.72, 0.20, 0.98);
      const diversityFloor = Core.clamp(Number(p.superbasinDiversityFloor) || 0.18, 0, 0.65);
      const overlock = Core.clamp01((topShare - maxHitShare) / Math.max(0.04, 1 - maxHitShare));
      const superbasinMass = Core.clamp01(topShare * (2.8 - overlock * 1.15) + (top ? (top.criticality || 0) * 0.25 + (top.strength || 0) * 0.12 : 0));
      const capture = Core.clamp(0.24 * (s.coherence || 0) + 0.22 * (s.cavity || 0) + 0.22 * superbasinMass + 0.18 * scarMean + 0.08 * seedletDensity + 0.06 * nurseryReadiness, 0, 3);
      const escape = Core.clamp(0.30 * portalDiversity + 0.24 * avgCoupling + 0.20 * (1 - topShare) + 0.16 * (1 - (s.cavity || 0)) + 0.10 * Math.max(0, 1 - scarMean) + overlock * diversityFloor, 0, 3);
      const proto = Core.clamp01(capture / Math.max(1e-6, capture + escape));
      basin.overlock = Number(overlock.toFixed(5));
      basin.diversityPressure = Number((overlock * diversityFloor).toFixed(5));
      basin.dominantAnchorId = top ? top.id : null;
      basin.topHitShare = topShare;
      basin.protoAttraction = Core.lerp(Number(basin.protoAttraction) || 0.5, proto, 0.08);
      basin.mode = overlock > 0.01 ? 'superbasin-diversity-stabilizing' : (basin.protoAttraction > 0.56 && topShare > 0.08 ? 'superbasin-rim-learning' : 'baby-curriculum');
      h.lastProtoAttraction = basin.protoAttraction;
      h.lastCapture = capture;
      h.lastEscape = escape;
      if (p.protoAttractionEnabled !== false && this.autoEvolve) {
        const rate = Core.clamp(Number(p.protoAttractionLearningRate) || 0.012, 0, 0.08);
        const center = Core.clamp(Number(p.protoAttractionCenter) || 0.5, 0.2, 0.8);
        const gravityMin = 0.32, gravityMax = 0.92;
        const targetGravity = gravityMin + Core.clamp01(center + (basin.protoAttraction - center) * 1.18) * (gravityMax - gravityMin);
        p.gravity = Core.clamp(Core.lerp(Number(p.gravity) || 0.5, targetGravity, rate), gravityMin, gravityMax);
        const targetThreshold = Core.clamp(0.5 + (basin.protoAttraction - center) * 0.18 - (s.cavity || 0) * 0.025, 0.34, 0.68);
        p.threshold = Core.clamp(Core.lerp(Number(p.threshold) || 0.5, targetThreshold, rate * 0.55), 0.25, 0.85);
        const targetFlow = Core.clamp(1.05 + (center - basin.protoAttraction) * 0.72 + portalDiversity * 0.30, 0.38, 2.9);
        p.flow = Core.clamp(Core.lerp(Number(p.flow) || 1.0, targetFlow, rate * 0.35), 0.05, 3.5);
      }
      return { top, topShare, proto: basin.protoAttraction, capture, escape, portalDiversity, scarMean };
    }

    updateSuperbasinRimReachability() {
      const p = this.state.params || {};
      if (p.horizonRimEnabled === false) return null;
      const basin = this.ensureSuperbasinState();
      const h = this.ensureHorizonState();
      const top = this.dominantSuperbasinAnchor();
      if (!top) return null;
      const cycle = this.state.cycle || 0;
      if (cycle - (basin.lastMapped || -Infinity) < 18) return null;
      basin.lastMapped = cycle;
      const proto = Number(basin.protoAttraction || h.lastProtoAttraction || 0.5);
      const topShare = Number(basin.topHitShare || 0);
      const matureEnough = topShare > 0.035 || (top.hits || 0) > 180 || proto > 0.52 || (this.state.driver && this.state.driver.annealing && this.state.driver.annealing.state === 'superbasin-lock');
      if (!matureEnough) return null;
      const rimScars = basin.rimScars || [];
      let best = null;
      const n = 12;
      const radius = Core.clamp((top.radius || 0.18) * (1.24 + topShare * 1.9), 0.05, 0.62);
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2 + (top.phase || 0) * 0.11;
        const x = Core.wrapUnit((top.x || 0) + Math.cos(angle) * radius);
        const y = Core.wrapUnit((top.y || 0) + Math.sin(angle) * radius);
        const sample = Core.sampleRawField(x, y, this.state.time || 0, this.state, this.runtime);
        const score = Core.clamp(0.24 * sample.potential + 0.20 * sample.cavity + 0.20 * sample.filament + 0.16 * (sample.criticality || 0) + 0.14 * (top.criticality || 0) + 0.06 * proto, 0, 1.6);
        const id = 'rim-' + top.id + '-' + i.toString(36);
        let scar = rimScars.find(r => r.id === id);
        if (!scar) {
          scar = { id, x, y, angle, score: 0, scarDepth: 0, age: 0, lastSeen: this.state.epoch, parentAnchorId: top.id };
          rimScars.push(scar);
        }
        const approach = Number(p.horizonRimApproachThreshold) || 0.56;
        const excess = Math.max(0, score - approach);
        scar.x = Core.wrapLerp(scar.x || x, x, 0.08); scar.y = Core.wrapLerp(scar.y || y, y, 0.08);
        scar.score = Core.lerp(scar.score || 0, score, 0.16);
        scar.scarDepth = Core.clamp((scar.scarDepth || 0) * 0.998 + excess * (Number(p.horizonRimScarWeight) || 0.18) * 0.018, 0, 8);
        scar.age = (scar.age || 0) + 1;
        scar.lastSeen = this.state.epoch;
        if (!best || (scar.score + scar.scarDepth * 0.6) > (best.score + best.scarDepth * 0.6)) best = scar;
      }
      basin.rimScars = rimScars.filter(r => (this.state.epoch - (r.lastSeen || 0)) < 900 || (r.scarDepth || 0) > 0.015).sort((a, b) => (b.score + b.scarDepth) - (a.score + a.scarDepth)).slice(0, 96);
      const candidateThreshold = Number(p.horizonCandidateThreshold) || 0.62;
      const maxHitShare = Core.clamp(Number(p.dominantBasinMaxHitShare) || 0.72, 0.20, 0.98);
      const overlocked = topShare > maxHitShare;
      const eligibleScars = basin.rimScars.slice(0, overlocked ? 4 : 2).filter(r => r && (r.score >= candidateThreshold || r.scarDepth > 0.012 || overlocked || (h.insideHorizon && r.score > candidateThreshold * 0.82)));
      for (const scar of eligibleScars) {
        const dx = Core.wrapDelta(scar.x, top.x || 0), dy = Core.wrapDelta(scar.y, top.y || 0);
        const mag = Math.max(1e-6, Math.hypot(dx, dy));
        const farX = Core.wrapUnit(scar.x + (dx / mag) * radius * 0.82);
        const farY = Core.wrapUnit(scar.y + (dy / mag) * radius * 0.82);
        const candidateScore = Core.clamp(scar.score * 0.72 + scar.scarDepth * 0.38 + proto * 0.22 + (overlocked ? 0.06 : 0), 0, 1.8);
        const cid = 'horizon-' + top.id + '-' + Math.round(((scar.angle || 0) % (Math.PI * 2)) * 1000).toString(36);
        let c = basin.horizonCandidates.find(c => c.id === cid);
        if (!c) { c = { id: cid, x: farX, y: farY, score: 0, scarDepth: 0, parentAnchorId: top.id, lastSeen: this.state.epoch }; basin.horizonCandidates.push(c); }
        c.x = Core.wrapLerp(c.x || farX, farX, 0.10); c.y = Core.wrapLerp(c.y || farY, farY, 0.10);
        c.score = Core.lerp(c.score || 0, candidateScore, 0.12);
        c.scarDepth = Core.clamp((c.scarDepth || 0) * 0.999 + scar.scarDepth * 0.018, 0, 8);
        c.lastSeen = this.state.epoch;
        c.telemetrySource = overlocked ? 'diversity-stabilizer' : 'rim-scar';
        this.injectOrUpdateHorizonCandidateAnchor(c, top);
      }
      basin.horizonCandidates = (basin.horizonCandidates || []).filter(c => (this.state.epoch - (c.lastSeen || 0)) < 1200 || (c.scarDepth || 0) > 0.015).sort((a, b) => (b.score + b.scarDepth) - (a.score + a.scarDepth)).slice(0, 32);
      return best;
    }

    injectOrUpdateHorizonCandidateAnchor(candidate, parent) {
      if (!candidate || !this.state.atlas) return;
      const anchors = this.state.atlas.anchors;
      const id = 'hc-' + candidate.id;
      let a = anchors.find(a => a.id === id);
      if (!a) {
        a = { id, x: candidate.x, y: candidate.y, radius: 0.18, strength: 0.05, score: 0.2, phase: (parent && parent.phase) || 0, hits: 1, born: this.state.epoch, lastSeen: this.state.epoch, kind: 'horizon-candidate', criticality: 0.5, superbasinParentId: parent && parent.id, rimScarDepth: 0, protoAttraction: 0.5 };
        anchors.push(a);
      }
      a.x = Core.wrapLerp(a.x || candidate.x, candidate.x, 0.12);
      a.y = Core.wrapLerp(a.y || candidate.y, candidate.y, 0.12);
      a.radius = Core.clamp(0.10 + candidate.scarDepth * 0.16 + candidate.score * 0.045, 0.035, 0.36);
      a.strength = Core.clamp(Core.lerp(a.strength || 0.05, 0.08 + candidate.score * 0.24 + candidate.scarDepth * 0.08, 0.10), 0.025, 0.62);
      a.score = Core.clamp(Core.lerp(a.score || 0.2, candidate.score, 0.12), 0.1, 1.8);
      a.criticality = Core.clamp01(Core.lerp(a.criticality || 0.5, 0.5 + candidate.score * 0.28, 0.10));
      a.rimScarDepth = candidate.scarDepth;
      a.protoAttraction = this.state.superbasin ? this.state.superbasin.protoAttraction : 0.5;
      a.hits = Math.max(1, a.hits || 1);
      a.lastSeen = this.state.epoch;
      a.superbasinParentId = parent && parent.id;
    }

    maybeSplitSuperbasinFromShell(shell, releaseAnchor) {
      const basin = this.ensureSuperbasinState();
      const p = this.state.params || {};
      const threshold = Number(p.superbasinSplitThreshold) || 0.86;
      const score = (shell.releaseReadiness || 0) * 0.72 + (shell.scarDepth || 0) * 0.14 + (basin.protoAttraction || 0.5) * 0.26;
      if (score < threshold) return false;
      if ((this.state.cycle || 0) - (basin.lastSplitCycle || -Infinity) < 1200) return false;
      const anchors = this.state.atlas && this.state.atlas.anchors;
      if (!anchors) return false;
      const baseX = releaseAnchor ? releaseAnchor.x : shell.x;
      const baseY = releaseAnchor ? releaseAnchor.y : shell.y;
      const count = 3;
      for (let i = 0; i < count; i++) {
        const th = (i / count) * Math.PI * 2 + (shell.tileSeed || 0) * 0.00001;
        anchors.push({
          id: 'split-' + Core.hashString(this.state.seed + ':' + shell.id + ':' + i + ':' + this.state.epoch).toString(36),
          x: Core.wrapUnit((baseX || 0) + Math.cos(th) * (shell.radius || 0.12) * 0.92),
          y: Core.wrapUnit((baseY || 0) + Math.sin(th) * (shell.radius || 0.12) * 0.92),
          radius: Core.clamp((shell.radius || 0.12) * 0.62, 0.025, 0.24),
          strength: Core.clamp(0.10 + score * 0.20, 0.08, 0.52),
          score: Core.clamp(score * (0.78 + i * 0.04), 0.20, 1.40),
          phase: th,
          hits: 1,
          born: this.state.epoch,
          lastSeen: this.state.epoch,
          kind: i === 0 ? 'superbasin-child' : 'keyhole',
          criticality: Core.clamp01((shell.shellDensity || 0) * 0.45 + (releaseAnchor && releaseAnchor.criticality || 0.5) * 0.55),
          shellId: shell.id,
          scarDepth: shell.scarDepth,
          scarPermeability: shell.scarPermeability
        });
      }
      basin.splits = (basin.splits || 0) + 1;
      basin.lastSplitCycle = this.state.cycle || 0;
      basin.mode = 'superbasin-split';
      if (Core.reserveAnchors) this.state.atlas.anchors = Core.reserveAnchors(anchors, this.state.params);
      this.toast('Superbasin split: horizon recoupling seeded child basins beyond the first rim.');
      return true;
    }

    updateHorizonShells(dt) {
      const p = this.state.params || {};
      const h = this.ensureHorizonState();
      this.updateProtoAttractionBalance();
      this.updateSuperbasinRimReachability();
      if (p.horizonEnabled === false) return;
      const shells = h.shells;
      for (const sh of shells) {
        sh.age = (sh.age || 0) + 1;
        if ((this.state.epoch || 0) - (sh.lastSeen || 0) > 8) {
          sh.scarDepth = Math.max(0, (sh.scarDepth || 0) * 0.996);
          sh.scarMemory = Math.max(0, (sh.scarMemory || 0) * 0.9985);
          sh.outwardCoupling = Core.lerp(sh.outwardCoupling || 1, 1, 0.006);
          sh.localResistance = Core.lerp(sh.localResistance || 1, 1, 0.004);
          sh.releaseReadiness = Math.max(0, (sh.releaseReadiness || 0) * 0.998);
          if (sh.scarDepth < 0.015 && sh.scarMemory < 0.02) sh.status = 'fading-scar';
        }
      }
      const allAnchors = (this.state.atlas && this.state.atlas.anchors || []);
      const priority = allAnchors.filter(a => a && (a.kind === 'horizon-candidate' || a.kind === 'superbasin-child' || a.kind === 'white-hole')).concat(allAnchors.slice(0, Math.min(48, allAnchors.length)));
      const seenAnchorIds = new Set();
      const anchors = priority.filter(a => { if (!a || seenAnchorIds.has(a.id)) return false; seenAnchorIds.add(a.id); return true; });
      let best = null;
      let bound = 0;
      for (const a of anchors) {
        if (!a || a.kind === 'white-hole') continue;
        const m = this.horizonMetricsForAnchor(a);
        if (!m) continue;
        if (!best || m.compactness > best.compactness) best = m;
        const enter = Number(p.horizonThreshold) || 0.74;
        const exit = Math.min(enter - 0.04, Number(p.horizonExitThreshold) || 0.58);
        const horizonReady = h.insideHorizon ? m.compactness >= exit : m.compactness >= enter;
        const approachReady = (a.kind === 'horizon-candidate' || a.kind === 'superbasin-child') && m.compactness >= (Number(p.horizonRimApproachThreshold) || 0.56);
        const isDominant = this.state.superbasin && this.state.superbasin.dominantAnchorId && this.state.superbasin.dominantAnchorId === a.id;
        const scarReady = Math.max(Number(a.scarDepth || 0), Number(a.rimScarDepth || 0)) >= 0.012;
        const nurseryReady = p.horizonNurseryGateEnabled !== false && (h.insideHorizon || isDominant || scarReady) && m.compactness >= (Number(p.horizonNurseryGateThreshold) || 0.70);
        if (horizonReady || approachReady || nurseryReady) {
          const shell = this.touchHorizonShell(m, dt);
          if (horizonReady) {
            bound += this.updateHorizonSeedlets(shell, m, 'horizon-crossing');
            this.maybeWhiteHoleRelease(shell, m);
          } else if (nurseryReady) {
            bound += this.updateHorizonSeedlets(shell, m, 'nursery-gate');
          }
        }
      }
      h.shells = shells.filter(sh => (sh.scarDepth || 0) > 0.01 || ((this.state.epoch || 0) - (sh.lastSeen || 0)) < 240).sort((a, b) => (b.scarDepth + b.releaseReadiness) - (a.scarDepth + a.releaseReadiness)).slice(0, Math.max(4, Math.round(Number(p.horizonMaxShells) || 24)));
      if (best) {
        h.lastCompactness = best.compactness;
        h.lastResistance = best.localResistance;
        h.lastCoupling = best.outwardCoupling;
        const enter = Number(p.horizonThreshold) || 0.74;
        const freezeExit = Number(p.horizonFreezeExitCompactness) || 0.69;
        const exit = Math.min(enter - 0.04, Math.max(Number(p.horizonExitThreshold) || 0.58, freezeExit));
        if (!h.insideHorizon && best.compactness >= enter) {
          h.insideHorizon = true;
          h.chartWraps = (h.chartWraps || 0) + 1;
          h.lastChartWrapCycle = this.state.cycle || 0;
        } else if (h.insideHorizon && best.compactness <= exit) {
          h.insideHorizon = false;
        }
        if (h.insideHorizon && best.compactness >= freezeExit) h.mode = best.outwardCoupling < 0.28 ? 'horizon-freeze' : 'chart-wrapped-interior';
        else if (h.insideHorizon && best.compactness < freezeExit) { h.insideHorizon = false; h.mode = 'horizon-rim-recovery'; }
        else if (best.compactness >= (Number(p.horizonRimApproachThreshold) || 0.56)) h.mode = 'approach-collapse';
        else if (h.mode !== 'white-hole-release') h.mode = 'open-field';
      }
      if (best) this.paroleHorizonSeedlets(best.compactness, 'horizon-maintenance');
      this.recountSeedletStatuses();
      h.horizonBoundSeedlets = (this.state.stats.seedletStatuses && this.state.stats.seedletStatuses['horizon-bound']) || 0;
    }

    maxMiningDepthIndex() {
      return Math.max(1, Math.min(2, Math.round(Number(this.state.params.miningLayerLimit || 3)) - 1));
    }

    currentDepth() {
      return this.view && this.view.active ? Math.max(0, Math.round(Number(this.view.depth) || 0)) : 0;
    }

    pushViewTrace(view) {
      this.ensureMiningState();
      const v = view || this.view || { active: false, originX: 0, originY: 0, scale: 1, depth: 0, label: 'parent' };
      const rec = {
        active: !!v.active,
        originX: Number(v.originX) || 0,
        originY: Number(v.originY) || 0,
        scale: Number(v.scale) || 1,
        depth: Number(v.depth) || 0,
        label: v.label || 'parent',
        epoch: this.state.epoch,
        cycle: this.state.cycle
      };
      this.viewStack = (this.viewStack || []).concat([rec]).slice(-3);
      this.state.mining.originTrace = (this.state.mining.originTrace || []).concat([rec]).slice(-12);
    }

    layerRelativeAddress(addr) {
      const a = addr || { originX: 0, originY: 0, scale: 0.12, foldLevel: 1 };
      if (!this.view || !this.view.active) return Object.assign({}, a);
      const sc = Math.max(0.004, Number(this.view.scale) || 1);
      return Object.assign({}, a, {
        originX: Core.wrapUnit((Number(this.view.originX) || 0) + Core.wrapDelta(Number(a.originX) || 0, 0) * sc),
        originY: Core.wrapUnit((Number(this.view.originY) || 0) + Core.wrapDelta(Number(a.originY) || 0, 0) * sc),
        scale: Math.max(0.004, (Number(a.scale) || 0.08) * sc),
        foldLevel: Math.min(this.maxMiningDepthIndex(), this.currentDepth() + 1)
      });
    }

    chooseFilamentTarget(options = {}) {
      const baseThreshold = Number(this.state.params.filamentClimbThreshold) || 0.58;
      const threshold = Number.isFinite(options.threshold) ? options.threshold : baseThreshold;
      const postBugeyeMode = !!options.postBugeye;
      const anchors = (this.state.atlas && this.state.atlas.anchors || [])
        .filter(a => a && (a.kind === 'filament' || a.kind === 'bugeye-echo' || a.kind === 'livingword-seam' || a.kind === 'wrap-filament'))
        .map(a => {
          const local = this.view && this.view.active ? Math.max(0, 1 - Math.hypot(Core.wrapDelta(a.x || 0, this.view.originX || 0), Core.wrapDelta(a.y || 0, this.view.originY || 0)) / Math.max(0.04, (this.view.scale || 1) * 2.4)) : 0.5;
          const recent = postBugeyeMode ? Core.clamp01(1 - Math.max(0, (this.state.epoch || 0) - (a.born || 0)) / 1200) : 0;
          const kindBoost = a.kind === 'livingword-seam' || a.kind === 'wrap-filament' || a.kind === 'bugeye-echo' ? 0.08 : 0;
          const score = (a.criticality || 0) * 0.40 + (a.score || 0) * 0.22 + Math.min(1, (a.hits || 0) / 220) * 0.18 + (a.strength || 0) * 0.10 + local * 0.10 + recent * 0.10 + kindBoost;
          return { a, score, local, recent };
        })
        .sort((x, y) => y.score - x.score);
      const pickRow = anchors[0] && anchors[0].score >= threshold ? anchors[0] : null;
      if (!pickRow) return null;
      const pick = pickRow.a;
      return { address: this.layerRelativeAddress({ originX: pick.x || 0, originY: pick.y || 0, scale: Math.max(0.012, (pick.radius || 0.14) * 0.52), foldLevel: this.currentDepth() + 1 }), anchor: pick, score: pickRow.score, threshold, postBugeye: postBugeyeMode };
    }

    startDimensionalDig() {
      if (this.currentDepth() >= this.maxMiningDepthIndex()) {
        this.toast('Dimensional mining limit reached: 3 observation layers are active/maxed.');
        return;
      }
      const target = this.resolveBoundaryTarget('dig');
      target.address.scale = Math.max(0.004, (target.address.scale || 0.08) * (0.74 + (Number(this.state.params.dimensionalDigBias) || 0.42) * 0.38));
      this.startBoundaryTransit(target, 'dig', 'Dimensional dig: committing primary observation into the next lower slice.');
    }

    startFilamentClimb(targetOverride = null, options = {}) {
      if (this.currentDepth() >= this.maxMiningDepthIndex()) {
        this.toast('Filament climb blocked: mining is capped at 3 layers for now.');
        return false;
      }
      const target = targetOverride || this.chooseFilamentTarget(options);
      if (!target) {
        this.toast('No substantial filament meets the climb threshold yet. Let bugeye/LivingWord gather more seam evidence.');
        return false;
      }
      const mode = target.postBugeye || options.postBugeye ? 'Post-Bugeye filament climb' : 'Filament climb';
      this.startBoundaryTransit(target, 'filament', `${mode}: entering a substantial seam to test adjacent-world connection.`);
      return true;
    }

    startLayerReturn() {
      if (!this.view || !this.view.active || !this.viewStack || !this.viewStack.length) {
        this.startBoundaryReturn();
        return;
      }
      const now = performance.now();
      this.boundaryTransit = { started: now, duration: 3400, committed: false, returnOneLayer: true, fromView: Object.assign({}, this.view), fromZoom: this.camera.zoom };
      this.camera.shot = null;
      document.body.classList.add('boundary-transit');
      const b = $('#layer-return');
      if (b) b.classList.add('active-shot');
      this.toast('Layer return: following origin trace one layer upward.');
    }

    finishLayerReturn() {
      const prev = (this.viewStack || []).pop() || { active: false, originX: 0, originY: 0, scale: 1, depth: 0, label: 'parent' };
      this.view = Object.assign({ active: false, originX: 0, originY: 0, scale: 1, depth: 0, label: 'parent' }, prev);
      const miningState = this.ensureMiningState();
      miningState.layerDepth = this.view && this.view.active ? Math.max(0, Math.round(Number(this.view.depth) || 0)) : 0;
      miningState.routine.lastReturnCycle = this.state.cycle;
      miningState.routine.pendingPostBugeyeFilamentTarget = null;
      miningState.routine.pendingPostBugeyeFilamentExpireCycle = -Infinity;
      this.camera.x = 0; this.camera.y = 0; this.camera.zoom = this.view.active ? 1.06 : 1.0;
      this.camera.targetX = 0; this.camera.targetY = 0; this.camera.targetZoom = this.camera.zoom;
      this.grid = null;
      this.resetParticles(true);
      this.autosave();
      this.updateVisualToggleButtons();
    }

    startBoundaryTransit(target, kind, message) {
      const now = performance.now();
      this.boundaryTransit = { started: now, duration: kind === 'filament' ? 4600 : 4200, target, committed: false, miningKind: kind || 'punch', fromView: Object.assign({}, this.view), fromZoom: this.camera.zoom };
      this.camera.shot = null;
      document.body.classList.add('boundary-transit');
      const b = kind === 'filament' ? $('#filament-climb') : $('#boundary-punch');
      if (b) b.classList.add('active-shot');
      this.toast(message || 'Boundary transit: entering critical seam.');
    }

    livingWordTrace(frame, echoes, novelty) {
      const q = frame.summary || this.computeBugeyeFrame(frame);
      const depth = Math.max(0, Number(frame.depth) || 0);
      const alpha = 1 / (1 + depth);
      const beta = Core.clamp01(1 - Math.abs((q.cavity || 0) - (this.state.stats.cavity || 0)) * 3.2);
      const gamma = Core.clamp01((q.potential || 0) * 0.42 + (q.filament || 0) * 0.58);
      const delta = Core.clamp01(novelty == null ? this.atlasNoveltyAt(frame.originX, frame.originY, frame.scale) : novelty);
      const epsilon = 0.5 + 0.5 * Math.sin((frame.phase || 0) + this.state.time * 0.137);
      const digamma = Core.clamp01((q.criticalMax || 0) * 0.62 + (q.critical || 0) * 0.38);
      const zeta = Core.clamp01(1 - Math.hypot(q.phaseX || 0, q.phaseY || 0) * 0.18);
      const eta = Core.clamp01(0.5 + 0.5 * Math.cos((q.phaseX || 0) * Math.PI - (q.phaseY || 0) * Math.PI));
      const theta = Core.clamp01(gamma * 0.30 + digamma * 0.35 + beta * 0.20 + Math.min(1, (echoes || 0) / 3) * 0.15);
      const sabbath = Core.clamp01(Math.sqrt(Math.max(0, theta * alpha)) * (0.72 + beta * 0.28));
      const iota = Core.clamp01(Math.abs(theta - sabbath) * 1.8 + delta * 0.25);
      const gammaNext = Core.clamp01(iota * 0.35 + theta * 0.40 + digamma * 0.25);
      const relock = Core.clamp01(sabbath * 0.28 + iota * 0.22 + gammaNext * 0.32 + delta * 0.18);
      return { alpha, beta, gamma, delta, epsilon, digamma, zeta, eta, theta, sabbath, iota, gammaNext, relock, depth, frameId: frame.id, x: frame.originX, y: frame.originY, scale: frame.scale };
    }

    applyLivingWordSurvey(ranked) {
      if (!this.state.params.livingWordEnabled) return { traces: 0, edges: 0, relocks: 0 };
      this.ensureMiningState();
      const traces = ranked.map(r => Object.assign(this.livingWordTrace(r.frame, r.echoes, r.novelty), { score: r.score })).sort((a, b) => b.relock - a.relock);
      this.state.mining.livingWordTraces = (this.state.mining.livingWordTraces || []).concat(traces).slice(-96);
      let edges = 0, relocks = 0;
      for (let i = 0; i < traces.length; i++) {
        const t = traces[i];
        if (t.relock >= 0.54) {
          relocks += 1;
          this.injectLivingWordSeam(t, i === 0 ? 'livingword-seam' : 'wrap-filament');
        }
        for (let j = i + 1; j < traces.length; j++) {
          const u = traces[j];
          const samePenalty = Math.hypot(Core.wrapDelta(t.x, u.x), Core.wrapDelta(t.y, u.y)) < Math.max(0.01, Math.min(t.scale, u.scale) * 0.35) ? 0.28 : 0;
          const connection = Core.clamp01(0.24 * (1 - Math.abs(t.theta - u.theta)) + 0.22 * (1 - Math.abs(t.sabbath - u.sabbath)) + 0.20 * (1 - Math.abs(t.iota - u.iota)) + 0.18 * (1 - Math.abs(t.gammaNext - u.gammaNext)) + 0.16 * Math.max(t.delta, u.delta) - samePenalty);
          if (connection > 0.62) {
            edges += 1;
            this.state.mining.seamEdges.push({ a: t.frameId, b: u.frameId, score: connection, x: Core.wrapMidpoint(t.x, u.x), y: Core.wrapMidpoint(t.y, u.y), depth: Math.max(t.depth, u.depth), epoch: this.state.epoch });
          }
        }
      }
      this.state.mining.seamEdges = (this.state.mining.seamEdges || []).slice(-96);
      const bestRelock = traces.length ? traces[0].relock : 0;
      this.state.mining.lastRelock = bestRelock;
      if (bestRelock > 0.52) {
        const lift = Number(this.state.params.livingWordLearningLift) || 0.0012;
        this.state.params.learningRate = Math.max(Number(this.state.params.learningRate) || 0.0001, Number(this.state.params.annealingMinLearningRate || 0.0001) + bestRelock * lift);
      }
      return { traces: traces.length, edges, relocks };
    }

    injectLivingWordSeam(trace, kind) {
      if (!this.state.atlas) this.state.atlas = { anchors: [], packets: [], seedlets: [], ancestry: [], notes: [] };
      const weight = Core.clamp(Number(this.state.params.livingWordAtlasWeight) || 0.10, 0.01, 0.30);
      this.state.atlas.anchors.push({ id: 'lw-' + Core.hashString(this.state.seed + ':' + trace.frameId + ':' + this.state.epoch + ':' + kind).toString(36), x: Core.wrapUnit(trace.x), y: Core.wrapUnit(trace.y), radius: Core.clamp((trace.scale || 0.04) * 1.25, 0.006, 0.20), strength: Core.clamp(weight * trace.relock, 0.015, 0.20), score: Core.clamp(trace.relock, 0.18, 1.1), phase: trace.theta * Math.PI * 2, hits: 1, born: this.state.epoch, lastSeen: this.state.epoch, kind, criticality: trace.gammaNext, livingWordTrace: trace, sourceDepth: trace.depth });
      this.state.stats.anchors = this.state.atlas.anchors.length;
    }

    ensureBugeyeState() {
      if (!this.state.bugeye || typeof this.state.bugeye !== 'object') this.state.bugeye = {};
      const b = this.state.bugeye;
      b.active = !!b.active;
      b.runs = Number.isFinite(b.runs) ? b.runs : 0;
      b.staleRuns = Number.isFinite(b.staleRuns) ? b.staleRuns : 0;
      b.lastNovelty = Number.isFinite(b.lastNovelty) ? b.lastNovelty : 0;
      b.lastGain = Number.isFinite(b.lastGain) ? b.lastGain : 0;
      b.lastCycle = Number.isFinite(b.lastCycle) ? b.lastCycle : -Infinity;
      b.lastAnchorCount = Number.isFinite(b.lastAnchorCount) ? b.lastAnchorCount : ((this.state.atlas && this.state.atlas.anchors || []).length || 0);
      b.tryAnythingArmed = !!b.tryAnythingArmed;
      b.reason = b.reason || 'idle';
      return b;
    }

    updateBugeyeUI() {
      const b = $('#bugeye-survey');
      if (b) b.textContent = this.bugeye && this.bugeye.active ? 'Bugeye survey: active' : 'Bugeye survey';
      const m = $('#metric-bugeye');
      if (m) {
        const bg = this.bugeye || this.ensureBugeyeState();
        m.textContent = bg.active ? `scan ${this.bugeyeFrames.length || 0}` : `${bg.staleRuns || 0}/3 stale`;
      }
    }

    superbasinSurveyReady() {
      if (!this.autoEvolve || !this.state.params.bugeyeEnabled) return false;
      if (this.boundaryTransit || this.camera.shot || (this.bugeye && this.bugeye.active)) return false;
      const d = this.state.driver || {};
      const a = d.annealing || {};
      const portals = (d.portals || []).length;
      const maxPortals = Math.max(1, Number(this.state.params.maxPortals) || 96);
      const cooldown = Math.max(120, Number(this.state.params.bugeyeCooldownCycles) || 720);
      const inSuperbasin = a.state === 'superbasin-lock' || d.phase === 'drive-through-keyholes';
      const portalSaturated = portals >= maxPortals * 0.82;
      const boredStable = Number(a.boredom || 0) > 100 && portals >= maxPortals * 0.45;
      const mature = Number(a.maturity || 0) > 0.92 || Number(a.learningRate || this.state.params.learningRate || 1) <= (Number(this.state.params.annealingMinLearningRate || 0.0001) * 1.35);
      const effectiveCooldown = boredStable ? Math.max(180, cooldown * 0.45) : cooldown;
      return inSuperbasin && mature && (portalSaturated || boredStable) && (this.state.cycle - (this.bugeye.lastCycle || -Infinity)) > effectiveCooldown;
    }

    startBugeyeSurvey(reason) {
      if (!this.state.params.bugeyeEnabled) {
        this.toast('Bugeye survey is disabled in params.');
        return;
      }
      this.ensureBugeyeState();
      const views = Math.max(6, Math.min(8, Math.round(Number(this.state.params.bugeyeViews) || 7)));
      this.bugeyeOriginalQuality = Number(this.state.params.renderQuality) || 1;
      const q = Math.min(this.bugeyeOriginalQuality, Number(this.state.params.bugeyeQuality) || 0.65);
      this.applyRenderQuality(q, true);
      this.bugeyeFrames = this.buildBugeyeFrames(views);
      this.bugeye.active = true;
      this.bugeye.reason = reason || 'survey';
      this.bugeye.started = performance.now();
      this.bugeye.lastCycle = this.state.cycle;
      this.bugeye.primaryDepth = this.currentDepth();
      this.bugeye.dwellExtended = false;
      this.bugeye.extraUntil = 0;
      this.bugeye.lastSatisfaction = 0;
      this.camera.shot = null;
      document.body.classList.add('bugeye-mode');
      const b = $('#bugeye-survey');
      if (b) b.classList.add('active-shot');
      this.state.params.learnDuty = Math.min(Number(this.state.params.learnDuty) || 0.2, 0.30);
      this.schedulerMode = 'continuous';
      this.state.params.schedulerMode = 'continuous';
      this.updateSchedulerUI();
      this.updateBugeyeUI();
      this.toast(`Bugeye survey: ${views} lower slices scanning before any nonlinear escape.`);
    }

    portalSourceKey(portal) {
      return String((portal && (portal.fromAnchorId || portal.anchorId || portal.sourceAnchorId)) || 'unknown');
    }

    selectDiversePortals(limit) {
      const d = this.state.driver || {};
      const diversity = Core.clamp(Number(this.state.params.portalDiversity) || 0.55, 0, 1);
      const uniqueQuota = Math.max(4, Math.round(Number(this.state.params.portalUniqueSourceQuota) || 24));
      const maxPerSource = Math.max(1, Math.ceil(Math.max(limit || 8, Number(this.state.params.maxPortals) || 96) * Core.lerp(0.58, 0.14, diversity)));
      const raw = (d.portals || []).filter(p => p && p.toAddress).slice().sort((a, b) => {
        const ac = ((a.score || 0) * (a.stability || 1)) / (1 + (a.useCount || 0) * (0.05 + diversity * 0.10));
        const bc = ((b.score || 0) * (b.stability || 1)) / (1 + (b.useCount || 0) * (0.05 + diversity * 0.10));
        return bc - ac;
      });
      const out = [];
      const counts = new Map();
      const used = new Set();
      const seen = new Set();
      const key = p => {
        const a = p.toAddress || {};
        return `${this.portalSourceKey(p)}:${Math.round((a.originX || 0) / 0.018)}:${Math.round((a.originY || 0) / 0.018)}:${Math.round(Math.log2(Math.max(0.002, a.scale || 0.08)) * 5)}`;
      };
      const add = p => {
        const k = key(p);
        if (seen.has(k)) return false;
        const src = this.portalSourceKey(p);
        if ((counts.get(src) || 0) >= maxPerSource) return false;
        out.push(p); seen.add(k); used.add(src); counts.set(src, (counts.get(src) || 0) + 1);
        return true;
      };
      for (const p of raw) {
        if (out.length >= limit || used.size >= uniqueQuota) break;
        if (!used.has(this.portalSourceKey(p))) add(p);
      }
      for (const p of raw) {
        if (out.length >= limit) break;
        add(p);
      }
      return out;
    }

    buildBugeyeFrames(count) {
      const target = this.resolveBoundaryTarget();
      const d = this.state.driver || {};
      const portals = this.selectDiversePortals(Math.max(count * 3, 12));
      const anchors = (this.state.atlas && this.state.atlas.anchors || []).slice().sort((a, b) => ((b.criticality || 0) + (b.score || 0) * 0.25) - ((a.criticality || 0) + (a.score || 0) * 0.25));
      const frames = [];
      const rand = Core.mulberry32(Core.hashString(this.state.seed + ':bugeye:' + this.state.epoch + ':' + this.state.cycle));
      for (let i = 0; i < count; i++) {
        const portal = portals[i % Math.max(1, portals.length)] || null;
        const anchor = anchors[(i * 7) % Math.max(1, anchors.length)] || null;
        const base = portal && portal.toAddress ? portal.toAddress : (i === 0 ? target.address : null);
        const th = (i / count) * Math.PI * 2 + rand() * 0.31;
        const jitter = 0.025 + 0.045 * rand();
        let ox = base ? Number(base.originX || 0) : (anchor ? Number(anchor.x || 0) : 0);
        let oy = base ? Number(base.originY || 0) : (anchor ? Number(anchor.y || 0) : 0);
        let rawScale = base ? Number(base.scale || 0.08) : (anchor ? Number(anchor.radius || 0.18) * 0.72 : 0.18);
        if (this.view && this.view.active) {
          const layerScale = Math.max(0.004, Number(this.view.scale) || 1);
          ox = Core.wrapUnit((Number(this.view.originX) || 0) + Core.wrapDelta(ox, 0) * layerScale);
          oy = Core.wrapUnit((Number(this.view.originY) || 0) + Core.wrapDelta(oy, 0) * layerScale);
          rawScale *= layerScale;
        }
        const scale = Core.clamp(rawScale * (1.4 + i * 0.17), 0.004, 0.42);
        frames.push({
          id: 'eye-' + i,
          originX: Core.wrapUnit(ox + Math.cos(th) * jitter),
          originY: Core.wrapUnit(oy + Math.sin(th) * jitter),
          scale,
          depth: Math.min(this.maxMiningDepthIndex(), this.currentDepth() + Math.max(1, Math.round(Number(base && base.foldLevel || (anchor && anchor.depth) || (i + 1))))),
          phase: th,
          source: portal ? 'portal' : (anchor ? 'anchor' : 'fallback'),
          parentAnchorId: portal ? (portal.fromAnchorId || portal.anchorId || null) : (anchor ? anchor.id : null),
          grid: null,
          summary: null
        });
      }
      return frames;
    }

    computeBugeyeFrame(frame) {
      const w = Math.max(42, Math.round((this.grid ? this.grid.width : this.state.params.fieldWidth) / 3.2));
      const h = Math.max(28, Math.round((this.grid ? this.grid.height : this.state.params.fieldHeight) / 3.2));
      const pot = new Float32Array(w * h);
      const fil = new Float32Array(w * h);
      const cav = new Float32Array(w * h);
      const phase = new Float32Array(w * h);
      const critical = new Float32Array(w * h);
      let pMean = 0, fMean = 0, cMean = 0, critMean = 0, critMax = 0, phaseX = 0, phaseY = 0;
      for (let y = 0; y < h; y++) {
        const ny = (y / h) * 2 - 1;
        for (let x = 0; x < w; x++) {
          const nx = (x / w) * 2 - 1;
          const idx = y * w + x;
          const wx = Core.wrapUnit(frame.originX + nx * frame.scale);
          const wy = Core.wrapUnit(frame.originY + ny * frame.scale);
          const s = Core.sampleRawField(wx, wy, this.state.time, this.state, this.runtime);
          pot[idx] = s.potential;
          fil[idx] = s.filament;
          cav[idx] = s.cavity;
          phase[idx] = s.phase;
          critical[idx] = s.criticality || 0;
          pMean += pot[idx]; fMean += fil[idx]; cMean += cav[idx]; critMean += critical[idx]; critMax = Math.max(critMax, critical[idx]);
          phaseX += Math.cos((s.phase || 0) * Math.PI);
          phaseY += Math.sin((s.phase || 0) * Math.PI);
        }
      }
      const n = Math.max(1, w * h);
      frame.grid = { width: w, height: h, potential: pot, filament: fil, cavity: cav, phase, critical };
      frame.summary = {
        potential: pMean / n,
        filament: fMean / n,
        cavity: cMean / n,
        critical: critMean / n,
        criticalMax: critMax,
        phaseX: phaseX / n,
        phaseY: phaseY / n
      };
      return frame.summary;
    }

    bugeyeSurveySatisfaction() {
      const frames = this.bugeyeFrames || [];
      if (!frames.length) return 0;
      let best = 0;
      for (const f of frames) {
        if (!f.summary) continue;
        const q = f.summary;
        const novelty = this.atlasNoveltyAt(f.originX, f.originY, f.scale);
        best = Math.max(best, (q.critical || 0) * 0.30 + (q.filament || 0) * 0.25 + (q.potential || 0) * 0.18 + (q.criticalMax || 0) * 0.17 + novelty * 0.10);
      }
      return Core.clamp01(best);
    }

    adaptiveBugeyeThreshold() {
      const p = this.state.params || {};
      const d = this.state.driver || {};
      const a = d.annealing || {};
      let t = Number(p.bugeyeSatisfactionThreshold) || 0.42;
      const reason = String((this.bugeye && this.bugeye.reason) || '');
      if (reason.includes('superbasin')) t -= 0.10;
      if (reason.includes('boredom') || Number(a.boredom || 0) > 100) t -= 0.08;
      if ((this.bugeye && this.bugeye.staleRuns || 0) > 0) t -= Math.min(0.10, (this.bugeye.staleRuns || 0) * 0.035);
      return Core.clamp(t, 0.26, 0.90);
    }

    shouldForceBugeyeDwell() {
      const d = this.state.driver || {};
      const a = d.annealing || {};
      const reason = String((this.bugeye && this.bugeye.reason) || '');
      const inSuperbasin = a.state === 'superbasin-lock' || d.phase === 'drive-through-keyholes';
      return inSuperbasin && (Number(a.boredom || 0) > 100 || reason.includes('superbasin') || reason.includes('boredom'));
    }

    updateBugeyeSurvey() {
      if (!this.bugeye || !this.bugeye.active) return;
      const now = performance.now();
      const age = now - (this.bugeye.started || now);
      let computed = 0;
      for (const frame of this.bugeyeFrames) {
        this.computeBugeyeFrame(frame);
        computed += 1;
      }
      this.bugeye.samples = (this.bugeye.samples || 0) + computed;
      const satisfaction = this.bugeyeSurveySatisfaction();
      this.bugeye.lastSatisfaction = satisfaction;
      const baseDuration = Number(this.state.params.bugeyeDurationMs) || 5200;
      const threshold = this.adaptiveBugeyeThreshold();
      const forcedDwell = this.shouldForceBugeyeDwell();
      if (age > baseDuration && !this.bugeye.dwellExtended && (satisfaction >= threshold || forcedDwell)) {
        this.bugeye.dwellExtended = true;
        const dwellMult = Math.max(0.25, Number(this.state.params.bugeyeDwellMultiplier) || 1.0);
        this.bugeye.extraUntil = now + age * (forcedDwell && satisfaction < threshold ? dwellMult * 0.85 : dwellMult);
        this.toast(`${forcedDwell && satisfaction < threshold ? 'Bugeye forced wake' : 'Bugeye satisfied'} at ${(age / 1000).toFixed(1)}s; dwelling another ${Math.max(0, ((this.bugeye.extraUntil - now) / 1000)).toFixed(1)}s to observe.`);
      }
      if (age > baseDuration && (!this.bugeye.extraUntil || now >= this.bugeye.extraUntil)) this.finishBugeyeSurvey();
      else this.updateBugeyeUI();
    }

    frameSignatureDistance(a, b) {
      if (!a || !b) return 1;
      return Math.abs(a.potential - b.potential) * 1.6 + Math.abs(a.filament - b.filament) * 1.1 + Math.abs(a.cavity - b.cavity) * 1.2 + Math.abs(a.critical - b.critical) * 1.5 + Math.hypot(a.phaseX - b.phaseX, a.phaseY - b.phaseY) * 0.35;
    }

    finishBugeyeSurvey() {
      const beforeAnchors = (this.state.atlas && this.state.atlas.anchors || []).length;
      const frames = this.bugeyeFrames || [];
      for (const f of frames) if (!f.summary) this.computeBugeyeFrame(f);
      const ranked = frames.slice().map(f => {
        let echoes = 0;
        for (const other of frames) if (other !== f && this.frameSignatureDistance(f.summary, other.summary) < 0.18) echoes += 1;
        const novelty = this.atlasNoveltyAt(f.originX, f.originY, f.scale);
        const score = (f.summary.critical || 0) * 0.33 + (f.summary.filament || 0) * 0.24 + (f.summary.potential || 0) * 0.20 + Math.min(1, echoes / 3) * 0.13 + novelty * 0.10;
        return { frame: f, score, echoes, novelty };
      }).sort((a, b) => b.score - a.score);
      const lw = this.applyLivingWordSurvey(ranked);
      let extensions = 0;
      for (const r of ranked.slice(0, Math.max(2, Math.min(4, Math.ceil(frames.length / 2))))) {
        if (r.score < 0.28) continue;
        this.injectBugeyeAtlasExtension(r.frame, r.score, r.echoes, r.novelty);
        extensions += 1;
      }
      if (this.state.atlas && Core.reserveAnchors) this.state.atlas.anchors = Core.reserveAnchors(this.state.atlas.anchors, this.state.params);
      const afterAnchors = (this.state.atlas && this.state.atlas.anchors || []).length;
      const novelty = ranked.length ? ranked[0].novelty : 0;
      const gain = extensions + Math.max(0, afterAnchors - beforeAnchors) * 0.5 + novelty;
      this.maybeArmPostBugeyeFilamentClimb(gain, novelty, lw, extensions, ranked);
      this.bugeye.active = false;
      this.bugeye.runs = (this.bugeye.runs || 0) + 1;
      this.bugeye.lastNovelty = novelty;
      this.bugeye.lastGain = gain;
      this.bugeye.staleRuns = gain < 1.05 ? (this.bugeye.staleRuns || 0) + 1 : 0;
      this.bugeye.tryAnythingArmed = this.bugeye.staleRuns >= 3;
      if (this.bugeyeOriginalQuality) this.applyRenderQuality(this.bugeyeOriginalQuality, true);
      this.bugeyeOriginalQuality = null;
      this.bugeyeFrames = [];
      document.body.classList.remove('bugeye-mode');
      const b = $('#bugeye-survey');
      if (b) b.classList.remove('active-shot');
      this.grid = null;
      this.autosave();
      this.updateBugeyeUI();
      this.toast(this.bugeye.tryAnythingArmed ? 'Bugeye found no traction three times. Try-anything escape is now armed.' : `Bugeye complete: ${extensions} atlas extensions, ${lw.relocks} LivingWord relocks, ${lw.edges} seam edges.`);
    }

    makePendingPostBugeyeFilamentTarget(ranked, threshold, depth) {
      const existing = this.chooseFilamentTarget({ threshold, postBugeye: true });
      if (existing) {
        return {
          address: Object.assign({}, existing.address),
          anchor: existing.anchor ? {
            id: existing.anchor.id,
            x: existing.anchor.x,
            y: existing.anchor.y,
            radius: existing.anchor.radius,
            kind: existing.anchor.kind,
            score: existing.anchor.score,
            strength: existing.anchor.strength,
            criticality: existing.anchor.criticality
          } : null,
          score: Number(existing.score) || 0,
          threshold,
          postBugeye: true,
          pending: true
        };
      }
      const best = (ranked || []).find(r => r && r.frame && r.score >= 0.24) || (ranked || [])[0];
      if (!best || !best.frame) return null;
      const f = best.frame;
      const score = Core.clamp01((Number(best.score) || 0) * 0.70 + (Number(best.novelty) || 0) * 0.30);
      return {
        address: {
          originX: Core.wrapUnit(Number(f.originX) || 0),
          originY: Core.wrapUnit(Number(f.originY) || 0),
          scale: Math.max(0.006, Math.min(0.18, (Number(f.scale) || 0.04) * 1.35)),
          foldLevel: Math.min(this.maxMiningDepthIndex(), Math.max(1, Number(depth) || this.currentDepth() || 1))
        },
        anchor: {
          id: 'pending-' + (f.id || 'bugeye'),
          x: Core.wrapUnit(Number(f.originX) || 0),
          y: Core.wrapUnit(Number(f.originY) || 0),
          radius: Math.max(0.006, Math.min(0.18, (Number(f.scale) || 0.04) * 1.35)),
          kind: 'bugeye-echo',
          score,
          strength: score,
          criticality: f.summary ? (f.summary.criticalMax || f.summary.critical || 0) : 0
        },
        score,
        threshold,
        postBugeye: true,
        pending: true
      };
    }

    maybeArmPostBugeyeFilamentClimb(gain, novelty, lw, extensions, ranked = []) {
      const reason = String((this.bugeye && this.bugeye.reason) || '');
      const depth = Math.max(this.currentDepth(), Math.round(Number(this.bugeye && this.bugeye.primaryDepth) || 0));
      if (depth <= 0) return false;
      if (!/mining-layer|deep-mining-layer|layer-boredom/.test(reason)) return false;
      const satisfaction = Number(this.bugeye && this.bugeye.lastSatisfaction) || 0;
      const dwellExtended = !!(this.bugeye && this.bugeye.dwellExtended);
      const useful = (Number(gain) || 0) >= 1.0 || (Number(novelty) || 0) >= 0.25 || satisfaction >= (Number(this.state.params.bugeyeSatisfactionThreshold) || 0.42) || dwellExtended || (lw && ((lw.relocks || 0) > 0 || (lw.edges || 0) > 0)) || (extensions || 0) > 0;
      if (!useful) return false;
      const mining = this.ensureMiningState();
      const r = mining.routine;
      const window = Math.max(180, Number(this.state.params.autoMiningPostBugeyeClimbWindowCycles) || 760);
      const relax = Core.clamp(Number(this.state.params.autoMiningPostBugeyeClimbRelax) || 0.24, 0, 0.50);
      const relaxedThreshold = Math.max(0.34, (Number(this.state.params.filamentClimbThreshold) || 0.58) - relax);
      const pendingTarget = this.makePendingPostBugeyeFilamentTarget(ranked, relaxedThreshold, depth);
      r.postBugeyeClimbEligibleCycle = this.state.cycle || 0;
      r.postBugeyeClimbExpireCycle = (this.state.cycle || 0) + window;
      r.postBugeyeClimbUsed = false;
      r.postBugeyeClimbScore = Core.clamp01((Number(gain) || 0) * 0.28 + (Number(novelty) || 0) * 0.24 + satisfaction * 0.22 + Math.min(1, ((lw && lw.relocks) || 0) / 2) * 0.16 + Math.min(1, (extensions || 0) / 4) * 0.10);
      r.pendingPostBugeyeFilamentTarget = pendingTarget;
      r.pendingPostBugeyeFilamentExpireCycle = (this.state.cycle || 0) + window;
      r.successfulDigBugeyeCount = (r.successfulDigBugeyeCount || 0) + 1;
      r.lastRoutine = depth >= this.maxMiningDepthIndex() ? 'post-bugeye-climb-pending-at-depth-cap' : 'post-bugeye-climb-eligible';
      return true;
    }

    atlasNoveltyAt(x, y, scale) {
      const anchors = (this.state.atlas && this.state.atlas.anchors) || [];
      let nearest = Infinity;
      for (const a of anchors) nearest = Math.min(nearest, Math.hypot(Core.wrapDelta(x, a.x || 0), Core.wrapDelta(y, a.y || 0)) / Math.max(0.012, scale || a.radius || 0.08));
      return Core.clamp01(nearest / 6);
    }

    injectBugeyeAtlasExtension(frame, score, echoes, novelty) {
      if (!this.state.atlas) this.state.atlas = { anchors: [], packets: [], seedlets: [], ancestry: [], notes: [] };
      const p = this.state.params;
      const weight = Core.clamp(Number(p.bugeyeAtlasWeight) || 0.12, 0.02, 0.32);
      const anchors = this.state.atlas.anchors;
      let best = null, bestD = Infinity;
      for (const a of anchors) {
        const d = Math.hypot(Core.wrapDelta(frame.originX, a.x || 0), Core.wrapDelta(frame.originY, a.y || 0));
        if (d < bestD) { bestD = d; best = a; }
      }
      const radius = Core.clamp((frame.scale || 0.06) * (1.5 + Math.min(2, echoes) * 0.25), 0.01, 0.28);
      if (best && bestD < Math.max(0.025, radius * 0.72)) {
        best.strength = Core.clamp((best.strength || 0.15) + weight * score * 0.08, 0.02, 1.5);
        best.score = Core.lerp(best.score || 0.4, Math.max(best.score || 0, score), weight);
        best.criticality = Core.lerp(best.criticality || 0, frame.summary.criticalMax || 0, weight);
        best.lastSeen = this.state.epoch;
        best.bugeyeEchoes = (best.bugeyeEchoes || 0) + echoes;
        best.bugeyeNovelty = novelty;
      } else {
        anchors.push({
          id: 'bugeye-' + Core.hashString(this.state.seed + ':' + frame.id + ':' + this.state.epoch).toString(36),
          x: Core.wrapUnit(frame.originX),
          y: Core.wrapUnit(frame.originY),
          radius,
          strength: Core.clamp(weight * (0.75 + score), 0.03, 0.28),
          score: Core.clamp(score, 0.2, 1.25),
          phase: Math.atan2(frame.summary.phaseY || 0, frame.summary.phaseX || 1),
          hits: 1,
          born: this.state.epoch,
          lastSeen: this.state.epoch,
          kind: echoes >= 2 ? 'bugeye-echo' : 'bugeye-probe',
          criticality: frame.summary.criticalMax || frame.summary.critical || 0,
          bugeyeEchoes: echoes,
          bugeyeNovelty: novelty,
          sourceDepth: frame.depth || 0,
          sourceScale: frame.scale || 0
        });
      }
      this.state.stats.anchors = anchors.length;
    }

    applyTryAnythingIfHopeless() {
      if (!this.bugeye || !this.bugeye.tryAnythingArmed) return;
      const a = this.state.driver && this.state.driver.annealing ? this.state.driver.annealing : null;
      if (a) {
        a.temperature = Math.max(Number(a.temperature || 0), 0.82);
        a.learningRate = Math.max(Number(a.learningRate || this.state.params.learningRate || 0), Math.min(0.08, Number(this.state.params.annealingMaxLearningRate || 0.5)));
        a.state = 'try-anything-escape';
        a.boredom = 0;
      }
      this.state.params.learningRate = Math.max(Number(this.state.params.learningRate || 0.0001), 0.035);
      this.state.params.warpStrength = Core.clamp((this.state.params.warpStrength || 0.58) + 0.035, 0.05, 1.4);
      this.bugeye.tryAnythingArmed = false;
      this.bugeye.staleRuns = 0;
      this.toast('Hopelessness gate opened: trying anything once, then returning to survey discipline.');
    }

    driveSeed() {
      if (this.pauseBudgetFreezeEnabled()) return null;
      if (!Driver || !this.memory || this.state.params.driverEnabled === false) return null;
      this.lastDriver = Driver.step(this.state, this.runtime, this.memory, this.observer);
      return this.lastDriver;
    }

    toggleDriver() {
      this.state.params.driverEnabled = this.state.params.driverEnabled === false ? true : false;
      if (Driver) Driver.ensureDriverState(this.state);
      this.autosave();
      this.toast(this.state.params.driverEnabled === false ? 'Autonomous driver paused.' : 'Autonomous driver active: seeking critical line.');
    }

    toggleNested() {
      this.state.params.nestedEnabled = this.state.params.nestedEnabled === false ? true : false;
      if (Seedlets) Seedlets.ensureSeedlets(this.state);
      this.autosave();
      this.toast(this.state.params.nestedEnabled === false ? 'Nested seed projection paused.' : 'Nested seed projection active: child seeds remain lazy until touched.');
    }

    autoLearnBudget() {
      const d = this.state.driver || {};
      const a = d.annealing || {};
      const seedlets = ((this.state.atlas && this.state.atlas.seedlets) || []).length;
      const portals = ((d.portals || []).length);
      const boredom = Number(a.boredom || 0);
      let budget = 1 + Math.round((Number(this.state.params.learnDuty) || 0.2) * 7);
      if (seedlets < 12) budget += 2;
      if (portals < 4) budget += 1;
      if (boredom > 240) budget += 2;
      if (a.nurseryState === 'nursery-rescue') budget += Math.max(2, Math.round(a.childBudgetMultiplier || 1));
      if (this.pauseBudgetFreezeEnabled()) return this.clampEffectiveBudget(budget);
      return Math.max(1, Math.min(14, budget));
    }

    updateAutoMiningRoutine(displayActive, lowStructure, bored, tooHot) {
      if (this.pauseBudgetFreezeEnabled() && this.state.params.pauseFreezesMiningRoutines !== false) return;
      if (!this.autoEvolve || this.state.params.autoMiningEnabled === false) return;
      if (displayActive || tooHot) return;
      const mining = this.ensureMiningState();
      const routine = mining.routine;
      const cycle = this.state.cycle || 0;
      const depth = this.currentDepth();
      const d = this.state.driver || {};
      const a = d.annealing || {};
      const portals = (d.portals || []).length;
      const anchors = (this.state.atlas && this.state.atlas.anchors || []).length;
      const seamEdges = (mining.seamEdges || []).length;
      const relock = Number(mining.lastRelock || 0);
      const cooldown = Math.max(180, Number(this.state.params.autoMiningCooldownCycles) || 1440);
      const stayCycles = Math.max(120, Number(this.state.params.autoMiningStayCycles) || 620);
      const bugeyeDelay = Math.max(12, Number(this.state.params.autoMiningBugeyeDelayCycles) || 110);
      const saturated = portals >= Math.max(4, (Number(this.state.params.maxPortals) || 96) * 0.45);
      const stableEnough = saturated || bored || relock > 0.46 || Number(a.maturity || 0) > 0.82 || anchors > 48;
      const pendingPostTarget = routine.pendingPostBugeyeFilamentTarget && cycle <= (routine.pendingPostBugeyeFilamentExpireCycle || -Infinity) && !routine.postBugeyeClimbUsed ? routine.pendingPostBugeyeFilamentTarget : null;
      if (depth <= 0 && pendingPostTarget && (cycle - routine.lastReturnCycle) > 60) {
        routine.lastDigCycle = cycle;
        routine.lastClimbCycle = cycle;
        routine.postBugeyeClimbUsed = true;
        routine.pendingPostBugeyeFilamentTarget = null;
        routine.lastRoutine = 'auto-pending-post-bugeye-filament-climb';
        this.startFilamentClimb(pendingPostTarget, { postBugeye: true });
        return;
      }
      const needsRoutine = !lowStructure && stableEnough && (cycle - routine.lastDigCycle) > cooldown;
      if (depth <= 0 && needsRoutine) {
        const filamentTarget = this.chooseFilamentTarget();
        const chance = Core.clamp(Number(this.state.params.autoMiningFilamentChance) || 0.58, 0, 1);
        const deterministic = Core.mulberry32(Core.hashString(this.state.seed + ':auto-mine:' + cycle + ':' + anchors + ':' + portals));
        const preferFilament = !!filamentTarget && (seamEdges > 8 || relock > 0.44 || deterministic() < chance);
        routine.lastDigCycle = cycle;
        routine.runs = (routine.runs || 0) + 1;
        routine.lastRoutine = preferFilament ? 'auto-filament-climb' : 'auto-dimensional-dig';
        if (preferFilament) {
          routine.lastClimbCycle = cycle;
          this.startFilamentClimb();
        } else {
          this.startDimensionalDig();
        }
        return;
      }
      if (depth > 0) {
        const age = cycle - Math.max(routine.lastLayerEnterCycle || 0, 0);
        const cooldownBugeye = cycle - (routine.lastLayerBugeyeCycle || -Infinity);
        if (age > bugeyeDelay && cooldownBugeye > Math.max(180, bugeyeDelay) && !(this.bugeye && this.bugeye.active)) {
          routine.lastLayerBugeyeCycle = cycle;
          this.startBugeyeSurvey(depth >= 2 ? 'auto-deep-mining-layer' : 'auto-mining-layer');
          return;
        }
        const canClimb = depth < this.maxMiningDepthIndex() && age > Math.max(180, bugeyeDelay * 1.8) && (cycle - routine.lastClimbCycle) > Math.max(180, cooldown * 0.24);
        const postWindow = cycle <= (routine.postBugeyeClimbExpireCycle || -Infinity) && !routine.postBugeyeClimbUsed;
        const relax = Core.clamp(Number(this.state.params.autoMiningPostBugeyeClimbRelax) || 0.24, 0, 0.50);
        const relaxedThreshold = Math.max(0.34, (Number(this.state.params.filamentClimbThreshold) || 0.58) - relax);
        const postTarget = postWindow ? (routine.pendingPostBugeyeFilamentTarget || this.chooseFilamentTarget({ threshold: relaxedThreshold, postBugeye: true })) : null;
        const normalTarget = !postTarget ? this.chooseFilamentTarget() : null;
        if (canClimb && postTarget) {
          routine.lastClimbCycle = cycle;
          routine.postBugeyeClimbUsed = true;
          routine.pendingPostBugeyeFilamentTarget = null;
          routine.lastRoutine = 'auto-post-bugeye-filament-climb';
          this.startFilamentClimb(postTarget, { postBugeye: true });
          return;
        }
        if (canClimb && normalTarget && (seamEdges > 12 || relock > 0.50 || bored)) {
          routine.lastClimbCycle = cycle;
          routine.lastRoutine = 'auto-filament-deeper';
          this.startFilamentClimb(normalTarget);
          return;
        }
        const stale = this.bugeye && !this.bugeye.active && Number(this.bugeye.lastGain || 0) < 1.05 && Number(this.bugeye.lastSatisfaction || 0) < 0.35;
        const overstayed = age > stayCycles || (stale && age > Math.max(220, stayCycles * 0.45));
        if (overstayed && (cycle - routine.lastReturnCycle) > 120) {
          routine.lastRoutine = 'auto-layer-return';
          if (depth > 1) this.startLayerReturn();
          else this.startBoundaryReturn();
        }
      }
    }

    updateAutoEvolution() {
      if (this.pauseBudgetFreezeEnabled()) {
        this.enforcePauseBudgetClamp();
        return;
      }
      this.autoLearn = true;
      this.state.params.autoEvolve = true;
      this.state.params.driverEnabled = true;
      this.state.params.nestedEnabled = true;
      if (Driver) Driver.ensureDriverState(this.state);
      if (Seedlets) Seedlets.ensureSeedlets(this.state);

      const s = this.state.stats || {};
      const d = this.state.driver || {};
      const a = d.annealing || {};
      const anchors = (this.state.atlas && this.state.atlas.anchors || []).length;
      const seedlets = (this.state.atlas && this.state.atlas.seedlets || []).length;
      const portals = (d.portals || []).length;
      const lowStructure = anchors < 32 || portals < 3 || seedlets < 8;
      const bored = Number(a.boredom || 0) > 100;
      const rescue = a.nurseryState === 'nursery-rescue';
      const tooHot = Number(a.temperature || 0) > 0.72 && anchors > 48;
      const displayActive = this.camera.shot || this.boundaryTransit || (this.bugeye && this.bugeye.active);
      this.updateAutoMiningRoutine(displayActive, lowStructure, bored, tooHot);
      if (this.superbasinSurveyReady()) this.startBugeyeSurvey('auto-superbasin');
      if (this.bugeye && this.bugeye.tryAnythingArmed && (this.frame % 180 === 0)) this.applyTryAnythingIfHopeless();
      if (this.state.params.schedulerAutotune !== false) {
        let desiredDuty = (lowStructure || bored || rescue) && !displayActive && !tooHot ? 0.72 : 0.26;
        if (tooHot) desiredDuty = 0.20;
        if (this.bugeye && this.bugeye.active) desiredDuty = Math.min(desiredDuty, 0.30);
        if (this.view && this.view.active && bored && !displayActive && (this.state.cycle - (this.bugeye.lastCycle || -Infinity)) > Math.max(240, (Number(this.state.params.bugeyeCooldownCycles) || 720) * 0.55)) this.startBugeyeSurvey('auto-layer-boredom');
        this.state.params.learnDuty = Core.clamp(Core.lerp(Number(this.state.params.learnDuty) || 0.20, desiredDuty, 0.025), 0.20, 0.80);
        this.schedulerMode = 'continuous';
        this.state.params.schedulerMode = 'continuous';
        this.updateSchedulerUI();
      }
      // Fruitful change means keep the field near a textured, learnable band instead of freezing or saturating.
      if (s.coherence > 0.92 && (this.frame % 90 === 0)) this.state.params.warpStrength = Core.clamp((this.state.params.warpStrength || 0.58) + 0.01, 0.05, 1.4);
      if (s.filament < 0.18 && (this.frame % 120 === 0)) this.state.params.filamentMix = Core.clamp((this.state.params.filamentMix || 0.62) + 0.015, 0, 1);
      if (s.cavity > 0.58 && (this.frame % 120 === 0)) this.state.params.threshold = Core.clamp((this.state.params.threshold || 0.54) + 0.006, 0.25, 0.85);
    }

    startZoomShot(direction) {
      const now = performance.now();
      const inward = direction !== 'out';
      const anchor = (this.state.driver && this.state.driver.activeAddress) || null;
      this.camera.shot = {
        type: inward ? 'zoom-in' : 'zoom-out',
        started: now,
        duration: 6500,
        fromX: this.camera.x,
        fromY: this.camera.y,
        fromZoom: this.camera.zoom,
        toX: inward && anchor ? this.fieldToView(anchor.originX || 0, anchor.originY || 0)[0] : 0,
        toY: inward && anchor ? this.fieldToView(anchor.originX || 0, anchor.originY || 0)[1] : 0,
        toZoom: inward ? Math.max(1.85, Math.min(4.2, this.camera.zoom * 2.15)) : 1
      };
      this.toast(inward ? 'Cinematic zoom-in shot started.' : 'Cinematic zoom-out shot started.');
    }

    startCinematicPan() {
      const now = performance.now();
      const preferred = (this.state.driver && this.state.driver.activeAddress) || null;
      const center = preferred ? this.fieldToView(preferred.originX || 0, preferred.originY || 0) : [this.camera.x, this.camera.y];
      this.camera.shot = {
        type: 'pan',
        started: now,
        duration: 16000,
        centerX: center[0],
        centerY: center[1],
        fromZoom: this.camera.zoom,
        radius: this.view && this.view.active ? 0.42 : 0.28,
        turns: 0.72
      };
      const b = $('#cinematic-pan');
      if (b) b.classList.add('active-shot');
      this.toast('Cinematic top-down pan started. Press O/P any time to take over zoom.');
    }


    resolveChartWrapSuperbasinTarget() {
      const p = this.state.params || {};
      if (p.chartWrapEnabled === false) return null;
      const basin = this.ensureSuperbasinState();
      const h = this.ensureHorizonState();
      const candidates = (basin.horizonCandidates || []).slice().sort((a, b) => ((b.score || 0) + (b.scarDepth || 0) * 0.55) - ((a.score || 0) + (a.scarDepth || 0) * 0.55));
      const top = candidates[0] || this.dominantSuperbasinAnchor();
      if (!top) return null;
      const compact = Number(h.lastCompactness || 0);
      const proto = Number(basin.protoAttraction || 0.5);
      const follow = Core.clamp(Number(p.superbasinFollowStrength) || 0.42, 0, 1);
      const allow = compact >= (Number(p.horizonRimApproachThreshold) || 0.56) * 0.72 || proto >= 0.50 || (top.kind === 'horizon-candidate');
      if (!allow || follow <= 0) return null;
      const radius = top.radius || 0.12;
      const scale = Core.clamp(radius * (top.kind === 'horizon-candidate' ? 0.58 : 0.72) * (1.0 - 0.18 * follow), 0.006, 0.28);
      return {
        originX: Core.wrapUnit(Number(top.x) || 0),
        originY: Core.wrapUnit(Number(top.y) || 0),
        scale,
        foldLevel: this.currentDepth() + 1,
        sourceKind: top.kind || 'superbasin',
        superbasinFollow: true
      };
    }

    resolveBoundaryTarget(mode) {
      const d = this.state.driver || {};
      const portals = this.selectDiversePortals(12);
      let raw = null, portal = null;
      if (mode === 'dig') raw = this.resolveChartWrapSuperbasinTarget();
      if (!raw && portals[0] && portals[0].toAddress) { raw = portals[0].toAddress; portal = portals[0]; portal.useCount = (portal.useCount || 0) + 1; portal.lastUsed = this.state.epoch; }
      else if (d.activeAddress) raw = d.activeAddress;
      else {
        const a = (this.state.atlas && this.state.atlas.anchors || [])[0];
        raw = a ? { originX: a.x || 0, originY: a.y || 0, scale: Math.max(0.035, (a.radius || 0.18) * 0.68), foldLevel: 1 } : { originX: 0, originY: 0, scale: 0.18, foldLevel: 1 };
      }
      const address = mode === 'top' ? Object.assign({}, raw) : this.layerRelativeAddress(raw);
      return { address, portal };
    }

    startBoundaryPunch() {
      if (this.currentDepth() >= this.maxMiningDepthIndex()) {
        this.toast('Boundary punch is capped at the third observation layer. Use return/climb traces before digging deeper.');
        return;
      }
      const target = this.resolveBoundaryTarget('punch');
      this.startBoundaryTransit(target, 'punch', 'Boundary punch: entering critical seam relative to the current observation layer.');
    }

    startBoundaryReturn() {
      if (!this.view || !this.view.active) {
        this.toast('Already at the top layer.');
        return;
      }
      const now = performance.now();
      this.boundaryTransit = {
        started: now,
        duration: 3800,
        target: null,
        committed: false,
        returnToTop: true,
        fromView: Object.assign({}, this.view),
        fromZoom: this.camera.zoom
      };
      this.camera.shot = null;
      document.body.classList.add('boundary-transit');
      const b = $('#boundary-return');
      if (b) b.classList.add('active-shot');
      this.toast('Boundary return: climbing back through the seam to the parent layer.');
    }

    finishBoundaryReturn() {
      this.view = { active: false, originX: 0, originY: 0, scale: 1, depth: 0, label: 'parent' };
      this.viewStack = [];
      if (this.state.mining) {
        const m = this.ensureMiningState();
        m.layerDepth = 0;
        m.routine.lastReturnCycle = this.state.cycle;
        m.routine.pendingPostBugeyeFilamentTarget = null;
        m.routine.pendingPostBugeyeFilamentExpireCycle = -Infinity;
      }
      this.camera.x = 0;
      this.camera.y = 0;
      this.camera.zoom = 1.0;
      this.camera.targetX = 0;
      this.camera.targetY = 0;
      this.camera.targetZoom = 1.0;
      this.grid = null;
      this.resetParticles(true);
      if (!this.pauseBudgetFreezeEnabled()) this.learn(false, Math.max(1, Math.min(3, this.autoLearnBudget ? this.autoLearnBudget() : 2)));
      else this.enforcePauseBudgetClamp();
      this.autosave();
      this.updateVisualToggleButtons();
    }

    finishBoundaryPunch(transit) {
      const addr = transit && transit.target && transit.target.address ? transit.target.address : { originX: 0, originY: 0, scale: 0.18, foldLevel: 1 };
      const fromView = transit && transit.fromView ? transit.fromView : (this.view || { active: false, scale: 1, depth: 0, label: 'parent' });
      this.pushViewTrace(fromView);
      const parentScale = fromView && fromView.scale ? fromView.scale : 1;
      const depth = Math.min(this.maxMiningDepthIndex(), Math.max((Number(fromView.depth) || 0) + 1, Number(addr.foldLevel) || 1));
      const nextScale = Core.clamp((Number(addr.scale) || 0.08) * (transit && transit.miningKind === 'filament' ? 1.8 : 2.4), 0.004, Math.max(0.75, parentScale * 0.82));
      this.view = {
        active: true,
        originX: Core.wrapUnit(Number(addr.originX) || 0),
        originY: Core.wrapUnit(Number(addr.originY) || 0),
        scale: nextScale,
        depth,
        label: (transit && transit.miningKind === 'filament' ? 'filament layer ' : 'slice layer ') + depth
      };
      const miningState = this.ensureMiningState();
      miningState.layerDepth = depth;
      miningState.routine.lastLayerEnterCycle = this.state.cycle;
      miningState.routine.lastLayerBugeyeCycle = -Infinity;
      miningState.routine.lastRoutine = transit && transit.miningKind ? transit.miningKind : 'punch';
      this.camera.x = 0;
      this.camera.y = 0;
      this.camera.zoom = 1.08;
      this.camera.targetX = 0;
      this.camera.targetY = 0;
      this.camera.targetZoom = 1.08;
      this.grid = null;
      this.resetParticles(true);
      if (!this.pauseBudgetFreezeEnabled()) this.learn(false, Math.max(3, this.autoLearnBudget ? this.autoLearnBudget() : 3));
      else this.enforcePauseBudgetClamp();
      this.autosave();
      this.updateVisualToggleButtons();
    }

    updateCamera(rawDt, now) {
      const cam = this.camera;
      if (!cam) return;
      if (this.pauseBudgetFreezeEnabled() && (this.boundaryTransit || (this.bugeye && this.bugeye.active))) {
        this.enforcePauseBudgetClamp();
        return;
      }
      if (this.boundaryTransit) {
        const tr = this.boundaryTransit;
        const u = Core.clamp01((now - tr.started) / tr.duration);
        cam.targetX = 0;
        cam.targetY = 0;
        const returning = !!(tr.returnToTop || tr.returnOneLayer);
        cam.targetZoom = returning
          ? Core.lerp(tr.fromZoom || cam.zoom || 1, 1.0, u)
          : (u < 0.54 ? 1 + u * 5.6 : 1.08);
        if (u > 0.72 && !tr.committed) {
          tr.committed = true;
          if (tr.returnOneLayer) this.finishLayerReturn();
          else if (tr.returnToTop) this.finishBoundaryReturn();
          else this.finishBoundaryPunch(tr);
        }
        if (u >= 1) {
          this.boundaryTransit = null;
          document.body.classList.remove('boundary-transit');
          const bp = $('#boundary-punch');
          if (bp) bp.classList.remove('active-shot');
          const br = $('#boundary-return');
          if (br) br.classList.remove('active-shot');
          const fc = $('#filament-climb');
          if (fc) fc.classList.remove('active-shot');
          const lr = $('#layer-return');
          if (lr) lr.classList.remove('active-shot');
          this.toast(tr.returnOneLayer ? 'Layer return complete: origin trace restored.' : (tr.returnToTop ? 'Boundary return complete: parent slice active.' : 'Boundary transit complete: observation layer active.'));
        }
      } else if (cam.shot) {
        const sh = cam.shot;
        const u = Core.clamp01((now - sh.started) / sh.duration);
        const ease = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        if (sh.type === 'pan') {
          const th = ease * Math.PI * 2 * sh.turns;
          cam.targetX = Core.wrapUnit(sh.centerX + Math.cos(th) * sh.radius);
          cam.targetY = Core.wrapUnit(sh.centerY + Math.sin(th) * sh.radius * 0.62);
          cam.targetZoom = 1.7 + Math.sin(ease * Math.PI) * 0.72;
        } else {
          cam.targetX = Core.wrapLerp(sh.fromX, sh.toX, ease);
          cam.targetY = Core.wrapLerp(sh.fromY, sh.toY, ease);
          cam.targetZoom = Core.lerp(sh.fromZoom, sh.toZoom, ease);
        }
        if (u >= 1) {
          cam.shot = null;
          const b = $('#cinematic-pan');
          if (b) b.classList.remove('active-shot');
        }
      }
      const settle = 1 - Math.pow(0.0008, Math.max(0, rawDt));
      cam.x = Core.wrapLerp(cam.x, cam.targetX, settle);
      cam.y = Core.wrapLerp(cam.y, cam.targetY, settle);
      cam.zoom = Core.clamp(Core.lerp(cam.zoom, cam.targetZoom, settle), 0.72, 7.5);
    }

    fieldToView(x, y) {
      if (!this.view || !this.view.active) return [Core.wrapUnit(x), Core.wrapUnit(y)];
      const sc = this.view.scale || 1;
      return [Core.clamp(Core.wrapDelta(x, this.view.originX || 0) / sc, -2, 2), Core.clamp(Core.wrapDelta(y, this.view.originY || 0) / sc, -2, 2)];
    }

    updateObserver() {
      if (!this.state.atlas.anchors.length) return;
      const d = this.state.driver;
      if (d && d.activeAddress && this.state.params.driverEnabled !== false) {
        const a = d.activeAddress;
        const temp = this.state.driver && this.state.driver.annealing ? Math.max(0, Math.min(1, Number(this.state.driver.annealing.temperature) || 0.35)) : 0.35;
        const rate = 0.016 * (0.20 + temp * 0.80);
        this.observer.x = Core.wrapLerp(this.observer.x || 0, a.originX || 0, rate);
        this.observer.y = Core.wrapLerp(this.observer.y || 0, a.originY || 0, rate);
        this.observer.scale = Math.max(0.006, Core.lerp(this.observer.scale || 0.2, a.scale || 0.08, rate * 0.875));
        this.observer.foldLevel = Math.round(Core.lerp(this.observer.foldLevel || 0, a.foldLevel || 0, rate * 0.75));
        return;
      }
      const preferred = this.state.atlas.anchors.find(a => a.kind === 'keyhole') || this.state.atlas.anchors[0];
      this.observer.x = Core.wrapLerp(this.observer.x || 0, preferred.x || 0, 0.018);
      this.observer.y = Core.wrapLerp(this.observer.y || 0, preferred.y || 0, 0.018);
      this.observer.scale = Math.max(0.04, Core.lerp(this.observer.scale || 0.2, (preferred.radius || 0.18) * 2.2, 0.02));
    }

    loop(now) {
      const start = performance.now();
      const rawDt = Math.min(0.06, (now - this.lastFrame) / 1000 || 0.016);
      this.lastFrame = now;
      // Physics uses real local time. The timeScale slider is now observer/capture-side only,
      // so it cannot quietly change learning dynamics or horizon causality.
      const simDt = rawDt;
      const visualDt = rawDt * Core.clamp(Number(this.state.params.timeScale) || 1, 0.02, 1.0);
      if (this.running && this.autoEvolve) this.updateAutoEvolution();
      if (!this.running) this.enforcePauseBudgetClamp();
      const action = this.running ? this.schedulerAction() : 'render';
      if (this.running) {
        this.state.time += simDt * this.state.params.flow;
        this.state.cycle += 1;
        this.updateObserver();
      }
      this.updateCamera(rawDt, now);
      if (this.bugeye && this.bugeye.active && (this.running || this.state.params.pauseFreezesBugeyeRoutines === false)) this.updateBugeyeSurvey();

      if (action === 'render' || !this.grid) {
        this.computeGrid();
        if (this.running) {
          this.updateHorizonShells(simDt);
          this.updateParticles(visualDt);
        }
        this.render();
        this.renderTicks += 1;
      }

      if (action === 'learn' && this.autoLearn && this.running) {
        if (!this.grid) this.computeGrid();
        this.driveSeed();
        const extraBudget = this.autoEvolve ? this.autoLearnBudget() : Math.max(1, Math.round((Number(this.state.params.learnDuty) || 0.2) * 6));
        this.learn(false, extraBudget);
        this.updateHorizonShells(simDt);
        this.learnTicks += 1;
      }

      if (this.running && Core.updateFACMedian && this.state.params.facMedianEnabled !== false && (this.state.cycle % Math.max(1, Math.round(Number(this.state.params.facMedianUpdateIntervalCycles) || 90)) === 0)) Core.updateFACMedian(this.state);
      this.updateStatsPanel();
      if (now - this.lastAutosave > 5000) this.autosave();
      this.renderMs = performance.now() - start;
      this.frame += 1;
      requestAnimationFrame(t => this.loop(t));
    }

    computeGrid() {
      const p = this.state.params;
      const w = Math.round(p.fieldWidth);
      const h = Math.round(p.fieldHeight);
      if (!this.grid || this.grid.width !== w || this.grid.height !== h) {
        this.grid = {
          width: w,
          height: h,
          potential: new Float32Array(w * h),
          base: new Float32Array(w * h),
          filament: new Float32Array(w * h),
          cavity: new Float32Array(w * h),
          phase: new Float32Array(w * h),
          critical: new Float32Array(w * h),
          gx: new Float32Array(w * h),
          gy: new Float32Array(w * h)
        };
        this.buffer.width = w;
        this.buffer.height = h;
      }
      const g = this.grid;
      if (this.view && this.view.active) {
        const ox = this.view.originX || 0;
        const oy = this.view.originY || 0;
        const sc = this.view.scale || 1;
        g.toWorld = (lx, ly) => ({ x: Core.wrapUnit(ox + lx * sc), y: Core.wrapUnit(oy + ly * sc) });
        g.radiusScale = sc;
      } else {
        g.toWorld = null;
        g.radiusScale = 1;
      }
      const t = this.state.time;
      for (let y = 0; y < h; y++) {
        const ny = (y / h) * 2 - 1;
        for (let x = 0; x < w; x++) {
          const nx = (x / w) * 2 - 1;
          const idx = y * w + x;
          const vx = this.view && this.view.active ? Core.wrapUnit((this.view.originX || 0) + nx * (this.view.scale || 1)) : nx;
          const vy = this.view && this.view.active ? Core.wrapUnit((this.view.originY || 0) + ny * (this.view.scale || 1)) : ny;
          const s = Core.sampleRawField(vx, vy, t, this.state, this.runtime);
          g.potential[idx] = s.potential;
          g.base[idx] = s.base;
          g.filament[idx] = s.filament;
          g.cavity[idx] = s.cavity;
          g.phase[idx] = s.phase;
          g.critical[idx] = s.criticality || 0;
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          const xm = y * w + ((x - 1 + w) % w);
          const xp = y * w + ((x + 1) % w);
          const ym = ((y - 1 + h) % h) * w + x;
          const yp = ((y + 1) % h) * w + x;
          g.gx[idx] = (g.potential[xp] - g.potential[xm]) * 0.5;
          g.gy[idx] = (g.potential[yp] - g.potential[ym]) * 0.5;
        }
      }
      const summary = Core.summarizeGrid(g);
      this.state.stats.coherence = summary.coherence;
      this.state.stats.filament = summary.filament;
      this.state.stats.cavity = summary.cavity;
    }

    sampleGrid(x, y) {
      const g = this.grid;
      const ux = (Core.wrapUnit(x) + 1) * 0.5;
      const uy = (Core.wrapUnit(y) + 1) * 0.5;
      const fx = ux * g.width;
      const fy = uy * g.height;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const x0 = ((ix % g.width) + g.width) % g.width;
      const y0 = ((iy % g.height) + g.height) % g.height;
      const x1 = (x0 + 1) % g.width;
      const y1 = (y0 + 1) % g.height;
      const tx = fx - ix, ty = fy - iy;
      const i00 = y0 * g.width + x0;
      const i10 = y0 * g.width + x1;
      const i01 = y1 * g.width + x0;
      const i11 = y1 * g.width + x1;
      function bilinear(arr) {
        const a = Core.lerp(arr[i00], arr[i10], tx);
        const b = Core.lerp(arr[i01], arr[i11], tx);
        return Core.lerp(a, b, ty);
      }
      return {
        potential: bilinear(g.potential),
        filament: bilinear(g.filament),
        cavity: bilinear(g.cavity),
        criticality: bilinear(g.critical),
        gx: bilinear(g.gx),
        gy: bilinear(g.gy),
        phase: bilinear(g.phase)
      };
    }

    updateParticles(dt) {
      const p = this.state.params;
      const pts = this.particles;
      const speed = 0.38 * dt;
      const rand = Core.mulberry32(Core.hashString(this.state.seed + ':jitter:' + Math.floor(this.state.cycle / 30)));
      for (let i = 0; i < pts.length; i += 5) {
        let x = pts[i];
        let y = pts[i + 1];
        let vx = pts[i + 2];
        let vy = pts[i + 3];
        let life = pts[i + 4];
        const s = this.sampleGrid(x, y);
        const gx = s.gx * 38;
        const gy = s.gy * 38;
        const curlx = -gy;
        const curly = gx;
        vx = vx * p.viscosity + (gx * p.gravity + curlx * p.swirl) * speed + (rand() - 0.5) * 0.0007;
        vy = vy * p.viscosity + (gy * p.gravity + curly * p.swirl) * speed + (rand() - 0.5) * 0.0007;
        x = Core.wrapUnit(x + vx);
        y = Core.wrapUnit(y + vy);
        life += dt * (0.12 + s.potential * 0.18);
        if (life > 1.8 || s.potential < 0.015) {
          life = rand() * 0.4;
          if (this.state.atlas.anchors.length && rand() < 0.64) {
            const a = this.state.atlas.anchors[Math.floor(rand() * Math.min(24, this.state.atlas.anchors.length))];
            const v = this.fieldToView(a.x || 0, a.y || 0);
            const r = ((a.radius || 0.14) / (this.view && this.view.active ? (this.view.scale || 1) : 1)) * Math.sqrt(rand());
            const th = rand() * Math.PI * 2;
            x = Core.wrapUnit(v[0] + Math.cos(th) * r);
            y = Core.wrapUnit(v[1] + Math.sin(th) * r);
          } else {
            x = rand() * 2 - 1;
            y = rand() * 2 - 1;
          }
          vx = (rand() - 0.5) * 0.002;
          vy = (rand() - 0.5) * 0.002;
        }
        pts[i] = x; pts[i + 1] = y; pts[i + 2] = vx; pts[i + 3] = vy; pts[i + 4] = life;
      }
    }

    render() {
      const g = this.grid;
      const w = g.width, h = g.height;
      const img = this.bctx.createImageData(w, h);
      const d = img.data;
      const exposure = this.state.params.exposure;
      for (let i = 0; i < w * h; i++) {
        const v = Core.clamp01(g.potential[i] * exposure);
        const f = g.filament[i];
        const c = g.cavity[i];
        const ph = 0.5 + 0.5 * g.phase[i];
        const r = Math.floor(8 + 210 * Math.pow(v, 1.7) + 34 * ph);
        const gg = Math.floor(12 + 120 * f + 92 * v);
        const b = Math.floor(22 + 185 * c + 70 * ph);
        const j = i * 4;
        d[j] = Core.clamp(r, 0, 255);
        d[j + 1] = Core.clamp(gg, 0, 255);
        d[j + 2] = Core.clamp(b, 0, 255);
        d[j + 3] = 255;
      }
      this.bctx.putImageData(img, 0, 0);
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.drawFieldBuffer();
      this.drawAtlas();
      this.drawSeedlets();
      this.drawParticles();
      this.drawHorizonShells();
      this.drawBugeyeFrames();
      this.drawBoundaryTunnel();
    }

    drawFieldBuffer() {
      const ctx = this.ctx;
      const cam = this.camera || { x: 0, y: 0, zoom: 1 };
      const cw = this.canvas.width;
      const ch = this.canvas.height;
      const offX = (cam.x || 0) * cw * 0.5;
      const offY = (cam.y || 0) * ch * 0.5;
      ctx.save();
      ctx.translate(cw * 0.5, ch * 0.5);
      ctx.scale(cam.zoom || 1, cam.zoom || 1);
      ctx.translate(-cw * 0.5 - offX, -ch * 0.5 - offY);
      for (let oy = -ch; oy <= ch; oy += ch) {
        for (let ox = -cw; ox <= cw; ox += cw) {
          ctx.drawImage(this.buffer, ox, oy, cw, ch);
        }
      }
      ctx.restore();
    }

    toScreen(x, y) {
      const cam = this.camera || { x: 0, y: 0, zoom: 1 };
      const dx = Core.wrapDelta(x, cam.x || 0);
      const dy = Core.wrapDelta(y, cam.y || 0);
      return [
        this.canvas.width * 0.5 + dx * 0.5 * this.canvas.width * (cam.zoom || 1),
        this.canvas.height * 0.5 + dy * 0.5 * this.canvas.height * (cam.zoom || 1)
      ];
    }

    drawAtlas() {
      if (!this.showStructureOverlay) return;
      const anchors = this.state.atlas.anchors;
      const ctx = this.ctx;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < Math.min(anchors.length, 96); i++) {
        const a = anchors[i];
        const v = this.fieldToView(a.x, a.y);
        if (Math.abs(v[0]) > 1.18 || Math.abs(v[1]) > 1.18) continue;
        const [x, y] = this.toScreen(v[0], v[1]);
        const viewRadius = (a.radius || 0.18) / (this.view && this.view.active ? (this.view.scale || 1) : 1);
        const r = Math.max(4, viewRadius * 0.5 * Math.min(this.canvas.width, this.canvas.height) * (this.camera.zoom || 1));
        ctx.globalAlpha = Math.min(0.28, 0.04 + a.strength * 0.18);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = a.kind === 'keyhole' ? 'rgba(255,255,255,0.95)' : (a.kind === 'wall' ? 'rgba(255,145,140,0.9)' : (a.kind === 'filament' ? 'rgba(180,230,255,0.9)' : 'rgba(255,218,139,0.9)'));
        ctx.lineWidth = 1.2 * (window.devicePixelRatio || 1);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawSeedlets() {
      if (!this.showStructureOverlay) return;
      const seedlets = (this.state.atlas && this.state.atlas.seedlets) || [];
      if (!seedlets.length) return;
      const ctx = this.ctx;
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < Math.min(seedlets.length, 96); i++) {
        const s = seedlets[i];
        const a = s.address || {};
        const v = this.fieldToView(a.originX || 0, a.originY || 0);
        if (Math.abs(v[0]) > 1.22 || Math.abs(v[1]) > 1.22) continue;
        const [x, y] = this.toScreen(v[0], v[1]);
        const r = Math.max(3, Math.min(32, (1 + (s.depth || 1) * 1.5) * dpr * (this.camera.zoom || 1)));
        ctx.globalAlpha = Math.min(0.55, 0.12 + (s.criticality || 0) * 0.28 + (s.energy || 0) * 0.10);
        ctx.strokeStyle = s.status === 'reproductive' ? 'rgba(255,220,120,0.98)' : (s.status === 'resonant' ? 'rgba(190,255,210,0.95)' : (s.status === 'training' ? 'rgba(190,230,255,0.90)' : (s.status === 'stagnant' ? 'rgba(255,150,120,0.72)' : 'rgba(255,255,255,0.75)')));
        ctx.lineWidth = 1.1 * dpr;
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r * 0.866, y + r * 0.5);
        ctx.lineTo(x - r * 0.866, y + r * 0.5);
        ctx.closePath();
        ctx.stroke();
        if ((s.depth || 0) >= 6) {
          ctx.beginPath();
          ctx.arc(x, y, r * 1.55, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    drawParticles() {
      const ctx = this.ctx;
      const pts = this.particles;
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < pts.length; i += 5) {
        const x = pts[i], y = pts[i + 1];
        const s = this.sampleGrid(x, y);
        if (s.potential < 0.035 && i % 3 !== 0) continue;
        const [sx, sy] = this.toScreen(x, y);
        const size = (0.55 + 2.8 * s.potential + 1.2 * s.filament) * dpr * Math.sqrt(this.camera.zoom || 1);
        ctx.globalAlpha = Math.min(0.72, 0.08 + s.potential * 0.55);
        ctx.fillStyle = s.filament > 0.56 ? 'rgba(210,245,255,0.85)' : 'rgba(255,230,170,0.75)';
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }


    drawHorizonShells() {
      const h = this.state.horizon;
      if (!h || !Array.isArray(h.shells) || !h.shells.length) return;
      const ctx = this.ctx;
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const shell of h.shells.slice(0, 16)) {
        const v = this.fieldToView(shell.x || 0, shell.y || 0);
        if (Math.abs(v[0]) > 1.25 || Math.abs(v[1]) > 1.25) continue;
        const [x, y] = this.toScreen(v[0], v[1]);
        const viewRadius = (shell.radius || 0.1) / (this.view && this.view.active ? (this.view.scale || 1) : 1);
        const r = Math.max(6, viewRadius * 0.5 * Math.min(this.canvas.width, this.canvas.height) * (this.camera.zoom || 1));
        const density = Core.clamp01(shell.shellDensity || 0);
        const coupling = Core.clamp01(shell.outwardCoupling == null ? 1 : shell.outwardCoupling);
        const release = Core.clamp01((shell.releaseReadiness || 0) / Math.max(0.1, Number(this.state.params.horizonReleaseThreshold) || 0.78));
        ctx.globalAlpha = Math.min(0.72, 0.12 + density * 0.36 + release * 0.18);
        ctx.lineWidth = Math.max(1 * dpr, (1.2 + (shell.scarDepth || 0) * 0.45) * dpr);
        for (let i = 0; i < 16; i++) {
          const a0 = i * Math.PI * 2 / 16 + (shell.tileSeed || 0) * 0.000001;
          const a1 = a0 + Math.PI * 2 / 16 * (0.42 + 0.38 * this.shellTileValue(shell, i));
          const rr = r * (0.74 + 0.18 * ((i * 0.6180339887) % 1));
          const hue = shell.status === 'white-hole-release' ? 'rgba(255,240,190,' : (coupling < 0.28 ? 'rgba(205,235,255,' : 'rgba(190,210,255,');
          ctx.strokeStyle = hue + '0.86)';
          ctx.beginPath();
          ctx.arc(x, y, rr, a0, a1);
          ctx.stroke();
        }
        ctx.globalAlpha = Math.min(0.32, 0.05 + (1 - coupling) * 0.22);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 1.2);
        grad.addColorStop(0, 'rgba(0,0,0,0.02)');
        grad.addColorStop(0.58, 'rgba(255,255,255,0.05)');
        grad.addColorStop(1, 'rgba(255,255,255,0.00)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.18, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    drawBugeyeFrames() {
      if (!this.bugeye || !this.bugeye.active || !this.bugeyeFrames || !this.bugeyeFrames.length) return;
      const ctx = this.ctx;
      const cw = this.canvas.width;
      const ch = this.canvas.height;
      const dpr = window.devicePixelRatio || 1;
      const frames = this.bugeyeFrames;
      const cols = frames.length <= 6 ? 3 : 4;
      const rows = Math.ceil(frames.length / cols);
      const gap = 10 * dpr;
      const margin = 18 * dpr;
      const panelW = Math.min((cw - margin * 2 - gap * (cols - 1)) / cols, 230 * dpr);
      const panelH = panelW * 0.58;
      const startX = cw - margin - cols * panelW - (cols - 1) * gap;
      const startY = ch - margin - rows * panelH - (rows - 1) * gap;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = `${10 * dpr}px ui-sans-serif, system-ui`;
      for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (!f.grid) this.computeBugeyeFrame(f);
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = startX + col * (panelW + gap);
        const y = startY + row * (panelH + gap);
        this.drawBugeyeMiniField(f, x, y, panelW, panelH);
        const s = f.summary || {};
        ctx.globalAlpha = 0.88;
        ctx.strokeStyle = 'rgba(255,255,255,0.34)';
        ctx.lineWidth = 1 * dpr;
        ctx.strokeRect(x, y, panelW, panelH);
        ctx.fillStyle = 'rgba(3,6,14,0.58)';
        ctx.fillRect(x, y, panelW, 18 * dpr);
        ctx.fillStyle = 'rgba(230,248,255,0.96)';
        ctx.fillText(`eye ${i + 1} d${f.depth || 0} c${(s.critical || 0).toFixed(2)} n${this.atlasNoveltyAt(f.originX, f.originY, f.scale).toFixed(2)}`, x + 6 * dpr, y + 13 * dpr);
      }
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(`BUGEYE SURVEY: ${frames.length} lower slices · weak map-back only`, startX, startY - 8 * dpr);
      ctx.restore();
    }

    drawBugeyeMiniField(frame, dx, dy, dw, dh) {
      const g = frame.grid;
      if (!g) return;
      const mini = document.createElement('canvas');
      mini.width = g.width;
      mini.height = g.height;
      const mctx = mini.getContext('2d');
      const img = mctx.createImageData(g.width, g.height);
      const data = img.data;
      for (let i = 0; i < g.width * g.height; i++) {
        const v = Core.clamp01(g.potential[i]);
        const f = Core.clamp01(g.filament[i]);
        const c = Core.clamp01(g.cavity[i]);
        const cr = Core.clamp01(g.critical[i]);
        const j = i * 4;
        data[j] = Core.clamp(12 + 190 * Math.pow(v, 1.25) + 40 * cr, 0, 255);
        data[j + 1] = Core.clamp(16 + 100 * f + 80 * cr, 0, 255);
        data[j + 2] = Core.clamp(28 + 165 * c + 72 * f, 0, 255);
        data[j + 3] = 255;
      }
      mctx.putImageData(img, 0, 0);
      this.ctx.drawImage(mini, dx, dy, dw, dh);
    }

    drawBoundaryTunnel() {
      if (!this.boundaryTransit) return;
      const tr = this.boundaryTransit;
      const ctx = this.ctx;
      const u = Core.clamp01((performance.now() - tr.started) / tr.duration);
      const cw = this.canvas.width;
      const ch = this.canvas.height;
      const cx = cw * 0.5;
      const cy = ch * 0.5;
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.20 + Math.sin(Math.min(1, u) * Math.PI) * 0.58;
      ctx.fillStyle = 'rgba(0,0,0,0.82)';
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'lighter';
      const tunnel = 1 - Math.abs(u - 0.5) * 1.6;
      const major = Math.max(cw, ch) * (0.08 + u * 0.82);
      const minor = Math.max(12 * dpr, Math.min(cw, ch) * (0.015 + tunnel * 0.06));
      ctx.globalAlpha = 0.44 + tunnel * 0.46;
      ctx.strokeStyle = 'rgba(255,255,255,0.96)';
      ctx.lineWidth = Math.max(2 * dpr, minor * 0.16);
      for (let i = 0; i < 7; i++) {
        const r = major * (0.22 + i * 0.16) * (0.75 + Math.sin(u * Math.PI * 8 + i) * 0.06);
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(minor, r * 0.22), r, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = u < 0.62 ? 0.25 + u * 0.55 : Math.max(0, 1 - u) * 1.8;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(cw, ch) * 0.62);
      grad.addColorStop(0, 'rgba(255,255,255,0.98)');
      grad.addColorStop(0.24, 'rgba(210,246,255,0.82)');
      grad.addColorStop(0.52, 'rgba(255,255,255,0.20)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }

    learn(showToast, pageBudget) {
      let result = this.grid ? Core.learnFromGrid(this.grid, this.state) : { picked: 0, births: 0, updates: 0 };
      let pageLearns = 0;
      if (this.memory) {
        const budget = this.pauseBudgetFreezeEnabled() ? this.clampEffectiveBudget(pageBudget || 1) : Math.max(0, Math.round(pageBudget || 1));
        const observerPages = this.memory.touchObserver(this.observer, (Number(this.state.params.learnDuty) || 0.2) >= 0.5 ? 1 : 0);
        const anchorPages = this.memory.touchStrongAnchors(Math.max(1, budget));
        const pages = observerPages.concat(anchorPages).slice(0, budget);
        for (const rec of pages) {
          const r = Core.learnFromGrid(rec.grid, this.state);
          result = {
            picked: result.picked + r.picked,
            births: result.births + r.births,
            updates: result.updates + r.updates
          };
          pageLearns += 1;
        }
      }
      const drive = this.pauseBudgetFreezeEnabled() ? null : this.driveSeed();
      if (drive && drive.bestProbe && this.memory) {
        const rec = this.memory.touch(drive.bestProbe.address, 2.0);
        const r = Core.learnFromGrid(rec.grid, this.state);
        result = {
          picked: result.picked + r.picked,
          births: result.births + r.births,
          updates: result.updates + r.updates
        };
        pageLearns += 1;
      }
      this.lastLearnFrame = this.frame;
      if (Core.updateFACMedian) Core.updateFACMedian(this.state, { force: !!showToast });
      if (showToast) {
        const phase = this.state.driver ? this.state.driver.phase : 'manual';
        this.toast(`Learned ${result.picked} anchors across ${1 + pageLearns} field page(s): +${result.births} new, ${result.updates} updated. Driver: ${phase}.`);
      }
      this.autosave();
    }

    emitPacket() {
      if (Core.updateFACMedian) Core.updateFACMedian(this.state, { force: true });
      const packet = Core.emitPacket(this.state);
      this.autosave();
      this.downloadJSON(packet, packet.id + '.json');
      this.toast('LivingWord packet emitted from current atlas.');
    }

    exportSave() {
      const save = Core.serializeState(this.state);
      this.downloadJSON(save, `omegaseed_save_epoch_${this.state.epoch}.json`);
      this.autosave();
      this.toast('Save exported. Carry this JSON into the next run.');
    }

    importSave(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          this.state = Core.migrateSave(parsed);
          this.runtime = Core.buildRuntime(this.state);
          this.schedulerMode = 'continuous';
          this.autoEvolve = this.state.params.autoEvolve !== false;
          this.showStructureOverlay = this.state.params.showStructureOverlay !== false;
          this.ensureBugeyeState();
          this.bugeye = this.state.bugeye;
          this.bugeyeFrames = [];
          this.bugeyeOriginalQuality = null;
          this.applyRenderQuality(this.state.params.renderQuality || 1, false);
          this.view = { active: false, originX: 0, originY: 0, scale: 1, depth: 0, label: 'parent' };
          this.viewStack = [];
          this.ensureMiningState();
          this.ensureHorizonState();
          this.ensureSuperbasinState();
          if (Core.ensureFACState) Core.ensureFACState(this.state);
          if (Core.updateFACMedian) Core.updateFACMedian(this.state, { force: true });
          this.camera = { x: 0, y: 0, zoom: 1, targetX: 0, targetY: 0, targetZoom: 1, shot: null };
          this.boundaryTransit = null;
          this.observer = Memory ? Memory.bootstrapObserverFromAtlas(this.state) : { x: 0, y: 0, scale: 0.2, foldLevel: 0 };
          this.memory = Memory ? new Memory.PageCache(this.state, this.runtime, { maxPages: this.state.params.memoryMaxPages, pageSize: this.state.params.pageSize }) : null;
          if (Driver) Driver.ensureDriverState(this.state);
          if (Seedlets) Seedlets.ensureSeedlets(this.state);
          this.resetParticles(true);
          this.syncControls();
          this.autosave();
          this.toast(`Imported save: ${this.state.atlas.anchors.length} anchors, epoch ${this.state.epoch}.`);
        } catch (err) {
          this.toast('Import failed: invalid JSON save.');
          console.error(err);
        }
      };
      reader.readAsText(file);
    }

    downloadJSON(obj, filename) {
      const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 500);
    }

    autosave() {
      try {
        localStorage.setItem(Core.SAVE_KEY, JSON.stringify(Core.serializeState(this.state)));
        this.lastAutosave = performance.now();
      } catch (err) {
        console.warn('Autosave failed:', err);
      }
    }

    updateStatsPanel() {
      const s = this.state.stats;
      $('#metric-epoch').textContent = this.state.epoch;
      $('#metric-cycle').textContent = this.state.cycle;
      $('#metric-time').textContent = this.state.time.toFixed(2);
      $('#metric-anchors').textContent = this.state.atlas.anchors.length;
      $('#metric-packets').textContent = this.state.atlas.packets.length;
      if ($('#metric-seedlets')) $('#metric-seedlets').textContent = ((this.state.atlas && this.state.atlas.seedlets) || []).length;
      const gauge = Core.summarizeGaugeAtlas ? Core.summarizeGaugeAtlas(this.state) : null;
      if (gauge && $('#metric-gauge-active')) $('#metric-gauge-active').textContent = (gauge.activeSeedletId || 'none').replace('seedlet-', '').slice(0, 8);
      if (gauge && $('#metric-gauge-states')) {
        const st = gauge.statuses || {};
        $('#metric-gauge-states').textContent = Object.entries(st).slice(0, 3).map(([k,v]) => k[0] + ':' + v).join(' ');
      }
      if (gauge && $('#metric-gauge-rd')) $('#metric-gauge-rd').textContent = `${gauge.resonanceMean.toFixed(2)}/${gauge.maxDilation.toFixed(0)}`;
      const anneal = this.state.driver && this.state.driver.annealing ? this.state.driver.annealing : null;
      if (anneal && $('#metric-anneal')) $('#metric-anneal').textContent = `${(anneal.temperature || 0).toFixed(3)} / ${(anneal.learningRate || this.state.params.learningRate || 0).toFixed(5)}`;
      if (anneal && $('#metric-boredom')) $('#metric-boredom').textContent = `${anneal.state || '—'} ${anneal.boredom || 0}`;
      $('#metric-coherence').textContent = s.coherence.toFixed(3);
      $('#metric-filament').textContent = s.filament.toFixed(3);
      $('#metric-cavity').textContent = s.cavity.toFixed(3);
      $('#metric-fitness').textContent = (s.atlasFitness || 0).toFixed(3);
      $('#metric-mode').textContent = `${Math.round((Number(this.state.params.learnDuty) || 0.2) * 100)}% learn`;
      const mem = this.memory ? this.memory.stats() : { residentPages: 0, estimatedResidentMB: 0 };
      $('#metric-memory').textContent = `${mem.residentPages}p/${mem.estimatedResidentMB}MB`;
      // This is render-frame count / learn-tick count, not a training budget.
      // Kept as a useful scheduler/paused-render diagnostic but relabeled in UI.
      $('#metric-budget').textContent = `${this.renderTicks}/${this.learnTicks}`;
      if ($('#metric-learn-budget')) {
        const p = this.state.params || {};
        const a = this.state.driver && this.state.driver.annealing ? this.state.driver.annealing : null;
        const base = Math.max(1, Math.round(Number(p.seedTrainingBudget) || 3));
        const effective = this.autoLearnBudget ? this.autoLearnBudget() : base;
        const child = a ? Math.max(1, Math.round(Number(a.childBudgetMultiplier) || 1)) : 1;
        const nurseryCap = Math.max(1, Math.round(Number(p.effectiveNurseryBudgetHardCap) || Number(p.seedletNurseryBudgetBoost) || 8));
        const paused = this.pauseBudgetFreezeEnabled();
        $('#metric-learn-budget').textContent = paused
          ? `paused · eff ${effective}/${Math.max(1, Math.round(Number(p.effectiveBudgetHardCap) || base))} · child ${Math.min(child, nurseryCap)}/${nurseryCap}`
          : `eff ${effective} · base ${base} · child ${child}`;
      }
      if ($('#metric-pause-clamp')) {
        const p = this.state.params || {};
        const paused = this.pauseBudgetFreezeEnabled();
        const snap = this.pauseBudgetSnapshot;
        $('#metric-pause-clamp').textContent = paused
          ? `active · learn frozen · ${Math.max(1, Math.round(Number(p.effectiveBudgetHardCap) || 3))}/${Math.max(1, Math.round(Number(p.effectiveNurseryBudgetHardCap) || 8))}`
          : (snap ? 'leaving pause' : 'standby');
      }
      $('#metric-render').textContent = this.renderMs.toFixed(1) + 'ms';
      if ($('#metric-quality')) $('#metric-quality').textContent = `${(this.state.params.renderQuality || 1).toFixed(2)}x ${Math.round(this.state.params.fieldWidth)}×${Math.round(this.state.params.fieldHeight)}`;
      if ($('#metric-camera')) $('#metric-camera').textContent = `${(this.camera && this.camera.zoom || 1).toFixed(2)}x ${this.camera && this.camera.shot ? this.camera.shot.type : 'free'}`;
      if ($('#metric-slice')) $('#metric-slice').textContent = this.view && this.view.active ? `${this.view.label || 'slice'} @${(this.view.scale || 1).toFixed(3)}` : 'parent';
      if ($('#metric-layer')) $('#metric-layer').textContent = `${this.currentDepth() + 1}/${Math.round(Number(this.state.params.miningLayerLimit || 3))}`;
      if ($('#metric-livingword')) { const m = this.ensureMiningState(); $('#metric-livingword').textContent = `${(m.lastRelock || 0).toFixed(2)} / ${(m.seamEdges || []).length}`; }
      this.updateBugeyeUI();
      if ($('#metric-horizon')) {
        const h = this.ensureHorizonState();
        $('#metric-horizon').textContent = `${(h.lastCompactness || 0).toFixed(2)} C ${(h.lastCoupling || 1).toFixed(2)} out · A${(h.lastProtoAttraction || 0.5).toFixed(2)} · B${h.horizonBoundSeedlets || 0} · ${h.shells.length}/${h.releases || 0}`;
      }
      if ($('#metric-proto-attraction')) {
        const h = this.ensureHorizonState();
        $('#metric-proto-attraction').textContent = `${(h.lastProtoAttraction || 0.5).toFixed(3)} c:${(h.lastCapture || 0).toFixed(2)} e:${(h.lastEscape || 0).toFixed(2)}`;
      }
      if ($('#metric-superbasin')) {
        const b = this.ensureSuperbasinState();
        $('#metric-superbasin').textContent = `${(b.rimScars || []).length} rim / ${(b.horizonCandidates || []).length} cand · ${(b.topHitShare || 0).toFixed(2)}`;
      }
      if ($('#metric-fac-median')) {
        const f = Core.ensureFACState ? Core.ensureFACState(this.state) : (this.state.fac || {});
        $('#metric-fac-median').textContent = `${((f.lastScore || 0)).toFixed(3)} · ${(f.medians || []).length} med · ${f.mode || 'suggest'}`;
      }
      if ($('#metric-fac-action')) {
        const f = this.state.fac || {};
        const a = f.lastAction || {};
        $('#metric-fac-action').textContent = a.action ? `${a.action} ${(a.confidence || 0).toFixed(2)} → ${a.targetMedian || 'M0'}` : 'none';
      }
      if ($('#metric-driver')) {
        const d = this.state.driver || {};
        $('#metric-driver').textContent = this.state.params.driverEnabled === false ? 'off' : (d.phase || 'seek');
      }
      if ($('#metric-split')) {
        const d = this.state.driver || {};
        $('#metric-split').textContent = `${d.splitDepth || 0}/${(d.portals || []).length || 0}`;
      }
      if ($('#metric-critical')) {
        const summary = Driver ? Driver.summarizeAtlas(this.state) : { keyholeCount: 0, filamentCount: 0, criticalMax: 0 };
        $('#metric-critical').textContent = `${summary.keyholeCount}k ${summary.filamentCount}f ${summary.criticalMax.toFixed(2)}`;
      }
      const top = this.state.atlas.anchors.slice(0, 5).map(a => `${a.kind}:${a.score.toFixed(2)}/${a.hits}${a.criticality ? '/' + a.criticality.toFixed(2) : ''}`).join(' · ');
      const seedletCount = ((this.state.atlas && this.state.atlas.seedlets) || []).length;
      const gaugeTxt = gauge ? `gauge:${gauge.seedlets} res:${gauge.resonanceMean.toFixed(2)} prod:${gauge.productivityMean.toFixed(2)} · ` : '';
      const miningTxt = this.state.mining ? `lw:${(this.state.mining.lastRelock || 0).toFixed(2)} seams:${(this.state.mining.seamEdges || []).length} · ` : '';
      const horizonTxt = this.state.horizon ? `horizon:${(this.state.horizon.lastCompactness || 0).toFixed(2)} A:${(this.state.horizon.lastProtoAttraction || 0.5).toFixed(2)} shells:${(this.state.horizon.shells || []).length} releases:${this.state.horizon.releases || 0} · ` : '';
      const basinTxt = this.state.superbasin ? `rim:${(this.state.superbasin.rimScars || []).length} cand:${(this.state.superbasin.horizonCandidates || []).length} · ` : '';
      const facTxt = this.state.fac && this.state.fac.lastAction ? `fac:${this.state.fac.lastAction.action}@${(this.state.fac.lastScore || 0).toFixed(2)} ${this.state.fac.lastAction.targetMedian || 'M0'} · ` : '';
      $('#atlas-readout').textContent = horizonTxt + basinTxt + facTxt + miningTxt + gaugeTxt + (seedletCount ? `seedlets:${seedletCount} · ` : '') + (top || 'No learned anchors yet. Let it run or press Learn step.');
    }

    toast(msg) {
      const el = $('#toast');
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
    }
  }

  window.addEventListener('DOMContentLoaded', () => new OmegaSeedApp());
})();
