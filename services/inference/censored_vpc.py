"""Assay-aware dashboard VPC adapter; Pharmpy remains the binning authority.

Censored records keep their ranks. Unresolved records are interval-valued,
not silently classified as BLQ. Simulated curves use the same assay and design.
"""
from __future__ import annotations

import numpy as np
from pharmpy.modeling import bin_observations
from pff_pk.metrics import dashboard_vpc as base
from pff_pk.metrics.mesh_vpc import rank_quantile
from pff_pk.metrics.pharmpy_vpc import _pharmpy_model, _pharmpy_statistics

CENSORING_VERSION = "assay-aware-v1"
DASHBOARD_VPC_VERSION = base.DASHBOARD_VPC_VERSION + "+" + CENSORING_VERSION
PROBABILITIES = {"q05": .05, "q50": .5, "q95": .95}


def _limit(study):
    value = (study or {}).get("assay", {}).get("lloq")
    if value is None:
        return None
    if isinstance(value, bool) or not np.isfinite(float(value)) or float(value) <= 0:
        raise ValueError("assay LLOQ must be positive and finite")
    return float(value)


def _records(cohort, study, lloq):
    raw = {str(s["id"]): s for s in study["subjects"]}
    rows = []
    for person, (identifier, curve) in enumerate(cohort["subjects"].items()):
        subject = raw[identifier]
        flags = subject.get("cens")
        if flags is not None and len(flags) != len(subject["points"]):
            raise ValueError("censoring flags must align with observations")
        by_time = {}
        for i, (time, value) in enumerate(subject["points"]):
            if flags is not None:
                flag = flags[i]
                if flag not in (0, 1, None):
                    raise ValueError("censoring flags must be 0, 1, or null")
            else:
                flag = 0 if value > lloq else None
            # A below-assay number without a confirmed BLQ flag is unresolved.
            if value < lloq and flag == 0:
                flag = None
            by_time[float(time)] = (float(value), flag)
        for time, _ in curve:
            value, flag = by_time[time]
            rows.append((person, time, value, flag))
    return rows


def _observed_summary(rows, lloq):
    lower = np.array([value if flag == 0 else 0. for _, _, value, flag in rows])
    upper = np.array([value if flag == 0 else lloq if flag == 1 else max(lloq, value)
                      for _, _, value, flag in rows])
    quantiles = {}
    for key, probability in PROBABILITIES.items():
        lo, hi = float(rank_quantile(lower, probability)), float(rank_quantile(upper, probability))
        quantiles[key] = hi if lo == hi and hi >= lloq else None
    n = len(rows)
    censored = sum(flag == 1 for _, _, _, flag in rows)
    unresolved = sum(flag is None for _, _, _, flag in rows)
    return quantiles, {"lower": censored / n, "upper": (censored + unresolved) / n,
                       "nCensored": censored, "nUnresolved": unresolved}


def _apply(summary, cohort, study, pool=None, query_time=None, *, replicates=200, seed=43):
    lloq = _limit(study)
    if lloq is None:
        return summary
    rows = _records(cohort, study, lloq)
    if summary.get("timeBinning") == "query_mesh":
        row_times = np.array([r[1] for r in rows])
        tolerance = max(cohort["horizon"] * 2e-6, 1e-9)
        groups = [np.flatnonzero(np.abs(row_times - p["time"]) <= tolerance) for p in summary["points"]]
    else:
        # Use Pharmpy's actual assignments, including its edge/tie convention.
        labels, _ = bin_observations(_pharmpy_model(base._observed(cohort)),
                                    "equal_number", summary["effectiveBins"])
        groups = [np.flatnonzero(labels.to_numpy() == i) for i in range(summary["effectiveBins"])]
    values = None
    if pool is not None:
        pool, times = np.asarray(pool), np.asarray(query_time)
        indices = np.abs(times[:, None] - np.array([r[1] for r in rows])[None, :]).argmin(axis=0)
        selected = np.random.default_rng(seed).integers(len(pool), size=(replicates, len(cohort["subjects"])))
        values = pool[selected[:, [r[0] for r in rows]], indices[None, :]]
    for point, group in zip(summary["points"], groups, strict=True):
        if not len(group) or len(group) != point["nObservations"]:
            raise ValueError("censoring records do not match VPC bin membership")
        point["observed"], observed_blq = _observed_summary([rows[i] for i in group], lloq)
        point["blq"] = {"observed": observed_blq}
        if values is not None:
            simulated = values[:, group]
            fraction = (simulated < lloq).mean(axis=1)
            point["blq"]["simulated"] = {
                "center": float(fraction.mean()), "lower": float(rank_quantile(fraction, .05)),
                "upper": float(rank_quantile(fraction, .95)),
            }
            # Keep every replicate, including those whose percentile is BLQ.
            # A CI crossing the LLOQ is visibly clipped, never re-estimated from
            # only the quantifiable replicates.
            for key, probability in PROBABILITIES.items():
                qs = rank_quantile(simulated, probability, axis=1)
                lo, hi = float(rank_quantile(qs, .05)), float(rank_quantile(qs, .95))
                center = float(rank_quantile(simulated.reshape(-1), probability))
                point["simulated"][key] = {
                    "center": center if center >= lloq else None,
                    "lower": max(lo, lloq) if hi >= lloq else None,
                    "upper": hi if hi >= lloq else None,
                    "lowerCensored": lo < lloq,
                }
    summary["censoring"] = {"methodVersion": CENSORING_VERSION, "lloq": lloq}
    return summary


def dashboard_vpc_summary(pool, query_time, cohort, *, study=None, replicates=200, seed=43, num_bins=None):
    summary = base.dashboard_vpc_summary(pool, query_time, cohort, replicates=replicates, seed=seed, num_bins=num_bins)
    return _apply(summary, cohort, study, pool, query_time, replicates=replicates, seed=seed)


def observed_vpc_summary(cohort, *, study=None, num_bins=None):
    if _limit(study) is None:
        return base.observed_vpc_summary(cohort, num_bins=num_bins)
    frame = base._observed(cohort)
    stats, bins = _pharmpy_statistics(frame, base._simulations(np.tile(frame.DV.to_numpy(), (2, 1))),
                                    requested_bins=base._bins(frame, num_bins))
    summary = _apply({"effectiveBins": bins, "points": base._points(stats)}, cohort, study)
    return {"methodVersion": base.BINNED_VPC_VERSION, "effectiveBins": bins,
            "censoring": summary["censoring"],
            "points": [{"time": p["time"], "n": p["nObservations"], **p["observed"], "blq": p["blq"]}
                       for p in summary["points"]]}
