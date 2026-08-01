import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ArrowRightLeft } from "lucide-react";
import type { EditorNode } from "../../types/nodes";
import { performanceAnimationDisplayLabel } from "../../utils/displayNames";
import { useEditorStore } from "../../store/editorStore";

export function AnimationNode({ id, data, selected }: NodeProps<EditorNode>) {
  const migrateAnimationNode = useEditorStore((state) => state.migrateAnimationNode);
  const animationTitle = data.animation ? "演出动画" : data.label;
  const animationSummary = data.animation
    ? `播放演出 / ${performanceAnimationDisplayLabel(data.animation)} / ${data.animation.blocking ? "等待结束" : "不等待结束"}`
    : data.description;
  return (
    <article className={`vn-node animation-node ${selected ? "is-selected" : ""}`}>
      <Handle id="default" type="target" position={Position.Top} />
      <header><span className="node-kicker">旧版独立动画节点</span><strong>{animationTitle}</strong></header>
      <p>{animationSummary}</p>
      <button
        type="button"
        className="legacy-animation-convert-button"
        onClick={(event) => {
          event.stopPropagation();
          migrateAnimationNode(id);
        }}
      >
        <ArrowRightLeft size={13} /> 转为场景事件
      </button>
      <Handle id="default" type="source" position={Position.Bottom} />
    </article>
  );
}
