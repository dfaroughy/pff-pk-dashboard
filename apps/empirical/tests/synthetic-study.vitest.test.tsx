// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SyntheticStudyBuilder } from "../app/components/SyntheticStudyBuilder";
import {
  balanceEquation,
  eliminationArrow,
  CompartmentGraph,
  nodePosition,
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
      configuration: { graph: { p_oral: 0.65 } },
      controls: [
        {
          path: "graph.p_oral",
          label: "Probability of oral dosing",
          min: 0,
          max: 1,
          integer: false,
          default: 0.65,
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
const ready = () =>
  waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Generate new cohort",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );

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
      individuals: 10,
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
  const { from, to } = eliminationArrow(graph, graph.central, 140, 110);
  expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeCloseTo(17);
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

test("preserves seed for edited priors and bounds cohort size", async () => {
  const user = userEvent.setup();
  render(<SyntheticStudyBuilder onGenerate={vi.fn()} onInvalidate={vi.fn()} />);
  await ready();
  await user.click(screen.getByRole("button", { name: "Compartment graph" }));
  fireEvent.change(screen.getByLabelText("Probability of oral dosing"), {
    target: { value: ".9" },
  });
  fireEvent.change(screen.getByLabelText("Cohort individuals"), {
    target: { value: "99" },
  });
  fireEvent.change(screen.getByLabelText("Observations per individual"), {
    target: { value: "99" },
  });
  await user.click(screen.getByRole("button", { name: "Generate new cohort" }));
  expect(request.mock.calls[2][0]).toMatchObject({
    seed: 46,
    individuals: 16,
    observations: 20,
    overrides: { "graph.p_oral": 0.9 },
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
  await user.click(screen.getByRole("button", { name: "Generate new cohort" }));
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
  await user.click(screen.getByRole("button", { name: "Generate new cohort" }));
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
  await user.click(screen.getByRole("button", { name: "Generate new cohort" }));
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
  await user.click(screen.getByRole("button", { name: "Generate new cohort" }));
  expect(request.mock.calls.at(-1)?.[0]).toMatchObject({
    seed: 46,
    doseEvents: [
      { time: 0, amount: 1, duration: 0 },
      { time: 0.5, amount: 2.5, duration: 0 },
    ],
  });
});
