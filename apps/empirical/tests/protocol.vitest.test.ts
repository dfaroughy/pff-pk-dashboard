import {
  contextDoseRatio,
  doseEventDraft,
  studyHorizon,
  validateDoseProtocol,
  validateInteger,
} from "../app/lib/protocol";
import { expect, test } from "vitest";

const event = (time: string, amount: string, id = "event-1") => ({
  id,
  time,
  amount,
  unit: "mg",
  route: "oral",
});

test("numeric drafts can be empty while editing without becoming zero", () => {
  const validation = validateDoseProtocol([event("", "")], 24);
  expect(validation.valid).toBe(false);
  expect(validation.errors["event-1"].time).toBe("Enter a time");
  expect(validation.errors["event-1"].amount).toBe("Enter a dose");
});

test("dose protocols preserve decimals and are sorted only for inference", () => {
  const validation = validateDoseProtocol([
    event("2.3", "40", "later"),
    event("0", "10", "initial"),
  ], 24);
  expect(validation.valid).toBe(true);
  expect(validation.events.map(({ time, amount }) => [time, amount])).toEqual([[0, 10], [2.3, 40]]);
});

test("dose protocols reject nonpositive amounts and events beyond the study", () => {
  const validation = validateDoseProtocol([
    event("25", "10", "late"),
    event("2", "0", "zero"),
  ], 24);
  expect(validation.valid).toBe(false);
  expect(validation.errors.late.time).toMatch(/24/);
  expect(validation.errors.zero.amount).toMatch(/greater than 0/);
});

test("control integers are not silently rounded", () => {
  expect(validateInteger("8", 1, 100)).toBe("");
  expect(validateInteger("8.5", 1, 100)).toBe("Use a whole number");
  expect(validateInteger("", 1, 100)).toBe("Required");
});

test("study horizon and displayed context-dose ratio use physical values", () => {
  const horizon = studyHorizon({
    subjects: [{ id: "i1", points: [[0.25, 1], [48, 0.1]] }],
    summary: [],
  });
  expect(horizon).toBe(48);
  expect(contextDoseRatio("40", 10)).toBe("4× context");
  expect(doseEventDraft({ time: 0, amount: 10, unit: "mg", route: "oral" }, "stable").id).toBe("stable");
});
