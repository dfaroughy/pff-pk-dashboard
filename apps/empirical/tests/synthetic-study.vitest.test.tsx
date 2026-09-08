// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { Dashboard, SyntheticResultsPlaceholder } from "../app/components/Dashboard";
import { SyntheticStudyBuilder, balanceEquation, nodePosition } from "../app/components/SyntheticStudyBuilder";
import { generateSyntheticCohort, previewSyntheticObservationTimes, sampleSyntheticModel } from "../app/lib/synthetic-study";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("compartment layouts retain node spacing across sampled chain lengths", () => {
  for (let seed = 0; seed < 200; seed++) {
    const { graph } = sampleSyntheticModel(seed);
    const positions = graph.nodes.map((node) => nodePosition(graph, node.id));
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        expect(Math.hypot(positions[i].x - positions[j].x, positions[i].y - positions[j].y)).toBeGreaterThanOrEqual(24);
      }
    }
  }
});

test("reserves all synthetic result panels before cohort generation", () => {
  render(<SyntheticResultsPlaceholder />);

  expect(screen.getByRole("img", { name: "Empty visual predictive check" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "Empty individual concentration profiles" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "Empty pharmacokinetic quantity distributions" })).toBeTruthy();
});

test("generates a deterministic study with the requested bounded shape", () => {
  const model = sampleSyntheticModel(43);
  const study = generateSyntheticCohort(model, 10, 16);

  expect(study.origin).toBe("Synthetic v6");
  expect(study.subjects).toHaveLength(10);
  expect(study.subjects.every((subject) => subject.points.length === 16)).toBe(true);
  expect(study.subjects[0].points.map(([time]) => time)).toEqual(
    study.subjects[9].points.map(([time]) => time),
  );
  expect(study.subjects.flatMap((subject) => subject.points).every(([time, value]) => (
    time > 0 && time <= 1 && Number.isFinite(value) && value > 0
  ))).toBe(true);
  expect(study.doseEvents?.length).toBeGreaterThan(0);
});

test("renders compartment balances as signed sums of fluxes", () => {
  const model = sampleSyntheticModel(43);
  const centralBalance = balanceEquation(model.graph, model.graph.central);
  const incoming = model.graph.edges.filter((edge) => edge.dst === model.graph.central);

  expect(incoming.length).toBeGreaterThan(1);
  incoming.slice(1).forEach((edge) => {
    expect(centralBalance).toContain(`+J_{${String.fromCharCode(97 + edge.src)}a}`);
  });
});

test("clamps public synthetic cohort controls and emits a generated cohort", async () => {
  const user = userEvent.setup();
  const onGenerate = vi.fn();
  render(<SyntheticStudyBuilder onGenerate={onGenerate} onInvalidate={vi.fn()} />);

  const individuals = screen.getByLabelText("Cohort individuals") as HTMLInputElement;
  const observations = screen.getByLabelText(/Observations per individual/) as HTMLInputElement;
  fireEvent.change(individuals, { target: { value: "99" } });
  fireEvent.change(observations, { target: { value: "99" } });
  expect(individuals.valueAsNumber).toBe(16);
  expect(observations.valueAsNumber).toBe(20);

  expect(screen.queryByText(/Interactive prior draw/)).toBeNull();
  expect(screen.getByRole("button", { name: "Draw new compartment model" }).closest(".synthetic-graph-panel")).toBeTruthy();
  const generate = screen.getByRole("button", { name: "Generate new cohort" });
  const compartment = screen.getByRole("button", { name: "Compartment graph" });
  expect(generate.compareDocumentPosition(compartment) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(compartment.getAttribute("aria-expanded")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Dose and observation protocol" }));
  expect((screen.getByLabelText("Dose 1 time") as HTMLInputElement).valueAsNumber).toBe(0);
  expect((screen.getByLabelText("Dose 1 time") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText("Dose 1 relative amount") as HTMLInputElement).valueAsNumber).toBe(1);
  expect((screen.getByLabelText("Dose 1 duration") as HTMLInputElement).valueAsNumber).toBe(0);
  await user.click(screen.getByRole("button", { name: "+ Add dose" }));
  await user.click(screen.getByRole("button", { name: "+ Add dose" }));
  await user.click(screen.getByRole("button", { name: "+ Add dose" }));
  expect(screen.getByRole("img", { name: "Dimensionless dose and observation schedule timeline" })).toBeTruthy();

  await user.click(generate);
  expect(onGenerate).toHaveBeenCalledOnce();
  expect(onGenerate.mock.calls[0][0].subjects).toHaveLength(16);
  expect(onGenerate.mock.calls[0][0].subjects[0].points).toHaveLength(20);
  expect(onGenerate.mock.calls[0][0].doseEvents).toHaveLength(4);
});

test("draws a fresh cohort seed by default and honors a user-provided seed", async () => {
  const user = userEvent.setup();
  const onGenerate = vi.fn();
  vi.spyOn(Math, "random").mockReturnValue(0.25);
  render(<SyntheticStudyBuilder onGenerate={onGenerate} onInvalidate={vi.fn()} />);

  const seed = screen.getByLabelText("Cohort seed") as HTMLInputElement;
  expect(seed.valueAsNumber).toBe(46);
  await user.click(screen.getByRole("button", { name: "Generate new cohort" }));
  expect(seed.valueAsNumber).toBe(536870911);
  expect(onGenerate.mock.calls[0][0].id).toContain("synthetic-v6-536870911-");

  fireEvent.change(seed, { target: { value: "1729" } });
  await user.click(screen.getByRole("button", { name: "Generate new cohort" }));
  expect(seed.valueAsNumber).toBe(1729);
  expect(onGenerate.mock.calls[1][0].id).toContain("synthetic-v6-1729-");
});

test("edits kinetic laws, updates equations, and regenerates at the fixed seed", async () => {
  const user = userEvent.setup();
  const onGenerate = vi.fn();
  render(<SyntheticStudyBuilder onGenerate={onGenerate} onInvalidate={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Kinetic parameters" }));
  const law = screen.getAllByRole("combobox", { name: /J.+ law/ })[0] as HTMLSelectElement;
  const flux = law.getAttribute("aria-label")?.replace(" law", "") ?? "";
  const beta = screen.getByLabelText(`${flux} beta`) as HTMLInputElement;
  const equations = document.querySelector(".synthetic-equation-list.compact") as HTMLElement;

  await user.selectOptions(law, "saturable");
  expect(beta.disabled).toBe(false);
  expect(equations.textContent).toContain("β");
  expect(onGenerate).toHaveBeenCalledOnce();
  expect(onGenerate.mock.calls[0][0].id).toContain("synthetic-v6-46-");

  await user.selectOptions(law, "linear");
  expect(beta.disabled).toBe(true);
  expect(onGenerate).toHaveBeenCalledTimes(2);
  expect(onGenerate.mock.calls[1][0].id).toContain("synthetic-v6-46-");
});

test("uses the selected acquisition scheduler for preview and generation", async () => {
  const user = userEvent.setup();
  const onGenerate = vi.fn();
  render(<SyntheticStudyBuilder onGenerate={onGenerate} onInvalidate={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Dose and observation protocol" }));
  await user.selectOptions(screen.getByLabelText("Observation schedule"), "unscheduled");
  await user.selectOptions(screen.getByLabelText("Time weighting"), "early");
  await user.click(screen.getByRole("button", { name: "Generate new cohort" }));

  const study = onGenerate.mock.calls[0][0];
  expect(study.subjects).toHaveLength(10);
  expect(study.subjects[0].points.map(([time]: [number, number]) => time)).not.toEqual(
    study.subjects[1].points.map(([time]: [number, number]) => time),
  );
  const actualTimes = [...new Set(study.subjects.flatMap((subject: { points: [number, number][] }) => subject.points.map(([time]) => time)))].sort((a, b) => Number(a) - Number(b));
  expect(study.observedVpc.map((point: { time: number }) => point.time)).toEqual(actualTimes);
});

test("resamples the observation grid and uses the previewed mesh for generation", () => {
  const model = sampleSyntheticModel(46);
  const acquisition = { family: "exact", shape: "uniform" } as const;
  const first = previewSyntheticObservationTimes(46, 10, 16, acquisition, 0);
  const second = previewSyntheticObservationTimes(46, 10, 16, acquisition, 1);
  const study = generateSyntheticCohort(model, 10, 16, acquisition, 1);

  expect(second.times).not.toEqual(first.times);
  expect(study.subjects[0].points.map(([time]) => time)).toEqual(second.times[0]);
});

test("accepts a user-defined relative dose", async () => {
  const user = userEvent.setup();
  const onGenerate = vi.fn();
  render(<SyntheticStudyBuilder onGenerate={onGenerate} onInvalidate={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Dose and observation protocol" }));
  const dose = screen.getByLabelText("Dose 1 relative amount") as HTMLInputElement;
  expect(dose.valueAsNumber).toBe(1);
  await user.clear(dose);
  await user.type(dose, "2.5");
  await user.tab();
  await user.click(screen.getByRole("button", { name: "Generate new cohort" }));

  expect(onGenerate.mock.calls[0][0].doseEvents[0].amount).toBe(2.5);
});

test("adds and edits a future dose event on the protocol timeline", async () => {
  const user = userEvent.setup();
  const onGenerate = vi.fn();
  render(<SyntheticStudyBuilder onGenerate={onGenerate} onInvalidate={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Dose and observation protocol" }));
  await user.click(screen.getByRole("button", { name: "+ Add dose" }));
  const time = screen.getByLabelText("Dose 2 time");
  const amount = screen.getByLabelText("Dose 2 relative amount");
  const duration = screen.getByLabelText("Dose 2 duration");
  await user.clear(time); await user.type(time, "0.6"); await user.tab();
  await user.clear(amount); await user.type(amount, "4"); await user.tab();
  await user.clear(duration); await user.type(duration, "0.1"); await user.tab();

  expect(screen.getByText("infusion")).toBeTruthy();
  expect(document.querySelectorAll(".timeline-infusion")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Generate new cohort" }));
  expect(onGenerate.mock.calls[0][0].doseEvents[1]).toMatchObject({ time: 0.6, amount: 4, duration: 0.1 });
});

test("keeps the previous synthetic plots visible but faded until regeneration", async () => {
  const user = userEvent.setup();
  const catalogueStudy = generateSyntheticCohort(sampleSyntheticModel(46), 4, 5);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("corpus")) return { ok: true, json: async () => ({ schemaVersion: 1, generatedAt: "test", studies: [catalogueStudy] }) } as Response;
    if (url.includes("wikipedia")) return { ok: true, json: async () => ({ query: { pages: {} } }) } as Response;
    return { ok: true, json: async () => ({ ready: false, loaded: false, models: {} }) } as Response;
  }));

  render(<Dashboard />);
  expect(await screen.findByLabelText("Empirical cohort")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Cohort summary" })).toBeTruthy();
  expect(screen.getByText("Empirical Cohorts")).toBeTruthy();
  expect(document.querySelector(".study-browser")).toBeNull();
  expect(screen.queryByRole("button", { name: "Synthetic cohort" })).toBeNull();
  window.history.replaceState({}, "", "/pff-pk-dashboard/synthetic/");
  cleanup();
  render(<Dashboard />);
  expect(await screen.findByText("Synthetic Cohorts")).toBeTruthy();
  const themeToggle = screen.getByRole("button", { name: "Switch to dark mode" });
  expect(themeToggle.textContent).toBe("☀");
  await user.click(themeToggle);
  expect(screen.getByRole("button", { name: "Switch to light mode" }).textContent).toBe("☾");
  expect(screen.queryByLabelText("Empirical cohort")).toBeNull();
  expect(screen.queryByRole("region", { name: "Cohort summary" })).toBeNull();
  const chart = await screen.findByRole("img", { name: "Observed visual predictive check for Synthetic cohort" });
  const results = chart.closest(".results-grid") as HTMLElement;
  expect(results.dataset.stale).toBeUndefined();
  expect([...results.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual(["Individuals", "VPC", "PK quantities"]);
  expect(screen.getByRole("switch", { name: "concentration profiles linear scale" }).getAttribute("aria-checked")).toBe("true");
  expect((screen.getByLabelText("Cohort individuals") as HTMLInputElement).valueAsNumber).toBe(10);
  expect((screen.getByLabelText(/Observations per individual/) as HTMLInputElement).valueAsNumber).toBe(8);
  await user.click(screen.getByRole("button", { name: "Dose and observation protocol" }));
  expect((screen.getByLabelText("Time weighting") as HTMLSelectElement).value).toBe("early");

  fireEvent.change(screen.getByLabelText("Cohort individuals"), { target: { value: "11" } });
  expect(screen.getByRole("img", { name: "Observed visual predictive check for Synthetic cohort" })).toBeTruthy();
  expect(results.dataset.stale).toBe("true");
  expect(screen.getByText("Generate the edited cohort to reactivate zero-shot inference.")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Generate new cohort" }));
  await waitFor(() => expect(results.dataset.stale).toBeUndefined());
});
