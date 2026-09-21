from dataclasses import fields

import numpy as np
import pytest
import torch

from services.inference.test_covariate_batch import CovariateBatchTests
from services.inference.observation_protocol import apply_target_times


def test_grid_preserves_context_and_scaling():
    fixture = CovariateBatchTests()
    batch, _, _ = fixture.batch(fixture.study())
    changed, indices = apply_target_times(batch, [0, 0.5, 4], 3)
    np.testing.assert_allclose(changed.target_time.flatten()[indices] * 3, [0, 0.5, 4])
    assert changed.target_time.max() > 1  # no renormalization for extrapolation
    assert changed.target_mask.all()
    for field in fields(batch):
        if field.name not in {"target_time", "target_value", "target_mask"}:
            assert getattr(changed, field.name) is getattr(batch, field.name)
    for value in batch.target_time.flatten():
        assert torch.any(changed.target_time == value)
    assert apply_target_times(batch, None, 3) == (batch, None)


@pytest.mark.parametrize("times", [[], [1], [1, 1], [2, 1], [-1, 2], [0, float("nan")], [0, float("inf")], [False, 1], ["0", 1], list(range(257))])
def test_invalid_grids(times):
    fixture = CovariateBatchTests()
    batch, _, _ = fixture.batch(fixture.study())
    with pytest.raises(ValueError, match="targetTimes"):
        apply_target_times(batch, times, 3)
