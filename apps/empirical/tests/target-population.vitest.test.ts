import { expect, test } from "vitest";
import { sampleTargetPopulation } from "../app/lib/target-population";
import { targetColumns } from "../app/components/TargetCovariateTable";
import type { Study } from "../app/lib/types";
const study = { subjects: [
  { covariates: { sex: "female", age_years: 30, weight_kg: 60 } },
  { covariates: { sex: "male", age_years: 70, weight_kg: 90 } },
] } as unknown as Study;
const columns = targetColumns(study);
test("default sampling preserves complete rows and is seeded", () => {
  const a = sampleTargetPopulation(study, columns, {}, 20, 43);
  expect(a).toEqual(sampleTargetPopulation(study, columns, {}, 20, 43));
  expect(a.rows.every(row => row.age_years === "30" ? row.weight_kg === "60" : row.weight_kg === "90")).toBe(true);
  expect(a.rows).not.toEqual(sampleTargetPopulation(study, columns, {}, 20, 44).rows);
});
test("ranges constrain the donor pool and fixed values override each row", () => {
  const a = sampleTargetPopulation(study, columns, {
    age_years: { mode: "range", min: "20", max: "40" },
    sex: { mode: "male", min: "", max: "" },
    weight_kg: { mode: "range", min: "75", max: "75" },
  }, 3, 43);
  expect(a.rows).toEqual(Array(3).fill({ sex: "male", age_years: "30", weight_kg: "75" }));
});
test("impossible and invalid ranges report errors; unspecified stays masked", () => {
  for (const [min, max] of [["40", "50"], ["90", "50"], ["", "50"]]) {
    expect(sampleTargetPopulation(study, columns, { age_years: { mode: "range", min, max } }, 3, 43).error).not.toBe("");
  }
  expect(sampleTargetPopulation(study, columns, { sex: { mode: "unspecified", min: "", max: "" } }, 3, 43).rows.every(r => r.sex === "")).toBe(true);
});
