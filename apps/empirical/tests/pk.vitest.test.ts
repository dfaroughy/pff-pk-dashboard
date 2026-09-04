import { expect, test } from "vitest";
import { pkEstimatesFromPoints } from "../app/lib/pk";

test("computes per-individual descriptive PK quantities", () => {
  const estimates = pkEstimatesFromPoints(
    [[0, 1], [1, 4], [2, 2], [3, 1], [4, 0.5]],
    "ng/mL",
    "h",
  );

  expect(estimates.map((estimate) => estimate.symbol)).toEqual(["Cmax", "Tmax", "AUClast", "λz", "t½"]);
  expect(estimates[0].value).toBe(4);
  expect(estimates[1].value).toBe(1);
  expect(estimates[2].value).toBeCloseTo(7.75);
  expect(estimates[3].value).toBeCloseTo(Math.log(2));
  expect(estimates[4].value).toBeCloseTo(1);
});
