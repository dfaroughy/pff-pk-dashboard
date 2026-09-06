// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { Dashboard, SyntheticResultsPlaceholder } from "../app/components/Dashboard";
import { SyntheticStudyBuilder, balanceEquation } from "../app/components/SyntheticStudyBuilder";
import { generateSyntheticCohort, previewSyntheticObservationTimes, sampleSyntheticModel, withDoseCount } from "../app/lib/synthetic-study";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

test("constructs selectable one-to-four-dose protocols inside the unit horizon", () => {
  const model = sampleSyntheticModel(43);
  const multidose = withDoseCount(model, 4);

  expect(multidose.protocol.events).toHaveLength(4);
  expect(multidose.protocol.events[0].time).toBe(0);
  expect(multidose.protocol.events.every((event) => event.time + event.duration <= 1)).toBe(true);
  expect(multidose.protocol.events.map((event) => event.time)).toEqual(
    [...multidose.protocol.events.map((event) => event.time)].sort((left, right) => left - right),
  );
});

test("clamps public synthetic cohort controls and emits a generated cohort", async () => {
  const user = userEvent.setup();
  const onGenerate = vi.fn();
  render(<SyntheticStudyBuilder onGenerate={onGenerate} onInvalidate={vi.fn()} />);

  const individuals = screen.getByLabelText(/Individuals/) as HTMLInputElement;
  const observations = screen.getByLabelText(/Observations per individual/) as HTMLInputElement;
  fireEvent.change(individuals, { target: { value: "99" } });
  fireEvent.change(observations, { target: { value: "99" } });
  expect(individuals.valueAsNumber).toBe(16);
  expect(observations.valueAsNumber).toBe(20);

  expect(screen.queryByText(/Interactive prior draw/)).toBeNull();
  expect(screen.getByRole("button", { name: "[draw graph]" }).closest(".synthetic-graph-panel")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Compartment graph" }).getAttribute("aria-expanded")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Dose and observation protocol" }));
  await user.selectOptions(screen.getByLabelText("Dose schedule"), "4");
  expect(screen.getByRole("img", { name: "Dimensionless dose and observation schedule timeline" })).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Generate synthetic cohort" }));
  expect(onGenerate).toHaveBeenCalledOnce();
  expect(onGenerate.mock.calls[0][0].subjects).toHaveLength(16);
  expect(onGenerate.mock.calls[0][0].subjects[0].points).toHaveLength(20);
  expect(onGenerate.mock.calls[0][0].doseEvents).toHaveLength(4);
});

test("edits kinetic laws and keeps the rendered equations synchronized", async () => {
  const user = userEvent.setup();
  const onInvalidate = vi.fn();
  render(<SyntheticStudyBuilder onGenerate={vi.fn()} onInvalidate={onInvalidate} />);

  await user.click(screen.getByRole("button", { name: "Kinetic parameters" }));
  const law = screen.getAllByRole("combobox", { name: /J.+ law/ })[0] as HTMLSelectElement;
  const flux = law.getAttribute("aria-label")?.replace(" law", "") ?? "";
  const beta = screen.getByLabelText(`${flux} beta`) as HTMLInputElement;
  const equations = document.querySelector(".synthetic-equation-list.compact") as HTMLElement;

  await user.selectOptions(law, "saturable");
  expect(beta.disabled).toBe(false);
  expect(equations.textContent).toContain("β");
  expect(onInvalidate).toHaveBeenCalled();

  await user.selectOptions(law, "linear");
  expect(beta.disabled).toBe(true);
});

test("uses the selected acquisition scheduler for preview and generation", async () => {
  const user = userEvent.setup();
  const onGenerate = vi.fn();
  render(<SyntheticStudyBuilder onGenerate={onGenerate} onInvalidate={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "Dose and observation protocol" }));
  await user.selectOptions(screen.getByLabelText("Observation schedule"), "unscheduled");
  await user.selectOptions(screen.getByLabelText("Time weighting"), "early");
  await user.click(screen.getByRole("button", { name: "Generate synthetic cohort" }));

  const study = onGenerate.mock.calls[0][0];
  expect(study.subjects).toHaveLength(10);
  expect(study.subjects[0].points.map(([time]: [number, number]) => time)).not.toEqual(
    study.subjects[1].points.map(([time]: [number, number]) => time),
  );
  expect(study.observedVpc).toHaveLength(16);
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
  await user.click(screen.getByRole("button", { name: "Generate synthetic cohort" }));

  expect(onGenerate.mock.calls[0][0].doseEvents[0].amount).toBe(2.5);
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
  const syntheticButton = (await screen.findAllByRole("button", { name: "Synthetic cohort" }))
    .find((button) => button.classList.contains("synthetic-data-button"));
  expect(syntheticButton).toBeTruthy();
  await user.click(syntheticButton as HTMLButtonElement);
  await user.click(screen.getByRole("button", { name: "Generate synthetic cohort" }));
  const chart = await screen.findByRole("img", { name: "Observed visual predictive check for Synthetic cohort" });
  const results = chart.closest(".results-grid") as HTMLElement;
  expect(results.dataset.stale).toBeUndefined();

  fireEvent.change(screen.getByLabelText(/Individuals/), { target: { value: "11" } });
  expect(screen.getByRole("img", { name: "Observed visual predictive check for Synthetic cohort" })).toBeTruthy();
  expect(results.dataset.stale).toBe("true");
  expect(screen.getByText("Generate the edited cohort to reactivate zero-shot inference.")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Generate synthetic cohort" }));
  await waitFor(() => expect(results.dataset.stale).toBeUndefined());
});
