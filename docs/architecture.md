# OmegaSeed 0.4.6 Architecture

OmegaSeed remains a continuous effective-field simulator. Filaments and basins are not hand-authored objects; they are emergent contours of nested simplex topography, domain warping, and smoothstep thresholds.

## New layer: simulated annealing

0.4.2 gave the seed children. 0.4.6 gives the driver maturity.

The driver now maintains an annealing state:

```json
{
  "temperature": 0.42,
  "learningRate": 0.22,
  "stabilityStreak": 0,
  "boredom": 0,
  "maturity": 0,
  "reheatCount": 0,
  "state": "warm-start"
}
```

The temperature gates three things:

1. Driver parameter mutation size.
2. Atlas learning rate.
3. Observer / portal-following motion.

Hot states search aggressively. Cold states preserve the basin.

## Boredom alarm

A perfectly stable field can become dead crystal. To avoid that, long stable runs accumulate boredom. Once boredom crosses `annealingBoredomLimit`, the driver performs a bounded jolt and reheats.

The jolt is data-only. It never rewrites JavaScript. It nudges one safe parameter such as threshold, edge softness, flow, swirl, atlas influence, warp strength, or gravity inside clamps.

## Gauge Atlas stays active

Seedlets still carry explicit gauge transform data:

- parent anchor
- reduction ratio
- raw and capped time dilation
- macro phase
- macro gradient X/Y
- macro potential
- resonance
- productivity
- status

This keeps lower universes lazy. They are folded addresses plus a local gauge transform until the observer/driver/trainer touches them.


## v0.4.6 corridor annealing

This version treats high-critical filaments as stable computational corridors, not failures caused by missing literal keyholes. The annealing governor can now cool into superbasin-lock when the field holds the half-line, the corridor count is high, and seedlet resonance is present. Stagnant seedlets are demoted toward hibernating status so they stop occupying the active training pool forever.


### 0.4.6 Auto-Cinema Boundary Slice

The parent field and the seedlet nursery now use separate thermal variables. Parent annealing controls broad parameter motion; child temperature controls Gauge Atlas training budget and seedlet energy floors. Collapsed high-criticality seedlets can be revived into hibernation instead of being permanently discarded, and stable parent corridors no longer imply starvation of nested worlds.
