export type Point = [number, number];

export type Subject = { id: string; points: Point[]; latentPoints?: Point[]; cens?: (0 | 1 | null)[]; covariates?: Record<string, number | string>; doseEvents?: DoseEvent[] };
export type SummaryPoint = { time: number; mean: number; sd: number | null; n: number | null };
export type DoseEvent = { time: number; amount: number; unit: string; route: string; duration?: number };

export type Study = {
  id: string;
  origin: string;
  drug: string;
  administeredDrug: string;
  study: string;
  source: string;
  benchmark?: { provider: string; model: string; description: string; sourceUrl: string };
  route: string;
  dose: number | null;
  doseUnit: string;
  doseEvents?: DoseEvent[];
  concentrationUnit: string;
  timeUnit: string;
  medium: string;
  unitClass: string;
  subjects: Subject[];
  summary: SummaryPoint[];
  observedVpc?: VpcPoint[];
  assay?: { lloq: number; source: string; synthetic?: boolean };
  censoringApplied?: boolean;
  syntheticProvenance?: Record<string, unknown>;
};

export type Corpus = { schemaVersion: number; generatedAt: string; studies: Study[] };

export type PkEstimate = { label: string; symbol: string; value: number | null; unit: string };
export type BlqPoint = {
  observed: { lower: number; upper: number; nCensored: number; nUnresolved: number };
  simulated?: { center: number; lower: number; upper: number };
};
export type VpcPoint = { time: number; q05: number | null; q50: number | null; q95: number | null; n: number; blq?: BlqPoint };
