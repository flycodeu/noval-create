# Windows Packaging

## Commands

- `npm run generate:icon`: regenerate the temporary NovelForge icon assets in `build/`
- `npm run setup:nsis`: download and extract the local NSIS bundle into `.local-tools/nsis`
- `npm run setup:nsis-resources`: download and extract `nsis-resources-3.4.1` into the local electron-builder cache
- `npm run setup:win-tools`: prepare both the local NSIS bundle and the local NSIS resources cache
- `npm run rebuild:native`: rebuild native dependencies for the current Electron version
- `npm run build:app`: compile main, preload, and renderer into `out/`
- `npm run build:dir`: build and assemble a Windows app directory without generating installers
- `npm run build`: build the full Windows installer + portable targets
- `npm run build:installer`: explicit full Windows packaging entry
- `npm run build:installer:signed`: build a signed Windows package when certificate variables are available

## Current Packaging Strategy

- `electron-builder` reads packaged files from `out/`, which matches the actual `electron-vite` output
- Electron binaries come from `node_modules/electron/dist`, so Electron itself is not downloaded during packaging
- NSIS is resolved from `.local-tools/nsis` through `ELECTRON_BUILDER_NSIS_DIR`, which avoids the runtime GitHub download that was failing before
- `nsis-resources-3.4.1` is pre-extracted into `.local-tools/electron-builder-cache/nsis/nsis-resources-3.4.1` and reused through `ELECTRON_BUILDER_CACHE`
- the temporary application icon now lives in `build/icon.ico`, with dedicated NSIS installer/uninstaller icons in the same folder
- builder-time native rebuild remains disabled to avoid `better_sqlite3.node` lock conflicts; native dependency prep stays on `electron-builder install-app-deps`
- `signAndEditExecutable` stays disabled for the default unsigned flow so local packaging does not trigger `winCodeSign` downloads

## Local Tooling Layout

- local NSIS bundle: `.local-tools/nsis`
- cached NSIS archive: `.local-tools/archives/nsis-3.0.4.1.7z`
- cached NSIS resources archive: `.local-tools/archives/nsis-resources-3.4.1.7z`
- local electron-builder cache: `.local-tools/electron-builder-cache`
- build resources: `build/`
- the local tooling directory is ignored by git and can be recreated at any time with `npm run setup:win-tools`

## Optional Signing Flow

- signing uses the local Windows `signtool.exe` instead of electron-builder's internal signing download path
- default lookup prefers `NOVELFORGE_SIGNTOOL_PATH`, then common Windows SDK locations already present on this machine
- supported certificate inputs:
  - `NOVELFORGE_WINDOWS_CERT_FILE`
  - `NOVELFORGE_WINDOWS_CERT_PASSWORD`
  - optional `NOVELFORGE_WINDOWS_CERT_SHA1`
  - optional `NOVELFORGE_WINDOWS_TIMESTAMP_URL`
- signed packaging flow:
  1. build `win-unpacked`
  2. sign the unpacked app executable
  3. build installer + portable from `--prepackaged release/win-unpacked`
  4. sign top-level `.exe` artifacts in `release/`

## Before Packaging

- close any running NovelForge app window
- stop any local dev process started with `npm run dev`
- if Windows reports `better_sqlite3.node` is busy, close related Electron or Node processes and rerun `npm run rebuild:native`
- if `.local-tools/nsis` or `.local-tools/electron-builder-cache/nsis/nsis-resources-3.4.1` is missing, run `npm run setup:win-tools` once before `npm run build`
