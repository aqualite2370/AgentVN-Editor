import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Play } from "lucide-react";
import type { EditorNode } from "../../types/nodes";

export function StartNode({ data, selected }: NodeProps<EditorNode>) {
  return (
    <article className={`vn-node start-node ${selected ? "is-selected" : ""}`}>
      <header><Play size={16} /><strong>{data.label}</strong></header>
      <p>{data.description}</p>
      <Handle id="default" type="source" position={Position.Bottom} />
    </article>
  );
}
