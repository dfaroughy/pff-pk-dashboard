import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const requiredFiles = [
  "dist/index.html",
  "dist/style.css",
  "dist/.nojekyll",
  "dist/empirical/index.html",
  "dist/empirical/runtime-config.js",
  "dist/empirical/data/corpus.json",
  "dist/synthetic/index.html",
];

test("Pages bundle contains the integrated dashboard and legacy redirect", async () => {
  for (const path of requiredFiles) {
    assert.ok((await stat(path)).isFile(), `${path} is missing`);
  }
});

test("portable entry points use subpath-safe asset references", async () => {
  for (const app of ["empirical"]) {
    const html = await readFile(`dist/${app}/index.html`, "utf8");
    assert.doesNotMatch(html, /(?:src|href)="\/(?!\/)/);
    assert.match(html, /(?:src|href)="\.\/assets\//);
  }
});

test("legacy synthetic URL redirects to the integrated cohort builder", async () => {
  const html = await readFile("dist/synthetic/index.html", "utf8");
  assert.match(html, /url=\.\.\/empirical\/\?mode=synthetic/);
});

test("landing page links to the integrated empirical, synthetic, and upload workflows", async () => {
  const html = await readFile("dist/index.html", "utf8");
  assert.match(html, /href="\.\/empirical\/"/);
  assert.match(html, /href="\.\/empirical\/\?mode=synthetic"/);
  assert.match(html, /href="\.\/empirical\/\?mode=upload"/);
  assert.doesNotMatch(html, /href="\.\/synthetic\/"/);
});
