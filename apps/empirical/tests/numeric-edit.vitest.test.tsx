// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { NumericEdit } from "../app/components/NumericEdit";

afterEach(cleanup);

test.each([
  ["Individuals", 16, 2, 100, true, "50"],
  ["Observations", 20, 2, 20, true, "12"],
  ["Seed", 9877795, 0, 2 ** 31 - 1, true, "50"],
  ["Sensitivity", 100, 1, 10000, false, "50.5"],
  ["Dose", 1, 0, 100, false, "0.05"],
  ["Prior", 1, -10, 10, false, "-2.5"],
] as const)("%s supports clearing and replacement", async (label, initial, min, max, integer, replacement) => {
  const commit = vi.fn();
  function Control() {
    const [value, setValue] = useState<number>(initial);
    return <NumericEdit label={label} value={value} min={min} max={max} integer={integer}
      onCommit={next => { commit(next); setValue(next); }} />;
  }
  const user = userEvent.setup();
  render(<Control />);
  const input = screen.getByLabelText(label) as HTMLInputElement;
  await user.clear(input);
  expect(input.value).toBe("");
  expect(commit).not.toHaveBeenCalled();
  await user.type(input, replacement);
  await user.tab();
  expect(Number(input.value)).toBe(Number(replacement));
  expect(commit).toHaveBeenLastCalledWith(Number(replacement));
});

test.each(["", "1", "101", "2.5"])("invalid draft %s is retained and never committed", text => {
  const commit = vi.fn();
  render(<NumericEdit label="Count" value={16} min={2} max={100} integer onCommit={commit} />);
  const input = screen.getByLabelText("Count") as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
  expect(input.value).toBe(text);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByRole("alert").textContent).toContain("Not applied");
  expect(commit).not.toHaveBeenCalled();
});
