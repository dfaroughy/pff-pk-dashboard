// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { generatedObservationCurves } from "../app/lib/generated-observations";
import { ModelTrajectoryChart } from "../app/components/StudyCharts";
import type { InferenceResponse } from "../app/lib/model-api";
import type { Study } from "../app/lib/types";

afterEach(cleanup);
const study = {
  subjects: [
    { id: "a", points: [[0.1, 1], [0.4, 2], [1, 1]] },
    { id: "b", points: [[0.2, 2], [0.6, 3], [1, 2]] },
  ],
} as Study;
const result = {
  queryTime: [0.1000000015, 0.200000003, 0.400000006, 0.600000024, 1],
  generatedConcentration: [[10, 20, 30, 40, 50], [11, 21, 31, 41, 51], [12, 22, 32, 42, 52]],
  units: { time: "τ", concentration: "dimensionless" },
} as InferenceResponse;

test("irregular generated observations match individual schedules, not their union", () => {
  const before = structuredClone(result);
  expect(generatedObservationCurves(result, study)).toEqual([
    [[0.1, 10], [0.4, 30], [1, 50]],
    [[0.2, 21], [0.6, 41], [1, 51]],
    [[0.1, 12], [0.4, 32], [1, 52]],
  ]);
  expect(result).toEqual(before);
});

test("shared exact schedules keep all their observations", () => {
  const exact = { subjects: [study.subjects[0], study.subjects[0]] };
  expect(generatedObservationCurves(result, exact).map((curve) => curve.map(([t]) => t)))
    .toEqual([[0.1, 0.4, 1], [0.1, 0.4, 1], [0.1, 0.4, 1]]);
});

test("missing query support is not interpolated or extrapolated", () => {
  const missing = { ...result, queryTime: [0.1, 0.2, 0.4, 0.6, 0.9] };
  expect(generatedObservationCurves(missing, study)[0]).toEqual([[0.1, 10], [0.4, 30]]);
});

test("rendered generated curves have only the matched schedule's markers and segments", () => {
  const { container } = render(<ModelTrajectoryChart result={result} study={study} logY={false} showEmpirical />);
  expect(container.querySelectorAll('circle[fill="var(--generated)"]')).toHaveLength(9);
  expect(container.querySelectorAll('circle[fill="var(--trajectory-blue)"]')).toHaveLength(6);
  for (const path of container.querySelectorAll('path[stroke="var(--generated)"]')) {
    expect(path.getAttribute("d")?.match(/L/g)).toHaveLength(2);
  }
});
