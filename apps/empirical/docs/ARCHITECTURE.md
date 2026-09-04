# Dashboard and PFF inference plan

## Scope and scientific boundary

The browser reads immutable, versioned study records. It must never reproduce
the training-time normalization logic independently: the PFF service owns
dimensionless time/concentration transforms, context-derived preprocessing,
source-process construction, flow integration, and inversion to reported units.
This keeps a displayed counterfactual tied to the checkpoint that produced it.

## Phase 1 — empirical explorer (implemented)

The static catalogue contains Lenuzza individual records, other individual
empirical studies, and published cohort summaries. The client computes only
transparent descriptive quantities and plotting statistics. The source files
remain the scientific source of truth; `npm run data:build` regenerates the
browser asset deterministically.

## Phase 2 — persisted PFF results (implemented locally)

Ingest already generated PFF sample artifacts and associate every artifact with
`studyId`, checkpoint, preprocessing mode, solver, solver steps, random seed,
requested dose events, code commit and creation time. The dashboard can compare
observations, samples and VPCs without running a model interactively. This is
the reproducible path for paper figures.

## Phase 3 — online zero-shot inference (implemented)

The browser calls the `POST /inference` contract in `app/lib/model-api.ts`.
The shared Python service in `services/inference/` validates units and dose events, creates a content-addressed
request, and runs `pff_pk` with PyTorch. It loads the checkpoint once, generates
draws, writes a persistent JSON artifact, and returns its identifier. The
public dashboard fixes integration to eight Heun steps and exposes only the
number of generated individuals (20 by default, at most 30). It uses the same
inference contract through a CPU Hugging Face Space. Caching the
context encoding and GP factor across separate protocol requests remains a
performance improvement.

## Phase 4 — dose counterfactuals and interventions

A protocol is an ordered sequence of dose events `(time, amount, unit, route)`.
The dashboard supports a baseline dose and additional dose events. Observed
study trajectories remain visually distinct from generated counterfactuals,
even when they share an axis. The UI overlays generated trajectories and VPC
uncertainty on the study panels and can hide the study context for inspection.

## Acceptance criteria

1. Unit round trips reproduce the empirical values exactly.
2. Browser PK estimates have fixture tests with known analytic answers.
3. Identical model requests resolve to the same cached artifact.
4. Every rendered model panel displays checkpoint and protocol provenance.
5. Failed or out-of-support protocols are rejected rather than extrapolated silently.
