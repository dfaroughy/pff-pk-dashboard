# Pythia v7 release gate

The intended first frozen Pythia release awaits verified completion of the
200k-step continuation. Local `Pythia_Covariates` availability is not a release
of that artifact. Do not relabel the existing 112k best checkpoint as 200k.

The cross-repository checklist is maintained in
`pff_pk/docs/PYTHIA_RELEASE_FREEZE.md` in the sibling training repository.
At promotion, pin the selected checkpoint SHA256, actual step, inference feature
contract, HF revision and service release manifest; record the previous working
release for rollback. Model-card limitations must distinguish trajectory
conditioning from covariate generation.

`main` pushes deploy GitHub Pages automatically. Keep preparation on a review
branch until the coordinated HF/service/frontend promotion is ready. A frontend
deployment does not upload model weights or update the separate inference service.
