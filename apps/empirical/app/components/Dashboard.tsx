"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runInference, serviceStatus, type InferenceResponse, type ModelId, type ServiceStatus } from "../lib/model-api";
import { contextDoseRatio, doseEventDraft, observedProtocol, studyHorizon, validateDoseProtocol, validateInteger, type DoseEventDraft } from "../lib/protocol";
import { dashboardRuntimeConfig } from "../lib/runtime-config";
import type { Corpus, Study } from "../lib/types";
import { ModelTrajectoryChart, ModelVpcChart, PkDistributionChart, TrajectoryChart, VpcChart } from "./StudyCharts";

type WikipediaIntro = { paragraph: string; title: string; url: string };

const wikipediaCache = new Map<string, WikipediaIntro | null>();
const wikipediaFallbacks: Record<string, string> = {
  "1-hydroxy-midazolam": "midazolam",
  "4-hydroxy-tolbutamide": "tolbutamide",
  "5-hydroxy-omeprazole": "omeprazole",
  "hydroxy-repaglinide": "repaglinide",
  "omeprazole sulfone": "omeprazole",
  "paracetamol glucuronide": "paracetamol",
  "quinidine gluconate": "quinidine",
  "quinidine sulfate dihydrate": "quinidine",
  "s-methyl-captopril": "captopril",
  "theophylline_multidose": "theophylline",
};

export function firstParagraph(extract: string) {
  return extract.split(/\n+/).map((paragraph) => paragraph.trim()).find(Boolean) ?? "";
}

async function wikipediaIntro(study: Study, signal: AbortSignal): Promise<WikipediaIntro | null> {
  const terms = [...new Set([
    study.drug,
    wikipediaFallbacks[study.drug.toLowerCase()],
    study.administeredDrug,
  ].filter((term): term is string => Boolean(term)))];

  for (const term of terms) {
    const cacheKey = term.toLowerCase();
    if (wikipediaCache.has(cacheKey)) {
      const cached = wikipediaCache.get(cacheKey) ?? null;
      if (cached) return cached;
      continue;
    }
    const params = new URLSearchParams({
      action: "query",
      titles: term,
      redirects: "1",
      prop: "extracts|info",
      inprop: "url",
      exintro: "1",
      explaintext: "1",
      format: "json",
      origin: "*",
    });
    const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal });
    if (!response.ok) continue;
    const payload = await response.json() as {
      query?: { pages?: Record<string, { extract?: string; fullurl?: string; missing?: boolean; title?: string }> };
    };
    const page = Object.values(payload.query?.pages ?? {})[0];
    const paragraph = firstParagraph(page?.extract ?? "");
    const result = page && !page.missing && paragraph && page.fullurl && page.title
      ? { paragraph, title: page.title, url: page.fullurl }
      : null;
    wikipediaCache.set(cacheKey, result);
    if (result) return result;
  }
  return null;
}

function WikipediaDescription({ study }: { study: Study }) {
  const [intro, setIntro] = useState<WikipediaIntro | null | undefined>();
  useEffect(() => {
    const controller = new AbortController();
    wikipediaIntro(study, controller.signal).then(setIntro).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) setIntro(null);
    });
    return () => controller.abort();
  }, [study]);

  if (intro === undefined) return <p className="description-loading">Loading description…</p>;
  if (intro === null) return <p className="description-loading">No Wikipedia introduction available.</p>;
  return <><p>{intro.paragraph}</p><a href={intro.url} target="_blank" rel="noreferrer">Wikipedia · {intro.title} ↗</a></>;
}

function format(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Not estimable";
  if (Math.abs(value) >= 1e4 || (Math.abs(value) > 0 && Math.abs(value) < 1e-3)) return value.toExponential(3);
  return value.toLocaleString(undefined, { maximumSignificantDigits: 4 });
}

function PlotScaleToggle({ logY, onChange, plot }: { logY: boolean; onChange: (logY: boolean) => void; plot: string }) {
  const nextScale = logY ? "linear" : "logarithmic";
  return <button
    className="plot-scale-toggle"
    type="button"
    aria-label={`Switch ${plot} to ${nextScale} scale`}
    aria-pressed={logY}
    onClick={() => onChange(!logY)}
  >{logY ? "Log" : "Linear"}</button>;
}

export function studyLabel(study: Study, studies: Study[]) {
  const sameDrug = studies.filter((candidate) => candidate.drug === study.drug);
  if (sameDrug.length === 1) return study.drug;
  const dose = study.dose === null ? "dose not reported" : `${format(study.dose)} ${study.doseUnit}`;
  return `${study.drug} — ${dose}`;
}

function StudySelector({ studies, selected, onSelect }: { studies: Study[]; selected: Study; onSelect: (study: Study) => void }) {
  const [query, setQuery] = useState("");
  const visibleStudies = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return studies.filter((study) => studyLabel(study, studies).toLowerCase().includes(needle));
  }, [query, studies]);
  return <aside className="study-browser">
    <div className="browser-header">
      <input aria-label="Search drugs" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
    </div>
    <div className="drug-list">
      {visibleStudies.map((study) => <button className={study.id === selected.id ? "drug-name active" : "drug-name"} type="button" key={study.id} onClick={() => onSelect(study)}>{studyLabel(study, studies)}</button>)}
      {!visibleStudies.length && <p className="empty-catalogue">No matches</p>}
    </div>
  </aside>;
}

export function ModelPanel({ study, onResult }: { study: Study; onResult: (result: InferenceResponse | null) => void }) {
  const apiRoot = dashboardRuntimeConfig().apiRoot;
  const hosted = !apiRoot.includes("127.0.0.1") && !apiRoot.includes("localhost");
  const protocolUnit = study.dose === null ? "relative exposure" : study.doseUnit;
  const horizon = studyHorizon(study);
  const referenceDose = study.dose ?? 1;
  const abortRequest = useRef<AbortController | null>(null);
  const initialProtocol = observedProtocol(study, protocolUnit).map((event, index) => (
    index === 0 ? { ...event, time: 0 } : event
  ));
  const resetDrafts = () => initialProtocol.map((event, index) => doseEventDraft(event, `observed-${index}`));
  const [events, setEvents] = useState<DoseEventDraft[]>(resetDrafts);
  const [nextEventId, setNextEventId] = useState(initialProtocol.length);
  const [draws, setDraws] = useState("20");
  const [modelId, setModelId] = useState<ModelId>("pythia");
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [seed, setSeed] = useState(42);
  const [hasResult, setHasResult] = useState(false);
  const eligible = study.subjects.length >= 2;
  const canonicalRoute = ["oral", "iv", "intravenous"].includes(study.route.toLowerCase());
  const protocol = useMemo(() => validateDoseProtocol(events, horizon), [events, horizon]);
  const drawsError = validateInteger(draws, 1, 30);
  const controlsValid = (modelId === "pythia" || protocol.valid) && !drawsError;
  const selectedStatus = status?.models?.[modelId]
    ?? (modelId === (status?.defaultModelId ?? "pythia_dose") ? status : null);
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
    setHasResult(false);
    onResult(null);
  };
  const change = (id: string, field: "time" | "amount", value: string) => {
    if (id === "observed-0" && field === "time") return;
    setEvents((current) => current.map((event) => event.id === id ? { ...event, [field]: value } : event));
    invalidate();
  };
  const remove = (id: string) => {
    if (id === "observed-0") return;
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
  const selectModel = (nextModel: ModelId) => {
    if (nextModel === modelId) return;
    setModelId(nextModel);
    setEvents(resetDrafts());
    invalidate();
  };
  const submit = async (requestSeed: number) => {
    if (!controlsValid) {
      setError("Correct the highlighted protocol settings before running inference.");
      return;
    }
    abortRequest.current?.abort();
    const controller = new AbortController();
    abortRequest.current = controller;
    setRunning(true); setError(""); setHasResult(false); onResult(null);
    try {
      const nextResult = await runInference({
        modelId,
        study: {
          id: study.id, drug: study.drug, study: study.study, source: study.source,
          route: study.route, dose: study.dose, doseUnit: protocolUnit,
          concentrationUnit: study.concentrationUnit, timeUnit: study.timeUnit,
          subjects: study.subjects,
        },
        doseEvents: modelId === "pythia" ? initialProtocol : protocol.events,
        nDraws: Number(draws),
        batchSize: 8,
        solver: { method: "heun", steps: 8 },
        seed: requestSeed,
      }, controller.signal);
      if (!controller.signal.aborted) {
        setHasResult(true);
        onResult(nextResult);
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Pythia-PK inference failed");
    } finally {
      if (abortRequest.current === controller) {
        abortRequest.current = null;
        setRunning(false);
      }
    }
  };
  const resample = () => {
    const nextSeed = seed === 2**31 - 1 ? 0 : seed + 1;
    setSeed(nextSeed);
    void submit(nextSeed);
  };
  return <section className="model-panel card">
    <div className="section-heading">
      <h2>Pythia-PK</h2>
      <span className={selectedStatus?.ready ? "status connected" : "status"}>{selectedStatus?.ready ? `CPU · ${selectedStatus.loaded ? "model loaded" : "ready"}` : status ? "Checkpoint unavailable" : hosted ? "Waking model…" : "Service offline"}</span>
    </div>
    <div className="model-selector" role="group" aria-label="Pythia model">
      <button type="button" className={modelId === "pythia" ? "active" : ""} aria-pressed={modelId === "pythia"} onClick={() => selectModel("pythia")}>Pythia</button>
      <button type="button" className={modelId === "pythia_dose" ? "active" : ""} aria-pressed={modelId === "pythia_dose"} onClick={() => selectModel("pythia_dose")}>Pythia-Dose</button>
    </div>
    {modelId === "pythia_dose" && <><div className="event-list">
      {events.map((event, index) => {
        const eventErrors = protocol.errors[event.id] ?? {};
        const ratio = contextDoseRatio(event.amount, referenceDose);
        return <div className="dose-event" key={event.id}>
          <span className="event-index">{index + 1}</span>
          <label className={eventErrors.time ? "invalid" : ""}>Time ({study.timeUnit}) <input aria-label={`Dose ${index + 1} time in ${study.timeUnit}`} aria-invalid={Boolean(eventErrors.time)} type="number" min="0" max={horizon} step="any" value={event.time} disabled={index === 0} onChange={(e) => change(event.id, "time", e.target.value)} />{eventErrors.time && <small className="field-error">{eventErrors.time}</small>}</label>
          <label className={eventErrors.amount ? "invalid" : ""}>Dose ({event.unit}) <input aria-label={`Dose ${index + 1} amount in ${event.unit}`} aria-invalid={Boolean(eventErrors.amount)} type="number" min="0" step="any" value={event.amount} onChange={(e) => change(event.id, "amount", e.target.value)} />{eventErrors.amount && <small className="field-error">{eventErrors.amount}</small>}</label>
          <span className="unit">{ratio ?? event.unit}</span>
          <button type="button" className="icon-button" aria-label={`Remove dose ${index + 1}`} disabled={index === 0} onClick={() => remove(event.id)}>×</button>
        </div>;
      })}
      {!events.length && <p className="empty-protocol">Add at least one dose event.</p>}
    </div>
    <div className="protocol-actions"><button type="button" className="secondary-button" onClick={addIntervention}>+ Add intervention</button><button type="button" className="secondary-button quiet" onClick={restoreObservedProtocol}>Reset protocol</button></div></>}
    <div className="model-controls">
      <label className={drawsError ? "invalid" : ""}>Generated individuals <input aria-invalid={Boolean(drawsError)} type="number" min="1" max="30" step="1" value={draws} onChange={(event) => { setDraws(event.target.value); invalidate(); }} />{drawsError && <small className="field-error">{drawsError}</small>}</label>
    </div>
    {!eligible && <p className="model-warning">Interactive Pythia-PK inference requires at least two individual trajectories.</p>}
    {!selectedStatus?.ready && <p className="model-warning">{hosted ? "The hosted model is waking up. Controls enable automatically when it is ready." : <><span>Start the local inference service with </span><code>npm run inference</code><span>. The model controls remain disabled until its checkpoint is available.</span></>}</p>}
    {modelId === "pythia_dose" && eligible && !canonicalRoute && <p className="model-warning">{study.route} is encoded as the model&apos;s generic non-oral dimensionless protocol. Interpret interventions as relative exposure changes.</p>}
    {modelId === "pythia_dose" && eligible && study.dose === null && <p className="model-warning">No absolute exposure was reported. The observed protocol is assigned reference exposure 1; controls are relative to that reference.</p>}
    {error && <p className="model-error">{error}</p>}
    <div className="inference-actions">
      <button type="button" className="primary-button" disabled={!selectedStatus?.ready || !eligible || !controlsValid || running} onClick={() => void submit(seed)}>{running ? "Running inference…" : `Run ${modelId === "pythia" ? "Pythia" : "Pythia-Dose"}`}</button>
      {hasResult && <button type="button" className="resample-button" disabled={!selectedStatus?.ready || !eligible || !controlsValid || running} onClick={resample}>Resample</button>}
    </div>
  </section>;
}

export function Dashboard() {
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [selectedId, setSelectedId] = useState("lenuzza-caffeine");
  const [vpcLogY, setVpcLogY] = useState(false);
  const [trajectoryLogY, setTrajectoryLogY] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [modelResult, setModelResult] = useState<InferenceResponse | null>(null);
  const [showStudyContext, setShowStudyContext] = useState(true);
  useEffect(() => { fetch(dashboardRuntimeConfig().corpusUrl).then((response) => response.json()).then(setCorpus); }, []);
  if (!corpus) return <main className="loading"><div className="loading-mark" />Loading PK catalogue…</main>;
  const selected = corpus.studies.find((study) => study.id === selectedId) ?? corpus.studies[0];
  const empiricalVpc = selected.subjects.length > 0;
  const modelLabel = modelResult?.request.modelId === "pythia" ? "Pythia" : "Pythia-Dose";
  return <div className="dashboard-shell" data-theme={darkMode ? "dark" : "light"}>
    <header className="topbar">
      <div><div className="brand-mark">P/PK</div><p className="brand-title">Pythia-PK — prior-fitted flows for pharmacokinetics</p></div>
      <div className="topbar-meta">
        <button className="theme-switch" type="button" aria-label={`Switch to ${darkMode ? "light" : "dark"} mode`} aria-pressed={darkMode} onClick={() => setDarkMode(!darkMode)}><i>{darkMode ? "☾" : "☀"}</i><b>{darkMode ? "Dark" : "Light"}</b></button>
      </div>
    </header>
    <div className="workspace">
      <StudySelector studies={corpus.studies} selected={selected} onSelect={(study) => { setSelectedId(study.id); setModelResult(null); setShowStudyContext(true); }} />
      <main className="content">
        <section className="study-title">
          <h1>{selected.drug}</h1>
          <dl><div><dt>Route</dt><dd>{selected.route}</dd></div><div><dt>Dose</dt><dd>{selected.dose === null ? "Not reported" : `${format(selected.dose)} ${selected.doseUnit}`}</dd></div><div><dt>Individuals</dt><dd>{selected.subjects.length || "Aggregate"}</dd></div><div><dt>Matrix</dt><dd>{selected.medium || "Not reported"}</dd></div></dl>
        </section>
        <section className="overview-grid">
          <article className="card description-card"><WikipediaDescription key={selected.id} study={selected} /></article>
          <ModelPanel key={selected.id} study={selected} onResult={setModelResult} />
        </section>
        <div className="toolbar"><button className={showStudyContext ? "overlay-toggle active" : "overlay-toggle"} type="button" aria-pressed={showStudyContext} disabled={!modelResult} onClick={() => setShowStudyContext(!showStudyContext)}>{showStudyContext ? "Hide study context" : "Show study context"}</button></div>
        <section className="results-grid">
          <article className="card chart-card"><div className="card-heading"><h2>VPC</h2><div className="chart-actions"><span className="legend">{modelResult ? <><i className="generated-band" />{modelLabel}{showStudyContext && <><i className="cyan-dashed-line" />Study</>}</> : <><i className="blue-line" />{empiricalVpc ? "Median" : "Mean"}<i className="cyan-dashed-line" />{empiricalVpc ? "5–95%" : "±SD"}</>}</span><PlotScaleToggle logY={vpcLogY} onChange={setVpcLogY} plot="VPC" /></div></div>{modelResult ? <ModelVpcChart result={modelResult} logY={vpcLogY} showEmpirical={showStudyContext} /> : <VpcChart study={selected} logY={vpcLogY} />}</article>
          <article className="card chart-card"><div className="card-heading"><h2>Individuals</h2><div className="chart-actions"><span className="legend">{modelResult && <><i className="red-line" />{modelLabel}</>}{(!modelResult || showStudyContext) && <><i className="blue-line" />Study</>}</span><PlotScaleToggle logY={trajectoryLogY} onChange={setTrajectoryLogY} plot="concentration profiles" /></div></div>{modelResult ? <ModelTrajectoryChart result={modelResult} study={selected} logY={trajectoryLogY} showEmpirical={showStudyContext} /> : <TrajectoryChart study={selected} logY={trajectoryLogY} />}</article>
          <article className="card distribution-card"><div className="section-heading"><h2>PK quantities</h2><span className="legend"><i className="blue-line" />Study{modelResult && <><i className="red-line" />{modelLabel}</>}</span></div>
            <PkDistributionChart study={selected} result={modelResult} />
          </article>
        </section>
      </main>
    </div>
  </div>;
}
