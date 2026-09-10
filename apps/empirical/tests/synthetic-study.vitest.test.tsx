// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SyntheticStudyBuilder } from "../app/components/SyntheticStudyBuilder";
import {
  balanceEquation,
  eliminationArrow,
  CompartmentGraph,
  nodePosition,
  roleLabelPositions,
} from "../app/components/SyntheticModelView";
import {
  fluxEquation,
  graphFromResponse,
  type SyntheticResponse,
  type SyntheticVersion,
} from "../app/lib/synthetic-study";
import { syntheticRequest } from "../app/lib/model-api";

vi.mock("../app/lib/model-api", () => ({ syntheticRequest: vi.fn() }));
const request = vi.mocked(syntheticRequest);
function response(
  version: SyntheticVersion = "v6",
  seed = 46,
): SyntheticResponse {
  return {
    study: {
      id: version,
      drug: "Synthetic cohort",
      origin: version,
      administeredDrug: "compound",
      study: version,
      source: "canonical",
      route: "oral",
      dose: 1,
      doseUnit: "relative dose",
      doseEvents: [
        { time: 0, amount: 1, route: "oral", unit: "relative dose" },
      ],
      concentrationUnit: "dimensionless",
      timeUnit: "τ",
      medium: "central",
      unitClass: "dimensionless",
      subjects: [
        {
          id: "i",
          points: [
            [0.1, 1],
            [1, 0.1],
          ],
          covariates: { age_years: 45 },
        },
      ],
      summary: [],
    },
    description: {
      version,
      profileSha256: "canonical-hash",
      configuration: { graph: { n_transit_max: 4 } },
      controls: [
        {
          path: "graph.n_transit_max",
          label: "Maximum transit compartments",
          min: 0,
          max: 8,
          integer: true,
          default: 4,
        },
      ],
    },
    provenance: {
      name: version,
      seed,
      sha256: "canonical-hash",
      recordSha256: "record",
      modified: false,
      implementation_sha256: "implementation",
      resolved: { configuration: {} },
    },
    topology: {
      roles: { "0": "central", "1": "gut", "2": "peripheral" },
      edges: [
        { src: 1, dst: 0, kappa: 1, beta: null },
        { src: 2, dst: 0, kappa: 0.5, beta: null },
      ],
      elimination: [{ src: 0, node: 0, kappa: 0.1, beta: null }],
      dose_map: { 1: 1 },
    },
    population: {},
    individualTruth: {
      i: { semantic_physiology: { age_years: 45, weight_kg: 70 } },
    },
    native: null,
    covariateModel: null,
    integration: { converged: true },
  };
}
beforeEach(() =>
  request.mockImplementation(async (payload) => {
    const result = response(
      payload.version as SyntheticVersion,
      Number(payload.seed ?? 46),
    );
    return payload.action === "describe" ? result.description : result;
  }),
);
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const ready = () => waitFor(() => {
  expect(screen.getByRole("status").textContent).toBe("");
});

test.each(["v1", "v6", "v7"] as const)(
  "uses canonical %s, not a browser solver",
  async (version) => {
    const onGenerate = vi.fn();
    render(
      <SyntheticStudyBuilder
        version={version}
        onGenerate={onGenerate}
        onInvalidate={vi.fn()}
      />,
    );
    await waitFor(() => expect(onGenerate).toHaveBeenCalledOnce());
    expect(request.mock.calls[1][0]).toMatchObject({
      version,
      seed: 46,
      individuals: 16,
      schedule: "unscheduled",
      observations: 8,
    });
    expect(onGenerate.mock.calls[0][0].source).toBe("canonical");
    for (const button of screen.getAllByRole("button").filter(button => button.hasAttribute("aria-expanded"))) {
      expect(button.getAttribute("aria-expanded")).toBe("false");
    }
    expect(screen.queryByRole("img", { name: "Sampled compartment model graph" })).toBeNull();
    expect(!!screen.queryByRole("button", { name: "Patient covariates" })).toBe(
      version === "v7",
    );
  },
);
test("elimination arrows are short, avoid nodes and use their own colored heads", () => {
  const graph = graphFromResponse(response());
  const { from, to } = eliminationArrow(graph, graph.central);
  expect(to.x).toBe(from.x);
  expect(to.y - from.y).toBe(11);
  for (const node of graph.nodes.filter(n => n.id !== graph.central)) {
    const p = nodePosition(graph, node.id);
    for (let i = 0; i <= 20; i++) {
      expect(Math.hypot(from.x + (to.x - from.x) * i / 20 - p.x, from.y + (to.y - from.y) * i / 20 - p.y)).toBeGreaterThan(7);
    }
  }
  const { container } = render(<CompartmentGraph graph={graph} />);
  for (const [selector, kind] of [[".synthetic-edge.elimination", "elimination"], [".synthetic-dose-arrow", "dose"], [".synthetic-edge:not(.elimination)", "transfer"]]) {
    const line = container.querySelector(selector)!;
    const id = line.getAttribute("marker-end")!.slice(5, -1);
    expect(document.getElementById(id)?.querySelector(`path.${kind}`)).toBeTruthy();
  }
});

test("graph starts one zoom step smaller and resets to that size", () => {
  render(<CompartmentGraph graph={graphFromResponse(response())} />);
  const graph = screen.getByRole("img", { name: "Sampled compartment model graph" });
  const initialWidth = graph.style.width;
  expect((screen.getByRole("button", { name: "Zoom out compartment graph" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Zoom in compartment graph" }));
  expect(parseFloat(graph.style.width) / parseFloat(initialWidth)).toBeCloseTo(1 / 0.75);
  fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
  expect(graph.style.width).toBe(initialWidth);
});

test("automatically updates explicit seed and bounded cohort size", async () => {
  const user = userEvent.setup();
  render(<SyntheticStudyBuilder onGenerate={vi.fn()} onInvalidate={vi.fn()} />);
  await ready();
  await user.click(screen.getByRole("button", { name: "Compartment graph" }));
  fireEvent.change(screen.getByLabelText("Cohort seed"), { target: { value: "47" } });
  fireEvent.change(screen.getByLabelText("Maximum transit compartments"), {
    target: { value: "6" },
  });
  fireEvent.change(screen.getByLabelText("Cohort individuals"), {
    target: { value: "999" },
  });
  fireEvent.change(screen.getByLabelText("Observations per individual"), {
    target: { value: "99" },
  });
  await ready();
  expect(request.mock.calls.at(-1)![0]).toMatchObject({
    seed: 47,
    individuals: 100,
    observations: 20,
    overrides: {},
  });
});
test("honors explicit seed and distinguishes missing patient fields from truth", async () => {
  const user = userEvent.setup();
  render(
    <SyntheticStudyBuilder
      version="v7"
      onGenerate={vi.fn()}
      onInvalidate={vi.fn()}
    />,
  );
  await ready();
  fireEvent.change(screen.getByLabelText("Cohort seed"), {
    target: { value: "1234" },
  });
  await ready();
  expect(request.mock.calls.at(-1)?.[0].seed).toBe(1234);
  await user.click(screen.getByRole("button", { name: "Patient covariates" }));
  expect(screen.getAllByText("Missing").length).toBe(6);
  expect(screen.getByText("Latent physiology (simulation truth)")).toBeTruthy();
});
test("failed draws never fabricate a fallback or overwrite the previous cohort", async () => {
  const user = userEvent.setup();
  const onGenerate = vi.fn();
  render(
    <SyntheticStudyBuilder onGenerate={onGenerate} onInvalidate={vi.fn()} />,
  );
  await ready();
  request.mockRejectedValueOnce(new Error("Numerical acceptance failed"));
  await user.click(screen.getByRole("button", { name: "Compartment graph" }));
  await user.click(screen.getByRole("button", { name: "Sample new model" }));
  await screen.findByRole("alert");
  expect(onGenerate).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("img", { name: "Sampled compartment model graph" }),
  ).toBeTruthy();
});
test("cancels stale version requests", async () => {
  const onGenerate = vi.fn();
  let resolve: (value: unknown) => void = () => {};
  request.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const view = render(
    <SyntheticStudyBuilder
      version="v7"
      onGenerate={onGenerate}
      onInvalidate={vi.fn()}
    />,
  );
  const signal = request.mock.calls[0][1]!;
  view.unmount();
  resolve(response("v7").description);
  expect(signal.aborted).toBe(true);
  await Promise.resolve();
  expect(onGenerate).not.toHaveBeenCalled();
});
test("balances are signed sums and flux display includes modulation and gates", () => {
  const graph = graphFromResponse(response());
  expect(balanceEquation(graph, 0)).toContain("J_{ba}+J_{ca}-J_{a\\emptyset}");
  const tex = fluxEquation(
    {
      src: 0,
      dst: 1,
      beta: 2,
      hill: 1.2,
      mod_node: 2,
      mod_type: "inhibition",
      mod_k: 0.2,
      gate_lag: 0.1,
      gate_width: 0.02,
    },
    "v7",
    0,
  );
  expect(tex).toContain("\\beta");
  expect(tex).toContain("\\exp");
  expect(tex).toContain("K_{ab}+X_{c,i}");
  expect(fluxEquation({ src: 0, dst: 1 }, "v1", 0)).not.toContain("\\beta");
});
test("large transit chains remain separated", () => {
  const graph = graphFromResponse(response());
  graph.nodes = [
    { id: 0, role: "central", label: "central" },
    ...Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      role: i === 7 ? "gut" : "transit",
      label: "transit",
    })),
  ];
  const p = graph.nodes.map((n) => nodePosition(graph, n.id));
  for (let i = 1; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++)
      expect(Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y)).toBeGreaterThan(12);
});

test("kinetic edits change the displayed law and replay at the same seed", async () => {
  const user = userEvent.setup();
  render(<SyntheticStudyBuilder onGenerate={vi.fn()} onInvalidate={vi.fn()} />);
  await ready();
  await user.click(
    screen.getByRole("button", { name: "Kinetic parameters and priors" }),
  );
  await user.selectOptions(screen.getByLabelText("Flux 1 law"), "saturable");
  expect(screen.getByLabelText("Flux 1 threshold")).toBeTruthy();
  await ready();
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({
    seed: 46,
    kineticEdits: { "0": { beta: 1 } },
  });
});

test("manual dose changes survive generation", async () => {
  const user = userEvent.setup();
  render(<SyntheticStudyBuilder onGenerate={vi.fn()} onInvalidate={vi.fn()} />);
  await ready();
  await user.click(
    screen.getByRole("button", { name: "Dose and observation protocol" }),
  );
  await user.click(screen.getByRole("button", { name: "+ Add dose" }));
  const amount = screen.getByLabelText("Dose 2 amount");
  fireEvent.change(amount, { target: { value: "2.5" } });
  fireEvent.blur(amount);
  await ready();
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({
    seed: 46,
    doseEvents: [
      { time: 0, amount: 1, duration: 0 },
      { time: 0.5, amount: 2.5, duration: 0 },
    ],
  });
});



test("numeric flux edits update curves without blur, and new model clears manual edits", async () => {
  const user = userEvent.setup();
  const onGenerate = vi.fn();
  render(<SyntheticStudyBuilder onGenerate={onGenerate} onInvalidate={vi.fn()} />);
  await ready();
  expect(screen.queryByRole("button", { name: "Apply changes" })).toBeNull();
  expect(screen.getAllByRole("button", { name: "Sample new model" })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Kinetic parameters and priors" }));
  const updated = response();
  updated.study.subjects[0].points = [[0.1, 2], [1, 0.2]];
  request.mockResolvedValueOnce(updated);
  fireEvent.change(screen.getByLabelText("Flux 1 rate"), { target: { value: "2" } });
  await ready();
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ seed: 46, kineticEdits: { "0": { kappa: 2 } } });
  expect(onGenerate).toHaveBeenLastCalledWith(updated.study, undefined);
  await user.click(screen.getByRole("button", { name: "Sample new model" }));
  await ready();
  const fresh = request.mock.calls.at(-1)![0];
  expect(fresh.seed).not.toBe(46);
  expect(fresh.kineticEdits).toBeUndefined();
  expect(fresh.doseEvents).toBeUndefined();
  expect(onGenerate.mock.calls.at(-1)?.[1]).toBe(fresh.seed);
});

test("graph controls wait for their draw button and do not leak into automatic edits", async () => {
  const user = userEvent.setup();
  const onGenerate = vi.fn();
  const onInvalidate = vi.fn();
  render(<SyntheticStudyBuilder onGenerate={onGenerate} onInvalidate={onInvalidate} />);
  await ready();
  await user.click(screen.getByRole("button", { name: "Compartment graph" }));
  const control = screen.getByLabelText("Maximum transit compartments");
  expect(control.closest(".synthetic-graph-sampling")).toBeTruthy();
  expect(screen.getAllByLabelText("Maximum transit compartments")).toHaveLength(1);
  onInvalidate.mockClear();
  fireEvent.change(control, { target: { value: "6" } });
  expect(onInvalidate).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledTimes(2);
  fireEvent.change(screen.getByLabelText("Observations per individual"), { target: { value: "12" } });
  await ready();
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ seed: 46, overrides: {}, observations: 12 });
  await user.click(screen.getByRole("button", { name: "Draw new compartment model" }));
  await ready();
  expect(request.mock.calls.at(-1)?.[0].overrides).toEqual({ "graph.n_transit_max": 6 });
  const drawnSeed = request.mock.calls.at(-1)?.[0].seed;
  expect(drawnSeed).not.toBe(46);
  fireEvent.change(control, { target: { value: "7" } });
  fireEvent.change(screen.getByLabelText("Observations per individual"), { target: { value: "13" } });
  await ready();
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ seed: drawnSeed, overrides: { "graph.n_transit_max": 6 }, observations: 13 });
});

test("new edits cancel in-flight results and remain editable while computing", async () => {
  const user = userEvent.setup();
  const onGenerate = vi.fn();
  render(<SyntheticStudyBuilder onGenerate={onGenerate} onInvalidate={vi.fn()} />);
  await ready();
  await user.click(screen.getByRole("button", { name: "Kinetic parameters and priors" }));
  let finish: (value: unknown) => void = () => {};
  request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const rate = screen.getByLabelText("Flux 1 rate") as HTMLInputElement;
  fireEvent.change(rate, { target: { value: "2" } });
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  const obsoleteSignal = request.mock.calls.at(-1)![1]!;
  expect(rate.disabled).toBe(false);
  fireEvent.change(rate, { target: { value: "3" } });
  fireEvent.change(rate, { target: { value: "4" } });
  expect(obsoleteSignal.aborted).toBe(true);
  await ready();
  expect(request).toHaveBeenCalledTimes(4);
  expect(request.mock.calls.at(-1)?.[0].kineticEdits).toEqual({ "0": { kappa: 4 } });
  finish(response("v6", 999));
  await Promise.resolve();
  expect(onGenerate).toHaveBeenCalledTimes(2);
  expect(onGenerate.mock.calls.at(-1)?.[0].study).toBe("v6");
});

test("a failed automatic update preserves the plot and recovers on the next edit", async () => {
  const onGenerate = vi.fn();
  render(<SyntheticStudyBuilder onGenerate={onGenerate} onInvalidate={vi.fn()} />);
  await ready();
  request.mockRejectedValueOnce(new Error("Temporary failure"));
  fireEvent.change(screen.getByLabelText("Observations per individual"), { target: { value: "12" } });
  await screen.findByRole("alert");
  expect(onGenerate).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText("Observations per individual"), { target: { value: "13" } });
  await ready();
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ seed: 46, observations: 13 });
  expect(onGenerate).toHaveBeenCalledTimes(2);
});


test.each([0, 3, 8])("role labels avoid flux text with %i transit compartments", (transits) => {
  const graph = graphFromResponse(response());
  graph.nodes = [
    { id: 0, role: "central", label: "central" },
    { id: 1, role: "peripheral", label: "peripheral" },
    ...Array.from({ length: transits + 1 }, (_, i) => ({ id: i + 2, role: i === transits ? "gut" : "transit", label: "absorption" })),
  ];
  graph.edges = [
    { id: "ab", src: 0, dst: 1 }, { id: "ba", src: 1, dst: 0 },
    ...Array.from({ length: transits }, (_, i) => ({ id: `chain${i}`, src: i + 2, dst: i + 3 })),
    { id: "input", src: transits + 2, dst: 0 },
  ];
  graph.central = 0;
  graph.elimNodes = [0];
  graph.doseMap = { 2: 1 };
  const labels = roleLabelPositions(graph);
  const central = labels.get(0)!;
  expect(central.y).toBeLessThan(nodePosition(graph, 0).y);
  const { container } = render(<CompartmentGraph graph={graph} />);
  for (const node of graph.nodes) {
    const position = labels.get(node.id)!;
    const halfWidth = node.role.length * 0.75 + 1;
    for (const flux of container.querySelectorAll(".synthetic-flux-label")) {
      const x = Number(flux.getAttribute("x")), y = Number(flux.getAttribute("y"));
      expect(Math.abs(position.x - x) >= halfWidth + 3.25 || Math.abs(position.y - y) >= 4.6).toBe(true);
    }
  }
});


test("dose table has independent infusion durations below the timeline", async () => {
  const user = userEvent.setup();
  render(<SyntheticStudyBuilder onGenerate={vi.fn()} onInvalidate={vi.fn()} />);
  await ready();
  await user.click(screen.getByRole("button", { name: "Dose and observation protocol" }));
  const section = screen.getByRole("button", { name: "Dose and observation protocol" }).closest("section")!;
  const content = section.querySelector(".synthetic-accordion-content")! as HTMLElement;
  expect(within(content).getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["Resample grid", "+ Add dose"]);
  expect((screen.getByLabelText("Dose 1 infusion duration") as HTMLInputElement).value).toBe("0");
  await user.click(screen.getByRole("button", { name: "+ Add dose" }));
  fireEvent.change(screen.getByLabelText("Dose 2 infusion duration"), { target: { value: "0.2" } });
  await ready();
  expect(request.mock.calls.at(-1)?.[0].doseEvents).toEqual([
    { time: 0, amount: 1, duration: 0 },
    { time: .5, amount: 1, duration: .2 },
  ]);
  fireEvent.change(screen.getByLabelText("Dose 2 infusion duration"), { target: { value: "0" } });
  await ready();
  expect(request.mock.calls.at(-1)?.[0].doseEvents).toEqual([
    { time: 0, amount: 1, duration: 0 },
    { time: .5, amount: 1, duration: 0 },
  ]);
});


test("dose deletion and grid resampling preserve the model and update automatically", async () => {
  const user = userEvent.setup();
  render(<SyntheticStudyBuilder onGenerate={vi.fn()} onInvalidate={vi.fn()} />);
  await ready();
  await user.click(screen.getByRole("button", { name: "Dose and observation protocol" }));
  const timeline = screen.getByRole("img", { name: "Dimensionless dose and observation schedule timeline" });
  const doseTable = screen.getByLabelText("Dose 1 amount").closest("table")!;
  expect(timeline.compareDocumentPosition(doseTable) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByText("Reference dose events")).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove dose 1" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "+ Add dose" }));
  await user.click(screen.getByRole("button", { name: "Remove dose 2" }));
  await ready();
  expect(request.mock.calls.at(-1)?.[0].doseEvents).toEqual([{ time: 0, amount: 1, duration: 0 }]);
  await user.click(screen.getByRole("button", { name: "Resample grid" }));
  await ready();
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ seed: 46, gridSeed: 1, schedule: "unscheduled" });
});

test("shows generic observed and hidden covariates with MLP shapes and resamples only the MLP", async () => {
  request.mockImplementation(async payload => {
    const result = response("v7");
    result.study.subjects[0].covariates = { age_years: 45, cov_0: 1.25 };
    result.individualTruth.i.hidden_covariates = { cov_1: 2 };
    result.covariateModel = {
      roster: [
        { name: "cov_0", type: "continuous", observed: true },
        { name: "cov_1", type: "categorical", observed: false },
      ],
      network: {
        layers: 0, width: 8, activation: "relu", sparsity: 0.5, g_scale: 0.4, d_in: 4,
        reference_rms: [1, 1, 1, 1],
        parameters: [{ weight: Array.from({ length: 4 }, () => [1, 1, 1, 1]), bias: [0, 0, 0, 0] }],
      },
    };
    return payload.action === "describe" ? result.description : result;
  });
  const onGenerate = vi.fn();
  render(<SyntheticStudyBuilder version="v7" onGenerate={onGenerate} onInvalidate={vi.fn()} />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Generic covariates and random MLP" }));
  expect(screen.getByRole("columnheader", { name: /cov_0.*continuous · observed/ })).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: /cov_1.*categorical · hidden truth/ })).toBeTruthy();
  expect(screen.getByText("1.25")).toBeTruthy();
  expect(screen.getAllByText("1 × 4")).toHaveLength(2);
  expect(screen.getByText(/Output order: B → A, C → A, A → ∅, Central volume/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Resample MLP" }));
  await ready();
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({ seed: 46, mlpSeed: expect.any(Number) });
  expect(onGenerate.mock.calls.at(-1)?.[1]).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Sample new model" }));
  await ready();
  expect(request.mock.calls.at(-1)?.[0]).not.toHaveProperty("mlpSeed");
});
