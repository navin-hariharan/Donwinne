// Electron main process for Donwinne.

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen, shell, type MenuItemConstructorOptions, type WebContents } from "electron";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FileFilter, MenuCommand, OpenedFile } from "../../../packages/editor/src/platform";
import { IPC, type NativeEditCommand } from "./ipc";

const APP_NAME = "Donwinne";
const MODEL_EXT = ".pns.json";
const isMac = process.platform === "darwin";
const devUrl = process.env.PNS_DEV_URL?.trim() || null;

app.setName(APP_NAME);

let mainWindow: BrowserWindow | null = null;
let quitting = false;
/** Paths the renderer may write to without a dialog: files it opened or chose in a dialog. */
const knownPaths = new Set<string>();
/** Files the OS asked us to open before the renderer subscribed with onOpenPath. */
const pendingOpen: string[] = [];
/** WebContents ids whose renderer has subscribed with onOpenPath (reset on reload). */
const openPathReady = new Set<number>();
const dirtyState = new Map<number, boolean>();
const forceClose = new WeakSet<BrowserWindow>();

// ---------------------------------------------------------------------------------------------
// Locating the web app

function resolveIndexHtml(): string | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "web", "index.html")]
    : [
        // build/main.cjs -> apps/desktop/build -> apps/web/dist
        path.join(__dirname, "..", "..", "web", "dist", "index.html"),
        // copy made by `build.mjs --copy-web`
        path.join(__dirname, "..", "web", "index.html"),
      ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function appUrl(): string | null {
  if (devUrl) return devUrl;
  const index = resolveIndexHtml();
  return index ? pathToFileURL(index).toString() : null;
}

function isAppUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (devUrl) return u.origin === new URL(devUrl).origin;
    const index = resolveIndexHtml();
    if (u.protocol !== "file:" || !index) return false;
    const dir = path.dirname(index);
    const target = decodeURIComponent(u.pathname);
    const rel = path.relative(dir, process.platform === "win32" ? target.replace(/^\//, "") : target);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

function openExternalSafe(url: string): void {
  try {
    const { protocol } = new URL(url);
    if (protocol === "http:" || protocol === "https:" || protocol === "mailto:") void shell.openExternal(url);
  } catch {
    /* ignore malformed URLs */
  }
}

// ---------------------------------------------------------------------------------------------
// Window

function createWindow(): BrowserWindow {
  // Open at 1400x900, or smaller on a small screen so the whole window is visible.
  const work = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.max(640, Math.min(1400, work.width)),
    height: Math.max(540, Math.min(900, work.height)),
    // The editor lays itself out down to phone sizes; below about 640x540 it switches to the
    // compact phone layout, which is not what a desktop window should show.
    minWidth: 640,
    minHeight: 540,
    title: APP_NAME,
    show: false,
    // Matches the editor's background so the window doesn't flash white in dark mode.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#12151b" : "#f4f5f7",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  const id = win.webContents.id;

  win.once("ready-to-show", () => win.show());

  // The renderer controls the title through setTitle; ignore <title> changes.
  win.on("page-title-updated", (e) => e.preventDefault());

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    openExternalSafe(url);
  });
  win.webContents.on("will-redirect", (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  win.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      openPathReady.delete(id);
      dirtyState.set(id, false);
    }
  });

  win.on("close", (e) => {
    if (forceClose.has(win) || !dirtyState.get(id)) return;
    e.preventDefault();
    void dialog
      .showMessageBox(win, {
        type: "warning",
        buttons: ["Discard changes", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: APP_NAME,
        message: "You have unsaved changes.",
        detail: "Closing the window will discard them. Use Save first if you want to keep them.",
      })
      .then(({ response }) => {
        if (response === 0) {
          forceClose.add(win);
          win.close();
          if (quitting) app.quit();
        } else {
          quitting = false;
        }
      });
  });

  win.on("closed", () => {
    dirtyState.delete(id);
    openPathReady.delete(id);
    if (mainWindow === win) mainWindow = null;
  });

  const url = appUrl();
  if (url) {
    void win.loadURL(url);
  } else {
    const html = `<!doctype html><meta charset="utf-8"><title>${APP_NAME}</title>
<body style="font:14px system-ui,sans-serif;padding:2rem;color:#222">
<h2>Web app not built</h2><p>Could not find <code>apps/web/dist/index.html</code>.</p>
<p>Run <code>pnpm build</code> at the repository root, or set <code>PNS_DEV_URL</code> to a running Vite dev server.</p></body>`;
    void win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  }
  return win;
}

function focusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? mainWindow;
}

// ---------------------------------------------------------------------------------------------
// Opening files passed by the OS

/** Snoopy, PNML, ANDL and fault tree files open too; the editor works out the format. */
const OTHER_EXTS = [".pn", ".spped", ".xpn", ".spept", ".colpn", ".tpn", ".sptpt", ".spn", ".spstochpn", ".cpn", ".spcontped", ".hpn", ".sphybrid", ".colspn", ".colstochpn", ".colcpn", ".colcontped", ".colhpn", ".colhybpn", ".fspn", ".fuzzyspstochpn", ".fcpn", ".fspcontped", ".fhpn", ".fsphybrid", ".colfspn", ".colfstochpn", ".colfcpn", ".colcontfped", ".colfhpn", ".mpn", ".spmnet", ".spm", ".spfreen", ".spft", ".ft", ".speft", ".xft", ".colxpn", ".colextpn", ".pnml", ".andl", ".candl"];

function isModelPath(p: string): boolean {
  const l = p.toLowerCase();
  return l.endsWith(MODEL_EXT) || OTHER_EXTS.some((e) => l.endsWith(e));
}

function modelPathsFromArgv(argv: string[]): string[] {
  // Skip the executable (and, in dev, the app path given to `electron .`).
  const args = argv.slice(app.isPackaged ? 1 : 2);
  return args.filter((a) => !a.startsWith("-") && isModelPath(a)).map((a) => path.resolve(a));
}

async function readOpenedFile(p: string): Promise<OpenedFile> {
  const content = await fs.readFile(p, "utf8");
  knownPaths.add(p);
  return { path: p, name: path.basename(p), content };
}

async function deliverOpenPath(p: string): Promise<void> {
  const win = mainWindow;
  if (!win || win.isDestroyed() || !openPathReady.has(win.webContents.id)) {
    pendingOpen.push(p);
    return;
  }
  try {
    win.webContents.send(IPC.openPath, await readOpenedFile(p));
    if (win.isMinimized()) win.restore();
    win.focus();
  } catch (err) {
    dialog.showErrorBox(APP_NAME, `Could not open ${p}:\n${(err as Error).message}`);
  }
}

function requestOpen(p: string): void {
  if (app.isReady()) {
    if (!mainWindow) mainWindow = createWindow();
    void deliverOpenPath(p);
  } else {
    pendingOpen.push(p);
  }
}

// ---------------------------------------------------------------------------------------------
// IPC

function toDialogFilters(filters: FileFilter[] | undefined): Electron.FileFilter[] {
  if (!Array.isArray(filters)) return [];
  return filters
    .filter((f) => f && typeof f.name === "string" && Array.isArray(f.extensions))
    // Dialogs want extensions without a leading dot ("pns.json", "pnml").
    .map((f) => ({ name: f.name, extensions: f.extensions.map((x) => String(x).replace(/^\./, "")) }));
}

function windowOf(sender: WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(sender);
}

let lastDir: string | null = null;
function defaultPathFor(name: string): string {
  return path.join(lastDir ?? app.getPath("documents"), path.basename(name || "untitled"));
}

async function askSavePath(sender: WebContents, defaultPath: string, filters: FileFilter[]): Promise<string | null> {
  const win = windowOf(sender);
  const opts: Electron.SaveDialogOptions = { defaultPath, filters: toDialogFilters(filters), properties: ["createDirectory", "showOverwriteConfirmation"] };
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (res.canceled || !res.filePath) return null;
  lastDir = path.dirname(res.filePath);
  return res.filePath;
}

function registerIpc(): void {
  ipcMain.handle(IPC.openFile, async (e, filters: FileFilter[]): Promise<OpenedFile | null> => {
    const win = windowOf(e.sender);
    const opts: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      filters: [...toDialogFilters(filters), { name: "All files", extensions: ["*"] }],
      ...(lastDir ? { defaultPath: lastDir } : {}),
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const p = res.filePaths[0];
    if (res.canceled || !p) return null;
    lastDir = path.dirname(p);
    app.addRecentDocument(p);
    return readOpenedFile(p);
  });

  ipcMain.handle(
    IPC.saveFile,
    async (e, filePath: string | null, content: string, suggestedName: string, filters: FileFilter[]) => {
      let target: string | null = typeof filePath === "string" && filePath ? path.resolve(filePath) : null;
      // Only write silently to paths the user opened or chose; anything else goes through a dialog.
      if (!target || !knownPaths.has(target)) {
        target = await askSavePath(e.sender, target ?? defaultPathFor(suggestedName), filters);
        if (!target) return null;
      }
      await fs.writeFile(target, String(content), "utf8");
      knownPaths.add(target);
      app.addRecentDocument(target);
      return { path: target, name: path.basename(target) };
    },
  );

  ipcMain.handle(IPC.exportFile, async (e, suggestedName: string, data: string | Uint8Array, filters: FileFilter[]) => {
    const target = await askSavePath(e.sender, defaultPathFor(suggestedName), filters);
    if (!target) return false;
    if (typeof data === "string") await fs.writeFile(target, data, "utf8");
    else await fs.writeFile(target, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    return true;
  });

  ipcMain.on(IPC.setDirty, (e, dirty: boolean) => {
    dirtyState.set(e.sender.id, !!dirty);
    windowOf(e.sender)?.setDocumentEdited(!!dirty); // macOS close-button dot; no-op elsewhere
  });

  ipcMain.on(IPC.setTitle, (e, title: string) => {
    const t = String(title ?? "").trim();
    windowOf(e.sender)?.setTitle(t || APP_NAME);
  });

  ipcMain.handle(IPC.nativeEdit, (e, cmd: NativeEditCommand) => {
    const wc = e.sender;
    if (cmd === "undo") wc.undo();
    else if (cmd === "redo") wc.redo();
    else if (cmd === "delete") wc.delete();
    else if (cmd === "selectAll") wc.selectAll();
  });

  ipcMain.handle(IPC.takePendingOpen, async (e) => {
    openPathReady.add(e.sender.id);
    const paths = pendingOpen.splice(0);
    const files: OpenedFile[] = [];
    for (const p of paths) {
      try {
        files.push(await readOpenedFile(p));
      } catch (err) {
        dialog.showErrorBox(APP_NAME, `Could not open ${p}:\n${(err as Error).message}`);
      }
    }
    return files;
  });
}

// ---------------------------------------------------------------------------------------------
// Menu

function send(command: MenuCommand): void {
  const win = focusedWindow();
  if (win && !win.isDestroyed()) win.webContents.send(IPC.menu, command);
}

function item(label: string, command: MenuCommand, accelerator?: string): MenuItemConstructorOptions {
  return { label, accelerator, click: () => send(command) };
}

function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [];
  if (isMac) template.push({ role: "appMenu" });

  template.push({
    label: "&File",
    submenu: [
      item("New…", "new", "CmdOrCtrl+N"),
      item("New APN from Building Blocks…", "ambient:blocks"),
      item("Open…", "open", "CmdOrCtrl+O"),
      ...(isMac ? [{ role: "recentDocuments" as const, submenu: [{ role: "clearRecentDocuments" as const }] }] : []),
      { type: "separator" },
      item("Save", "save", "CmdOrCtrl+S"),
      item("Save As…", "save-as", "CmdOrCtrl+Shift+S"),
      { type: "separator" },
      item("Import (Snoopy, PNML, ANDL)…", "import"),
      {
        label: "Export As",
        submenu: [
          item("Snoopy File…", "export:snoopy"),
          item("PNML…", "export:pnml"),
          item("ANDL…", "export:andl"),
          item("CANDL…", "export:candl"),
          item("LoLA…", "export:lola"),
          item("TINA…", "export:tina"),
          item("APNN…", "export:apnn"),
          item("PRISM…", "export:prism"),
          item("SBML…", "export:sbml"),
          item("Declarations as CSV…", "export:csv"),
          item("Minimal Cut Sets (DNF)…", "export:dnf"),
          item("LaTeX (TikZ)…", "export:tikz"),
          { type: "separator" },
          item("SVG Image…", "export-svg"),
          item("PNG Image…", "export-png"),
        ],
      },
      item("Print…", "print", "CmdOrCtrl+P"),
      ...(isMac ? [] : [{ type: "separator" as const }, { role: "quit" as const, label: "Quit", accelerator: "CmdOrCtrl+Q" }]),
    ],
  });

  template.push({
    label: "&Edit",
    submenu: [
      item("Undo", "undo", "CmdOrCtrl+Z"),
      item("Redo", "redo", "CmdOrCtrl+Shift+Z"),
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      item("Duplicate", "duplicate", "CmdOrCtrl+D"),
      item("Delete", "delete", "Delete"),
      { type: "separator" },
      item("Select All", "select-all", "CmdOrCtrl+A"),
      item("Find…", "find", "CmdOrCtrl+F"),
      item("Group into Subnet", "group", "CmdOrCtrl+G"),
      item("Auto Layout", "layout", "CmdOrCtrl+L"),
    ],
  });

  template.push({
    label: "&View",
    submenu: [
      item("Zoom In", "zoom-in", "CmdOrCtrl+="),
      item("Zoom Out", "zoom-out", "CmdOrCtrl+-"),
      item("Zoom to Fit", "zoom-fit", "CmdOrCtrl+0"),
      // Shift+F is handled by the page: as a menu accelerator it would swallow capital Fs typed into text fields.
      item("Zoom to Selection", "zoom-selection"),
      item("Overview Map", "toggle-minimap"),
      item("Element Table and Hierarchy", "elements"),
      { type: "separator" },
      { role: "toggleDevTools" },
      { role: "togglefullscreen" },
    ],
  });

  template.push({
    label: "&Analyse",
    submenu: [
      item("Token Game", "simulate"),
      item("Reachability Graph…", "reachability"),
      item("Net Properties and Invariants…", "analyse"),
      item("Model Checking (CTL)…", "ctl"),
      { type: "separator" },
      item("Unfold to an Uncoloured Net", "unfold"),
      { type: "separator" },
      {
        label: "Ambient (Konios)",
        submenu: [
          item("Step Token Game", "simulate"),
          item("Concurrent Reachability Graph…", "ambient:crg"),
          item("APN Properties…", "ambient:props"),
          item("Model Checking (CTL)…", "ctl"),
          { type: "separator" },
          item("Construct T-APN", "ambient:construct"),
          item("Check Equivalence…", "ambient:equivalence"),
          { type: "separator" },
          item("Building Blocks…", "ambient:blocks"),
          item("Compose Steps…", "ambient:compose"),
        ],
      },
    ],
  });

  if (isMac) template.push({ role: "windowMenu" });

  template.push({
    role: "help",
    label: "&Help",
    submenu: [item("Quick Guide", "help"), item(`About ${APP_NAME}`, "about")],
  });

  return Menu.buildFromTemplate(template);
}

// ---------------------------------------------------------------------------------------------
// App lifecycle

// macOS delivers double-clicked / dropped-on-dock files through open-file, possibly before ready.
app.on("open-file", (e, p) => {
  e.preventDefault();
  if (isModelPath(p)) requestOpen(p);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    for (const p of modelPathsFromArgv(argv)) requestOpen(p);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  pendingOpen.push(...modelPathsFromArgv(process.argv));

  app.on("before-quit", () => {
    quitting = true;
  });

  // Defence in depth: no webview tags, no new windows from any web contents.
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (ev) => ev.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      openExternalSafe(url);
      return { action: "deny" };
    });
  });

  void app.whenReady().then(() => {
    registerIpc();
    Menu.setApplicationMenu(buildMenu());
    mainWindow = createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (!isMac || quitting) app.quit();
  });
}
