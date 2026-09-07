# Production hardening — 7 September 2026

## Completed work

1. Removed the dashboard's separate, misleadingly labelled Pharmpy implementation.
   The model package now owns `mesh-bootstrap-v1`, with replacement, whole-curve
   resampling and observation-design matching. Added degenerate-pool, equal-size,
   irregular-schedule, invalid-input and deterministic-seed regression tests.
2. Removed synthetic VPC grouping by observation index. Observed summaries use
   actual sampling times and the same order-statistic convention as the service.
   Historical responses remain readable and are labelled as legacy, not silently
   relabelled as the corrected method. Method identity is part of cache identity.
3. Added TypeScript and Python-service release gates and fixed the literal-state
   typing errors. Upgraded compatible frontend toolchain dependencies; npm audit
   reports no vulnerabilities. The Gradio client is loaded lazily.
4. Extracted the browser simulator to `packages/synthetic-prior`; retired the
   standalone synthetic application and unused starter assets, facts panel data,
   duplicate launcher and empty shared-UI placeholder. The legacy URL redirects.
5. Replaced destructive bundle output handling with validated, staged replacement,
   file-hash/source provenance and private-weight/environment-file rejection.
   Added a transitive Linux CPU dependency lock and bundle safety tests.
6. Moved production Python commands into their owning packages. Checkout wrappers
   preserve old imports/launch commands, while installed wheels no longer expose
   generic `scripts` or `tools` packages. Packaged the authoritative prior YAML;
   its old checkout path is a symlink to avoid two copies. PD generation now uses
   the bounded-retry production driver instead of its own unbounded loop.
7. Split model dependency extras and enabled Pyflakes on unchanged architectures.
   CI checks installed wheels outside the checkout, current/frozen prior
   compatibility, and the standalone Linux CPU Space runtime. Dedicated read-only
   deploy keys provide private-repository access without a personal write token.
8. Put `corpora/empirical/pharmpy_nlme` in a standalone local Git repository at its
   existing path. Added Python/R locks, adoption-time environment/input metadata,
   and automatic source/data/configuration/environment provenance for future runs.
   No archived fit or dataset was modified. It has no remote repository yet.

## Verification

| Surface | Result |
| --- | --- |
| Simulator full pytest suite | 97 passed |
| Model full pytest suite | 208 passed |
| Frontend unit tests | 41 passed |
| Built catalogue and Pages routing | 6 passed |
| Python service and bundle safety | 19 passed |
| NLME baseline | 7 passed |
| Python lint, TypeScript, frontend lint, npm audit | Passed |
| Clean-wheel commands outside checkout | Passed |
| Standalone Space bundle import using bundled packages | Passed |

Real CPU inference also passed for both existing checkpoints on Lenuzza caffeine:
10 generated individuals, 17 empirical query times ending at 24 h, eight Heun
steps, seed 43. Repeat requests reused the persisted result. Samples remain under
`dashboard/.cache/hardening-smoke/` with IDs `e6e5b730c07a4f367a7e` (Pythia) and
`1447911783b451d2130b` (Pythia-Dose).

## Preserved boundaries and release status

No changes were made to neural architectures, source-process mathematics,
preprocessing, checkpoint tensors, ODE equations, existing corpus records, or
remote jobs. The independent reference solver and historical baseline export
are retained deliberately. Existing fonts and styles were not changed.

Code has not been pushed or deployed. Linux Space checks are wired into CI;
the locked Linux environment was resolved, but the local runtime tests ran on
macOS. Follow `RELEASING.md`: publish scientific interfaces before their dashboard
consumer, then explicitly update the Space. The UI's finite-pool approximation
does not replace formal Pharmpy evaluation or make 20 curves sufficient for
precise tail inference.

Linear could not be updated from this checkout: no Linear connector, environment
credential, or repository `.env` was available. This document preserves the task
record for linking to the project once access is restored.
