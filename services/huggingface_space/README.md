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

The named Gradio endpoints are `/health` and `/inference`. Inference is
serialized to keep memory use bounded; identical requests reuse a response
keyed by the request and immutable model/configuration fingerprints.

Dashboard: <https://dfaroughy.github.io/pff-pk-dashboard/empirical/>
