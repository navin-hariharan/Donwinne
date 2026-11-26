// Preload script. Runs sandboxed with context isolation, so it is bundled by esbuild into a single
// CommonJS file whose only runtime `require` is "electron". It exposes `window.pnsDesktop`
// (the editor's DesktopBridge) plus an extra `onOpenPath`; raw ipcRenderer is never exposed.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { DesktopBridge, FileFilter, MenuCommand, OpenedFile, UpdateAction, UpdateStatus } from "../../../packages/editor/src/platform";
import { IPC, type NativeEditCommand } from "./ipc";

interface PnsDesktopApi extends DesktopBridge {
  /**
   * Subscribe to files the OS asks the app to open (command line argument, macOS open-file,
   * second launch). Files that arrived before the first subscription are delivered right after
   * subscribing. Returns an unsubscribe function.
   */
  onOpenPath(cb: (file: OpenedFile) => void): () => void;
}

const menuListeners = new Set<(command: MenuCommand) => void>();
const openPathListeners = new Set<(file: OpenedFile) => void>();

// Edit-menu commands whose accelerators would otherwise swallow keystrokes meant for text fields.
const NATIVE_EDIT: Partial<Record<MenuCommand, NativeEditCommand>> = {
  undo: "undo",
  redo: "redo",
  delete: "delete",
  "select-all": "selectAll",
};

function isEditableFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    const textual = ["text", "search", "url", "tel", "email", "password", "number", ""];
    return textual.includes(el.type) && !el.readOnly && !el.disabled;
  }
  return false;
}

ipcRenderer.on(IPC.menu, (_e: IpcRendererEvent, command: MenuCommand) => {
  const native = NATIVE_EDIT[command];
  if (native && isEditableFocused()) {
    void ipcRenderer.invoke(IPC.nativeEdit, native);
    return;
  }
  for (const cb of [...menuListeners]) {
    try {
      cb(command);
    } catch (err) {
      console.error("pnsDesktop menu listener failed", err);
    }
  }
});

const updateListeners = new Set<(status: UpdateStatus) => void>();
ipcRenderer.on(IPC.updateStatus, (_e: IpcRendererEvent, status: UpdateStatus) => {
  for (const cb of [...updateListeners]) {
    try {
      cb(status);
    } catch (err) {
      console.error("pnsDesktop update listener failed", err);
    }
  }
});

ipcRenderer.on(IPC.openPath, (_e: IpcRendererEvent, file: OpenedFile) => {
  for (const cb of [...openPathListeners]) {
    try {
      cb(file);
    } catch (err) {
      console.error("pnsDesktop open-path listener failed", err);
    }
  }
});

const api: PnsDesktopApi = {
  openFile: (filters: FileFilter[]) => ipcRenderer.invoke(IPC.openFile, filters),
  saveFile: (path, content, suggestedName, filters) => ipcRenderer.invoke(IPC.saveFile, path, content, suggestedName, filters),
  exportFile: (suggestedName, data, filters) => ipcRenderer.invoke(IPC.exportFile, suggestedName, data, filters),
  onMenu(cb) {
    menuListeners.add(cb);
    return () => {
      menuListeners.delete(cb);
    };
  },
  setDirty(dirty) {
    ipcRenderer.send(IPC.setDirty, !!dirty);
  },
  setTitle(title) {
    ipcRenderer.send(IPC.setTitle, String(title));
  },
  onOpenPath(cb) {
    const first = openPathListeners.size === 0;
    openPathListeners.add(cb);
    if (first) {
      // Tell main a listener exists and collect anything queued before the editor was ready.
      void ipcRenderer.invoke(IPC.takePendingOpen).then((files: OpenedFile[]) => {
        for (const f of files) for (const l of [...openPathListeners]) l(f);
      });
    }
    return () => {
      openPathListeners.delete(cb);
    };
  },
  onUpdate(cb) {
    updateListeners.add(cb);
    // The updater may have news from before the editor subscribed.
    void ipcRenderer.invoke(IPC.updateGet).then((status: UpdateStatus) => {
      if (updateListeners.has(cb)) cb(status);
    });
    return () => {
      updateListeners.delete(cb);
    };
  },
  updateAction(action: UpdateAction) {
    ipcRenderer.send(IPC.updateAction, action);
  },
};

contextBridge.exposeInMainWorld("pnsDesktop", api);
