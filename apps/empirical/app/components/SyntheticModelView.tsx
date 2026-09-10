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

/** Elimination leaves the bottom of its compartment vertically. */
export function eliminationArrow(graph: GraphDraw, id: number) {
  const origin = nodePosition(graph, id);
  return {
    from: { x: origin.x, y: origin.y + 7 },
    to: { x: origin.x, y: origin.y + 18 },
  };
}

type GraphPoint = { x: number; y: number };
type LabelBox = GraphPoint & { halfWidth: number; halfHeight: number };

function transferGeometry(graph: GraphDraw, src: number, dst: number) {
  const from = nodePosition(graph, src), to = nodePosition(graph, dst);
  const dx = to.x - from.x, dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const offset = graph.edges.some((e) => e.src === dst && e.dst === src) ? 2.2 : 0;
  const ox = -dy / length * offset, oy = dx / length * offset;
  return {
    start: { x: from.x + dx / length * 7 + ox, y: from.y + dy / length * 7 + oy },
    end: { x: to.x - dx / length * 7 + ox, y: to.y - dy / length * 7 + oy },
    label: { x: (from.x + to.x) / 2 + ox, y: (from.y + to.y) / 2 + oy - 1.2 },
  };
}

/** Place role labels in nearby free space, reserving arrows and all other text.
 * Conservative monospace bounds include padding, in SVG coordinates, so the
 * result is deterministic and independent of browser zoom or font loading.
 */
export function roleLabelPositions(graph: GraphDraw): Map<number, GraphPoint> {
  const boxes: LabelBox[] = [];
  const lines: Array<[GraphPoint, GraphPoint]> = [];
  const textBox = (p: GraphPoint, characters: number): LabelBox => ({
    x: p.x, y: p.y - 1.12, halfWidth: characters * 1.05 + 1.4, halfHeight: 3.22,
  });
  for (const node of graph.nodes) boxes.push({ ...nodePosition(graph, node.id), halfWidth: 7, halfHeight: 7 });
  for (const edge of graph.edges) {
    const { start, end, label } = transferGeometry(graph, edge.src, edge.dst);
    lines.push([start, end]);
    boxes.push(textBox(label, 3));
  }
  for (const id of graph.elimNodes) {
    const { from, to } = eliminationArrow(graph, id);
    lines.push([from, to]);
    boxes.push(textBox({ x: from.x + 5, y: (from.y + to.y) / 2 - 2 }, 3));
  }
  Object.entries(graph.doseMap).forEach(([id, fraction], index) => {
    const p = nodePosition(graph, Number(id));
    lines.push([{ x: p.x, y: Math.max(1, p.y - 18 - index * 3) }, { x: p.x, y: p.y - 7 }]);
    boxes.push(textBox({ x: p.x, y: Math.max(3, p.y - 20 - index * 3) }, `${Math.round(fraction * 100)}% DOSE`.length));
  });
  const width = Math.max(...graph.nodes.map((n) => nodePosition(graph, n.id).x)) + 40;
  const height = Math.max(105, ...graph.nodes.map((n) => nodePosition(graph, n.id).y + 36));
  const positions = new Map<number, GraphPoint>();
  const ordered = [...graph.nodes].sort((a, b) => Number(b.id === graph.central) - Number(a.id === graph.central));
  for (const node of ordered) {
    const origin = nodePosition(graph, node.id);
    const length = node.role.replaceAll("_", " ").length;
    const candidates: GraphPoint[] = [];
    for (const radius of [10, 14, 18, 24, 30]) {
      const sides = node.id === graph.central ? [-1, 1] : [1, -1];
      for (const side of sides) for (const dx of [0, -8, 8, -16, 16])
        candidates.push({ x: origin.x + dx, y: origin.y + side * radius });
      for (const side of [-1, 1]) candidates.push({ x: origin.x + side * (radius + length * 1.05), y: origin.y + 1 });
    }
    if (node.id === graph.central) candidates.sort((a, b) => Number(a.y >= origin.y) - Number(b.y >= origin.y));
    let best = candidates[0], bestScore = Infinity;
    for (const candidate of candidates) {
      const box = textBox(candidate, length);
      if (box.x - box.halfWidth < 1 || box.x + box.halfWidth > width - 1 || box.y - box.halfHeight < 1 || box.y + box.halfHeight > height - 1) continue;
      let score = boxes.filter((other) => Math.abs(box.x - other.x) < box.halfWidth + other.halfWidth && Math.abs(box.y - other.y) < box.halfHeight + other.halfHeight).length * 100;
      for (const [start, end] of lines) {
        const steps = Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) * 2);
        for (let i = 0; i <= steps; i++) {
          const t = steps ? i / steps : 0;
          if (Math.abs(start.x + (end.x - start.x) * t - box.x) < box.halfWidth + 1 && Math.abs(start.y + (end.y - start.y) * t - box.y) < box.halfHeight + 1) { score += 100; break; }
        }
      }
      if (score < bestScore) { best = candidate; bestScore = score; }
      if (!score) break;
    }
    positions.set(node.id, best);
    boxes.push(textBox(best, length));
  }
  return positions;
}

const DEFAULT_GRAPH_ZOOM = 0.75;

export function CompartmentGraph({ graph }: { graph: GraphDraw }) {
  const [zoom, setZoom] = useState(DEFAULT_GRAPH_ZOOM);
  const markerId = useId();
  const positions = graph.nodes.map((node) => nodePosition(graph, node.id));
  const width = Math.max(...positions.map((p) => p.x)) + 40;
  const height = Math.max(105, ...positions.map((p) => p.y + 36));
  const roleLabels = roleLabelPositions(graph);
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
            const { start, end, label } = transferGeometry(graph, edge.src, edge.dst);
            return (
              <g key={edge.id}>
                <line
                  className="synthetic-edge"
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  markerEnd={`url(#${markerId}-transfer)`}
                />
                <text
                  className="synthetic-flux-label"
                  x={label.x}
                  y={label.y}
                >
                  J{compartmentSymbol(edge.src)}
                  {compartmentSymbol(edge.dst)}
                </text>
              </g>
            );
          })}
          {graph.elimNodes.map((id) => {
            const { from, to } = eliminationArrow(graph, id);
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
                  x={(from.x + to.x) / 2 + 5}
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
            const roleLabel = roleLabels.get(node.id)!;
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
                <text className="synthetic-node-role" x={roleLabel.x - position.x} y={roleLabel.y - position.y}>
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
  const tickLabelY = Math.max(105, 76 + observationTimes.length * 2.8 + 14);
  const x = (time: number) =>
    left + Math.max(0, Math.min(1, time)) * (right - left);
  return (
    <svg
      className="synthetic-dose-timeline"
      style={{ aspectRatio: `610 / ${tickLabelY + 30}` }}
      viewBox={`0 0 610 ${tickLabelY + 30}`}
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
          <text className="timeline-label" x={x(time)} y={tickLabelY}>
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
              cy={76 + person * 2.8}
              r="1.15"
            />
          ))}
        </g>
      ))}
      <text className="timeline-axis-title" x={right} y={tickLabelY + 23}>
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
