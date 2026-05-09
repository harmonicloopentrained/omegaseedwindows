const assert = require('assert');
const Core = require('../src/omegaseed-core.js');
const Memory = require('../src/omegaseed-memory.js');
const Driver = require('../src/omegaseed-driver.js');
const Seedlets = require('../src/omegaseed-seedlet.js');

const state = Core.makeDefaultState('smoke-test-seed');
state.params.schedulerMode = 'learn80';
state.params.seedProjectionThreshold = 0.35;
const runtime = Core.buildRuntime(state);
const sample = Core.sampleRawField(0.1, -0.2, 1.25, state, runtime);
assert(Number.isFinite(sample.potential), 'potential should be finite');
assert(sample.potential >= 0 && sample.potential <= 1, 'potential should be normalized');

const memory = new Memory.PageCache(state, runtime, { maxPages: 64, pageSize: 64 });
const observer = Memory.bootstrapObserverFromAtlas(state);
const grid = memory.touch(Memory.makeAddress({ universeSeed: state.seed, dimensionId: 'smoke', scale: 0.25, originX: 0, originY: 0 }), 1).grid;
const result = Core.learnFromGrid(grid, state);
assert(result.picked >= 0, 'learning result should be valid');
assert(Array.isArray(state.atlas.anchors), 'atlas anchors should exist');

Driver.ensureDriverState(state);
Seedlets.ensureSeedlets(state);
for (let i = 0; i < 8; i++) {
  state.time += 0.025;
  state.cycle++;
  Driver.step(state, runtime, memory, observer);
}

assert(state.params.autoMiningEnabled === true, 'auto mining should default on');
assert(state.params.horizonEnabled === true, 'horizon shell compression should default on');
assert(state.params.protoAttractionEnabled === true, 'proto-attraction self-centering should default on');
assert(Number.isFinite(state.params.horizonThreshold), 'horizon threshold should be numeric');
assert(Number.isFinite(state.params.horizonRimApproachThreshold), 'rim approach threshold should be numeric');
assert(Number.isFinite(state.params.autoMiningCooldownCycles), 'auto mining cooldown should be numeric');
assert(state.driver, 'driver state should exist');
assert(Array.isArray(state.driver.portals), 'driver portals should exist');
assert(Array.isArray(state.atlas.seedlets), 'seedlet array should exist');

const trained = Seedlets.trainSeedlets(state, runtime, memory, 2);
assert(trained.touched >= 0, 'seedlet trainer should be valid');
const packet = Core.emitPacket(state);
assert(packet.type === 'omegaseed.livingword.packet', 'packet type should match');
assert(Array.isArray(packet.seedlets), 'packet should carry seedlet summaries');
assert(packet.gaugeAtlas && typeof packet.gaugeAtlas === 'object', 'packet should carry Gauge Atlas summary');
assert(packet.horizon && typeof packet.horizon === 'object', 'packet should carry Horizon shell summary');
assert(packet.superbasin && typeof packet.superbasin === 'object', 'packet should carry superbasin reachability summary');
assert(packet.fac && typeof packet.fac === 'object', 'packet should carry Recursive Median FAC summary');
assert(packet.fac.action, 'FAC should produce one macro-action suggestion');
assert(Number.isFinite(packet.fac.score), 'FAC median score should be numeric');
assert(state.driver.annealing && Number.isFinite(state.driver.annealing.temperature), 'driver should carry annealing temperature');
assert(Number.isFinite(state.params.learningRate) && state.params.learningRate >= 0.0001, 'annealing should set bounded learning rate');
assert(Number.isFinite(packet.gaugeAtlas.maxDilation), 'Gauge Atlas should expose max dilation');
const migrated = Core.migrateSave(JSON.parse(JSON.stringify(state)));
assert(migrated.version === Core.VERSION, 'migrated save should use current version');
assert(Array.isArray(migrated.atlas.seedlets), 'migrated save should retain seedlets');
assert(migrated.horizon && Array.isArray(migrated.horizon.shells), 'migrated save should retain horizon shell state');
assert(migrated.fac && migrated.fac.originMedian && migrated.fac.originMedian.id === 'M0', 'migrated save should retain FAC origin median');
console.log('OmegaSeed smoke test passed', {
  version: Core.VERSION,
  potential: sample.potential.toFixed(4),
  anchors: state.atlas.anchors.length,
  seedlets: state.atlas.seedlets.length,
  packet: packet.id,
    fac: packet.fac.action + '@' + packet.fac.score.toFixed(3)
});
