import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(repositoryRoot, "dist");

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(resolve(repositoryRoot, "landing"), destination, { recursive: true });
await mkdir(resolve(destination, "fonts"), { recursive: true });
await cp(resolve(repositoryRoot, "apps/empirical/node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2"), resolve(destination, "fonts/space-grotesk.woff2"));
await cp(resolve(repositoryRoot, "apps/empirical/node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2"), resolve(destination, "fonts/ibm-plex-mono.woff2"));
await cp(resolve(repositoryRoot, "apps/empirical/portable-dist"), resolve(destination, "empirical"), {
  recursive: true,
});
await cp(resolve(repositoryRoot, "apps/empirical/portable-dist"), resolve(destination, "synthetic"), { recursive: true });
await writeFile(resolve(destination, ".nojekyll"), "");

console.log(`GitHub Pages bundle assembled at ${destination}`);
