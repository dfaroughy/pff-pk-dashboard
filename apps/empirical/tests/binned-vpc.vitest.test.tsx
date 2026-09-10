// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { VpcPanel } from "../app/components/Dashboard";
import { ModelVpcChart, VpcChart } from "../app/components/StudyCharts";
import { syntheticRequest, type InferenceResponse } from "../app/lib/model-api";
import type { Study } from "../app/lib/types";

vi.mock("../app/lib/model-api", () => ({ syntheticRequest: vi.fn(), runInference: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const study = {
  id: "irregular", drug: "Synthetic", timeUnit: "τ", concentrationUnit: "dimensionless", summary: [],
  subjects: [{ id: "a", points: [[.1, 1], [.8, .5]] }, { id: "b", points: [[.2, 2], [.9, .8]] }],
} as unknown as Study;
const points = [
  { time: .15, n: 2, q05: 1, q50: 1.5, q95: 2 },
  { time: .85, n: 2, q05: .5, q50: .65, q95: .8 },
];

test("irregular observed preview uses returned binned statistics", async () => {
  vi.mocked(syntheticRequest).mockResolvedValue({ points });
  const { container } = render(<VpcChart study={study} logY={false} />);
  await waitFor(() => expect(container.querySelectorAll("circle")).toHaveLength(6));
  expect(syntheticRequest).toHaveBeenCalledWith({ action: "vpc", study }, expect.any(AbortSignal));
});

test("model VPC plots binned observed percentiles rather than unbinned study rows", () => {
  const result = {
    units: { time: "τ", concentration: "dimensionless" },
    vpc: { method: "pharmpy", methodVersion: "pharmpy-binned-bootstrap-v1", timeBinning: "equal_number",
      points: points.map((p, index) => ({
        time: p.time, timeLower: index * .5, timeUpper: (index + 1) * .5,
        nObservations: 2, observed: p,
        simulated: Object.fromEntries(["q05", "q50", "q95"].map((key) => [key, { center: 1, lower: .5, upper: 2 }])),
      })),
    },
  } as unknown as InferenceResponse;
  const { container } = render(<ModelVpcChart result={result} study={study} logY={false} showEmpirical />);
  expect(container.querySelectorAll("circle")).toHaveLength(6);
  expect(syntheticRequest).not.toHaveBeenCalled();
});


test("manual bin input rebins observed and generated VPCs from the existing pool", async () => {
  const vpc = {
    method: "pharmpy", methodVersion: "pharmpy-binned-bootstrap-v1", effectiveBins: 2,
    generatedIndividuals: 1, simulatedCohortReplicates: 200,
    points: points.map(p => ({ time: p.time, timeLower: p.time - .05, timeUpper: p.time + .05, nObservations: p.n, observed: p,
      simulated: { q05: { center: 1, lower: .5, upper: 2 }, q50: { center: 1, lower: .5, upper: 2 }, q95: { center: 1, lower: .5, upper: 2 } },
    })),
  } as InferenceResponse["vpc"];
  const result = { units: { time: "τ", concentration: "dimensionless" },
    queryTime: [.1, .2, .8, .9], generatedConcentration: [[1, 2, .5, .8]], vpc,
  } as InferenceResponse;
  vi.mocked(syntheticRequest).mockResolvedValue({ ...vpc, effectiveBins: 1, points: vpc.points.slice(0, 1) });
  const { container } = render(<VpcPanel study={study} result={result} logY={false} onLogY={vi.fn()} />);
  expect(syntheticRequest).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("VPC number of bins"), { target: { value: "1" } });
  await waitFor(() => expect(container.querySelectorAll("circle")).toHaveLength(3));
  expect(syntheticRequest).toHaveBeenCalledWith({ action: "vpc", study, numBins: 1,
    queryTime: result.queryTime, generatedConcentration: result.generatedConcentration,
  }, expect.any(AbortSignal));
  expect(screen.getByText(/Pharmpy uses 1 time bins/)).toBeTruthy();
});

test("manual bins also rebin an exact observed schedule", async () => {
  const exact = { ...study, subjects: study.subjects.map(s => ({ ...s, points: study.subjects[0].points })) };
  vi.mocked(syntheticRequest).mockResolvedValue({ effectiveBins: 1, points: points.slice(0, 1) });
  const { container } = render(<VpcPanel study={exact} result={null} logY={false} onLogY={vi.fn()} />);
  expect(syntheticRequest).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("VPC number of bins"), { target: { value: "1" } });
  await waitFor(() => expect(container.querySelectorAll("circle")).toHaveLength(3));
  expect(syntheticRequest).toHaveBeenCalledWith({ action: "vpc", study: exact, numBins: 1 }, expect.any(AbortSignal));
});
