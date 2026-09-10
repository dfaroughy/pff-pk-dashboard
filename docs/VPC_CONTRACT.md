# Versioned VPC contract

## Interactive approximation: mesh-bootstrap-v1

The generated pool contains the actual model samples returned to the browser.
The method resamples whole curves **with replacement**, independently assigning
one curve to each observed individual in each bootstrap cohort. It applies that
individual's observation schedule before computing each time-wise percentile.
Thus within-curve dependence and the observed sample count at each time are
retained. Sampling without replacement is not used, including when the two
cohort sizes are equal.

At each actual observation time, the summary reports observed and generated
5th, 50th and 95th percentiles and the 5th/95th percentiles across 200 bootstrap
cohort statistics. The order statistic at probability p uses zero-based index
floor(p * (n - 1) + 0.5), consistently in Python and browser observed VPCs.
The reported centre is the percentile of the full generated pool; interval
endpoints summarize bootstrap cohort percentiles.

These intervals approximate cohort sampling variability **conditional on the
finite pool**. They neither add independent model draws nor quantify uncertainty
in the estimated generative distribution. With 20 curves, tail characterization
is limited. A constant pool legitimately has zero-width intervals; a nonconstant
pool does not collapse merely because its size equals the observed cohort size.

There is no time binning. Irregular synthetic observations are not grouped by
their within-person index. A time with only one observed individual has coincident
empirical percentiles and provides no empirical cross-individual spread.
Lines and shaded polygons connect actual support points for display only.

Responses identify `method=mesh_bootstrap`, `methodVersion=mesh-bootstrap-v1`,
the sampling rule and matched design. The method version participates in cache
identity. Historical cached responses remain readable; their previous statistical
method must not be relabelled as the corrected method.

## Formal evaluation

`pff-pk evaluate-vpc` remains the Pharmpy 2.1.x evaluation path, with its existing
binning and design-matched replicate contract. It is not replaced by the
interactive approximation, and archived evaluation results are not rewritten.
Compare methods only after matching sample pools, observational designs,
percentile conventions and interval definitions.

## Ownership

Python resampling is implemented only in `pff_pk.metrics.mesh_vpc`; the dashboard
imports it. Browser-side observed order statistics are inexpensive descriptive
calculations with explicit contract tests. PK box-plot quantiles retain their
existing interpolated convention and are not VPC statistics.

## Individual trajectory display

The inference pool is evaluated on the union of context times so every observed
schedule is available for VPC resampling. Individual trajectory plots and their
descriptive PK quantities project each generated curve onto one context patient’s
schedule, cycling through patients in display order. They select existing model
values (allowing float32 time roundoff), without interpolation. Thus an irregular
8-observation design does not become a union-sized observation series for every
generated patient. The full pool and VPC statistics remain unchanged.

## Automatic irregular-schedule VPC

Identical per-patient schedules retain mesh-bootstrap-v1. Irregular and
pseudo-scheduled observations use pharmpy-binned-bootstrap-v1: Pharmpy’s existing
equal-number, tie-preserving VPC implementation computes observed 5/50/95%
quantiles and 90% confidence intervals from 200 design-matched simulated cohorts.
Each replicate samples whole curves with replacement, then selects each patient's
original observation rows. Observed and simulated values use identical bins.
The bin budget is min(8, floor(number of observations / 10)), at least one;
Pharmpy's nonempty-bin check can reduce it further. This is a display default,
not a claim that ten observations adequately estimate tail quantiles.
Intervals remain conditional on the finite generated pool.

The observed-only preview uses the same Pharmpy binning and observed statistics.
Inference cache identity includes auto-pharmpy-bootstrap-v1 so historical
unbinned irregular results are not reused. Binned interval bands connect bin-center statistics with straight segments for display.
