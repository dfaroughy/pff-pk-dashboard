# Canonical synthetic cohorts

The `/synthetic/` version selector chooses `get_profile("v1" | "v6" | "v7")`
from `synthetic_priors`. Draws run through `generate_profile_study`, not a
TypeScript reimplementation. The former browser teaching solver is removed.
The scientific repository is not modified by the dashboard.

## What is being sampled?

These are independent source cohorts, not stored training/test rows, historical
BO-selected studies, or the five arms of a protocol family. Scientific profile
version and serialization schema are different concepts. V7's source cohort
includes patient physiology; selecting v7 here does not implicitly expand a
five-arm prescribing-policy family.

- **v1:** archived linear-in-amount compartment model and parameter prior;
  individual doses, OU absorption/elimination/volume paths, sinusoidal peripheral
  exchange. Uses the canonical LSODA port, not historical Torch RK4. Population
  parameters and the complete configuration are shown. Source curves are clean;
  the original sampled relative-error parameter is not applied to source curves.
- **v6:** canonical general mechanistic model, with saturable/modulated/gated
  fluxes, time variation and anonymous covariates. Parameters come from returned
  topology/population truth; no hand-written replacement distributions.
- **v7:** the same general mechanisms plus meaningful adult patient covariates
  and their mechanistic effects. The patient table shows observed physical
  fields, explicitly marking missing ones. Latent physiology is separately
  available as simulation truth. Current served Pythia models do not condition
  on these patient fields.

## Controls and reproducibility

The canonical profiles and full configurations are served by Python. Selected
bounded fields are editable: their defaults come from the canonical config.
Edits are request-local and recorded as a distinct resolved profile hash; they
never rewrite profile files. The full effective configuration is inspectable.
Except for graph sampling settings, manual controls update the displayed cohort automatically after a 300 ms
pause in editing. Requests retain the current seed, and superseded requests are
cancelled so late results cannot replace newer curves. Controls remain editable
while computing. Pythia is re-enabled when the latest update succeeds.
“Sample new model” draws a fresh seed and clears manual flux and dose edits.
Flux, dose and acquisition edits preserve the topology. Graph-prior changes can
change the topology. The four graph sampling controls (oral probability, maximum
transit compartments, recycling probability and parallel absorption probability)
live beside “Draw new compartment model” below the graph. Their edits are staged
until that button is pressed; automatic updates and the top sample button use the
currently applied graph settings. Other probability controls are not exposed.

V6/v7 realised kinetic edits and explicit dose protocols use `system_from_source`,
`population_from_source`, `simulate_arm` and `pack_arm` from the production
package. Patients, observation bases and the source time gauge are retained.
V1 is not routed through this incompatible backend. Each dose row edits amount, time and its own infusion Δt. Zero duration is a bolus;
positive durations use the production solver’s event-specific infusion inputs,
including mixed and overlapping infusions.
Graph-prior and seed changes clear row-indexed kinetic edits; other prior edits retain them. Dosing-prior edits clear explicit dose overrides.

Every response includes canonical and resolved profile hashes, implementation
hash, source record hash, resulting record hash, seed, overrides and numerical
diagnostics. Numerical rejection is reported for the actual requested seed;
there is no hidden seed substitution or browser fallback. A 90-second worker
timeout bounds unlucky or extreme draws. Requests are limited to 2–100 people (default 16)
and 2–20 displayed observations, independently of the 128-point source bases.

Exact and pseudo-scheduled views select points from the regular base;
unscheduled views (the default) select points from each individual's random base. These are
dashboard acquisition views, not changes to the biological prior. They do not
interpolate new concentrations. Times remain ordered and the last point is
always tau=1. The existing optional censoring display acts after generation;
it is not part of the clean canonical source and does not alter its provenance.

The inference adapter preserves the supplied shared and individual dose events
in the existing Pythia-Dose context tensors. It must not replace multi-dose,
infusion or individual-dose histories with the empirical helper's default unit
bolus. Pythia remains dose-naive; the model architecture is unchanged.

## Services and release

Local HTTP: `POST /synthetic`; hosted Gradio: `/synthetic` with a `payload` object.
`{"action":"describe","version":"v7"}` loads the canonical config/controls.
Generation accepts version, seed, individuals, observations, schedule, shape,
gridSeed, bounded overrides and (v6/v7 only) kineticEdits/doseEvents.

Hugging Face bundles now contain the complete canonical `synthetic_priors`
package and its resources, with a provenance manifest and SciPy in the CPU
lockfile. Deploy **both** the updated Space and frontend together. A frontend
deployment alone cannot add this endpoint to an old Space. No model weights
are included in the public bundle. The frontend remains provider-independent.

`test_synthetic_service.py` checks production-record parity, all acquisition
families, overrides, replay, validation and subprocess equivalence. Frontend
tests check per-version controls, missingness, edit/seed semantics, errors and
stale-response cancellation.

The generic-covariate section exposes the observed and hidden `cov_*` roster,
network dimensions, activation, effect scale, sparsity, output order and sampled
weights. `mlpSeed` redraws the network through the production generator while
retaining the study seed, covariate inputs, residual variability, topology and
protocol. It explicitly enables a generic map if the canonical draw has none;
this intervention is recorded in provenance and marked modified. A new complete
model draw clears the MLP override. No hidden inputs are copied into the study's
observed covariates.
