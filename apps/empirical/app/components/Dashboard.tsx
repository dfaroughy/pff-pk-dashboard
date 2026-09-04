"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { pkEstimates } from "../lib/pk";
import { runInference, serviceStatus, type InferenceResponse, type ServiceStatus } from "../lib/model-api";
import { contextDoseRatio, doseEventDraft, observedProtocol, studyHorizon, validateDoseProtocol, validateInteger, type DoseEventDraft } from "../lib/protocol";
import { dashboardRuntimeConfig } from "../lib/runtime-config";
import type { Corpus, Study } from "../lib/types";
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
  const visibleDrugs = drugs.filter((drug) => drug.toLowerCase().includes(query.toLowerCase()) && (origin === "All data" || studies.some((study) => study.drug === drug && study.origin === origin)));
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
      {!visibleDrugs.length && <p className="empty-catalogue">No matching analytes.</p>}
    </div>
  </aside>;
}

export function ModelPanel({ study, result, onResult }: { study: Study; result: InferenceResponse | null; onResult: (result: InferenceResponse | null) => void }) {
  const apiRoot = dashboardRuntimeConfig().apiRoot;
  const hosted = !apiRoot.includes("127.0.0.1") && !apiRoot.includes("localhost");
  const protocolUnit = study.dose === null ? "relative exposure" : study.doseUnit;
  const horizon = studyHorizon(study);
  const referenceDose = study.dose ?? 1;
  const abortRequest = useRef<AbortController | null>(null);
  const initialProtocol = observedProtocol(study, protocolUnit);
  const resetDrafts = () => initialProtocol.map((event, index) => doseEventDraft(event, `observed-${index}`));
  const [events, setEvents] = useState<DoseEventDraft[]>(resetDrafts);
  const [nextEventId, setNextEventId] = useState(initialProtocol.length);
  const [draws, setDraws] = useState("20");
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const eligible = study.subjects.length >= 2;
  const canonicalRoute = ["oral", "iv", "intravenous"].includes(study.route.toLowerCase());
  const protocol = useMemo(() => validateDoseProtocol(events, horizon), [events, horizon]);
  const drawsError = validateInteger(draws, 1, 30);
  const controlsValid = protocol.valid && !drawsError;
  useEffect(() => {
    let active = true;
    const refresh = () => serviceStatus()
      .then((next) => { if (active) setStatus(next); })
      .catch(() => { if (active) setStatus(null); });
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => () => abortRequest.current?.abort(), []);
  const invalidate = () => {
    abortRequest.current?.abort();
    abortRequest.current = null;
    setRunning(false);
    setError("");
    onResult(null);
  };
  const change = (id: string, field: "time" | "amount", value: string) => {
    setEvents((current) => current.map((event) => event.id === id ? { ...event, [field]: value } : event));
    invalidate();
  };
  const remove = (id: string) => {
    setEvents((current) => current.filter((event) => event.id !== id));
    invalidate();
  };
  const addIntervention = () => {
    const event = doseEventDraft({ time: 0.7 * horizon, amount: referenceDose, unit: protocolUnit, route: study.route }, `added-${nextEventId}`);
    setNextEventId((current) => current + 1);
    setEvents((current) => [...current, event]);
    invalidate();
  };
  const restoreObservedProtocol = () => {
    setEvents(resetDrafts());
    invalidate();
  };
  const submit = async () => {
    if (!controlsValid) {
      setError("Correct the highlighted protocol settings before running inference.");
      return;
    }
    abortRequest.current?.abort();
    const controller = new AbortController();
    abortRequest.current = controller;
    setRunning(true); setError(""); onResult(null);
    try {
      const nextResult = await runInference({
        study: {
          id: study.id, drug: study.drug, study: study.study, source: study.source,
          route: study.route, dose: study.dose, doseUnit: protocolUnit,
          concentrationUnit: study.concentrationUnit, timeUnit: study.timeUnit,
          subjects: study.subjects,
        },
        doseEvents: protocol.events,
        nDraws: Number(draws),
        batchSize: 8,
        solver: { method: "heun", steps: 8 },
        seed: 161803,
      }, controller.signal);
      if (!controller.signal.aborted) onResult(nextResult);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "PFF inference failed");
    } finally {
      if (abortRequest.current === controller) {
        abortRequest.current = null;
        setRunning(false);
      }
    }
  };
  return <section className="model-panel card">
    <div className="section-heading">
      <div><p className="eyebrow">Counterfactual protocol</p><h2>PFF zero-shot model</h2></div>
      <span className={status?.ready ? "status connected" : "status"}>{status?.ready ? `CPU · ${status.loaded ? "model loaded" : "ready"}` : status ? "Checkpoint unavailable" : hosted ? "Waking model…" : "Service offline"}</span>
    </div>
    <p className="muted">The browser sends physical observations and this dose schedule to the inference service. PyTorch performs preprocessing and PFF inference server-side.</p>
    <p className="protocol-domain">Prediction window: 0–{format(horizon)} {study.timeUnit}. Dose times use {study.timeUnit}; doses use {protocolUnit}.</p>
    <div className="event-list">
      {events.map((event, index) => {
        const eventErrors = protocol.errors[event.id] ?? {};
        const ratio = contextDoseRatio(event.amount, referenceDose);
        return <div className="dose-event" key={event.id}>
          <span className="event-index">{index + 1}</span>
          <label className={eventErrors.time ? "invalid" : ""}>Time ({study.timeUnit}) <input aria-label={`Dose ${index + 1} time in ${study.timeUnit}`} aria-invalid={Boolean(eventErrors.time)} type="number" min="0" max={horizon} step="any" value={event.time} onChange={(e) => change(event.id, "time", e.target.value)} />{eventErrors.time && <small className="field-error">{eventErrors.time}</small>}</label>
          <label className={eventErrors.amount ? "invalid" : ""}>Dose ({event.unit}) <input aria-label={`Dose ${index + 1} amount in ${event.unit}`} aria-invalid={Boolean(eventErrors.amount)} type="number" min="0" step="any" value={event.amount} onChange={(e) => change(event.id, "amount", e.target.value)} />{eventErrors.amount && <small className="field-error">{eventErrors.amount}</small>}</label>
          <span className="unit">{ratio ?? event.unit}</span>
          <button type="button" className="icon-button" aria-label={`Remove dose ${index + 1}`} onClick={() => remove(event.id)}>×</button>
        </div>;
      })}
      {!events.length && <p className="empty-protocol">Add at least one dose event.</p>}
    </div>
    <div className="protocol-actions"><button type="button" className="secondary-button" onClick={addIntervention}>+ Add intervention</button><button type="button" className="secondary-button quiet" onClick={restoreObservedProtocol}>Reset protocol</button></div>
    <div className="model-controls">
      <label className={drawsError ? "invalid" : ""}>Generated individuals <input aria-invalid={Boolean(drawsError)} type="number" min="1" max="30" step="1" value={draws} onChange={(event) => { setDraws(event.target.value); invalidate(); }} />{drawsError && <small className="field-error">{drawsError}</small>}</label>
    </div>
    {!eligible && <p className="model-warning">Interactive PFF inference requires at least two individual trajectories.</p>}
    {!status?.ready && <p className="model-warning">{hosted ? "The free hosted model is waking up. Controls enable automatically when it is ready." : <><span>Start the local inference service with </span><code>npm run inference</code><span>. The model controls remain disabled until its checkpoint is available.</span></>}</p>}
    {eligible && !canonicalRoute && <p className="model-warning">{study.route} is encoded as the model&apos;s generic non-oral dimensionless protocol. Interpret interventions as relative exposure changes.</p>}
    {eligible && study.dose === null && <p className="model-warning">No absolute exposure was reported. The observed protocol is assigned reference exposure 1; controls are relative to that reference.</p>}
    {error && <p className="model-error">{error}</p>}
    <button type="button" className="primary-button" disabled={!status?.ready || !eligible || !controlsValid || running} onClick={submit}>{running ? "Running PyTorch inference…" : "Run zero-shot inference"}</button>
    <code className="request-preview">PFF API · {events.length} dose event{events.length === 1 ? "" : "s"} · {draws || "—"} generated individuals</code>
    {result && <p className="completed-request">Artifact <code>{result.inferenceId}</code><br />{result.generatedConcentration.length} draws · {result.provenance.runtimeSeconds.toFixed(1)} s · {result.provenance.normalization}</p>}
  </section>;
}

export function Dashboard() {
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [selectedId, setSelectedId] = useState("lenuzza-caffeine");
  const [logY, setLogY] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const [modelResult, setModelResult] = useState<InferenceResponse | null>(null);
  const [showStudyContext, setShowStudyContext] = useState(true);
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
      <StudySelector studies={corpus.studies} selected={selected} onSelect={(study) => { setSelectedId(study.id); setModelResult(null); setShowStudyContext(true); }} />
      <main className="content">
        <section className="study-title">
          <div><p className="eyebrow">{selected.origin}</p><h1>{selected.drug}</h1><p>{selected.study} · {selected.source}</p></div>
          <dl><div><dt>Route</dt><dd>{selected.route}</dd></div><div><dt>Dose</dt><dd>{selected.dose === null ? "Not reported" : `${format(selected.dose)} ${selected.doseUnit}`}</dd></div><div><dt>Individuals</dt><dd>{selected.subjects.length || "Aggregate"}</dd></div><div><dt>Matrix</dt><dd>{selected.medium || "Not reported"}</dd></div></dl>
        </section>
        <div className="toolbar"><span>{modelResult ? "Study and PFF model" : "Observed data"}</span><div className="toolbar-controls"><button className={showStudyContext ? "overlay-toggle active" : "overlay-toggle"} type="button" aria-pressed={showStudyContext} disabled={!modelResult} onClick={() => setShowStudyContext(!showStudyContext)}>{showStudyContext ? "Hide study context" : "Show study context"}</button><div className="segmented"><button className={!logY ? "active" : ""} onClick={() => setLogY(false)}>Linear y</button><button className={logY ? "active" : ""} onClick={() => setLogY(true)}>Log y</button></div></div></div>
        <section className="chart-grid">
          <article className="card chart-card"><div className="card-heading"><div><p className="eyebrow">{modelResult ? "Observed and generated individuals" : "Individual records"}</p><h2>Concentration–time profiles</h2></div><span className="legend">{modelResult && <><i className="red-line" />PFF draw</>}{(!modelResult || showStudyContext) && <><i className="blue-line" />Study context</>}</span></div>{modelResult ? <ModelTrajectoryChart result={modelResult} study={selected} logY={logY} showEmpirical={showStudyContext} /> : <TrajectoryChart study={selected} logY={logY} />}</article>
          <article className="card chart-card"><div className="card-heading"><div><p className="eyebrow">{modelResult ? "Observed and generated quantiles" : empiricalVpc ? "Time-wise empirical quantiles" : "Aggregate record"}</p><h2>{modelResult ? "Visual predictive check" : empiricalVpc ? "Observed VPC" : "Published cohort summary"}</h2></div><span className="legend">{modelResult ? <><i className="blue-band" />PFF intervals{showStudyContext && <><i className="blue-line" />Study quantiles</>}</> : <><i className="blue-line" />{empiricalVpc ? "Median" : "Mean"}<i className="orange-line" />{empiricalVpc ? "5–95%" : "±SD"}</>}</span></div>{modelResult ? <ModelVpcChart result={modelResult} study={selected} logY={logY} showEmpirical={showStudyContext} /> : <VpcChart study={selected} logY={logY} />}<p className="chart-note">{modelResult ? `Blue shading denotes the generated 5th and 95th percentile intervals; orange shading denotes the generated median interval.${showStudyContext ? " Blue and orange markers show the observed study median and 5th–95th percentiles." : ""}` : empiricalVpc ? "Quantiles use subjects observed at each exact sampling time; n may vary across time." : "This source reports summary statistics only. The band is mean ± SD and is not an individual-level VPC."}</p></article>
          <article className="card nca-card"><div className="section-heading"><div><p className="eyebrow">Descriptive noncompartmental analysis</p><h2>Classical PK quantities</h2></div><span className="method-badge">Observed profile</span></div>
            <dl className="pk-metrics">{estimates.map((estimate) => <div key={estimate.symbol}><dt><code>{estimate.symbol}</code><span>{estimate.label}</span></dt><dd>{format(estimate.value)} <small>{estimate.value === null ? "" : estimate.unit}</small></dd><p>{estimate.note}</p></div>)}</dl>
            <p className="table-note">Screening-level estimates from the displayed cohort profile; no compartmental model is fitted.</p>
          </article>
        </section>
        <section className="model-grid">
          <ModelPanel key={selected.id} study={selected} result={modelResult} onResult={setModelResult} />
        </section>
      </main>
    </div>
  </div>;
}
