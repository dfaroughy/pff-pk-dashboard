// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { InferenceResponse } from "../app/lib/model-api";
import type { Study } from "../app/lib/types";

const mocks = vi.hoisted(() => ({ runInference: vi.fn() }));

vi.mock("../app/lib/model-api", () => ({
  runInference: mocks.runInference,
  serviceStatus: vi.fn().mockResolvedValue({
    ready: true, loaded: true, device: "cpu", checkpointId: "dose.ckpt", defaultModelId: "pythia_dose",
    models: {
      pythia: { ready: true, loaded: false, device: "cpu", checkpointId: "digital.ckpt", modelId: "pythia", label: "Pythia", supportsDose: false },
      pythia_dose: { ready: true, loaded: true, device: "cpu", checkpointId: "dose.ckpt", modelId: "pythia_dose", label: "Pythia-Dose", supportsDose: true },
    },
  }),
}));

const { ModelPanel, firstParagraph, studyLabel } = await import("../app/components/Dashboard");
const { ModelVpcChart } = await import("../app/components/StudyCharts");

const study: Study = {
  id: "test-study",
  origin: "test",
  drug: "test drug",
  administeredDrug: "test drug",
  study: "test",
  source: "test",
  route: "oral",
  dose: 10,
  doseUnit: "mg",
  doseEvents: [{ time: 0, amount: 10, unit: "mg", route: "oral" }],
  concentrationUnit: "ng/mL",
  timeUnit: "h",
  medium: "plasma",
  unitClass: "mass",
  subjects: [
    { id: "a", points: [[0.5, 2], [24, 0.1]] },
    { id: "b", points: [[0.5, 3], [24, 0.2]] },
  ],
  summary: [],
};

const response: InferenceResponse = {
  inferenceId: "test-result",
  createdAt: "2026-09-04T00:00:00Z",
  checkpointId: "test.ckpt",
  request: { modelId: "pythia_dose", doseEvents: [], nDraws: 20, solver: { method: "heun", steps: 8 }, seed: 1, studyId: study.id },
  queryTime: [0.5, 24],
  generatedConcentration: [[1, 0.1]],
  vpc: {
    method: "pharmpy",
    generatedIndividuals: 1,
    simulatedCohortReplicates: 200,
    requestedBins: 10,
    effectiveBins: 1,
    points: [{
      time: 12,
      timeLower: 0.5,
      timeUpper: 24,
      nObservations: 4,
      observed: { q05: 0.1, q50: 1, q95: 3 },
      simulated: {
        q05: { center: 0.1, lower: 0.1, upper: 0.1 },
        q50: { center: 0.5, lower: 0.1, upper: 1 },
        q95: { center: 1, lower: 1, upper: 1 },
      },
    }],
  },
  units: { time: "h", concentration: "ng/mL" },
  provenance: { checkpointSha256: "abc", normalization: "test", sourceProcess: {}, device: "cpu", runtimeSeconds: 0.1 },
};

test("study labels add dose only when one analyte has multiple datasets", () => {
  const secondDose = { ...study, id: "test-study-2", dose: 20 };
  expect(studyLabel(study, [study])).toBe("test drug");
  expect(studyLabel(study, [study, secondDose])).toBe("test drug — 10 mg");
  expect(studyLabel(secondDose, [study, secondDose])).toBe("test drug — 20 mg");
});

test("Wikipedia extracts are reduced to the first paragraph", () => {
  expect(firstParagraph("First paragraph.\n\nSecond paragraph.")).toBe("First paragraph.");
});

afterEach(() => {
  cleanup();
  mocks.runInference.mockReset();
});

test("exposes only the conservative generated-individual control", async () => {
  render(<ModelPanel study={study} onResult={vi.fn()} />);

  const draws = screen.getByLabelText("Generated individuals") as HTMLInputElement;
  expect(draws.valueAsNumber).toBe(20);
  expect(draws.max).toBe("30");
  expect(screen.queryByLabelText("Integrator")).toBeNull();
  expect(screen.queryByLabelText("Integration steps")).toBeNull();
  expect(screen.queryByLabelText("Checkpoint")).toBeNull();
  expect(screen.getByRole("button", { name: "Pythia" }).getAttribute("aria-pressed")).toBe("true");
});

test("renders the server-side Pharmpy VPC summary", () => {
  render(<ModelVpcChart result={response} logY={false} showEmpirical={true} />);
  expect(screen.getByRole("img", { name: "Pythia-PK visual predictive check computed with Pharmpy" })).toBeTruthy();
});

test("Pythia is generation-only and sends the baseline protocol", async () => {
  const user = userEvent.setup();
  mocks.runInference.mockResolvedValue({
    ...response,
    request: { ...response.request, modelId: "pythia" },
  });
  render(<ModelPanel study={study} onResult={vi.fn()} />);

  expect(screen.queryByRole("button", { name: "+ Add intervention" })).toBeNull();
  expect(screen.queryByLabelText("Dose 1 amount in mg")).toBeNull();
  const runButton = screen.getByRole("button", { name: "Run Pythia" });
  await waitFor(() => expect((runButton as HTMLButtonElement).disabled).toBe(false));
  await user.click(runButton);

  await waitFor(() => expect(mocks.runInference).toHaveBeenCalledOnce());
  expect(mocks.runInference.mock.calls[0][0].seed).toBe(42);
  expect(mocks.runInference.mock.calls[0][0].modelId).toBe("pythia");
  expect(mocks.runInference.mock.calls[0][0].doseEvents).toEqual([
    { time: 0, amount: 10, unit: "mg", route: "oral" },
  ]);
});

test("resampling advances the seed and requests new individuals", async () => {
  const user = userEvent.setup();
  mocks.runInference.mockResolvedValue(response);
  render(<ModelPanel study={study} onResult={vi.fn()} />);

  const runButton = screen.getByRole("button", { name: "Run Pythia" });
  await waitFor(() => expect((runButton as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByRole("button", { name: "Resample" })).toBeNull();
  await user.click(runButton);
  await waitFor(() => expect(screen.getByRole("button", { name: "Resample" })).toBeTruthy());
  await user.click(screen.getByRole("button", { name: "Resample" }));

  await waitFor(() => expect(mocks.runInference).toHaveBeenCalledTimes(2));
  expect(mocks.runInference.mock.calls[0][0].seed).toBe(42);
  expect(mocks.runInference.mock.calls[1][0].seed).toBe(43);
});

test("intervention dose and time accept full decimal replacement and reach inference", async () => {
  const user = userEvent.setup();
  const onResult = vi.fn();
  mocks.runInference.mockResolvedValue(response);
  render(<ModelPanel study={study} onResult={onResult} />);

  await user.click(screen.getByRole("button", { name: "Pythia-Dose" }));
  const runButton = await screen.findByRole("button", { name: "Run Pythia-Dose" });
  await waitFor(() => expect((runButton as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByLabelText("Dose 1 time in h") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Remove dose 1" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "+ Add intervention" }));

  const time = screen.getByLabelText("Dose 2 time in h");
  const amount = screen.getByLabelText("Dose 2 amount in mg");
  await user.clear(time);
  await user.type(time, "2.3");
  await user.clear(amount);
  await user.type(amount, "40");

  expect((time as HTMLInputElement).valueAsNumber).toBe(2.3);
  expect((amount as HTMLInputElement).valueAsNumber).toBe(40);
  expect(screen.getByText("4× context")).toBeTruthy();
  await user.click(runButton);

  await waitFor(() => expect(mocks.runInference).toHaveBeenCalledOnce());
  expect(mocks.runInference.mock.calls[0][0].doseEvents).toEqual([
    { time: 0, amount: 10, unit: "mg", route: "oral" },
    { time: 2.3, amount: 40, unit: "mg", route: "oral" },
  ]);
  expect(mocks.runInference.mock.calls[0][0].modelId).toBe("pythia_dose");
  expect(mocks.runInference.mock.calls[0][0].solver).toEqual({ method: "heun", steps: 8 });
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(response));
});

test("invalid transient values disable inference instead of becoming zero", async () => {
  const user = userEvent.setup();
  render(<ModelPanel study={study} onResult={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Pythia-Dose" }));
  const runButton = await screen.findByRole("button", { name: "Run Pythia-Dose" });
  await waitFor(() => expect((runButton as HTMLButtonElement).disabled).toBe(false));

  await user.clear(screen.getByLabelText("Dose 1 amount in mg"));
  expect(screen.getByText("Enter a dose")).toBeTruthy();
  expect((runButton as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.runInference).not.toHaveBeenCalled();
});

test("editing a protocol aborts and discards an in-flight result", async () => {
  const user = userEvent.setup();
  const onResult = vi.fn();
  let resolveInference: (value: InferenceResponse) => void = () => undefined;
  mocks.runInference.mockReturnValue(new Promise<InferenceResponse>((resolve) => { resolveInference = resolve; }));
  render(<ModelPanel study={study} onResult={onResult} />);

  await user.click(screen.getByRole("button", { name: "Pythia-Dose" }));
  const runButton = await screen.findByRole("button", { name: "Run Pythia-Dose" });
  await waitFor(() => expect((runButton as HTMLButtonElement).disabled).toBe(false));
  await user.click(runButton);
  await waitFor(() => expect(mocks.runInference).toHaveBeenCalledOnce());

  const amount = screen.getByLabelText("Dose 1 amount in mg");
  await user.clear(amount);
  await user.type(amount, "20");
  resolveInference(response);

  await waitFor(() => expect(screen.getByRole("button", { name: "Run Pythia-Dose" })).toBeTruthy());
  expect(onResult).not.toHaveBeenCalledWith(response);
  expect(onResult).toHaveBeenCalledWith(null);
});
