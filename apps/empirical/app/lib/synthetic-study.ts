import type { Study } from "./types";
import {
  Rng,
  acquireMesh,
  generateStudy,
  sampleCohort,
  sampleGraph,
  sampleKinetics,
  sampleProtocol,
  type GraphDraw,
  type KineticDraw,
  type ProtocolDraw,
} from "../../../synthetic/app/lib/prior";

export const SYNTHETIC_LIMITS = {
  observations: { min: 2, max: 20, default: 16 },
  individuals: { min: 2, max: 16, default: 10 },
} as const;

export type SyntheticModelDraw = {
  seed: number;
  graph: GraphDraw;
  kinetics: KineticDraw;
  protocol: ProtocolDraw;
};

function boundedInteger(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, Math.round(value)));
}

export function sampleSyntheticModel(seed: number): SyntheticModelDraw {
  const rng = new Rng(seed);
  const graph = sampleGraph(rng);
  return {
    seed,
    graph,
    kinetics: sampleKinetics(graph, rng),
    protocol: sampleProtocol(graph, rng),
  };
}

export function generateSyntheticCohort(
  model: SyntheticModelDraw,
  nIndividuals: number,
  nObservations: number,
): Study {
  const individuals = boundedInteger(
    nIndividuals,
    SYNTHETIC_LIMITS.individuals.min,
    SYNTHETIC_LIMITS.individuals.max,
  );
  const observations = boundedInteger(
    nObservations,
    SYNTHETIC_LIMITS.observations.min,
    SYNTHETIC_LIMITS.observations.max,
  );
  const rng = new Rng((model.seed ^ 0x9e3779b9) >>> 0);
  const cohort = sampleCohort(model.graph, model.kinetics, rng, individuals);
  const complete = generateStudy(model.graph, model.kinetics, model.protocol, cohort, rng);
  const referenceArm = complete.arms[0];
  const mesh = acquireMesh(complete, 0, "exact", "uniform", observations, rng);
  const doseUnit = "relative dose";

  return {
    id: `synthetic-v6-${model.seed}-${individuals}-${observations}`,
    origin: "Synthetic v6",
    drug: "Synthetic study",
    administeredDrug: "dimensionless reference compound",
    study: `Interactive v6 prior draw ${model.seed}`,
    source: "Pythia-PK synthetic v6 prior",
    route: model.graph.route,
    dose: referenceArm.events[0]?.amount ?? 1,
    doseUnit,
    doseEvents: referenceArm.events.map((event) => ({
      time: event.time,
      amount: event.amount,
      unit: doseUnit,
      route: event.route,
      ...(event.duration > 0 ? { duration: event.duration } : {}),
    })),
    concentrationUnit: "dimensionless concentration",
    timeUnit: "τ",
    medium: "central compartment",
    unitClass: "dimensionless",
    subjects: mesh.times.map((times, person) => ({
      id: `individual-${person + 1}`,
      points: times.map((time, index) => [time, mesh.values[person][index]]),
    })),
    summary: [],
  };
}

