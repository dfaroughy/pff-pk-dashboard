# CPU inference boundary

The static application sends physical concentration observations and dose events.
This service validates requests and delegates preprocessing, source construction,
flow integration and inverse transforms to `pff_pk`.

Two separate lazy runtimes serve `pythia` (generation at the reference regimen)
and `pythia_dose` (generation and dose interventions). Checkpoint paths can be
overridden through the documented `PFF_*_CHECKPOINT` and `PFF_*_CONFIG` variables.
Local defaults retain the historical checkpoint locations for compatibility.

Responses persist the generated sample pool and statistical summary. Cache keys
include the request, checkpoint/configuration hashes and VPC method version.
Changing the VPC implementation does not overwrite historical cache files.

The dashboard uses `pff_pk.metrics.mesh_vpc.mesh_vpc_summary`: whole curves are
sampled **with replacement** from the finite generated pool and assigned to
the observed individual schedules. It uses actual query times, not bin centres.
This is an inexpensive finite-pool bootstrap approximation, not a call to
Pharmpy or 200 additional independent model draws. See
[the full contract](../../docs/VPC_CONTRACT.md).

Run `npm run test:services` or `npm run dev:empirical` from the repository root.
The same implementation is copied into a provenance-recorded CPU Space bundle;
there is no independently maintained deployed science implementation.

Limits remain 128 context individuals, 8,192 observations and 1,024 distinct
times. Pythia produces up to 100 individuals; Pythia-Dose up to 30. The public
Space enforces eight Heun steps and serializes inference.
