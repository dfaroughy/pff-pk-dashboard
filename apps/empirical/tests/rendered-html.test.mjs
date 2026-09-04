import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("portable build contains the PK explorer entry point", async () => {
  const html = await readFile(new URL("../portable-dist/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>Pythia-PK — prior-fitted flows for pharmacokinetics<\/title>/i);
  assert.match(html, /runtime-config\.js/i);
  assert.ok((await stat(new URL("../portable-dist/data/corpus.json", import.meta.url))).isFile());
});

test("built catalogue contains the curated Lenuzza and empirical studies", async () => {
  const corpus = JSON.parse(await readFile(new URL("../public/data/corpus.json", import.meta.url), "utf8"));
  assert.equal(corpus.schemaVersion, 1);
  assert.equal(corpus.studies.length, 43);
  const caffeine = corpus.studies.find((study) => study.id === "lenuzza-caffeine");
  assert.equal(caffeine.concentrationUnit, "ng/mL");
  assert.equal(caffeine.doseUnit, "mg");
  assert.ok(caffeine.subjects.length >= 8);
  assert.ok(corpus.studies.every((study) => study.subjects.length >= 2));
  assert.ok(corpus.studies.every((study) => study.origin === "Lenuzza 2016" || study.origin === "Empirical individuals"));

  const drugs = corpus.studies.map((study) => study.drug);
  assert.equal(drugs[0], "caffeine");
  assert.deepEqual(drugs.slice(-3), ["1-hydroxy-midazolam", "4-hydroxy-tolbutamide", "5-hydroxy-omeprazole"]);
  assert.equal(drugs.filter((drug) => drug === "caffeine").length, 1);
  assert.ok(!drugs.includes("warfarin"));
  assert.ok(!drugs.includes("quinidine"));
  assert.ok(drugs.includes("quinidine gluconate"));
  assert.ok(drugs.includes("quinidine sulfate dihydrate"));

  const empagliflozin = corpus.studies.filter((study) => study.drug === "empagliflozin");
  assert.equal(empagliflozin.length, 1);
  assert.match(empagliflozin[0].study, /ElDash2021/);
  assert.equal(corpus.studies.filter((study) => study.drug === "dapagliflozin").length, 1);
  assert.equal(corpus.studies.filter((study) => study.drug === "captopril").length, 1);
  assert.match(corpus.studies.find((study) => study.drug === "captopril").study, /Cohen1982/);

  const tetracycline = corpus.studies.find((study) => study.id === "empirical-combined-tetracycline");
  assert.equal(tetracycline.subjects.length, 20);
  const methylCaptopril = corpus.studies.find((study) => study.id === "empirical-combined-s-methyl-captopril");
  assert.equal(methylCaptopril.subjects.length, 9);
});
