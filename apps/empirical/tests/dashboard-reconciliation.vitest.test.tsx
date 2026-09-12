// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ draw: 0, study: {
  id: "initial", drug: "Synthetic cohort", study: "test", route: "oral", source: "test",
  dose: 1, doseUnit: "mg", concentrationUnit: "mg/L", timeUnit: "h", summary: [],
  subjects: [
    { id: "a", points: [[0.1, 2], [1, 1]], covariates: { weight_kg: 60 } },
    { id: "b", points: [[0.1, 3], [1, 2]], covariates: { weight_kg: 80 } },
  ],
} }));
vi.mock("../app/lib/model-api", () => ({
  serviceStatus: vi.fn().mockResolvedValue({ ready: true, defaultModelId: "pythia", models: {
    pythia: { ready: true }, pythia_covariates: { ready: true },
  } }), runInference: vi.fn(), syntheticRequest: vi.fn(),
}));
vi.mock("../app/components/SyntheticStudyBuilder", () => ({
  SyntheticStudyBuilder: ({ onGenerate, onInvalidate }: { onGenerate: (s: unknown) => void; onInvalidate: () => void }) => <>
    <button onClick={() => onGenerate({ ...state.study, id: `draw-${++state.draw}` })}>Test new cohort</button>
    <button onClick={onInvalidate}>Test invalidate cohort</button>
  </>,
}));
vi.mock("../app/components/StudyCharts", () => ({
  ModelTrajectoryChart: () => null, ModelVpcChart: () => null, PkDistributionChart: () => null,
  TrajectoryChart: () => null, VpcChart: () => null, Chart: () => null,
}));
const { Dashboard } = await import("../app/components/Dashboard");
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("failed catalogue requests show a retry instead of an endless loader", async () => {
  window.history.replaceState(null, "", "/synthetic/");
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: false })
    .mockResolvedValue({ ok: true, json: async () => ({ studies: [state.study] }) });
  vi.stubGlobal("fetch", fetcher);
  render(<Dashboard />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("button", { name: "Test new cohort" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test("repeated synthetic draws retain exactly one model panel without duplicate keys", async () => {
  window.history.replaceState(null, "", "/synthetic/");
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ studies: [state.study] }) }));
  render(<StrictMode><Dashboard /></StrictMode>);
  await screen.findByRole("button", { name: "Test new cohort" });
  expect((screen.getByLabelText("Synthetic cohort") as HTMLSelectElement).value).toBe("v7");
  for (let i = 0; i < 5; i++) {
    await userEvent.click(screen.getByRole("button", { name: "Test new cohort" }));
    await waitFor(() => expect(screen.getAllByRole("combobox", { name: "Models" })).toHaveLength(1));
    expect(screen.getAllByRole("heading", { name: "Prior-fitted flows" })).toHaveLength(1);
    expect(screen.getByText("Covariate analysis").closest("details")?.open).toBe(true);
    expect(screen.getByRole("switch", { name: "Covariate VPC linear scale" })).toBeTruthy();
    expect(screen.queryByLabelText("Covariate concentration scale")).toBeNull();
    expect(screen.queryByText("Solid: study · dashed: generated · censored study values omitted.")).toBeNull();
  }
  await userEvent.click(screen.getByRole("button", { name: "Test invalidate cohort" }));
  expect(screen.getAllByRole("heading", { name: "Prior-fitted flows" })).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Test new cohort" }));
  expect(screen.getAllByRole("combobox", { name: "Models" })).toHaveLength(1);
  expect(errors.mock.calls.filter(args => args.some(a => String(a).includes("same key")))).toEqual([]);
});
