import type { Study } from "./types";

export type SyntheticVersion = "v1" | "v6" | "v7";
export const SYNTHETIC_INITIAL_SEED = 46;
export const SYNTHETIC_LIMITS = {
  individuals: { min: 2, max: 100, default: 16 },
  observations: { min: 2, max: 20, default: 8 },
};
export type DoseEvent = {
  time: number;
  amount: number;
  duration: number;
  route: "oral" | "iv";
};
export type GraphDraw = {
  route: "oral" | "iv";
  nodes: { id: number; role: string; label: string }[];
  edges: { id: string; src: number; dst: number }[];
  central: number;
  elimNodes: number[];
  doseMap: Record<number, number>;
};
export type PriorControl = {
  path: string;
  label: string;
  min: number;
  max: number;
  default: number | number[];
  integer: boolean;
};
export type ProfileDescription = {
  version: SyntheticVersion;
  profileSha256: string;
  configuration: Record<string, unknown>;
  controls: PriorControl[];
};
export type Flux = {
  src: number;
  dst?: number;
  node?: number;
  kappa?: number;
  beta?: number | null;
  hill?: number;
  mod_node?: number | null;
  mod_type?: string;
  mod_k?: number;
  gate_lag?: number | null;
  gate_width?: number;
};
export type SyntheticResponse = {
  study: Study;
  description: ProfileDescription;
  provenance: {
    name: SyntheticVersion;
    seed: number;
    sha256: string;
    modified: boolean;
    recordSha256: string;
    implementation_sha256: string;
    resolved: { configuration: Record<string, unknown> };
  };
  topology: {
    roles: Record<string, string>;
    edges: Flux[];
    elimination: Flux[];
    dose_map: Record<number, number>;
  };
  population: Record<string, unknown>;
  individualTruth: Record<string, Record<string, unknown>>;
  native: null | {
    population: Record<string, number[][]>;
    time_start: number;
    time_stop: number;
    [key: string]: unknown;
  };
  covariateModel: {
    roster?: { name: string; type: string; observed: boolean | string; semantic?: boolean }[];
    network?: {
      layers: number;
      width: number;
      activation: string;
      sparsity: number;
      g_scale: number;
      d_in: number;
      clearance_targeted?: boolean;
      parameters: { weight: number[][]; bias: number[] }[];
      reference_rms: number[];
    } | null;
    [key: string]: unknown;
  } | null;
  integration: Record<string, unknown>;
};

export function graphFromResponse(draw: SyntheticResponse): GraphDraw {
  const nodes = Object.entries(draw.topology.roles).map(([id, role]) => ({
    id: Number(id),
    role,
    label: role,
  }));
  return {
    route: draw.study.route as "oral" | "iv",
    nodes,
    central: nodes.find((n) => n.role === "central")!.id,
    edges: draw.topology.edges.map((e, i) => ({
      id: String(i),
      src: e.src,
      dst: e.dst!,
    })),
    elimNodes: draw.topology.elimination.map((e) => e.node!),
    doseMap: draw.topology.dose_map,
  };
}

/** Exact algebra of simulation/fluxes.py, including gates and state modulation.
 * r includes the individual multiplier and exp(time path); X is amount, not concentration.
 */
export function fluxEquation(
  edge: Flux,
  version: SyntheticVersion,
  central: number,
) {
  const symbol = (id: number) => String.fromCharCode(97 + id);
  const src = edge.node ?? edge.src;
  const dst = edge.node === undefined ? symbol(edge.dst!) : "\\emptyset";
  const label = `${symbol(src)}${dst}`;
  if (version === "v1")
    return `J_{${label},i}=T\\,k_{${label},i}(T\\tau)X_{${symbol(src)},i}`;
  const amount = `X_{${symbol(src)},i}`;
  let value =
    edge.beta == null
      ? amount
      : `\\frac{\\beta_{${label}}${amount}^{h_{${label}}}}{\\beta_{${label}}^{h_{${label}}}+${amount}^{h_{${label}}}}`;
  if (edge.gate_lag != null)
    value += `\\frac{1}{1+\\exp[-(\\tau-${edge.gate_lag.toPrecision(4)})/${edge.gate_width?.toPrecision(4)}]}`;
  if (edge.mod_node != null) {
    const x = `X_{${symbol(edge.mod_node)},i}`;
    value += `\\frac{${edge.mod_type === "inhibition" ? `K_{${label}}` : x}}{K_{${label}}+${x}}`;
  }
  void central;
  return `J_{${label},i}=\\kappa_{${label}}r_{${label},i}(\\tau)${value}`;
}
