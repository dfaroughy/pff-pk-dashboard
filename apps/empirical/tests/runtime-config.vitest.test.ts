// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { dashboardRuntimeConfig } from "../app/lib/runtime-config";

afterEach(() => { delete window.PFF_DASHBOARD_CONFIG; });
test.each(["synthetic/", "synthetic/index.html", "empirical/"])("keeps catalogue within deployed %s route", route => {
  window.history.replaceState(null, "", `/pff-pk-dashboard/${route}`);
  window.PFF_DASHBOARD_CONFIG = { corpusPath: "data/corpus.json" };
  expect(new URL(dashboardRuntimeConfig().corpusUrl).pathname).toBe(`/pff-pk-dashboard/${route.split("/")[0]}/data/corpus.json`);
});
