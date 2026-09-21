"""Independent physical query times; preserve context scaling and VPC support."""
from dataclasses import replace

import numpy as np
import torch


def apply_target_times(batch, requested, horizon):
    if requested is None:
        return batch, None
    if not isinstance(requested, list) or not 2 <= len(requested) <= 256:
        raise ValueError("targetTimes must contain 2–256 times")
    if any(isinstance(t, bool) or not isinstance(t, (int, float)) for t in requested):
        raise ValueError("targetTimes must be numeric")
    physical = np.asarray(requested, dtype=float)
    if not np.isfinite(physical).all() or (physical < 0).any() or (np.diff(physical) <= 0).any():
        raise ValueError("targetTimes must be finite, nonnegative and strictly increasing")
    target = torch.as_tensor(physical / horizon, dtype=batch.target_time.dtype, device=batch.target_time.device)
    if not torch.isfinite(target).all() or not torch.all(target[1:] > target[:-1]):
        raise ValueError("targetTimes exceed supported numerical precision")
    # Generate jointly on requested and observed times. VPC uses the original
    # observation mesh, never extrapolated/interpolated values from a sparse grid.
    union = torch.unique(torch.cat((batch.target_time[batch.target_mask].flatten(), target)), sorted=True)
    indices = torch.searchsorted(union, target).cpu().numpy()
    query = union.view(1, -1, 1)
    return replace(batch, target_time=query, target_value=torch.zeros_like(query),
                   target_mask=torch.ones_like(query[..., 0], dtype=torch.bool)), indices
