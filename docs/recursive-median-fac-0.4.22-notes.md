# OmegaSeed 0.4.22 — Recursive Median FAC

This pass reframes FAC as a semantic median compiler rather than a raw slider tuner.

## Core idea

- Epoch 0 / cycle 0 is the origin median `M0`.
- `M0` is the first admissible balance between asymptotic float and forbidden null.
- Integers and rational ratios are candidate-addresses for medians, not automatic truth.
- FAC searches both:
  - medians between competing attractors / extremes
  - medians within already-stable basins, shells, scars, nurseries, and seedlet routes

## New default parameters

```json
{
  "facMedianEnabled": true,
  "facOriginMedianEnabled": true,
  "facMedianTreeDepth": 7,
  "facMedianRatios": "1/2,1/3,2/3,1/4,3/4,3/5,5/8,8/13",
  "facMedianMode": "suggestion",
  "facMedianScoreThreshold": 0.04,
  "facMedianActionLimit": 1,
  "facMedianUpdateIntervalCycles": 90,
  "facMedianMinConfidence": 0.34
}
```

## FAC output shape

FAC now records a suggestion object:

```json
{
  "action": "seek_median",
  "confidence": 0.5,
  "targetMedian": "M0/1/2",
  "ratio": "1/2",
  "params": {
    "strength": 0.14,
    "durationCycles": 340,
    "medianScore": 0.53,
    "ratioValue": 0.5
  },
  "stopCondition": "medianScore improves by threshold or cavity/overcapture leaves safe band"
}
```

## Macro-action vocabulary

FAC chooses among high-level semantic verbs:

- `seek_median`
- `dig_down`
- `tighten_shell`
- `promote_seedlets`
- `seal_horizon`
- `reheat_nursery`
- `wrap_edge`
- `scar_and_stabilize`

The action is advisory in this build. It does not directly change sliders.

## Median score

The median score rewards balanced coherence, stable cavity pressure, useful scars, healthy seedlet/nursery state, resonance/productivity, closure evidence, and atlas fitness. It penalizes overcollapse, overcapture, and frozen/noisy learning.

## UI changes

New HUD rows:

- `FAC median`: score, number of learned median nodes, current mode
- `FAC action`: current suggested macro-action, confidence, and target median address

New controls:

- FAC tree depth
- FAC score threshold
- FAC action limit
- FAC update interval
- FAC confidence floor

## Packet/save changes

`emitPacket()` now includes a compact `fac` block with score, current action, confidence, target median, mode, and median count.
