# OmegaSeed 0.4.21c — Pause Budget Clamp

This is a control-plane patch over 0.4.21b. The prior run was healthy: coherence recovered, horizon-bound occupancy returned to zero, and atlas fitness rose strongly. The remaining bug was pause-time drift: derived budgets and routine state could continue to mutate after pressing Pause.

## Rules

- Pause resets scheduler learn credit to zero.
- Pause freezes `learnDuty` when `pauseFreezesAutotune` is enabled.
- Pause freezes annealing child budget / nursery budget when `freezeAnnealingChildBudgetOnPause` is enabled.
- Pause freezes mining and Bugeye routine advancement.
- Boundary transition completion no longer triggers auto-learning while paused.
- Pause-time effective budget is clamped by `effectiveBudgetHardCap`.
- Pause-time child/nursery multiplier is clamped by `effectiveNurseryBudgetHardCap`.

This does not weaken horizon capture or chart wrapping. It only prevents pause from being a hidden budget-accumulation state.
