# Pythia-Covariates — local preview

V7 production checkpoint from Amarel job **61430867**, saved at optimizer step
**5,000 / 120,000**. This is an early training snapshot, not a validated release.
The production run was left untouched. See `manifest.json` for its remote path,
local checkpoint path, byte count and locally computed SHA-256.

`inference.yaml` pins the model hyperparameters embedded in this checkpoint and
its declared preprocessing. Normalization, architecture, source, protocol,
covariate and censoring contracts are checked by the existing strict loader.
The checkpoint binary stays outside the dashboard repository.

## Local use

Select **Pythia-Covariates** at `http://localhost:5173/synthetic/` or on the
empirical page. The service model ID is `pythia_covariates`. Optional overrides:
`PFF_COVARIATES_CONFIG` and `PFF_COVARIATES_CHECKPOINT`.

- Context: seven semantic fields plus `cov_cont_0` and `cov_cat_0`, encoded by
  the existing PFF helpers. Missing fields remain masked.
- Generated targets: the expandable table below dose controls has one row per
  requested curve and columns for supported covariates present in context.
  Blank cells remain masked. Each response records its ordered `targetCovariates`
  rows, aligned with `generatedConcentration`. Covariates are supplied, not generated.
  Generic values use context-only normalization; distinct target rows use the
  non-shared inference path rather than incorrectly reusing target embeddings.
- Known LLOQ is transformed with the same concentration normalization as the
  observations. Explicit CENS labels are preserved. Absent LLOQ remains masked.
- Unresolved assay records are omitted from model conditioning, not guessed as
  exact/BLQ; the original records remain in the VPC and query mesh. The omitted
  count is returned in response provenance.
- A repeated-dose protocol recorded identically for every patient is recognized
  as shared by the dashboard. Truly different patient protocols still require
  a target-protocol choice and remain unavailable in these UI controls.
- Generated concentrations are latent outputs, not clipped to the assay floor.

## Verification (September 12, 2026)

Strict checkpoint load passed. Real 8-step Heun inference passed with supplied
covariates, with no covariates/floor, and with explicit LLOQ/CENS. An HTTP request
for the Pumas 100 mg cohort returned three finite positive 26-point trajectories
in about 0.37 s of inference/reporting time on local CPU (not a benchmark).
Per-target conditioning also passed a three-row, two-row-batch check: changing
only target row 1 changed curve 1 while leaving curves 2 and 3 unchanged at the
same seed (female/60 kg, male/90 kg, and unspecified targets).

Nothing was published to the website or Hugging Face.
