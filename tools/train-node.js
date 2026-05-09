#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Core = require('../src/omegaseed-core.js');
const Memory = require('../src/omegaseed-memory.js');
const Driver = require('../src/omegaseed-driver.js');
const Seedlets = require('../src/omegaseed-seedlet.js');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJSON(file, obj) { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }

function makeSlots(mode) {
  return mode === 'learn80'
    ? ['learn', 'learn', 'learn', 'learn', 'render']
    : ['render', 'render', 'render', 'render', 'learn'];
}

function writePPM(grid, file) {
  const w = grid.width, h = grid.height;
  const header = `P6\n${w} ${h}\n255\n`;
  const body = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const v = Core.clamp01(grid.potential[i]);
    const f = grid.filament[i];
    const c = grid.cavity[i];
    const k = grid.critical ? grid.critical[i] : 0;
    body[i * 3] = Math.max(0, Math.min(255, Math.floor(12 + 210 * Math.pow(v, 1.55) + 45 * k)));
    body[i * 3 + 1] = Math.max(0, Math.min(255, Math.floor(10 + 112 * f + 88 * v)));
    body[i * 3 + 2] = Math.max(0, Math.min(255, Math.floor(24 + 180 * c + 60 * k)));
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from(header, 'ascii'), body]));
}

function updateObserver(observer, state) {
  const d = state.driver;
  if (d && d.activeAddress && state.params.driverEnabled !== false) {
    const a = d.activeAddress;
    const temp = d.annealing ? Math.max(0, Math.min(1, Number(d.annealing.temperature) || 0.35)) : 0.35;
    const rate = 0.045 * (0.20 + temp * 0.80);
    observer.x = Core.wrapUnit(Core.lerp(observer.x || 0, a.originX || 0, rate));
    observer.y = Core.wrapUnit(Core.lerp(observer.y || 0, a.originY || 0, rate));
    observer.scale = Math.max(0.006, Core.lerp(observer.scale || 0.2, a.scale || 0.08, rate * 0.89));
    observer.foldLevel = Math.round(Core.lerp(observer.foldLevel || 0, a.foldLevel || 0, rate * 0.78));
    return;
  }
  const anchors = (state.atlas && state.atlas.anchors) || [];
  if (!anchors.length) return;
  const preferred = anchors.find(a => a.kind === 'keyhole') || anchors[0];
  observer.x = Core.wrapUnit(Core.lerp(observer.x || 0, preferred.x || 0, 0.03));
  observer.y = Core.wrapUnit(Core.lerp(observer.y || 0, preferred.y || 0, 0.03));
  observer.scale = Math.max(0.035, Core.lerp(observer.scale || 0.2, (preferred.radius || 0.18) * 2.2, 0.03));
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(__dirname, '..');
  const input = path.resolve(root, args.input || 'saves/omegaseed_save_epoch_89229.json');
  const outDir = path.resolve(root, args.out || `runs/run_${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const mode = args.mode === 'learn80' ? 'learn80' : 'render80';
  const cyclesRequested = Math.max(5, Math.round(Number(args.cycles || 250)));
  const cycles = Math.ceil(cyclesRequested / 5) * 5;
  const ramMB = Math.max(128, Math.min(10000, Number(args['ram-mb'] || 1024)));
  const pageSize = Math.max(32, Math.min(256, Math.round(Number(args['page-size'] || 96))));
  const previewEvery = Math.max(0, Math.round(Number(args['preview-every'] || 25)));
  const emitPacket = args.packet !== 'false';
  const driverEnabled = args.driver === 'false' ? false : true;

  ensureDir(outDir);
  let state = fs.existsSync(input) ? Core.migrateSave(readJSON(input)) : Core.makeBootstrapSave();
  state.params.schedulerMode = mode;
  state.params.pageSize = pageSize;
  state.params.driverEnabled = driverEnabled;
  Driver.ensureDriverState(state);
  Seedlets.ensureSeedlets(state);
  const runtime = Core.buildRuntime(state);

  const bytesPerPage = pageSize * pageSize * 8 * 4;
  const maxPagesByRam = Math.max(16, Math.floor((ramMB * 1024 * 1024) / bytesPerPage));
  state.params.memoryMaxPages = Math.min(maxPagesByRam, Number(args['max-pages'] || maxPagesByRam));
  const memory = new Memory.PageCache(state, runtime, { maxPages: state.params.memoryMaxPages, pageSize });
  const observer = Memory.bootstrapObserverFromAtlas(state);
  const slots = makeSlots(mode);

  let renderTicks = 0;
  let learnTicks = 0;
  let learnedPages = 0;
  let lastRender = null;

  for (let i = 0; i < cycles; i++) {
    const action = slots[i % slots.length];
    state.time += (1 / 60) * state.params.flow;
    state.cycle += 1;
    updateObserver(observer, state);

    if (action === 'render') {
      const rec = memory.touch(Memory.makeAddress({
        universeSeed: state.seed,
        dimensionId: 'observer',
        foldLevel: observer.foldLevel || 0,
        pageX: Math.round((observer.x || 0) / (observer.scale || 0.18)),
        pageY: Math.round((observer.y || 0) / (observer.scale || 0.18)),
        scale: observer.scale || 0.18,
        originX: observer.x || 0,
        originY: observer.y || 0
      }), 1.2);
      lastRender = rec.grid;
      renderTicks++;
      if (previewEvery && renderTicks % previewEvery === 0) {
        writePPM(rec.grid, path.join(outDir, `preview_${String(renderTicks).padStart(4, '0')}.ppm`));
      }
    } else {
      const drive = Driver.step(state, runtime, memory, observer);
      const pages = memory.touchObserver(observer, mode === 'learn80' ? 1 : 0)
        .concat(memory.touchStrongAnchors(mode === 'learn80' ? 12 : 4));
      const budget = mode === 'learn80' ? 8 : 2;
      for (const rec of pages.slice(0, budget)) {
        Core.learnFromGrid(rec.grid, state);
        learnedPages++;
      }
      if (drive && drive.bestProbe) {
        const rec = memory.touch(drive.bestProbe.address, 2.0);
        Core.learnFromGrid(rec.grid, state);
        learnedPages++;
      }
      learnTicks++;
    }

    if ((i + 1) % 50 === 0 || i === cycles - 1) {
      const m = memory.stats();
      console.log(`[omegaseed] ${i + 1}/${cycles} mode=${mode} epoch=${state.epoch} anchors=${state.atlas.anchors.length} pages=${m.residentPages}/${m.maxPages} est=${m.estimatedResidentMB}MB`);
    }
  }

  if (lastRender) writePPM(lastRender, path.join(outDir, 'preview_final.ppm'));
  const savePath = path.join(outDir, `omegaseed_save_epoch_${state.epoch}.json`);
  writeJSON(savePath, Core.serializeState(state));
  let packetPath = null;
  if (emitPacket) {
    const packet = Core.emitPacket(state);
    packetPath = path.join(outDir, `${packet.id}.json`);
    writeJSON(packetPath, packet);
  }

  const report = {
    version: Core.VERSION,
    input,
    outDir,
    mode,
    cyclesRequested,
    cyclesActual: cycles,
    budget: {
      renderTicks,
      learnTicks,
      ratio: `${renderTicks}:${learnTicks}`,
      invariant: mode === 'learn80' ? '80% learning / 20% render' : '80% render / 20% learning'
    },
    ramMB,
    memory: memory.stats(),
    driver: Driver.exportDriverReport(state),
    seedlets: Seedlets.exportSeedletReport(state),
    learnedPages,
    final: {
      epoch: state.epoch,
      cycle: state.cycle,
      anchors: state.atlas.anchors.length,
      stats: state.stats
    },
    outputs: { savePath, packetPath, previewFinal: lastRender ? path.join(outDir, 'preview_final.ppm') : null }
  };
  writeJSON(path.join(outDir, 'driver_report.json'), Driver.exportDriverReport(state));
  writeJSON(path.join(outDir, 'seedlet_report.json'), Seedlets.exportSeedletReport(state));
  writeJSON(path.join(outDir, 'run_report.json'), report);
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main();
