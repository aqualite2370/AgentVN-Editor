import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { EditorNode } from "../../types/nodes";

export function EndNode({ data, selected }: NodeProps<EditorNode>) {
  return (
    <article className={`vn-node end-node ${selected ? "is-selected" : ""}`}>
      <Handle id="default" type="target" position={Position.Top} />
      <header><span className="node-kicker">结局</span><strong>{data.ending?.ending_title ?? data.label}</strong></header>
      <p>{data.ending ? "剧情在这里结束" : data.description}</p>
    </article>
  );
}
