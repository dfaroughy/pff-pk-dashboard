import { expect, test } from "vitest";
import { covariateGroups, covariatePk, covariateMoments } from "../app/lib/covariate-analysis";
import type { Study } from "../app/lib/types";
import type { InferenceResponse } from "../app/lib/model-api";

const study = { subjects: [
  { id: "a", points: [[1, 2], [2, 4], [3, 2]], covariates: { sex: "Female", weight_kg: 60 } },
  { id: "b", points: [[1, 3], [2, 5], [3, 3]], covariates: { sex: "Male", weight_kg: 90 } },
], summary: [] } as unknown as Study;
const result = { queryTime: [1, 2, 3], generatedConcentration: [[2, 4, 2], [3, 5, 3], [4, 6, 4]],
  request: { targetCovariates: [{ sex: "female", weight_kg: 60 }, { sex: "male", weight_kg: 90 }, {}] },
} as unknown as InferenceResponse;
const sex = { key: "sex", label: "Sex", options: ["female", "male"] };

test("VPC uses arithmetic means and sample SD at exact observation times", () => {
  const group = { label: "All", color: "blue", observed: study.subjects, generated: [0, 1] };
  const summary = covariateMoments(study, result, group);
  expect(summary.observed.map(p => p.mean)).toEqual([2.5, 4.5, 2.5]);
  expect(summary.observed[0].sd).toBeCloseTo(Math.sqrt(0.5));
  expect(summary.generated).toEqual(summary.observed);
});
test("VPC leaves censored times unidentified and does not invent single-person SD", () => {
  const group = { label: "One", color: "blue", observed: [study.subjects[0]], generated: [0] };
  const summary = covariateMoments({ ...study, assay: { lloq: 2, source: "test" } }, result, group);
  expect(summary.observed[0].mean).toBeNaN();
  expect(summary.observed[1]).toEqual({ time: 2, mean: 4, sd: null, n: 1 });
  expect(summary.generated[0].mean).toBe(2);
  const unmatched = covariateMoments(study, { ...result, queryTime: [10, 20, 30] }, group);
  expect(unmatched.generated.every(p => Number.isNaN(p.mean))).toBe(true);
});

test("grouping matches specified targets only and normalizes category casing", () => {
  const groups = covariateGroups(study, result, sex, 3);
  expect(groups.map(g => [g.label, g.observed.length, g.generated])).toEqual([["female", 1, [0]], ["male", 1, [1]]]);
});
test("continuous bins include maximum and every assigned row once", () => {
  const groups = covariateGroups(study, result, { key: "weight_kg", label: "Weight" }, 3);
  expect(groups.flatMap(g => g.generated)).toEqual([0, 1]);
  expect(groups[2].observed[0].id).toBe("b");
});
test("PK quantities use the shared observed window and matching stratum schedules", () => {
  const groups = covariateGroups(study, result, sex, 3);
  const pk = covariatePk(study, result, sex, groups, "AUC");
  expect(pk.window).toEqual([1, 3]);
  expect(pk.rows.map(r => r.value)).toEqual([6, 6, 8, 8]);
});
test("censored profiles do not produce spurious exact PK estimates", () => {
  const censored = { ...study, assay: { lloq: 2, source: "test" } };
  const pk = covariatePk(censored, result, sex, covariateGroups(censored, result, sex, 3), "Cmax");
  expect(pk.rows.filter(r => !r.generated).map(r => r.id)).toEqual(["b"]);
  expect(pk.excluded).toBe(1);
});
