import { useId, useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";

/** Local, keyboard-accessible help; never hides errors or authored-state badges. */
export function RenpySettingHelp({ label, children, testId }: {
  label: string; children: ReactNode; testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="renpy-setting-help" data-open={open}>
    <button type="button" className="renpy-setting-help-trigger"
      aria-label={label} aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(value => !value)}>
      <HelpCircle size={14} aria-hidden="true" /><span>帮助</span>
    </button>
    <div className="renpy-setting-help-reveal" aria-hidden={!open} inert={!open}>
      <div><div id={id} data-testid={testId} className="renpy-setting-help-content">{children}</div></div>
    </div>
  </div>;
}
