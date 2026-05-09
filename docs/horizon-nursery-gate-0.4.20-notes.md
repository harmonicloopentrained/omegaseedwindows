# OmegaSeed 0.4.20 horizon nursery-gate notes

This patch preserves the working 0.4.19 toroidal chart wrapping and adds the next causal step: near-horizon seedlet capture.

## What changed

- Version: `omegaseed-0.4.20-horizon-nursery-gate`.
- `superbasinFollowStrength` default raised from `0.36` to `0.42`.
- `horizonSeedletCoupling` default raised from `0.18` to `0.24`.
- `horizonCandidateThreshold` default lowered from `0.68` to `0.62`.
- Added `horizonNurseryGateEnabled`, `horizonNurseryGateThreshold`, `horizonNurseryGateLimit`, and `horizonNurseryGateMinScore`.
- Added a ranked nursery-gate capture path for 1-3 high-quality seedlets near the dominant scar/superbasin before full horizon crossing.
- Preserved seedlet `horizon` state during save migration.

## Intended behavior

0.4.19 proved rim/scar formation but left `horizonBoundSeedlets` at zero. 0.4.20 lets the rim act as a gate: once compactness is near the horizon and either the system is already inside the chart-wrap state, the anchor is the dominant superbasin, or a scar is present, the best local seedlets are reclassified as `horizon-bound` with `captureMode: nursery-gate`.

The release threshold is intentionally unchanged. White-hole release should remain downstream of actual capture and incubation, not just rim formation.
