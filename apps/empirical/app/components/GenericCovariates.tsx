import type { SyntheticResponse } from "../lib/synthetic-study";

export function GenericCovariates({ draw, disabled, onResample }: {
  draw: SyntheticResponse | null;
  disabled: boolean;
  onResample: () => void;
}) {
  const roster = draw?.covariateModel?.roster?.filter(c => !c.semantic && c.name.startsWith("cov_")) ?? [];
  const network = draw?.covariateModel?.network;
  const parameters = network?.parameters ?? [];
  const outputs = parameters.at(-1)?.bias.length ?? 0;
  const rates = draw ? [...draw.topology.edges, ...draw.topology.elimination] : [];
  const node = (id: number) => String.fromCharCode(65 + id);
  const targets = rates.map(r => r.node === undefined ? `${node(r.src)} → ${node(r.dst!)}` : `${node(r.node)} → ∅`);
  if (outputs === rates.length + 2) targets.push("Bioavailability F");
  if (network) targets.push("Central volume");
  const dimensions = network ? [network.d_in, ...parameters.map(p => p.bias.length)] : [];
  const value = (v: unknown) => typeof v === "number" ? Number(v.toPrecision(4)).toString() : String(v ?? "Missing");
  return <>
    <button className="synthetic-resample-grid" disabled={disabled} onClick={onResample}>
      {network ? "Resample MLP" : "Sample MLP"}
    </button>
    {network ? <>
      <div className="synthetic-table-wrap">
        <table className="synthetic-parameter-table">
          <thead><tr><th>Network</th><th>Input shape</th><th>Output shape</th><th>Activation</th><th>Effect scale</th><th>Weight sparsity</th></tr></thead>
          <tbody><tr>
            <td>{dimensions.join(" → ")}</td>
            <td>{draw!.study.subjects.length} × {network.d_in}</td>
            <td>{draw!.study.subjects.length} × {outputs}</td>
            <td>{network.layers ? network.activation : "Linear"}</td>
            <td>{value(network.g_scale)}</td><td>{value(network.sparsity * 100)}%</td>
          </tr></tbody>
        </table>
      </div>
      <div className="synthetic-table-wrap">
        <table className="synthetic-parameter-table">
          <thead><tr><th>Individual</th>{roster.map(c => <th key={c.name}>{c.name}<br />{c.type} · {c.observed === true ? "observed" : "hidden truth"}</th>)}</tr></thead>
          <tbody>{draw!.study.subjects.map((s, i) => <tr key={s.id}>
            <th>{i + 1}</th>
            {roster.map(c => <td key={c.name}>{value(c.observed === true ? s.covariates?.[c.name] :
              (draw!.individualTruth[s.id]?.hidden_covariates as Record<string, unknown> | undefined)?.[c.name])}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
      <details><summary>MLP inputs, outputs and weights</summary>
        <p>Continuous inputs use one column; categorical inputs use one-hot encoding. Outputs are log-parameter shifts, applied as multiplicative effects.</p>
        <p>Output order: {targets.join(", ")}.{network.clearance_targeted ? " Clearance-targeted: effects on other rates are attenuated." : ""}</p>
        <pre>{JSON.stringify(network, null, 2)}</pre>
      </details>
    </> : <p>No generic covariate MLP in this draw.</p>}
  </>;
}
