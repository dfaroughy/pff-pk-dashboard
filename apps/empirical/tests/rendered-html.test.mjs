import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("portable build contains the PK explorer entry point", async () => {
  const html = await readFile(new URL("../portable-dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>Prior-fitted flows for PK\/PD<\/title>/i);
  assert.match(html, /runtime-config\.js/i);
  assert.ok((await stat(new URL("../portable-dist/data/corpus.json", import.meta.url))).isFile());
});

test("built catalogue contains Lenuzza and empirical studies", async () => {
  const corpus = JSON.parse(await readFile(new URL("../public/data/corpus.json", import.meta.url), "utf8"));
  assert.equal(corpus.schemaVersion, 1);
  assert.equal(corpus.studies.length, 80);
  const caffeine = corpus.studies.find((study) => study.id === "lenuzza-caffeine");
  assert.equal(caffeine.concentrationUnit, "ng/mL");
  assert.equal(caffeine.doseUnit, "mg");
  assert.ok(caffeine.subjects.length >= 8);
  assert.ok(corpus.studies.every((study) => study.subjects.length >= 2));
  assert.ok(corpus.studies.every((study) => study.origin === "Lenuzza 2016" || study.origin === "Empirical individuals"));
});
