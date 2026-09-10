---
title: PFF-PK inference API
emoji: 💊
colorFrom: blue
colorTo: indigo
sdk: gradio
sdk_version: 6.2.0
python_version: "3.12"
app_file: app.py
pinned: false
license: other
---

# PFF-PK inference API

Server-side inference for the public PFF-PK pharmacokinetic dashboard. Model
weights are loaded from a private, immutable Hugging Face model release and are
never included in this Space repository or returned by its API.

The release stores the generation-only `digital_square_8491` model under
`models/pythia/` and the dose-aware v6 model under `models/pythia-dose/`.
Their checkpoints, configurations and capability manifests remain separate.

The service runs on CPU Basic hardware. It does not use ZeroGPU and therefore
does not consume visitors' daily GPU quota.

Public requests generate 20 individuals by default. Generation-only Pythia
requests are capped at 100 individuals; Pythia-Dose requests retain the
30-individual cap. The demo fixes flow integration to eight Heun steps; solver
controls are not exposed. These limits are enforced by both the dashboard and
the inference service. Each VPC uses that same generated pool and
design-matched cohorts resampled with replacement. Exact shared schedules use query-time summaries by default. Irregular schedules
use Pharmpy time bins, with matching bins for observed and generated percentiles.
The editable bin count recomputes statistics from the existing generated pool;
it does not run inference again. Bands connect bin centers with straight lines.
Intervals are conditional on the finite generated pool. The VPC method version
participates in caching.

The named Gradio endpoints are `/health`, `/synthetic`, and `/inference`. Inference is
serialized to keep memory use bounded; identical requests reuse a response
keyed by the request and immutable model/configuration fingerprints.

Dashboard: <https://dfaroughy.github.io/pff-pk-dashboard/empirical/>
