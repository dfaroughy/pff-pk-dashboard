import { expect, test } from "vitest";
import { targetGrid } from "../app/lib/observation-protocol";
import { generatedObservationCurves } from "../app/lib/generated-observations";
import type { InferenceResponse } from "../app/lib/model-api";

test("study is default; uniform includes endpoints; custom sorts and deduplicates", () => {
  expect(targetGrid("study", "", "", "", "")).toEqual({});
  expect(targetGrid("uniform", "0", "4", "3", "").times).toEqual([0, 2, 4]);
  expect(targetGrid("custom", "", "", "", "3, 0; 1 1").times).toEqual([0, 1, 3]);
  expect(targetGrid("uniform", "", "4", "3", "").error).toBeTruthy();
  expect(targetGrid("uniform", "0", "4", "257", "").error).toBeTruthy();
  expect(targetGrid("custom", "", "", "", "-1, 2").error).toBeTruthy();
});

test("custom target curves are not projected back onto the context mesh", () => {
  const result = { queryTime: [0, 2, 4], generatedConcentration: [[3, 2, 1]],
    request: { targetTimes: [0, 2, 4] } as InferenceResponse["request"] };
  expect(generatedObservationCurves(result, { subjects: [{ id: "a", points: [[1, 2], [3, 1]] }] }))
    .toEqual([[[0, 3], [2, 2], [4, 1]]]);
});
