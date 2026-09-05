import { expect, test } from "vitest";
import { parsePkDataset } from "../app/lib/pk-upload";

const validDataset = `ID,TIME,DV,AMT,EVID,MDV,DRUG,ROUTE,TIME_UNIT,DV_UNIT,DOSE_UNIT,MATRIX
1,0,,100,1,1,caffeine,PO,h,ng/mL,mg,plasma
1,0.5,800,,0,0,caffeine,PO,h,ng/mL,mg,plasma
1,2,500,,0,0,caffeine,PO,h,ng/mL,mg,plasma
2,0,,100,1,1,caffeine,PO,h,ng/mL,mg,plasma
2,0.5,900,,0,0,caffeine,PO,h,ng/mL,mg,plasma
2,2,450,,0,0,caffeine,PO,h,ng/mL,mg,plasma`;

test("parses a NONMEM-style long PK dataset", () => {
  const study = parsePkDataset(validDataset, "caffeine.csv");
  expect(study.drug).toBe("caffeine");
  expect(study.route).toBe("oral");
  expect(study.dose).toBe(100);
  expect(study.doseEvents).toEqual([{ time: 0, amount: 100, route: "oral", unit: "mg" }]);
  expect(study.subjects).toEqual([
    { id: "1", points: [[0.5, 800], [2, 500]] },
    { id: "2", points: [[0.5, 900], [2, 450]] },
  ]);
});

test("accepts common header aliases and tab delimiters", () => {
  const study = parsePkDataset(
    "SUBJECT\tNOMTIME\tCONCENTRATION\tADMINISTRATION ROUTE\nA\t0.25\t2\tIV\nA\t1\t1\tIV",
    "candidate.tsv",
  );
  expect(study.drug).toBe("candidate");
  expect(study.route).toBe("iv");
  expect(study.subjects[0].points).toEqual([[0.25, 2], [1, 1]]);
});

test("accepts a conventional whitespace-delimited Monolix table with an assigned route", () => {
  const study = parsePkDataset(
    `ID TIME Y AMOUNT EVID MDV ADM
1 0 . 100 1 1 1
1 0.5 8 . 0 0 1
1 2 4 . 0 0 1
2 0 . 100 1 1 1
2 0.5 9 . 0 0 1
2 2 3 . 0 0 1`,
    "monolix_data.txt",
    { route: "oral" },
  );
  expect(study.route).toBe("oral");
  expect(study.dose).toBe(100);
  expect(study.timeUnit).toBe("reported time units");
  expect(study.subjects).toHaveLength(2);
});

test("requests route metadata only when it cannot be inferred", () => {
  const dataset = "ID,TIME,DV\n1,0.5,2\n1,1,1";
  expect(() => parsePkDataset(dataset, "candidate.csv")).toThrow(/Administration route is not encoded/);
  expect(parsePkDataset(dataset, "candidate.csv", { route: "iv" }).route).toBe("iv");
});

test("expands standard ADDL/II repeat-dose records and derives infusion duration", () => {
  const dataset = `ID,TIME,DV,AMT,EVID,MDV,RATE,ADDL,II
1,0,,100,1,1,50,1,12
1,1,5,,0,0,,,
1,13,4,,0,0,,,
2,0,,100,1,1,50,1,12
2,1,6,,0,0,,,
2,13,3,,0,0,,,`;
  const study = parsePkDataset(dataset, "infusion.csv", { route: "iv" });
  expect(study.doseEvents).toEqual([
    { time: 0, amount: 100, route: "iv", unit: "reported dose units", duration: 2 },
    { time: 12, amount: 100, route: "iv", unit: "reported dose units", duration: 2 },
  ]);
});

test("rejects ambiguous routes and heterogeneous dose regimens", () => {
  expect(() => parsePkDataset(validDataset.replace("2,0,,100", "2,0,,200"), "mixed.csv"))
    .toThrow(/different dose regimens/);
  expect(() => parsePkDataset(validDataset.replace("2,2,450,,0,0,caffeine,PO", "2,2,450,,0,0,caffeine,IV"), "mixed.csv"))
    .toThrow(/one administration route/);
});

test("rejects missing columns, duplicate times, and nonpositive concentrations", () => {
  expect(() => parsePkDataset("ID,TIME,ROUTE\n1,0,oral", "bad.csv")).toThrow(/DV/);
  expect(() => parsePkDataset("ID,TIME,DV,ROUTE\n1,1,2,oral\n1,1,3,oral", "bad.csv")).toThrow(/duplicate/);
  expect(() => parsePkDataset("ID,TIME,DV,ROUTE\n1,1,0,oral", "bad.csv")).toThrow(/greater than zero/);
});
