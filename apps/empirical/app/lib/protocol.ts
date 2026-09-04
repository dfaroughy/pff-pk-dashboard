import type { DoseEvent, Study } from "./types";

export type DoseEventDraft = Omit<DoseEvent, "time" | "amount"> & {
  id: string;
  time: string;
  amount: string;
};

export type DoseEventErrors = Partial<Record<"time" | "amount", string>>;

export type ProtocolValidation = {
  events: DoseEvent[];
  errors: Record<string, DoseEventErrors>;
  valid: boolean;
};

export function studyHorizon(study: Pick<Study, "subjects" | "summary">): number {
  const times = [
    ...study.subjects.flatMap((subject) => subject.points.map(([time]) => time)),
    ...study.summary.map((point) => point.time),
  ].filter((time) => Number.isFinite(time) && time >= 0);
  return Math.max(...times, 1);
}

export function observedProtocol(study: Study, protocolUnit: string): DoseEvent[] {
  const events = study.doseEvents?.length
    ? study.doseEvents
    : [{ time: 0, amount: study.dose ?? 1, unit: protocolUnit, route: study.route }];
  return events
    .map((event) => ({ ...event, unit: protocolUnit, route: event.route || study.route }))
    .sort((left, right) => left.time - right.time);
}

export function doseEventDraft(event: DoseEvent, id: string): DoseEventDraft {
  return {
    ...event,
    id,
    time: String(event.time),
    amount: String(event.amount),
  };
}

function finiteNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateDoseProtocol(drafts: DoseEventDraft[], horizon: number): ProtocolValidation {
  const errors: Record<string, DoseEventErrors> = {};
  const events: DoseEvent[] = [];

  for (const draft of drafts) {
    const eventErrors: DoseEventErrors = {};
    const time = finiteNumber(draft.time);
    const amount = finiteNumber(draft.amount);
    const duration = draft.duration ?? 0;

    if (time === null) eventErrors.time = "Enter a time";
    else if (time < 0) eventErrors.time = "Must be at least 0";
    else if (time + duration > horizon) {
      const displayedHorizon = horizon.toLocaleString(undefined, { maximumSignificantDigits: 6 });
      eventErrors.time = `Must end by ${displayedHorizon}`;
    }

    if (amount === null) eventErrors.amount = "Enter a dose";
    else if (amount <= 0) eventErrors.amount = "Must be greater than 0";

    if (Object.keys(eventErrors).length) {
      errors[draft.id] = eventErrors;
      continue;
    }
    events.push({
      time: time as number,
      amount: amount as number,
      unit: draft.unit,
      route: draft.route,
      ...(draft.duration === undefined ? {} : { duration: draft.duration }),
    });
  }

  events.sort((left, right) => left.time - right.time);
  return { events, errors, valid: drafts.length > 0 && events.length === drafts.length };
}

export function validateInteger(value: string, low: number, high: number): string {
  const parsed = finiteNumber(value);
  if (parsed === null) return "Required";
  if (!Number.isInteger(parsed)) return "Use a whole number";
  if (parsed < low || parsed > high) return `Use ${low}–${high}`;
  return "";
}

export function contextDoseRatio(amount: string, referenceDose: number): string | null {
  const parsed = finiteNumber(amount);
  if (parsed === null || parsed <= 0 || referenceDose <= 0) return null;
  return `${(parsed / referenceDose).toLocaleString(undefined, { maximumSignificantDigits: 3 })}× context`;
}
