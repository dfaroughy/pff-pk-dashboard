"use client";

import { useId, useMemo } from "react";
import { observedVpc, pkEstimatesFromPoints, quantile } from "../lib/pk";
import type { InferenceResponse } from "../lib/model-api";
import type { Point, Study } from "../lib/types";

const WIDTH = 720;
const HEIGHT = 445;
const MARGIN = { left: 62, right: 22, top: 30, bottom: 52 };

function bounds(series: Point[][], logY: boolean) {
  const points = series.flat().filter(([, y]) => y > 0 && Number.isFinite(y));
  if (!points.length) return { xMin: 0, xMax: 1, yMin: logY ? -1 : 0, yMax: 1 };
  const xValues = points.map(([x]) => x);
  const yValues = points.map(([, y]) => logY ? Math.log10(y) : y);
  const xMax = Math.max(...xValues, 1);
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

function Chart({ series, styles, logY, xLabel, yLabel, ariaLabel, bands = [] }: {
  series: Point[][]; styles: LineStyle[]; logY: boolean; xLabel: string; yLabel: string; ariaLabel: string;
  bands?: { lower: Point[]; upper: Point[]; fill: string }[];
}) {
  const clipId = useId().replaceAll(":", "");
  const domain = bounds([...series, ...bands.flatMap((band) => [band.lower, band.upper])], logY);
  const x = (value: number) => MARGIN.left + (value - domain.xMin) / (domain.xMax - domain.xMin) * (WIDTH - MARGIN.left - MARGIN.right);
  const y = (value: number) => {
    const transformed = logY ? Math.log10(Math.max(value, 1e-30)) : value;
    return HEIGHT - MARGIN.bottom - (transformed - domain.yMin) / (domain.yMax - domain.yMin) * (HEIGHT - MARGIN.top - MARGIN.bottom);
  };
  const path = (points: Point[]) => points.filter(([, value]) => value > 0).map(([time, value], index) => `${index ? "L" : "M"}${x(time).toFixed(2)},${y(value).toFixed(2)}`).join(" ");
  const bandPath = (lower: Point[], upper: Point[]) => `${path(lower)} ${[...upper].reverse().map(([time, value]) => `L${x(time).toFixed(2)},${y(value).toFixed(2)}`).join(" ")} Z`;
  return <svg className="chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel}>
    <defs><clipPath id={clipId}><rect x={MARGIN.left} y={MARGIN.top} width={WIDTH - MARGIN.left - MARGIN.right} height={HEIGHT - MARGIN.top - MARGIN.bottom} /></clipPath></defs>
    {ticks(domain.xMin, domain.xMax).map((tick) => <g key={`x-${tick}`}>
      <line className="gridline" x1={x(tick)} x2={x(tick)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />
      <text className="tick" x={x(tick)} y={HEIGHT - 23} textAnchor="middle">{tick.toPrecision(3).replace(/\.00$/, "")}</text>
    </g>)}
    {ticks(domain.yMin, domain.yMax).map((tick) => {
      const raw = logY ? 10 ** tick : tick;
      return <g key={`y-${tick}`}>
        <line className="gridline" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(raw)} y2={y(raw)} />
        <text className="tick" x={MARGIN.left - 10} y={y(raw) + 4} textAnchor="end">{logY ? raw.toExponential(1).replace("e+", "e") : raw.toPrecision(3)}</text>
      </g>;
    })}
    <g clipPath={`url(#${clipId})`}>
      {bands.map((band, index) => <path key={`band-${index}`} d={bandPath(band.lower, band.upper)} fill={band.fill} />)}
      {series.map((points, index) => {
        const style = styles[index] ?? styles[0];
        return <g key={`line-${index}`} opacity={style.opacity ?? 1}>
          <path d={path(points)} fill="none" stroke={style.stroke} strokeWidth={style.width ?? 1} strokeDasharray={style.dash} />
          {style.markers && points.filter(([, value]) => value > 0).map(([time, value], pointIndex) => <circle key={pointIndex} cx={x(time)} cy={y(value)} r={style.radius ?? 2} fill={style.stroke} />)}
        </g>;
      })}
    </g>
    <line className="axis" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={HEIGHT - MARGIN.bottom} y2={HEIGHT - MARGIN.bottom} />
    <line className="axis" x1={MARGIN.left} x2={MARGIN.left} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />
    <text className="axis-label" x={(MARGIN.left + WIDTH - MARGIN.right) / 2} y={HEIGHT - 4} textAnchor="middle">{xLabel}</text>
    <text className="axis-label plot-y-title" x={MARGIN.left} y={15} textAnchor="start">{yLabel}</text>
  </svg>;
}

export function TrajectoryChart({ study, logY }: { study: Study; logY: boolean }) {
  const series = useMemo(() => {
    if (study.subjects.length) return study.subjects.map((subject) => subject.points);
    return [study.summary.map((point) => [point.time, point.mean] as Point)];
  }, [study]);
  return <Chart series={series} styles={series.map(() => ({ stroke: "var(--trajectory-blue)", width: 1, opacity: study.subjects.length ? 0.72 : 1, markers: true, radius: 1.9 }))} logY={logY} xLabel={`Time (${study.timeUnit})`} yLabel={`Concentration (${study.concentrationUnit})`} ariaLabel={`Concentration trajectories for ${study.drug}`} />;
}

export function VpcChart({ study, logY }: { study: Study; logY: boolean }) {
  if (!study.subjects.length) {
    const mean = study.summary.map((point) => [point.time, point.mean] as Point);
    const lower = study.summary.map((point) => [point.time, Math.max(point.mean - (point.sd ?? 0), 1e-30)] as Point);
    const upper = study.summary.map((point) => [point.time, point.mean + (point.sd ?? 0)] as Point);
    return <Chart series={[mean]} styles={[{ stroke: "var(--blue)", width: 1, markers: true, radius: 2.2 }]} bands={[{ lower, upper, fill: "var(--blue-summary-fill)" }]} logY={logY} xLabel={`Time (${study.timeUnit})`} yLabel={`Concentration (${study.concentrationUnit})`} ariaLabel={`Published concentration summary for ${study.drug}`} />;
  }
  const vpc = observedVpc(study).filter((point) => point.n >= 2);
  const q05 = vpc.map((point) => [point.time, point.q05] as Point);
  const q50 = vpc.map((point) => [point.time, point.q50] as Point);
  const q95 = vpc.map((point) => [point.time, point.q95] as Point);
  return <Chart series={[q50, q05, q95]} styles={[
    { stroke: "var(--cyan)", width: 1.5, markers: true, radius: 2.2 },
    { stroke: "var(--cyan)", width: 0.75, markers: true, radius: 2.2, dash: "7 5" },
    { stroke: "var(--cyan)", width: 0.75, markers: true, radius: 2.2, dash: "7 5" },
  ]} logY={logY} xLabel={`Time (${study.timeUnit})`} yLabel={`Concentration (${study.concentrationUnit})`} ariaLabel={`Observed visual predictive check for ${study.drug}`} />;
}

export function ModelTrajectoryChart({ result, study, logY, showEmpirical }: { result: InferenceResponse; study: Study; logY: boolean; showEmpirical: boolean }) {
  const empirical = showEmpirical ? study.subjects.map((subject) => subject.points) : [];
  const generated = result.generatedConcentration.map((values) => result.queryTime.map((time, index) => [time, values[index]] as Point));
  return <Chart
    series={[...empirical, ...generated]}
    styles={[
      ...empirical.map(() => ({ stroke: "var(--trajectory-blue)", width: 1, opacity: 0.38, markers: true, radius: 1.4 })),
      ...generated.map(() => ({ stroke: "var(--generated)", width: 1, opacity: 0.48, markers: true, radius: 1.25 })),
    ]}
    logY={logY}
    xLabel={`Time (${result.units.time})`}
    yLabel={`Concentration (${result.units.concentration})`}
    ariaLabel="Pythia-PK generated individual concentration profiles"
  />;
}

export function ModelVpcChart({ result, logY, showEmpirical }: { result: InferenceResponse; logY: boolean; showEmpirical: boolean }) {
  const model = result.vpc.points;
  const point = (key: "q05" | "q50" | "q95", bound: "lower" | "center" | "upper") => model.map((entry) => [entry.time, entry.simulated[key][bound]] as Point);
  const empiricalSeries = showEmpirical ? [
    model.map((entry) => [entry.time, entry.observed.q05] as Point),
    model.map((entry) => [entry.time, entry.observed.q50] as Point),
    model.map((entry) => [entry.time, entry.observed.q95] as Point),
  ] : [];
  const generatedQuantiles = [
    point("q05", "center"),
    point("q50", "center"),
    point("q95", "center"),
  ];
  return <Chart
    series={[...empiricalSeries, ...generatedQuantiles]}
    styles={[
      ...empiricalSeries.map((_, index) => ({ stroke: "var(--cyan)", width: index === 1 ? 1.5 : 0.75, markers: true, radius: 2.1, dash: index === 1 ? undefined : "7 5" })),
      ...generatedQuantiles.map((_, index) => ({
        stroke: "var(--vpc-generated-line)",
        width: 0.4,
        markers: true,
        radius: 1.35,
        dash: index === 1 ? undefined : "7 5",
      })),
    ]}
    bands={[
      { lower: point("q05", "lower"), upper: point("q05", "upper"), fill: "var(--generated-band-fill)" },
      { lower: point("q50", "lower"), upper: point("q50", "upper"), fill: "var(--generated-median-band-fill)" },
      { lower: point("q95", "lower"), upper: point("q95", "upper"), fill: "var(--generated-band-fill)" },
    ]}
    logY={logY}
    xLabel={`Time (${result.units.time})`}
    yLabel={`Concentration (${result.units.concentration})`}
    ariaLabel="Pythia-PK visual predictive check computed with Pharmpy"
  />;
}

const DISTRIBUTION_COLUMNS = 3;
const DISTRIBUTION_WIDTH = 720;
const DISTRIBUTION_ROW_HEIGHT = 250;
const DISTRIBUTION_HEIGHT = DISTRIBUTION_ROW_HEIGHT * 2;
const DISTRIBUTION_TOP = 52;
const DISTRIBUTION_BOTTOM = 210;

function compactNumber(value: number) {
  const magnitude = Math.abs(value);
  if ((magnitude >= 1e4 || (magnitude > 0 && magnitude < 1e-2))) return value.toExponential(1).replace("e+", "e");
  return value.toLocaleString(undefined, { maximumSignificantDigits: 3 });
}

function MetricSymbol({ symbol }: { symbol: string }) {
  const split = symbol === "Cmax" ? ["C", "max"]
    : symbol === "Tmax" ? ["T", "max"]
      : symbol === "AUClast" ? ["AUC", "last"]
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
    const observed = study.subjects.map((subject) => pkEstimatesFromPoints(subject.points, study.concentrationUnit, study.timeUnit));
    const generated = result?.generatedConcentration.map((values) => pkEstimatesFromPoints(
      result.queryTime.map((time, index) => [time, values[index]] as Point),
      result.units.concentration,
      result.units.time,
    )) ?? [];
    const template = observed[0] ?? generated[0] ?? [];
    return template.map((metric, metricIndex) => ({
      ...metric,
      observed: observed.map((profile) => profile[metricIndex]?.value).filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
      generated: generated.map((profile) => profile[metricIndex]?.value).filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    }));
  }, [result, study]);
  const panelWidth = DISTRIBUTION_WIDTH / DISTRIBUTION_COLUMNS;

  return <svg className="pk-distribution-chart" viewBox={`0 0 ${DISTRIBUTION_WIDTH} ${DISTRIBUTION_HEIGHT}`} role="img" aria-label="Distributions of observed and Pythia-PK pharmacokinetic quantities">
    <title>Observed and Pythia-PK distributions of descriptive pharmacokinetic quantities</title>
    <line className="distribution-separator" x1="0" x2={DISTRIBUTION_WIDTH} y1={DISTRIBUTION_ROW_HEIGHT} y2={DISTRIBUTION_ROW_HEIGHT} />
    {metrics.map((metric, index) => {
      const allValues = [...metric.observed, ...metric.generated];
      const whiskerMin = allValues.length ? quantile(allValues, 0.05) : 0;
      const whiskerMax = allValues.length ? quantile(allValues, 0.95) : 1;
      const spread = Math.max(whiskerMax - whiskerMin, Math.abs(whiskerMax) * 0.12, 1e-9);
      const min = Math.max(0, whiskerMin - spread * 0.12);
      const max = whiskerMax + spread * 0.12;
      const row = Math.floor(index / DISTRIBUTION_COLUMNS);
      const column = index % DISTRIBUTION_COLUMNS;
      const rowOffset = row * DISTRIBUTION_ROW_HEIGHT;
      const y = (value: number) => rowOffset + DISTRIBUTION_BOTTOM - (value - min) / (max - min) * (DISTRIBUTION_BOTTOM - DISTRIBUTION_TOP);
      const scaleTicks = [max, (max + min) / 2, min];
      const midpoint = panelWidth * (column + 0.5);
      const observedCenter = midpoint - (metric.generated.length ? 18 : 0);
      const generatedCenter = midpoint + 18;
      return <g key={metric.symbol}>
        <title>{metric.label}</title>
        {column > 0 && <line className="distribution-separator" x1={panelWidth * column} x2={panelWidth * column} y1={rowOffset + 8} y2={rowOffset + DISTRIBUTION_ROW_HEIGHT - 8} />}
        <text className="distribution-symbol" x={midpoint} y={rowOffset + 18} textAnchor="middle"><MetricSymbol symbol={metric.symbol} /></text>
        <text className="distribution-unit" x={midpoint} y={rowOffset + 34} textAnchor="middle">{metric.unit}</text>
        {scaleTicks.map((tick) => <g key={tick}>
          <line className="distribution-grid" x1={midpoint - 43} x2={midpoint + 43} y1={y(tick)} y2={y(tick)} />
          <text className="distribution-value" x={midpoint - 47} y={y(tick) + 3} textAnchor="end">{compactNumber(tick)}</text>
        </g>)}
        <DistributionGlyph values={metric.observed} center={observedCenter} color="var(--cyan)" y={y} />
        <text className="distribution-count" x={observedCenter} y={rowOffset + 232} textAnchor="middle">n={metric.observed.length}</text>
        {metric.generated.length > 0 && <>
          <DistributionGlyph values={metric.generated} center={generatedCenter} color="var(--generated)" y={y} />
          <text className="distribution-count" x={generatedCenter} y={rowOffset + 232} textAnchor="middle">n={metric.generated.length}</text>
        </>}
      </g>;
    })}
  </svg>;
}
