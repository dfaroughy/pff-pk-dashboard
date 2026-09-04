"use client";

import { useMemo, useRef, useState } from "react";
import Latex from "./Latex";
import { CohortStrip, GraphCanvas, ProtocolTimeline, TrajectoryCanvas } from "./Visuals";
import {
  acquireMesh,
  generateStudy,
  PRIOR_FACTS,
  Rng,
  sampleCohort,
  sampleGraph,
  sampleKinetics,
  sampleProtocol,
  type AcquisitionFamily,
  type CohortDraw,
  type GraphDraw,
  type KineticDraw,
  type ProtocolDraw,
  type ScheduleShape,
  type StudyDraw,
} from "./lib/prior";

const format = (value: number) => value >= 100 || value < 0.01 ? value.toExponential(2) : value.toFixed(3);
const indexSymbol = (value: number) => String.fromCharCode(97 + value);

function PriorTable({ rows }: { rows: string[][] }) {
  return <div className="prior-table">{rows.map(([name, prior]) => (
    <div className="prior-row" key={name}><span>{name}</span><p>{prior}</p></div>
  ))}</div>;
}

function StageHeader({ number, kicker, title, caption, action, disabled, onAction }: {
  number: number;
  kicker: string;
  title: string;
  caption: string;
  action: string;
  disabled?: boolean;
  onAction: () => void;
}) {
  return <div className="stage-header">
    <span className="stage-index">0{number}</span>
    <div><span className="eyebrow">{kicker}</span><h2>{title}</h2><p>{caption}</p></div>
    <button className="stage-action" disabled={disabled} onClick={onAction}>{action}<span>↗</span></button>
  </div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function SymbolicEquations({ graph }: { graph: GraphDraw }) {
  return <div className="equations">
    {graph.nodes.map((node) => {
      const a = indexSymbol(node.id);
      const incoming = graph.edges.filter((edge) => edge.dst === node.id).map((edge) => `J_{${indexSymbol(edge.src)}${a}}`);
      const outgoing = graph.edges.filter((edge) => edge.src === node.id).map((edge) => `J_{${a}${indexSymbol(edge.dst)}}`);
      if (graph.elimNodes.includes(node.id)) outgoing.push(`J_{${a}\\varnothing}`);
      const rhs = [incoming.join(" + ") || "0", ...outgoing.map((term) => `-${term}`), ...(Object.hasOwn(graph.doseMap, node.id) ? [`+u_${a}(\\tau)`] : [])].join(" ");
      return <div className="equation-line" key={node.id}>
        <span className="equation-label">{node.label}</span>
        <Latex tex={`\\frac{\\mathrm d X_${a}}{\\mathrm d\\tau}=${rhs}`} block />
      </div>;
    })}
    <div className="flux-equation"><span>Linear</span><Latex tex={"J_{ab}=\\kappa_{ab}e^{\\vartheta_{ab}(\\tau)}g_{ab}(\\tau)X_a"} block /></div>
    <div className="flux-equation"><span>Saturable</span><Latex tex={"J_{ab}=\\kappa_{ab}e^{\\vartheta_{ab}(\\tau)}g_{ab}(\\tau)\\frac{\\beta_{ab}X_a^{h_{ab}}}{\\beta_{ab}^{h_{ab}}+X_a^{h_{ab}}}M_{ab}(X_m)"} block /></div>
  </div>;
}

function TopologyStage({ graph, onDraw }: { graph: GraphDraw | null; onDraw: () => void }) {
  return <section className="stage-content" id="topology">
    <StageHeader number={1} kicker="Graph G" title="Compartment topology" caption="Sample route and a valid directed compartment graph." action={graph ? "Redraw G" : "Draw G"} onAction={onDraw} />
    <div className="stage-grid">
      <article className="card visual-card"><div className="card-head"><span>Graph</span><strong>{graph ? `${graph.route.toUpperCase()} · ${graph.nodes.length} states` : "not sampled"}</strong></div>{graph ? <GraphCanvas graph={graph} /> : <div className="empty-visual">Draw the topology.</div>}</article>
      <article className="card"><div className="card-head"><span>Prior</span></div><PriorTable rows={PRIOR_FACTS.topology} /></article>
    </div>
    {graph && <div className="detail-grid">
      <article className="card"><div className="card-head"><span>Realization</span><strong>G</strong></div><div className="metric-grid"><Metric label="route" value={graph.route} /><Metric label="states" value={graph.nodes.length} /><Metric label="edges" value={graph.edges.length} /><Metric label="elimination" value={graph.elimNodes.length} /><Metric label="parallel" value={graph.hasParallelAbsorption ? "yes" : "no"} /><Metric label="recycling" value={graph.hasRecycling ? "yes" : "no"} /></div></article>
      <article className="card equation-card"><div className="card-head"><span>ODE system</span></div><SymbolicEquations graph={graph} /></article>
    </div>}
  </section>;
}

function KineticsStage({ graph, kinetics, onDraw }: { graph: GraphDraw | null; kinetics: KineticDraw | null; onDraw: () => void }) {
  return <section className="stage-content" id="kinetics">
    <StageHeader number={2} kicker="Population θ" title="Flux kinetics" caption="Assign rates, nonlinearities and time variation." action={kinetics ? "Resample θ" : "Sample θ"} disabled={!graph} onAction={onDraw} />
    {!graph ? <div className="stage-empty">Requires G.</div> : <>
      <div className="stage-grid">
        <article className="card visual-card"><div className="card-head"><span>Parameterized graph</span><strong><i className="legend-line" /> nonlinear</strong></div><GraphCanvas graph={graph} rates={kinetics?.rates} /></article>
        <article className="card"><div className="card-head"><span>Prior</span><strong>dimensionless</strong></div><PriorTable rows={PRIOR_FACTS.kinetics} /></article>
      </div>
      {kinetics && <article className="card rate-card"><div className="card-head"><span>Sampled θ</span><strong>time-gauge adjusted</strong></div><div className="rate-table">
        <div className="rate-row rate-heading"><span>flux</span><span>form</span><span>κ</span><span>β</span><span>h</span><span>time / regulation</span></div>
        {kinetics.rates.map((rate) => <div className="rate-row" key={rate.id}>
          <span><Latex tex={rate.dst === null ? `X_${indexSymbol(rate.src)}\\to\\varnothing` : `X_${indexSymbol(rate.src)}\\to X_${indexSymbol(rate.dst)}`} /></span>
          <span className={rate.beta !== null ? "hot" : ""}>{rate.beta !== null ? "Hill" : "linear"}</span><span>{format(rate.kappa)}</span><span>{rate.beta === null ? "∞" : format(rate.beta)}</span><span>{rate.hill.toFixed(2)}</span>
          <span>{rate.gateLag !== undefined ? `gate ${rate.gateLag.toFixed(2)}` : rate.modNode !== undefined ? `${rate.modType} · X${indexSymbol(rate.modNode)}` : rate.timeVarying ? `Matérn ν=${rate.nu}, ℓ=${rate.ell?.toFixed(2)}` : "constant"}</span>
        </div>)}
      </div></article>}
    </>}
  </section>;
}

function ProtocolStage({ protocol, enabled, onDraw }: { protocol: ProtocolDraw | null; enabled: boolean; onDraw: () => void }) {
  return <section className="stage-content" id="protocol">
    <StageHeader number={3} kicker="Dose process Π" title="Dose protocol" caption="Sample bolus or infusion events on normalized time." action={protocol ? "Resample Π" : "Sample Π"} disabled={!enabled} onAction={onDraw} />
    {!enabled ? <div className="stage-empty">Requires θ.</div> : <div className="stage-grid">
      <article className="card visual-card"><div className="card-head"><span>Protocol</span><strong>{protocol ? `${protocol.pattern} · ${protocol.infusion ? "infusion" : "bolus"}` : "not sampled"}</strong></div>{protocol ? <><ProtocolTimeline events={protocol.events} /><div className="event-table">{protocol.events.map((event, i) => <div key={i}><span>{String(i + 1).padStart(2, "0")}</span><b>τ={event.time.toFixed(3)}</b><b>d={event.amount.toFixed(3)}</b><b>{event.duration ? `Δ=${event.duration.toFixed(3)}` : "bolus"}</b></div>)}</div></> : <div className="empty-visual">Sample Π.</div>}</article>
      <article className="card"><div className="card-head"><span>Prior</span></div><PriorTable rows={PRIOR_FACTS.protocol} /><div className="input-equations"><Latex tex={"u_a^{\\mathrm{bolus}}(\\tau)=\\sum_k d_k\\,\\delta(\\tau-\\tau_k)"} block /><Latex tex={"u_a^{\\mathrm{inf}}(\\tau)=\\sum_k\\frac{d_k}{\\Delta_k}\\mathbf 1_{[\\tau_k,\\tau_k+\\Delta_k]}(\\tau)"} block /></div></article>
    </div>}
  </section>;
}

function PopulationStage({ cohort, enabled, onDraw }: { cohort: CohortDraw | null; enabled: boolean; onDraw: () => void }) {
  return <section className="stage-content" id="population">
    <StageHeader number={4} kicker="Individuals Iᵢ" title="Cohort" caption="Sample 35 exchangeable individuals from one population." action={cohort ? "Resample cohort" : "Draw cohort"} disabled={!enabled} onAction={onDraw} />
    {!enabled ? <div className="stage-empty">Requires Π.</div> : <div className="stage-grid">
      <article className="card equation-card"><div className="card-head"><span>Population model</span><strong>i=1,…,35</strong></div><div className="population-equation"><Latex tex={"\\log\\theta_i=\\log\\theta_{\\mathrm{pop}}+g_{\\mathcal S}(x_i)+\\eta_i"} block /></div><PriorTable rows={PRIOR_FACTS.cohort} /></article>
      <article className="card visual-card"><div className="card-head"><span>Realized cohort</span><strong>{cohort ? "N=35" : "not sampled"}</strong></div>{cohort ? <><CohortStrip label="central-volume ratio" values={cohort.individuals.map((item) => item.volume)} /><CohortStrip label="bioavailability ratio" values={cohort.individuals.map((item) => item.bioavailability)} /><CohortStrip label="first-rate multiplier" values={cohort.individuals.map((item) => item.multipliers[0])} /><div className="metric-grid compact"><Metric label="rate corr." value={cohort.correlation.toFixed(2)} /><Metric label="covariates" value={cohort.nCovariates} /><Metric label="observed" value={cohort.nObservedCovariates} /><Metric label="map" value={cohort.covariateActive ? `${cohort.mlpDepth}L ${cohort.mlpActivation}` : "off"} /></div></> : <div className="empty-visual">Draw the cohort.</div>}</article>
    </div>}
  </section>;
}

function StudyStage({ study, enabled, armIndex, setArmIndex, logScale, setLogScale, onDraw }: { study: StudyDraw | null; enabled: boolean; armIndex: number; setArmIndex: (value: number) => void; logScale: boolean; setLogScale: (value: boolean) => void; onDraw: () => void }) {
  const arm = study?.arms[armIndex];
  return <section className="stage-content" id="study">
    <StageHeader number={5} kicker="Family 𝒮" title="Study family" caption="Replay the matched cohort under five dose protocols." action={study ? "Regenerate family" : "Generate family"} disabled={!enabled} onAction={onDraw} />
    {!enabled ? <div className="stage-empty">Requires the cohort.</div> : study ? <>
      <div className="arm-tabs" role="tablist">{study.arms.map((item, i) => <button role="tab" aria-selected={i === armIndex} className={i === armIndex ? "active" : ""} onClick={() => setArmIndex(i)} key={item.id}><span>0{i + 1}</span>{item.label}</button>)}</div>
      <article className="card study-card"><div className="card-head"><Latex tex={"C_i(\\tau)=X_{i,a}(\\tau)/V_i"} /><div className="segmented"><button className={!logScale ? "active" : ""} onClick={() => setLogScale(false)}>linear</button><button className={logScale ? "active" : ""} onClick={() => setLogScale(true)}>log</button></div></div>{arm && <TrajectoryCanvas tau={study.tau} curves={arm.curves} events={arm.events} logScale={logScale} />}<div className="study-footer"><span><i className="swatch cyan" />35 individuals</span><span><i className="swatch orange" />dose event</span><span>clean · complete · τ∈[0,1]</span></div></article>
    </> : <div className="stage-empty">Generate the family.</div>}
  </section>;
}

function ControlGroup({ label, values, selected, setSelected }: { label: string; values: string[]; selected: string; setSelected: (value: string) => void }) {
  return <div className="control-group"><span>{label}</span><div>{values.map((value) => <button className={selected === value ? "active" : ""} key={value} onClick={() => setSelected(value)}>{value.replace("_", " ")}</button>)}</div></div>;
}

function ObservationStage({ study, armIndex, logScale }: { study: StudyDraw | null; armIndex: number; logScale: boolean }) {
  const [family, setFamily] = useState<AcquisitionFamily>("exact");
  const [shape, setShape] = useState<ScheduleShape>("early");
  const [count, setCount] = useState(16);
  const [meshDraw, setMeshDraw] = useState(1);
  const mesh = useMemo(() => study ? acquireMesh(study, armIndex, family, shape, count, new Rng(91821 + meshDraw * 177 + armIndex * 19)) : null, [study, armIndex, family, shape, count, meshDraw]);
  const arm = study?.arms[armIndex];
  return <section className="stage-content" id="observation">
    <StageHeader number={6} kicker="Meshes M" title="Observation mesh" caption="Thin clean 128-point bases without changing the latent curves." action="Redraw mesh" disabled={!study} onAction={() => setMeshDraw((value) => value + 1)} />
    {!study || !arm || !mesh ? <div className="stage-empty">Requires the study family.</div> : <>
      <div className="mesh-controls">
        <ControlGroup label="acquisition" values={["unscheduled", "exact", "pseudo_scheduled"]} selected={family} setSelected={(value) => setFamily(value as AcquisitionFamily)} />
        <ControlGroup label="schedule" values={["uniform", "early", "late", "clustered"]} selected={shape} setSelected={(value) => setShape(value as ScheduleShape)} />
        <label className="range-control"><span>points / individual</span><div><input type="range" min="4" max="64" step="1" value={count} onChange={(event) => setCount(Number(event.target.value))} /><b>{count}</b></div></label>
      </div>
      <article className="card study-card"><div className="card-head"><span>{family.replace("_", " ")} · {shape}</span><strong>acquired points</strong></div><TrajectoryCanvas tau={study.tau} curves={arm.curves} events={arm.events} mesh={mesh} logScale={logScale} /><div className="study-footer"><span><i className="swatch acid" />individual 01</span><span><i className="swatch orange" />8 further individuals</span><span>latent curves unchanged</span></div></article>
      <div className="mesh-notes"><span><b>Unscheduled</b> individual random base</span><span><b>Exact</b> shared lattice indices</span><span><b>Pseudo</b> jittered schedule</span></div>
    </>}
  </section>;
}

export default function SyntheticDashboard() {
  const [seed, setSeed] = useState(260902);
  const seedRef = useRef(seed);
  const [graph, setGraph] = useState<GraphDraw | null>(null);
  const [kinetics, setKinetics] = useState<KineticDraw | null>(null);
  const [protocol, setProtocol] = useState<ProtocolDraw | null>(null);
  const [cohort, setCohort] = useState<CohortDraw | null>(null);
  const [study, setStudy] = useState<StudyDraw | null>(null);
  const [armIndex, setArmIndex] = useState(0);
  const [logScale, setLogScale] = useState(true);

  const resetAfter = (stage: number) => {
    if (stage <= 1) setKinetics(null);
    if (stage <= 2) setProtocol(null);
    if (stage <= 3) setCohort(null);
    if (stage <= 4) setStudy(null);
    setArmIndex(0);
  };
  const nextSeed = (salt: number) => {
    const next = (Math.imul(seedRef.current, 1664525) + 1013904223 + salt) >>> 0;
    seedRef.current = next;
    setSeed(next);
    return next;
  };
  const drawGraph = () => { setGraph(sampleGraph(new Rng(nextSeed(0x101)))); resetAfter(1); };
  const drawKinetics = () => { if (graph) { setKinetics(sampleKinetics(graph, new Rng(nextSeed(0x202)))); resetAfter(2); } };
  const drawProtocol = () => { if (graph && kinetics) { setProtocol(sampleProtocol(graph, new Rng(nextSeed(0x303)))); resetAfter(3); } };
  const drawCohort = () => { if (graph && kinetics && protocol) { setCohort(sampleCohort(graph, kinetics, new Rng(nextSeed(0x404)))); resetAfter(4); } };
  const drawStudy = () => { if (graph && kinetics && protocol && cohort) setStudy(generateStudy(graph, kinetics, protocol, cohort, new Rng(nextSeed(0x505)))); };
  const newStudy = () => {
    nextSeed(0x606);
    setGraph(null); setKinetics(null); setProtocol(null); setCohort(null); setStudy(null); setArmIndex(0);
  };

  return <main>
    <header className="masthead"><div><span className="eyebrow">PFF · synthetic priors</span><h1>Build a dimensionless PK study.</h1></div><div className="version"><span>V6</span><b>seed {seed}</b><button onClick={newStudy}>New draw</button></div></header>
    <div className="definition-bar"><Latex tex={"\\mathcal S=(G,\\theta,\\Pi,I_1,\\ldots,I_{35},M)"} block /><span>Draw each stage in order.</span></div>
    <div className="stage-stack">
      <TopologyStage graph={graph} onDraw={drawGraph} />
      <KineticsStage graph={graph} kinetics={kinetics} onDraw={drawKinetics} />
      <ProtocolStage protocol={protocol} enabled={Boolean(kinetics)} onDraw={drawProtocol} />
      <PopulationStage cohort={cohort} enabled={Boolean(protocol)} onDraw={drawCohort} />
      <StudyStage study={study} enabled={Boolean(cohort)} armIndex={armIndex} setArmIndex={setArmIndex} logScale={logScale} setLogScale={setLogScale} onDraw={drawStudy} />
      <ObservationStage study={study} armIndex={armIndex} logScale={logScale} />
    </div>
    <footer><span><Latex tex={"\\tau\\in[0,1]"} /> normalized study time</span><span><Latex tex={"X_a"} /> compartment amount</span><span><Latex tex={"C=X_a/V"} /> dimensionless concentration</span><span>no assay noise · no masking</span></footer>
  </main>;
}
