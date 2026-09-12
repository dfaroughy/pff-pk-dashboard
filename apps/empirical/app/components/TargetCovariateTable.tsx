import type { Study } from "../lib/types";

export type TargetDraft = Record<string, string>;
export type TargetColumn = { key: string; label: string; options?: string[]; positive?: boolean };
const columns: TargetColumn[] = [
  { key: "sex", label: "Sex", options: ["female", "male"] },
  { key: "age_years", label: "Age (years)", positive: true },
  { key: "weight_kg", label: "Weight (kg)", positive: true },
  { key: "height_cm", label: "Height (cm)", positive: true },
  { key: "renal_function_ratio", label: "Renal ratio", positive: true },
  { key: "hepatic_function_ratio", label: "Hepatic ratio", positive: true },
  { key: "metabolic_phenotype", label: "Metabolic phenotype", options: ["poor", "normal", "rapid"] },
  { key: "cov_cont_0", label: "cov_cont_0" },
  { key: "cov_cat_0", label: "cov_cat_0", options: [] },
];

export function targetColumns(study: Study): TargetColumn[] {
  return columns.filter((column) => study.subjects.some((subject) => {
    const value = subject.covariates?.[column.key];
    return value !== undefined && value !== null && String(value).trim() !== "";
  })).map((column) => column.key === "cov_cat_0" ? { ...column, options: [...new Set(
    study.subjects.flatMap((subject) => {
      const value = subject.covariates?.cov_cat_0;
      return value === undefined || value === null || String(value).trim() === "" ? [] : [String(value)];
    }),
  )].sort() } : column);
}

export function invalidTarget(value: string, column: TargetColumn): boolean {
  if (!value.trim()) return false;
  return column.options ? !column.options.includes(value)
    : !Number.isFinite(Number(value)) || Boolean(column.positive && Number(value) <= 0);
}

export function targetPayload(rows: TargetDraft[], columns: TargetColumn[], count: number) {
  return Array.from({ length: count }, (_, index) => Object.fromEntries(columns.flatMap((column) => {
    const value = rows[index]?.[column.key]?.trim() ?? "";
    return value ? [[column.key, column.options ? value : Number(value)]] : [];
  })));
}

export function TargetCovariateTable({ columns, rows, count, onChange }: {
  columns: TargetColumn[]; rows: TargetDraft[]; count: number;
  onChange: (index: number, key: string, value: string) => void;
}) {
  if (!columns.length) return null;
  return <details className="target-covariates scientific-controls">
    <summary>Advanced · individual covariates</summary>
    <div className="target-covariates-scroll"><table>
      <thead><tr><th scope="col">Individual</th>{columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
      <tbody>{Array.from({ length: count }, (_, index) => <tr key={index}>
        <th scope="row">{index + 1}</th>
        {columns.map((column) => {
          const value = rows[index]?.[column.key] ?? "";
          const invalid = invalidTarget(value, column);
          const label = `Individual ${index + 1} ${column.label}`;
          return <td key={column.key}>{column.options ? <select aria-label={label} value={value}
            onChange={(event) => onChange(index, column.key, event.target.value)}>
            <option value="">Unspecified</option>
            {column.options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select> : <input aria-label={label} aria-invalid={invalid} type="number" step="any"
            min={column.positive ? 0 : undefined} placeholder="Unspecified" value={value}
            onChange={(event) => onChange(index, column.key, event.target.value)} />}</td>;
        })}
      </tr>)}</tbody>
    </table></div>
  </details>;
}
