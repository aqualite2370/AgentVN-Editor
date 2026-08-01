import type { ButtonHTMLAttributes, ReactNode } from "react";
import { RoseTwoLoader } from "./RoseTwoLoader";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
  active?: boolean;
}

export function Button({ children, variant = "secondary", className = "", loading = false, active = false, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={`ui-button ${variant}${active ? " active" : ""}${loading ? " loading" : ""} ${className}`}
      type="button"
      aria-pressed={active || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <RoseTwoLoader className="button-spinner" particleCount={36} />}
      {children}
    </button>
  );
}
