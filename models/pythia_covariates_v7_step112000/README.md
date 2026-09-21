# Pythia_Covariates — best checkpoint from the completed 120k run

The existing local `pythia_covariates` model entry now selects step **112,000**,
the best full-validation-bank checkpoint (loss 1.7774440029946463), not the final
120,000-step checkpoint. Its architecture and input capabilities are unchanged.

Run: `v7-thunder-recovery-76000-20260918`, Comet key
`81db5ad37a5a4e0d9f333c5fce7925e3`. The manifest pins the full checkpoint hash.
Weights remain outside the dashboard repository, under
`../pff_pk/artifacts/checkpoints/pythia_covariates_v7_step112000/`.

The existing environment overrides remain supported. No hosted release is changed.
Older checkpoint directories remain intact. Inference cache keys include the
checkpoint checksum, preventing reuse of responses from the previous model.
