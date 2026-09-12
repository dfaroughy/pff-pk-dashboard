import type { Study } from "../lib/types";
import { populationRule, type PopulationRules, type PopulationRule } from "../lib/target-population";
import type { TargetColumn } from "./TargetCovariateTable";

export function TargetPopulationControls({ study, columns, rules, onChange }: {
  study: Study; columns: TargetColumn[]; rules: PopulationRules;
  onChange: (key: string, value: PopulationRule) => void;
}) {
  if (!columns.length) return null;
  return <section className="target-population scientific-controls" aria-label="Generated population covariates">
    <h3>Generated population</h3>
    <div className="target-population-grid">{columns.map(column => {
      const rule = rules[column.key] ?? populationRule(study, column);
      return <div key={column.key} className="target-population-field">
        <label>{column.label}<select aria-label={`Population ${column.label}`} value={rule.mode}
          onChange={e => onChange(column.key, { ...rule, mode: e.target.value })}>
          <option value={column.options ? "random" : "range"}>{column.options ? "Random (context)" : "Range (context)"}</option>
          {column.options?.map(option => <option value={option} key={option}>{option}</option>)}
          <option value="unspecified">Unspecified</option>
        </select></label>
        {!column.options && rule.mode === "range" && <div className="target-range">
          <input aria-label={`${column.label} minimum`} type="number" step="any" value={rule.min} onChange={e => onChange(column.key, { ...rule, min: e.target.value })} />
          <span>–</span><input aria-label={`${column.label} maximum`} type="number" step="any" value={rule.max} onChange={e => onChange(column.key, { ...rule, max: e.target.value })} />
        </div>}
      </div>;
    })}</div>
  </section>;
}
