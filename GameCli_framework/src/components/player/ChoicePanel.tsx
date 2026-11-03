import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRuntimeStore } from "../../store/runtimeStore";
import type { Choice } from "../../types/commands";
import { useResolvedUILayoutStyle, useRenpyButtonRoleStyle, useRenpyButtonStateStyle, useRuntimeUILayout, useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { getDefaultUISkinLayout } from "../../../../shared/cartridge/uiSkin";
import { createRenpyUILayout, type RuntimeLayoutType } from "../../../../shared/cartridge/uiLayoutProfiles";
import { clearRuntimeAnimationSettledWithin } from "../../utils/animationResidue";
import { Button } from "../common/Button";
import { PresentedControl } from "../../uiSkin/PresentedControl";

const choiceIntroHoldMs = 220;
const choiceIntroStaggerMs = 68;
const choiceChromeStyleKeys = [
  "backgroundColor", "backgroundImage", "borderColor", "borderWidth",
  "borderRadius", "opacity", "shadow", "backdropBlur",
] as const;

function hasChoiceChrome(style: Choice["button_style"] | undefined): boolean {
  return choiceChromeStyleKeys.some(key => style?.[key] !== undefined);
}

function hasCustomizedLayoutChrome(style: Choice["button_style"] | undefined, type: RuntimeLayoutType): boolean {
  // Compare against the active template, including image/opacity overrides.
  // Keep the legacy AgentVN fingerprint valid for saved Ren'Py profiles.
  const defaultStyle = getDefaultUISkinLayout().screens
    .find(screen => screen.screen_id === "player")
    ?.components.find(component => component.component_type === "choice_option")?.style;
  if (!defaultStyle) return false;
  if (type === "renpy") {
    const renpyStyle = createRenpyUILayout().screens.find(screen => screen.screen_id === "player")
      ?.components.find(component => component.component_type === "choice_option")?.style;
    if (renpyStyle && choiceChromeStyleKeys.every(key => style?.[key] === renpyStyle[key])) return false;
  }
  return choiceChromeStyleKeys.some(key => style?.[key] !== defaultStyle[key]);
}

function choiceLabel(choice: Choice, index: number): string {
  return choice.text?.trim() || choice.choice_display_name?.trim() || `选项 ${index + 1}`;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ChoiceOptionButton({
  choice,
  index,
  introReady,
  exitingChoiceId,
  selectedChoiceId,
  fixed,
  onSelect,
}: {
  choice: Choice;
  index: number;
  introReady: boolean;
  exitingChoiceId?: string;
  selectedChoiceId?: string;
  fixed: boolean;
  onSelect: (choiceId: string) => void;
}) {
  const optionLayout = useResolvedUILayoutStyle("player", "choice_option", choice.button_style);
  const skin = useRuntimeUILayout();
  const renpyButtonStateStyle = useRenpyButtonStateStyle();
  const roleStyle = useRenpyButtonRoleStyle("story_choice", "player");
  const hasGuiButtonImages = Object.values(skin.renpy?.shared?.buttonImages ?? {}).some(Boolean);
  const hasAuthoredChoiceBorder = choice.button_style?.borderColor !== undefined
    || choice.button_style?.borderWidth !== undefined;
  const authoredTextStyle = hasChoiceChrome(choice.button_style)
    || hasCustomizedLayoutChrome(optionLayout.component?.style, skin.layout_type ?? "agentvn");
  const usesNineSlice = Boolean(skin.layout_type === "renpy"
    && !authoredTextStyle
    && skin.renpy?.shared?.buttonBorders
    && skin.renpy.shared.buttonImages?.normal);
  const usesDefaultRenpyTextChrome = skin.layout_type === "renpy"
    && !hasGuiButtonImages
    && !skin.renpy?.shared?.buttonBorders
    && !authoredTextStyle
    && !roleStyle.styled
    && !roleStyle.bordered
    && optionLayout.visualMode !== "image_owned";
  const label = choiceLabel(choice, index);
  const assetUrls = useRuntimeStore(state => state.currentGame?.assetUrls);
  const selected = selectedChoiceId === choice.choice_id;
  const resolvedOptionStyle = { ...optionLayout.style };
  if (roleStyle.styled) {
    delete resolvedOptionStyle.backgroundColor;
    delete resolvedOptionStyle.color;
  }
  if (roleStyle.bordered && !hasAuthoredChoiceBorder) {
    delete resolvedOptionStyle.borderColor;
    delete resolvedOptionStyle.borderWidth;
  }
  return (
    <PresentedControl layout={skin} component={optionLayout.component} assetUrls={assetUrls} applyBaseStyle={false}>
    <Button
      variant="primary"
      className={`choice-option${selected ? " is-rollback-selected" : ""}${roleStyle.enabled ? " renpy-role-custom-control" : ""}`}
      disabled={Boolean(exitingChoiceId) || !introReady || (fixed && !selected)}
      aria-current={selected ? "true" : undefined}
      data-renpy-button-frame={usesNineSlice ? "nine-slice" : undefined}
      data-renpy-role-custom={roleStyle.enabled ? "true" : undefined}
      data-renpy-role-styled={roleStyle.styled ? "true" : undefined}
      data-renpy-role-bordered={roleStyle.bordered && !hasAuthoredChoiceBorder ? "true" : undefined}
      data-renpy-role-opacity={roleStyle.opacityConfigured ? "true" : undefined}
      data-renpy-role-state={exitingChoiceId || !introReady || (fixed && !selected) ? "disabled" : selected ? "selected" : "normal"}
      data-renpy-default-text-choice={usesDefaultRenpyTextChrome ? "true" : undefined}
      data-ui-frame-mode={optionLayout.visualMode}
      style={{
        ...resolvedOptionStyle,
        ...(skin.layout_type === "renpy" ? renpyButtonStateStyle : {}),
        ...(roleStyle.enabled ? roleStyle.style : {}),
        ...(optionLayout.visualMode === "image_owned"
          ? {
            border: 0, boxShadow: "none", backgroundColor: "transparent",
            // The authored option/command image owns its frame in every state.
            // Shared GUI images are inherited fallbacks, not an override.
            "--renpy-choice-authored-image": resolvedOptionStyle.backgroundImage,
          }
          : {}),
        "--choice-delay": `${choiceIntroHoldMs + (Math.min(index, 6) * choiceIntroStaggerMs)}ms`,
      } as CSSProperties}
      onClick={() => onSelect(choice.choice_id)}
      aria-label={`选择：${label}`}
    >
      {label}
    </Button>
    </PresentedControl>
  );
}

export function ChoicePanel({ embeddedNvl = false }: { embeddedNvl?: boolean }) {
  const skin = useRuntimeUILayout();
  const assetUrls = useRuntimeStore(state => state.currentGame?.assetUrls);
  const choices = useRuntimeStore((state) => state.engineState.choices);
  const choose = useRuntimeStore((state) => state.choose);
  const selectedChoiceId = useRuntimeStore((state) => state.engineState.rollbackSelectedChoiceId);
  const rollbackChoiceFixed = useRuntimeStore((state) => state.engineState.rollbackChoiceFixed);
  const layout = useUILayoutStyle("player", "choice_list");
  const optionLayout = useUILayoutStyle("player", "choice_option");
  const [renderedChoices, setRenderedChoices] = useState<Choice[]>(choices);
  const [exitingChoiceId, setExitingChoiceId] = useState<string>();
  const [introReady, setIntroReady] = useState(choices.length > 0);
  const introTimerRef = useRef<number>();
  const introducedChoicesRef = useRef<Choice[]>();
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Incoming choices must occupy their reading budget in this commit, before
  // DialogBox's layout measurement. Retain a snapshot only for selection exit.
  const visibleChoices = exitingChoiceId ? renderedChoices : choices;

  useLayoutEffect(() => {
    if (choices.length > 0) {
      if (!exitingChoiceId) {
        setRenderedChoices(choices);
        // Cancelling selection returns to these same, already introduced
        // buttons. It must not replay the initial disabled interval.
        if (introducedChoicesRef.current === choices) return;
        introducedChoicesRef.current = choices;
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
      introducedChoicesRef.current = undefined;
      setRenderedChoices([]);
      setIntroReady(false);
    }
  }, [choices, exitingChoiceId]);

  useEffect(() => () => {
    window.clearTimeout(introTimerRef.current);
  }, []);

  useLayoutEffect(() => {
    if (!exitingChoiceId) return;
    // A rollback/replacement owns the new choices; a departing presentation
    // must never submit its old choice into that newer engine state.
    if (choices !== renderedChoices) {
      setExitingChoiceId(undefined);
      return;
    }
    const panel = panelRef.current;
    const animations = panel?.getAnimations({ subtree: true }).filter(animation =>
      animation instanceof CSSAnimation
      && (animation.animationName === "choice-fade-out" || animation.animationName === "choice-fade-out-reduced")
      && animation.effect instanceof KeyframeEffect
      && animation.effect.target instanceof HTMLElement
      && animation.effect.target.matches(".choice-option")) ?? [];
    let cancelled = false;
    // CSS starts on its own rendered timeline. A nominal 180ms JS timeout
    // can remove the buttons before that timeline has actually finished.
    void Promise.all(animations.map(animation => animation.finished)).then(() => {
      if (cancelled || !panel?.isConnected) return;
      choose(exitingChoiceId);
      setExitingChoiceId(undefined);
    }, () => {
      if (!cancelled) setExitingChoiceId(undefined);
    });
    return () => { cancelled = true; };
  }, [choices, choose, exitingChoiceId, renderedChoices]);

  useEffect(() => {
    clearRuntimeAnimationSettledWithin(panelRef.current);
  }, [choices]);

  const panelStyle = useMemo(() => ({
    ...layout.style,
    "--choice-count": String(visibleChoices.length),
  }) as CSSProperties, [layout.style, visibleChoices.length]);

  function selectChoice(choiceId: string) {
    if (exitingChoiceId) return;
    setExitingChoiceId(choiceId);
  }

  if (visibleChoices.length === 0) return null;
  return (
    <PresentedControl layout={skin} component={layout.component} assetUrls={assetUrls} applyBaseStyle={false}>
    <div
      className={`choice-panel ui-layouted${embeddedNvl ? " is-nvl-choices" : ""}${exitingChoiceId ? " is-exiting" : ""}${introReady ? "" : " is-entering"}`}
      ref={panelRef}
      style={panelStyle}
      role="group"
      aria-label="剧情选项"
      data-no-advance="true"
      data-ui-frame-mode={layout.visualMode}
      data-ui-text-scale={optionLayout.textScale.choiceFontScale}
    >
      {visibleChoices.map((choice, index) => (
        <ChoiceOptionButton
          key={choice.choice_id}
          choice={choice}
          index={index}
          introReady={introReady}
          exitingChoiceId={exitingChoiceId}
          selectedChoiceId={selectedChoiceId}
          fixed={rollbackChoiceFixed}
          onSelect={selectChoice}
        />
      ))}
    </div>
    </PresentedControl>
  );
}
