import { Clapperboard, GitBranch, Play, Plus, Repeat2, SlidersHorizontal, Square, type LucideIcon } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import type { EditorNodeKind } from "../../types/nodes";

const items: Array<{ kind: EditorNodeKind; label: string; icon: LucideIcon }> = [
  { kind: "choice", label: "选项分支节点", icon: GitBranch },
  { kind: "scene", label: "场景节点", icon: Clapperboard },
  { kind: "modifier", label: "修饰节点", icon: SlidersHorizontal },
  { kind: "condition", label: "条件节点", icon: GitBranch },
  { kind: "loop", label: "重复剧情节点", icon: Repeat2 },
  { kind: "start", label: "入口节点", icon: Play },
  { kind: "end", label: "结局节点", icon: Square },
];

export function NodePalette() {
  const createNode = useEditorStore((state) => state.createNode);
  const hasStart = useEditorStore((state) => state.nodes.some((node) => node.data.nodeKind === "start"));
  return (
    <aside className="node-palette">
      <strong>节点</strong>
      {items.map((item) => {
        const Icon = item.icon;
        const disabled = item.kind === "start" && hasStart;
        return (
          <button key={item.kind} type="button" disabled={disabled} data-help-key={`palette.${item.kind}`} onClick={() => createNode(item.kind)}>
            <Icon size={16} />
            {item.label}
            <Plus size={13} />
          </button>
        );
      })}
    </aside>
  );
}
