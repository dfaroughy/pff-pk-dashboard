import type { PkEstimate, Point, VpcPoint } from "./types";

export function quantile(values: number[], probability: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return Number.NaN;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + fraction * ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]);
}

export function observedVpc(study: { subjects: { points: Point[] }[] }): VpcPoint[] {
  const byTime = new Map<number, number[]>();
  study.subjects.forEach((subject) => subject.points.forEach(([time, value]) => {
    byTime.set(time, [...(byTime.get(time) ?? []), value]);
  }));
  return [...byTime.entries()].sort(([a], [b]) => a - b).map(([time, values]) => ({
    time, q05: quantile(values, 0.05), q50: quantile(values, 0.5), q95: quantile(values, 0.95), n: values.length,
  }));
}

function auc(points: Point[]): number | null {
  if (points.length < 2) return null;
  return points.slice(1).reduce((total, [time, value], index) => {
    const [previousTime, previousValue] = points[index];
    return total + 0.5 * (value + previousValue) * (time - previousTime);
  }, 0);
}

function terminalSlope(points: Point[]): number | null {
  const peak = points.reduce((best, point, index) => point[1] > points[best][1] ? index : best, 0);
  const tail = points.slice(Math.max(peak, points.length - 4)).filter((point) => point[1] > 0);
  if (tail.length < 3) return null;
  const xMean = tail.reduce((sum, point) => sum + point[0], 0) / tail.length;
  const logs = tail.map((point) => Math.log(point[1]));
  const yMean = logs.reduce((sum, value) => sum + value, 0) / logs.length;
  const denominator = tail.reduce((sum, point) => sum + (point[0] - xMean) ** 2, 0);
  if (!denominator) return null;
  const slope = tail.reduce((sum, point, index) => sum + (point[0] - xMean) * (logs[index] - yMean), 0) / denominator;
  return slope < 0 ? -slope : null;
}

export function pkEstimatesFromPoints(points: Point[], concentrationUnit: string, timeUnit: string): PkEstimate[] {
  points = points
    .filter(([time, value]) => Number.isFinite(time) && Number.isFinite(value) && value > 0)
    .sort(([left], [right]) => left - right);
  if (!points.length) return [];
  const peak = points.reduce((best, point, index) => point[1] > points[best][1] ? index : best, 0);
  const lambda = terminalSlope(points);
  return [
    { label: "Maximum observed concentration", symbol: "Cmax", value: points[peak][1], unit: concentrationUnit },
    { label: "Time of maximum concentration", symbol: "Tmax", value: points[peak][0], unit: timeUnit },
    { label: "Area under curve to last sample", symbol: "AUClast", value: auc(points), unit: `${concentrationUnit}·${timeUnit}` },
    { label: "Terminal elimination rate", symbol: "λz", value: lambda, unit: `${timeUnit}⁻¹` },
    { label: "Terminal half-life", symbol: "t½", value: lambda ? Math.log(2) / lambda : null, unit: timeUnit },
  ];
}
