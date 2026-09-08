import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const requiredFiles = [
  "dist/index.html",
  "dist/style.css",
  "dist/theme.js",
  "dist/grain.svg",
  "dist/fonts/space-grotesk.woff2",
  "dist/fonts/ibm-plex-mono.woff2",
  "dist/.nojekyll",
  "dist/empirical/index.html",
  "dist/empirical/runtime-config.js",
  "dist/empirical/data/corpus.json",
  "dist/synthetic/index.html",
  "dist/synthetic/runtime-config.js",
  "dist/synthetic/data/corpus.json",
];

test("landing theme defaults to light and toggles even without storage", async () => {
  const script = await readFile("dist/theme.js", "utf8");
  for (const stored of [null, "dark", "unavailable"]) {
    const attributes = {};
    let click;
    const icon = {};
    const button = { hidden: true, querySelector: () => icon, setAttribute: (key, value) => { attributes[key] = value; }, addEventListener: (_, fn) => { click = fn; } };
    const root = { dataset: {} };
    runInNewContext(script, {
      document: { querySelector: () => button, documentElement: root },
      localStorage: { getItem() { if (stored === "unavailable") throw new Error(); return stored; }, setItem() { if (stored === "unavailable") throw new Error(); } },
    });
    assert.equal(root.dataset.theme, stored === "dark" ? "dark" : "light");
    assert.equal(button.hidden, false);
    assert.equal(icon.textContent, stored === "dark" ? "☾" : "☀");
    click();
    assert.equal(root.dataset.theme, stored === "dark" ? "light" : "dark");
    assert.equal(attributes["aria-pressed"], String(stored !== "dark"));
  }
});

test("Pages bundle contains independent empirical and synthetic entry points", async () => {
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

test("synthetic URL serves the application without a redirect", async () => {
  const html = await readFile("dist/synthetic/index.html", "utf8");
  assert.match(html, /id="root"/);
  assert.doesNotMatch(html, /http-equiv="refresh"/);
});

test("landing page links to the integrated empirical, synthetic, and upload workflows", async () => {
  const html = await readFile("dist/index.html", "utf8");
  assert.match(html, /href="\.\/empirical\/"/);
  assert.match(html, /href="\.\/synthetic\/"/);
  assert.match(html, /href="\.\/empirical\/\?mode=upload"/);
  assert.doesNotMatch(html, /Mesh-consistent conditional generation|Dimensionless PK dynamics|class="brand"/);
});
