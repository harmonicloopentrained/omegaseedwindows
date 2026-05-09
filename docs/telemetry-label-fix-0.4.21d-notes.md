# OmegaSeed 0.4.21d — Telemetry Label Fix

The HUD field previously labeled `Budget` was not the seed training budget. It displayed `renderTicks / learnTicks`. During pause, render frames continue so the UI remains responsive, while learn ticks should stay frozen. This made values like `72/25 -> 250/25` look like a runaway budget even when learning was paused.

Changes:

- Renamed HUD `Budget` to `Frames/Learns`.
- Added `Learn budget` HUD line for effective/base/child budget state.
- Added `Pause clamp` HUD line showing active pause-time freeze state and caps.
- Preserved 0.4.21c pause budget clamp behavior.

Expected pause behavior:

- `Frames/Learns` first value may continue climbing because frames keep rendering.
- `Frames/Learns` second value should remain stable while paused.
- `Pause clamp` should show `active`.
- `Learn budget` should show the paused/clamped effective budget.
