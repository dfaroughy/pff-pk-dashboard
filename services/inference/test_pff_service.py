from __future__ import annotations

import unittest

import numpy as np

from services.inference.pff_service import (
    DEFAULT_FLOW_STEPS,
    DEFAULT_GENERATED_INDIVIDUALS,
    MAX_CONTEXT_INDIVIDUALS,
    MAX_FLOW_STEPS,
    MAX_GENERATED_INDIVIDUALS,
    bounded_integer,
    build_cohort,
    generation_only_protocol,
    requested_model,
    target_dose_events,
)
from services.inference.pharmpy_vpc import pharmpy_vpc_summary


class RequestValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.cohort = {
            "dose_units": "mg",
            "time_units": "h",
            "horizon": 24.0,
            "route": "oral",
            "dose": "10",
        }

    def test_integer_controls_are_not_truncated(self) -> None:
        self.assertEqual(bounded_integer("8", "steps", 1, 100), 8)
        with self.assertRaisesRegex(ValueError, "whole number"):
            bounded_integer(8.5, "steps", 1, 100)

    def test_public_inference_limits_are_conservative(self) -> None:
        self.assertEqual(DEFAULT_GENERATED_INDIVIDUALS, 20)
        self.assertEqual(MAX_GENERATED_INDIVIDUALS, 30)
        self.assertEqual(DEFAULT_FLOW_STEPS, 8)
        self.assertEqual(MAX_FLOW_STEPS, 16)
        with self.assertRaisesRegex(ValueError, "between 1 and 30"):
            bounded_integer(31, "nDraws", 1, MAX_GENERATED_INDIVIDUALS)
        with self.assertRaisesRegex(ValueError, "between 1 and 16"):
            bounded_integer(17, "solver steps", 1, MAX_FLOW_STEPS)

    def test_context_payload_rejects_excessive_individuals(self) -> None:
        subjects = [
            {"id": str(index), "points": [[0.5, 1.0], [1.0, 0.5]]}
            for index in range(MAX_CONTEXT_INDIVIDUALS + 1)
        ]
        with self.assertRaisesRegex(ValueError, "at most 128 individuals"):
            build_cohort({"subjects": subjects, "route": "oral"})

    def test_events_are_validated_and_sorted(self) -> None:
        events = target_dose_events(
            [
                {"time": 2.3, "amount": 40, "unit": "mg", "route": "oral"},
                {"time": 0, "amount": 10, "unit": "mg", "route": "oral"},
            ],
            self.cohort,
        )
        self.assertEqual([event["time"] for event in events], [0.0, 2.3])
        self.assertTrue(all(event["unit"] == "mg" for event in events))

    def test_events_must_be_positive_and_inside_the_observation_horizon(self) -> None:
        with self.assertRaisesRegex(ValueError, "greater than zero"):
            target_dose_events([{"time": 0, "amount": 0, "unit": "mg"}], self.cohort)
        with self.assertRaisesRegex(ValueError, "observation horizon"):
            target_dose_events([{"time": 24, "amount": 10, "duration": 1, "unit": "mg"}], self.cohort)

    def test_model_selection_defaults_to_dose_and_rejects_unknown_models(self) -> None:
        self.assertEqual(requested_model({}), "pythia_dose")
        self.assertEqual(requested_model({"modelId": "pythia"}), "pythia")
        with self.assertRaisesRegex(ValueError, "modelId"):
            requested_model({"modelId": "unknown"})

    def test_generation_only_model_rejects_dose_counterfactuals(self) -> None:
        baseline = generation_only_protocol(
            [{"time": 0, "amount": 10, "unit": "mg", "route": "oral"}],
            self.cohort,
        )
        self.assertEqual(len(baseline), 1)
        with self.assertRaisesRegex(ValueError, "Pythia-Dose"):
            generation_only_protocol(
                [{"time": 0, "amount": 20, "unit": "mg", "route": "oral"}],
                self.cohort,
            )
        with self.assertRaisesRegex(ValueError, "Pythia-Dose"):
            generation_only_protocol(
                [
                    {"time": 0, "amount": 10, "unit": "mg", "route": "oral"},
                    {"time": 4, "amount": 10, "unit": "mg", "route": "oral"},
                ],
                self.cohort,
            )


class PharmpyVpcTests(unittest.TestCase):
    def test_summary_uses_only_the_supplied_generated_pool(self) -> None:
        times = np.array([0.5, 1.0, 2.0, 4.0])
        baseline = np.array([10.0, 8.0, 5.0, 2.0])
        pool = np.stack([baseline * scale for scale in np.linspace(0.7, 1.3, 20)])
        cohort = {
            "horizon": 4.0,
            "subjects": {
                "a": list(zip(times, baseline * 0.9, strict=True)),
                "b": list(zip(times, baseline, strict=True)),
                "c": list(zip(times, baseline * 1.1, strict=True)),
            },
        }

        summary = pharmpy_vpc_summary(
            pool,
            times,
            cohort,
            replicates=40,
            requested_bins=3,
            seed=7,
        )

        self.assertEqual(summary["method"], "pharmpy")
        self.assertEqual(summary["generatedIndividuals"], 20)
        self.assertEqual(summary["simulatedCohortReplicates"], 40)
        self.assertEqual(summary["effectiveBins"], 3)
        self.assertEqual(len(summary["points"]), 3)
        self.assertTrue(all(point["nObservations"] > 0 for point in summary["points"]))

if __name__ == "__main__":
    unittest.main()
