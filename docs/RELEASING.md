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
Cross-repository access uses read-only deploy keys:
`PFF_PK_READ_KEY` and `SYNTHETIC_PRIORS_READ_KEY`. These were configured for the
dashboard, and the prior key for model CI. No write-capable personal token is used.

Integration CI checks the current scientific main branches and logs their SHAs.
Model CI additionally checks the frozen reference prior commit. Publish
compatible scientific changes **before** the dashboard change that consumes
them. The first release of this cleanup requires the new
`pff_pk.metrics.mesh_vpc` API; deploying only the dashboard must fail its gate.

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
