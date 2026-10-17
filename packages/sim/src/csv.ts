// CSV export of simulation traces in Snoopy's layout: a Time column, then one column per series.

import type { Trace } from "./simulate";

export interface CsvOptions {
  /** Column separator (default ","). Use ";" for spreadsheets with a decimal comma. */
  separator?: "," | ";" | "\t";
  /** Write numbers with a decimal comma (sensible with separator ";"). */
  decimalComma?: boolean;
  /** Only these kinds of series (default: all, observers last). */
  kinds?: ("place" | "transition" | "observer")[];
  /** Only series with these ids, in this order (default: all). */
  ids?: string[];
  /** Significant digits (default: shortest exact representation). */
  precision?: number;
  /** Fuzzy traces: add lower/upper columns for this alpha level. */
  alpha?: number;
}

/** Render a trace as CSV text with a header row `Time,<series names>`. */
export function traceToCsv(trace: Trace, opts: CsvOptions = {}): string {
  const sep = opts.separator ?? ",";
  let series = [...trace.series, ...(trace.observers ?? [])];
  if (opts.kinds) series = series.filter((s) => opts.kinds!.includes(s.kind));
  if (opts.ids) {
    const byId = new Map(series.map((s) => [s.id, s]));
    series = opts.ids.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
  }
  const fmt = (v: number) => {
    let s = opts.precision ? Number(v.toPrecision(opts.precision)).toString() : String(v);
    if (opts.decimalComma) s = s.replace(".", ",");
    return s;
  };
  const quote = (s: string) => (s.includes(sep) || s.includes('"') || /\s/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const cols: { name: string; values: number[] }[] = [];
  for (const s of series) {
    cols.push({ name: s.name, values: s.values });
    if (opts.alpha !== undefined && s.bands) {
      const b = s.bands.find((x) => Math.abs(x.alpha - opts.alpha!) < 1e-12);
      if (b) cols.push({ name: `${s.name}_lower`, values: b.lower }, { name: `${s.name}_upper`, values: b.upper });
    }
  }
  const lines = [["Time", ...cols.map((c) => c.name)].map(quote).join(sep)];
  trace.times.forEach((t, i) => lines.push([fmt(t), ...cols.map((c) => fmt(c.values[i]))].join(sep)));
  return lines.join("\n") + "\n";
}
