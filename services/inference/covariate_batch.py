"""Dashboard-to-v7 conditioning adapter, independent of the legacy runtimes."""
from dataclasses import replace
import math

import torch

from pff_pk.inference.empirical import empirical_cohort_batch
from synthetic_priors import encode_semantic_covariates
from pff_pk.tasks.generic_covariates import generic_rows, normalize_generic


def mask_lloq_input(batch, provide_lloq=True):
    """Hide assay metadata only, after reporting and normalization are complete."""
    if not isinstance(provide_lloq, bool):
        raise ValueError("provideLloq must be true or false")
    if provide_lloq:
        return batch
    return replace(batch, assay_limit=torch.zeros_like(batch.assay_limit),
                   assay_known=torch.zeros_like(batch.assay_known))


def target_covariate_rows(raw, count, batch):
    """Validate and encode one physical target row per generated curve.

    Generic normalization uses context plus ONE target at a time, so other
    generated patients never contaminate the context reference or category codes.
    """
    if raw is None:
        raw = [{} for _ in range(count)]
    if not isinstance(raw, list) or len(raw) != count:
        raise ValueError("targetCovariates must contain one row per generated individual")
    context = batch.context_covariates[0]
    continuous = {"age_years", "weight_kg", "height_cm", "renal_function_ratio", "hepatic_function_ratio", "cov_cont_0"}
    categorical = {"sex": {"female", "male"}, "metabolic_phenotype": {"poor", "normal", "rapid"},
                   "cov_cat_0": {str(row["cov_cat_0"]) for row in context if row.get("cov_cat_0") is not None}}
    available = {key for row in context for key, value in row.items() if value is not None}
    rows, encoded, masks = [], [], []
    for row in raw:
        if not isinstance(row, dict):
            raise ValueError("each target covariate row must be an object")
        clean = {}
        for key, value in row.items():
            if key not in continuous | categorical.keys() or key not in available:
                raise ValueError(f"target covariate {key!r} is not available in context")
            if value is None or value == "":
                continue
            if key in continuous:
                if isinstance(value, bool):
                    raise ValueError(f"{key} must be numeric")
                number = float(value)
                if not math.isfinite(number) or (key != "cov_cont_0" and number <= 0):
                    raise ValueError(f"{key} must be finite" + (" and positive" if key != "cov_cont_0" else ""))
                clean[key] = number
            else:
                label = str(value) if key == "cov_cat_0" else str(value).strip().lower()
                if label not in categorical[key]:
                    raise ValueError(f"invalid category for {key}")
                clean[key] = label
        objects = [*context, clean]
        semantic = [encode_semantic_covariates(value) for value in objects]
        values = torch.tensor([v.tolist() for v, _ in semantic], dtype=torch.float32)
        mask = torch.tensor([m.tolist() for _, m in semantic], dtype=torch.bool)
        gv, gm, _ = generic_rows(objects)
        values, mask = normalize_generic(torch.cat((values, gv), -1), torch.cat((mask, gm), -1))
        encoded.append(values[-1]); masks.append(mask[-1]); rows.append(clean)
    return rows, torch.stack(encoded), torch.stack(masks)


def covariate_cohort_batch(study, cohort, *, normalization, target_dose_events):
    """Keep explicit CENS, omit unresolved assay records, and mask absent covariates.

    No censor label is guessed from a concentration equal to/below LLOQ.
    Omitted records remain in the original cohort for VPC reporting and queries.
    """
    limit = (study.get("assay") or {}).get("lloq")
    if limit is not None:
        if isinstance(limit, bool) or not math.isfinite(float(limit)) or float(limit) <= 0:
            raise ValueError("assay LLOQ must be positive and finite")
        limit = float(limit)
    raw = {str(s["id"]): s for s in study["subjects"]}
    subjects, covariates, labels = {}, {}, {}
    omitted = 0
    for identifier in cohort["subjects"]:
        subject = raw[identifier]
        points = subject["points"]
        flags = subject.get("cens")
        if flags is not None and len(flags) != len(points):
            raise ValueError("censoring flags must align with observations")
        records = []
        for i, (time, value) in enumerate(points):
            time, value = float(time), float(value)
            if not math.isfinite(time) or not math.isfinite(value):
                raise ValueError("observations must be finite")
            flag = flags[i] if flags is not None else (0 if limit is None or value > limit else None)
            if flag not in (0, 1, None):
                raise ValueError("censoring flags must be 0, 1, or null")
            if time < 0:
                continue
            if flag is None or (flag == 0 and limit is not None and value < limit):
                omitted += 1
                continue
            if flag == 1 and limit is not None:
                value = limit
            if value <= 0:
                if flag == 1:
                    raise ValueError("a censored observation needs a positive reporting value or LLOQ")
                continue
            records.append((time, value, bool(flag)))
        records.sort(key=lambda row: row[0])
        if not records:
            continue
        subjects[identifier] = [(t, v) for t, v, _ in records]
        labels[identifier] = [flag for _, _, flag in records]
        values = subject.get("covariates") or {}
        if not isinstance(values, dict):
            raise ValueError("subject covariates must be an object")
        values = dict(values)
        if isinstance(values.get("sex"), str):
            values["sex"] = values["sex"].lower()
        covariates[identifier] = values
    if len(subjects) < 2:
        raise ValueError("Pythia-Covariates needs two individuals with resolved observations")
    model_cohort = {**cohort, "subjects": subjects, "covariates": covariates}
    model_cohort.pop("assay", None)
    batch, _, _ = empirical_cohort_batch(
        model_cohort, normalization=normalization,
        target_dose_events=target_dose_events,
        covariate_encoding="semantic_generic_v1", censoring_encoding="left_censoring_v1",
    )
    cens = torch.zeros_like(batch.context_mask)
    for i, identifier in enumerate(subjects):
        cens[0, i, :len(labels[identifier])] = torch.tensor(labels[identifier])
    floor = torch.zeros(1)
    if limit is not None:
        floor = (torch.log(torch.tensor([limit]) / batch.concentration_scale)
                 - batch.log_center) / batch.log_scale
    # Keep the full observed mesh even when unresolved records cannot condition v7.
    query = torch.tensor(sorted({t for curve in cohort["subjects"].values() for t, _ in curve}))
    query = (query / cohort["horizon"]).view(1, -1, 1)
    batch = replace(batch, context_cens=cens, assay_limit=floor,
                    assay_known=torch.tensor([limit is not None]),
                    target_time=query, target_value=torch.zeros_like(query),
                    target_mask=torch.ones(1, query.shape[1], dtype=torch.bool))
    return batch, model_cohort, omitted
