import { useMemo, useState } from "react";
import { type InferenceResponse } from "../lib/model-api";
import { covariateGroups, covariatePk, covariateMoments, type CovariateGroup, type PkRow } from "../lib/covariate-analysis";
import { quantile } from "../lib/pk";
import { concentrationLabel } from "../lib/chart-labels";
import type { Point, Study } from "../lib/types";
import { targetColumns } from "./TargetCovariateTable";
import { Chart } from "./StudyCharts";
import { PlotScaleToggle } from "./PlotScaleToggle";

function GroupVpc({ study, result, groups, logY }: { study: Study; result: InferenceResponse | null; groups: CovariateGroup[]; logY: boolean }) {
  const summaries = groups.flatMap(group => {
    const summary = covariateMoments(study, result, group);
    return [
      { points: summary.observed, stroke: group.color, dash: undefined },
      { points: summary.generated, stroke: group.color, dash: "5 4" },
    ];
  });
  return <Chart logY={logY} assay={study.assay} xLabel={`Time (${study.timeUnit})`} yLabel={concentrationLabel(study.concentrationUnit)}
    ariaLabel="Covariate-group VPC: mean and standard deviation at observation times"
    series={summaries.map(s => s.points.map(p => [p.time, p.mean] as Point))}
    styles={summaries.map(s => ({ stroke: s.stroke, dash: s.dash, width: 1.5, markers: true, radius: 2.5 }))}
    errorBars={summaries.flatMap(s => s.points.flatMap(p => p.sd === null ? [] : [{
      point: [p.time, p.mean] as Point, lower: p.mean - p.sd, upper: p.mean + p.sd, stroke: s.stroke, dash: s.dash,
    }]))} />;
}

function PkScatter({ rows, categorical, xLabel, yLabel }: { rows: PkRow[]; categorical: boolean; xLabel: string; yLabel: string }) {
  if (!rows.length) return <p className="plot-caption">No comparable, fully quantified profiles in a shared observation window.</p>;
  const labels = categorical ? [...new Set(rows.map(r => String(r.x)))].sort() : [];
  const xs = rows.map(r => categorical ? labels.indexOf(String(r.x)) : Number(r.x));
  const low = Math.min(...xs), high = Math.max(...xs), span = high - low || 1;
  const x = (v: number) => 100 + (v - low + span * .1) / (span * 1.2) * 530;
  const ymax = Math.max(...rows.map(r => r.value), 1e-12) * 1.1;
  const y = (v: number) => 335 - v / ymax * 265;
  return <svg className="pk-chart" viewBox="0 0 720 430" role="img" aria-label="Covariate versus observed-window PK quantity">
    <text x="80" y="28" fill="currentColor" fontSize="16">{yLabel}</text>
    {Array.from({ length: 5 }, (_, i) => <g key={i}><line x1="80" x2="660" y1={y(ymax * i / 4)} y2={y(ymax * i / 4)} stroke="currentColor" opacity=".15" />
      <text x="72" y={y(ymax * i / 4) + 5} textAnchor="end" fill="currentColor" fontSize="14">{(ymax * i / 4).toPrecision(3)}</text></g>)}
    {(categorical ? labels.map((label, i) => ({ value: i, label })) : Array.from({ length: 5 }, (_, i) => ({ value: low + (high - low) * i / 4, label: (low + (high - low) * i / 4).toPrecision(3) }))).map((tick, i) =>
      <text key={i} x={x(tick.value)} y="367" textAnchor="middle" fill="currentColor" fontSize="14">{tick.label}</text>)}
    {categorical && labels.flatMap((label, index) => [false, true].map(generated => {
      const group = rows.filter(r => String(r.x) === label && r.generated === generated);
      if (group.length < 2) return null;
      const values = group.map(r => r.value), cx = x(index) + (generated ? 10 : -10);
      return <g key={`${label}-${generated}`} stroke={group[0].color} strokeWidth="3" strokeDasharray={generated ? "4 3" : undefined}>
        <line x1={cx} x2={cx} y1={y(quantile(values, .05))} y2={y(quantile(values, .95))} />
        <line x1={cx - 6} x2={cx + 6} y1={y(quantile(values, .5))} y2={y(quantile(values, .5))} /></g>;
    }))}
    {rows.map((row, i) => <circle key={`${row.generated}-${row.id}`} cx={x(xs[i]) + (categorical ? (row.generated ? 10 : -10) + (i % 5 - 2) * 2 : 0)} cy={y(row.value)} r="4"
      fill={row.generated ? "none" : row.color} stroke={row.color} strokeWidth="1.8"><title>{row.id}: {row.x}, {row.value.toPrecision(4)}</title></circle>)}
    <text x="365" y="413" textAnchor="middle" fill="currentColor" fontSize="16">{xLabel}</text>
  </svg>;
}

function AnalysisContent({ study, result }: { study: Study; result: InferenceResponse | null }) {
  const columns = useMemo(() => targetColumns(study), [study]);
  const [key, setKey] = useState(columns[0].key);
  const [view, setView] = useState("curves");
  const [bins, setBins] = useState(3);
  const [selected, setSelected] = useState("all");
  const [metric, setMetric] = useState("AUC");
  const [logY, setLogY] = useState(false);
  const [vpcLogY, setVpcLogY] = useState(false);
  const column = columns.find(c => c.key === key) ?? columns[0];
  const groups = useMemo(() => covariateGroups(study, result, column, bins), [study, result, column, bins]);
  const visible = selected === "all" ? groups : groups.filter((_, i) => i === Number(selected));
  const pk = covariatePk(study, result, column, visible, metric);
  const series: Point[][] = [], styles: { stroke: string; width: number; opacity: number; dash?: string }[] = [];
  visible.forEach(g => {
    g.observed.forEach(s => { series.push(s.points.map((p, i) => s.cens?.[i] === 1 || s.cens?.[i] === null || (study.assay && p[1] <= study.assay.lloq) ? [p[0], NaN] : p)); styles.push({ stroke: g.color, width: 1, opacity: .65 }); });
    if (result) g.generated.forEach(i => { series.push(result.queryTime.map((t, j) => [t, result.generatedConcentration[i][j]])); styles.push({ stroke: g.color, width: 1.5, opacity: .8, dash: "5 4" }); });
  });
  const unspecified = (result?.generatedConcentration.length ?? 0) - groups.reduce((n, g) => n + g.generated.length, 0);
  return <>
    <div className="covariate-analysis-layout"><aside className="covariate-analysis-sidebar scientific-controls"><div className="covariate-analysis-controls">
      <label>Covariate<select aria-label="Analysis covariate" value={column.key} onChange={e => { setKey(e.target.value); setSelected("all"); }}>{columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
      <label>View<select aria-label="Covariate analysis view" value={view} onChange={e => setView(e.target.value)}><option value="curves">Concentration curves + VPC</option><option value="pk">PK quantities</option></select></label>
      {!column.options && <label>Covariate bins<select aria-label="Covariate bins" value={bins} onChange={e => { setBins(Number(e.target.value)); setSelected("all"); }}>{[2, 3, 4, 5, 6].map(n => <option key={n}>{n}</option>)}</select></label>}
      <label>Group<select aria-label="Covariate group" value={selected} onChange={e => setSelected(e.target.value)}><option value="all">All groups</option>{groups.map((g, i) => <option key={i} value={i}>{g.label}</option>)}</select></label>
      {view === "pk" && <label>Quantity<select aria-label="Covariate PK quantity" value={metric} onChange={e => setMetric(e.target.value)}>{["AUC", "Cmax", "Tmax"].map(m => <option key={m}>{m}</option>)}</select></label>}
    </div>
    <div className="covariate-analysis-legend">{visible.map(g => <span key={g.label} style={{ color: g.color }}>{g.label} · study {g.observed.length} / generated {g.generated.length}</span>)}</div>
    {unspecified > 0 && <p className="plot-caption">{unspecified} generated individuals have unspecified {column.label.toLowerCase()} and are not grouped.</p>}
    </aside><div className="covariate-analysis-plot">
    {view === "curves" && <div className="covariate-analysis-plots">
      <section><div className="card-heading"><h3>Concentration curves</h3><PlotScaleToggle logY={logY} onChange={setLogY} plot="Covariate concentration curves" /></div>
        <Chart series={series} styles={styles} logY={logY} assay={study.assay} xLabel={`Time (${study.timeUnit})`} yLabel={concentrationLabel(study.concentrationUnit)} ariaLabel="Covariate-group concentration curves" /></section>
      <section><div className="card-heading"><h3>VPC · mean ± SD</h3><PlotScaleToggle logY={vpcLogY} onChange={setVpcLogY} plot="Covariate VPC" /></div>
        <GroupVpc study={study} result={result} groups={visible} logY={vpcLogY} /></section>
    </div>}
    {view === "pk" && <><PkScatter rows={pk.rows} categorical={Boolean(column.options)} xLabel={column.label} yLabel={`${metric} (${metric === "Tmax" ? study.timeUnit : metric === "Cmax" ? study.concentrationUnit : `${study.concentrationUnit}·${study.timeUnit}`})`} />
      <p className="plot-caption">Filled: study · hollow: generated{column.options ? " · whiskers: 5/50/95%" : ""}. {pk.window && `Shared observed window: ${pk.window.map(t => t.toPrecision(3)).join("–")} ${study.timeUnit}; sampling matched within group.`} {pk.excluded > 0 && `${pk.excluded} censored or unmatched profiles omitted.`}</p></>}
    </div></div>
  </>;
}

export function CovariateAnalysis({ study, result }: { study: Study; result: InferenceResponse | null }) {
  const [open, setOpen] = useState(true);
  if (!targetColumns(study).length) return null;
  return <details open={open} className="card covariate-analysis" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Covariate analysis</summary>
    {open && <AnalysisContent key={study.id} study={study} result={result} />}
  </details>;
}
