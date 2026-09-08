import type { Study } from "../lib/types";

const labels: Record<string, string> = {
  weight_kg: "Weight (kg)", age_years: "Age (years)", height_cm: "Height (cm)",
  sex: "Sex", sex_source_code: "Sex (source code)",
  creatinine_clearance_ml_min: "Creatinine clearance (mL/min)",
  body_surface_area_m2: "Body surface area (m²)", lean_body_mass_kg: "Lean body mass (kg)",
};

export function covariateColumns(study: Study): string[] {
  return [...new Set(study.subjects.flatMap((subject) => Object.keys(subject.covariates ?? {})))];
}

export function CovariateTable({ study }: { study: Study }) {
  const columns = covariateColumns(study);
  if (!columns.length) return null;
  return <article className="card covariate-card">
    <h2>Individual covariates</h2>
    <p>{study.subjects.length} individuals</p>
    {/* Keyboard focus lets users scroll wide or long tables without a mouse. */}
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
    <div className="covariate-scroll" tabIndex={0} role="region" aria-label="Scrollable individual covariates">
      <table>
        <caption className="visually-hidden">Individual covariates for {study.drug}</caption>
        <thead><tr><th scope="col">Individual</th>{columns.map((column) => <th scope="col" key={column}>{labels[column] ?? column.replaceAll("_", " ")}</th>)}</tr></thead>
        <tbody>{study.subjects.map((subject) => <tr key={subject.id}>
          <th scope="row">{subject.id}</th>
          {columns.map((column) => <td key={column}>{subject.covariates?.[column] ?? "—"}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </article>;
}
