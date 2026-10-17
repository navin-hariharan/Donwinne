// IPC channel names shared by main and preload. esbuild bundles this module into each output
// file, so the sandboxed preload never has to require a local module at runtime.

export const IPC = {
  openFile: "pns:open-file",
  saveFile: "pns:save-file",
  exportFile: "pns:export-file",
  setDirty: "pns:set-dirty",
  setTitle: "pns:set-title",
  nativeEdit: "pns:native-edit",
  takePendingOpen: "pns:take-pending-open",
  menu: "pns:menu",
  openPath: "pns:open-path",
} as const;

export type NativeEditCommand = "undo" | "redo" | "delete" | "selectAll";
