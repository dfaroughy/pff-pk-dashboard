"use client";

import { useId, useMemo } from "react";
import { observedVpc, quantile } from "../lib/pk";
import type { InferenceResponse } from "../lib/model-api";
import type { Point, Study } from "../lib/types";

const WIDTH = 720;
const HEIGHT = 360;
const MARGIN = { left: 62, right: 22, top: 22, bottom: 48 };

function bounds(series: Point[][], logY: boolean) {
  const points = series.flat().filter(([, y]) => y > 0 && Number.isFinite(y));
  const xValues = points.map(([x]) => x);
  const yValues = points.map(([, y]) => logY ? Math.log10(y) : y);
  const xMax = Math.max(...xValues, 1);
  let yMin = Math.min(...yValues, 0);
  let yMax = Math.max(...yValues, 1);
  if (!logY) yMin = 0;
  if (yMin === yMax) yMax += 1;
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
        <text className="tick" x={MARGIN.left - 10} y={y(raw) + 4} textAnchor="end">{logY ? `10${Math.round(tick) >= 0 ? "⁺" : "⁻"}${Math.abs(Math.round(tick))}` : raw.toPrecision(3)}</text>
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
    <text className="axis-label" x={15} y={HEIGHT / 2} textAnchor="middle" transform={`rotate(-90 15 ${HEIGHT / 2})`}>{yLabel}</text>
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
    { stroke: "var(--blue)", width: 1, markers: true, radius: 2.2 },
    { stroke: "var(--orange)", width: 1, markers: true, radius: 2.2 },
    { stroke: "var(--orange)", width: 1, markers: true, radius: 2.2 },
  ]} logY={logY} xLabel={`Time (${study.timeUnit})`} yLabel={`Concentration (${study.concentrationUnit})`} ariaLabel={`Observed visual predictive check for ${study.drug}`} />;
}

export function ModelTrajectoryChart({ result, study, logY, showEmpirical }: { result: InferenceResponse; study: Study; logY: boolean; showEmpirical: boolean }) {
  const empirical = showEmpirical ? study.subjects.map((subject) => subject.points) : [];
  const generated = result.generatedConcentration.map((values) => result.queryTime.map((time, index) => [time, values[index]] as Point));
  return <Chart
    series={[...empirical, ...generated]}
    styles={[
      ...empirical.map(() => ({ stroke: "var(--trajectory-blue)", width: 1, opacity: 0.38, markers: true, radius: 1.4 })),
      ...generated.map(() => ({ stroke: "var(--generated)", width: 1, opacity: 0.48 })),
    ]}
    logY={logY}
    xLabel={`Time (${result.units.time})`}
    yLabel={`Concentration (${result.units.concentration})`}
    ariaLabel="PFF generated individual concentration profiles"
  />;
}

function bootstrapBand(values: number[], probability: number, seed: number) {
  let state = seed || 1;
  const random = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const estimates = Array.from({ length: 200 }, () => quantile(
    Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)]),
    probability,
  ));
  return { lower: quantile(estimates, 0.05), center: quantile(values, probability), upper: quantile(estimates, 0.95) };
}

export function ModelVpcChart({ result, study, logY, showEmpirical }: { result: InferenceResponse; study: Study; logY: boolean; showEmpirical: boolean }) {
  const model = result.queryTime.map((time, index) => {
    const values = result.generatedConcentration.map((sample) => sample[index]).filter(Number.isFinite);
    return { time, low: bootstrapBand(values, 0.05, 11_003 + index), median: bootstrapBand(values, 0.5, 23_009 + index), high: bootstrapBand(values, 0.95, 37_019 + index) };
  });
  const point = (key: "low" | "median" | "high", bound: "lower" | "center" | "upper") => model.map((entry) => [entry.time, entry[key][bound]] as Point);
  const empiricalVpc = showEmpirical ? observedVpc(study).filter((entry) => entry.n >= 2) : [];
  const empiricalSeries = empiricalVpc.length ? [
    empiricalVpc.map((entry) => [entry.time, entry.q05] as Point),
    empiricalVpc.map((entry) => [entry.time, entry.q50] as Point),
    empiricalVpc.map((entry) => [entry.time, entry.q95] as Point),
  ] : [];
  return <Chart
    series={empiricalSeries}
    styles={empiricalSeries.map((_, index) => ({ stroke: index === 1 ? "var(--orange)" : "var(--blue)", width: 1, markers: true, radius: 2.1 }))}
    bands={[
      { lower: point("low", "lower"), upper: point("low", "upper"), fill: "var(--blue-band-fill)" },
      { lower: point("median", "lower"), upper: point("median", "upper"), fill: "var(--orange-band-fill)" },
      { lower: point("high", "lower"), upper: point("high", "upper"), fill: "var(--blue-band-fill)" },
    ]}
    logY={logY}
    xLabel={`Time (${result.units.time})`}
    yLabel={`Concentration (${result.units.concentration})`}
    ariaLabel="PFF generated visual predictive check with bootstrap percentile intervals"
  />;
}
