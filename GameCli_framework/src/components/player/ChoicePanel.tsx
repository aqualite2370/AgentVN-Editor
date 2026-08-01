import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRuntimeStore } from "../../store/runtimeStore";
import type { Choice } from "../../types/commands";
import { useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { clearRuntimeAnimationSettledWithin } from "../../utils/animationResidue";
import { Button } from "../common/Button";

const choiceExitDurationMs = 180;
const choiceIntroHoldMs = 220;
const choiceIntroStaggerMs = 68;

function choiceLabel(choice: Choice, index: number): string {
  return choice.text?.trim() || choice.choice_display_name?.trim() || `选项 ${index + 1}`;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ChoicePanel() {
  const choices = useRuntimeStore((state) => state.engineState.choices);
  const choose = useRuntimeStore((state) => state.choose);
  const layout = useUILayoutStyle("player", "choice_list");
  const optionLayout = useUILayoutStyle("player", "choice_option");
  const [renderedChoices, setRenderedChoices] = useState<Choice[]>(choices);
  const [exitingChoiceId, setExitingChoiceId] = useState<string>();
  const [introReady, setIntroReady] = useState(choices.length > 0);
  const exitTimerRef = useRef<number>();
  const introTimerRef = useRef<number>();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (choices.length > 0) {
      if (!exitingChoiceId) {
        setRenderedChoices(choices);
        if (prefersReducedMotion()) {
          window.clearTimeout(introTimerRef.current);
          setIntroReady(true);
        } else {
          setIntroReady(false);
          window.clearTimeout(introTimerRef.current);
          introTimerRef.current = window.setTimeout(() => setIntroReady(true), choiceIntroHoldMs);
        }
      }
    } else if (!exitingChoiceId) {
      setRenderedChoices([]);
      setIntroReady(false);
    }
  }, [choices, exitingChoiceId]);

  useEffect(() => () => {
    window.clearTimeout(exitTimerRef.current);
    window.clearTimeout(introTimerRef.current);
  }, []);

  useEffect(() => {
    clearRuntimeAnimationSettledWithin(panelRef.current);
  }, [choices]);

  const panelStyle = useMemo(() => ({
    ...layout.style,
    "--choice-count": String(renderedChoices.length),
  }) as CSSProperties, [layout.style, renderedChoices.length]);

  function selectChoice(choiceId: string) {
    if (exitingChoiceId) return;
    if (prefersReducedMotion()) {
      window.clearTimeout(exitTimerRef.current);
      choose(choiceId);
      return;
    }
    setExitingChoiceId(choiceId);
    exitTimerRef.current = window.setTimeout(() => {
      choose(choiceId);
      setExitingChoiceId(undefined);
    }, choiceExitDurationMs);
  }

  if (renderedChoices.length === 0) return null;
  return (
    <div
      className={`choice-panel ui-layouted${exitingChoiceId ? " is-exiting" : ""}${introReady ? "" : " is-entering"}`}
      ref={panelRef}
      style={panelStyle}
      role="group"
      aria-label="剧情选项"
      data-no-advance="true"
      data-ui-frame-mode={layout.visualMode}
      data-ui-text-scale={optionLayout.textScale.choiceFontScale}
    >
      {renderedChoices.map((choice, index) => {
        const label = choiceLabel(choice, index);
        return (
          <Button
            key={choice.choice_id}
            variant="primary"
            className="choice-option"
            disabled={Boolean(exitingChoiceId) || !introReady}
            data-ui-frame-mode={optionLayout.visualMode}
            style={{
              ...optionLayout.style,
              ...(optionLayout.visualMode === "image_owned" ? { border: 0, boxShadow: "none", backgroundColor: "transparent" } : {}),
              "--choice-delay": `${choiceIntroHoldMs + (Math.min(index, 6) * choiceIntroStaggerMs)}ms`,
            } as CSSProperties}
            onClick={() => selectChoice(choice.choice_id)}
            aria-label={`选择：${label}`}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}
