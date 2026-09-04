# PFF inference service

This directory is the deployment boundary between the static dashboards and
`pff_pk`. The service accepts physical observations and optional dose events, delegates
normalization and flow integration to the pinned model package, and returns
physical concentration samples with model and solver provenance.

Two separately configured runtimes share this API. `pythia` is the
`digital_square_8491` generation model; it accepts only the empirical reference
protocol and never receives dose events as model inputs. `pythia_dose` is the
v6 dose-event model and supports dose counterfactuals and interventions. Both
models generate on the union of empirical observation times. The model
identifier is part of each content-addressed cache key and response.

For local development, run `npm run dev:empirical` from the repository root.
The application wrapper starts this service with the sibling `pff_pk`
environment. The future Hugging Face Space must import this implementation
rather than maintain a second copy.

Public deployment requirements:

- download both checkpoint/configuration pairs from one immutable Hugging Face
  model revision;
- expose health and inference operations through a Gradio adapter;
- restrict inputs, draws and integration steps;
- serialize accelerator access and cache content-addressed responses; and
- return checkpoint, configuration and solver fingerprints with every result.
