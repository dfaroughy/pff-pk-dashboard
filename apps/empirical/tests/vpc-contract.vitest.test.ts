import { expect, test } from "vitest";
import { observedVpc, vpcQuantile } from "../app/lib/pk";

test("VPC uses half-up order-statistic quantiles, including even cohorts", () => {
  expect(vpcQuantile([1, 2, 3, 4], .5)).toBe(3);
  expect(vpcQuantile([1, 2], .5)).toBe(2);
  expect(vpcQuantile([1, 2, 3, 4], .05)).toBe(1);
  expect(vpcQuantile([1, 2, 3, 4], .95)).toBe(4);
});

test("irregular observations are never grouped by within-person index", () => {
  const result = observedVpc({ subjects: [
    { points: [[.1, 1], [1, 2]] }, { points: [[.3, 3], [1, 4]] },
  ] });
  expect(result.map(p => p.time)).toEqual([.1, .3, 1]);
  expect(result.map(p => p.n)).toEqual([1, 1, 2]);
  expect(result[2].q50).toBe(4);
});
