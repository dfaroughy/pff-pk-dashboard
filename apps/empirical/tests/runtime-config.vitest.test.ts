// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { dashboardRuntimeConfig } from "../app/lib/runtime-config";

afterEach(() => { delete window.PFF_DASHBOARD_CONFIG; vi.unstubAllEnvs(); });
test.each(["synthetic/", "synthetic/index.html", "empirical/"])("keeps catalogue within deployed %s route", route => {
  vi.stubEnv("DEV", false);
  window.history.replaceState(null, "", `/pff-pk-dashboard/${route}`);
  window.PFF_DASHBOARD_CONFIG = { corpusPath: "data/corpus.json" };
  expect(new URL(dashboardRuntimeConfig().corpusUrl).pathname).toBe(`/pff-pk-dashboard/${route.split("/")[0]}/data/corpus.json`);
});

test.each(["synthetic/", "empirical/", ""])("loads Vite public catalogue from root on %s", route => {
  vi.stubEnv("DEV", true);
  window.history.replaceState(null, "", `/${route}`);
  window.PFF_DASHBOARD_CONFIG = { corpusPath: "data/corpus.json" };
  expect(new URL(dashboardRuntimeConfig().corpusUrl).pathname).toBe("/data/corpus.json");
});

test.each([true, false])("preserves explicit catalogue URLs (development=%s)", development => {
  vi.stubEnv("DEV", development);
  window.PFF_DASHBOARD_CONFIG = { corpusPath: "https://example.org/catalogue.json" };
  expect(dashboardRuntimeConfig().corpusUrl).toBe("https://example.org/catalogue.json");
});
