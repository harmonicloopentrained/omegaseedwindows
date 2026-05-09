# Windows EXE build path

This build adds a minimal Electron shell around the existing OmegaSeed static viewer.

## Local development

```bash
npm install
npm start
```

Set `OMEGASEED_DEVTOOLS=1` before `npm start` to open Chromium DevTools.

## GitHub Actions build

1. Push this folder to a GitHub repository.
2. Open the repository on GitHub.
3. Go to **Actions**.
4. Select **Build Windows EXE**.
5. Press **Run workflow**.
6. Download the `OmegaSeed-Windows-Portable-EXE` artifact from the completed run.

The artifact contains a portable unsigned Windows `.exe`. No custom icon is configured, so Electron/electron-builder will use its default icon behavior.

## Notes for sharing

- The executable is unsigned, so Windows may show a SmartScreen warning.
- The workflow currently builds the x64 portable target only.
- The packaged app includes the bootstrap save and the packaged scaffold save used by the viewer: `saves/omegaseed_save_epoch_72784.json`.
