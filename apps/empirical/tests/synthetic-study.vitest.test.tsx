// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { SyntheticStudyBuilder, balanceEquation } from "../app/components/SyntheticStudyBuilder";
import { generateSyntheticCohort, sampleSyntheticModel, withDoseCount } from "../app/lib/synthetic-study";

afterEach(cleanup);

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

test("clamps public synthetic study controls and emits a generated cohort", async () => {
  const user = userEvent.setup();
  const onGenerate = vi.fn();
  render(<SyntheticStudyBuilder onGenerate={onGenerate} onClear={vi.fn()} />);

  const individuals = screen.getByLabelText(/Individuals/) as HTMLInputElement;
  const observations = screen.getByLabelText(/Observations per individual/) as HTMLInputElement;
  fireEvent.change(individuals, { target: { value: "99" } });
  fireEvent.change(observations, { target: { value: "99" } });
  expect(individuals.valueAsNumber).toBe(16);
  expect(observations.valueAsNumber).toBe(20);

  await user.selectOptions(screen.getByLabelText("Schedule"), "4");
  expect(screen.getByRole("img", { name: "Dimensionless dose protocol timeline" })).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Generate synthetic data" }));
  expect(onGenerate).toHaveBeenCalledOnce();
  expect(onGenerate.mock.calls[0][0].subjects).toHaveLength(16);
  expect(onGenerate.mock.calls[0][0].subjects[0].points).toHaveLength(20);
  expect(onGenerate.mock.calls[0][0].doseEvents).toHaveLength(4);
});
