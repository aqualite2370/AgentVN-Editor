import { Panel, useReactFlow } from "@xyflow/react";
import { Network } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";

export function CanvasArrangeButton() {
  const reactFlow = useReactFlow();
  const autoArrangeNodes = useEditorStore((state) => state.autoArrangeNodes);
  const setNotice = useEditorStore((state) => state.setNotice);

  function arrange() {
    const result = autoArrangeNodes({ scope: "all" });
    if (result.arrangedNodeIds.length === 0) {
      setNotice("没有可整理的节点。", "info");
      return;
    }
    const nodes = useEditorStore.getState().nodes;
    const focusNodeId = nodes.find((node) => node.data.nodeKind === "start")?.id ?? result.arrangedNodeIds[0];
    window.requestAnimationFrame(() => {
      void reactFlow.fitView({
        nodes: [{ id: focusNodeId }],
        padding: 0.42,
        duration: 420,
      });
    });
    setNotice(`已整理画布：移动 ${result.movedCount} 个节点。`, result.movedCount > 0 ? "success" : "info");
  }

  return (
    <Panel position="bottom-left" className="canvas-arrange-panel">
      <button type="button" data-help-key="toolbar.autoArrange" onClick={arrange}>
        <Network size={16} aria-hidden="true" />
        整理节点
      </button>
    </Panel>
  );
}
