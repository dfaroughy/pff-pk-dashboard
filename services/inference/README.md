# PFF inference service

This directory is the deployment boundary between the static dashboards and
`pff_pk`. The service accepts physical observations and dose events, delegates
normalization and flow integration to the pinned model package, and returns
physical concentration samples with model and solver provenance.

For local development, run `npm run dev:empirical` from the repository root.
The application wrapper starts this service with the sibling `pff_pk`
environment. The future Hugging Face Space must import this implementation
rather than maintain a second copy.

Public deployment requirements:

- download a checkpoint and configuration from one immutable Hugging Face
  model revision;
- expose health and inference operations through a Gradio ZeroGPU adapter;
- restrict inputs, draws and integration steps;
- serialize accelerator access and cache content-addressed responses; and
- return checkpoint, configuration and solver fingerprints with every result.
