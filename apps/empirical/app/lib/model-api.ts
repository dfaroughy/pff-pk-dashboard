import { Client } from "@gradio/client";
import type { DoseEvent, Study } from "./types";
import { dashboardRuntimeConfig } from "./runtime-config";

export type ModelId = "pythia" | "pythia_dose";

export type InferenceRequest = {
  modelId: ModelId;
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
  vpc: {
    method: "pharmpy";
    generatedIndividuals: number;
    simulatedCohortReplicates: number;
    requestedBins: number;
    effectiveBins: number;
    points: Array<{
      time: number;
      timeLower: number;
      timeUpper: number;
      nObservations: number;
      observed: { q05: number; q50: number; q95: number };
      simulated: Record<"q05" | "q50" | "q95", { center: number; lower: number; upper: number }>;
    }>;
  };
  units: { time: string; concentration: string };
  provenance: {
    checkpointSha256: string;
    normalization: string;
    sourceProcess: Record<string, unknown>;
    device: "cpu";
    runtimeSeconds: number;
  };
};

export type ModelStatus = {
  ready: boolean;
  loaded: boolean;
  device: "cpu";
  checkpointId: string;
  modelId?: ModelId;
  label?: string;
  supportsDose?: boolean;
};

export type ServiceStatus = ModelStatus & {
  defaultModelId?: ModelId;
  models?: Partial<Record<ModelId, ModelStatus>>;
};

const hostedClients = new Map<string, Promise<Client>>();

function isLocalApi(apiRoot: string) {
  try {
    const hostname = new URL(apiRoot).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function hostedClient(apiRoot: string) {
  let pending = hostedClients.get(apiRoot);
  if (!pending) {
    pending = Client.connect(apiRoot).catch((error) => {
      hostedClients.delete(apiRoot);
      throw error;
    });
    hostedClients.set(apiRoot, pending);
  }
  return pending;
}

function gradioOutput<T>(data: unknown): T {
  const value = Array.isArray(data) ? data[0] : data;
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

async function hostedPrediction<T>(apiRoot: string, endpoint: string, payload: Record<string, unknown>) {
  const client = await hostedClient(apiRoot);
  const result = await client.predict<unknown>(endpoint, payload);
  return gradioOutput<T>(result.data);
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Inference cancelled", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(new DOMException("Inference cancelled", "AbortError"));
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
  });
}

export async function serviceStatus(): Promise<ServiceStatus> {
  const { apiRoot } = dashboardRuntimeConfig();
  if (!isLocalApi(apiRoot)) return hostedPrediction<ServiceStatus>(apiRoot, "/health", {});
  const response = await fetch(`${apiRoot}/health`);
  if (!response.ok) throw new Error("Pythia-PK service is unavailable");
  return response.json() as Promise<ServiceStatus>;
}

export async function runInference(request: InferenceRequest, signal?: AbortSignal): Promise<InferenceResponse> {
  const { apiRoot } = dashboardRuntimeConfig();
  if (!isLocalApi(apiRoot)) {
    return abortable(
      hostedPrediction<InferenceResponse>(apiRoot, "/inference", { payload: request }),
      signal,
    );
  }
  const response = await fetch(`${apiRoot}/inference`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  const payload = await response.json() as InferenceResponse | { error: string };
  if (!response.ok) throw new Error("error" in payload ? payload.error : `Pythia-PK inference failed (${response.status})`);
  return payload as InferenceResponse;
}
