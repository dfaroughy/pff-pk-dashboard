import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(repositoryRoot, "dist");

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(resolve(repositoryRoot, "landing"), destination, { recursive: true });
await cp(resolve(repositoryRoot, "apps/empirical/portable-dist"), resolve(destination, "empirical"), {
  recursive: true,
});
await mkdir(resolve(destination, "synthetic"), { recursive: true });
await writeFile(resolve(destination, "synthetic/index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Synthetic cohorts</title>
<meta http-equiv="refresh" content="0;url=../empirical/?mode=synthetic"></head>
<body><a href="../empirical/?mode=synthetic">Open synthetic cohorts</a></body></html>`);
await writeFile(resolve(destination, ".nojekyll"), "");

console.log(`GitHub Pages bundle assembled at ${destination}`);
