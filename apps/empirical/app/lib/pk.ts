import type { PkEstimate, Point, Study, VpcPoint } from "./types";

export function quantile(values: number[], probability: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return Number.NaN;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + fraction * ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]);
}

/** Same half-up order-statistic convention as pff_pk.metrics.mesh_vpc. */
export function vpcQuantile(values: number[], probability: number): number {
  if (!values.length) return Number.NaN;
  return [...values].sort((a, b) => a - b)[Math.floor(probability * (values.length - 1) + 0.5)];
}

export function observedVpc(study: { subjects: { points: Point[]; cens?: (0 | 1 | null)[] }[]; assay?: Study["assay"] }): VpcPoint[] {
  const byTime = new Map<number, { value: number; flag: 0 | 1 | null }[]>();
  const lloq = study.assay?.lloq;
  study.subjects.forEach(subject => subject.points.forEach(([time, value], index) => {
    let flag = subject.cens ? subject.cens[index] : lloq !== undefined && value <= lloq ? null : 0;
    if (lloq !== undefined && value < lloq && flag === 0) flag = null;
    byTime.set(time, [...(byTime.get(time) ?? []), { value, flag }]);
  }));
  return [...byTime.entries()].sort(([a], [b]) => a - b).map(([time, records]) => {
    const values = records.map(record => record.value);
    const n = values.length;
    if (lloq === undefined) return { time, q05: vpcQuantile(values, .05), q50: vpcQuantile(values, .5), q95: vpcQuantile(values, .95), n };
    const lower = records.map(({ value, flag }) => flag === 0 ? value : 0);
    const upper = records.map(({ value, flag }) => flag === 0 ? value : flag === 1 ? lloq : Math.max(lloq, value));
    const identified = (p: number) => {
      const lo = vpcQuantile(lower, p), hi = vpcQuantile(upper, p);
      return lo === hi && hi >= lloq ? hi : null;
    };
    const nCensored = records.filter(r => r.flag === 1).length;
    const nUnresolved = records.filter(r => r.flag === null).length;
    return { time, q05: identified(.05), q50: identified(.5), q95: identified(.95), n,
      blq: { observed: { lower: nCensored / n, upper: (nCensored + nUnresolved) / n, nCensored, nUnresolved } } };
  });
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

export function pkEstimatesFromPoints(
  points: Point[],
  concentrationUnit: string,
  timeUnit: string,
  dose: number | null = null,
  doseUnit = "dose",
): PkEstimate[] {
  points = points
    .filter(([time, value]) => Number.isFinite(time) && Number.isFinite(value) && value > 0)
    .sort(([left], [right]) => left - right);
  if (!points.length) return [];
  const peak = points.reduce((best, point, index) => point[1] > points[best][1] ? index : best, 0);
  const lambda = terminalSlope(points);
  const aucLast = auc(points);
  const clearance = dose !== null && dose > 0 && aucLast !== null && aucLast > 0 ? dose / aucLast : null;
  return [
    { label: "Maximum observed concentration", symbol: "Cmax", value: points[peak][1], unit: concentrationUnit },
    { label: "Time of maximum concentration", symbol: "Tmax", value: points[peak][0], unit: timeUnit },
    { label: "Area under curve to last sample", symbol: "AUClast", value: aucLast, unit: `${concentrationUnit}·${timeUnit}` },
    { label: "Terminal elimination rate", symbol: "λz", value: lambda, unit: `${timeUnit}⁻¹` },
    { label: "Terminal half-life", symbol: "t½", value: lambda ? Math.log(2) / lambda : null, unit: timeUnit },
    { label: "Dose divided by AUC to last sample", symbol: "CL", value: clearance, unit: `${doseUnit}/(${concentrationUnit}·${timeUnit})` },
  ];
}
