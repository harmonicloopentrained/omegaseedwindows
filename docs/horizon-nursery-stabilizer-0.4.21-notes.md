# OmegaSeed 0.4.21 horizon nursery stabilizer notes

Purpose: keep the successful 0.4.20 horizon nursery capture while preventing the first dominant superbasin from monopolizing the whole field.

## Default tuning changes

- Version: `omegaseed-0.4.21-horizon-nursery-stabilizer`.
- `superbasinFollowStrength`: `0.42` → `0.39`.
- `horizonNurseryGateThreshold`: `0.70` → `0.715`.
- `horizonNurseryGateLimit`: `3` → `2`.
- `horizonReleaseThreshold`: `0.78` → `0.82`.
- Added `superbasinDiversityFloor: 0.18`.
- Added `dominantBasinMaxHitShare: 0.72`.
- Added `horizonBoundStatusAccounting: true`.
- Added `horizonCandidateTelemetryFix: true`.

## Behavioral changes

- Horizon-bound seedlets now keep their `horizon-bound` status through seedlet training unless they are explicitly released.
- Packet export now recomputes live seedlet status counts before emission, so top-level `stats.seedletStatuses`, `gaugeAtlas.statuses`, and `horizon.horizonBoundSeedlets` agree.
- Nursery capture is capped more tightly. The dominant shell is limited to one capture when top-hit share exceeds the configured cap.
- Overlocked superbasins add escape/diversity pressure instead of increasing capture pressure indefinitely.
- Rim mapping can inject multiple horizon candidates when the dominant superbasin is over the hit-share cap, so candidate telemetry no longer falls to zero while capture is happening.
- White-hole release now requires a mature bound seedlet on the shell and a longer shell age/cooldown before recoupling.

## Expected run signature

Compared with 0.4.20, the target is not fewer horizon events. The target is healthier distribution:

- horizon-bound seedlets remain visible in stats,
- top-hit share should drift down from ~0.90 toward the configured cap region,
- release events should be less frequent and more mature,
- horizon candidate count should be nonzero when rim capture is active,
- atlas fitness should remain high without collapsing resonant diversity.
