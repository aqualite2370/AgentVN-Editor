import { forwardRef, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

// Expose the real input, without fabricating React change events for steppers.
export type NumberInputChange = { target: HTMLInputElement; currentTarget: HTMLInputElement };
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "defaultValue"> & {
  value: string | number | undefined;
  onChange?: (event: NumberInputChange) => void;
  /** Empty optional fields retain inheritance/random/default semantics on blur. */
  emptyValue?: number | "";
};

export const NumberInput = forwardRef<HTMLInputElement, Props>(function NumberInput({
  value, onChange, emptyValue, min, max, step, disabled, readOnly,
  onFocus, onBlur, onKeyDown, className, ...props
}, forwardedRef) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const localUpdate = useRef(false);
  const previousValue = useRef(value);
  const focusStart = useRef(String(value ?? ""));
  const lower = min === undefined ? -Infinity : Number(min);
  const upper = max === undefined ? Infinity : Number(max);
  const current = Number(draft ?? value);

  useLayoutEffect(() => {
    // Local normalization must not erase an in-progress string. External
    // selection, undo or resource changes still replace a stale focused draft.
    if (!localUpdate.current && previousValue.current !== value) {
      setDraft(null);
      focusStart.current = String(value ?? "");
    }
    previousValue.current = value;
    localUpdate.current = false;
  });

  function publish(input: HTMLInputElement) {
    localUpdate.current = true;
    onChange?.({ target: input, currentTarget: input });
  }
  function commit(input: HTMLInputElement) {
    if (draft === null) return;
    if (input.value === "" || !Number.isFinite(input.valueAsNumber)) {
      input.value = String(emptyValue ?? (Number.isFinite(lower) ? lower : 0));
    } else input.value = String(Math.min(upper, Math.max(lower, input.valueAsNumber)));
    if (input.value !== String(value ?? "")) publish(input);
    setDraft(null);
    focusStart.current = input.value;
  }
  function adjust(direction: 1 | -1) {
    const input = inputRef.current;
    if (!input || disabled || readOnly) return;
    // The native arithmetic handles step bases and decimal precision.
    if (input.value === "") input.value = String(Number.isFinite(Number(value)) && value !== "" ? value : Number.isFinite(lower) ? lower : 0);
    if (step === "any") input.value = String(Math.min(upper, Math.max(lower, Number(input.value) + direction)));
    else if (direction === 1) input.stepUp();
    else input.stepDown();
    setDraft(input.value);
    publish(input);
    input.focus({ preventScroll: true });
  }
  const label = props["aria-label"] || props.title || "数值";
  return <span className="editor-number-control" data-disabled={disabled || readOnly || undefined}>
    <input {...props} type="number" min={min} max={max} step={step}
      disabled={disabled} readOnly={readOnly}
      ref={element => {
        inputRef.current = element;
        if (typeof forwardedRef === "function") forwardedRef(element);
        else if (forwardedRef) forwardedRef.current = element;
      }}
      className={["editor-number-input", className].filter(Boolean).join(" ")}
      value={draft ?? value ?? ""}
      onFocus={event => { focusStart.current = String(value ?? ""); onFocus?.(event); }}
      onChange={event => {
        const raw = event.currentTarget.value;
        setDraft(raw);
        // Empty/sign/decimal intermediate states never enter project data.
        if (raw !== "" && Number.isFinite(event.currentTarget.valueAsNumber)) publish(event.currentTarget);
      }}
      onBlur={event => { commit(event.currentTarget); onBlur?.(event); }}
      onKeyDown={event => {
        onKeyDown?.(event);
        if (event.defaultPrevented || disabled || readOnly) return;
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault(); adjust(event.key === "ArrowUp" ? 1 : -1);
        } else if (event.key === "Enter") {
          commit(event.currentTarget);
        } else if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation();
          event.currentTarget.value = focusStart.current;
          publish(event.currentTarget); setDraft(null);
        }
      }}
    />
    <span className="editor-number-stepper">
      <button type="button" tabIndex={-1} aria-label={`增加${label}`}
        disabled={disabled || readOnly || current >= upper}
        onMouseDown={event => event.preventDefault()} onClick={() => adjust(1)}>
        <ChevronUp size={12} aria-hidden="true" />
      </button>
      <button type="button" tabIndex={-1} aria-label={`减少${label}`}
        disabled={disabled || readOnly || current <= lower}
        onMouseDown={event => event.preventDefault()} onClick={() => adjust(-1)}>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
    </span>
  </span>;
});
