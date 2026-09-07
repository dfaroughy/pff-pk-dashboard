export type Point = [number, number];

export type Subject = { id: string; points: Point[]; latentPoints?: Point[]; cens?: (0 | 1 | null)[] };
export type SummaryPoint = { time: number; mean: number; sd: number | null; n: number | null };
export type DoseEvent = { time: number; amount: number; unit: string; route: string; duration?: number };

export type Study = {
  id: string;
  origin: string;
  drug: string;
  administeredDrug: string;
  study: string;
  source: string;
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
};

export type Corpus = { schemaVersion: number; generatedAt: string; studies: Study[] };

export type PkEstimate = { label: string; symbol: string; value: number | null; unit: string };
export type VpcPoint = { time: number; q05: number; q50: number; q95: number; n: number };
