"""Mesh-aligned VPC summaries for interactive Pythia-PK inference."""

from __future__ import annotations

from typing import Any

import numpy as np


def _rank_quantile(values: np.ndarray, probability: float, axis: int) -> np.ndarray:
    """Use the nearest-rank convention used by Pharmpy's VPC implementation."""
    ordered = np.sort(values, axis=axis)
    index = int(np.floor(probability * (values.shape[axis] - 1) + 0.5))
    return np.take(ordered, index, axis=axis)


def _simulation_interval(
    replicate_quantiles: np.ndarray,
    probability: float,
) -> tuple[np.ndarray, np.ndarray]:
    ordered = np.sort(replicate_quantiles, axis=0)
    replicates = ordered.shape[0]
    lower_index = int(np.floor(probability * (replicates - 1) + 0.5))
    return ordered[lower_index], ordered[replicates - lower_index - 1]


def pharmpy_vpc_summary(
    generated_concentration: np.ndarray,
    query_time: np.ndarray,
    cohort: dict[str, Any],
    *,
    replicates: int = 200,
    requested_bins: int = 10,
    seed: int = 43,
) -> dict[str, Any]:
    """Compute a VPC on the model's exact concentration-time query mesh.

    The finite generated pool is the only source of simulated trajectories. For
    each inexpensive replicate, one generated trajectory is sampled per observed
    individual and its 5th, 50th and 95th percentiles are evaluated at every
    model query time. The 90% intervals across those replicate percentiles follow
    Pharmpy's nearest-rank convention.

    Evaluation on the exact query mesh is essential for irregular empirical
    schedules. Time-bin midpoints and edges are not model observation times and
    must therefore never be rendered as generated observations.
    """
    pool = np.asarray(generated_concentration, dtype=np.float64)
    times = np.asarray(query_time, dtype=np.float64)
    if pool.ndim != 2 or times.ndim != 1 or pool.shape[1] != len(times):
        raise ValueError("generated pool and query mesh are misaligned")
    if (
        not len(pool)
        or not len(times)
        or not np.isfinite(pool).all()
        or not np.isfinite(times).all()
    ):
        raise ValueError("generated pool and query mesh must be finite and non-empty")
    if np.any(pool <= 0.0) or np.any(np.diff(times) <= 0.0):
        raise ValueError(
            "VPC evaluation requires positive concentrations and increasing times"
        )
    if replicates < 20:
        raise ValueError(
            "VPC evaluation requires at least 20 resampled cohort replicates"
        )
    if requested_bins < 1:
        raise ValueError("requested VPC bins must be positive")

    curves = list(cohort["subjects"].values())
    if not curves:
        raise ValueError("VPC evaluation requires at least one observed individual")

    tolerance = max(float(cohort["horizon"]) * 2.0e-6, 1.0e-9)
    observed_by_time: list[list[float]] = [[] for _ in times]
    for curve in curves:
        schedule = np.asarray([point[0] for point in curve], dtype=np.float64)
        values = np.asarray([point[1] for point in curve], dtype=np.float64)
        indices = np.abs(times[:, None] - schedule[None, :]).argmin(axis=0)
        if len(schedule) and np.max(np.abs(times[indices] - schedule)) > tolerance:
            raise ValueError(
                "an empirical observation time is absent from the query mesh"
            )
        for index, value in zip(indices, values, strict=True):
            observed_by_time[int(index)].append(float(value))

    rng = np.random.default_rng(seed)
    selected = np.stack(
        [
            rng.choice(
                len(pool),
                size=len(curves),
                replace=len(pool) < len(curves),
            )
            for _ in range(replicates)
        ]
    )
    simulated_cohorts = pool[selected]
    quantiles = {"q05": 0.05, "q50": 0.50, "q95": 0.95}
    simulated: dict[str, dict[str, np.ndarray]] = {}
    for key, probability in quantiles.items():
        replicate_quantiles = _rank_quantile(simulated_cohorts, probability, axis=1)
        lower, upper = _simulation_interval(replicate_quantiles, 0.05)
        simulated[key] = {
            "center": _rank_quantile(pool, probability, axis=0),
            "lower": lower,
            "upper": upper,
        }

    points = []
    for index, time in enumerate(times):
        observed_values = np.asarray(observed_by_time[index], dtype=np.float64)
        if not len(observed_values):
            raise ValueError(
                "query mesh contains a time without an empirical observation"
            )
        points.append(
            {
                "time": float(time),
                "timeLower": float(time),
                "timeUpper": float(time),
                "nObservations": len(observed_values),
                "observed": {
                    key: float(_rank_quantile(observed_values, probability, axis=0))
                    for key, probability in quantiles.items()
                },
                "simulated": {
                    key: {
                        bound: float(values[bound][index])
                        for bound in ("center", "lower", "upper")
                    }
                    for key, values in simulated.items()
                },
            }
        )

    return {
        "method": "pharmpy",
        "timeBinning": "query_mesh",
        "generatedIndividuals": len(pool),
        "simulatedCohortReplicates": int(replicates),
        "requestedBins": int(requested_bins),
        "effectiveBins": len(times),
        "points": points,
    }
