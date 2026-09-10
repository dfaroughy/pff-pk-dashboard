"""Parity with production; acquisition must not change the latent study."""

import json
import unittest

import numpy as np
from services.inference.synthetic_service import describe, generate, synthetic_request, _resampled_indices

from synthetic_priors import generate_profile_study, get_profile
from synthetic_priors.corpus.identity import digest
from synthetic_priors.simulation.views import observation_view


class CanonicalSyntheticTests(unittest.TestCase):
    def test_profiles_equal_production(self):
        for version in ("v1", "v6", "v7"):
            actual = generate({"version": version, "seed": 30, "individuals": 3})
            expected = generate_profile_study(version, 30, n_individuals=3, observation_points=128)
            self.assertEqual(actual["provenance"]["recordSha256"], digest(expected))
            self.assertEqual(actual["provenance"]["sha256"], get_profile(version).sha256)
            self.assertEqual(actual["topology"], expected["truth"]["topology"])
            json.dumps(actual, allow_nan=False)

    def test_schedules_select_values_never_interpolate(self):
        source = generate_profile_study("v7", 30, n_individuals=3, observation_points=128)
        for schedule in ("exact", "pseudo_scheduled", "unscheduled"):
            for shape in ("early", "late", "uniform", "clustered"):
                result = generate(
                    {
                        "version": "v7",
                        "seed": 30,
                        "individuals": 3,
                        "observations": 20,
                        "schedule": schedule,
                        "shape": shape,
                    }
                )
                self.assertEqual(result["provenance"]["recordSha256"], digest(source))
                for subject, person in zip(
                    result["study"]["subjects"], source["individuals"], strict=True
                ):
                    t, c, _ = observation_view(
                        source, person, "random" if schedule == "unscheduled" else "regular"
                    )
                    self.assertEqual(len(subject["points"]), 20)
                    self.assertTrue(np.all(np.diff([p[0] for p in subject["points"]]) > 0))
                    self.assertEqual(subject["points"][-1][0], 1)
                    self.assertTrue(
                        all(c[t.index(time)] == value for time, value in subject["points"])
                    )

    def test_edits_are_explicit_and_preserve_canonical_profile(self):
        before = get_profile("v7").sha256
        result = generate(
            {
                "version": "v7",
                "seed": 30,
                "individuals": 3,
                "overrides": {"physiology.weight_min": 80},
            }
        )
        self.assertTrue(result["provenance"]["modified"])
        self.assertNotEqual(result["provenance"]["sha256"], before)
        self.assertEqual(get_profile("v7").sha256, before)
        self.assertTrue(all("semantic_physiology" in v for v in result["individualTruth"].values()))

    def test_mlp_resampling_preserves_graph_patients_and_protocol(self):
        payload = {"version": "v7", "seed": 46, "individuals": 16}
        base = generate(payload)
        first = generate({**payload, "mlpSeed": 100})
        second = generate({**payload, "mlpSeed": 101})
        self.assertEqual(first, generate({**payload, "mlpSeed": 100}))
        self.assertNotEqual(first["covariateModel"]["network"], second["covariateModel"]["network"])
        self.assertTrue(first["provenance"]["modified"])
        for result in (first, second):
            self.assertEqual(base["topology"], result["topology"])
            self.assertEqual(base["population"], result["population"])
            self.assertEqual(base["study"]["doseEvents"], result["study"]["doseEvents"])
            for a, b in zip(base["study"]["subjects"], result["study"]["subjects"], strict=True):
                self.assertEqual(a["covariates"], b["covariates"])
                self.assertEqual([p[0] for p in a["points"]], [p[0] for p in b["points"]])
                self.assertEqual(base["individualTruth"][a["id"]]["hidden_covariates"],
                                 result["individualTruth"][b["id"]]["hidden_covariates"])
        self.assertNotEqual(first["study"]["subjects"][0]["points"], second["study"]["subjects"][0]["points"])

    def test_explicit_mlp_can_enable_a_map_for_small_cohort(self):
        payload = {"version": "v7", "seed": 46, "individuals": 2}
        base = generate(payload)
        result = generate({**payload, "mlpSeed": 100})
        self.assertIsNone(base["covariateModel"]["network"])
        self.assertIsNotNone(result["covariateModel"]["network"])
        self.assertEqual(base["topology"], result["topology"])

    def test_invalid_requests_rejected_before_solver(self):
        for payload in (
            {"version": "v8"},
            {"individuals": 101},
            {"mlpSeed": -1},
            {"mlpSeed": True},
            {"version": "v1", "mlpSeed": 1},
            {"observations": 21},
            {"seed": -1},
            {"seed": True},
            {"overrides": {"physiology.enabled": False}},
            {"overrides": {"dynamics.p_saturable_edge": 1}},
            {"version": "v7", "overrides": {"physiology.observed_probability": 1}},
            {"overrides": {"graph.n_transit_max": 50}},
            {"version": "v1", "overrides": {"study.num_peripherals_range": [3, 1]}},
            {"dose": 999},
            {"overrides": {"cohort.bsv_sigma_min": 0.8}},
        ):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                generate(payload)

    def test_description_matches_canonical(self):
        for version in ("v1", "v6", "v7"):
            info = describe(version)
            self.assertEqual(info["configuration"], get_profile(version).configuration())
            self.assertFalse(any("probability" in c["label"].lower() and not c["path"].startswith("graph.") for c in info["controls"]))
            self.assertEqual(
                any(c["path"].startswith("physiology.") for c in info["controls"]), version == "v7"
            )

    def test_subprocess_matches_direct(self):
        payload = {"version": "v1", "seed": 30, "individuals": 3}
        self.assertEqual(synthetic_request(payload), generate(payload))

    def test_inference_adapter_preserves_individual_and_shared_doses(self):
        from pff_pk.inference.empirical import empirical_cohort_batch
        from services.inference.pff_service import build_cohort, with_context_protocols

        for version in ("v1", "v6"):
            study = generate({"version": version, "seed": 30, "individuals": 3})["study"]
            cohort = build_cohort(study)
            batch, _, _ = empirical_cohort_batch(cohort)
            actual = with_context_protocols(batch, study, cohort)
            for i, person in enumerate(study["subjects"]):
                event = person["doseEvents"][0]
                self.assertAlmostEqual(
                    actual.context_protocol_events[0, i, 0, 1].item(),
                    event["amount"] / study["dose"],
                    places=5,
                )
                self.assertAlmostEqual(
                    actual.context_protocol_events[0, i, 0, 2].item(), event["duration"], places=5
                )
                self.assertTrue(actual.context_protocol_event_mask[0, i, 0])

    def test_dose_and_kinetic_edits_replay_production_and_preserve_patients(self):
        for version in ("v6", "v7"):
            plain = generate({"version": version, "seed": 30, "individuals": 3})
            edited = generate(
                {
                    "version": version,
                    "seed": 30,
                    "individuals": 3,
                    "kineticEdits": {"0": {"beta": 1.0, "kappa": 0.5}},
                    "doseEvents": [
                        {"time": 0, "amount": 1, "duration": 0},
                        {"time": 0.5, "amount": 2, "duration": 0},
                    ],
                }
            )
            self.assertTrue(edited["provenance"]["replayed"])
            self.assertEqual(
                plain["provenance"]["recordSha256"], edited["provenance"]["sourceRecordSha256"]
            )
            self.assertEqual(plain["individualTruth"], edited["individualTruth"])
            self.assertEqual(edited["topology"]["edges"][0]["beta"], 1)
            self.assertEqual(len(edited["study"]["doseEvents"]), 2)
            self.assertNotEqual(
                plain["study"]["subjects"][0]["points"], edited["study"]["subjects"][0]["points"]
            )

    def test_replay_rejects_unsupported_protocols(self):
        for extra in (
            {"kineticEdits": {"999": {"kappa": 1}}},
            {
                "doseEvents": [
                    {"time": 0, "amount": 1, "duration": 0.1},
                    {"time": 0.5, "amount": 1, "duration": -0.1},
                ]
            },
            {
                "doseEvents": [
                    {"time": 0, "amount": 1, "duration": 0},
                    {"time": 2, "amount": 1, "duration": 0},
                ]
            },
        ):
            with self.assertRaises(ValueError):
                generate({"version": "v6", "seed": 30, "individuals": 3, **extra})
        with self.assertRaisesRegex(ValueError, "v1"):
            generate(
                {"version": "v1", "seed": 30, "individuals": 3, "kineticEdits": {"0": {"kappa": 1}}}
            )


    def test_replay_preserves_independent_infusion_durations(self):
        events = [
            {"time": 0, "amount": 1, "duration": 0},
            {"time": .3, "amount": 2, "duration": .4},
            {"time": .5, "amount": 1, "duration": .1},
        ]
        result = generate({"version": "v7", "seed": 30, "individuals": 3, "doseEvents": events})
        self.assertEqual([e["duration"] for e in result["study"]["doseEvents"]], [0, .4, .1])
        self.assertTrue(result["provenance"]["replayed"])
        self.assertTrue(result["integration"])
        for subject in result["study"]["subjects"]:
            self.assertEqual([e["duration"] for e in subject["doseEvents"]], [0, .4, .1])


    def test_exact_grid_resampling_preserves_shared_schedule_and_latent_cohort(self):
        payload = {"version": "v7", "seed": 30, "individuals": 3, "schedule": "exact"}
        original = generate(payload)
        resampled = generate({**payload, "gridSeed": 1})
        times = [[point[0] for point in s["points"]] for s in resampled["study"]["subjects"]]
        self.assertEqual(times[0], times[1])
        self.assertEqual(times[1], times[2])
        self.assertNotEqual(times[0], [p[0] for p in original["study"]["subjects"][0]["points"]])
        self.assertEqual(times[0][-1], 1)
        self.assertEqual(original["provenance"]["recordSha256"], resampled["provenance"]["recordSha256"])


    def test_resampled_grid_is_a_fresh_weighted_draw_not_local_jitter(self):
        for shape in ("uniform", "early", "late", "clustered"):
            first = _resampled_indices(20, shape, np.random.default_rng(43))
            second = _resampled_indices(20, shape, np.random.default_rng(44))
            self.assertTrue(np.all(np.diff(first) > 0))
            self.assertEqual(first[-1], 127)
            self.assertGreater(np.max(np.abs(first - second)), 4)
            self.assertTrue(np.array_equal(first, _resampled_indices(20, shape, np.random.default_rng(43))))
        early = [_resampled_indices(8, "early", np.random.default_rng(seed))[:-1].mean() for seed in range(100)]
        late = [_resampled_indices(8, "late", np.random.default_rng(seed))[:-1].mean() for seed in range(100)]
        self.assertLess(np.mean(early), np.mean(late))
