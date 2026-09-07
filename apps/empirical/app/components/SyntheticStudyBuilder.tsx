import { useMemo, useRef, useState, type ReactNode } from "react";
import katex from "katex";
import type { Study } from "../lib/types";
import {
  SYNTHETIC_INITIAL_ACQUISITION,
  SYNTHETIC_INITIAL_SEED,
  SYNTHETIC_LIMITS,
  generateSyntheticCohort,
  previewSyntheticObservationTimes,
  sampleSyntheticModel,
  type SyntheticAcquisition,
  type SyntheticModelDraw,
} from "../lib/synthetic-study";
import type { DoseEvent, GraphDraw, RateDraw } from "../../../synthetic/app/lib/prior";

function initialDose(route: GraphDraw["route"]): DoseEvent {
  return { time: 0, amount: 1, duration: 0, route };
}

function Latex({ tex, block = false }: { tex: string; block?: boolean }) {
  return <span
    className={block ? "synthetic-latex block" : "synthetic-latex"}
    dangerouslySetInnerHTML={{
      __html: katex.renderToString(tex, { displayMode: block, throwOnError: false, strict: false }),
    }}
  />;
}

function CollapsibleSection({ title, open, onToggle, children }: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return <section className={open ? "synthetic-accordion open" : "synthetic-accordion"}>
    <h3><button type="button" aria-expanded={open} onClick={onToggle}><span>{title}</span><i aria-hidden="true">{open ? "−" : "+"}</i></button></h3>
    {open && <div className="synthetic-accordion-content">{children}</div>}
  </section>;
}

function compartmentSymbol(id: number) {
  return String.fromCharCode(97 + id);
}

function nodePosition(graph: GraphDraw, id: number) {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node) return { x: 50, y: 50 };
  const peers = graph.nodes.filter((candidate) => candidate.role === node.role);
  const index = peers.findIndex((candidate) => candidate.id === id);
  if (node.role === "central") return { x: 54, y: 48 };
  if (node.role === "peripheral") {
    const offsets = peers.length === 1 ? [0] : peers.map((_, i) => -24 + 48 * i / (peers.length - 1));
    return { x: 82, y: 48 + offsets[index] };
  }
  if (node.role === "bile") return { x: 51, y: 14 };
  const oral = graph.nodes.filter((candidate) => ["transit", "gut"].includes(candidate.role));
  if (["transit", "gut"].includes(node.role)) {
    const oralIndex = oral.findIndex((candidate) => candidate.id === id);
    return { x: 8 + 36 * oralIndex / Math.max(1, oral.length - 1), y: 35 };
  }
  const depot = graph.nodes.filter((candidate) => ["depot_transit", "depot"].includes(candidate.role));
  const depotIndex = depot.findIndex((candidate) => candidate.id === id);
  return { x: 8 + 36 * depotIndex / Math.max(1, depot.length - 1), y: 72 };
}

function CompartmentGraph({ graph }: { graph: GraphDraw }) {
  const reversePairs = new Set(graph.edges
    .filter((edge) => graph.edges.some((candidate) => candidate.src === edge.dst && candidate.dst === edge.src))
    .map((edge) => `${Math.min(edge.src, edge.dst)}-${Math.max(edge.src, edge.dst)}`));
  return <svg className="synthetic-graph" viewBox="0 0 100 100" role="img" aria-label="Sampled compartment model graph">
    <defs>
      <marker id="synthetic-arrow" markerWidth="5" markerHeight="5" refX="4.5" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" /></marker>
    </defs>
    {graph.edges.map((edge) => {
      const from = nodePosition(graph, edge.src);
      const to = nodePosition(graph, edge.dst);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      const inset = 7;
      const start = { x: from.x + dx / length * inset, y: from.y + dy / length * inset };
      const end = { x: to.x - dx / length * inset, y: to.y - dy / length * inset };
      const paired = reversePairs.has(`${Math.min(edge.src, edge.dst)}-${Math.max(edge.src, edge.dst)}`);
      const offset = paired ? (edge.src < edge.dst ? 2.2 : -2.2) : 0;
      const ox = -dy / length * offset;
      const oy = dx / length * offset;
      return <g key={edge.id}>
        <line className="synthetic-edge" x1={start.x + ox} y1={start.y + oy} x2={end.x + ox} y2={end.y + oy} markerEnd="url(#synthetic-arrow)" />
        <text className="synthetic-flux-label" x={(start.x + end.x) / 2 + ox} y={(start.y + end.y) / 2 + oy - 1.2}>J{compartmentSymbol(edge.src)}{compartmentSymbol(edge.dst)}</text>
      </g>;
    })}
    {graph.elimNodes.map((id, index) => {
      const from = nodePosition(graph, id);
      const to = { x: 94, y: 88 - index * 5 };
      return <g key={`elim-${id}`}>
        <line className="synthetic-edge elimination" x1={from.x + 4} y1={from.y + 4} x2={to.x} y2={to.y} markerEnd="url(#synthetic-arrow)" />
        <text className="synthetic-flux-label" x={(from.x + to.x) / 2} y={(from.y + to.y) / 2}>J{compartmentSymbol(id)}∅</text>
      </g>;
    })}
    {graph.nodes.map((node) => {
      const position = nodePosition(graph, node.id);
      const label = compartmentSymbol(node.id);
      return <g key={node.id} transform={`translate(${position.x} ${position.y})`}>
        <circle className={node.id === graph.central ? "synthetic-node central" : "synthetic-node"} r="6" />
        <text className={node.id === graph.central ? "synthetic-node-index central" : "synthetic-node-index"} y="1.6">{label}</text>
        <text className="synthetic-node-role" y="10">{node.role.replace("_", " ")}</text>
      </g>;
    })}
    {Object.entries(graph.doseMap).map(([id, fraction], index) => {
      const position = nodePosition(graph, Number(id));
      return <g key={`dose-${id}`}>
        <line className="synthetic-dose-arrow" x1={position.x} y1={Math.max(1, position.y - 18 - index * 3)} x2={position.x} y2={position.y - 7} markerEnd="url(#synthetic-arrow)" />
        <text className="synthetic-dose-label" x={position.x} y={Math.max(3, position.y - 20 - index * 3)}>{Math.round(fraction * 100)}% dose</text>
      </g>;
    })}
  </svg>;
}

export function balanceEquation(graph: GraphDraw, nodeId: number) {
  const symbol = compartmentSymbol(nodeId);
  const incoming = graph.edges.filter((edge) => edge.dst === nodeId).map((edge) => `J_{${compartmentSymbol(edge.src)}${symbol}}`);
  const outgoing = graph.edges.filter((edge) => edge.src === nodeId).map((edge) => `J_{${symbol}${compartmentSymbol(edge.dst)}}`);
  if (graph.elimNodes.includes(nodeId)) outgoing.push(`J_{${symbol}\\emptyset}`);
  const terms = [
    ...incoming.map((term) => ({ sign: 1, term })),
    ...outgoing.map((term) => ({ sign: -1, term })),
    ...(Object.hasOwn(graph.doseMap, nodeId) ? [{ sign: 1, term: `u_${symbol}(\\tau)` }] : []),
  ];
  const expression = terms.map(({ sign, term }, index) => `${sign < 0 ? "-" : index > 0 ? "+" : ""}${term}`).join("");
  return `\\frac{\\mathrm d X_${symbol}}{\\mathrm d\\tau}=${expression || "0"}`;
}

function equationForRate(rate: RateDraw) {
  const src = compartmentSymbol(rate.src);
  const dst = rate.dst === null ? "\\emptyset" : compartmentSymbol(rate.dst);
  const label = `${src}${dst}`;
  if (rate.beta !== null) {
    return `J_{${label}}=\\kappa_{${label}}\\,r_{${label}}(\\tau)\\,\\frac{\\beta_{${label}}X_${src}^{h_{${label}}}}{\\beta_{${label}}^{h_{${label}}}+X_${src}^{h_{${label}}}}`;
  }
  return `J_{${label}}=\\kappa_{${label}}\\,r_{${label}}(\\tau)\\,X_${src}`;
}

function connectionType(graph: GraphDraw, rate: RateDraw) {
  const source = graph.nodes.find((node) => node.id === rate.src)?.role.replace("_", " ") ?? "compartment";
  const target = rate.dst === null
    ? "elimination"
    : graph.nodes.find((node) => node.id === rate.dst)?.role.replace("_", " ") ?? "compartment";
  return `${source} → ${target}`;
}

function ParameterInput({ label, value, min, max, disabled = false, onCommit }: {
  label: string;
  value: number | null;
  min: number;
  max?: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const formatted = value === null ? "" : String(Number(value.toPrecision(5)));
  const [draft, setDraft] = useState<string | null>(null);
  const displayed = draft ?? formatted;
  const commit = () => {
    const parsed = Number(displayed);
    if (displayed.trim() && Number.isFinite(parsed) && parsed >= min) onCommit(parsed);
    setDraft(null);
  };
  return <input
    aria-label={label}
    type="number"
    min={min}
    max={max}
    step="any"
    disabled={disabled}
    value={displayed}
    onFocus={() => setDraft(formatted)}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={commit}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
  />;
}

function KineticTable({ graph, rates, onChange }: {
  graph: GraphDraw;
  rates: RateDraw[];
  onChange: (id: string, patch: Partial<RateDraw>) => void;
}) {
  return <div className="synthetic-table-wrap"><table className="synthetic-parameter-table">
    <thead><tr><th>Flux</th><th>Type</th><th>Law</th><th>κ</th><th>β</th><th>h</th><th>Variation</th></tr></thead>
    <tbody>{rates.map((rate) => {
      const dst = rate.dst === null ? "∅" : compartmentSymbol(rate.dst);
      const flux = `J${compartmentSymbol(rate.src)}${dst}`;
      return <tr key={rate.id}>
        <td>J<sub>{compartmentSymbol(rate.src)}{dst}</sub></td>
        <td className="connection-type">{connectionType(graph, rate)}</td>
        <td><select aria-label={`${flux} law`} value={rate.beta === null ? "linear" : "saturable"} onChange={(event) => onChange(rate.id, event.target.value === "linear" ? { beta: null } : { beta: rate.beta ?? 1, hill: rate.hill || 1 })}>
          <option value="linear">Linear</option>
          <option value="saturable">Saturable</option>
        </select></td>
        <td><ParameterInput label={`${flux} kappa`} value={rate.kappa} min={0.0001} onCommit={(value) => onChange(rate.id, { kappa: value })} /></td>
        <td><ParameterInput label={`${flux} beta`} value={rate.beta} min={0.0001} disabled={rate.beta === null} onCommit={(value) => onChange(rate.id, { beta: value })} /></td>
        <td><ParameterInput label={`${flux} Hill exponent`} value={rate.beta === null ? null : rate.hill} min={0.1} disabled={rate.beta === null} onCommit={(value) => onChange(rate.id, { hill: value })} /></td>
        <td>{rate.timeVarying ? `ν=${rate.nu}; ℓ=${rate.ell?.toFixed(2)}` : "constant"}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

function DoseTimeline({ events, observationTimes }: { events: DoseEvent[]; observationTimes: number[][] }) {
  const left = 40;
  const right = 570;
  const axisY = 55;
  const x = (time: number) => left + Math.max(0, Math.min(1, time)) * (right - left);
  return <svg className="synthetic-dose-timeline" viewBox="0 0 610 125" role="img" aria-label="Dimensionless dose and observation schedule timeline">
    <defs>
      <marker id="timeline-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" /></marker>
    </defs>
    <line className="timeline-axis" x1={left} y1={axisY} x2={right} y2={axisY} />
    {[0, 0.25, 0.5, 0.75, 1].map((time) => <g key={time}>
      <line className="timeline-tick" x1={x(time)} y1={axisY - 4} x2={x(time)} y2={axisY + 5} />
      <text className="timeline-label" x={x(time)} y={105}>{time.toFixed(2)}</text>
    </g>)}
    <text className="timeline-observation-title" x={left} y={71}>observations</text>
    {observationTimes.map((times, person) => <g key={`person-${person}`}>
      {times.map((time, index) => <circle className="timeline-observation" key={`${time}-${index}`} cx={x(time)} cy={73 + person * 2.8} r="1.15" />)}
    </g>)}
    <text className="timeline-axis-title" x={right} y={120}>dimensionless time τ</text>
    {events.map((event, index) => {
      const start = x(event.time);
      if (event.duration > 0) {
        const width = Math.max(5, x(event.time + event.duration) - start);
        return <g key={`${event.time}-${index}`}>
          <rect className="timeline-infusion" x={start} y={24} width={width} height={axisY - 24} />
          <text className="timeline-event-label" x={start + width / 2} y={18}>{event.amount.toFixed(2)}×</text>
        </g>;
      }
      return <g key={`${event.time}-${index}`}>
        <line className="timeline-bolus" x1={start} y1={22} x2={start} y2={axisY - 7} markerEnd="url(#timeline-arrow)" />
        <text className="timeline-event-label" x={start} y={15}>{event.amount.toFixed(2)}×</text>
      </g>;
    })}
  </svg>;
}

export function SyntheticStudyBuilder({ onGenerate, onInvalidate }: {
  onGenerate: (study: Study) => void;
  onInvalidate: () => void;
}) {
  const [model, setModel] = useState<SyntheticModelDraw>(() => sampleSyntheticModel(SYNTHETIC_INITIAL_SEED));
  const [generationSeed, setGenerationSeed] = useState(SYNTHETIC_INITIAL_SEED);
  const [manualSeed, setManualSeed] = useState(false);
  const editedLatentModel = useRef(false);
  const [doseEvents, setDoseEvents] = useState<DoseEvent[]>(() => [initialDose(model.graph.route)]);
  const [acquisition, setAcquisition] = useState<SyntheticAcquisition>(SYNTHETIC_INITIAL_ACQUISITION);
  const [gridDraw, setGridDraw] = useState(0);
  const [openSections, setOpenSections] = useState({ graph: true, kinetics: false, protocol: false });
  const [individuals, setIndividuals] = useState(SYNTHETIC_LIMITS.individuals.default);
  const [observations, setObservations] = useState(SYNTHETIC_LIMITS.observations.default);
  const activeModel = useMemo(() => ({
    ...model,
    protocol: {
      ...model.protocol,
      events: doseEvents.map((event) => ({ ...event, route: model.graph.route })),
      multidose: doseEvents.length > 1,
      infusion: doseEvents.some((event) => event.duration > 0),
      pattern: doseEvents.length > 1 ? "maintenance" as const : "single" as const,
      rawProtocolHorizon: 1,
    },
  }), [doseEvents, model]);
  const observationPreview = useMemo(() => previewSyntheticObservationTimes(
    model.seed,
    Math.min(individuals, 8),
    observations,
    acquisition,
    gridDraw,
  ), [acquisition, gridDraw, individuals, model.seed, observations]);
  const equations = useMemo(() => model.graph.nodes.map((node) => balanceEquation(model.graph, node.id)), [model.graph]);

  const randomSeed = () => {
    const upper = 2 ** 31 - 1;
    const draw = Math.floor(Math.random() * upper);
    return draw === generationSeed ? (draw + 1) % upper : draw;
  };
  const drawModel = () => {
    const nextSeed = randomSeed();
    const nextModel = sampleSyntheticModel(nextSeed);
    const nextEvents = doseEvents.map((event) => ({ ...event, route: nextModel.graph.route }));
    setGenerationSeed(nextSeed);
    setManualSeed(false);
    editedLatentModel.current = true;
    setModel(nextModel);
    setDoseEvents(nextEvents);
    setGridDraw(0);
    onGenerate(generateSyntheticCohort({
      ...nextModel,
      protocol: {
        ...nextModel.protocol,
        events: nextEvents,
        multidose: nextEvents.length > 1,
        infusion: nextEvents.some((event) => event.duration > 0),
        pattern: nextEvents.length > 1 ? "maintenance" : "single",
        rawProtocolHorizon: 1,
      },
    }, individuals, observations, acquisition, 0));
  };
  const generate = () => {
    let nextModel = activeModel;
    if (!editedLatentModel.current) {
      const nextSeed = manualSeed ? generationSeed : randomSeed();
      const sampled = sampleSyntheticModel(nextSeed);
      const nextEvents = doseEvents.map((event) => ({ ...event, route: sampled.graph.route }));
      nextModel = {
        ...sampled,
        protocol: {
          ...sampled.protocol,
          events: nextEvents,
          multidose: nextEvents.length > 1,
          infusion: nextEvents.some((event) => event.duration > 0),
          pattern: nextEvents.length > 1 ? "maintenance" : "single",
          rawProtocolHorizon: 1,
        },
      };
      setGenerationSeed(nextSeed);
      setModel(sampled);
      setDoseEvents(nextEvents);
      setGridDraw(0);
    }
    setManualSeed(false);
    const preserveCurrentGrid = editedLatentModel.current;
    editedLatentModel.current = false;
    onGenerate(generateSyntheticCohort(nextModel, individuals, observations, acquisition, preserveCurrentGrid ? gridDraw : 0));
  };
  const changeRate = (id: string, patch: Partial<RateDraw>) => {
    const rates = model.kinetics.rates.map((rate) => rate.id === id ? { ...rate, ...patch } : rate);
    const nextModel = {
      ...model,
      kinetics: {
        ...model.kinetics,
        rates,
        saturableCount: rates.filter((rate) => rate.beta !== null).length,
      },
    };
    const nextActiveModel = {
      ...nextModel,
      protocol: activeModel.protocol,
    };
    setModel(nextModel);
    setManualSeed(false);
    setGenerationSeed(nextModel.seed);
    editedLatentModel.current = true;
    onGenerate(generateSyntheticCohort(nextActiveModel, individuals, observations, acquisition, gridDraw));
  };
  const changeAcquisition = (patch: Partial<SyntheticAcquisition>) => {
    setAcquisition((current) => ({ ...current, ...patch }));
    setGridDraw(0);
    onInvalidate();
  };
  const changeDose = (index: number, field: "time" | "amount" | "duration", value: number) => {
    setDoseEvents((current) => current.map((event, eventIndex) => {
      if (eventIndex !== index) return event;
      if (field === "amount") return { ...event, amount: Math.max(0.001, value) };
      if (field === "duration") return { ...event, duration: Math.max(0, Math.min(1 - event.time, value)) };
      const time = index === 0 ? 0 : Math.max(0, Math.min(1, value));
      return { ...event, time, duration: Math.min(event.duration, 1 - time) };
    }));
    onInvalidate();
  };
  const addDose = () => {
    setDoseEvents((current) => [...current, {
      time: 1 - 0.5 ** current.length,
      amount: 1,
      duration: 0,
      route: model.graph.route,
    }]);
    onInvalidate();
  };
  const removeDose = (index: number) => {
    if (index === 0) return;
    setDoseEvents((current) => current.filter((_, eventIndex) => eventIndex !== index));
    onInvalidate();
  };
  const resetDoses = () => {
    setDoseEvents([initialDose(model.graph.route)]);
    onInvalidate();
  };
  const resampleGrid = () => {
    setGridDraw((current) => current + 1);
    onInvalidate();
  };
  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  };
  const changeIndividuals = (value: number) => {
    setIndividuals(Math.max(SYNTHETIC_LIMITS.individuals.min, Math.min(SYNTHETIC_LIMITS.individuals.max, value)));
    onInvalidate();
  };
  const changeObservations = (value: number) => {
    setObservations(Math.max(SYNTHETIC_LIMITS.observations.min, Math.min(SYNTHETIC_LIMITS.observations.max, value)));
    onInvalidate();
  };

  return <article className="card synthetic-builder">
    <div className="section-heading synthetic-builder-heading">
      <h2>Synthetic cohort model</h2>
    </div>
    <div className="synthetic-generate-controls">
      <label>Individuals
        <input aria-label="Cohort individuals" type="number" min={SYNTHETIC_LIMITS.individuals.min} max={SYNTHETIC_LIMITS.individuals.max} step="1" value={individuals} onChange={(event) => changeIndividuals(Number(event.target.value))} />
        <small>2–16</small>
      </label>
      <label>Observations per individual
        <input type="number" min={SYNTHETIC_LIMITS.observations.min} max={SYNTHETIC_LIMITS.observations.max} step="1" value={observations} onChange={(event) => changeObservations(Number(event.target.value))} />
        <small>2–20</small>
      </label>
      <label>Cohort seed
        <input aria-label="Cohort seed" type="number" min="0" max={2 ** 31 - 1} step="1" value={generationSeed} onChange={(event) => {
          const value = Number(event.target.value);
          if (!Number.isFinite(value)) return;
          setGenerationSeed(Math.max(0, Math.min(2 ** 31 - 1, Math.round(value))));
          setManualSeed(true);
          editedLatentModel.current = false;
          onInvalidate();
        }} />
        <small>Random unless edited</small>
      </label>
      <button className="primary-button" type="button" onClick={generate}>Generate new cohort</button>
    </div>
    <div className="synthetic-accordion-stack">
      <CollapsibleSection title="Compartment graph" open={openSections.graph} onToggle={() => toggleSection("graph")}>
        <div className="synthetic-model-grid">
          <div className="synthetic-graph-panel">
            <CompartmentGraph graph={model.graph} />
            <dl className="synthetic-facts">
              <div><dt>Route</dt><dd>{model.graph.route}</dd></div>
              <div><dt>Compartments</dt><dd>{model.graph.nodes.length}</dd></div>
              <div><dt>Fluxes</dt><dd>{model.kinetics.rates.length}</dd></div>
              <div><dt>Protocol</dt><dd>{activeModel.protocol.pattern}</dd></div>
            </dl>
            <div className="synthetic-graph-actions"><button className="draw-model-button" type="button" onClick={drawModel}>Draw new compartment model</button></div>
          </div>
          <div className="synthetic-equations">
            <h3>Mass balances</h3>
            <div className="synthetic-equation-list">{equations.map((equation) => <Latex key={equation} tex={equation} block />)}</div>
            <h3>Flux laws</h3>
            <div className="synthetic-equation-list compact">{model.kinetics.rates.map((rate) => <Latex key={rate.id} tex={equationForRate(rate)} block />)}</div>
            <p><i>X</i><sub>a</sub> is the amount in compartment a; τ is dimensionless time; J<sub>ab</sub> is flux from a to b; κ is a rate ratio; β and h control saturation; and r(τ) is a positive time-varying rate modulation.</p>
          </div>
        </div>
      </CollapsibleSection>
      <CollapsibleSection title="Kinetic parameters" open={openSections.kinetics} onToggle={() => toggleSection("kinetics")}>
        <KineticTable graph={model.graph} rates={model.kinetics.rates} onChange={changeRate} />
      </CollapsibleSection>
      <CollapsibleSection title="Dose and observation protocol" open={openSections.protocol} onToggle={() => toggleSection("protocol")}>
        <div className="synthetic-protocol-heading">
          <div className="synthetic-schedule-controls"><label>Observation schedule
            <select value={acquisition.family} onChange={(event) => changeAcquisition({ family: event.target.value as SyntheticAcquisition["family"] })}>
              <option value="exact">Exact scheduled</option>
              <option value="pseudo_scheduled">Pseudo-scheduled</option>
              <option value="unscheduled">Unscheduled</option>
            </select>
          </label>
          <label>Time weighting
            <select value={acquisition.shape} onChange={(event) => changeAcquisition({ shape: event.target.value as SyntheticAcquisition["shape"] })}>
              <option value="uniform">Uniform</option>
              <option value="early">Early weighted</option>
              <option value="late">Late weighted</option>
              <option value="clustered">Clustered</option>
            </select>
          </label>
          <button className="secondary-button grid-resample" type="button" onClick={resampleGrid}>Resample observation grid</button></div>
        </div>
        <DoseTimeline events={activeModel.protocol.events} observationTimes={observationPreview.times} />
        <div className="synthetic-dose-editor">{activeModel.protocol.events.map((event, index) => <div className="synthetic-dose-row" key={`dose-${index}`}>
          <span>Dose {index + 1}</span>
          <span className="synthetic-dose-input">Time τ <ParameterInput label={`Dose ${index + 1} time`} value={event.time} min={0} max={1} disabled={index === 0} onCommit={(value) => changeDose(index, "time", value)} /></span>
          <span className="synthetic-dose-input">Dose d <ParameterInput label={`Dose ${index + 1} relative amount`} value={event.amount} min={0.001} onCommit={(value) => changeDose(index, "amount", value)} /></span>
          <span className="synthetic-dose-input">Duration Δτ <ParameterInput label={`Dose ${index + 1} duration`} value={event.duration} min={0} max={1 - event.time} onCommit={(value) => changeDose(index, "duration", value)} /></span>
          <span className="synthetic-dose-kind">{event.duration > 0 ? "infusion" : "bolus"}</span>
          <button className="icon-button" type="button" aria-label={`Remove dose ${index + 1}`} disabled={index === 0} onClick={() => removeDose(index)}>×</button>
        </div>)}</div>
        <div className="synthetic-dose-actions"><button className="secondary-button" type="button" onClick={addDose}>+ Add dose</button><button className="secondary-button quiet" type="button" onClick={resetDoses}>Reset protocol</button></div>
      </CollapsibleSection>
    </div>
  </article>;
}
