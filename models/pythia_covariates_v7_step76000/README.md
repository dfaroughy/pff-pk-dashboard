# Pythia_Covariates — step 76,000 (local)

The local service's `pythia_covariates` entry uses the verified Thunder production
checkpoint at step 76,000. The full checkpoint is stored outside this repository:
`../pff_pk/artifacts/checkpoints/pythia_covariates_v7_step76000/step-000076000.ckpt`.
Its checksum and source experiment are recorded in `manifest.json`.

`inference.yaml` matches the source production model configuration, including
semantic/generic covariates, left censoring and attention query chunk size 64.
Environment overrides `PFF_COVARIATES_CONFIG` and `PFF_COVARIATES_CHECKPOINT`
remain supported. Earlier model directories/checkpoints are untouched.

Open http://localhost:5173/synthetic/ (or the empirical tab), refresh, and select
**Pythia_Covariates**. `/health` reports `checkpointId: step-000076000`.
Response provenance must report the manifest's checkpoint SHA256; inference cache
keys include this hash, so older model outputs are not reused for new requests.

Verified locally: strict checkpoint load; production model-config equality;
real HTTP inference with covariates/LLOQ, hidden LLOQ input, and neither covariates
nor LLOQ; all returned finite trajectories with the expected checkpoint checksum.
22 service/covariate tests and 31 model-panel tests passed.

This is a local-only update. No hosted weights, service, or website were deployed.
