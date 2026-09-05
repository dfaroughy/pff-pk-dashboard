import Papa from "papaparse";
import type { DoseEvent, Study, Subject } from "./types";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_UPLOAD_ROWS = 25_000;
export const MAX_UPLOAD_SUBJECTS = 128;
export const MAX_UPLOAD_OBSERVATIONS = 8_192;
export const MAX_UPLOAD_TIMES = 1_024;

type Row = Record<string, string | undefined>;
export type UploadRoute = "auto" | "oral" | "iv";
export type PkUploadOptions = { route?: UploadRoute };

const MISSING_VALUES = new Set(["", ".", "NA", "N/A", "NAN", "NULL"]);

const HEADER_ALIASES: Record<string, string> = {
  SUBJECT: "ID",
  SUBJECT_ID: "ID",
  USUBJID: "ID",
  NOMTIME: "TIME",
  NTIME: "TIME",
  Y: "DV",
  OBS: "DV",
  CONC: "DV",
  CONCENTRATION: "DV",
  OBSERVATION: "DV",
  OBSERVATION_VALUE: "DV",
  AMOUNT: "AMT",
  DOSE_AMOUNT: "AMT",
  EVENT_ID: "EVID",
  MISSING_DV: "MDV",
  MISSING_DEPENDENT_VARIABLE: "MDV",
  ADMINISTRATION_ROUTE: "ROUTE",
  ROUTE_OF_ADMINISTRATION: "ROUTE",
  ADMINISTRATION_ID: "ADM",
  ADMINISTRATIONID: "ADM",
  ADMID: "ADM",
  ANALYTE: "DRUG",
  COMPOUND: "DRUG",
  TIMEUNIT: "TIME_UNIT",
  DVUNIT: "DV_UNIT",
  CONC_UNIT: "DV_UNIT",
  CONCENTRATION_UNIT: "DV_UNIT",
  DOSEUNIT: "DOSE_UNIT",
  AMTUNIT: "DOSE_UNIT",
  AMT_UNIT: "DOSE_UNIT",
  SPECIMEN: "MATRIX",
  MEDIUM: "MATRIX",
  DURATION: "DUR",
  TINF: "DUR",
  INFDUR: "DUR",
  INFUSION_DURATION: "DUR",
  INFRATE: "RATE",
  INFUSION_RATE: "RATE",
  ADDITIONAL_DOSES: "ADDL",
  INTERDOSE_INTERVAL: "II",
  STEADY_STATE: "SS",
  OBSERVATION_ID: "DVID",
  OBSERVATIONID: "DVID",
  YTYPE: "DVID",
  CENSORING: "CENS",
  CENSORED: "CENS",
  CENSOR: "CENS",
  LOWER_LIMIT: "LIMIT",
  LLOQ: "LIMIT",
};

function normalizedHeader(header: string) {
  const normalized = header
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^[#$]+/, "")
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
  return HEADER_ALIASES[normalized] ?? normalized;
}

function value(row: Row, field: string) {
  const raw = String(row[field] ?? "").trim();
  return MISSING_VALUES.has(raw.toUpperCase()) ? "" : raw;
}

function finiteNumber(raw: string, field: string, row: number) {
  if (!raw) throw new Error(`Row ${row}: ${field} is required`);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Row ${row}: ${field} must be numeric`);
  return parsed;
}

function optionalInteger(raw: string, field: string, row: number) {
  if (!raw) return null;
  const parsed = finiteNumber(raw, field, row);
  if (!Number.isInteger(parsed)) throw new Error(`Row ${row}: ${field} must be a whole number`);
  return parsed;
}

function constantText(rows: Row[], field: string, fallback: string) {
  const entries = rows.map((row) => value(row, field)).filter(Boolean);
  if (!entries.length) return fallback;
  const unique = new Map(entries.map((entry) => [entry.toLowerCase(), entry]));
  if (unique.size > 1) throw new Error(`${field} must have one value throughout the dataset`);
  return entries[0];
}

function constantPositiveNumber(rows: Row[], field: string) {
  const entries = rows.map((row) => value(row, field)).filter(Boolean);
  if (!entries.length) return null;
  const parsed = entries.map((entry, index) => finiteNumber(entry, field, index + 2));
  if (parsed.some((entry) => entry <= 0)) throw new Error(`${field} must be greater than zero`);
  const reference = parsed[0];
  if (parsed.some((entry) => Math.abs(entry - reference) > Math.max(1e-9, Math.abs(reference) * 1e-9))) {
    throw new Error(`${field} must have one value throughout the dataset`);
  }
  return reference;
}

function normalizedRoute(raw: string) {
  const route = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["po", "oral", "per_os", "extravascular", "ev"].includes(route)) return "oral";
  if (["iv", "intravenous", "iv_bolus", "iv_infusion", "intravenous_bolus", "intravenous_infusion"].includes(route)) return "iv";
  return route;
}

function whitespaceTable(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { fields: [] as string[], data: [] as Row[] };
  const fields = lines[0].split(/\s+/).map(normalizedHeader);
  const data = lines.slice(1).filter((line) => !line.startsWith("#")).map((line, index) => {
    const entries = line.split(/\s+/);
    if (entries.length > fields.length) throw new Error(`Row ${index + 2}: contains more values than the header`);
    return Object.fromEntries(fields.map((field, fieldIndex) => [field, entries[fieldIndex] ?? ""]));
  });
  return { fields, data };
}

function parseTable(text: string) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? "";
  if (!/[,;\t]/.test(firstLine)) return whitespaceTable(text);
  const parsed = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizedHeader,
  });
  const fatal = parsed.errors.find((error) => error.code !== "UndetectableDelimiter");
  if (fatal) throw new Error(`Dataset row ${(fatal.row ?? 0) + 2}: ${fatal.message}`);
  return { fields: parsed.meta.fields ?? [], data: parsed.data };
}

function inferRoute(rows: Row[], requested: UploadRoute) {
  const explicit = rows.flatMap((row) => [value(row, "ROUTE"), value(row, "ADM")])
    .filter(Boolean)
    .map(normalizedRoute)
    .filter((route) => route === "oral" || route === "iv");
  const routes = [...new Set(explicit)];
  if (routes.length > 1) throw new Error("The dataset contains more than one administration route; import each treatment arm separately");
  if (requested !== "auto") {
    if (routes.length === 1 && routes[0] !== requested) {
      throw new Error(`The selected route conflicts with the ${routes[0]} route encoded in the dataset`);
    }
    return requested;
  }
  if (routes.length === 1) return routes[0];
  const hasInfusion = rows.some((row) => {
    const duration = Number(value(row, "DUR"));
    const rate = Number(value(row, "RATE"));
    return duration > 0 || rate > 0;
  });
  if (hasInfusion) return "iv";
  throw new Error("Administration route is not encoded in this dataset. Select Oral or Intravenous below.");
}

function filenameStem(filename: string) {
  const stem = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return stem || "Custom dataset";
}

function stableId(filename: string, text: string) {
  let hash = 2166136261;
  const input = `${filename}\u0000${text}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `custom-${hash >>> 0}`;
}

function eventSignature(events: DoseEvent[]) {
  return JSON.stringify(events.map((event) => [event.time, event.amount, event.duration ?? 0, event.route]));
}

export function parsePkDataset(text: string, filename: string, options: PkUploadOptions = {}): Study {
  if (!text.trim()) throw new Error("The selected file is empty");
  const parsed = parseTable(text);
  const fields = parsed.fields;
  const duplicate = fields.find((field, index) => fields.indexOf(field) !== index);
  if (duplicate) throw new Error(`Duplicate or aliased column: ${duplicate}`);
  const missing = ["ID", "TIME", "DV"].filter((field) => !fields.includes(field));
  if (missing.length) throw new Error(`Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
  if (parsed.data.length > MAX_UPLOAD_ROWS) throw new Error(`Use at most ${MAX_UPLOAD_ROWS.toLocaleString()} rows`);

  const route = inferRoute(parsed.data, options.route ?? "auto");
  const observationIds = [...new Set(parsed.data.map((row) => value(row, "DVID")).filter(Boolean))];
  if (observationIds.length > 1) {
    throw new Error("The dataset contains multiple DVID/YTYPE outcomes. Import one PK analyte at a time.");
  }

  const observations = new Map<string, Array<[number, number]>>();
  const doseBySubject = new Map<string, DoseEvent[]>();
  for (let index = 0; index < parsed.data.length; index += 1) {
    const row = parsed.data[index];
    const rowNumber = index + 2;
    const id = value(row, "ID");
    if (!id) throw new Error(`Row ${rowNumber}: ID is required`);
    const time = finiteNumber(value(row, "TIME"), "TIME", rowNumber);
    if (time < 0) throw new Error(`Row ${rowNumber}: TIME must be at least zero`);
    const evid = optionalInteger(value(row, "EVID"), "EVID", rowNumber);
    const mdv = optionalInteger(value(row, "MDV"), "MDV", rowNumber);
    const cens = optionalInteger(value(row, "CENS"), "CENS", rowNumber);
    if (evid !== null && ![0, 1, 2].includes(evid)) throw new Error(`Row ${rowNumber}: EVID ${evid} is not supported; use observation (0), dose (1), or other-event (2) records`);
    if (mdv !== null && ![0, 1].includes(mdv)) throw new Error(`Row ${rowNumber}: MDV must be 0 or 1`);
    if (cens !== null && ![0, 1].includes(cens)) throw new Error(`Row ${rowNumber}: CENS must be 0 or 1`);
    const rawDv = value(row, "DV");
    const rawAmount = value(row, "AMT");
    const isDose = evid === 1 || (evid === null && Boolean(rawAmount) && (!rawDv || mdv === 1));

    if (isDose) {
      const amount = finiteNumber(rawAmount, "AMT", rowNumber);
      if (amount <= 0) throw new Error(`Row ${rowNumber}: AMT must be greater than zero`);
      const rawDuration = value(row, "DUR");
      const rawRate = value(row, "RATE");
      const rate = rawRate ? finiteNumber(rawRate, "RATE", rowNumber) : undefined;
      if (rate !== undefined && rate < 0) throw new Error(`Row ${rowNumber}: modeled or special negative RATE values are not supported`);
      const duration = rawDuration
        ? finiteNumber(rawDuration, "DUR", rowNumber)
        : rate && rate > 0 ? amount / rate : undefined;
      if (duration !== undefined && duration < 0) throw new Error(`Row ${rowNumber}: DUR must be at least zero`);
      const addl = optionalInteger(value(row, "ADDL"), "ADDL", rowNumber) ?? 0;
      const intervalRaw = value(row, "II");
      const interval = intervalRaw ? finiteNumber(intervalRaw, "II", rowNumber) : 0;
      const steadyState = optionalInteger(value(row, "SS"), "SS", rowNumber) ?? 0;
      if (steadyState !== 0) throw new Error(`Row ${rowNumber}: steady-state dose records are not supported`);
      if (addl < 0) throw new Error(`Row ${rowNumber}: ADDL must be at least zero`);
      if (addl > 0 && interval <= 0) throw new Error(`Row ${rowNumber}: II must be greater than zero when ADDL is used`);
      const events = Array.from({ length: addl + 1 }, (_, doseIndex) => ({
        time: time + doseIndex * interval,
        amount,
        route,
        unit: "",
        ...(duration === undefined ? {} : { duration }),
      }));
      doseBySubject.set(id, [...(doseBySubject.get(id) ?? []), ...events]);
      continue;
    }
    if (evid === 2 || mdv === 1 || cens === 1) continue;
    if (!rawDv) throw new Error(`Row ${rowNumber}: DV is required for an observation row`);
    const concentration = finiteNumber(rawDv, "DV", rowNumber);
    if (concentration <= 0) throw new Error(`Row ${rowNumber}: DV must be greater than zero`);
    observations.set(id, [...(observations.get(id) ?? []), [time, concentration]]);
  }

  if (!observations.size) throw new Error("The dataset contains no usable observations");
  if (observations.size > MAX_UPLOAD_SUBJECTS) throw new Error(`Use at most ${MAX_UPLOAD_SUBJECTS} individuals`);
  const observationCount = [...observations.values()].reduce((total, points) => total + points.length, 0);
  if (observationCount > MAX_UPLOAD_OBSERVATIONS) throw new Error(`Use at most ${MAX_UPLOAD_OBSERVATIONS.toLocaleString()} observations`);
  const uniqueTimes = new Set([...observations.values()].flatMap((points) => points.map(([time]) => time)));
  if (uniqueTimes.size > MAX_UPLOAD_TIMES) throw new Error(`Use at most ${MAX_UPLOAD_TIMES.toLocaleString()} distinct observation times`);

  const subjects: Subject[] = [...observations.entries()].map(([id, rawPoints]) => {
    const points = [...rawPoints].sort(([left], [right]) => left - right);
    const duplicateTime = points.find(([time], index) => index > 0 && time === points[index - 1][0]);
    if (duplicateTime) throw new Error(`Individual ${id} has duplicate observations at TIME=${duplicateTime[0]}`);
    return { id, points };
  });

  const timeUnit = constantText(parsed.data, "TIME_UNIT", "reported time units");
  const concentrationUnit = constantText(parsed.data, "DV_UNIT", "reported units");
  const doseUnit = constantText(parsed.data, "DOSE_UNIT", "reported dose units");
  const drug = constantText(parsed.data, "DRUG", filenameStem(filename));
  const medium = constantText(parsed.data, "MATRIX", "not reported");
  const metadataDose = constantPositiveNumber(parsed.data, "DOSE");
  let doseEvents: DoseEvent[] | undefined;
  if (doseBySubject.size) {
    const missingDose = subjects.find((subject) => !doseBySubject.has(subject.id));
    if (missingDose) throw new Error(`Dose records are missing for individual ${missingDose.id}`);
    const protocols = subjects.map((subject) => (doseBySubject.get(subject.id) ?? [])
      .map((event) => ({ ...event, unit: doseUnit }))
      .sort((left, right) => left.time - right.time));
    const reference = eventSignature(protocols[0]);
    if (protocols.some((events) => eventSignature(events) !== reference)) {
      throw new Error("Individuals have different dose regimens; upload each regimen as a separate dataset");
    }
    doseEvents = protocols[0];
  }
  const dose = doseEvents?.[0]?.amount ?? metadataDose;
  if (!doseEvents && dose !== null) doseEvents = [{ time: 0, amount: dose, unit: doseUnit, route }];

  return {
    id: stableId(filename, text),
    origin: "Custom dataset",
    drug,
    administeredDrug: drug,
    study: filename,
    source: `Local file: ${filename}`,
    route,
    dose,
    doseUnit,
    ...(doseEvents ? { doseEvents } : {}),
    concentrationUnit,
    timeUnit,
    medium,
    unitClass: /mol/i.test(concentrationUnit) ? "molar" : "mass",
    subjects,
    summary: [],
  };
}
