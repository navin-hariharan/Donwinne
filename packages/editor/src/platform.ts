// Bridge between the editor and the desktop shell. In the browser `window.pnsDesktop` is undefined
// and the editor falls back to downloads, file inputs and keyboard shortcuts.

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface OpenedFile {
  path: string;
  name: string;
  content: string;
}

export type MenuCommand =
  | "new-pt"
  | "new-xpt"
  | "new-coloured"
  | "open"
  | "save"
  | "save-as"
  | "import-pnml"
  | "export-pnml"
  | "export-svg"
  | "export-png"
  | "undo"
  | "redo"
  | "delete"
  | "select-all"
  | "zoom-in"
  | "zoom-out"
  | "zoom-fit"
  | "zoom-selection"
  | "about"
  | "new"
  | "import"
  | "print"
  | "duplicate"
  | "find"
  | "help"
  | "layout"
  | "group"
  | "toggle-minimap"
  | "reachability"
  | "simulate"
  | "unfold"
  | "analyse"
  | "elements"
  | "new-apn"
  | "ctl"
  | "ambient:crg"
  | "ambient:props"
  | "ambient:construct"
  | "ambient:equivalence"
  | "ambient:blocks"
  | "ambient:compose"
  | `export:${string}`;

export interface DesktopBridge {
  /** Show an open dialog and read the chosen file as UTF-8 text. Null if cancelled. */
  openFile(filters: FileFilter[]): Promise<OpenedFile | null>;
  /** Write text to `path`, or show a save dialog first when `path` is null. Null if cancelled. */
  saveFile(path: string | null, content: string, suggestedName: string, filters: FileFilter[]): Promise<{ path: string; name: string } | null>;
  /** Show a save dialog and write text or binary data. False if cancelled. */
  exportFile(suggestedName: string, data: string | Uint8Array, filters: FileFilter[]): Promise<boolean>;
  /** Subscribe to application menu commands. Returns an unsubscribe function. */
  onMenu(cb: (command: MenuCommand) => void): () => void;
  /** Tell the shell whether there are unsaved changes, so it can confirm before closing. */
  setDirty(dirty: boolean): void;
  setTitle(title: string): void;
  /** Files handed over by the OS (command line, double-click, macOS open-file). */
  onOpenPath?(cb: (file: OpenedFile) => void): () => void;
}

declare global {
  interface Window {
    pnsDesktop?: DesktopBridge;
  }
}

export const desktop = (): DesktopBridge | undefined => (typeof window !== "undefined" ? window.pnsDesktop : undefined);
