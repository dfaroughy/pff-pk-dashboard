export type Route = "oral" | "iv";
export type NodeRole = "central" | "peripheral" | "transit" | "gut" | "depot_transit" | "depot" | "bile";

export interface NodeSpec { id: number; role: NodeRole; label: string }
export interface EdgeSpec { id: string; src: number; dst: number; reversible?: boolean }
export interface GraphDraw {
  route: Route;
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  elimNodes: number[];
  doseMap: Record<number, number>;
  central: number;
  hasParallelAbsorption: boolean;
  hasRecycling: boolean;
}

export interface RateDraw {
  id: string;
  kind: "transfer" | "elimination";
  src: number;
  dst: number | null;
  kappa: number;
  beta: number | null;
  hill: number;
  timeVarying: boolean;
  nu?: number;
  ell?: number;
  amplitude?: number;
  phase?: number;
  gateLag?: number;
  gateWidth?: number;
  modNode?: number;
  modType?: "activation" | "inhibition";
  modK?: number;
}

export interface KineticDraw {
  rates: RateDraw[];
  timeVarying: boolean;
  gaugeFactor: number;
  saturableCount: number;
  modulatedCount: number;
}

export interface DoseEvent { time: number; amount: number; duration: number; route: Route }
export interface ProtocolDraw {
  route: Route;
  events: DoseEvent[];
  multidose: boolean;
  infusion: boolean;
  pattern: "single" | "maintenance" | "loading" | "titration";
  rawProtocolHorizon: number;
}

export interface IndividualDraw {
  id: number;
  multipliers: number[];
  volume: number;
  bioavailability: number;
  covariates: number[];
}

export interface CohortDraw {
  individuals: IndividualDraw[];
  rateSigmas: number[];
  correlation: number;
  volumeSigma: number;
  bioavailabilityActive: boolean;
  bioavailabilitySigma: number;
  covariateActive: boolean;
  nCovariates: number;
  nObservedCovariates: number;
  covariateTypes: ("continuous" | "categorical")[];
  mlpDepth: number;
  mlpWidth: number;
  mlpActivation: string;
  covariateScale: number;
}

export interface ArmDraw {
  id: string;
  label: string;
  kind: "reference" | "global_scale" | "add_on";
  events: DoseEvent[];
  curves: number[][];
}

export interface StudyDraw { tau: number[]; arms: ArmDraw[] }
export type AcquisitionFamily = "unscheduled" | "exact" | "pseudo_scheduled";
export type ScheduleShape = "uniform" | "early" | "late" | "clustered";

export interface MeshView {
  times: number[][];
  values: number[][];
  nominalTimes?: number[];
}

export class Rng {
  private state: number;
  private spare: number | null = null;
  constructor(seed: number) { this.state = seed >>> 0 || 1; }
  uniform(): number {
    let t = this.state += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  normal(): number {
    if (this.spare !== null) { const value = this.spare; this.spare = null; return value; }
    const u = Math.max(this.uniform(), 1e-12);
    const v = this.uniform();
    const radius = Math.sqrt(-2 * Math.log(u));
    this.spare = radius * Math.sin(2 * Math.PI * v);
    return radius * Math.cos(2 * Math.PI * v);
  }
  int(low: number, highInclusive: number): number { return low + Math.floor(this.uniform() * (highInclusive - low + 1)); }
  choice<T>(items: readonly T[], weights?: readonly number[]): T {
    if (!weights) return items[Math.min(items.length - 1, Math.floor(this.uniform() * items.length))];
    const total = weights.reduce((a, b) => a + b, 0);
    let draw = this.uniform() * total;
    for (let i = 0; i < items.length; i += 1) { draw -= weights[i]; if (draw <= 0) return items[i]; }
    return items[items.length - 1];
  }
  shuffle<T>(values: T[]): T[] {
    for (let i = values.length - 1; i > 0; i -= 1) { const j = this.int(0, i); [values[i], values[j]] = [values[j], values[i]]; }
    return values;
  }
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const logUniform = (rng: Rng, low: number, high: number) => Math.exp(Math.log(low) + rng.uniform() * (Math.log(high) - Math.log(low)));

function gamma(rng: Rng, shape: number): number {
  if (shape < 1) return gamma(rng, shape + 1) * Math.pow(rng.uniform(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = rng.normal();
    const v0 = 1 + c * x;
    if (v0 <= 0) continue;
    const v = v0 * v0 * v0;
    const u = rng.uniform();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function beta(rng: Rng, a: number, b: number): number {
  const x = gamma(rng, a); const y = gamma(rng, b); return x / (x + y);
}

function truncatedGeometric(rng: Rng, p: number, max: number): number {
  const values = Array.from({ length: max + 1 }, (_, i) => i);
  return rng.choice(values, values.map((k) => (1 - p) ** k));
}

export function sampleGraph(rng: Rng): GraphDraw {
  const nodes: NodeSpec[] = [{ id: 0, role: "central", label: "central" }];
  const edges: EdgeSpec[] = [];
  const elimNodes = [0];
  const nPeripheral = rng.choice([0, 1, 2, 3], [0.35, 0.45, 0.17, 0.03]);
  const exits = new Map<number, boolean>();
  for (let i = 1; i <= nPeripheral; i += 1) {
    nodes.push({ id: i, role: "peripheral", label: `peripheral ${i}` });
    edges.push({ id: `e${edges.length}`, src: 0, dst: i });
    const reversible = rng.uniform() < 0.9;
    if (reversible) edges.push({ id: `e${edges.length}`, src: i, dst: 0, reversible: true });
    const eliminates = !reversible || rng.uniform() < 0.1;
    if (eliminates) elimNodes.push(i);
    exits.set(i, reversible || eliminates);
  }
  if (nPeripheral >= 2 && rng.uniform() < 0.06) {
    const possibleDst = Array.from(exits).filter(([, value]) => value).map(([id]) => id);
    if (possibleDst.length) {
      const dst = rng.choice(possibleDst);
      const src = rng.choice(Array.from({ length: nPeripheral }, (_, i) => i + 1).filter((id) => id !== dst));
      edges.push({ id: `e${edges.length}`, src, dst });
      if (rng.uniform() < 0.5) edges.push({ id: `e${edges.length}`, src: dst, dst: src, reversible: true });
    }
  }
  let next = 1 + nPeripheral;
  const route: Route = rng.uniform() < 0.65 ? "oral" : "iv";
  let doseMap: Record<number, number> = { 0: 1 };
  let entry: number | null = null;
  if (route === "oral") {
    const nTransit = truncatedGeometric(rng, 0.55, 8);
    const chain = Array.from({ length: nTransit + 1 }, (_, i) => next + i);
    chain.forEach((id, i) => nodes.push({ id, role: i === chain.length - 1 ? "gut" : "transit", label: i === chain.length - 1 ? "gut" : `transit ${i + 1}` }));
    for (let i = 0; i < chain.length - 1; i += 1) edges.push({ id: `e${edges.length}`, src: chain[i], dst: chain[i + 1] });
    edges.push({ id: `e${edges.length}`, src: chain[chain.length - 1], dst: 0 });
    entry = chain[0];
    doseMap = { [entry]: 1 };
    next = chain[chain.length - 1] + 1;
  }
  let hasParallelAbsorption = false;
  if (route === "oral" && rng.uniform() < 0.25 && entry !== null) {
    hasParallelAbsorption = true;
    const nTransit = truncatedGeometric(rng, 0.6, 3);
    const chain = Array.from({ length: nTransit + 1 }, (_, i) => next + i);
    chain.forEach((id, i) => nodes.push({ id, role: i === chain.length - 1 ? "depot" : "depot_transit", label: i === chain.length - 1 ? "depot" : `depot transit ${i + 1}` }));
    for (let i = 0; i < chain.length - 1; i += 1) edges.push({ id: `e${edges.length}`, src: chain[i], dst: chain[i + 1] });
    edges.push({ id: `e${edges.length}`, src: chain[chain.length - 1], dst: 0 });
    const fraction = 0.2 + 0.4 * rng.uniform();
    doseMap = { [entry]: 1 - fraction, [chain[0]]: fraction };
    next = chain[chain.length - 1] + 1;
  }
  let hasRecycling = false;
  if (route === "oral" && entry !== null && rng.uniform() < 0.15) {
    hasRecycling = true;
    nodes.push({ id: next, role: "bile", label: "bile" });
    edges.push({ id: `e${edges.length}`, src: 0, dst: next });
    edges.push({ id: `e${edges.length}`, src: next, dst: entry });
  }
  return { route, nodes, edges, elimNodes: [...new Set(elimNodes)], doseMap, central: 0, hasParallelAbsorption, hasRecycling };
}

export function sampleKinetics(graph: GraphDraw, rng: Rng): KineticDraw {
  const timeVarying = rng.uniform() < 0.6;
  const satProbability = beta(rng, 0.7, 1.3);
  const eligibleTransfers = graph.edges
    .map((edge, i) => ({ edge, i }))
    .filter(({ edge }) => ["central", "peripheral"].includes(graph.nodes[edge.src].role) && ["central", "peripheral"].includes(graph.nodes[edge.dst].role));
  let selectedTransfers = eligibleTransfers.filter(() => rng.uniform() < satProbability).map(({ i }) => i);
  rng.shuffle(selectedTransfers); selectedTransfers = selectedTransfers.slice(0, 2);
  let selectedElim = graph.elimNodes.map((_, i) => i).filter(() => rng.uniform() < satProbability);
  let selected = [...selectedTransfers.map((i) => `t${i}`), ...selectedElim.map((i) => `l${i}`)];
  rng.shuffle(selected); selected = selected.slice(0, 3);
  selectedTransfers = selected.filter((v) => v[0] === "t").map((v) => Number(v.slice(1)));
  selectedElim = selected.filter((v) => v[0] === "l").map((v) => Number(v.slice(1)));

  const drawRate = (id: string, kind: "transfer" | "elimination", src: number, dst: number | null, saturable: boolean): RateDraw => {
    const rate: RateDraw = {
      id, kind, src, dst,
      kappa: Math.exp(1.5 * rng.normal()),
      beta: saturable ? Math.exp(1 + 2.5 * rng.normal()) : null,
      hill: 0.7 + 1.8 * rng.uniform(),
      timeVarying,
    };
    if (timeVarying) {
      rate.nu = rng.choice([0.5, 1.5, 2.5, 3.5], [0.15, 0.35, 0.3, 0.2]);
      rate.ell = 0.08 + 0.52 * rng.uniform();
      rate.amplitude = 0.3 + 0.9 * rng.uniform();
      rate.phase = 2 * Math.PI * rng.uniform();
    }
    return rate;
  };
  const rates = graph.edges.map((edge, i) => drawRate(edge.id, "transfer", edge.src, edge.dst, selectedTransfers.includes(i)));
  graph.elimNodes.forEach((node, i) => rates.push(drawRate(`elim${i}`, "elimination", node, null, selectedElim.includes(i))));

  if (graph.hasRecycling && rng.uniform() < 0.7) {
    const bile = graph.nodes.find((node) => node.role === "bile")?.id;
    const gated = rates.find((rate) => rate.kind === "transfer" && rate.src === bile);
    if (gated) { gated.gateLag = 0.08 + 0.22 * rng.uniform(); gated.gateWidth = 0.02 + 0.08 * rng.uniform(); gated.kappa = Math.exp(-0.3 + 1.6 * rng.uniform()); gated.beta = null; }
  }
  if (graph.hasParallelAbsorption) {
    const depot = graph.nodes.find((node) => node.role === "depot")?.id;
    const gated = rates.find((rate) => rate.kind === "transfer" && rate.src === depot && rate.dst === 0);
    if (gated) { gated.gateLag = 0.15 + 0.30 * rng.uniform(); gated.gateWidth = 0.02 + 0.08 * rng.uniform(); gated.kappa = Math.exp(-0.5 + 1.5 * rng.uniform()); gated.beta = null; }
  }
  const modEligible = rates.filter((rate) => rate.kind === "transfer" && ["central", "peripheral"].includes(graph.nodes[rate.src].role) && rate.dst !== null && ["central", "peripheral"].includes(graph.nodes[rate.dst].role));
  if (graph.nodes.length >= 3 && modEligible.length && rng.uniform() < 0.12) {
    const rate = rng.choice(modEligible);
    const candidates = graph.nodes.filter((node) => node.id !== rate.src && node.id !== rate.dst && ["central", "peripheral"].includes(node.role));
    if (candidates.length) { rate.modNode = rng.choice(candidates).id; rate.modType = rng.uniform() < 0.5 ? "activation" : "inhibition"; rate.modK = Math.exp(1.5 * rng.normal()); }
  }
  const centralElimination = rates.find((rate) => rate.kind === "elimination" && rate.src === 0)?.kappa ?? 1;
  const gaugeFactor = clamp(5 / Math.max(centralElimination, 0.1), 1.5, 24);
  rates.forEach((rate) => { rate.kappa *= gaugeFactor; });
  return { rates, timeVarying, gaugeFactor, saturableCount: rates.filter((rate) => rate.beta !== null).length, modulatedCount: rates.filter((rate) => rate.modNode !== undefined).length };
}

export function sampleProtocol(graph: GraphDraw, rng: Rng): ProtocolDraw {
  const multidose = rng.uniform() < 0.3;
  const infusion = rng.uniform() < 0.15;
  let times = [0]; let amounts = [1]; let pattern: ProtocolDraw["pattern"] = "single";
  let rawProtocolHorizon = 1;
  if (multidose) {
    const n = rng.int(2, 8); const interval = 0.15 + 0.45 * rng.uniform();
    times = Array.from({ length: n }, (_, i) => i * interval);
    amounts = Array.from({ length: n }, () => 1);
    const draw = rng.uniform(); pattern = "maintenance";
    if (draw < 0.25) { amounts[0] = 1.5 + 1.5 * rng.uniform(); pattern = "loading"; }
    else if (draw < 0.45 && n >= 3) {
      let step = 0.1 + 0.25 * rng.uniform(); if (rng.uniform() < 0.5) step *= -1;
      amounts = amounts.map((_, i) => Math.exp(step * (i - (n - 1) / 2))); pattern = "titration";
    }
    amounts = amounts.map((value) => clamp(value * Math.exp(0.15 * rng.normal()), 0.2, 5));
    rawProtocolHorizon = times[times.length - 1] + 1;
  }
  const rawDuration = infusion ? 0.05 + 0.45 * rng.uniform() : 0;
  const events = times.map((time, i) => ({ time: time / rawProtocolHorizon, amount: amounts[i], duration: rawDuration / rawProtocolHorizon, route: graph.route }));
  return { route: graph.route, events, multidose, infusion, pattern, rawProtocolHorizon };
}

export function sampleCohort(graph: GraphDraw, kinetics: KineticDraw, rng: Rng): CohortDraw {
  const nRates = kinetics.rates.length;
  const rateSigmas = Array.from({ length: nRates }, () => 0.15 + 0.25 * rng.uniform());
  const correlation = 0.5;
  const volumeSigma = 0.1 + 0.3 * rng.uniform();
  const bioavailabilityActive = graph.route === "oral" && rng.uniform() < 0.8;
  const bioavailabilitySigma = bioavailabilityActive ? 0.1 + 0.3 * rng.uniform() : 0;
  const covariateActive = rng.uniform() < 0.7;
  const nCovariates = covariateActive ? rng.int(1, 6) : 0;
  const covariateTypes = Array.from({ length: nCovariates }, () => rng.uniform() < 0.6 ? "continuous" as const : "categorical" as const);
  const observed = covariateTypes.map(() => rng.uniform() < 0.6);
  const mlpDepth = covariateActive ? rng.choice([0, 1, 2, 3], [0.25, 0.35, 0.25, 0.15]) : 0;
  const mlpWidth = covariateActive ? rng.choice([8, 16, 24, 32]) : 0;
  const mlpActivation = covariateActive ? rng.choice(["tanh", "relu", "identity", "elu"]) : "none";
  const covariateScale = covariateActive ? 0.2 + rng.uniform() : 0;
  const weights = Array.from({ length: nCovariates }, () => Array.from({ length: nRates }, () => rng.uniform() < 0.5 ? 0 : rng.normal() / Math.sqrt(Math.max(1, nCovariates))));
  const individuals: IndividualDraw[] = [];
  for (let i = 0; i < 35; i += 1) {
    const common = rng.normal();
    const covariates = covariateTypes.map((type) => type === "continuous" ? rng.normal() : rng.int(0, rng.choice([1, 2, 3], [0.5, 0.3, 0.2])));
    const shift = Array.from({ length: nRates }, (_, j) => {
      let value = covariates.reduce((sum, x, k) => sum + x * weights[k][j], 0);
      if (mlpDepth > 0) value = Math.tanh(value);
      return clamp(value * covariateScale, -4 * covariateScale, 4 * covariateScale);
    });
    const multipliers = rateSigmas.map((sigma, j) => Math.exp(sigma * (Math.sqrt(correlation) * common + Math.sqrt(1 - correlation) * rng.normal()) + shift[j]));
    const volume = clamp(Math.exp(volumeSigma * rng.normal() + (shift[0] ?? 0) * 0.5), 0.2, 5);
    const bioavailability = bioavailabilityActive ? clamp(Math.exp(bioavailabilitySigma * rng.normal() + (shift[1] ?? 0) * 0.5), 0.2, 5) : 1;
    individuals.push({ id: i, multipliers, volume, bioavailability, covariates });
  }
  return { individuals, rateSigmas, correlation, volumeSigma, bioavailabilityActive, bioavailabilitySigma, covariateActive, nCovariates, nObservedCovariates: observed.filter(Boolean).length, covariateTypes, mlpDepth, mlpWidth, mlpActivation, covariateScale };
}

function modulation(rate: RateDraw, tau: number): number {
  if (!rate.timeVarying || rate.amplitude === undefined || rate.ell === undefined) return 1;
  const phase = rate.phase ?? 0;
  const smoothness = rate.nu ?? 1.5;
  const base = Math.sin(2 * Math.PI * tau / Math.max(rate.ell, 0.04) + phase);
  const detail = Math.sin(4 * Math.PI * tau / Math.max(rate.ell, 0.04) + phase * 0.61) / (1 + smoothness);
  return Math.exp(rate.amplitude * (0.72 * base + 0.28 * detail));
}

function derivative(graph: GraphDraw, kinetics: KineticDraw, individual: IndividualDraw, events: DoseEvent[], tau: number, x: number[]): number[] {
  const dx = Array.from({ length: graph.nodes.length }, () => 0);
  kinetics.rates.forEach((rate, index) => {
    const amount = Math.max(0, x[rate.src]);
    const k = rate.kappa * individual.multipliers[index] * modulation(rate, tau);
    let flux = k * amount;
    if (rate.beta !== null) {
      const ratio = Math.pow(Math.max(amount / rate.beta, 1e-15), rate.hill);
      flux = k * rate.beta * ratio / (1 + ratio);
    }
    if (rate.gateLag !== undefined && rate.gateWidth !== undefined) flux *= 1 / (1 + Math.exp(-(tau - rate.gateLag) / rate.gateWidth));
    if (rate.modNode !== undefined && rate.modK !== undefined) {
      const m = Math.max(0, x[rate.modNode]);
      flux *= rate.modType === "inhibition" ? rate.modK / (rate.modK + m) : m / (rate.modK + m);
    }
    dx[rate.src] -= flux;
    if (rate.dst !== null) dx[rate.dst] += flux;
  });
  events.forEach((event) => {
    if (event.duration <= 0 || tau < event.time || tau >= event.time + event.duration) return;
    Object.entries(graph.doseMap).forEach(([node, fraction]) => { dx[Number(node)] += event.amount * fraction * individual.bioavailability / event.duration; });
  });
  return dx;
}

function simulateIndividual(graph: GraphDraw, kinetics: KineticDraw, individual: IndividualDraw, events: DoseEvent[], tau: number[]): number[] {
  let x = Array.from({ length: graph.nodes.length }, () => 0);
  const curve: number[] = [];
  const eventSteps = events.filter((event) => event.duration === 0).map((event) => ({ index: tau.reduce((best, value, i) => Math.abs(value - event.time) < Math.abs(tau[best] - event.time) ? i : best, 0), event }));
  for (let step = 0; step < tau.length; step += 1) {
    eventSteps.filter((item) => item.index === step).forEach(({ event }) => {
      Object.entries(graph.doseMap).forEach(([node, fraction]) => { x[Number(node)] += event.amount * fraction * individual.bioavailability; });
    });
    curve.push(Math.max(x[0] / individual.volume, 1e-10));
    if (step === tau.length - 1) break;
    const dt = tau[step + 1] - tau[step];
    const k1 = derivative(graph, kinetics, individual, events, tau[step], x);
    const predicted = x.map((value, j) => Math.max(0, value + dt * k1[j]));
    const k2 = derivative(graph, kinetics, individual, events, tau[step + 1], predicted);
    x = x.map((value, j) => Math.max(0, Math.min(1e7, value + 0.5 * dt * (k1[j] + k2[j]))));
  }
  return curve;
}

export function generateStudy(graph: GraphDraw, kinetics: KineticDraw, protocol: ProtocolDraw, cohort: CohortDraw, rng: Rng): StudyDraw {
  const tau = Array.from({ length: 401 }, (_, i) => i / 400);
  const armSpecs: Omit<ArmDraw, "curves">[] = [{ id: "reference", label: "reference · 1×", kind: "reference", events: protocol.events }];
  for (let i = 0; i < 2; i += 1) {
    const scale = logUniform(rng, 0.25, 4);
    armSpecs.push({ id: `scale${i + 1}`, label: `global · ${scale.toFixed(2)}×`, kind: "global_scale", events: protocol.events.map((event) => ({ ...event, amount: event.amount * scale })) });
  }
  for (let i = 0; i < 2; i += 1) {
    const amount = logUniform(rng, 0.25, 4); const time = 0.1 + 0.8 * rng.uniform();
    const added: DoseEvent = { time: Math.min(time, 1 - (protocol.events[0]?.duration ?? 0)), amount, duration: protocol.events[0]?.duration ?? 0, route: graph.route };
    armSpecs.push({ id: `addon${i + 1}`, label: `add-on · ${amount.toFixed(2)}× @ ${added.time.toFixed(2)}`, kind: "add_on", events: [...protocol.events, added].sort((a, b) => a.time - b.time) });
  }
  return { tau, arms: armSpecs.map((arm) => ({ ...arm, curves: cohort.individuals.map((individual) => simulateIndividual(graph, kinetics, individual, arm.events, tau)) })) };
}

function weightedSampleIndices(times: number[], count: number, shape: ScheduleShape, rng: Rng): number[] {
  if (count >= times.length) return times.map((_, i) => i);
  const chosen = new Set<number>([0, times.length - 1]);
  const centers = [rng.uniform(), rng.uniform()];
  while (chosen.size < count) {
    const candidates = times.map((tau, i) => ({ i, weight: i === 0 || i === times.length - 1 || chosen.has(i) ? 0 : shape === "early" ? Math.exp(-6 * tau) : shape === "late" ? Math.exp(-6 * (1 - tau)) : shape === "clustered" ? centers.reduce((sum, c) => sum + Math.exp(-0.5 * ((tau - c) / 0.06) ** 2), 0) + 0.05 : 1 }));
    const total = candidates.reduce((sum, item) => sum + item.weight, 0); let draw = rng.uniform() * total;
    for (const item of candidates) { draw -= item.weight; if (draw <= 0 && item.weight > 0) { chosen.add(item.i); break; } }
  }
  return [...chosen].sort((a, b) => a - b);
}

function interpolate(tau: number[], values: number[], time: number): number {
  const position = clamp(time * (tau.length - 1), 0, tau.length - 1);
  const left = Math.floor(position), right = Math.min(tau.length - 1, left + 1), f = position - left;
  return values[left] * (1 - f) + values[right] * f;
}

export function acquireMesh(study: StudyDraw, armIndex: number, family: AcquisitionFamily, shape: ScheduleShape, count: number, rng: Rng): MeshView {
  const regular = Array.from({ length: 128 }, (_, i) => (i + 1) / 128);
  const arm = study.arms[armIndex];
  let nominal: number[] | undefined;
  if (family !== "unscheduled") nominal = weightedSampleIndices(regular, count, shape, rng).map((i) => regular[i]);
  const times = arm.curves.map(() => {
    if (family === "exact") return [...(nominal ?? [])];
    if (family === "pseudo_scheduled") {
      const source = nominal ?? [];
      return source.map((time, i) => i === 0 || i === source.length - 1 ? time : clamp(time + (rng.uniform() - 0.5) * 0.3 * Math.min(time - source[i - 1], source[i + 1] - time), 1 / 128, 1)).sort((a, b) => a - b);
    }
    const randomBase = [...Array.from({ length: 127 }, () => Math.max(Number.MIN_VALUE, rng.uniform())), 1].sort((a, b) => a - b);
    return weightedSampleIndices(randomBase, count, shape, rng).map((i) => randomBase[i]);
  });
  const values = times.map((row, i) => row.map((time) => interpolate(study.tau, arm.curves[i], time)));
  return { times, values, nominalTimes: nominal };
}

export const PRIOR_FACTS = {
  topology: [
    ["route", "oral with probability 0.65; otherwise IV"],
    ["peripheral pools", "categorical {0,1,2,3} with weights {0.35,0.45,0.17,0.03}"],
    ["oral transit depth", "truncated geometric on 0…8; p = 0.55"],
    ["parallel absorption", "probability 0.25 conditional on oral"],
    ["recycling loop", "probability 0.15 conditional on oral"],
  ],
  kinetics: [
    ["rate ratio κ", "log κ ~ Normal(0, 1.5²), then a common time gauge is removed"],
    ["saturation β", "log β ~ Normal(1, 2.5²); at most three nonlinear fluxes"],
    ["Hill exponent h", "Uniform(0.7, 2.5)"],
    ["time variation", "probability 0.60; Matérn ν ∈ {½, 3⁄2, 5⁄2, 7⁄2}"],
    ["modulated transfer", "probability 0.12; at most one cross-state modulation"],
  ],
  protocol: [
    ["repeated dosing", "probability 0.30; 2…8 dose events"],
    ["infusion", "probability 0.15; duration 0.05…0.50 of the single-dose horizon"],
    ["loading dose", "probability 0.25 within a multidose schedule"],
    ["titration", "probability 0.20 within a multidose schedule"],
    ["v6 family", "reference + 2 global-dose scalings + 2 add-on interventions"],
  ],
  cohort: [
    ["study size", "35 exchangeable individuals in every arm"],
    ["residual BSV", "correlated log-normal rate multipliers; log-SD 0.15…0.40"],
    ["central volume", "log-normal ratio; log-SD 0.10…0.40, clipped to 0.2…5"],
    ["oral bioavailability", "active with probability 0.80; log-SD 0.10…0.40"],
    ["covariate map", "study-specific sparse random MLP; observed and hidden anonymous covariates"],
  ],
};
