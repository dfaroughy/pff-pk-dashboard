import json
import unittest

import numpy as np
from services.inference.pff_service import build_cohort
from services.inference.censored_vpc import dashboard_vpc_summary, observed_vpc_summary


def study(fraction=.6, irregular=False):
    return {"id": "censored", "route": "oral", "dose": 1, "assay": {"lloq": 1},
            "subjects": [{"id": str(i), "points": [[.1 + (.01 * i if irregular else 0), 1 if i < 20 * fraction else 2 + i],
                                                     [1, 1 if i < 20 * fraction else 3 + i]],
                          "cens": [int(i < 20 * fraction)] * 2} for i in range(20)]}


class CensoredVpcTests(unittest.TestCase):
    def summary(self, data, bins=None, pool=None):
        cohort = build_cohort(data)
        times = np.unique([t for c in cohort["subjects"].values() for t, _ in c])
        if pool is None:
            pool = np.tile([[.1], [2.], [3.], [4.]], (1, len(times)))
        return dashboard_vpc_summary(pool, times, cohort, study=data, replicates=40, num_bins=bins)

    def test_rank_identifiability_exact_and_pharmpy_bins(self):
        for fraction, expected in ((.2, [False, True, True]), (.6, [False, False, True]), (1, [False] * 3)):
            for bins in (None, 2):
                result = self.summary(study(fraction), bins)
                for point in result["points"]:
                    self.assertEqual([point["observed"][k] is not None for k in ("q05", "q50", "q95")], expected)
                    self.assertAlmostEqual(point["blq"]["observed"]["lower"], fraction)
                json.dumps(result, allow_nan=False)

    def test_censored_placeholders_do_not_change_identified_quantiles(self):
        data = study(.2)
        first = self.summary(data)
        for s in data["subjects"][:4]:
            s["points"] = [[t, .0001] for t, _ in s["points"]]
        second = self.summary(data)
        self.assertEqual([p["observed"] for p in first["points"]], [p["observed"] for p in second["points"]])

    def test_unresolved_flags_are_fraction_bounds(self):
        data = study(.2)
        for s in data["subjects"][:4]:
            s["cens"] = [None, None]
        result = self.summary(data)
        self.assertEqual(result["points"][0]["blq"]["observed"],
                         {"lower": 0, "upper": .2, "nCensored": 0, "nUnresolved": 4})
        self.assertIsNone(result["points"][0]["observed"]["q05"])

    def test_all_generated_blq_and_zero_fraction_are_retained(self):
        for concentration, fraction in ((.1, 1.), (1., 0.), (2., 0.)):
            result = self.summary(study(), pool=np.full((4, 2), concentration))
            self.assertEqual(result["points"][0]["blq"]["simulated"],
                             {"center": fraction, "lower": fraction, "upper": fraction})
            if fraction == 1:
                self.assertIsNone(result["points"][0]["simulated"]["q95"]["upper"])

    def test_interval_crossing_limit_is_clipped_without_dropping_replicates(self):
        result = self.summary(study(), pool=np.array([[.1, .1], [2., 2.]]))
        median = result["points"][0]["simulated"]["q50"]
        self.assertEqual(median["lower"], 1.)
        self.assertTrue(median["lowerCensored"])
        self.assertEqual(median["upper"], 2.)

    def test_irregular_bins_match_observed_only_and_keep_every_record(self):
        data = study(.6, irregular=True)
        result = self.summary(data, 3)
        observed = observed_vpc_summary(build_cohort(data), study=data, num_bins=3)
        self.assertEqual(sum(p["nObservations"] for p in result["points"]), 40)
        self.assertEqual([p["blq"]["observed"] for p in result["points"]],
                         [p["blq"]["observed"] for p in observed["points"]])
        self.assertEqual([p["observed"] for p in result["points"]],
                         [{k: p[k] for k in ("q05", "q50", "q95")} for p in observed["points"]])

    def test_whole_curve_resampling_and_repeatability(self):
        result = self.summary(study())
        self.assertEqual(result, self.summary(study()))
        self.assertEqual(result["points"][0]["blq"]["simulated"], result["points"][1]["blq"]["simulated"])

    def test_uncensored_without_assay_preserves_original_vpc(self):
        data = study(0)
        del data["assay"]
        result = self.summary(data)
        self.assertNotIn("censoring", result)
        self.assertNotIn("blq", result["points"][0])

    def test_zero_blq_records_are_retained(self):
        data = study(.6)
        for s in data["subjects"][:12]:
            s["points"] = [[t, 0.] for t, _ in s["points"]]
        result = self.summary(data)
        self.assertEqual(result["points"][0]["nObservations"], 20)
        self.assertEqual(result["points"][0]["blq"]["observed"]["lower"], .6)

    def test_invalid_flag_alignment_rejected(self):
        data = study()
        data["subjects"][0]["cens"] = [1]
        with self.assertRaisesRegex(ValueError, "align"):
            self.summary(data)
