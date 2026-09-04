# Interactive v6 synthetic-prior dashboard

This application lives in `pff-pk-dashboard/apps/synthetic`, separately from
the model and synthetic-prior repositories.

This browser dashboard walks through one draw from the v6 PK synthetic prior:

1. sample a role-constrained compartment graph;
2. sample dimensionless kinetic parameters and flux families;
3. sample the reference dose protocol;
4. draw 35 exchangeable individuals;
5. solve the five-arm protocol family; and
6. derive exact, pseudo-scheduled, or unscheduled observation meshes.

The displayed priors mirror `configs/default.yaml` and
`configs/v6_protocol_families.yaml`. The browser uses a compact Heun solver for
responsive visualization. Production corpus construction remains authoritative
for numerical integration and acceptance checks.

## Local use

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

## Portable static build

The dashboard has no server or hosting dependency. Its portable build reuses
the same React components, styles, locally bundled Space Grotesk and IBM Plex
Mono fonts, and in-browser simulator as the hosted version.

```bash
npm install
npm run build:portable
```

Upload the contents of `portable-dist/` to any static host (GitHub Pages,
Netlify, S3, an institutional web server, or a local HTTP server). All asset
URLs are relative, so deployment under a URL subdirectory is supported. To
inspect the production build locally:

```bash
npm run preview:portable
```

Validation:

```bash
npm run check
```
