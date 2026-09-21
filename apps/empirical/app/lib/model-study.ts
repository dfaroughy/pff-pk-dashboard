import type { InferenceResponse } from "./model-api";
import type { Study } from "./types";

/** Keep VPC rebinning on the same observation window as initial inference. */
export function modelEvaluationStudy(study: Study, result: InferenceResponse): Study {
  if (result.request?.modelId !== "tabpfn" && result.request?.modelId !== "tabpfn_ts") return study;
  return { ...study, subjects: study.subjects.map(subject => ({
    ...subject,
    points: subject.points.filter(([time]) => time > 0),
    ...(subject.cens ? { cens: subject.cens.filter((_, i) => subject.points[i][0] > 0) } : {}),
  })) };
}
