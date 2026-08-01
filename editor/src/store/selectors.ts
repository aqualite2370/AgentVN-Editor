import { useEditorStore } from "./editorStore";

export function useSelectedNode() {
  return useEditorStore((state) => state.nodes.find((node) => node.id === state.selectedNodeId));
}

export function useSelectedScene() {
  return useSelectedNode()?.data.scene;
}
