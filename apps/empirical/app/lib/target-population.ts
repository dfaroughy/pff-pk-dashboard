import type { Study } from "./types";
import { invalidTarget, type TargetColumn, type TargetDraft } from "../components/TargetCovariateTable";

export type PopulationRule = { mode: string; min: string; max: string };
export type PopulationRules = Record<string, PopulationRule>;
export function populationRule(study: Study, column: TargetColumn): PopulationRule {
  const values = study.subjects.flatMap(s => {
    const raw = s.covariates?.[column.key];
    return raw !== undefined && raw !== null && raw !== "" && Number.isFinite(Number(raw)) ? [Number(raw)] : [];
  });
  return { mode: column.options ? "random" : "range", min: values.length ? String(Math.min(...values)) : "", max: values.length ? String(Math.max(...values)) : "" };
}

export function sampleTargetPopulation(study: Study, columns: TargetColumn[], rules: PopulationRules, count: number, seed: number): { rows: TargetDraft[]; error: string } {
  const settings = columns.map(column => ({ column, rule: rules[column.key] ?? populationRule(study, column) }));
  for (const { column, rule } of settings) {
    if (!column.options && rule.mode !== "unspecified" && (!rule.min.trim() || !rule.max.trim() || invalidTarget(rule.min, column) || invalidTarget(rule.max, column) || Number(rule.min) > Number(rule.max))) {
      return { rows: [], error: `Check the ${column.label} range.` };
    }
  }
  const pool = study.subjects.filter(subject => settings.every(({ column, rule }) => {
    if (!rules[column.key] || column.options || rule.mode === "unspecified" || Number(rule.min) === Number(rule.max)) return true;
    const raw = subject.covariates?.[column.key];
    return raw !== undefined && raw !== null && raw !== "" && Number(raw) >= Number(rule.min) && Number(raw) <= Number(rule.max);
  }));
  if (!pool.length) return { rows: [], error: "No context patients match these ranges. Widen the ranges or use equal bounds for a fixed value." };
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
  return { error: "", rows: Array.from({ length: count }, () => {
    const patient = pool[Math.floor(random() * pool.length)].covariates ?? {};
    return Object.fromEntries(settings.map(({ column, rule }) => {
      let value = patient[column.key] === undefined || patient[column.key] === null ? "" : String(patient[column.key]);
      if (column.options && column.key !== "cov_cat_0") value = value.toLowerCase();
      if (rule.mode === "unspecified") value = "";
      else if (column.options && rule.mode !== "random") value = rule.mode;
      else if (!column.options && Number(rule.min) === Number(rule.max)) value = rule.min;
      return [column.key, value];
    }));
  }) };
}
