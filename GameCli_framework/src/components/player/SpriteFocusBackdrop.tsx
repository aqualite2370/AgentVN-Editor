import type { CSSProperties } from "react";
import type { RuntimeAnimationEffect } from "../../types/settings";

type SpriteFocusStyle = CSSProperties & { "--sprite-focus-duration": string };

export function SpriteFocusBackdrop({ effect }: { effect?: RuntimeAnimationEffect }) {
  if (!effect) return null;
  const style = { "--sprite-focus-duration": `${effect.duration_ms}ms` } as SpriteFocusStyle;
  return (
    <div
      key={effect.effect_id}
      className="sprite-focus-backdrop"
      data-testid="sprite-focus-backdrop"
      data-runtime-effect-id={effect.effect_id}
      aria-hidden="true"
      style={style}
    />
  );
}
