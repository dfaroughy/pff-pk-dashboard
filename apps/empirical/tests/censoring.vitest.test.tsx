// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { applySyntheticCensoring, drawCensoring, withAssayMetadata } from "../app/lib/censoring";
import { TrajectoryChart, VpcChart } from "../app/components/StudyCharts";
import type { Study } from "../app/lib/types";

afterEach(cleanup);
test("censoring draws are reproducible, bounded, and include both flags", () => {
  const draws = Array.from({ length: 1000 }, (_, seed) => drawCensoring(seed));
  expect(drawCensoring(46)).toEqual(drawCensoring(46));
  expect(new Set(draws.map((d) => d.enabled)).size).toBe(2);
  expect(draws.every((d) => d.ratio >= 10 && d.ratio <= 100)).toBe(true);
});
const study: Study = {
  id: "lenuzza-digoxin", drug: "digoxin", administeredDrug: "digoxin",
  origin: "Lenuzza", study: "test", source: "test", route: "oral",
  dose: 1, doseUnit: "mg", concentrationUnit: "ng/mL", timeUnit: "h",
  medium: "plasma", unitClass: "mass", summary: [],
  subjects: [{ id: "1", points: [[0, 0.01], [0.5, 1], [1, 0.05]] }],
};

test("Lenuzza-specific digoxin limit preserves raw data and uncertainty", () => {
  const annotated = withAssayMetadata(study);
  expect(annotated.assay?.lloq).toBe(0.05);
  expect(annotated.subjects[0].cens).toEqual([null, 0, null]);
  expect(annotated.subjects[0].points).toEqual(study.subjects[0].points);
  expect(study.assay).toBeUndefined();
  expect(withAssayMetadata({ ...study, concentrationUnit: "g/L" }).assay).toBeUndefined();
  expect(withAssayMetadata({ ...study, id: "other-digoxin" }).assay).toBeUndefined();
});

test("synthetic censoring retains latent values, times, and a dose-independent limit", () => {
  const synthetic = { ...study, origin: "Synthetic" };
  const floored = applySyntheticCensoring(synthetic, 0.05);
  expect(floored.subjects[0].points).toEqual([[0, 0.05], [0.5, 1], [1, 0.05]]);
  expect(floored.subjects[0].cens).toEqual([1, 0, 0]);
  expect(floored.subjects[0].latentPoints).toEqual(study.subjects[0].points);
  expect(applySyntheticCensoring({ ...synthetic, dose: 4 }, 0.05).assay?.lloq).toBe(0.05);
  expect(applySyntheticCensoring(floored, 0.005).subjects[0].points).toEqual(study.subjects[0].points);
  expect(() => applySyntheticCensoring(synthetic, 0)).toThrow();
  expect(() => applySyntheticCensoring(study, 0.05)).toThrow();
});

test.each([false, true])("LLOQ appears in trajectories and VPC (log=%s)", (logY) => {
  const annotated = withAssayMetadata(study);
  render(<><TrajectoryChart study={annotated} logY={logY} /><VpcChart study={annotated} logY={logY} /></>);
  expect(screen.getAllByText("LLOQ 0.0500")).toHaveLength(2);
  expect(screen.getAllByLabelText("Unresolved censoring")).toHaveLength(2);
  expect(screen.queryByLabelText("Censored observation")).toBeNull();
});

test("synthetic censored points are explicitly marked", () => {
  render(<TrajectoryChart study={applySyntheticCensoring({ ...study, origin: "Synthetic" }, 0.05)} logY={false} showLatent />);
  expect(screen.getAllByLabelText("Censored observation")).toHaveLength(1);
});

test.each([false, true])("reported curves join each subject's censoring markers at the actual times (log=%s)", (logY) => {
  const cohort = applySyntheticCensoring({ ...study, origin: "Synthetic", subjects: [
    { id: "a", points: [[0.1, 1], [0.3, 0.02], [1, 0.001]] },
    { id: "b", points: [[0.1, 2], [0.6, 0.03], [1, 0.002]] },
  ] }, 0.05);
  const { container } = render(<TrajectoryChart study={cohort} logY={logY} showLatent />);
  const paths = [...container.querySelectorAll('path[fill="none"]')];
  // Two latent paths followed by two reported paths. Every reported vertex
  // must coincide with its observation marker, including both floor times.
  expect(paths).toHaveLength(4);
  const triangles = screen.getAllByLabelText("Censored observation");
  paths.slice(2).forEach((path, subjectIndex) => {
    const vertices = [...path.getAttribute("d")!.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)];
    const circles = [...path.parentElement!.querySelectorAll("circle")];
    expect(vertices).toHaveLength(3);
    vertices.forEach((vertex, i) => {
      expect(Number(vertex[1])).toBeCloseTo(Number(circles[i].getAttribute("cx")), 2);
      expect(Number(vertex[2])).toBeCloseTo(Number(circles[i].getAttribute("cy")), 2);
      if (i > 0) {
        const triangle = triangles[subjectIndex * 2 + i - 1];
        const tip = [...triangle.getAttribute("d")!.matchAll(/L([\d.-]+),([\d.-]+)/g)].at(-1)!;
        expect(Number(tip[1])).toBeCloseTo(Number(vertex[1]), 2);
        expect(Number(tip[2]) - 3).toBeCloseTo(Number(vertex[2]), 2);
      }
    });
  });
});
