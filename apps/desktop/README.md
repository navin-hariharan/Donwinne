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

To save a picture of the window and exit (for automated checks), pass `--screenshot <file.png>`:
`pnpm --filter @pns/desktop exec electron . --screenshot shot.png`. The window is drawn off-screen, so
nothing appears and focus is never taken; it uses a temporary profile, so your auto-saved work is not
touched, and it runs even while the app is already open.

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

On GitHub, the **Desktop release** workflow (`.github/workflows/desktop-release.yml`) does all three
whenever the version changes and attaches the installers to a release `v<version>`. Signing secrets
are optional; without them the installers are unsigned.

## Updates

Installed copies update themselves from the GitHub releases (`src/updater.ts`, with `electron-updater`).
About 8 seconds after start and then every 4 hours, the app reads `latest.yml` (Windows),
`latest-mac.yml` or `latest-linux.yml` from the newest release. By default it downloads a new version
in the background and installs it the next time the app quits. A banner offers **Restart Now** (it
asks first if there are unsaved changes). Under **Help** are **Check for Updates…** and **Install Updates
Automatically**. With the second unchecked, the banner asks before downloading each update. The choice
is kept in `update-settings.json` in the app's data folder. Failed background checks (offline, no
release yet) stay silent. If an update fails after it was found, the banner links to the releases page.

- `publish` in `package.json` (GitHub, `navin-hariharan/donwinne`) makes electron-builder write
  `app-update.yml` into the app and `latest*.yml` next to the installers. The release workflow uploads
  those, the `.blockmap` files (for smaller downloads) and the macOS `.zip` (macOS updates install from
  it, not from the dmg).
- **Windows** (NSIS) and **Linux** AppImage update in place. The **deb** asks for the system password
  to install. **macOS** can only install updates into a signed app; unsigned builds get the banner
  link to the releases page instead.
- Updates are off when the app runs from source, in `--screenshot` mode, or with `PNS_DISABLE_UPDATES=1`.
- Copies older than 0.4.2 have no updater: they need one manual install of 0.4.2 or newer.

The app icon is `resources/icon.png` (1024×1024, the Donwinne logo); electron-builder derives the
Windows and macOS icons from it. Add `icon.icns` or `icon.ico` beside it to use hand-tuned versions.
The deb package needs `homepage` (set to the GitHub repository) and `linux.maintainer` in `package.json`.
