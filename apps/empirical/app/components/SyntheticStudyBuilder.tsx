import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Study } from "../lib/types";
import { syntheticRequest } from "../lib/model-api";
import {
  fluxEquation,
  graphFromResponse,
  SYNTHETIC_INITIAL_SEED,
  type ProfileDescription,
  type SyntheticResponse,
  type SyntheticVersion,
} from "../lib/synthetic-study";
import {
  balanceEquation,
  CollapsibleSection,
  CompartmentGraph,
  DoseTimeline,
  Latex,
} from "./SyntheticModelView";

function ValueTable({ value }: { value: Record<string, unknown> }) {
  return (
    <div className="synthetic-table-wrap">
      <table className="synthetic-parameter-table">
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(value).map(([key, v]) => (
            <tr key={key}>
              <th>{key.replaceAll("_", " ")}</th>
              <td className="prior-value">
                {typeof v === "object" && v !== null ? (
                  <details>
                    <summary>
                      {Array.isArray(v) ? `${v.length} values` : "Details"}
                    </summary>
                    <pre>{JSON.stringify(v, null, 2)}</pre>
                  </details>
                ) : (
                  String(v ?? "—")
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NumericEdit({
  id,
  label,
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  id?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      id={id}
      aria-label={label}
      type="number"
      step="any"
      min={min}
      max={max}
      disabled={disabled}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (
          draft !== null &&
          draft.trim() &&
          Number.isFinite(Number(draft)) &&
          Number(draft) >= min &&
          Number(draft) <= max
        )
          onCommit(Number(draft));
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

function LinearPopulation({
  population,
}: {
  population: Record<string, number[][]>;
}) {
  const meanings: Record<string, string> = {
    k_a: "Absorption rate",
    k_e: "Elimination rate",
    V: "Central volume",
    k_1p: "Central → peripheral rate",
    k_p1: "Peripheral → central rate",
  };
  return (
    <>
      <p>
        Log means and standard deviations define between-person lognormal
        parameters. Temporal magnitude and scale define the archived OU paths
        (absorption, elimination, volume) or sinusoidal variation (peripheral
        exchange).
      </p>
      <div className="synthetic-table-wrap">
        <table className="synthetic-parameter-table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Meaning</th>
              <th>Log mean</th>
              <th>Log SD</th>
              <th>Temporal magnitude</th>
              <th>Temporal scale</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(population).flatMap(([name, rows]) =>
              rows.map((row, i) => (
                <tr key={`${name}-${i}`}>
                  <th>
                    {name}
                    {rows.length > 1 ? ` [${i + 1}]` : ""}
                  </th>
                  <td>{meanings[name] ?? name}</td>
                  {row.map((v, j) => (
                    <td key={j}>{v.toPrecision(4)}</td>
                  ))}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function SyntheticStudyBuilder({
  version = "v6",
  onGenerate,
  onInvalidate,
  censoringControls,
}: {
  version?: SyntheticVersion;
  onGenerate: (study: Study, newDrawSeed?: number) => void;
  onInvalidate: () => void;
  censoringControls?: (onEdit: () => void) => ReactNode;
}) {
  const [description, setDescription] = useState<ProfileDescription | null>(
    null,
  );
  const [draw, setDraw] = useState<SyntheticResponse | null>(null);
  const [seed, setSeed] = useState(SYNTHETIC_INITIAL_SEED);
  const [individuals, setIndividuals] = useState(10);
  const [observations, setObservations] = useState(8);
  const [schedule, setSchedule] = useState("exact");
  const [shape, setShape] = useState("early");
  const [gridSeed, setGridSeed] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, number | number[]>>(
    {},
  );
  const [kineticEdits, setKineticEdits] = useState<
    Record<string, { kappa?: number; beta?: number | null; hill?: number }>
  >({});
  const [doseEdits, setDoseEdits] = useState<Array<{
    time: number;
    amount: number;
    duration: number;
  }> | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [censorEdited, setCensorEdited] = useState(false);
  const fixedSeed = useRef(false);
  const edited = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const callbacks = useRef({ onGenerate, onInvalidate });
  useEffect(() => {
    callbacks.current = { onGenerate, onInvalidate };
  });

  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    const initialize = async () => {
      try {
        const profile = await syntheticRequest<ProfileDescription>(
          { action: "describe", version },
          abort.signal,
        );
        if (abort.signal.aborted) return;
        setDescription(profile);
        const result = await syntheticRequest<SyntheticResponse>(
          {
            version,
            seed: SYNTHETIC_INITIAL_SEED,
            individuals: 10,
            observations: 8,
            schedule: "exact",
            shape: "early",
          },
          abort.signal,
        );
        if (abort.signal.aborted) return;
        setDraw(result);
        callbacks.current.onGenerate(result.study, result.provenance.seed);
      } catch (e) {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!abort.signal.aborted) setBusy(false);
      }
    };
    void initialize();
    return () => {
      abort.abort();
      controller.current?.abort();
    };
  }, [version]);

  const invalidate = () => {
    edited.current = true;
    onInvalidate();
  };
  const run = async (reset = false, fresh = false) => {
    if (busy) return;
    const preserve =
      !reset && !fresh && (fixedSeed.current || edited.current || censorEdited);
    const nextSeed = preserve
      ? seed
      : crypto.getRandomValues(new Uint32Array(1))[0] % 2 ** 31;
    const nextOverrides = reset ? {} : overrides;
    const nextKinetics = preserve ? kineticEdits : {};
    const nextDoses = reset ? null : doseEdits;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setSeed(nextSeed);
    onInvalidate();
    try {
      const result = await syntheticRequest<SyntheticResponse>(
        {
          version,
          seed: nextSeed,
          individuals,
          observations,
          schedule,
          shape,
          gridSeed,
          overrides: nextOverrides,
          ...(Object.keys(nextKinetics).length
            ? { kineticEdits: nextKinetics }
            : {}),
          ...(nextDoses ? { doseEvents: nextDoses } : {}),
        },
        abort.signal,
      );
      if (abort.signal.aborted) return;
      setDraw(result);
      setOverrides(nextOverrides);
      setKineticEdits(nextKinetics);
      setDoseEdits(nextDoses);
      callbacks.current.onGenerate(
        result.study,
        (edited.current || censorEdited) && !reset ? undefined : nextSeed,
      );
      setCensorEdited(false);
      fixedSeed.current = false;
      edited.current = false;
    } catch (e) {
      if (!abort.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };
  const section = (key: string, title: string, children: ReactNode) => (
    <CollapsibleSection
      title={title}
      open={!!open[key]}
      onToggle={() => setOpen((v) => ({ ...v, [key]: !v[key] }))}
    >
      {children}
    </CollapsibleSection>
  );
  const controls = (prefix: string[]) => (
    <div className="synthetic-prior-controls">
      {description?.controls
        .filter((c) => prefix.some((p) => c.path.startsWith(`${p}.`)))
        .map((c) => {
          const value = overrides[c.path] ?? c.default;
          return (
            <label key={c.path}>
              {c.label}
              <div className="prior-range-inputs">
                {(Array.isArray(value) ? value : [value]).map((v, i) => (
                  <input
                    key={i}
                    aria-label={`${c.label}${Array.isArray(value) ? (i === 0 ? " minimum" : " maximum") : ""}`}
                    type="number"
                    min={c.min}
                    max={c.max}
                    step={c.integer ? 1 : "any"}
                    disabled={busy}
                    value={v}
                    onChange={(e) => {
                      const number = Number(e.target.value);
                      if (!Number.isFinite(number)) return;
                      setOverrides((current) => ({
                        ...current,
                        [c.path]: Array.isArray(value)
                          ? value.map((x, j) => (i === j ? number : x))
                          : number,
                      }));
                      setKineticEdits({});
                      invalidate();
                    }}
                  />
                ))}
              </div>
            </label>
          );
        })}
    </div>
  );
  const graph = draw ? graphFromResponse(draw) : null;
  const rates = draw
    ? [...draw.topology.edges, ...draw.topology.elimination].map((r, i) => ({
        ...r,
        ...kineticEdits[i],
      }))
    : [];
  const doseRows =
    doseEdits ??
    draw?.study.doseEvents?.map((e) => ({
      time: e.time,
      amount: e.amount,
      duration: e.duration ?? 0,
    })) ??
    [];
  const editRate = (
    index: number,
    patch: { kappa?: number; beta?: number | null; hill?: number },
  ) => {
    setKineticEdits((current) => ({
      ...current,
      [index]: { ...current[index], ...patch },
    }));
    invalidate();
  };
  const configuration =
    draw?.provenance.resolved.configuration ?? description?.configuration ?? {};
  return (
    <article className="card synthetic-builder" aria-busy={busy}>
      <div className="section-heading synthetic-builder-heading">
        <h2>Synthetic cohort model · {version}</h2>
      </div>
      <div className="synthetic-generate-controls">
        <label>
          Individuals
          <input
            aria-label="Cohort individuals"
            type="number"
            min="2"
            max="16"
            disabled={busy}
            value={individuals}
            onChange={(e) => {
              setIndividuals(
                Math.max(2, Math.min(16, Math.round(Number(e.target.value)))),
              );
              invalidate();
            }}
          />
        </label>
        <label>
          Observations per individual
          <input
            type="number"
            min="2"
            max="20"
            disabled={busy}
            value={observations}
            onChange={(e) => {
              setObservations(
                Math.max(2, Math.min(20, Math.round(Number(e.target.value)))),
              );
              invalidate();
            }}
          />
        </label>
        <label>
          Cohort seed
          <input
            aria-label="Cohort seed"
            type="number"
            min="0"
            max={2 ** 31 - 1}
            disabled={busy}
            value={seed}
            onChange={(e) => {
              setSeed(
                Math.max(
                  0,
                  Math.min(2 ** 31 - 1, Math.round(Number(e.target.value))),
                ),
              );
              fixedSeed.current = true;
              invalidate();
            }}
          />
        </label>
        <button
          className="primary-button"
          disabled={busy || !description}
          onClick={() => void run()}
        >
          {busy ? "Generating…" : "Generate new cohort"}
        </button>
      </div>
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            className="secondary-button"
            onClick={() => window.location.reload()}
          >
            Reconnect
          </button>
        </p>
      )}
      <div className="synthetic-accordion-stack">
        {section(
          "graph",
          "Compartment graph",
          <>
            {controls(version === "v1" ? [] : ["graph"])}
            {draw && graph && (
              <div className="synthetic-model-grid">
                <div className="synthetic-graph-panel">
                  <CompartmentGraph graph={graph} />
                  <dl className="synthetic-facts">
                    <div>
                      <dt>Route</dt>
                      <dd>{draw.study.route}</dd>
                    </div>
                    <div>
                      <dt>Compartments</dt>
                      <dd>{graph.nodes.length}</dd>
                    </div>
                    <div>
                      <dt>Fluxes</dt>
                      <dd>{rates.length}</dd>
                    </div>
                  </dl>
                  <div className="synthetic-graph-actions">
                    <button
                      className="draw-model-button"
                      disabled={busy}
                      onClick={() => void run(false, true)}
                    >
                      Draw new compartment model
                    </button>
                  </div>
                </div>
                <div className="synthetic-equations">
                  <h3>Mass balances</h3>
                  {graph.nodes.map((n) => (
                    <Latex
                      key={n.id}
                      tex={balanceEquation(graph, n.id)}
                      block
                    />
                  ))}
                  <h3>Flux laws</h3>
                  {rates.map((r, i) => (
                    <Latex
                      key={i}
                      tex={fluxEquation(r, version, graph.central)}
                      block
                    />
                  ))}
                  <p>
                    X is compartment amount; i labels the individual. J is a
                    transfer or elimination flux. Dose events add amount to the
                    indicated compartments.
                  </p>
                  {version === "v1" ? (
                    <p>
                      T is the original time horizon. Absorption, elimination
                      and volume follow the archived OU paths; peripheral rates
                      have sinusoidal variation. Concentration is central amount
                      divided by the individual time-varying volume. The
                      canonical port uses LSODA, not the archived RK4 solver.
                    </p>
                  ) : (
                    <p>
                      κ is the population rate, r includes individual rate
                      multipliers and time-varying paths. β is an amount-based
                      saturation threshold, h is the Hill exponent and K
                      controls modulation. Concentration also depends on
                      individual volume.
                    </p>
                  )}
                </div>
              </div>
            )}
          </>,
        )}
        {section(
          "kinetics",
          "Kinetic parameters and priors",
          <>
            {controls(
              version === "v1"
                ? ["study"]
                : ["dynamics", "ou", "cohort", "covariate"],
            )}
            {draw &&
              (version === "v1" ? (
                <LinearPopulation population={draw.native?.population ?? {}} />
              ) : (
                <div className="synthetic-table-wrap">
                  <table className="synthetic-parameter-table">
                    <thead>
                      <tr>
                        <th>Connection</th>
                        <th>Law</th>
                        <th>κ</th>
                        <th>β (amount)</th>
                        <th>h</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rates.map((r, i) => (
                        <tr key={i}>
                          <td>
                            {draw.topology.roles[r.node ?? r.src]} →{" "}
                            {r.node === undefined
                              ? draw.topology.roles[r.dst!]
                              : "elimination"}
                          </td>
                          <td>
                            <select
                              aria-label={`Flux ${i + 1} law`}
                              disabled={busy}
                              value={r.beta == null ? "linear" : "saturable"}
                              onChange={(e) =>
                                editRate(i, {
                                  beta: e.target.value === "linear" ? null : 1,
                                })
                              }
                            >
                              <option value="linear">linear</option>
                              <option value="saturable">saturable</option>
                            </select>
                            {r.mod_node != null ? ` + ${r.mod_type}` : ""}
                            {r.gate_lag != null ? " + time gate" : ""}
                          </td>
                          <td>
                            <NumericEdit
                              label={`Flux ${i + 1} rate`}
                              value={r.kappa!}
                              min={0.00001}
                              max={1000}
                              disabled={busy}
                              onCommit={(value) =>
                                editRate(i, { kappa: value })
                              }
                            />
                          </td>
                          <td>
                            {r.beta == null ? (
                              "—"
                            ) : (
                              <NumericEdit
                                label={`Flux ${i + 1} threshold`}
                                value={r.beta}
                                min={0.00001}
                                max={1000}
                                disabled={busy}
                                onCommit={(value) =>
                                  editRate(i, { beta: value })
                                }
                              />
                            )}
                          </td>
                          <td>
                            {r.beta == null ? (
                              "—"
                            ) : (
                              <NumericEdit
                                label={`Flux ${i + 1} exponent`}
                                value={r.hill ?? 1}
                                min={0.00001}
                                max={3}
                                disabled={busy}
                                onCommit={(value) =>
                                  editRate(i, { hill: value })
                                }
                              />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            {draw && (
              <details>
                <summary>Sampled population and individual parameters</summary>
                <ValueTable value={draw.topology} />
                <ValueTable value={draw.population} />
                <ValueTable value={draw.individualTruth} />
              </details>
            )}
          </>,
        )}
        {version === "v7" &&
          section(
            "covariates",
            "Patient covariates",
            <>
              <p>
                Age, weight, height, sex, renal and hepatic function, and
                metabolic phenotype. Missing fields remain missing; they are not
                zero-valued patients. These influence the simulated dynamics;
                the currently served Pythia models do not condition on these
                fields.
              </p>
              {controls(["physiology"])}
              {draw && (
                <div className="synthetic-table-wrap">
                  <table className="synthetic-parameter-table">
                    <thead>
                      <tr>
                        <th>Individual</th>
                        {[
                          "Age (years)",
                          "Weight (kg)",
                          "Height (cm)",
                          "Sex",
                          "Renal ratio",
                          "Hepatic ratio",
                          "Metabolic phenotype",
                        ].map((k) => (
                          <th key={k}>{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {draw.study.subjects.map((s, i) => (
                        <tr key={s.id}>
                          <td>{i + 1}</td>
                          {[
                            "age_years",
                            "weight_kg",
                            "height_cm",
                            "sex",
                            "renal_function_ratio",
                            "hepatic_function_ratio",
                            "metabolic_phenotype",
                          ].map((k) => (
                            <td key={k}>
                              {typeof s.covariates?.[k] === "number"
                                ? Number(s.covariates[k]).toPrecision(4)
                                : String(s.covariates?.[k] ?? "Missing")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {draw && (
                <details>
                  <summary>Latent physiology (simulation truth)</summary>
                  <ValueTable
                    value={Object.fromEntries(
                      Object.entries(draw.individualTruth).map(([id, v]) => [
                        id,
                        v.semantic_physiology,
                      ]),
                    )}
                  />
                </details>
              )}
            </>,
          )}
        {section(
          "protocol",
          "Dose and observation protocol",
          <>
            {controls(["dosing"])}
            {draw && version !== "v1" && (
              <>
                <div className="synthetic-dose-editor">
                  {doseRows.map((event, index) => (
                    <div className="synthetic-dose-row" key={index}>
                      <span>Dose {index + 1}</span>
                      <span>
                        Time τ{" "}
                        <NumericEdit
                          label={`Dose ${index + 1} time`}
                          value={event.time}
                          min={0}
                          max={1 - event.duration}
                          disabled={busy || index === 0}
                          onCommit={(value) => {
                            setDoseEdits(
                              doseRows.map((e, i) =>
                                i === index ? { ...e, time: value } : e,
                              ),
                            );
                            invalidate();
                          }}
                        />
                      </span>
                      <span>
                        Amount{" "}
                        <NumericEdit
                          label={`Dose ${index + 1} amount`}
                          value={event.amount}
                          min={0.001}
                          max={100}
                          disabled={busy}
                          onCommit={(value) => {
                            setDoseEdits(
                              doseRows.map((e, i) =>
                                i === index ? { ...e, amount: value } : e,
                              ),
                            );
                            invalidate();
                          }}
                        />
                      </span>
                      <button
                        className="icon-button"
                        aria-label={`Remove dose ${index + 1}`}
                        disabled={busy || index === 0}
                        onClick={() => {
                          setDoseEdits(doseRows.filter((_, i) => i !== index));
                          invalidate();
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <div className="synthetic-dose-actions">
                  <label htmlFor="shared-infusion-duration">
                    Shared infusion duration (0 = bolus)
                    <NumericEdit
                      id="shared-infusion-duration"
                      label="Shared infusion duration"
                      value={doseRows[0]?.duration ?? 0}
                      min={0}
                      max={1 - Math.max(...doseRows.map((e) => e.time))}
                      disabled={busy}
                      onCommit={(value) => {
                        setDoseEdits(
                          doseRows.map((e) => ({ ...e, duration: value })),
                        );
                        invalidate();
                      }}
                    />
                  </label>
                  <button
                    className="secondary-button"
                    disabled={
                      busy ||
                      doseRows.length >= 8 ||
                      (doseRows.at(-1)?.time ?? 0) +
                        (doseRows[0]?.duration ?? 0) >=
                        1
                    }
                    onClick={() => {
                      const duration = doseRows[0]?.duration ?? 0;
                      const last = doseRows.at(-1)?.time ?? 0;
                      setDoseEdits([
                        ...doseRows,
                        {
                          time: last + (1 - duration - last) / 2,
                          amount: 1,
                          duration,
                        },
                      ]);
                      invalidate();
                    }}
                  >
                    + Add dose
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      setDoseEdits([{ time: 0, amount: 1, duration: 0 }]);
                      invalidate();
                    }}
                  >
                    Single unit bolus
                  </button>
                </div>
              </>
            )}
            <div className="synthetic-schedule-controls">
              <label>
                Observation schedule
                <select
                  disabled={busy}
                  value={schedule}
                  onChange={(e) => {
                    setSchedule(e.target.value);
                    invalidate();
                  }}
                >
                  <option value="exact">Exact scheduled</option>
                  <option value="pseudo_scheduled">Pseudo-scheduled</option>
                  <option value="unscheduled">Unscheduled</option>
                </select>
              </label>
              <label>
                Time weighting
                <select
                  disabled={busy || schedule === "unscheduled"}
                  value={shape}
                  onChange={(e) => {
                    setShape(e.target.value);
                    invalidate();
                  }}
                >
                  {["uniform", "early", "late", "clustered"].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="secondary-button"
                disabled={busy || schedule === "exact"}
                onClick={() => {
                  setGridSeed((v) => v + 1);
                  invalidate();
                }}
              >
                Resample observation grid
              </button>
            </div>
            {draw && (
              <>
                <DoseTimeline
                  events={(draw.study.doseEvents ?? []).map((e) => ({
                    ...e,
                    route: e.route as "oral" | "iv",
                    duration: e.duration ?? 0,
                  }))}
                  observationTimes={draw.study.subjects.map((s) =>
                    s.points.map(([t]) => t),
                  )}
                />
                <ValueTable
                  value={{
                    "Reference dose events": draw.study.doseEvents,
                    "Individual dose events": Object.fromEntries(
                      draw.study.subjects.map((s, i) => [i + 1, s.doseEvents]),
                    ),
                  }}
                />
              </>
            )}
            <p>
              Observations are subsets of the canonical 128-point bases, with
              the terminal observation retained. This view shows one source
              cohort, not the five counterfactual arms of a corpus family.
            </p>
          </>,
        )}
        {censoringControls &&
          section(
            "censoring",
            "Data censoring",
            censoringControls(() => setCensorEdited(true)),
          )}
        {section(
          "configuration",
          "Complete configuration and provenance",
          <>
            {Object.entries(configuration).map(([name, value]) => (
              <details key={name}>
                <summary>{name}</summary>
                <ValueTable value={value as Record<string, unknown>} />
              </details>
            ))}
            {draw && (
              <ValueTable
                value={{
                  provenance: draw.provenance,
                  integration: draw.integration,
                }}
              />
            )}
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void run(true)}
            >
              Reset to canonical defaults
            </button>
          </>,
        )}
      </div>
    </article>
  );
}
