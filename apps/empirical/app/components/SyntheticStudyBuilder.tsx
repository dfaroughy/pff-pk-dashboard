import { useMemo, useState } from "react";
import katex from "katex";
import type { Study } from "../lib/types";
import {
  SYNTHETIC_LIMITS,
  generateSyntheticCohort,
  sampleSyntheticModel,
  withDoseCount,
  type SyntheticModelDraw,
} from "../lib/synthetic-study";
import type { DoseEvent, GraphDraw, RateDraw } from "../../../synthetic/app/lib/prior";

function Latex({ tex, block = false }: { tex: string; block?: boolean }) {
  return <span
    className={block ? "synthetic-latex block" : "synthetic-latex"}
    dangerouslySetInnerHTML={{
      __html: katex.renderToString(tex, { displayMode: block, throwOnError: false, strict: false }),
    }}
  />;
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
        <text className="synthetic-node-index" y="1.6">{label}</text>
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

function KineticTable({ rates }: { rates: RateDraw[] }) {
  return <div className="synthetic-table-wrap"><table className="synthetic-parameter-table">
    <thead><tr><th>Flux</th><th>Law</th><th>κ</th><th>β</th><th>h</th><th>Variation</th></tr></thead>
    <tbody>{rates.map((rate) => {
      const dst = rate.dst === null ? "∅" : compartmentSymbol(rate.dst);
      return <tr key={rate.id}>
        <td>J<sub>{compartmentSymbol(rate.src)}{dst}</sub></td>
        <td>{rate.beta === null ? "linear" : "saturable"}</td>
        <td>{rate.kappa.toPrecision(3)}</td>
        <td>{rate.beta === null ? "—" : rate.beta.toPrecision(3)}</td>
        <td>{rate.beta === null ? "—" : rate.hill.toPrecision(3)}</td>
        <td>{rate.timeVarying ? `ν=${rate.nu}; ℓ=${rate.ell?.toFixed(2)}` : "constant"}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

function DoseTimeline({ events }: { events: DoseEvent[] }) {
  const left = 40;
  const right = 570;
  const axisY = 62;
  const x = (time: number) => left + Math.max(0, Math.min(1, time)) * (right - left);
  return <svg className="synthetic-dose-timeline" viewBox="0 0 610 105" role="img" aria-label="Dimensionless dose protocol timeline">
    <defs>
      <marker id="timeline-arrow" markerWidth="7" markerHeight="7" refX="3.5" refY="6" orient="auto"><path d="M0,0 L7,0 L3.5,7 Z" /></marker>
    </defs>
    <line className="timeline-axis" x1={left} y1={axisY} x2={right} y2={axisY} />
    {[0, 0.25, 0.5, 0.75, 1].map((time) => <g key={time}>
      <line className="timeline-tick" x1={x(time)} y1={axisY - 4} x2={x(time)} y2={axisY + 5} />
      <text className="timeline-label" x={x(time)} y={axisY + 19}>{time.toFixed(2)}</text>
    </g>)}
    <text className="timeline-axis-title" x={right} y={axisY + 34}>dimensionless time τ</text>
    {events.map((event, index) => {
      const start = x(event.time);
      if (event.duration > 0) {
        const width = Math.max(5, x(event.time + event.duration) - start);
        return <g key={`${event.time}-${index}`}>
          <rect className="timeline-infusion" x={start} y={25} width={width} height={axisY - 25} />
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

export function SyntheticStudyBuilder({ onGenerate, onClear }: {
  onGenerate: (study: Study) => void;
  onClear: () => void;
}) {
  const [modelIndex, setModelIndex] = useState(0);
  const [model, setModel] = useState<SyntheticModelDraw>(() => sampleSyntheticModel(43));
  const [doseCount, setDoseCount] = useState(1);
  const [individuals, setIndividuals] = useState(SYNTHETIC_LIMITS.individuals.default);
  const [observations, setObservations] = useState(SYNTHETIC_LIMITS.observations.default);
  const activeModel = useMemo(() => withDoseCount(model, doseCount), [doseCount, model]);
  const equations = useMemo(() => model.graph.nodes.map((node) => balanceEquation(model.graph, node.id)), [model.graph]);
  const uniqueRateForms = useMemo(() => {
    const representatives = new Map<string, RateDraw>();
    model.kinetics.rates.forEach((rate) => representatives.set(rate.beta === null ? "linear" : "saturable", rate));
    return [...representatives.values()];
  }, [model.kinetics.rates]);

  const drawModel = () => {
    const nextIndex = modelIndex + 1;
    setModelIndex(nextIndex);
    setModel(sampleSyntheticModel(43 + nextIndex));
    onClear();
  };
  const generate = () => onGenerate(generateSyntheticCohort(activeModel, individuals, observations));
  const changeIndividuals = (value: number) => {
    setIndividuals(Math.max(SYNTHETIC_LIMITS.individuals.min, Math.min(SYNTHETIC_LIMITS.individuals.max, value)));
    onClear();
  };
  const changeObservations = (value: number) => {
    setObservations(Math.max(SYNTHETIC_LIMITS.observations.min, Math.min(SYNTHETIC_LIMITS.observations.max, value)));
    onClear();
  };

  return <article className="card synthetic-builder">
    <div className="section-heading synthetic-builder-heading">
      <div><p className="synthetic-kicker">Interactive prior draw · seed {model.seed}</p><h2>Compartment model</h2></div>
      <button className="secondary-button synthetic-redraw" type="button" onClick={drawModel}>Draw another model</button>
    </div>
    <div className="synthetic-model-grid">
      <div className="synthetic-graph-panel">
        <CompartmentGraph graph={model.graph} />
        <dl className="synthetic-facts">
          <div><dt>Route</dt><dd>{model.graph.route}</dd></div>
          <div><dt>Compartments</dt><dd>{model.graph.nodes.length}</dd></div>
          <div><dt>Fluxes</dt><dd>{model.kinetics.rates.length}</dd></div>
          <div><dt>Protocol</dt><dd>{activeModel.protocol.pattern}</dd></div>
        </dl>
      </div>
      <div className="synthetic-equations">
        <h3>Mass balances</h3>
        <div className="synthetic-equation-list">{equations.map((equation) => <Latex key={equation} tex={equation} block />)}</div>
        <h3>Sampled flux laws</h3>
        <div className="synthetic-equation-list compact">{uniqueRateForms.map((rate) => <Latex key={rate.id} tex={equationForRate(rate)} block />)}</div>
        <p><i>X</i><sub>a</sub> is the amount in compartment a; τ is dimensionless time; J<sub>ab</sub> is flux from a to b; κ is a rate ratio; β and h control saturation; and r(τ) is a positive time-varying rate modulation.</p>
      </div>
    </div>
    <div className="synthetic-parameter-section">
      <h3>Sampled kinetic parameters</h3>
      <KineticTable rates={model.kinetics.rates} />
    </div>
    <div className="synthetic-protocol">
      <div className="synthetic-protocol-heading">
        <h3>Dose protocol</h3>
        <label>Schedule
          <select value={doseCount} onChange={(event) => { setDoseCount(Number(event.target.value)); onClear(); }}>
            <option value={1}>Single dose</option>
            <option value={2}>Multiple doses · 2</option>
            <option value={3}>Multiple doses · 3</option>
            <option value={4}>Multiple doses · 4</option>
          </select>
        </label>
      </div>
      <DoseTimeline events={activeModel.protocol.events} />
      <div className="synthetic-event-list">{activeModel.protocol.events.map((event, index) => <span key={`${event.time}-${index}`}><b>{event.amount.toFixed(2)}×</b> at τ={event.time.toFixed(2)}{event.duration > 0 ? ` · infusion Δτ=${event.duration.toFixed(2)}` : " · bolus"}</span>)}</div>
    </div>
    <div className="synthetic-generate-controls">
      <label>Individuals
        <input type="number" min={SYNTHETIC_LIMITS.individuals.min} max={SYNTHETIC_LIMITS.individuals.max} step="1" value={individuals} onChange={(event) => changeIndividuals(Number(event.target.value))} />
        <small>2–16</small>
      </label>
      <label>Observations per individual
        <input type="number" min={SYNTHETIC_LIMITS.observations.min} max={SYNTHETIC_LIMITS.observations.max} step="1" value={observations} onChange={(event) => changeObservations(Number(event.target.value))} />
        <small>2–20</small>
      </label>
      <button className="primary-button" type="button" onClick={generate}>Generate synthetic data</button>
    </div>
  </article>;
}
