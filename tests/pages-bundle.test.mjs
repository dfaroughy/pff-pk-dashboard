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

test("combined Pages bundle contains both dashboards", async () => {
  for (const path of requiredFiles) {
    assert.ok((await stat(path)).isFile(), `${path} is missing`);
  }
});

test("portable entry points use subpath-safe asset references", async () => {
  for (const app of ["empirical", "synthetic"]) {
    const html = await readFile(`dist/${app}/index.html`, "utf8");
    assert.doesNotMatch(html, /(?:src|href)="\/(?!\/)/);
    assert.match(html, /(?:src|href)="\.\/assets\//);
  }
});

test("landing page links to the two applications", async () => {
  const html = await readFile("dist/index.html", "utf8");
  assert.match(html, /href="\.\/empirical\/"/);
  assert.match(html, /href="\.\/synthetic\/"/);
});
