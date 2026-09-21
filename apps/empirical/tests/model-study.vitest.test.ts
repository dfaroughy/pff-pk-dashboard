import { expect, test } from "vitest";
import { modelEvaluationStudy } from "../app/lib/model-study";
import type { Study } from "../app/lib/types";
import type { InferenceResponse } from "../app/lib/model-api";

test("TabPFN rebinning excludes time zero with aligned censoring flags and no mutation", () => {
  const study = { subjects: [{ id: "a", points: [[0, 1], [1, 2], [2, 3]], cens: [1, 0, 0] }] } as Study;
  const result = { request: { modelId: "tabpfn" } } as InferenceResponse;
  const aligned = modelEvaluationStudy(study, result);
  expect(aligned.subjects[0].points).toEqual([[1, 2], [2, 3]]);
  expect(aligned.subjects[0].cens).toEqual([0, 0]);
  expect(study.subjects[0].points).toHaveLength(3);
  expect(modelEvaluationStudy(study, { request: { modelId: "pythia" } } as InferenceResponse)).toBe(study);
});
