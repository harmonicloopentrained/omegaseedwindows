# OmegaSeed 0.4.22 — Recursive Median FAC

GitHub Pages compatible OmegaSeed viewer/trainer.

## 0.4.22 focus

This build keeps the stable 0.4.21d control-plane fixes and adds **Recursive Median FAC**:

- epoch 0 / cycle 0 is treated as the origin median `M0`
- integers and rational ratios are used as addresses for candidate medians
- FAC searches medians **between** competing attractors and **within** already-stable medians
- FAC outputs one semantic macro-action suggestion at a time, rather than directly exposing raw knobs

## FAC action vocabulary

- `seek_median`
- `dig_down`
- `tighten_shell`
- `promote_seedlets`
- `seal_horizon`
- `reheat_nursery`
- `wrap_edge`
- `scar_and_stabilize`

The FAC output is advisory/suggestion-mode in this build.

## Key HUD fields

- **Frames/Learns**: render frames / learn ticks; not a training budget
- **Learn budget**: effective learn budget and child-budget state
- **Pause clamp**: whether pause-time budget freeze is active
- **FAC median**: current median score, number of learned median nodes, and mode
- **FAC action**: current FAC macro-action suggestion, confidence, and target median address

## Run locally

```bash
npm install
npm test
npm run serve
```

Then open the local URL printed by `tools/serve.js`.

## Files of interest

- `src/omegaseed-core.js`: core field, atlas, horizon, packet, and FAC median logic
- `src/omegaseed-app.js`: browser UI, loop, pause clamp, mining/horizon UI controls
- `docs/recursive-median-fac-0.4.22-notes.md`: FAC design notes for this patch

## Continuity

The `saves/` directory includes previous continuity saves and packets from the recent horizon-wrap/nursery series so you can import and compare behavior across builds.

## Build Windows executable

This repo now includes a minimal Electron desktop wrapper and a GitHub Actions workflow for building a portable Windows `.exe`.

### Local Electron launch

```bash
npm install
npm start
```

### GitHub workflow

1. Push this folder to GitHub.
2. Open **Actions** in the repository.
3. Run **Build Windows EXE** manually, or push to `main`.
4. Download the `OmegaSeed-Windows-Portable-EXE` artifact from the completed run.

The workflow builds an unsigned x64 portable executable using Electron/electron-builder default icon behavior. Windows may warn that the app is unsigned until you code-sign a future release.
