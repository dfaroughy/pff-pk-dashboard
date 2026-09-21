import type { ModelId } from "./model-api";

export function modelLabel(id: ModelId | undefined): string {
  return id === "tabpfn_ts" ? "TabPFN-TS" : id === "tabpfn" ? "TabPFN" : id === "pythia_covariates" ? "Pythia_Covariates" : id === "pythia" ? "Pythia" : "Pythia-Dose";
}
