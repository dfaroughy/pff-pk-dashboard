"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { generatedObservationCurves } from "../lib/generated-observations";
import { concentrationLabel } from "../lib/chart-labels";
import { observedVpc, pkEstimatesFromPoints, quantile } from "../lib/pk";
import { syntheticRequest, type InferenceResponse } from "../lib/model-api";
import type { BlqPoint, Point, Study, VpcPoint } from "../lib/types";

const WIDTH = 720;
const HEIGHT = 480;
const MARGIN = { left: 124, right: 52, top: 44, bottom: 76 };

export function wrapAxisLabel(label: string, limit: number): string[] {
  const lines: string[] = [];
  for (const word of label.split(/\s+/)) {
    for (let offset = 0; offset < word.length; offset += limit) {
      const part = word.slice(offset, offset + limit);
      const last = lines.length - 1;
      if (last >= 0 && lines[last].length + part.length + 1 <= limit) lines[last] += ` ${part}`;
      else lines.push(part);
    }
  }
  return lines;
}

function bounds(series: Point[][], logY: boolean, fraction = false) {
  const points = series.flat().filter(([, y]) => (fraction ? y >= 0 : y > 0) && Number.isFinite(y));
  const xMax = Math.max(1, ...series.flat().map(([x]) => x).filter(Number.isFinite));
  if (!points.length) return { xMin: 0, xMax, yMin: logY ? -1 : 0, yMax: 1 };
  const yValues = points.map(([, y]) => logY ? Math.log10(y) : y);
  let yMin = logY ? Math.min(...yValues) : 0;
  let yMax = Math.max(...yValues);
  if (logY) {
    if (yMin === yMax) { yMin -= 0.5; yMax += 0.5; }
    else {
      const padding = 0.06 * (yMax - yMin);
      yMin -= padding;
      yMax += padding;
    }
  } else {
    yMax = Math.max(yMax * 1.06, 1e-12);
  }
  return { xMin: 0, xMax, yMin, yMax };
}

function ticks(min: number, max: number, count = 5) {
  return Array.from({ length: count }, (_, index) => min + (max - min) * index / (count - 1));
}

type LineStyle = { stroke: string; width?: number; opacity?: number; markers?: boolean; radius?: number; dash?: string };

export function Chart({ series, styles, logY, xLabel, yLabel, ariaLabel, bands = [], errorBars = [], assay, flagged = [], fraction = false }: {
  series: Point[][]; styles: LineStyle[]; logY: boolean; xLabel: string; yLabel: string; ariaLabel: string;
  bands?: { lower: Point[]; upper: Point[]; fill: string }[];
  errorBars?: { point: Point; lower: number; upper: number; stroke: string; dash?: string }[];
  assay?: Study["assay"];
  flagged?: { point: Point; cens: 1 | null }[];
  fraction?: boolean;
}) {
  const clipId = useId().replaceAll(":", "");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [width, setWidth] = useState(WIDTH);
  useEffect(() => {
    if (!svgRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(Math.min(WIDTH, Math.max(280, Math.round(entry.contentRect.width))));
    });
    observer.observe(svgRef.current);
    return () => observer.disconnect();
  }, []);
  const domain = bounds([...series, ...bands.flatMap((band) => [band.lower, band.upper]), errorBars.flatMap(b => [[b.point[0], b.lower], [b.point[0], b.upper]] as Point[]), ...(assay ? [[[0, assay.lloq] as Point]] : [])], logY, fraction);
  if (fraction) { domain.yMin = 0; domain.yMax = 1; }
  const yTicks = ticks(domain.yMin, domain.yMax);
  const tickText = (tick: number) => fraction ? `${Math.round(tick * 100)}%` : logY ? (10 ** tick).toExponential(1).replace("e+", "e") : tick.toPrecision(3);
  const left = Math.max(64, ...yTicks.map(t => tickText(t).length * 12 + 16));
  const titleLines = wrapAxisLabel(yLabel, Math.max(10, Math.floor((width - left - MARGIN.right) / 12)));
  const marginTop = Math.max(MARGIN.top, titleLines.length * 24 + 16);
  const height = fraction ? marginTop + 120 + MARGIN.bottom : Math.max(420, width * HEIGHT / WIDTH, marginTop + 220 + MARGIN.bottom);
  const x = (value: number) => left + (value - domain.xMin) / (domain.xMax - domain.xMin) * (width - left - MARGIN.right);
  const y = (value: number) => {
    const transformed = logY ? Math.log10(Math.max(value, 1e-30)) : value;
    return height - MARGIN.bottom - (transformed - domain.yMin) / (domain.yMax - domain.yMin) * (height - marginTop - MARGIN.bottom);
  };
  const valid = ([time, value]: Point) => Number.isFinite(time) && Number.isFinite(value) && (logY ? value > 0 : value >= 0);
  const path = (points: Point[]) => {
    let connected = false;
    return points.map(point => {
      if (!valid(point)) { connected = false; return ""; }
      const command = `${connected ? "L" : "M"}${x(point[0]).toFixed(2)},${y(point[1]).toFixed(2)}`;
      connected = true;
      return command;
    }).join(" ");
  };
  const bandPath = (lower: Point[], upper: Point[]) => {
    const segments: string[] = [];
    let start = 0;
    for (let i = 0; i <= lower.length; i++) {
      if (i < lower.length && valid(lower[i]) && upper[i] && valid(upper[i])) continue;
      if (i > start) segments.push(`${path(lower.slice(start, i))} ${upper.slice(start, i).reverse().map(([t, v]) => `L${x(t).toFixed(2)},${y(v).toFixed(2)}`).join(" ")} Z`);
      start = i + 1;
    }
    return segments.join(" ");
  };
  return <svg ref={svgRef} className={fraction ? "chart blq-chart" : "chart"} style={fraction ? { aspectRatio: `${width} / ${height}` } : undefined} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
    <defs><clipPath id={clipId}><rect x={left} y={marginTop} width={width - left - MARGIN.right} height={height - marginTop - MARGIN.bottom} /></clipPath></defs>
    {ticks(domain.xMin, domain.xMax, Math.min(5, Math.max(2, Math.floor((width - left - MARGIN.right) / 100) + 1))).map((tick) => <g key={`x-${tick}`}>
      <line className="gridline" x1={x(tick)} x2={x(tick)} y1={marginTop} y2={height - MARGIN.bottom} />
      <text className="tick" x={x(tick)} y={height - 42} textAnchor="middle">{tick.toPrecision(3).replace(/\.00$/, "")}</text>
    </g>)}
    {yTicks.map((tick) => {
      const raw = logY ? 10 ** tick : tick;
      return <g key={`y-${tick}`}>
        <line className="gridline" x1={left} x2={width - MARGIN.right} y1={y(raw)} y2={y(raw)} />
        <text className="tick" x={left - 10} y={y(raw) + 4} textAnchor="end">{tickText(tick)}</text>
      </g>;
    })}
    <g clipPath={`url(#${clipId})`}>
      {bands.map((band, index) => <path key={`band-${index}`} d={bandPath(band.lower, band.upper)} fill={band.fill} />)}
      {errorBars.filter(b => valid(b.point) && Number.isFinite(b.lower) && Number.isFinite(b.upper)).map((b, i) => {
        const bottom = logY ? 10 ** domain.yMin : 0;
        const lo = y(Math.max(bottom, b.lower)), hi = y(Math.max(bottom, b.upper)), cx = x(b.point[0]);
        return <g key={`error-${i}`} aria-label="Mean plus or minus one standard deviation" stroke={b.stroke} strokeWidth="1.2" strokeDasharray={b.dash} opacity=".7">
          <line x1={cx} x2={cx} y1={lo} y2={hi} />
          {b.lower >= bottom && <line x1={cx - 4} x2={cx + 4} y1={lo} y2={lo} />}
          <line x1={cx - 4} x2={cx + 4} y1={hi} y2={hi} />
        </g>;
      })}
      {assay && <line x1={left} x2={width - MARGIN.right} y1={y(assay.lloq)} y2={y(assay.lloq)} stroke="var(--assay-amber)" strokeWidth="1.2" strokeDasharray="6 4" />}
      {series.map((points, index) => {
        const style = styles[index] ?? styles[0];
        return <g key={`line-${index}`} opacity={style.opacity ?? 1}>
          <path d={path(points)} fill="none" stroke={style.stroke} strokeWidth={style.width ?? 1} strokeDasharray={style.dash} />
          {style.markers && points.filter(valid).map(([time, value], pointIndex) => <circle key={pointIndex} cx={x(time)} cy={y(value)} r={style.radius ?? 2} fill={style.stroke} />)}
        </g>;
      })}
    </g>
    {assay && <g className="assay-overlay">
      <text x={width - MARGIN.right - 4} y={Math.max(marginTop + 12, y(assay.lloq) - 6)} textAnchor="end" fill="var(--assay-amber)" fontSize="16.8">LLOQ {assay.lloq.toPrecision(3)}</text>
    </g>}
    <g clipPath={`url(#${clipId})`}>{flagged.map(({ point: [t, c], cens }, i) => <g key={i}>
      {cens === 1
        ? <path aria-label="Censored observation" d={`M${x(t)-4},${y(c)-4} L${x(t)+4},${y(c)-4} L${x(t)},${y(c)+3} Z`} fill="var(--assay-amber)" />
        : <circle aria-label="Unresolved censoring" cx={x(t)} cy={y(c)} r="4" fill="none" stroke="var(--assay-amber)" strokeWidth="1.5" />}
    </g>)}</g>
    <line className="axis" x1={left} x2={width - MARGIN.right} y1={height - MARGIN.bottom} y2={height - MARGIN.bottom} />
    <line className="axis" x1={left} x2={left} y1={marginTop} y2={height - MARGIN.bottom} />
    <text className="axis-label" x={(left + width - MARGIN.right) / 2} y={height - 10} textAnchor="middle">{xLabel}</text>
    <text className="axis-label plot-y-title" x={left} y={24} textAnchor="start">{titleLines.map((line, index) => <tspan key={index} x={left} dy={index ? 24 : 0}>{line}</tspan>)}</text>
  </svg>;
}

function censoringMarkers(study: Study) {
  return study.subjects.flatMap((s) => s.points.flatMap((point, i) => s.cens?.[i] === 1 || s.cens?.[i] === null ? [{ point, cens: s.cens[i] as 1 | null }] : []));
}

export function TrajectoryChart({ study, logY, showLatent = false }: { study: Study; logY: boolean; showLatent?: boolean }) {
  const series = useMemo(() => {
    if (study.subjects.length) return study.subjects.map((subject) => subject.points);
    return [study.summary.map((point) => [point.time, point.mean] as Point)];
  }, [study]);
  const latent = showLatent ? study.subjects.flatMap((s) => s.latentPoints ? [s.latentPoints] : []) : [];
  const flagged = censoringMarkers(study);
  return <Chart assay={study.assay} flagged={flagged} series={[...latent, ...series]} styles={[...latent.map(() => ({ stroke: "var(--trajectory-blue)", opacity: 0.35, dash: "4 3" })), ...series.map(() => ({ stroke: "var(--trajectory-blue)", width: 1, opacity: study.subjects.length ? 0.72 : 1, markers: true, radius: 1.9 }))]} logY={logY} xLabel={`Time (${study.timeUnit})`} yLabel={concentrationLabel(study.concentrationUnit)} ariaLabel={`Concentration trajectories for ${study.drug}`} />;
}

export function VpcChart({ study, logY, numBins, onBins }: { study: Study; logY: boolean; numBins?: number; onBins?: (bins: number) => void }) {
  const [binned, setBinned] = useState<{ study: Study; numBins?: number; points: VpcPoint[] } | null>(null);
  const firstTimes = study.subjects[0]?.points.map(([t]) => t) ?? [];
  const irregular = study.subjects.some((s) => s.points.length !== firstTimes.length || s.points.some(([t], i) => t !== firstTimes[i]));
  useEffect(() => {
    if (!study.subjects.length || (!irregular && numBins === undefined)) return;
    const abort = new AbortController();
    void syntheticRequest<{ points: VpcPoint[]; effectiveBins: number; censoring?: unknown }>({ action: "vpc", study, ...(numBins === undefined ? {} : { numBins }) }, abort.signal)
      .then((result) => { if (!abort.signal.aborted) {
        if (study.assay && !result.censoring) return;
        setBinned({ study, numBins, points: result.points });
        onBins?.(result.effectiveBins);
      } })
      .catch(() => { /* Keep unavailable statistics empty instead of showing an unbinned VPC. */ });
    return () => abort.abort();
  }, [study, irregular, numBins, onBins]);
  if (!study.subjects.length) {
    const mean = study.summary.map((point) => [point.time, point.mean] as Point);
    const lower = study.summary.map((point) => [point.time, Math.max(point.mean - (point.sd ?? 0), 1e-30)] as Point);
    const upper = study.summary.map((point) => [point.time, point.mean + (point.sd ?? 0)] as Point);
    return <Chart series={[mean]} styles={[{ stroke: "var(--magenta)", width: 1, markers: true, radius: 2.2 }]} bands={[{ lower, upper, fill: "var(--blue-summary-fill)" }]} logY={logY} xLabel={`Time (${study.timeUnit})`} yLabel={concentrationLabel(study.concentrationUnit)} ariaLabel={`Published concentration summary for ${study.drug}`} />;
  }
  const vpc = irregular || numBins !== undefined ? (binned?.study === study && binned.numBins === numBins ? binned.points : []) : observedVpc(study);
  const q05 = vpc.map((point) => [point.time, point.q05 ?? NaN] as Point);
  const q50 = vpc.map((point) => [point.time, point.q50 ?? NaN] as Point);
  const q95 = vpc.map((point) => [point.time, point.q95 ?? NaN] as Point);
  return <><Chart assay={study.assay} series={[q50, q05, q95]} styles={[
    { stroke: "var(--magenta)", width: 1, markers: true, radius: 2.2 },
    { stroke: "var(--cyan)", width: 1, markers: true, radius: 2.2 },
    { stroke: "var(--cyan)", width: 1, markers: true, radius: 2.2 },
  ]} logY={logY} xLabel={`Time (${study.timeUnit})`} yLabel={concentrationLabel(study.concentrationUnit)} ariaLabel={`Observed visual predictive check for ${study.drug}`} /><BlqChart points={vpc} timeUnit={study.timeUnit} /></>;
}

export function ModelTrajectoryChart({ result, study, logY, showEmpirical }: { result: InferenceResponse; study: Study; logY: boolean; showEmpirical: boolean }) {
  const empirical = showEmpirical ? study.subjects.map((subject) => subject.points) : [];
  const generated = generatedObservationCurves(result, study);
  return <Chart
    assay={study.assay}
    flagged={showEmpirical ? censoringMarkers(study) : []}
    series={[...empirical, ...generated]}
    styles={[
      ...empirical.map(() => ({ stroke: "var(--trajectory-blue)", width: 1, opacity: 0.38, markers: true, radius: 1.4 })),
      ...generated.map(() => ({ stroke: "var(--generated)", width: 1, opacity: 0.48, markers: true, radius: 1.25 })),
    ]}
    logY={logY}
    xLabel={`Time (${result.units.time})`}
    yLabel={concentrationLabel(result.units.concentration)}
    ariaLabel="Pythia-PK generated individual concentration profiles"
  />;
}

export function ModelVpcChart({ result, study, logY, showEmpirical }: { result: InferenceResponse; study: Study; logY: boolean; showEmpirical: boolean }) {
  const model = result.vpc.points;
  const observed = result.vpc.method === "mesh_bootstrap" || result.vpc.methodVersion === "pharmpy-binned-bootstrap-v1"
    ? model.map((entry) => ({ time: entry.time, n: entry.nObservations, ...entry.observed }))
    : observedVpc(study);
  const empiricalSeries = showEmpirical ? [
    observed.map((entry) => [entry.time, entry.q05 ?? NaN] as Point),
    observed.map((entry) => [entry.time, entry.q50 ?? NaN] as Point),
    observed.map((entry) => [entry.time, entry.q95 ?? NaN] as Point),
  ] : [];
  const contour = (key: "q05" | "q50" | "q95", bound: "lower" | "upper") =>
    model.map((entry) => [entry.time, entry.simulated[key][bound] ?? NaN] as Point);
  return <><Chart
    assay={study.assay}
    series={empiricalSeries}
    styles={empiricalSeries.map((_, index) => ({ stroke: index === 1 ? "var(--magenta)" : "var(--cyan)", width: 1, markers: true, radius: 2.1 }))}
    bands={[
      { lower: contour("q05", "lower"), upper: contour("q05", "upper"), fill: "var(--generated-band-fill)" },
      { lower: contour("q50", "lower"), upper: contour("q50", "upper"), fill: "var(--generated-median-band-fill)" },
      { lower: contour("q95", "lower"), upper: contour("q95", "upper"), fill: "var(--generated-band-fill)" },
    ]}
    logY={logY}
    xLabel={`Time (${result.units.time})`}
    yLabel={concentrationLabel(result.units.concentration)}
    ariaLabel="Pythia-PK visual predictive check"
  /><BlqChart points={model} timeUnit={study.timeUnit} /></>;
}

function BlqChart({ points, timeUnit }: { points: { time: number; blq?: BlqPoint }[]; timeUnit: string }) {
  if (!points.some(p => p.blq)) return null;
  const observed = (key: "lower" | "upper") => points.map(p => [p.time, p.blq?.observed[key] ?? NaN] as Point);
  const simulated = (key: "lower" | "upper" | "center") => points.map(p => [p.time, p.blq?.simulated?.[key] ?? NaN] as Point);
  const uncertain = points.some(p => (p.blq?.observed.nUnresolved ?? 0) > 0);
  const generated = points.some(p => p.blq?.simulated);
  return <div className="blq-panel">
    <div className="legend">
      <span className="legend-item"><i className="blue-line" />{uncertain ? "Study range (unresolved flags)" : "Study"}</span>
      {generated && <span className="legend-item"><i className="red-line" />Pythia · 90% interval</span>}
    </div>
    <Chart fraction logY={false} xLabel={`Time (${timeUnit})`} yLabel="Fraction below LLOQ" ariaLabel="Fraction of observations below the quantification limit"
      series={[observed("lower"), ...(uncertain ? [observed("upper")] : []), ...(generated ? [simulated("center")] : [])]}
      styles={[{ stroke: "var(--cyan)", markers: true }, ...(uncertain ? [{ stroke: "var(--cyan)", markers: true, dash: "4 3" }] : []), ...(generated ? [{ stroke: "var(--magenta)", markers: true }] : [])]}
      bands={[...(uncertain ? [{ lower: observed("lower"), upper: observed("upper"), fill: "var(--blue-summary-fill)" }] : []), ...(generated ? [{ lower: simulated("lower"), upper: simulated("upper"), fill: "var(--generated-median-band-fill)" }] : [])]} />
  </div>;
}

const DISTRIBUTION_TOP = 70;
const DISTRIBUTION_BOTTOM = 240;

function compactNumber(value: number) {
  const magnitude = Math.abs(value);
  if ((magnitude >= 1e4 || (magnitude > 0 && magnitude < 1e-2))) return value.toExponential(1).replace("e+", "e");
  return value.toLocaleString(undefined, { maximumSignificantDigits: 3 });
}

function MetricSymbol({ symbol }: { symbol: string }) {
  const split = symbol === "Cmax" ? ["C", "max"]
    : symbol === "Tmax" ? ["T", "max"]
      : symbol === "AUClast" ? ["AUC", "last"]
        : symbol === "λz" ? ["λ", "z"]
          : symbol === "t½" ? ["t", "1/2"]
            : null;
  if (!split) return <>{symbol}</>;
  return <>{split[0]}<tspan baselineShift="sub" fontSize="65%">{split[1]}</tspan></>;
}

function DistributionGlyph({ values, center, color, y }: {
  values: number[]; center: number; color: string; y: (value: number) => number;
}) {
  if (!values.length) return null;
  const q05 = quantile(values, 0.05);
  const q25 = quantile(values, 0.25);
  const q50 = quantile(values, 0.5);
  const q75 = quantile(values, 0.75);
  const q95 = quantile(values, 0.95);
  return <g>
    <line x1={center} x2={center} y1={y(q05)} y2={y(q95)} stroke={color} strokeWidth="1" />
    <line x1={center - 4} x2={center + 4} y1={y(q05)} y2={y(q05)} stroke={color} strokeWidth="1" />
    <line x1={center - 4} x2={center + 4} y1={y(q95)} y2={y(q95)} stroke={color} strokeWidth="1" />
    <rect x={center - 9} y={y(q75)} width="18" height={Math.max(y(q25) - y(q75), 1)} fill={color} fillOpacity="0.42" stroke={color} strokeWidth="1.2" />
    <line x1={center - 9} x2={center + 9} y1={y(q50)} y2={y(q50)} stroke={color} strokeWidth="1.8" />
  </g>;
}

export function PkDistributionChart({ study, result }: { study: Study; result: InferenceResponse | null }) {
  const metrics = useMemo(() => {
    const observedDose = study.doseEvents?.length
      ? study.doseEvents.reduce((sum, event) => sum + event.amount, 0)
      : study.dose;
    const generatedDose = result?.request.doseEvents.reduce((sum, event) => sum + event.amount, 0) ?? null;
    const observed = study.subjects.map((subject) => pkEstimatesFromPoints(
      subject.points,
      study.concentrationUnit,
      study.timeUnit,
      observedDose,
      study.doseUnit,
    ));
    const generated = result ? generatedObservationCurves(result, study).map((points) => pkEstimatesFromPoints(
      points,
      result.units.concentration,
      result.units.time,
      generatedDose,
      result.request.doseEvents[0]?.unit ?? study.doseUnit,
    )) : [];
    const template = observed[0] ?? generated[0] ?? [];
    return template.map((metric, metricIndex) => ({
      ...metric,
      observed: observed.map((profile) => profile[metricIndex]?.value).filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
      generated: generated.map((profile) => profile[metricIndex]?.value).filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    }));
  }, [result, study]);


  return <div className="pk-distribution-chart" role="img" aria-label="Distributions of observed and Pythia-PK pharmacokinetic quantities">
    {metrics.map((metric) => {
      const allValues = [...metric.observed, ...metric.generated];
      const whiskerMin = allValues.length ? quantile(allValues, 0.05) : 0;
      const whiskerMax = allValues.length ? quantile(allValues, 0.95) : 1;
      const spread = Math.max(whiskerMax - whiskerMin, Math.abs(whiskerMax) * 0.12, 1e-9);
      const min = Math.max(0, whiskerMin - spread * 0.12);
      const max = whiskerMax + spread * 0.12;
      const y = (value: number) => DISTRIBUTION_BOTTOM - (value - min) / (max - min) * (DISTRIBUTION_BOTTOM - DISTRIBUTION_TOP);
      const scaleTicks = [max, (max + min) / 2, min];
      const midpoint = 194;
      const observedCenter = midpoint - (metric.generated.length ? 34 : 0);
      const generatedCenter = midpoint + 34;
      return <svg key={metric.symbol} viewBox="0 0 280 300" aria-label={metric.label}>
        <title>{metric.label}</title>
        <text className="distribution-symbol" x={140} y={32} textAnchor="middle"><MetricSymbol symbol={metric.symbol} /></text>
        {scaleTicks.map((tick) => <g key={tick}>
          <line className="distribution-grid" x1={midpoint - 43} x2={midpoint + 43} y1={y(tick)} y2={y(tick)} />
          <text className="distribution-value" x={midpoint - 47} y={y(tick) + 3} textAnchor="end">{compactNumber(tick)}</text>
        </g>)}
        <DistributionGlyph values={metric.observed} center={observedCenter} color="var(--cyan)" y={y} />
        <text className="distribution-count" x={observedCenter} y={280} textAnchor="middle">n={metric.observed.length}</text>
        {metric.generated.length > 0 && <>
          <DistributionGlyph values={metric.generated} center={generatedCenter} color="var(--generated)" y={y} />
          <text className="distribution-count" x={generatedCenter} y={280} textAnchor="middle">n={metric.generated.length}</text>
        </>}
      </svg>;
    })}
  </div>;
}
