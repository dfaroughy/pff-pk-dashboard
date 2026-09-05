# PFF pharmacokinetic study explorer

This application lives in `pff-pk-dashboard/apps/empirical`. The model service
is shared at `services/inference/`; the scientific model remains in the
separate `pff_pk` repository.

Interactive browser for the canonical empirical and Lenuzza 2016 cohorts in
`PFFF/corpora/empirical`. The empirical selection exactly follows the production
PFF evaluation rules: oral/IV cohorts with at least two individuals and at least
three observations per included individual. The dashboard shows observed
concentration profiles, empirical time-wise quantiles, and descriptive
noncompartmental PK quantities.

## Run locally

```bash
npm install
npm run data:build
npm run dev:full
```

`dev:full` starts both the web dashboard and the local CPU inference service.
The selector exposes two independent runtimes: `Pythia` is the
`digital_square_8491` generation-only model, while `Pythia-Dose` is the
`lucid_marten_2741` v6 dose-aware model. The latter remains the default. Override
their local paths without changing code:

```bash
PFF_PYTHIA_CHECKPOINT=/path/to/pythia.ckpt \
PFF_PYTHIA_CONFIG=/path/to/pythia.yaml \
PFF_DOSE_CHECKPOINT=/path/to/pythia-dose.ckpt \
PFF_DOSE_CONFIG=/path/to/pythia-dose.yaml \
npm run dev:full
```

The legacy `PFF_CHECKPOINT` and `PFF_CONFIG` variables remain aliases for the
Pythia-Dose runtime.

## Portable frontend

The same dashboard can be built as an ordinary static React application. It
has no dependency on ChatGPT, Sites, Next.js or a specific hosting provider;
the visual design and locally bundled Space Grotesk and IBM Plex Mono fonts are
identical to the hosted dashboard.

```bash
npm install
npm run build:portable
```

Deploy the contents of `portable-dist/` to any static host. Relative assets
allow deployment at a domain root or below a URL prefix. The generated
`runtime-config.js` selects the corpus asset and Python inference endpoint and
can be edited after the build without recompiling:

```js
window.PFF_DASHBOARD_CONFIG = {
  apiRoot: "http://127.0.0.1:8791",
  corpusPath: "data/corpus.json",
};
```

The GitHub Pages build selects the public Gradio service automatically. Visitors
therefore need only a browser: the private checkpoint is loaded server-side and
is neither bundled with the site nor returned by the API. Local builds retain
the loopback service shown above.

For local development with the PyTorch service:

```bash
npm run dev:portable:full
```

When a remotely hosted frontend calls the local inference service, add its
origin to `PFF_ALLOWED_ORIGINS`, for example
`PFF_ALLOWED_ORIGINS=https://pk.example.org npm run inference`.

The data build converts Lenuzza concentrations from g/L to ng/mL and doses from
g to mg, matching the validated adapter in `pff_pk.inference.empirical`.

## Custom datasets

The browser imports conventional NONMEM/nlmixr2 event tables and Monolix-style
long tables from comma-, tab-, semicolon-, or whitespace-delimited files. The
minimum columns are subject (`ID`), time (`TIME`), and concentration (`DV` or
`Y`). Recognized event fields include `AMT`/`AMOUNT`, `EVID`, `MDV`, `RATE`,
`DUR`/`TINF`, `ADDL`, `II`, `SS`, and `CENS`. Optional metadata fields include
`ROUTE`, `DRUG`, `TIME_UNIT`, `DV_UNIT`, `DOSE_UNIT`, and `MATRIX`. If route is
stored only in the NONMEM control stream or Monolix project, the user assigns
oral or intravenous administration in the import dialog; the data file itself
does not need to be edited. All individuals in one import must share one route,
PK analyte, and dose regimen. Reset/steady-state events and multi-outcome
`DVID`/`YTYPE` tables are rejected rather than interpreted silently. A working
template is available at `public/data/pk-upload-template.csv`.

Imported observations are held only in browser memory. The plots are computed
client-side. Selecting a Pythia model sends the parsed study values—not the
source file—to the inference API under the same validated limits as built-in
studies.

## Scientific interpretation

- An **observed VPC** is only shown when individual records are available. Its
  curves are the empirical 5th, 50th and 95th percentiles among subjects
  observed at each exact sampling time.
- After model inference, the VPC is computed server-side with Pharmpy. The same
  finite pool shown in the trajectory panel (20 individuals by default) is
  resampled into 200 inexpensive cohorts matched to the empirical individual
  observation schedules. Pharmpy applies equal-number time binning and computes
  the observed quantiles and simulated 90% intervals.
- Summary-only records show the published mean and mean ± SD. They are clearly
  labelled and are not presented as an individual-level VPC.
- Cmax, Tmax and AUClast are computed from the displayed median (individual
  data) or mean (summary data) profile. The terminal slope and half-life are
  descriptive log-linear estimates; they are not parameters from an NLME fit.

## Verification

```bash
npm run build
npm test
```

PFF inference runs in Python/PyTorch, either through the local process or the
public Hugging Face Gradio service. The browser sends physical observations and
dose events, receives physical concentration samples, and draws the result.
Generation evaluates samples at the union of empirical observation times.
Requests are cached using the request, checkpoint and configuration
fingerprints. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full contract.
