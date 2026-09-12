import type { InferenceResponse } from "./model-api";
import type { Point, Study, Subject } from "./types";
import type { TargetColumn } from "../components/TargetCovariateTable";

export type CovariateGroup = { label: string; color: string; observed: Subject[]; generated: number[] };
export const groupColors = ["#287ca7", "#cb7133", "#8768b3", "#279181", "#c25585", "#7a8535"];
export function covariateValue(row: Record<string, unknown> | undefined, column: TargetColumn): number | string | null {
  const value = row?.[column.key];
  if (value === undefined || value === null || value === "") return null;
  if (column.options) return column.key === "cov_cat_0" ? String(value) : String(value).toLowerCase();
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function covariateGroups(study: Study, result: InferenceResponse | null, column: TargetColumn, bins: number): CovariateGroup[] {
  const observed = study.subjects.map(s => covariateValue(s.covariates, column));
  const generated = (result?.generatedConcentration ?? []).map((_, i) => covariateValue(result?.request.targetCovariates?.[i], column));
  const all = [...observed, ...generated].filter(v => v !== null);
  if (!all.length) return [];
  let labels: string[], assign: (value: number | string | null) => number;
  if (column.options) {
    labels = [...new Set(all.map(String))].sort();
    assign = value => value === null ? -1 : labels.indexOf(String(value));
  } else {
    const low = Math.min(...all.map(Number)), high = Math.max(...all.map(Number));
    const count = low === high ? 1 : Math.max(2, Math.min(6, bins));
    const width = (high - low) / count;
    labels = Array.from({ length: count }, (_, i) => count === 1 ? low.toPrecision(3)
      : `${(low + i * width).toPrecision(3)} – ${(low + (i + 1) * width).toPrecision(3)}${i < count - 1 ? " (excl.)" : ""}`);
    assign = value => value === null ? -1 : width === 0 ? 0 : Math.min(count - 1, Math.floor((Number(value) - low) / width));
  }
  return labels.map((label, i) => ({ label, color: groupColors[i % groupColors.length],
    observed: study.subjects.filter((_, j) => assign(observed[j]) === i),
    generated: generated.flatMap((v, j) => assign(v) === i ? [j] : []),
  }));
}

export type PkRow = { id: string; x: number | string; value: number; generated: boolean; color: string };

export type MomentPoint = { time: number; mean: number; sd: number | null; n: number };
function moments(time: number, values: number[]): MomentPoint {
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
  const sd = values.length > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1)) : null;
  return { time, mean, sd, n: values.length };
}

// Exact observation times: no time binning, interpolation or extrapolation.
// A censored value does not identify a mean/SD: leave a gap at that time.
export function covariateMoments(study: Study, result: InferenceResponse | null, group: CovariateGroup) {
  const times = new Map<number, { values: number[]; censored: boolean }>();
  group.observed.forEach(s => s.points.forEach(([t, c], i) => {
    if (!Number.isFinite(t)) return;
    const row = times.get(t) ?? { values: [], censored: false };
    if (!Number.isFinite(c) || c < 0 || s.cens?.[i] === 1 || s.cens?.[i] === null || (study.assay && c <= study.assay.lloq)) row.censored = true;
    else row.values.push(c);
    times.set(t, row);
  }));
  const ordered = [...times.entries()].sort(([a], [b]) => a - b);
  const observed = ordered.map(([t, row]) => moments(t, row.censored ? [] : row.values));
  const generated = ordered.map(([t]) => {
    if (!result?.queryTime.length) return moments(t, []);
    const j = result.queryTime.reduce((best, v, k) => Math.abs(v - t) < Math.abs(result.queryTime[best] - t) ? k : best, 0);
    if (Math.abs(result.queryTime[j] - t) > Math.max(1, Math.abs(t)) * 2e-6) return moments(t, []);
    return moments(t, group.generated.map(i => result.generatedConcentration[i]?.[j]).filter(v => Number.isFinite(v) && v >= 0));
  });
  return { observed, generated };
}
// Interpolate only within the measured window, never extrapolate to t=0/infinity.
function windowPoints(points: Point[], low: number, high: number): Point[] {
  const sorted = points.filter(([t, y]) => Number.isFinite(t) && Number.isFinite(y) && y >= 0).sort((a, b) => a[0] - b[0]);
  const at = (time: number): number | null => {
    const exact = sorted.find(([t]) => t === time);
    if (exact) return exact[1];
    for (let i = 1; i < sorted.length; i++) {
      const [a, x] = sorted[i - 1], [b, y] = sorted[i];
      if (a < time && time < b) return x + (y - x) * (time - a) / (b - a);
    }
    return null;
  };
  const a = at(low), b = at(high);
  return a === null || b === null ? [] : [[low, a], ...sorted.filter(([t]) => t > low && t < high), [high, b]];
}

export function covariatePk(study: Study, result: InferenceResponse | null, column: TargetColumn, groups: CovariateGroup[], metric: string) {
  const subjects = groups.flatMap(g => g.observed);
  const ranges = subjects.filter(s => s.points.length >= 2).map(s => [Math.min(...s.points.map(p => p[0])), Math.max(...s.points.map(p => p[0]))]);
  if (!ranges.length) return { rows: [] as PkRow[], window: null, excluded: 0 };
  const low = Math.max(...ranges.map(r => r[0])), high = Math.min(...ranges.map(r => r[1]));
  if (high <= low) return { rows: [] as PkRow[], window: null, excluded: 0 };
  const rows: PkRow[] = []; let excluded = 0;
  const add = (id: string, points: Point[], x: number | string | null, generated: boolean, color: string) => {
    const p = windowPoints(points, low, high);
    if (x === null || p.length < 2) { excluded++; return; }
    const peak = p.reduce((best, v) => v[1] > best[1] ? v : best, p[0]);
    const value = metric === "Cmax" ? peak[1] : metric === "Tmax" ? peak[0]
      : p.slice(1).reduce((sum, [t, c], i) => sum + (t - p[i][0]) * (c + p[i][1]) / 2, 0);
    rows.push({ id, x, value, generated, color });
  };
  groups.forEach(group => {
    group.observed.forEach(s => {
      if (s.points.some(([, c], i) => s.cens?.[i] === 1 || s.cens?.[i] === null || (study.assay && c <= study.assay.lloq))) { excluded++; return; }
      add(s.id, s.points, covariateValue(s.covariates, column), false, group.color);
    });
    group.generated.forEach((i, index) => {
      if (!result) return;
      // Match acquisition schedules within this stratum, not across sexes/bins.
      const schedule = group.observed[index % group.observed.length]?.points;
      if (!schedule) { excluded++; return; }
      const full = result.queryTime.map((t, j) => [t, result.generatedConcentration[i][j]] as Point);
      const matched: Point[] = schedule.flatMap(([t]) => {
        const j = result.queryTime.reduce((best, v, k) => Math.abs(v - t) < Math.abs(result.queryTime[best] - t) ? k : best, 0);
        return Math.abs(result.queryTime[j] - t) < Math.max(1, Math.abs(t)) * 2e-6 ? [[t, full[j][1]] as Point] : [];
      });
      add(`Generated ${i + 1}`, matched, covariateValue(result.request.targetCovariates?.[i], column), true, group.color);
    });
  });
  return { rows, window: [low, high], excluded };
}
