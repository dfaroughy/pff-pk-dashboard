import type { InferenceResponse } from "./model-api";
import type { Point, Study } from "./types";

/** Project each generated curve onto a context individual's acquisition schedule.
 * The full union-time pool remains untouched for design-matched VPC resampling.
 */
export function generatedObservationCurves(
  result: Pick<InferenceResponse, "queryTime" | "generatedConcentration">,
  study: Pick<Study, "subjects">,
): Point[][] {
  const schedules = study.subjects
    .map((subject) => subject.points.filter(([time, value]) => time >= 0 && value > 0))
    .filter((points) => points.length >= 2);
  if (!schedules.length) return [];
  // Inference round-trips normalized time through float32. Match the nearest
  // actual query node within that precision; never interpolate extra values.
  const tolerance = Math.max(...result.queryTime.map(Math.abs), 1) * 1e-6;
  const indices = schedules.map((points) => points.map(([time]) => {
    let nearest = -1;
    let distance = Infinity;
    result.queryTime.forEach((query, index) => {
      const delta = Math.abs(query - time);
      if (delta < distance) { nearest = index; distance = delta; }
    });
    return { time, index: distance <= tolerance ? nearest : -1 };
  }));
  // Cycle through the observed designs for a stable, balanced display even when
  // the number of generated individuals differs from the context cohort size.
  return result.generatedConcentration.map((values, row) =>
    indices[row % indices.length].flatMap(({ time, index }) =>
      index >= 0 && Number.isFinite(values[index]) ? [[time, values[index]] as Point] : [],
    ),
  );
}
