// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { targetColumns, targetPayload } from "../app/components/TargetCovariateTable";
import { TargetPopulationControls } from "../app/components/TargetPopulationControls";
import { CovariateAnalysis } from "../app/components/CovariateAnalysis";
import { populationRule, sampleTargetPopulation } from "../app/lib/target-population";
import { covariateGroups } from "../app/lib/covariate-analysis";
import type { Study } from "../app/lib/types";

afterEach(cleanup);
const study = { timeUnit: "τ", concentrationUnit: "dimensionless concentration", subjects: [
  { id: "a", points: [[0, 0], [1, 2]], covariates: { weight_kg: 60, cov_cont_0: -2, cov_cat_0: 0 } },
  { id: "b", points: [[0, 0], [1, 3]], covariates: { weight_kg: 80, cov_cont_0: 3, cov_cat_0: 1 } },
], summary: [] } as unknown as Study;

test("generic inputs use the same population controls with context-derived defaults", () => {
  const columns = targetColumns(study);
  render(<TargetPopulationControls study={study} columns={columns} rules={{}} onChange={vi.fn()} />);
  expect((screen.getByLabelText("Generic continuous minimum") as HTMLInputElement).value).toBe("-2");
  expect((screen.getByLabelText("Generic continuous maximum") as HTMLInputElement).value).toBe("3");
  expect((screen.getByLabelText("Population Generic categorical") as HTMLSelectElement).value).toBe("random");
  const sampled = sampleTargetPopulation(study, columns, {
    cov_cont_0: { mode: "range", min: "0", max: "0" },
    cov_cat_0: { ...populationRule(study, columns[2]), mode: "0" },
  }, 4, 420);
  expect(sampled.error).toBe("");
  for (const row of targetPayload(sampled.rows, columns, 4)) {
    expect(row.cov_cont_0).toBe(0);
    expect(row.cov_cat_0).toBe("0");
  }
});

test("analysis exposes both generics and groups numeric category labels categorically", () => {
  render(<CovariateAnalysis study={study} result={null} />);
  expect(screen.getByRole("option", { name: "Generic continuous" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Generic categorical" })).toBeTruthy();
  const categorical = targetColumns(study).find(c => c.key === "cov_cat_0")!;
  expect(categorical.options).toEqual(["0", "1"]);
  expect(covariateGroups(study, null, categorical, 3).map(g => g.observed.length)).toEqual([1, 1]);
});
