import type { DoseEvent, Study } from "./types";
import { dashboardRuntimeConfig } from "./runtime-config";

export type InferenceRequest = {
  study: Pick<Study, "id" | "drug" | "study" | "source" | "route" | "dose" | "doseUnit" | "concentrationUnit" | "timeUnit" | "subjects">;
  doseEvents: DoseEvent[];
  nDraws: number;
  batchSize: number;
  solver: { method: "heun" | "euler"; steps: number };
  seed: number;
};

export type InferenceResponse = {
  inferenceId: string;
  createdAt: string;
  checkpointId: string;
  request: Omit<InferenceRequest, "study" | "batchSize"> & { studyId: string };
  queryTime: number[];
  generatedConcentration: number[][];
  units: { time: string; concentration: string };
  provenance: {
    checkpointSha256: string;
    normalization: string;
    sourceProcess: Record<string, unknown>;
    device: "cpu";
    runtimeSeconds: number;
  };
};

export type ServiceStatus = {
  ready: boolean;
  loaded: boolean;
  device: "cpu";
  checkpointId: string;
};

export async function serviceStatus(): Promise<ServiceStatus> {
  const response = await fetch(`${dashboardRuntimeConfig().apiRoot}/health`);
  if (!response.ok) throw new Error("PFF service is unavailable");
  return response.json() as Promise<ServiceStatus>;
}

export async function runInference(request: InferenceRequest): Promise<InferenceResponse> {
  const response = await fetch(`${dashboardRuntimeConfig().apiRoot}/inference`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const payload = await response.json() as InferenceResponse | { error: string };
  if (!response.ok) throw new Error("error" in payload ? payload.error : `PFF inference failed (${response.status})`);
  return payload as InferenceResponse;
}
