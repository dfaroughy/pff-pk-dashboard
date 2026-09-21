export type GridMode = "study" | "uniform" | "custom";

export function targetGrid(mode: GridMode, start: string, end: string, count: string, custom: string): { times?: number[]; error?: string } {
  if (mode === "study") return {};
  let times: number[];
  if (mode === "uniform") {
    const a = Number(start), b = Number(end), n = Number(count);
    if (!start.trim() || !end.trim() || !Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a)
      return { error: "Enter a nonnegative start and a later end time." };
    if (!Number.isInteger(n) || n < 2 || n > 256) return { error: "Choose 2–256 time points." };
    times = Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
  } else {
    times = custom.trim().split(/[\s,;]+/).map(Number);
    if (!custom.trim() || times.some(t => !Number.isFinite(t) || t < 0)) return { error: "Enter nonnegative times separated by commas." };
    times = [...new Set(times)].sort((a, b) => a - b);
    if (times.length < 2 || times.length > 256) return { error: "Enter 2–256 distinct times." };
  }
  return { times };
}
