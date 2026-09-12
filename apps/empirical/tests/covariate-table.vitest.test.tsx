// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { CovariateTable } from "../app/components/CovariateTable";
import type { Study } from "../app/lib/types";
import corpus from "../public/data/corpus.json";

afterEach(cleanup);
test("all four complete cohorts appear exactly once in the catalogue", () => {
  for (const [drug, count] of [["warfarin", 32], ["tobramycin", 97], ["theophylline", 11], ["remifentanil", 65]] as const) {
    const matches = corpus.studies.filter((s) => s.id === `empirical-cossac-${drug}`);
    expect(matches).toHaveLength(1);
    expect(matches[0].subjects).toHaveLength(count);
  }
  expect(corpus.studies.some((s) => ["datasets::Theoph", "nlme::Remifentanil"].includes(s.source))).toBe(false);
});
test("renders every patient and covariate with units", () => {
  const study = corpus.studies.find((s) => s.id === "empirical-cossac-remifentanil") as unknown as Study;
  render(<CovariateTable study={study} />);
  expect(screen.getAllByRole("row")).toHaveLength(66);
  expect(screen.getByRole("columnheader", { name: "Weight (kg)" })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "Sex (source code)" })).toBeTruthy();
});
test("unions columns and preserves zeros and missing values", () => {
  const base = corpus.studies[0] as unknown as Study;
  const { rerender } = render(<CovariateTable study={{ ...base, subjects: [
    { id: "a", points: [], covariates: { score: 0 } },
    { id: "b", points: [], covariates: { sex: "F" } },
    { id: "c", points: [] },
  ] }} />);
  expect(screen.getByText("0")).toBeTruthy();
  expect(screen.getAllByRole("row")).toHaveLength(4);
  expect(screen.getAllByText("—")).toHaveLength(4);
  rerender(<CovariateTable study={{ ...base, subjects: [{ id: "x", points: [] }] }} />);
  expect(screen.queryByRole("table")).toBeNull();
});
