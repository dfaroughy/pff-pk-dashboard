"use client";

import { useEffect, useMemo, useState } from "react";
import { pkEstimates } from "../lib/pk";
import { runInference, serviceStatus, type InferenceResponse, type ServiceStatus } from "../lib/model-api";
import { dashboardRuntimeConfig } from "../lib/runtime-config";
import type { Corpus, DoseEvent, Study } from "../lib/types";
import { ModelTrajectoryChart, ModelVpcChart, TrajectoryChart, VpcChart } from "./StudyCharts";

function format(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Not estimable";
  if (Math.abs(value) >= 1e4 || (Math.abs(value) > 0 && Math.abs(value) < 1e-3)) return value.toExponential(3);
  return value.toLocaleString(undefined, { maximumSignificantDigits: 4 });
}

function StudySelector({ studies, selected, onSelect }: { studies: Study[]; selected: Study; onSelect: (study: Study) => void }) {
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState("All data");
  const [expandedDrug, setExpandedDrug] = useState<string | null>(selected.drug);
  const drugs = useMemo(() => [...new Set(studies.map((study) => study.drug))].sort(), [studies]);
  const visibleDrugs = drugs.filter((drug) => drug.includes(query.toLowerCase()) && (origin === "All data" || studies.some((study) => study.drug === drug && study.origin === origin)));
  return <aside className="study-browser">
    <div className="browser-header">
      <p className="eyebrow">Study catalogue</p>
      <h2>{drugs.length} analytes</h2>
      <input aria-label="Search drugs" placeholder="Search drug or metabolite" value={query} onChange={(event) => setQuery(event.target.value)} />
      <select aria-label="Filter data source" value={origin} onChange={(event) => setOrigin(event.target.value)}>
        <option>All data</option><option>Lenuzza 2016</option><option>Empirical individuals</option>
      </select>
    </div>
    <div className="drug-list">
      {visibleDrugs.map((drug) => {
        const candidates = studies.filter((study) => study.drug === drug && (origin === "All data" || study.origin === origin));
        const expanded = expandedDrug === drug;
        return <div className="drug-group" key={drug}>
          <button className={expanded ? "drug-name expanded" : "drug-name"} type="button" aria-expanded={expanded} onClick={() => setExpandedDrug(expanded ? null : drug)}>{drug}</button>
          {expanded && <div className="study-children">{candidates.map((study) => <button className={study.id === selected.id ? "study-option active" : "study-option"} key={study.id} onClick={() => onSelect(study)}>
            <span className={study.origin === "Lenuzza 2016" ? "source-tag lenuzza" : "source-tag"}>{study.origin === "Lenuzza 2016" ? "Lenuzza 2016" : "Empirical"}</span>
            <span className="study-name">{study.origin === "Lenuzza 2016" ? "CIME cohort" : study.study}</span>
            <small>{study.route} · {study.dose === null ? "dose NR" : `${format(study.dose)} ${study.doseUnit}`}</small>
          </button>)}</div>}
        </div>;
      })}
    </div>
  </aside>;
}

function ModelPanel({ study, result, onResult }: { study: Study; result: InferenceResponse | null; onResult: (result: InferenceResponse | null) => void }) {
  const apiRoot = dashboardRuntimeConfig().apiRoot;
  const protocolUnit = study.dose === null ? "relative exposure" : study.doseUnit;
  const initial = study.doseEvents?.length ? study.doseEvents : [{ time: 0, amount: study.dose ?? 1, unit: protocolUnit, route: study.route }];
  const [events, setEvents] = useState<DoseEvent[]>(initial);
  const [draws, setDraws] = useState(100);
  const [method, setMethod] = useState<"heun" | "euler">("heun");
  const [steps, setSteps] = useState(8);
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const eligible = study.subjects.length >= 2;
  const canonicalRoute = ["oral", "iv", "intravenous"].includes(study.route.toLowerCase());
  useEffect(() => {
    let active = true;
    const refresh = () => serviceStatus()
      .then((next) => { if (active) setStatus(next); })
      .catch(() => { if (active) setStatus(null); });
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const change = (index: number, field: "time" | "amount", value: number) => setEvents(events.map((event, eventIndex) => eventIndex === index ? { ...event, [field]: value } : event));
  const submit = async () => {
    setRunning(true); setError(""); onResult(null);
    try {
      onResult(await runInference({
        study: {
          id: study.id, drug: study.drug, study: study.study, source: study.source,
          route: study.route, dose: study.dose, doseUnit: protocolUnit,
          concentrationUnit: study.concentrationUnit, timeUnit: study.timeUnit,
          subjects: study.subjects,
        },
        doseEvents: events,
        nDraws: draws,
        batchSize: 8,
        solver: { method, steps },
        seed: 161803,
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "PFF inference failed");
    } finally { setRunning(false); }
  };
  return <section className="model-panel card">
    <div className="section-heading">
      <div><p className="eyebrow">Counterfactual protocol</p><h2>PFF zero-shot model</h2></div>
      <span className={status?.ready ? "status connected" : "status"}>{status?.ready ? `CPU · ${status.loaded ? "model loaded" : "ready"}` : "Service offline"}</span>
    </div>
    <p className="muted">The browser sends physical observations and this dose schedule to the local service. PyTorch performs preprocessing and PFF inference on your CPU.</p>
    <div className="event-list">
      {events.map((event, index) => <div className="dose-event" key={`${event.time}-${index}`}>
        <span className="event-index">{index + 1}</span>
        <label>Time <input type="number" min="0" step="0.01" value={event.time} onChange={(e) => change(index, "time", Number(e.target.value))} /></label>
        <label>Dose <input type="number" min="0" step="0.01" value={event.amount} onChange={(e) => change(index, "amount", Number(e.target.value))} /></label>
        <span className="unit">{event.unit}</span>
        <button className="icon-button" aria-label={`Remove dose ${index + 1}`} onClick={() => setEvents(events.filter((_, eventIndex) => eventIndex !== index))}>×</button>
      </div>)}
    </div>
    <button className="secondary-button" onClick={() => setEvents([...events, { time: 0.7 * Math.max(...study.subjects.flatMap((subject) => subject.points.map(([time]) => time)), 1), amount: study.dose ?? 1, unit: protocolUnit, route: study.route }])}>+ Add intervention</button>
    <div className="model-controls">
      <label>Generated individuals <input type="number" min="1" max="500" value={draws} onChange={(event) => setDraws(Number(event.target.value))} /></label>
      <label>Integrator <select value={method} onChange={(event) => setMethod(event.target.value as "heun" | "euler")}><option value="heun">Heun</option><option value="euler">Euler</option></select></label>
      <label>Integration steps <input type="number" min="1" max="100" value={steps} onChange={(event) => setSteps(Number(event.target.value))} /></label>
      <label>Checkpoint <input value={status?.checkpointId ?? "Local service"} readOnly /></label>
    </div>
    {!eligible && <p className="model-warning">Interactive PFF inference requires at least two individual trajectories.</p>}
    {eligible && !canonicalRoute && <p className="model-warning">{study.route} is encoded as the model&apos;s generic non-oral dimensionless protocol. Interpret interventions as relative exposure changes.</p>}
    {eligible && study.dose === null && <p className="model-warning">No absolute exposure was reported. The observed protocol is assigned reference exposure 1; controls are relative to that reference.</p>}
    {error && <p className="model-error">{error}</p>}
    <button className="primary-button" disabled={!status?.ready || !eligible || running} onClick={submit}>{running ? "Running PyTorch inference…" : "Run zero-shot inference"}</button>
    <code className="request-preview">POST {apiRoot}/inference · {events.length} dose event{events.length === 1 ? "" : "s"}</code>
    {result && <p className="completed-request">Artifact <code>{result.inferenceId}</code><br />{result.generatedConcentration.length} draws · {result.provenance.runtimeSeconds.toFixed(1)} s · {result.provenance.normalization}</p>}
  </section>;
}

export function Dashboard() {
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [selectedId, setSelectedId] = useState("lenuzza-caffeine");
  const [logY, setLogY] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const [modelResult, setModelResult] = useState<InferenceResponse | null>(null);
  const [showEmpiricalTrajectories, setShowEmpiricalTrajectories] = useState(true);
  const [showEmpiricalVpc, setShowEmpiricalVpc] = useState(true);
  useEffect(() => { fetch(dashboardRuntimeConfig().corpusUrl).then((response) => response.json()).then(setCorpus); }, []);
  if (!corpus) return <main className="loading"><div className="loading-mark" />Loading PK catalogue…</main>;
  const selected = corpus.studies.find((study) => study.id === selectedId) ?? corpus.studies[0];
  const estimates = pkEstimates(selected);
  const empiricalVpc = selected.subjects.length > 0;
  return <div className="dashboard-shell" data-theme={darkMode ? "dark" : "light"}>
    <header className="topbar">
      <div><div className="brand-mark">PFF</div><div><p className="brand-title">Prior-fitted flows for PK/PD</p><p className="brand-subtitle">Empirical cohorts, noncompartmental summaries, and model counterfactuals</p></div></div>
      <div className="topbar-meta">
        <button className="theme-switch" type="button" aria-label={`Switch to ${darkMode ? "light" : "dark"} mode`} aria-pressed={darkMode} onClick={() => setDarkMode(!darkMode)}><i>{darkMode ? "☾" : "☀"}</i><b>{darkMode ? "Dark" : "Light"}</b></button>
        <span>{corpus.studies.length.toLocaleString()} studies</span><span>schema v{corpus.schemaVersion}</span>
      </div>
    </header>
    <div className="workspace">
      <StudySelector studies={corpus.studies} selected={selected} onSelect={(study) => { setSelectedId(study.id); setModelResult(null); }} />
      <main className="content">
        <section className="study-title">
          <div><p className="eyebrow">{selected.origin}</p><h1>{selected.drug}</h1><p>{selected.study} · {selected.source}</p></div>
          <dl><div><dt>Route</dt><dd>{selected.route}</dd></div><div><dt>Dose</dt><dd>{selected.dose === null ? "Not reported" : `${format(selected.dose)} ${selected.doseUnit}`}</dd></div><div><dt>Individuals</dt><dd>{selected.subjects.length || "Aggregate"}</dd></div><div><dt>Matrix</dt><dd>{selected.medium || "Not reported"}</dd></div></dl>
        </section>
        <div className="toolbar"><span>Observed data</span><div className="segmented"><button className={!logY ? "active" : ""} onClick={() => setLogY(false)}>Linear y</button><button className={logY ? "active" : ""} onClick={() => setLogY(true)}>Log y</button></div></div>
        <section className="chart-grid">
          <article className="card chart-card"><div className="card-heading"><div><p className="eyebrow">Individual records</p><h2>Concentration–time profiles</h2></div><span className="legend"><i className="blue-line" />Observed individual</span></div><TrajectoryChart study={selected} logY={logY} /></article>
          <article className="card chart-card"><div className="card-heading"><div><p className="eyebrow">{empiricalVpc ? "Time-wise empirical quantiles" : "Aggregate record"}</p><h2>{empiricalVpc ? "Observed VPC" : "Published cohort summary"}</h2></div><span className="legend"><i className="blue-line" />{empiricalVpc ? "Median" : "Mean"}<i className="orange-line" />{empiricalVpc ? "5–95%" : "±SD"}</span></div><VpcChart study={selected} logY={logY} /><p className="chart-note">{empiricalVpc ? "Quantiles use subjects observed at each exact sampling time; n may vary across time." : "This source reports summary statistics only. The band is mean ± SD and is not an individual-level VPC."}</p></article>
          <article className="card nca-card"><div className="section-heading"><div><p className="eyebrow">Descriptive noncompartmental analysis</p><h2>Classical PK quantities</h2></div><span className="method-badge">Observed profile</span></div>
            <dl className="pk-metrics">{estimates.map((estimate) => <div key={estimate.symbol}><dt><code>{estimate.symbol}</code><span>{estimate.label}</span></dt><dd>{format(estimate.value)} <small>{estimate.value === null ? "" : estimate.unit}</small></dd><p>{estimate.note}</p></div>)}</dl>
            <p className="table-note">Screening-level estimates from the displayed cohort profile; no compartmental model is fitted.</p>
          </article>
        </section>
        <section className="model-grid">
          <ModelPanel key={selected.id} study={selected} result={modelResult} onResult={setModelResult} />
          <article className="card chart-card model-chart-card"><div className="card-heading"><div><p className="eyebrow">Generated individuals</p><h2>Counterfactual profiles</h2></div><div className="card-actions"><span className="legend"><i className="red-line" />PFF draw{showEmpiricalTrajectories && <><i className="blue-line" />Empirical</>}</span><button className={showEmpiricalTrajectories ? "overlay-toggle active" : "overlay-toggle"} onClick={() => setShowEmpiricalTrajectories(!showEmpiricalTrajectories)}>{showEmpiricalTrajectories ? "Hide empirical overlay" : "Include empirical overlay"}</button></div></div>
            {modelResult ? <ModelTrajectoryChart result={modelResult} study={selected} logY={logY} showEmpirical={showEmpiricalTrajectories} /> : <div className="model-placeholder">Run zero-shot inference to generate individual profiles.</div>}
          </article>
          <article className="card chart-card model-chart-card"><div className="card-heading"><div><p className="eyebrow">Generated percentile uncertainty</p><h2>Counterfactual VPC</h2></div><div className="card-actions"><span className="legend"><i className="blue-band" />5/95% PI<i className="orange-band" />50% PI</span><button className={showEmpiricalVpc ? "overlay-toggle active" : "overlay-toggle"} onClick={() => setShowEmpiricalVpc(!showEmpiricalVpc)}>{showEmpiricalVpc ? "Hide empirical overlay" : "Include empirical overlay"}</button></div></div>
            {modelResult ? <><ModelVpcChart result={modelResult} study={selected} logY={logY} showEmpirical={showEmpiricalVpc} /><p className="chart-note">Shading is the 90% bootstrap interval for each generated percentile. Markers show empirical percentiles when enabled.</p></> : <div className="model-placeholder">The generated VPC will appear here with blue tail and orange median intervals.</div>}
          </article>
        </section>
      </main>
    </div>
  </div>;
}
