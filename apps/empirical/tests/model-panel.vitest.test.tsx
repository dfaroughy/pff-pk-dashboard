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

const { DatasetUploadDialog, ModelPanel, firstParagraph, studyLabel } = await import("../app/components/Dashboard");
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
    timeBinning: "query_mesh",
    generatedIndividuals: 1,
    simulatedCohortReplicates: 200,
    requestedBins: 10,
    effectiveBins: 1,
    points: [{
      time: 24,
      timeLower: 24,
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

test("imports a custom PK dataset through the file picker", async () => {
  const user = userEvent.setup();
  const onStudy = vi.fn();
  render(<DatasetUploadDialog onClose={vi.fn()} onStudy={onStudy} />);
  const dataset = `ID,TIME,DV,ROUTE,DRUG
1,0.5,10,oral,test compound
1,2,5,oral,test compound
2,0.5,12,oral,test compound
2,2,4,oral,test compound`;
  await user.upload(
    screen.getByLabelText("Choose PK dataset file"),
    new File([dataset], "test.csv", { type: "text/csv" }),
  );

  await waitFor(() => expect(onStudy).toHaveBeenCalledOnce());
  expect(onStudy.mock.calls[0][0].drug).toBe("test compound");
  expect(onStudy.mock.calls[0][0].subjects).toHaveLength(2);
});

test("reports invalid custom PK datasets without closing the dialog", async () => {
  const user = userEvent.setup();
  const onStudy = vi.fn();
  render(<DatasetUploadDialog onClose={vi.fn()} onStudy={onStudy} />);
  await user.upload(
    screen.getByLabelText("Choose PK dataset file"),
    new File(["ID,TIME,ROUTE\n1,1,oral"], "invalid.csv", { type: "text/csv" }),
  );

  expect((await screen.findByRole("alert")).textContent).toContain("Missing required column: DV");
  expect(onStudy).not.toHaveBeenCalled();
});

test("imports a standard event table after route metadata is selected", async () => {
  const user = userEvent.setup();
  const onStudy = vi.fn();
  render(<DatasetUploadDialog onClose={vi.fn()} onStudy={onStudy} />);
  const dataset = "ID TIME Y\n1 0.5 10\n1 2 5\n2 0.5 12\n2 2 4";
  await user.upload(
    screen.getByLabelText("Choose PK dataset file"),
    new File([dataset], "standard.dta", { type: "text/plain" }),
  );

  expect((await screen.findByRole("alert")).textContent).toContain("Administration route is not encoded");
  await user.selectOptions(screen.getByLabelText("Administration route"), "oral");
  await waitFor(() => expect(onStudy).toHaveBeenCalledOnce());
  expect(onStudy.mock.calls[0][0].route).toBe("oral");
});

afterEach(() => {
  cleanup();
  mocks.runInference.mockReset();
});

test("exposes only conservative public inference controls", async () => {
  render(<ModelPanel study={study} onResult={vi.fn()} />);

  const draws = screen.getByLabelText("Generated individuals") as HTMLInputElement;
  expect(draws.valueAsNumber).toBe(20);
  expect(draws.max).toBe("100");
  expect(screen.queryByLabelText("Integrator")).toBeNull();
  expect(screen.queryByLabelText("Integration steps")).toBeNull();
  expect(screen.queryByLabelText("Checkpoint")).toBeNull();
  expect((screen.getByLabelText("Random seed") as HTMLInputElement).valueAsNumber).toBe(43);
  expect(screen.queryByRole("button", { name: "Resample" })).toBeNull();
  expect((screen.getByLabelText("Models") as HTMLSelectElement).value).toBe("pythia");
});

test("uses model-specific generation limits", async () => {
  const user = userEvent.setup();
  render(<ModelPanel study={study} onResult={vi.fn()} />);
  const draws = screen.getByLabelText("Generated individuals") as HTMLInputElement;
  await user.clear(draws);
  await user.type(draws, "100");
  expect(draws.max).toBe("100");

  await user.selectOptions(screen.getByLabelText("Models"), "pythia_dose");
  expect(draws.max).toBe("30");
  expect(draws.valueAsNumber).toBe(30);
});

test("renders the server-side Pharmpy VPC summary", () => {
  render(<ModelVpcChart result={response} study={study} logY={false} showEmpirical={false} />);
  const chart = screen.getByRole("img", { name: "Pythia-PK visual predictive check" });
  expect(chart.querySelectorAll("g[clip-path] > path")).toHaveLength(3);
  expect(chart.querySelectorAll("g[clip-path] > g")).toHaveLength(0);
  expect(chart.querySelectorAll("circle")).toHaveLength(0);
  const xTicks = [...chart.querySelectorAll("text.tick")].slice(0, 5).map((tick) => tick.textContent);
  expect(xTicks.at(-1)).toBe("24.0");
});

test("keeps the observed VPC on its original observation-time mesh after inference", () => {
  render(<ModelVpcChart result={response} study={study} logY={false} showEmpirical />);
  const chart = screen.getByRole("img", { name: "Pythia-PK visual predictive check" });
  const empiricalMarkers = [...chart.querySelectorAll("g[clip-path] circle")];
  expect(empiricalMarkers).toHaveLength(6);
  expect(empiricalMarkers.at(-1)?.getAttribute("cx")).toBe("698");
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
  const runButton = screen.getByRole("button", { name: "Run zero-shot inference" });
  expect(screen.getByRole("progressbar", { name: "Inference progress" }).getAttribute("aria-valuenow")).toBe("0");
  await waitFor(() => expect((runButton as HTMLButtonElement).disabled).toBe(false));
  await user.click(runButton);

  await waitFor(() => expect(mocks.runInference).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole("progressbar", { name: "Inference progress" }).getAttribute("aria-valuenow")).toBe("100"));
  expect(mocks.runInference.mock.calls[0][0].seed).toBe(43);
  expect(mocks.runInference.mock.calls[0][0].modelId).toBe("pythia");
  expect(mocks.runInference.mock.calls[0][0].doseEvents).toEqual([
    { time: 0, amount: 10, unit: "mg", route: "oral" },
  ]);
});

test("Pythia ignores an observed multidose protocol and submits a canonical reference event", async () => {
  const user = userEvent.setup();
  mocks.runInference.mockResolvedValue({
    ...response,
    request: { ...response.request, modelId: "pythia" },
  });
  render(<ModelPanel study={{
    ...study,
    doseEvents: [
      { time: 0, amount: 10, unit: "mg", route: "oral" },
      { time: 4, amount: 10, unit: "mg", route: "oral" },
      { time: 8, amount: 10, unit: "mg", route: "oral" },
    ],
  }} onResult={vi.fn()} />);

  const runButton = screen.getByRole("button", { name: "Run zero-shot inference" });
  await waitFor(() => expect((runButton as HTMLButtonElement).disabled).toBe(false));
  await user.click(runButton);

  await waitFor(() => expect(mocks.runInference).toHaveBeenCalledOnce());
  expect(mocks.runInference.mock.calls[0][0].doseEvents).toEqual([
    { time: 0, amount: 10, unit: "mg", route: "oral" },
  ]);
});

test("the user can select a reproducible inference seed", async () => {
  const user = userEvent.setup();
  mocks.runInference.mockResolvedValue(response);
  render(<ModelPanel study={study} onResult={vi.fn()} />);

  const seed = screen.getByLabelText("Random seed");
  await user.clear(seed);
  await user.type(seed, "1729");
  const runButton = screen.getByRole("button", { name: "Run zero-shot inference" });
  await waitFor(() => expect((runButton as HTMLButtonElement).disabled).toBe(false));
  await user.click(runButton);

  await waitFor(() => expect(mocks.runInference).toHaveBeenCalledOnce());
  expect(mocks.runInference.mock.calls[0][0].seed).toBe(1729);
});

test("intervention dose and time accept full decimal replacement and reach inference", async () => {
  const user = userEvent.setup();
  const onResult = vi.fn();
  mocks.runInference.mockResolvedValue(response);
  render(<ModelPanel study={study} onResult={onResult} />);

  await user.selectOptions(screen.getByLabelText("Models"), "pythia_dose");
  const runButton = await screen.findByRole("button", { name: "Run zero-shot inference" });
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
  await user.selectOptions(screen.getByLabelText("Models"), "pythia_dose");
  const runButton = await screen.findByRole("button", { name: "Run zero-shot inference" });
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

  await user.selectOptions(screen.getByLabelText("Models"), "pythia_dose");
  const runButton = await screen.findByRole("button", { name: "Run zero-shot inference" });
  await waitFor(() => expect((runButton as HTMLButtonElement).disabled).toBe(false));
  await user.click(runButton);
  await waitFor(() => expect(mocks.runInference).toHaveBeenCalledOnce());

  const amount = screen.getByLabelText("Dose 1 amount in mg");
  await user.clear(amount);
  await user.type(amount, "20");
  resolveInference(response);

  await waitFor(() => expect(screen.getByRole("button", { name: "Run zero-shot inference" })).toBeTruthy());
  expect(onResult).not.toHaveBeenCalledWith(response);
  expect(onResult).toHaveBeenCalledWith(null);
});
