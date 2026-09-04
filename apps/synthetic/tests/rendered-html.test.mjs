import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("portable build contains the v6 constructor", async () => {
  const html = await readFile(new URL("../portable-dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>Build a dimensionless PK study<\/title>/i);
  assert.ok((await stat(new URL("../portable-dist/og.png", import.meta.url))).isFile());

  const source = await readFile(new URL("../app/SyntheticDashboard.tsx", import.meta.url), "utf8");
  assert.match(source, /Compartment topology/i);
  assert.match(source, /Observation mesh/i);
  assert.match(source, /Draw G/i);
});
