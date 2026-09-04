from __future__ import annotations

import unittest

from services.inference.pff_service import (
    DEFAULT_FLOW_STEPS,
    DEFAULT_GENERATED_INDIVIDUALS,
    MAX_FLOW_STEPS,
    MAX_GENERATED_INDIVIDUALS,
    bounded_integer,
    target_dose_events,
)


class RequestValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.cohort = {
            "dose_units": "mg",
            "time_units": "h",
            "horizon": 24.0,
            "route": "oral",
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


if __name__ == "__main__":
    unittest.main()
