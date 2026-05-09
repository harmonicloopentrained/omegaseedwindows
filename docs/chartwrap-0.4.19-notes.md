# OmegaSeed 0.4.19 chart-wrap implementation notes

This patch restarts from the 0.4.15 superbasin horizon baseline and keeps the black-hole/horizon idea as a chart transition rather than a spatial descent.

## Invariants

- `x` and `y` wrap on a torus.
- `depth`, `viewStack`, `boundaryTransit`, layer return, and top return are stack/transition state and do not wrap.
- The camera is allowed to pan across chart edges. It does not change the active layer unless a boundary transit explicitly commits.
- The horizon state uses hysteresis: enter at `horizonThreshold`, release/open at `horizonExitThreshold`.

## Important files

- `src/omegaseed-core.js`
  - Added `wrapLerp`, `wrapMidpoint`, and `torusDistance`.
  - Added periodic chart sampling via `toroidalField`.
  - Atlas anchor merging now lerps through shortest torus deltas.

- `src/omegaseed-app.js`
  - Added mouse drag pan and wheel zoom.
  - Camera x/y uses `wrapLerp`; zoom/depth remains ordinary scalar state.
  - Grid gradients and sample interpolation wrap across edges.
  - Dimensional dig can follow the first superbasin/horizon-candidate route before falling back to ordinary portals.
  - Layer return/top return clear pending post-Bugeye climb targets so auto-mining does not instantly dive back down.

- `src/omegaseed-driver.js`
  - Observer guidance now lerps across the torus instead of taking the long way through the center.

## Test

Run:

```bash
npm test
```

Expected result:

```text
OmegaSeed smoke test passed
```
