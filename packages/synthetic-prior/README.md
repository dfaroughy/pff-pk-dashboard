# Browser synthetic-cohort simulator

Dependency-free TypeScript model shared by the interactive cohort builder.
The source was extracted unchanged from the retired standalone synthetic app.
It provides graph and kinetic draws, dose protocols, and a compact browser solver.

This is a teaching/demo simulator, not the production `synthetic_priors` solver
or a bitwise reproduction of the v6 corpus. Corpus numerical acceptance and
convergence checks remain authoritative in the Python package. The integrated
builder is tested in `apps/empirical/tests/`; its appearance and fonts are unchanged.
