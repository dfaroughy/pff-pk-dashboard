import { useId, useState, type ReactNode } from "react";
import katex from "katex";
import type { GraphDraw, DoseEvent } from "../lib/synthetic-study";

export function Latex({
  tex,
  block = false,
}: {
  tex: string;
  block?: boolean;
}) {
  return (
    <span
      className={block ? "synthetic-latex block" : "synthetic-latex"}
      dangerouslySetInnerHTML={{
        __html: katex.renderToString(tex, {
          displayMode: block,
          throwOnError: false,
          strict: false,
        }),
      }}
    />
  );
}

export function CollapsibleSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className={open ? "synthetic-accordion open" : "synthetic-accordion"}
    >
      <h3>
        <button type="button" aria-expanded={open} onClick={onToggle}>
          <span>{title}</span>
          <i aria-hidden="true">{open ? "−" : "+"}</i>
        </button>
      </h3>
      {open && <div className="synthetic-accordion-content">{children}</div>}
    </section>
  );
}

function compartmentSymbol(id: number) {
  return String.fromCharCode(97 + id);
}

export function nodePosition(graph: GraphDraw, id: number) {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node) return { x: 50, y: 50 };
  const peers = graph.nodes.filter((candidate) => candidate.role === node.role);
  const index = peers.findIndex((candidate) => candidate.id === id);
  const chainLength = Math.max(
    1,
    graph.nodes.filter((n) => ["transit", "gut"].includes(n.role)).length,
    graph.nodes.filter((n) => ["depot_transit", "depot"].includes(n.role))
      .length,
  );
  const centralX = 20 + chainLength * 26;
  if (node.role === "central") return { x: centralX, y: 52 };
  if (node.role === "peripheral") {
    return { x: centralX + 36, y: 30 + index * 30 };
  }
  if (node.role === "bile") return { x: centralX, y: 16 };
  const oral = graph.nodes.filter((candidate) =>
    ["transit", "gut"].includes(candidate.role),
  );
  if (["transit", "gut"].includes(node.role)) {
    const oralIndex = oral.findIndex((candidate) => candidate.id === id);
    return { x: 20 + 26 * oralIndex, y: 35 };
  }
  const depot = graph.nodes.filter((candidate) =>
    ["depot_transit", "depot"].includes(candidate.role),
  );
  const depotIndex = depot.findIndex((candidate) => candidate.id === id);
  return { x: 20 + 26 * depotIndex, y: 80 };
}

/** Choose a short outward ray with clearance from nodes, labels and dose arrows. */
export function eliminationArrow(graph: GraphDraw, id: number, width: number, height: number) {
  const origin = nodePosition(graph, id);
  const obstacles = graph.nodes.flatMap(node => {
    const p = nodePosition(graph, node.id);
    return [
      ...(node.id === id ? [] : [{ x: p.x, y: p.y, radius: 7 }]),
      { x: p.x, y: p.y + 10, radius: 6 },
      ...(Object.hasOwn(graph.doseMap, node.id) ? [{ x: p.x, y: p.y - 14, radius: 4 }] : []),
    ];
  });
  let bestScore = -Infinity;
  let best = { from: { x: origin.x + 7, y: origin.y }, to: { x: origin.x + 24, y: origin.y } };
  for (let i = 0; i < 64; i++) {
    const angle = i * Math.PI * 2 / 64;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const from = { x: origin.x + 7 * dx, y: origin.y + 7 * dy };
    const to = { x: origin.x + 24 * dx, y: origin.y + 24 * dy };
    if (to.x < 4 || to.x > width - 4 || to.y < 4 || to.y > height - 4) continue;
    let clearance = Infinity;
    for (let radius = 7; radius <= 24; radius++) {
      for (const obstacle of obstacles) {
        clearance = Math.min(clearance, Math.hypot(origin.x + radius * dx - obstacle.x, origin.y + radius * dy - obstacle.y) - obstacle.radius);
      }
    }
    if (clearance > bestScore) { bestScore = clearance; best = { from, to }; }
  }
  return best;
}

const DEFAULT_GRAPH_ZOOM = 0.75;

export function CompartmentGraph({ graph }: { graph: GraphDraw }) {
  const [zoom, setZoom] = useState(DEFAULT_GRAPH_ZOOM);
  const markerId = useId();
  const positions = graph.nodes.map((node) => nodePosition(graph, node.id));
  const width = Math.max(...positions.map((p) => p.x)) + 40;
  const height = Math.max(105, ...positions.map((p) => p.y + 30));
  const reversePairs = new Set(
    graph.edges
      .filter((edge) =>
        graph.edges.some(
          (candidate) =>
            candidate.src === edge.dst && candidate.dst === edge.src,
        ),
      )
      .map(
        (edge) =>
          `${Math.min(edge.src, edge.dst)}-${Math.max(edge.src, edge.dst)}`,
      ),
  );
  return (
    <>
      <div className="graph-zoom">
        <button
          type="button"
          aria-label="Zoom out compartment graph"
          disabled={zoom <= 0.75}
          onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}
        >
          −
        </button>
        <button type="button" onClick={() => setZoom(DEFAULT_GRAPH_ZOOM)}>
          Reset zoom
        </button>
        <button
          type="button"
          aria-label="Zoom in compartment graph"
          disabled={zoom >= 3}
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
        >
          +
        </button>
      </div>
      <div className="synthetic-graph-viewport">
        <svg
          className="synthetic-graph"
          style={{ width: `${width * 4 * zoom}px` }}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Sampled compartment model graph"
        >
          <defs>
            {["transfer", "elimination", "dose"].map(kind => <marker
              key={kind}
              id={`${markerId}-${kind}`}
              markerWidth="5"
              markerHeight="5"
              refX="4.5"
              refY="2.5"
              orient="auto"
            >
              <path className={`synthetic-arrow-head ${kind}`} d="M0,0 L5,2.5 L0,5 Z" />
            </marker>)}
          </defs>
          {graph.edges.map((edge) => {
            const from = nodePosition(graph, edge.src);
            const to = nodePosition(graph, edge.dst);
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const length = Math.hypot(dx, dy) || 1;
            const inset = 7;
            const start = {
              x: from.x + (dx / length) * inset,
              y: from.y + (dy / length) * inset,
            };
            const end = {
              x: to.x - (dx / length) * inset,
              y: to.y - (dy / length) * inset,
            };
            const paired = reversePairs.has(
              `${Math.min(edge.src, edge.dst)}-${Math.max(edge.src, edge.dst)}`,
            );
            const offset = paired ? 2.2 : 0;
            const ox = (-dy / length) * offset;
            const oy = (dx / length) * offset;
            return (
              <g key={edge.id}>
                <line
                  className="synthetic-edge"
                  x1={start.x + ox}
                  y1={start.y + oy}
                  x2={end.x + ox}
                  y2={end.y + oy}
                  markerEnd={`url(#${markerId}-transfer)`}
                />
                <text
                  className="synthetic-flux-label"
                  x={(start.x + end.x) / 2 + ox}
                  y={(start.y + end.y) / 2 + oy - 1.2}
                >
                  J{compartmentSymbol(edge.src)}
                  {compartmentSymbol(edge.dst)}
                </text>
              </g>
            );
          })}
          {graph.elimNodes.map((id) => {
            const { from, to } = eliminationArrow(graph, id, width, height);
            return (
              <g key={`elim-${id}`}>
                <line
                  className="synthetic-edge elimination"
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  markerEnd={`url(#${markerId}-elimination)`}
                />
                <text
                  className="synthetic-flux-label elimination"
                  x={(from.x + to.x) / 2}
                  y={(from.y + to.y) / 2 - 2}
                >
                  J{compartmentSymbol(id)}∅
                </text>
              </g>
            );
          })}
          {graph.nodes.map((node) => {
            const position = nodePosition(graph, node.id);
            const label = compartmentSymbol(node.id);
            return (
              <g
                key={node.id}
                transform={`translate(${position.x} ${position.y})`}
              >
                <circle
                  className={
                    node.id === graph.central
                      ? "synthetic-node central"
                      : "synthetic-node"
                  }
                  r="6"
                />
                <text
                  className={
                    node.id === graph.central
                      ? "synthetic-node-index central"
                      : "synthetic-node-index"
                  }
                  y="1.6"
                >
                  {label}
                </text>
                <text className="synthetic-node-role" y="10">
                  {node.role.replace("_", " ")}
                </text>
              </g>
            );
          })}
          {Object.entries(graph.doseMap).map(([id, fraction], index) => {
            const position = nodePosition(graph, Number(id));
            return (
              <g key={`dose-${id}`}>
                <line
                  className="synthetic-dose-arrow"
                  x1={position.x}
                  y1={Math.max(1, position.y - 18 - index * 3)}
                  x2={position.x}
                  y2={position.y - 7}
                  markerEnd={`url(#${markerId}-dose)`}
                />
                <text
                  className="synthetic-dose-label"
                  x={position.x}
                  y={Math.max(3, position.y - 20 - index * 3)}
                >
                  {Math.round(fraction * 100)}% dose
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );
}

export function balanceEquation(graph: GraphDraw, nodeId: number) {
  const symbol = compartmentSymbol(nodeId);
  const incoming = graph.edges
    .filter((edge) => edge.dst === nodeId)
    .map((edge) => `J_{${compartmentSymbol(edge.src)}${symbol}}`);
  const outgoing = graph.edges
    .filter((edge) => edge.src === nodeId)
    .map((edge) => `J_{${symbol}${compartmentSymbol(edge.dst)}}`);
  if (graph.elimNodes.includes(nodeId))
    outgoing.push(`J_{${symbol}\\emptyset}`);
  const terms = [
    ...incoming.map((term) => ({ sign: 1, term })),
    ...outgoing.map((term) => ({ sign: -1, term })),
    ...(Object.hasOwn(graph.doseMap, nodeId)
      ? [{ sign: 1, term: `u_${symbol}(\\tau)` }]
      : []),
  ];
  const expression = terms
    .map(
      ({ sign, term }, index) =>
        `${sign < 0 ? "-" : index > 0 ? "+" : ""}${term}`,
    )
    .join("");
  return `\\frac{\\mathrm d X_${symbol}}{\\mathrm d\\tau}=${expression || "0"}`;
}

export function DoseTimeline({
  events,
  observationTimes,
}: {
  events: DoseEvent[];
  observationTimes: number[][];
}) {
  const left = 40;
  const right = 570;
  const axisY = 55;
  const x = (time: number) =>
    left + Math.max(0, Math.min(1, time)) * (right - left);
  return (
    <svg
      className="synthetic-dose-timeline"
      viewBox="0 0 610 125"
      role="img"
      aria-label="Dimensionless dose and observation schedule timeline"
    >
      <defs>
        <marker
          id="timeline-arrow"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto"
        >
          <path d="M0,0 L7,3.5 L0,7 Z" />
        </marker>
      </defs>
      <line
        className="timeline-axis"
        x1={left}
        y1={axisY}
        x2={right}
        y2={axisY}
      />
      {[0, 0.25, 0.5, 0.75, 1].map((time) => (
        <g key={time}>
          <line
            className="timeline-tick"
            x1={x(time)}
            y1={axisY - 4}
            x2={x(time)}
            y2={axisY + 5}
          />
          <text className="timeline-label" x={x(time)} y={105}>
            {time.toFixed(2)}
          </text>
        </g>
      ))}
      <text className="timeline-observation-title" x={left} y={71}>
        observations
      </text>
      {observationTimes.map((times, person) => (
        <g key={`person-${person}`}>
          {times.map((time, index) => (
            <circle
              className="timeline-observation"
              key={`${time}-${index}`}
              cx={x(time)}
              cy={73 + person * 2.8}
              r="1.15"
            />
          ))}
        </g>
      ))}
      <text className="timeline-axis-title" x={right} y={120}>
        dimensionless time τ
      </text>
      {events.map((event, index) => {
        const start = x(event.time);
        if (event.duration > 0) {
          const width = Math.max(5, x(event.time + event.duration) - start);
          return (
            <g key={`${event.time}-${index}`}>
              <rect
                className="timeline-infusion"
                x={start}
                y={24}
                width={width}
                height={axisY - 24}
              />
              <text
                className="timeline-event-label"
                x={start + width / 2}
                y={18}
              >
                {event.amount.toFixed(2)}×
              </text>
            </g>
          );
        }
        return (
          <g key={`${event.time}-${index}`}>
            <line
              className="timeline-bolus"
              x1={start}
              y1={22}
              x2={start}
              y2={axisY - 7}
              markerEnd="url(#timeline-arrow)"
            />
            <text className="timeline-event-label" x={start} y={15}>
              {event.amount.toFixed(2)}×
            </text>
          </g>
        );
      })}
    </svg>
  );
}
