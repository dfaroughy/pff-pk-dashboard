import { useId, useState } from "react";

/** Keep the user's text separate from the last valid quantity used by the model. */
export function NumericEdit({ id, label, value, min, max, disabled = false, integer = false, onCommit }: {
  id?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  integer?: boolean;
  onCommit: (value: number) => void;
}) {
  const errorId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const valid = (text: string) => text.trim() !== "" && Number.isFinite(Number(text))
    && (!integer || Number.isInteger(Number(text))) && Number(text) >= min && Number(text) <= max;
  const invalid = draft !== null && !valid(draft);
  return <>
    <input id={id} aria-label={label} type="number" step={integer ? 1 : "any"}
      min={min} max={max} disabled={disabled} value={draft ?? value}
      aria-invalid={invalid} aria-describedby={invalid && touched ? errorId : undefined}
      onChange={e => {
        const text = e.target.value;
        setDraft(text);
        setTouched(false);
        if (valid(text) && Number(text) !== value) onCommit(Number(text));
      }}
      onBlur={() => {
        setTouched(true);
        if (draft !== null && valid(draft)) setDraft(null);
      }}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />
    {invalid && touched && <small id={errorId} className="field-error" role="alert">
      Enter {integer ? "a whole number" : "a number"} between {min} and {max}. Not applied.
    </small>}
  </>;
}
