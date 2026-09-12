// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { observedVpc } from "../app/lib/pk";
import { ModelVpcChart, VpcChart } from "../app/components/StudyCharts";
import type { Study } from "../app/lib/types";
import type { InferenceResponse } from "../app/lib/model-api";

afterEach(cleanup);
const study = {
  id: "assay", drug: "test", timeUnit: "h", concentrationUnit: "mg/L", assay: { lloq: 1, source: "test assay" },
  subjects: Array.from({ length: 20 }, (_, i) => ({ id: String(i), points: [[0, 2 + i], [1, i < 12 ? 1 : 3 + i], [2, 4 + i]], cens: [0, i < 12 ? 1 : 0, 0] })), summary: [],
} as unknown as Study;

test("BLQ ranks hide unidentifiable percentiles without discarding people", () => {
  const points = observedVpc(study);
  expect(points[1]).toMatchObject({ n: 20, q05: null, q50: null, q95: 21, blq: { observed: { lower: .6, upper: .6 } } });
  expect(points[0].q05).not.toBeNull();
  expect(points[2].q50).not.toBeNull();
});

test.each([false, true])("censored VPC breaks lines and displays zero BLQ fractions, log=%s", logY => {
  render(<VpcChart study={study} logY={logY} />);
  const chart = screen.getByRole("img", { name: "Observed visual predictive check for test" });
  const median = chart.querySelector('path[stroke="var(--magenta)"]')!;
  expect(median.getAttribute("d")?.match(/M/g)).toHaveLength(2);
  expect(median.getAttribute("d")).not.toContain("L");
  expect(median.parentElement?.querySelectorAll("circle")).toHaveLength(2);
  const fractions = screen.getByRole("img", { name: "Fraction of observations below the quantification limit" });
  expect(fractions.querySelectorAll("circle")).toHaveLength(3);
  expect(fractions.textContent).toContain("0%");
  expect(fractions.textContent).toContain("100%");
});

test("unresolved floor flags are a range, not confirmed censored observations", () => {
  const unresolved = { ...study, subjects: study.subjects.map(s => ({ ...s, cens: s.cens!.map(v => v === 1 ? null : v) })) };
  expect(observedVpc(unresolved)[1].blq?.observed).toEqual({ lower: 0, upper: .6, nCensored: 0, nUnresolved: 12 });
  render(<VpcChart study={unresolved} logY={false} />);
  expect(screen.getByText("Study range (unresolved flags)")).toBeTruthy();
});

test("generated bands break at unavailable bins without NaN paths or bridges", () => {
  const result = {
    units: { time: "h", concentration: "mg/L" },
    vpc: { method: "mesh_bootstrap", censoring: { lloq: 1, methodVersion: "assay-aware-v1" }, points: [0, 1, 2].map(time => ({
      time, nObservations: 20, observed: { q05: time === 1 ? null : 2, q50: time === 1 ? null : 3, q95: 4 },
      simulated: Object.fromEntries(["q05", "q50", "q95"].map(key => [key, { center: time === 1 ? null : 3, lower: time === 1 ? null : 2, upper: time === 1 ? null : 4 }])),
      blq: { observed: { lower: .6, upper: .6, nCensored: 12, nUnresolved: 0 }, simulated: { center: 0, lower: 0, upper: 0 } },
    })) },
  } as unknown as InferenceResponse;
  const { container } = render(<ModelVpcChart study={study} result={result} showEmpirical logY={false} />);
  const band = screen.getByRole("img", { name: "Pythia-PK visual predictive check" }).querySelector('path[fill="var(--generated-band-fill)"]')!;
  expect(band.getAttribute("d")?.match(/M/g)).toHaveLength(2);
  expect(band.getAttribute("d")?.match(/Z/g)).toHaveLength(2);
  for (const path of container.querySelectorAll("path")) expect(path.getAttribute("d")).not.toMatch(/NaN|Infinity/);
});
