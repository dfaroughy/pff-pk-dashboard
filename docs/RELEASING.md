# Release procedure

## Local gate

Run `npm run check` and `npm run test:services` from the dashboard repository.
Run both scientific repositories' full tests, lint and installed-wheel smoke
checks when their interfaces change. No GPU, remote allocation or Comet run is
needed for these gates.

The Pages workflow runs on pull requests and main. Deployment waits for both
frontend and service jobs. The service job additionally installs the locked
Linux/Python-3.12 CPU Space dependencies and tests an assembled standalone bundle.
Fork pull requests never receive private scientific source or credentials; the
service gate runs on trusted branches and again on main before deployment.

Dashboard integration CI now checks the immutable deployed Space revision in
`services/huggingface_space/release.json`, verifying its source manifest hashes.
This decouples webpage releases from uncommitted or unrelated scientific-repo
work. Update the pin after publishing a tested service bundle. The Linux CPU
runtime gate remains mandatory; it rebuilds the dashboard adapter against those
exact scientific sources. Private-repository deploy keys are no longer needed
by the dashboard workflow.

Publish a compatible service bundle before the webpage that consumes it, then
verify the hosted `/health`, `/synthetic`, and `/inference` endpoints. Model CI
in the separate scientific repository remains independent of this deployment.

## Space bundle

```bash
python services/huggingface_space/build_bundle.py \
  --pff-repo ../pff_pk --synthetic-repo ../synthetic_priors \
  --output /absolute/external/release-directory
```

Choose a new output directory, outside the source repositories. Rebuilding an
untouched, manifest-identified bundle is supported. Arbitrary directories,
symlinks, edited bundles and extra user files are rejected. Assembly is staged;
a failure before replacement preserves the previous bundle. Do not put a Space
Git checkout inside the bundle output directory; upload the bundle into it.

`bundle-manifest.json` records source commits, dirty status and SHA-256 hashes
of every bundled file, including dependency specifications. Private weights or
environment files are rejected. It contains source provenance, not model tokens.
Model release revisions remain managed through the existing immutable HF
release manifests and Space secrets.

The CPU runtime uses Python 3.12 and a transitive requirements lock. To refresh:

```bash
uv pip compile services/huggingface_space/requirements.in \
  --python-version 3.12 --python-platform x86_64-unknown-linux-gnu \
  --index-strategy unsafe-best-match --emit-index-url \
  --output-file services/huggingface_space/requirements.txt
```

Review and test lock changes before uploading. The torch wheel is CPU-only.
Frontend publishing and Space uploading remain separate explicit actions.
The cleanup itself does not publish either one.
