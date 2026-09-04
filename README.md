# PFF-PK dashboards

Public, provider-independent interfaces for prior-fitted pharmacokinetic flows.
This repository is intentionally separate from the model and synthetic-prior
packages: it consumes their stable scientific interfaces but does not duplicate
their implementation.

## Repository layout

- `apps/empirical/`: empirical and Lenuzza cohort explorer with optional PFF
  inference and dose interventions.
- `apps/synthetic/`: interactive constructor for the v6 synthetic PK prior.
- `services/inference/`: Python/PyTorch inference service shared by the public
  dashboard and local development.
- `packages/ui/`: shared visual contract for typography and design tokens.
- `models/`: model-release manifests only; checkpoints remain on Hugging Face.

The two applications retain their existing visual design: Space Grotesk for
interface text and IBM Plex Mono for scientific metadata.

## Run locally

From this directory:

```bash
npm run dev:synthetic
npm run dev:empirical
```

The empirical command also starts the local Python/PyTorch inference service.

## Build for any web host

Install dependencies once in each application, then build both:

```bash
npm ci --prefix apps/synthetic
npm ci --prefix apps/empirical
npm run build:pages
```

The combined site is written to `dist/`, with the empirical and synthetic
applications at `/empirical/` and `/synthetic/`. GitHub Actions publishes this
directory to GitHub Pages. See each application README for local development
and inference endpoint configuration.

## Model serving

Model weights do not belong in this repository. A Hugging Face model repository
stores the checkpoint and matching configuration. A ZeroGPU Gradio Space will
load that immutable revision and expose inference to the empirical dashboard.
The Space deployment is kept as a mirror of `services/inference/`; GitHub is the
canonical source.
