import { LoaderCircle } from "lucide-react";
import type { RuntimePreviewTransitionPhase } from "../../hooks/useRuntimePreviewTransition";

const phaseLabels: Record<RuntimePreviewTransitionPhase, string> = {
  ready: "",
  capturing: "正在固定当前画面",
  masked: "正在调整预览",
  changing: "正在调整预览",
  settling: "正在确认预览尺寸",
  reloading: "正在恢复真实预览",
};

export function RuntimePreviewMask({
  visible,
  snapshot,
  phase,
}: {
  visible: boolean;
  snapshot?: string;
  phase: RuntimePreviewTransitionPhase;
}) {
  return (
    <div
      className={`runtime-preview-mask${visible ? " is-visible" : ""}${snapshot ? " has-snapshot" : ""}`}
      aria-hidden={!visible}
    >
      {snapshot && <img src={snapshot} alt="" />}
      <span>
        <LoaderCircle size={15} aria-hidden="true" />
        {phaseLabels[phase]}
      </span>
    </div>
  );
}
