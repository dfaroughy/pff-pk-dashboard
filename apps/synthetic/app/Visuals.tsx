"use client";

import { useEffect, useRef } from "react";
import type { DoseEvent, GraphDraw, MeshView, RateDraw } from "./lib/prior";

const COLORS = { ink: "#dbe9e4", muted: "#789b91", line: "#2b4039", acid: "#d8ff78", cyan: "#6bd5d0", orange: "#f1a66a", magenta: "#d881c4" };

function setup(canvas: HTMLCanvasElement) {
  const ratio = window.devicePixelRatio || 1;
  const box = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(box.width * ratio));
  canvas.height = Math.max(1, Math.round(box.height * ratio));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  return { ctx, width: box.width, height: box.height };
}

function arrow(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, color = COLORS.muted, offset = 0) {
  const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy) || 1, ux = dx / length, uy = dy / length;
  const nx = -uy, ny = ux;
  const startX = ax + ux * 31 + nx * offset, startY = ay + uy * 31 + ny * offset;
  const endX = bx - ux * 35 + nx * offset, endY = by - uy * 35 + ny * offset;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(endX, endY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(endX, endY); ctx.lineTo(endX - ux * 8 + nx * 4, endY - uy * 8 + ny * 4); ctx.lineTo(endX - ux * 8 - nx * 4, endY - uy * 8 - ny * 4); ctx.closePath(); ctx.fill();
}

export function GraphCanvas({ graph, rates }: { graph: GraphDraw; rates?: RateDraw[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const draw = () => {
      const surface = setup(canvas); if (!surface) return;
      const { ctx, width, height } = surface;
      const positions = new Map<number, { x: number; y: number }>();
      const central = { x: width * 0.54, y: height * 0.48 }; positions.set(0, central);
      const peripherals = graph.nodes.filter((n) => n.role === "peripheral");
      peripherals.forEach((node, i) => {
        const angle = (-0.65 + (peripherals.length === 1 ? 0.65 : i * 1.3 / Math.max(1, peripherals.length - 1)));
        positions.set(node.id, { x: width * 0.80 + Math.cos(angle) * width * 0.10, y: height * 0.48 + Math.sin(angle) * height * 0.34 });
      });
      const oral = graph.nodes.filter((n) => ["transit", "gut"].includes(n.role));
      oral.forEach((node, i) => positions.set(node.id, { x: width * (0.08 + i * 0.35 / Math.max(1, oral.length - 1)), y: height * 0.40 }));
      const depot = graph.nodes.filter((n) => ["depot_transit", "depot"].includes(n.role));
      depot.forEach((node, i) => positions.set(node.id, { x: width * (0.09 + i * 0.34 / Math.max(1, depot.length - 1)), y: height * 0.76 }));
      graph.nodes.filter((n) => n.role === "bile").forEach((node) => positions.set(node.id, { x: width * 0.48, y: height * 0.12 }));
      const sink = { x: width * 0.93, y: height * 0.86 };
      graph.edges.forEach((edge, i) => {
        const a = positions.get(edge.src), b = positions.get(edge.dst); if (!a || !b) return;
        const reverse = graph.edges.some((other, j) => j !== i && other.src === edge.dst && other.dst === edge.src);
        const param = rates?.find((r) => r.id === edge.id);
        arrow(ctx, a.x, a.y, b.x, b.y, param?.beta !== null && param?.beta !== undefined ? COLORS.orange : COLORS.muted, reverse ? (edge.src < edge.dst ? -5 : 5) : 0);
      });
      graph.elimNodes.forEach((node, i) => { const a = positions.get(node); if (a) arrow(ctx, a.x, a.y, sink.x, sink.y, rates?.find((r) => r.kind === "elimination" && r.src === node)?.beta !== null ? COLORS.orange : COLORS.muted, i * 3); });
      ctx.beginPath(); ctx.fillStyle = COLORS.orange; ctx.arc(sink.x, sink.y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = COLORS.muted; ctx.font = "10px IBM Plex Mono, monospace"; ctx.textAlign = "right"; ctx.fillText("SINK", sink.x - 10, sink.y + 4);
      graph.nodes.forEach((node) => {
        const p = positions.get(node.id); if (!p) return;
        const isCentral = node.id === 0;
        ctx.beginPath(); ctx.fillStyle = isCentral ? COLORS.acid : "#14201d"; ctx.strokeStyle = isCentral ? COLORS.acid : COLORS.muted; ctx.lineWidth = 1.4; ctx.arc(p.x, p.y, isCentral ? 32 : 27, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = isCentral ? "#101512" : COLORS.ink; ctx.font = `${isCentral ? 11 : 9}px IBM Plex Mono, monospace`; ctx.textAlign = "center";
        const label = node.role === "peripheral" ? `P${node.id}` : node.role === "depot_transit" ? `DT${node.id}` : node.role === "transit" ? `T${node.id}` : node.role.toUpperCase();
        ctx.fillText(label, p.x, p.y + 4);
        ctx.fillStyle = COLORS.muted; ctx.font = "9px IBM Plex Mono, monospace"; ctx.fillText(`X${node.id}`, p.x, p.y + (isCentral ? 48 : 42));
      });
      Object.entries(graph.doseMap).forEach(([node, fraction], i) => {
        const p = positions.get(Number(node)); if (!p) return;
        ctx.fillStyle = COLORS.cyan; ctx.font = "10px IBM Plex Mono, monospace"; ctx.textAlign = "center"; ctx.fillText(`dose ${(fraction * 100).toFixed(0)}% ↓`, p.x, Math.max(10, p.y - 43 - i * 10));
      });
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(canvas); return () => observer.disconnect();
  }, [graph, rates]);
  return <canvas className="graph-canvas" ref={ref} aria-label="Sampled compartment graph" />;
}

export function ProtocolTimeline({ events }: { events: DoseEvent[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const draw = () => {
      const surface = setup(canvas); if (!surface) return;
      const { ctx, width, height } = surface; const left = 34, right = width - 20, y = height * 0.58;
      ctx.strokeStyle = COLORS.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      [0, .25, .5, .75, 1].forEach((value) => { const x = left + value * (right - left); ctx.strokeStyle = COLORS.line; ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke(); ctx.fillStyle = COLORS.muted; ctx.font = "9px IBM Plex Mono, monospace"; ctx.textAlign = "center"; ctx.fillText(value.toFixed(2), x, y + 22); });
      const maxAmount = Math.max(...events.map((event) => event.amount), 1);
      events.forEach((event, i) => {
        const x = left + event.time * (right - left), h = 22 + 46 * event.amount / maxAmount;
        ctx.strokeStyle = i === events.length - 1 && events.length > 1 ? COLORS.orange : COLORS.cyan; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2;
        if (event.duration > 0) { const w = Math.max(4, event.duration * (right - left)); ctx.globalAlpha = .35; ctx.fillRect(x, y - h, w, h); ctx.globalAlpha = 1; ctx.strokeRect(x, y - h, w, h); }
        else { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 4, y - h + 7); ctx.lineTo(x, y - h); ctx.lineTo(x + 4, y - h + 7); ctx.stroke(); }
        ctx.fillStyle = COLORS.ink; ctx.font = "9px IBM Plex Mono, monospace"; ctx.textAlign = "center"; ctx.fillText(`${event.amount.toFixed(2)}×`, x + (event.duration > 0 ? Math.max(4, event.duration * (right - left)) / 2 : 0), y - h - 8);
      });
      ctx.fillStyle = COLORS.muted; ctx.textAlign = "right"; ctx.font = "9px IBM Plex Mono, monospace"; ctx.fillText("τ", right, y + 22);
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(canvas); return () => observer.disconnect();
  }, [events]);
  return <canvas className="protocol-canvas" ref={ref} aria-label="Dimensionless dose-event timeline" />;
}

interface TrajectoryProps {
  tau: number[];
  curves: number[][];
  events?: DoseEvent[];
  mesh?: MeshView;
  logScale: boolean;
  selected?: number;
}

export function TrajectoryCanvas({ tau, curves, events = [], mesh, logScale, selected = 0 }: TrajectoryProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas || !curves.length) return;
    const draw = () => {
      const surface = setup(canvas); if (!surface) return;
      const { ctx, width, height } = surface; const pad = { l: 52, r: 18, t: 20, b: 34 };
      const flat = curves.flat().filter((v) => Number.isFinite(v) && v > 0); const yMax = Math.max(...flat, 1e-4);
      const positiveFloor = Math.max(yMax * 1e-7, Math.min(...flat)); const yMin = logScale ? positiveFloor : 0;
      const sy = (value: number) => {
        const transformed = logScale ? Math.log10(Math.max(value, yMin)) : value;
        const low = logScale ? Math.log10(yMin) : 0; const high = logScale ? Math.log10(yMax) : yMax;
        return pad.t + (1 - (transformed - low) / Math.max(high - low, 1e-12)) * (height - pad.t - pad.b);
      };
      const sx = (value: number) => pad.l + value * (width - pad.l - pad.r);
      ctx.strokeStyle = COLORS.line; ctx.fillStyle = COLORS.muted; ctx.font = "9px IBM Plex Mono, monospace";
      for (let i = 0; i <= 4; i += 1) { const f = i / 4, y = pad.t + f * (height - pad.t - pad.b); ctx.globalAlpha = .8; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(width - pad.r, y); ctx.stroke(); const value = logScale ? 10 ** (Math.log10(yMax) * (1 - f) + Math.log10(yMin) * f) : yMax * (1 - f); ctx.textAlign = "right"; ctx.fillText(logScale ? value.toExponential(0) : value.toPrecision(2), pad.l - 8, y + 3); }
      ctx.globalAlpha = 1;
      events.forEach((event) => { const x = sx(event.time); ctx.strokeStyle = COLORS.orange; ctx.globalAlpha = .45; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, height - pad.b); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; });
      curves.forEach((curve, index) => {
        ctx.strokeStyle = index === selected ? COLORS.ink : COLORS.cyan; ctx.globalAlpha = index === selected ? .95 : .24; ctx.lineWidth = index === selected ? 1.6 : 1;
        ctx.beginPath(); curve.forEach((value, i) => { const x = sx(tau[i]), y = sy(value); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke();
      });
      ctx.globalAlpha = 1;
      if (mesh) {
        mesh.times.forEach((row, person) => { if (person !== selected && person > 8) return; ctx.fillStyle = person === selected ? COLORS.acid : COLORS.orange; ctx.globalAlpha = person === selected ? 1 : .35; row.forEach((time, j) => { ctx.beginPath(); ctx.arc(sx(time), sy(mesh.values[person][j]), person === selected ? 3 : 1.8, 0, Math.PI * 2); ctx.fill(); }); }); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = COLORS.muted; ctx.font = "10px IBM Plex Mono, monospace"; ctx.textAlign = "center";
      [0, .25, .5, .75, 1].forEach((value) => ctx.fillText(value.toFixed(2), sx(value), height - 12));
      ctx.textAlign = "right"; ctx.fillText("dimensionless time τ", width - pad.r, height - 12);
    };
    draw(); const observer = new ResizeObserver(draw); observer.observe(canvas); return () => observer.disconnect();
  }, [tau, curves, events, mesh, logScale, selected]);
  return <canvas className="trajectory-canvas" ref={ref} aria-label="Synthetic concentration trajectories" />;
}

export function CohortStrip({ values, label }: { values: number[]; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas || !values.length) return; const surface = setup(canvas); if (!surface) return;
    const { ctx, width, height } = surface; const low = Math.min(...values), high = Math.max(...values); const span = Math.max(high - low, 1e-9);
    ctx.strokeStyle = COLORS.line; ctx.beginPath(); ctx.moveTo(16, height / 2); ctx.lineTo(width - 16, height / 2); ctx.stroke();
    values.forEach((value, i) => { const x = 16 + (value - low) / span * (width - 32); const jitter = ((i * 17) % 11 - 5) * 1.7; ctx.fillStyle = i === 0 ? COLORS.acid : COLORS.cyan; ctx.globalAlpha = i === 0 ? 1 : .65; ctx.beginPath(); ctx.arc(x, height / 2 + jitter, i === 0 ? 4 : 2.5, 0, Math.PI * 2); ctx.fill(); });
    ctx.globalAlpha = 1; ctx.fillStyle = COLORS.muted; ctx.font = "9px IBM Plex Mono, monospace"; ctx.textAlign = "left"; ctx.fillText(`${label}  ${low.toFixed(2)}`, 16, height - 5); ctx.textAlign = "right"; ctx.fillText(high.toFixed(2), width - 16, height - 5);
  }, [values, label]);
  return <canvas className="cohort-strip" ref={ref} aria-label={`${label} distribution across 35 individuals`} />;
}
