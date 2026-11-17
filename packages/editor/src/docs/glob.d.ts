// The part of Vite's import.meta.glob that the documentation uses (Vite and Vitest provide it).
interface ImportMeta {
  glob(pattern: string | string[], options: { query?: string; import?: string; eager: true }): Record<string, unknown>;
  glob(pattern: string | string[], options?: { query?: string; import?: string; eager?: false }): Record<string, () => Promise<unknown>>;
}
