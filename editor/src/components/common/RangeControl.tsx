import type { CSSProperties } from "react";

interface RangeControlProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  ariaLabel: string;
  helpKey?: string;
  className?: string;
  onChange: (value: number) => void;
}

function rangeProgress(value: number, min: number, max: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return "0%";
  const progress = ((value - min) / (max - min)) * 100;
  return `${Math.max(0, Math.min(100, progress))}%`;
}

export function RangeControl({
  value,
  min,
  max,
  step = 1,
  disabled,
  ariaLabel,
  helpKey,
  className,
  onChange,
}: RangeControlProps) {
  const style = { "--range-progress": rangeProgress(value, min, max) } as CSSProperties;
  const classes = ["range-control", className ?? ""].filter(Boolean).join(" ");

  return (
    <span className={classes} style={style}>
      <input
        className="range-control-input"
        disabled={disabled}
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        data-help-key={helpKey}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </span>
  );
}
