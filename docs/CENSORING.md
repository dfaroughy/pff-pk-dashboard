# Assay-limit visualization

The empirical dashboard displays a dashed amber LLOQ (lower limit of
quantification) on Individuals and VPC plots, in the displayed concentration
units. This is a visualization layer: it does not modify empirical inference
inputs, neural architectures, checkpoints, or the synthetic corpus.

Published Lenuzza limits are attached only to recognized Lenuzza cohorts in
ng/mL. Sources are Videau (2010), Table 4, and Lenuzza (2016), section 2.4.
The latter overrides digoxin's older limit with 0.05 ng/mL and supplies
repaglinide and hydroxy-repaglinide limits. The mapping lives in
`apps/empirical/app/lib/censoring.ts` and mirrors the verified empirical assay
metadata in pff_pk. Other datasets receive no guessed assay limit.

Raw empirical concentrations are unchanged. Values above the limit are marked
quantified; values at or below it have unresolved status (hollow amber circles).
An omitted visit is not reconstructed as a censored observation. Verified
censored observations, when available, use a downward triangle. Published
LLOQ/2 substitutions cannot safely be inferred from coordinates alone.

## Synthetic demonstration

Controls and explanations are in the collapsible Data censoring section below
Dose and observation protocol. The initial example is uncensored. New model
draws sample a Boolean with probability 0.5 and a rounded log-uniform Cmax/LLOQ
ratio between 10 and 100, reproducibly from the cohort seed. These are
illustrative display priors, not changes to the training corpus. Both values
are manually editable. Enabling censoring sets a threshold from the current
cohort maximum divided by the ratio.
Below-limit concentrations are reported at LLOQ with CENS=1; other observations
have CENS=0. Clean trajectories and observation times are retained, with an
optional latent-curve overlay. Equality to LLOQ is not censored in this simulator.

The threshold stays fixed across edited-cohort regeneration and dose edits until the user
changes sensitivity or disables/re-enables censoring. Consequently changing
the dose does not rescale the assay limit. This transformation is local to the
dashboard and does not require regenerating the training corpus.

## Current limitations

Both Pythia and Pythia-Dose lack censoring-aware dose prediction. Inference is
available on empirical and censored synthetic cohorts. The model panel omits the
repeated warning; these limitations remain documented here. Reported concentrations (including values clipped to LLOQ)
are passed unchanged to the legacy models as numerical observations, not as
inequality constraints. Predictions are not assay-corrected; dose changes may
incorrectly scale the floor. This is exploratory use, not censoring-aware inference.

VPCs summarize reported values; they do not yet implement censoring-aware
quantile identification or a fraction-censored VPC. PK summaries of floored
synthetic curves likewise describe reported values, not latent pharmacokinetics.
Those limitations are also stated beside the controls. Explicit censor-aware
model conditioning and statistical VPC handling remain separate work.
