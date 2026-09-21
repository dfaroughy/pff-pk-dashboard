// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { Chart, PkDistributionChart, TrajectoryChart } from "../app/components/StudyCharts";
import type { Point, Study } from "../app/lib/types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test.each([500, 1000])("renders %i dense individual curves without exceeding the JS argument limit", (count) => {
  const series = Array.from({ length: count }, () =>
    Array.from({ length: 1024 }, (_, i): Point => [i, 1 + i / 1024]));
  for (const logY of [false, true]) {
    const markup = renderToStaticMarkup(<Chart series={series} styles={[{ stroke: "blue" }]} logY={logY}
      xLabel="Time" yLabel="Concentration" ariaLabel="Large cohort" />);
    expect(markup).toContain("Large cohort");
    expect(markup).not.toMatch(/NaN|Infinity/);
  }
});

test("narrow charts wrap long concentration labels and retain space for data and ticks", () => {
  let resize: ResizeObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const study = {
    drug: "Example", timeUnit: "h", concentrationUnit: "dimensionless concentration normalized to reference dose",
    subjects: [{ id: "a", points: [[0, 0.000012], [1, 0.000001]] }], summary: [],
  } as unknown as Study;
  const { container, unmount } = render(<TrajectoryChart study={study} logY={false} />);
  act(() => resize([{ contentRect: { width: 320 } } as ResizeObserverEntry], {} as ResizeObserver));
  const svg = container.querySelector("svg")!;
  expect(svg.getAttribute("viewBox")?.split(" ")[2]).toBe("320");
  expect(Number(svg.getAttribute("viewBox")?.split(" ")[3])).toBeGreaterThanOrEqual(420);
  const plot = svg.querySelector("clipPath rect")!;
  expect(Number(plot.getAttribute("height"))).toBeGreaterThanOrEqual(220);
  expect(Number(plot.getAttribute("width"))).toBeGreaterThan(100);
  const titleLines = [...svg.querySelectorAll("tspan")];
  expect(titleLines.length).toBeGreaterThan(1);
  expect(titleLines.map(line => line.textContent).join(" ")).toContain("reference dose");
  const titleBottom = 24 * titleLines.length;
  expect(Number(plot.getAttribute("y"))).toBeGreaterThan(titleBottom);
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});


test("PK elimination rate and half-life render their suffixes as subscripts", () => {
  const study = {
    dose: 1, doseUnit: "mg", timeUnit: "h", concentrationUnit: "mg/L",
    subjects: [{ id: "a", points: [[0, 4], [1, 2], [2, 1], [3, 0.5]] }], summary: [],
  } as unknown as Study;
  const { container } = render(<PkDistributionChart study={study} result={null} />);
  const subscripts = [...container.querySelectorAll('.distribution-symbol tspan[baseline-shift="sub"]')].map(node => node.textContent);
  expect(subscripts).toContain("z");
  expect(subscripts).toContain("1/2");
});
