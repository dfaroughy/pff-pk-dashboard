import unittest

import torch

from services.inference.covariate_batch import covariate_cohort_batch, mask_lloq_input, target_covariate_rows
from services.inference.pff_service import build_cohort, requested_model


class CovariateBatchTests(unittest.TestCase):
    def test_lloq_mask_preserves_every_other_batch_field(self):
        study = self.study()
        study["assay"] = {"lloq": 1.0}
        for subject in study["subjects"]:
            subject["cens"] = [0, 0, 1]
        batch, _, _ = self.batch(study)
        hidden = mask_lloq_input(batch, False)
        self.assertTrue(batch.assay_known.all())
        self.assertFalse(hidden.assay_known.any())
        self.assertFalse(hidden.assay_limit.any())
        for key, value in vars(batch).items():
            if key not in {"assay_known", "assay_limit"}:
                self.assertIs(getattr(hidden, key), value, key)
        self.assertIs(mask_lloq_input(batch), batch)
        with self.assertRaisesRegex(ValueError, "provideLloq"):
            mask_lloq_input(batch, "false")

    def study(self):
        return {"id": "test", "route": "oral", "dose": 10,
                "subjects": [
                    {"id": "a", "points": [[1, 4], [2, 2], [3, 1]],
                     "covariates": {"weight_kg": 60, "sex": "Female", "cov_cont_0": 3, "cov_cat_0": "A"}},
                    {"id": "b", "points": [[1, 6], [2, 3], [3, 1]],
                     "covariates": {"weight_kg": 90, "sex": "Male", "cov_cont_0": 7, "cov_cat_0": "B"}}]}

    def batch(self, study):
        return covariate_cohort_batch(study, build_cohort(study),
            normalization="measure_consistent_standardized_log", target_dose_events=None)

    def test_covariates_and_missing_targets(self):
        batch, _, omitted = self.batch(self.study())
        self.assertEqual(omitted, 0)
        self.assertTrue(batch.context_covariate_mask.any())
        self.assertFalse(batch.target_covariate_mask.any())
        self.assertFalse(batch.assay_known.any())
        self.assertFalse(batch.context_cens.any())
        self.assertEqual(requested_model({"modelId": "pythia_covariates"}), "pythia_covariates")

    def test_no_covariates_no_floor(self):
        study = self.study()
        for subject in study["subjects"]:
            subject.pop("covariates")
        batch, _, _ = self.batch(study)
        self.assertFalse(batch.context_covariate_mask.any())
        self.assertTrue(torch.isfinite(batch.context_value).all())

    def test_distinct_target_rows_and_context_only_generic_reference(self):
        batch, _, _ = self.batch(self.study())
        rows, values, masks = target_covariate_rows([
            {"sex": "female", "weight_kg": 60, "cov_cont_0": 3, "cov_cat_0": "A"},
            {"sex": "male", "weight_kg": 90, "cov_cont_0": 7, "cov_cat_0": "B"},
            {},
        ], 3, batch)
        self.assertEqual(values[:, 3].tolist(), [-1, 1, 0])
        self.assertEqual(values[:, -2].tolist(), [-1, 1, 0])
        self.assertEqual(values[:, -1].tolist(), [0, 1, 0])
        self.assertFalse(masks[2].any())
        self.assertEqual(rows[0]["weight_kg"], 60)
        _, single, single_mask = target_covariate_rows([rows[1]], 1, batch)
        torch.testing.assert_close(values[1], single[0])
        torch.testing.assert_close(masks[1], single_mask[0])

    def test_target_validation(self):
        batch, _, _ = self.batch(self.study())
        for raw in ([{}], [{"weight_kg": -1}, {}], [{"age_years": 20}, {}],
                    [{"sex": "other"}, {}], [{"cov_cat_0": "missing-level"}, {}]):
            with self.assertRaises(ValueError):
                target_covariate_rows(raw, 2, batch)

    def test_floor_and_explicit_censoring(self):
        study = self.study()
        study["assay"] = {"lloq": 1.0}
        for subject in study["subjects"]:
            subject["cens"] = [0, 0, 1]
            subject["points"][-1][1] = 0
        batch, _, omitted = self.batch(study)
        self.assertEqual(omitted, 0)
        self.assertEqual(int(batch.context_cens.sum()), 2)
        self.assertTrue(batch.assay_known.all())
        expected = (torch.log(1 / batch.concentration_scale) - batch.log_center) / batch.log_scale
        torch.testing.assert_close(batch.assay_limit, expected)
        torch.testing.assert_close(batch.context_value[0, :, -1, 0], expected.expand(2))

    def test_unresolved_not_mislabeled_and_query_mesh_preserved(self):
        study = self.study()
        study["assay"] = {"lloq": 1.0}
        batch, _, omitted = self.batch(study)
        self.assertEqual(omitted, 2)
        self.assertFalse(batch.context_cens.any())
        self.assertEqual(batch.target_time.shape[1], 3)
        self.assertEqual(int(batch.context_mask.sum()), 4)

    def test_bad_censor_alignment(self):
        study = self.study()
        study["subjects"][0]["cens"] = [1]
        with self.assertRaisesRegex(ValueError, "align"):
            self.batch(study)

    def test_flags_without_disclosed_floor(self):
        study = self.study()
        for subject in study["subjects"]:
            subject["cens"] = [0, 0, 1]
        batch, _, _ = self.batch(study)
        self.assertFalse(batch.assay_known.any())
        self.assertEqual(int(batch.context_cens.sum()), 2)

    def test_sort_keeps_labels_aligned(self):
        study = self.study()
        study["assay"] = {"lloq": 1.0}
        for subject in study["subjects"]:
            subject["points"] = list(reversed(subject["points"]))
            subject["cens"] = [1, 0, 0]
        batch, _, _ = self.batch(study)
        self.assertTrue(batch.context_cens[0, :, -1].all())
        self.assertFalse(batch.context_cens[0, :, :2].any())


if __name__ == "__main__":
    unittest.main()
