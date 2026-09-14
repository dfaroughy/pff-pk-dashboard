export type DashboardRuntimeConfig = {
  apiRoot: string;
  corpusUrl: string;
};

declare global {
  interface Window {
    PFF_DASHBOARD_CONFIG?: {
      apiRoot?: string;
      corpusPath?: string;
    };
  }
}

function withoutTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

export function dashboardRuntimeConfig(): DashboardRuntimeConfig {
  const configured = typeof window === "undefined" ? undefined : window.PFF_DASHBOARD_CONFIG;
  const apiRoot = withoutTrailingSlash(configured?.apiRoot ?? "http://127.0.0.1:8791");
  const corpusPath = configured?.corpusPath ?? "/data/corpus.json";
  // Vite serves public/ at the origin root, including for SPA fallback routes.
  // Published pages instead contain a data directory under each route.
  const dashboardBase = typeof document === "undefined" ? undefined
    : import.meta.env.DEV ? new URL("/", document.baseURI) : new URL(document.baseURI);
  const corpusUrl = typeof document === "undefined"
    ? corpusPath
    : new URL(corpusPath, dashboardBase).toString();
  return { apiRoot, corpusUrl };
}
