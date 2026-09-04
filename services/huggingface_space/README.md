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

The service runs on CPU Basic hardware. It does not use ZeroGPU and therefore
does not consume visitors' daily GPU quota.

Public requests generate 20 individuals by default and are capped at 30
individuals. The demo fixes flow integration to eight Heun steps; solver
controls are not exposed. These limits are enforced by both the dashboard and
the inference service.

The named Gradio endpoints are `/health` and `/inference`. Inference is
serialized to keep memory use bounded; identical requests reuse a response
keyed by the request and immutable model/configuration fingerprints.

Dashboard: <https://dfaroughy.github.io/pff-pk-dashboard/empirical/>
