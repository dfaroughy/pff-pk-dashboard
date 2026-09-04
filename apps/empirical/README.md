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
The active defaults are the `lucid_marten_2741` v6 checkpoint at sparse
generation phase-2 step 750 and its matching Amarel configuration. Override
them without changing code:

```bash
PFF_CHECKPOINT=/path/to/model.ckpt PFF_CONFIG=/path/to/config.yaml npm run dev:full
```

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

## Scientific interpretation

- An **observed VPC** is only shown when individual records are available. Its
  curves are the empirical 5th, 50th and 95th percentiles among subjects
  observed at each exact sampling time.
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
Requests are cached using the request, checkpoint and configuration
fingerprints. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full contract.
