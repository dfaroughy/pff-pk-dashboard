import type { Study } from "./types";

// A reproducible illustrative display prior, independent of the kinetic draw.
export function drawCensoring(seed: number) {
  let state = (seed ^ 0x6c6c6f71) >>> 0;
  const uniform = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  return { enabled: uniform() < 0.5, ratio: Math.round(10 ** (1 + uniform())) };
}

// Verified against Videau 2010 Table 4 and Lenuzza 2016 section 2.4.
// These are assay metadata, not automatically adjudicated laboratory labels.
const LENUZZA_LIMITS: Record<string, number> = {
  caffeine: 10, tolbutamide: 8.7, omeprazole: 2, dextromethorphan: 0.2,
  midazolam: 1, rosuvastatin: 0.1, paracetamol: 10, memantine: 0.1,
  digoxin: 0.05, paraxanthine: 5, "4-hydroxy-tolbutamide": 0.5,
  "5-hydroxy-omeprazole": 0.5, dextrorphan: 0.2, "1-hydroxy-midazolam": 0.5,
  "omeprazole sulfone": 0.2, "paracetamol glucuronide": 50,
  repaglinide: 0.05, "hydroxy-repaglinide": 0.05,
};

export function withAssayMetadata(study: Study): Study {
  const lloq = LENUZZA_LIMITS[study.drug];
  if (study.assay || !study.id.startsWith("lenuzza-") || !lloq || study.concentrationUnit !== "ng/mL") return study;
  return { ...study, assay: { lloq, source: ["digoxin", "repaglinide", "hydroxy-repaglinide"].includes(study.drug)
    ? "Lenuzza 2016, §2.4" : "Videau 2010, Table 4" },
    subjects: study.subjects.map((s) => ({ ...s, cens: s.points.map(([, c]) => c > lloq * (1 + 1e-6) ? 0 : null) })) };
}

export function applySyntheticCensoring(study: Study, lloq: number): Study {
  if (!Number.isFinite(lloq) || lloq <= 0) throw new Error("LLOQ must be positive and finite");
  if (!study.origin.startsWith("Synthetic")) throw new Error("Synthetic censoring requires a synthetic cohort");
  return { ...study, id: `${study.id}-lloq-${lloq}`, observedVpc: undefined,
    assay: { lloq, source: "Synthetic assay", synthetic: true }, censoringApplied: true,
    subjects: study.subjects.map((s) => {
      const latent = s.latentPoints ?? s.points;
      return { ...s, latentPoints: latent, cens: latent.map(([, c]) => c < lloq ? 1 : 0),
        points: latent.map(([t, c]) => [t, Math.max(c, lloq)]) };
    }) };
}
