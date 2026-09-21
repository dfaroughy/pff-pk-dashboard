# Local v7 integration smoke

Run against a freshly started local service using the intended source checkouts:

```sh
../pff_pk/.venv/bin/python scripts/smoke-local-v7.py \
  --api http://127.0.0.1:8791 \
  --output ../artifacts/local_v7_smoke
```

Requires the configured local Pythia-Covariates checkpoint. The script generates
four real v7 individuals (seed 30), then requests two trajectories with eight
Heun steps for six cases: full/partial/no covariates, supplied/hidden LLOQ, and a
changed dose/infusion protocol on an independent observation grid. It verifies
finite aligned trajectories, VPC output and checkpoint provenance, and saves the
requests/responses plus a summary. This checks wiring, not scientific calibration.

## 2026-09-21 cleanup verification

- Fresh CPU service on port 8792; all six cases passed with the real local best
  checkpoint at actual `global_step=112000`, SHA-256
  `0cd3cdfdd1e6cf27f44cd4f9f201a437825a6fe607664e196ef25551aead55fd`.
- Production-built frontend also generated a v7 cohort (16 context individuals),
  ran two Pythia-Covariates draws through that service, and displayed trajectories,
  VPC and covariate plots. Local evidence: workspace
  `artifacts/cleanup_integration_20260921/`, including `dashboard-smoke.png`.
- Development-mode rapid cohort edits encountered the existing service-busy
  response; this is not evidence of a checkpoint failure or a passed concurrency
  stress test. No unrelated in-progress UI edits were included in the smoke commit.
- The final 120k checkpoint was independently read as `global_step=120000`, SHA-256
  `8c9974bc962871c20d2a22c70f92d7c48ba7b10b8acfc2534b5604ba413924d7`.
  No local 200k artifact was found. Neither these checks nor this commit releases
  a 200k model, changes hosted inference, or publishes weights.
