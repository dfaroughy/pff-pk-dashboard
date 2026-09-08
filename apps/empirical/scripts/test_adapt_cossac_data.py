"""Run with python3 -m unittest discover -s apps/empirical/scripts -p 'test_adapt*.py'."""
import json
import tempfile
import unittest
from pathlib import Path

from adapt_cossac_data import adapt, numeric
from build_dashboard_data import add_cossac_studies

ROOT = Path(__file__).resolve().parents[4] / "corpora/empirical"


class AdapterTests(unittest.TestCase):
    def test_catalogue_replaces_only_overlapping_sources(self):
        old = [
            {"id": "old-theoph", "drug": "theophylline", "source": "datasets::Theoph"},
            {"id": "old-remi", "drug": "remifentanil", "source": "nlme::Remifentanil"},
            {"id": "other-theoph", "drug": "theophylline", "source": "another study"},
        ]
        result = add_cossac_studies(old)
        self.assertEqual(len(result), 5)
        self.assertEqual(result[0]["id"], "other-theoph")
        self.assertEqual(add_cossac_studies(result), result)

    def test_counts_and_contract(self):
        for drug, subjects, points, doses in [
            ("warfarin", 32, 247, 32), ("tobramycin", 97, 322, 1731),
            ("theophylline", 12, 120, 12), ("remifentanil", 65, 1992, 65),
        ]:
            with self.subTest(drug=drug):
                study, provenance, _ = adapt(ROOT, drug)
                self.assertEqual((provenance["subjects"], provenance["pkObservations"], provenance["doseEvents"]), (subjects, points, doses))
                self.assertEqual(study["timeUnit"], "h")
                self.assertEqual(study["concentrationUnit"], "ng/mL")
                self.assertIsNone(study["dose"])
                self.assertNotIn("doseEvents", study)
                self.assertNotIn("assay", study)
                self.assertEqual(len({s["id"] for s in study["subjects"]}), subjects)
                for subject in study["subjects"]:
                    self.assertTrue(subject["covariates"])
                    self.assertTrue(subject["doseEvents"])
                    self.assertEqual(subject["points"], sorted(subject["points"], key=lambda p: p[0]))
                json.dumps(study, allow_nan=False)

    def test_warfarin_pk_pd_separation_and_zeros(self):
        study, _, pd = adapt(ROOT, "warfarin")
        self.assertEqual(len(pd), 232)
        self.assertEqual(sum(v == 0 for s in study["subjects"] for _, v in s["points"]), 4)
        self.assertEqual(study["subjects"][0]["doseEvents"][0]["amount"], 100)
        self.assertTrue(all("cens" not in s for s in study["subjects"]))

    def test_theophylline_weight_normalized_dose(self):
        study, _, _ = adapt(ROOT, "theophylline")
        subject = study["subjects"][0]
        self.assertAlmostEqual(subject["doseEvents"][0]["amount"], 319.992)
        self.assertEqual(subject["points"][0], [0.25, 2840])

    def test_remifentanil_infusion_conversion(self):
        study, _, _ = adapt(ROOT, "remifentanil")
        subject = study["subjects"][0]
        self.assertEqual(subject["doseEvents"][0]["amount"], 1439.8)
        self.assertAlmostEqual(subject["doseEvents"][0]["duration"], 1/3)
        self.assertEqual(subject["points"][0], [0.025, 9.51])

    def test_tobramycin_sparse_patients_and_dose_placeholders(self):
        study, _, _ = adapt(ROOT, "tobramycin")
        self.assertEqual(min(len(s["points"]) for s in study["subjects"]), 1)
        self.assertTrue(all(v > 0 for s in study["subjects"] for _, v in s["points"]))
        self.assertEqual([e["amount"] for e in study["subjects"][0]["doseEvents"][:2]], [100, 80])

    def test_reject_nonfinite(self):
        for value in ["nan", "inf", "-inf"]:
            with self.assertRaises(ValueError):
                numeric(value)
        self.assertIsNone(numeric("."))
        self.assertEqual(numeric("0"), 0)

    def test_reject_missing_infusion_rate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "PK_data_remi.csv").write_text(
                "ID,TIME,AMT,RATE,DV,AGE,SEX,HT,WT,BSA,LBM\n"
                "1,0,100,.,.,30,1,170,70,1.8,55\n"
            )
            with self.assertRaisesRegex(ValueError, "positive RATE"):
                adapt(root, "remifentanil")


if __name__ == "__main__":
    unittest.main()
