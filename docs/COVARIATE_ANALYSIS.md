# Local covariate exploration

Target population controls default to seeded resampling of complete context
rows (with replacement). Explicit numeric ranges filter the donor pool;
equal bounds override a field with a fixed value. Category selections override
that field for every target; Random retains the sampled donor's category.
Unspecified removes the field. These overrides need not preserve physiological
correlations. Empty range intersections are reported, not silently widened.
Individual edits are available under Advanced and take precedence; changing
population controls clears those edits. This is dashboard resampling, not a
learned covariate generator. The analysis controls/legend sit left of the plot
on desktop and stack above it on narrow screens.

The dashboard v7 adapter merges each patient's stored hidden and observed
covariates into the exported context. It does not resample patients, change
trajectories, edit training profiles or change the canonical record hash.
`dashboardCovariates: truth` records this presentation/inference policy.
Regenerate an existing browser-held cohort to pick up the new policy.

`CovariateAnalysis` is expanded by default below the main results.
It offers side-by-side concentration curves and mean ± SD VPCs, plus
AUC/Cmax/Tmax views. Each concentration plot has its own Log/Lin toggle. Group
colors are consistent between observed and generated data. Continuous bins
are equal-width over the displayed observed and explicitly requested target
values; interior upper boundaries are exclusive, and the last is inclusive.

Generated rows are assigned using `result.request.targetCovariates`, never
by copying a context patient's values. Unspecified targets are excluded from
stratified analyses. Covariate VPCs show arithmetic means and sample standard
deviations (n−1 denominator), not percentile bands or confidence intervals.
Observed summaries use exact observation times within each group; generated
summaries use that group's generated pool at the same times, with no
interpolation or extrapolation. SD requires two individuals. An observed time
containing censored/unresolved values is left unidentified, not summarized
from floor substitutions or the quantified subset. Error bars crossing zero
are clipped at the plot boundary (also on log axes). The main percentile VPC
is unchanged. Neither plot alone establishes calibration or causal validity.

PK plots use the common observed window, no extrapolation, and acquisition
schedules cycled within each stratum for generated profiles. AUC uses linear
trapezoids; Cmax/Tmax refer to the sampled window. Censored/unresolved observed
profiles are omitted from exact PK summaries. Category plots include points
and 5/50/95% summaries; continuous plots show individual points. These are
descriptive associations, not dose-adjusted or causal covariate effects.

Implementation: `app/lib/covariate-analysis.ts` and
`app/components/CovariateAnalysis.tsx` within `apps/empirical/`.
