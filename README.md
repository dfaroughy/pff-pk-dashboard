# Pythia-PK dashboard

One provider-independent React application for empirical, uploaded and synthetic
cohorts, with Python/PyTorch inference. Model weights never enter the frontend.
Space Grotesk, IBM Plex Mono, and the existing light/dark visual design are retained.

## Layout

- `apps/empirical/`: integrated cohort explorer and interactive synthetic builder.
- `services/inference/synthetic_service.py`: canonical v1/v6/v7 generation adapter.
- `services/inference/`: request validation, persistent samples and model adapter.
- `services/huggingface_space/`: CPU Space adapter and reproducible bundle builder.
- `models/`: release manifests, not checkpoints.

The standalone synthetic app was retired. Its previous implementation remains
in Git history; `/synthetic/` serves the integrated cohort builder directly,
using the same application code as `/empirical/` without redirecting there.

## Local development and checks

```bash
npm ci --prefix apps/empirical
npm run dev:empirical
npm run check
npm run test:services
```

The dev command starts the frontend and sibling `pff_pk/.venv` CPU service.
Override `PFF_REPO` and `PFF_PYTHON` for another installed environment.
Synthetic draws use the sibling `synthetic_priors` package (override
`SYNTHETIC_PRIORS_REPO` if necessary), not a browser approximation. The version
selector loads the frozen Python profile, with bounded prior controls and
version-specific parameter views. See [synthetic cohorts](docs/SYNTHETIC_PROFILES.md).
The frontend check covers TypeScript, lint, unit tests, one production build,
built catalogue checks and Pages routing. Service tests require the model
package and its dependencies; they do not require a checkpoint or a GPU.

## Publishing

`npm run build:pages` writes the static site to `dist/`. Users need only a browser.
GitHub Pages deployment requires both frontend and Python service checks to pass.
CPU inference is hosted separately on Hugging Face; publishing the frontend does
not update that service. See [release instructions](docs/RELEASING.md).

The service calls the model package for preprocessing and flow integration.
Finite-pool VPC resampling also lives in that package, with an explicit versioned
method distinct from formal Pharmpy evaluation. See
[the statistical contract](docs/VPC_CONTRACT.md).
