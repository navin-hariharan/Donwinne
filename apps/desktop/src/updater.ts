// App updates from the GitHub releases, in the spirit of Discord: the installed app checks for a new
// version when it starts and every few hours, downloads it in the background and installs it the next
// time it restarts, with a banner offering to restart now. Turning off "Install Updates Automatically"
// (Help menu) makes it ask before downloading each update instead.
//
// electron-builder writes app-update.yml (where to look) into the installed app and latest*.yml (what
// the newest version is) next to the installers; the release workflow uploads both kinds to the release.

import { app, dialog, shell, type BrowserWindow } from "electron";
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { UpdateAction, UpdateStatus } from "../../../packages/editor/src/platform";

export const RELEASES_URL = "https://github.com/navin-hariharan/donwinne/releases/latest";
const FIRST_CHECK_MS = 8_000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

interface Settings {
  /** Download and install updates without asking (the default). */
  automatic: boolean;
}

let settings: Settings = { automatic: true };
let status: UpdateStatus = { state: "idle" };
let enabled = false;
/** The person asked from the menu, so "up to date" and failures are reported in a dialog. */
let manualCheck = false;
/** The person chose to download this update (ask mode), so its progress is shown. */
let userStartedDownload = false;
let checking = false;
let publish: (status: UpdateStatus) => void = () => {};
let getWindow: () => BrowserWindow | null = () => null;

function settingsPath(): string {
  return path.join(app.getPath("userData"), "update-settings.json");
}

function loadSettings(): void {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), "utf8")) as Partial<Settings>;
    if (typeof raw.automatic === "boolean") settings = { automatic: raw.automatic };
  } catch {
    /* first run or unreadable: keep the defaults */
  }
}

function saveSettings(): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
  } catch (err) {
    console.error("Could not save the update settings", err);
  }
}

function setStatus(next: UpdateStatus): void {
  status = next;
  publish(status);
}

export function updateStatus(): UpdateStatus {
  return status;
}

export function automaticUpdates(): boolean {
  return settings.automatic;
}

/** Updates only make sense for the installed app: not when run from source or for a screenshot. */
export function updatesSupported(): boolean {
  return enabled;
}

async function showMessage(message: string, detail: string, buttons = ["OK"]): Promise<number> {
  const win = getWindow();
  const opts: Electron.MessageBoxOptions = { type: "info", buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true, title: app.getName(), message, detail };
  const res = win && !win.isDestroyed() ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  return res.response;
}

function versionOf(info: UpdateInfo): string {
  return String(info.version ?? "").replace(/^v/, "");
}

export function initUpdater(opts: { send: (status: UpdateStatus) => void; window: () => BrowserWindow | null; disabled?: boolean }): void {
  publish = opts.send;
  getWindow = opts.window;
  enabled = app.isPackaged && !opts.disabled && !process.env.PNS_DISABLE_UPDATES;
  loadSettings();
  if (!enabled) return;

  autoUpdater.autoDownload = settings.automatic;
  // A downloaded update always installs when the app quits, whichever mode found it.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    const version = versionOf(info);
    if (autoUpdater.autoDownload) setStatus({ state: "downloading", version, percent: 0, quiet: !manualCheck });
    else setStatus({ state: "available", version });
    manualCheck = false;
  });

  autoUpdater.on("update-not-available", () => {
    setStatus({ state: "idle" });
    if (manualCheck) {
      manualCheck = false;
      void showMessage("Donwinne is up to date.", `You have the newest version, ${app.getVersion()}.`);
    }
  });

  autoUpdater.on("download-progress", (p: ProgressInfo) => {
    if (status.state !== "downloading") return;
    setStatus({ ...status, percent: Math.max(0, Math.min(100, Math.round(p.percent))) });
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    userStartedDownload = false;
    setStatus({ state: "ready", version: versionOf(info) });
  });

  autoUpdater.on("error", (err: Error) => {
    console.error("Update failed:", err?.message ?? err);
    // A failed background check (offline, GitHub unreachable) stays quiet. Once an update was found,
    // or when the person asked, say so and offer the download page instead.
    const visible = manualCheck || userStartedDownload || status.state === "available" || status.state === "downloading";
    manualCheck = false;
    userStartedDownload = false;
    if (visible) setStatus({ state: "error", message: "The update couldn't be installed automatically. You can download it from the releases page." });
    else if (status.state !== "ready") setStatus({ state: "idle" });
  });

  setTimeout(() => void checkForUpdates(false), FIRST_CHECK_MS);
  setInterval(() => void checkForUpdates(false), CHECK_EVERY_MS);
}

/** Look for a new version. From the menu (`manual`), the answer is always reported. */
export async function checkForUpdates(manual: boolean): Promise<void> {
  if (!enabled) {
    if (manual) {
      const choice = await showMessage(
        "Updates aren't available here.",
        "Automatic updates work in the installed app. You can download the newest version from the releases page.",
        ["Open the Releases Page", "Close"],
      );
      if (choice === 0) void shell.openExternal(RELEASES_URL);
    }
    return;
  }
  if (status.state === "ready") {
    if (manual) setStatus(status); // show the banner again
    return;
  }
  if (checking || status.state === "downloading") {
    if (manual && status.state === "downloading") setStatus({ ...status, quiet: false });
    return;
  }
  checking = true;
  manualCheck = manual;
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    /* reported through the "error" event */
  } finally {
    checking = false;
  }
}

export function setAutomaticUpdates(automatic: boolean): void {
  settings = { automatic };
  saveSettings();
  if (!enabled) return;
  autoUpdater.autoDownload = automatic;
  // Switching to automatic with an update waiting: start downloading it now.
  if (automatic && status.state === "available") void startDownload(true);
}

async function startDownload(quiet: boolean): Promise<void> {
  if (status.state !== "available") return;
  const version = status.version;
  userStartedDownload = !quiet;
  setStatus({ state: "downloading", version, percent: 0, quiet });
  try {
    await autoUpdater.downloadUpdate();
  } catch {
    /* reported through the "error" event */
  }
}

export function handleUpdateAction(action: UpdateAction): void {
  switch (action) {
    case "download":
      void startDownload(false);
      return;
    case "restart":
      if (status.state !== "ready") return;
      // Quits (the unsaved-changes prompt still applies), installs silently and starts the new version.
      setImmediate(() => autoUpdater.quitAndInstall(true, true));
      return;
    case "later":
      // A ready update still installs when the app quits; nothing else to do.
      return;
    case "open-page":
      void shell.openExternal(RELEASES_URL);
      return;
  }
}
