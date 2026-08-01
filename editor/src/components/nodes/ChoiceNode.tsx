import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { EditorNode } from "../../types/nodes";
import { choiceEditorDisplayText, isChoiceTextPlaceholder } from "../../utils/choiceText";

export function ChoiceNode({ data, selected }: NodeProps<EditorNode>) {
  const choices = data.choice?.choices ?? [];
  return (
    <article className={`vn-node choice-node ${selected ? "is-selected" : ""}`}>
      <Handle id="default" type="target" position={Position.Top} />
      <header>
        <span className="node-kicker">选项</span>
        <strong>{data.label}</strong>
      </header>
      <p>{data.description}</p>
      <div className="node-preview">
        {choices.length > 0 ? choices.map((choice) => (
          <span key={choice.choice_id} className={isChoiceTextPlaceholder(choice) ? "is-placeholder" : undefined}>{choiceEditorDisplayText(choice)}</span>
        )) : <span>未设置选项</span>}
      </div>
      {choices.map((choice, index) => {
        const left = choices.length === 1 ? 50 : 18 + (64 * index) / Math.max(1, choices.length - 1);
        return (
          <Handle
            key={choice.choice_id}
            id={choice.choice_id}
            type="source"
            position={Position.Bottom}
            style={{ left: `${left}%` }}
          />
        );
      })}
    </article>
  );
}
