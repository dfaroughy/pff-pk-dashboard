"""Design-matched Pharmpy VPC summaries for interactive inference."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from pharmpy.modeling import (
    bin_observations,
    create_basic_pk_model,
    plot_vpc,
    set_dataset,
)


def _effective_bins(model, requested: int) -> int:
    unique_times = int(model.dataset["TIME"].nunique())
    for candidate in range(min(requested, unique_times), 0, -1):
        membership, boundaries = bin_observations(model, "equal_number", candidate)
        if (
            membership.notna().all()
            and membership.nunique() == candidate
            and len(boundaries) == candidate + 1
            and np.all(np.diff(boundaries) > 0.0)
        ):
            return candidate
    raise ValueError("Pharmpy could not construct non-empty VPC bins")


def _statistics_frame(
    observed: pd.DataFrame,
    simulations: pd.DataFrame,
    *,
    requested_bins: int,
) -> tuple[pd.DataFrame, int]:
    model = set_dataset(create_basic_pk_model("iv"), observed, datatype="nonmem")
    bins = _effective_bins(model, requested_bins)
    chart = plot_vpc(
        model,
        simulations,
        binning="equal_number",
        nbins=bins,
        qi=0.90,
        ci=0.90,
    )
    required = {
        "obs_central",
        "obs_lower",
        "obs_upper",
        "sim_central",
        "sim_central_lower",
        "sim_central_upper",
        "sim_lower",
        "sim_lower_lower",
        "sim_lower_upper",
        "sim_upper",
        "sim_upper_lower",
        "sim_upper_upper",
        "bin_midpoint",
        "bin_edges_left",
        "bin_edges_right",
        "n_data_points",
    }
    for layer in chart.layer:
        data = getattr(layer, "data", None)
        if isinstance(data, pd.DataFrame) and required <= set(data.columns):
            return data.reset_index(drop=True).copy(), bins
    raise RuntimeError("Pharmpy VPC did not expose its statistics table")


def _finite_float(value: Any, label: str) -> float:
    result = float(value)
    if not np.isfinite(result):
        raise ValueError(f"non-finite {label} in Pharmpy VPC output")
    return result


def _rank_quantile(values: np.ndarray, probability: float, axis: int) -> np.ndarray:
    """Match Pharmpy's nearest-rank quantile convention along one axis."""
    ordered = np.sort(values, axis=axis)
    index = int(np.floor(probability * (values.shape[axis] - 1) + 0.5))
    return np.take(ordered, index, axis=axis)


def _exact_schedule_summary(
    times: np.ndarray,
    schedule: np.ndarray,
    observed_values: np.ndarray,
    simulation_values: np.ndarray,
) -> list[dict[str, Any]]:
    """Evaluate a VPC at each time when every individual shares one schedule."""
    scheduled_times = times[schedule]
    replicates, individuals, observations = simulation_values.shape
    pooled = simulation_values.reshape(replicates * individuals, observations)
    quantiles = {"q05": 0.05, "q50": 0.50, "q95": 0.95}
    observed = {
        key: _rank_quantile(observed_values, probability, axis=0)
        for key, probability in quantiles.items()
    }
    simulated = {}
    for key, probability in quantiles.items():
        replicate_quantiles = _rank_quantile(simulation_values, probability, axis=1)
        ordered = np.sort(replicate_quantiles, axis=0)
        interval_index = int(np.floor(0.05 * (replicates - 1) + 0.5))
        simulated[key] = {
            "center": _rank_quantile(pooled, probability, axis=0),
            "lower": ordered[interval_index],
            "upper": ordered[replicates - interval_index - 1],
        }

    return [
        {
            "time": float(time),
            "timeLower": float(time),
            "timeUpper": float(time),
            "nObservations": int(individuals),
            "observed": {key: float(values[index]) for key, values in observed.items()},
            "simulated": {
                key: {bound: float(values[bound][index]) for bound in ("center", "lower", "upper")}
                for key, values in simulated.items()
            },
        }
        for index, time in enumerate(scheduled_times)
    ]


def pharmpy_vpc_summary(
    generated_concentration: np.ndarray,
    query_time: np.ndarray,
    cohort: dict[str, Any],
    *,
    replicates: int = 200,
    requested_bins: int = 10,
    seed: int = 43,
) -> dict[str, Any]:
    """Compute a formal VPC from one finite pool of generated individuals.

    The neural model is evaluated only for the rows in ``generated_concentration``.
    Each inexpensive simulation replicate then samples one generated curve for each
    empirical individual and evaluates it on that individual's observation schedule.
    Synchronized schedules are evaluated at their exact observation times.
    Pharmpy owns equal-number binning for irregular schedules. Both paths use
    Pharmpy's nearest-rank quantile and 90% simulation-interval conventions.
    """
    pool = np.asarray(generated_concentration, dtype=np.float64)
    times = np.asarray(query_time, dtype=np.float64)
    if pool.ndim != 2 or times.ndim != 1 or pool.shape[1] != len(times):
        raise ValueError("generated pool and query mesh are misaligned")
    if not len(pool) or not len(times) or not np.isfinite(pool).all() or not np.isfinite(times).all():
        raise ValueError("generated pool and query mesh must be finite and non-empty")
    if np.any(pool <= 0.0) or np.any(np.diff(times) <= 0.0):
        raise ValueError("Pharmpy VPC requires positive concentrations and increasing times")
    if replicates < 20:
        raise ValueError("Pharmpy VPC requires at least 20 resampled cohort replicates")
    if requested_bins < 1:
        raise ValueError("requested VPC bins must be positive")

    observed_rows: list[dict[str, float | int]] = []
    schedules: list[np.ndarray] = []
    tolerance = max(float(cohort["horizon"]) * 2.0e-6, 1.0e-9)
    for individual, curve in enumerate(cohort["subjects"].values(), start=1):
        schedule = np.asarray([point[0] for point in curve], dtype=np.float64)
        values = np.asarray([point[1] for point in curve], dtype=np.float64)
        indices = np.abs(times[:, None] - schedule[None, :]).argmin(axis=0)
        if len(schedule) and np.max(np.abs(times[indices] - schedule)) > tolerance:
            raise ValueError("an empirical observation time is absent from the query mesh")
        schedules.append(indices)
        observed_rows.extend(
            {
                "ID": individual,
                "TIME": float(time),
                "DV": float(value),
                "MDV": 0,
                "AMT": 0.0,
            }
            for time, value in zip(schedule, values, strict=True)
        )

    observed = pd.DataFrame(observed_rows)
    observed.index = np.arange(1, len(observed) + 1)
    rng = np.random.default_rng(seed)
    simulation_values = np.empty((replicates, len(observed)), dtype=np.float64)
    for replicate in range(replicates):
        selected = rng.choice(
            len(pool),
            size=len(schedules),
            replace=len(pool) < len(schedules),
        )
        cursor = 0
        for draw, indices in zip(selected, schedules, strict=True):
            count = len(indices)
            simulation_values[replicate, cursor : cursor + count] = pool[draw, indices]
            cursor += count
    simulations = pd.DataFrame(
        {
            "SIM": np.repeat(np.arange(1, replicates + 1), len(observed)),
            "index": np.tile(np.arange(1, len(observed) + 1), replicates),
            "DV": simulation_values.reshape(-1),
        }
    ).set_index(["SIM", "index"])

    synchronized = all(
        len(indices) == len(schedules[0]) and np.array_equal(indices, schedules[0])
        for indices in schedules[1:]
    )
    if synchronized:
        observations = len(schedules[0])
        observed_values = np.asarray(
            [[point[1] for point in curve] for curve in cohort["subjects"].values()],
            dtype=np.float64,
        )
        points = _exact_schedule_summary(
            times,
            schedules[0],
            observed_values,
            simulation_values.reshape(replicates, len(schedules), observations),
        )
        return {
            "method": "pharmpy",
            "timeBinning": "exact_schedule",
            "generatedIndividuals": int(len(pool)),
            "simulatedCohortReplicates": int(replicates),
            "requestedBins": int(requested_bins),
            "effectiveBins": int(observations),
            "points": points,
        }

    statistics, bins = _statistics_frame(
        observed,
        simulations,
        requested_bins=requested_bins,
    )

    points = []
    for row in statistics.to_dict(orient="records"):
        points.append(
            {
                "time": _finite_float(row["bin_midpoint"], "bin midpoint"),
                "timeLower": _finite_float(row["bin_edges_left"], "left bin edge"),
                "timeUpper": _finite_float(row["bin_edges_right"], "right bin edge"),
                "nObservations": int(row["n_data_points"]),
                "observed": {
                    "q05": _finite_float(row["obs_lower"], "observed lower quantile"),
                    "q50": _finite_float(row["obs_central"], "observed median"),
                    "q95": _finite_float(row["obs_upper"], "observed upper quantile"),
                },
                "simulated": {
                    "q05": {
                        "center": _finite_float(row["sim_lower"], "simulated lower quantile"),
                        "lower": _finite_float(row["sim_lower_lower"], "lower-quantile interval"),
                        "upper": _finite_float(row["sim_lower_upper"], "lower-quantile interval"),
                    },
                    "q50": {
                        "center": _finite_float(row["sim_central"], "simulated median"),
                        "lower": _finite_float(row["sim_central_lower"], "median interval"),
                        "upper": _finite_float(row["sim_central_upper"], "median interval"),
                    },
                    "q95": {
                        "center": _finite_float(row["sim_upper"], "simulated upper quantile"),
                        "lower": _finite_float(row["sim_upper_lower"], "upper-quantile interval"),
                        "upper": _finite_float(row["sim_upper_upper"], "upper-quantile interval"),
                    },
                },
            }
        )
    return {
        "method": "pharmpy",
        "timeBinning": "equal_number",
        "generatedIndividuals": int(len(pool)),
        "simulatedCohortReplicates": int(replicates),
        "requestedBins": int(requested_bins),
        "effectiveBins": int(bins),
        "points": points,
    }
