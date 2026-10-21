# @pns/desktop — Donwinne desktop shell

Electron wrapper around the web app (`apps/web`). The renderer is the Vite build in
`apps/web/dist`. The shell adds native file dialogs, an application menu, an unsaved-changes
prompt when you close the window, and `.pns.json` file association, all exposed to the editor
through `window.pnsDesktop` (see `packages/editor/src/platform.ts`).

- `src/main.ts`: main process (window, menu, dialogs, IPC, opening files from the OS)
- `src/preload.ts`: sandboxed preload that exposes `window.pnsDesktop` with `contextBridge`
- `scripts/build.mjs`: esbuild bundles both into `build/main.cjs` and `build/preload.cjs`

## Run in development

```sh
pnpm install
pnpm desktop                      # from the repo root: builds the web app, then the shell, then runs it
pnpm --filter @pns/desktop start  # shell only; uses the existing apps/web/dist build
```

For hot reload, run the Vite dev server and point the shell at it:

```sh
pnpm dev                                                   # terminal 1 (apps/web)
PNS_DEV_URL=http://localhost:5173 pnpm --filter @pns/desktop start   # terminal 2
```

To open a model on startup, pass it on the command line:
`pnpm --filter @pns/desktop exec electron . path/to/model.pns.json`.

If `pnpm install` doesn't download the Electron binary (because of pnpm 10 build-script approval or
a blocked network), run `node node_modules/electron/install.js` in this folder.

## Build installers

```sh
pnpm desktop:dist                        # from the repo root: web build + installers for the current OS
pnpm --filter @pns/desktop dist:linux    # AppImage + deb (x64)
pnpm --filter @pns/desktop dist:win      # NSIS installer (x64)
pnpm --filter @pns/desktop dist:mac      # dmg (x64 + arm64)
```

Output goes to `apps/desktop/release/`. `dist*` copies `apps/web/dist` to `apps/desktop/web`, which
electron-builder ships as `resources/web` (via `extraResources`). Build the web app first.

Where to build each OS's installers:

- **Linux** (AppImage, deb): build on Linux.
- **macOS** (dmg): must be built on a Mac. Code signing and notarization need an Apple Developer
  ID (`CSC_LINK`, `APPLE_ID`, …). Unsigned builds still work locally, but Gatekeeper warns about them.
- **Windows** (NSIS): best built on Windows. You can build from Linux or macOS with `wine`
  installed. Use `CSC_LINK`/`CSC_KEY_PASSWORD` for code signing.

The app icon is `resources/icon.png` (1024×1024, the Donwinne logo); electron-builder derives the
Windows and macOS icons from it. Add `icon.icns` or `icon.ico` beside it to use hand-tuned versions.
The `linux.maintainer` email and `homepage` in `package.json` are placeholders.
