import type { Study, VpcPoint } from "./types";
import {
  Rng,
  acquireMesh,
  generateStudy,
  sampleAcquisitionTimes,
  sampleCohort,
  sampleGraph,
  sampleKinetics,
  sampleProtocol,
  type GraphDraw,
  type KineticDraw,
  type AcquisitionFamily,
  type ProtocolDraw,
  type ScheduleShape,
} from "../../../synthetic/app/lib/prior";

export const SYNTHETIC_LIMITS = {
  observations: { min: 2, max: 20, default: 8 },
  individuals: { min: 2, max: 16, default: 10 },
} as const;

export const SYNTHETIC_INITIAL_SEED = 46;
export const SYNTHETIC_INITIAL_ACQUISITION: SyntheticAcquisition = {
  family: "exact",
  shape: "early",
};

export type SyntheticModelDraw = {
  seed: number;
  graph: GraphDraw;
  kinetics: KineticDraw;
  protocol: ProtocolDraw;
};

export type SyntheticAcquisition = {
  family: AcquisitionFamily;
  shape: ScheduleShape;
};

function boundedInteger(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, Math.round(value)));
}

function quantile(values: number[], probability: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + fraction * ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]);
}

function meshVpc(times: number[][], values: number[][]): VpcPoint[] {
  const count = Math.min(...times.map((row) => row.length), ...values.map((row) => row.length));
  return Array.from({ length: count }, (_, index) => {
    const observedTimes = times.map((row) => row[index]);
    const concentrations = values.map((row) => row[index]);
    return {
      time: quantile(observedTimes, 0.5),
      q05: quantile(concentrations, 0.05),
      q50: quantile(concentrations, 0.5),
      q95: quantile(concentrations, 0.95),
      n: concentrations.length,
    };
  });
}

function acquisitionSeed(modelSeed: number, observations: number, acquisition: SyntheticAcquisition, gridDraw: number) {
  const familyCode = { exact: 0x101, pseudo_scheduled: 0x202, unscheduled: 0x303 }[acquisition.family];
  const shapeCode = { uniform: 0x11, early: 0x22, late: 0x33, clustered: 0x44 }[acquisition.shape];
  return (modelSeed ^ (observations * 0x45d9f3b) ^ Math.imul(gridDraw + 1, 0x27d4eb2d) ^ familyCode ^ shapeCode) >>> 0;
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

export function withInitialDose(model: SyntheticModelDraw): SyntheticModelDraw {
  return {
    ...model,
    protocol: {
      ...model.protocol,
      events: [{ time: 0, amount: 1, duration: 0, route: model.graph.route }],
      multidose: false,
      infusion: false,
      pattern: "single",
      rawProtocolHorizon: 1,
    },
  };
}

export function generateInitialSyntheticCohort(): Study {
  return generateSyntheticCohort(
    withInitialDose(sampleSyntheticModel(SYNTHETIC_INITIAL_SEED)),
    SYNTHETIC_LIMITS.individuals.default,
    SYNTHETIC_LIMITS.observations.default,
    SYNTHETIC_INITIAL_ACQUISITION,
  );
}

export function generateSyntheticCohort(
  model: SyntheticModelDraw,
  nIndividuals: number,
  nObservations: number,
  acquisition: SyntheticAcquisition = { family: "exact", shape: "uniform" },
  gridDraw = 0,
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
  const meshRng = new Rng(acquisitionSeed(model.seed, observations, acquisition, gridDraw));
  const mesh = acquireMesh(complete, 0, acquisition.family, acquisition.shape, observations, meshRng);
  const doseUnit = "relative dose";

  return {
    id: `synthetic-v6-${model.seed}-${individuals}-${observations}-${acquisition.family}-${acquisition.shape}-${gridDraw}`,
    origin: "Synthetic v6",
    drug: "Synthetic cohort",
    administeredDrug: "dimensionless reference compound",
    study: `Interactive v6 prior draw ${model.seed}`,
    source: `Pythia-PK synthetic v6 prior · ${acquisition.family}/${acquisition.shape}`,
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
    observedVpc: meshVpc(mesh.times, mesh.values),
  };
}

export function previewSyntheticObservationTimes(
  modelSeed: number,
  nIndividuals: number,
  nObservations: number,
  acquisition: SyntheticAcquisition,
  gridDraw = 0,
) {
  const individuals = boundedInteger(nIndividuals, 1, SYNTHETIC_LIMITS.individuals.max);
  const observations = boundedInteger(
    nObservations,
    SYNTHETIC_LIMITS.observations.min,
    SYNTHETIC_LIMITS.observations.max,
  );
  return sampleAcquisitionTimes(
    acquisition.family,
    acquisition.shape,
    observations,
    individuals,
    new Rng(acquisitionSeed(modelSeed, observations, acquisition, gridDraw)),
  );
}
