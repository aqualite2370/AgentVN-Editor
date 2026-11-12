import type { PendingVisualAsset } from "../types/assets";
import { useEditorStore } from "../store/editorStore";
import { useProjectStore } from "../store/projectStore";
import { buildSceneAssetAudit } from "./assetAudit";
import {
  openWorkspaceSurface, pendingAssetLocationEventName, requestCanvasNodeFocus,
  type PendingAssetLocationRequest,
} from "../components/workspace/workspaceContracts";

let activeLocation: AbortController | undefined;

function waitFor(check: () => boolean, signal: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    let timer: number | undefined;
    const deadline = performance.now() + 5000;
    const done = (value: boolean) => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve(value);
    };
    const abort = () => done(false);
    const poll = () => {
      if (signal.aborted) { done(false); return; }
      if (check()) { done(true); return; }
      if (performance.now() >= deadline) { done(false); return; }
      timer = window.setTimeout(poll, 25);
    };
    signal.addEventListener("abort", abort, { once: true });
    poll();
  });
}

/** Navigation survives closing its source report, but never a project/scene replacement. */
export async function locatePendingAsset(item: PendingVisualAsset): Promise<boolean> {
  activeLocation?.abort();
  const controller = new AbortController();
  activeLocation = controller;
  const projectId = useProjectStore.getState().projectId;
  const node = useEditorStore.getState().nodes.find(row => row.id === item.node_id);
  const scene = node?.data.scene;
  const current = () => !controller.signal.aborted && useProjectStore.getState().projectId === projectId
    && useEditorStore.getState().nodes.find(row => row.id === node?.id)?.data.scene === scene;
  const invalidate = () => { if (!current()) controller.abort(); };
  const unsubscribeProject = useProjectStore.subscribe(invalidate);
  const unsubscribeEditor = useEditorStore.subscribe(invalidate);
  try {
    if (!node || !scene || scene.scene_id !== item.scene_id || !buildSceneAssetAudit(scene, {
      nodeId: node.id, nodeLabel: node.data.label, projectAssets: useProjectStore.getState().assetManifest,
      includeOptional: true,
    }).pending.some(issue => issue.id === item.id)) throw Error("资源检查结果已变化，请刷新报告后重新定位。");
    openWorkspaceSurface("edit");
    const ready = await waitFor(() => {
      const flow = document.querySelector(".flow-surface");
      return !!document.querySelector('[data-workspace-surface="edit"][aria-current="page"]')
        && !!flow && !flow.closest("[inert]") && !document.querySelector('[aria-modal="true"]');
    }, controller.signal);
    if (!current()) return false;
    if (!ready) throw Error("编辑页尚未就绪，请重试定位。");
    useEditorStore.getState().selectNode(node.id);
    if (!await requestCanvasNodeFocus(node.id, Math.min(1, useEditorStore.getState().viewport.zoom || .82),
      current, controller.signal)) {
      if (!current()) return false;
      throw Error("画布尚未完成定位，请重试。");
    }
    const request: PendingAssetLocationRequest = { item, isCurrent: current, handled: false };
    window.dispatchEvent(new CustomEvent(pendingAssetLocationEventName, { detail: request }));
    if (!current()) return false;
    if (!request.handled) throw Error("事件编辑器尚未就绪，请重试定位。");
    const focused = await waitFor(() => {
      if (!current()) return false;
      if (item.command_index === undefined) {
        const workbench = document.querySelector<HTMLElement>('.floating-command-workbench:not(.is-closing)');
        const control = workbench?.querySelector<HTMLElement>(
          `.workbench-type-button.is-active[data-command-type="${CSS.escape(item.command_type ?? "")}"]`);
        if (control && !control.closest("[inert]")) { control.focus({ preventScroll: true }); return document.activeElement === control; }
        return false;
      }
      const control = document.activeElement as HTMLElement | null;
      return !!control?.matches(".asset-picker-trigger")
        && control.closest<HTMLElement>("[data-asset-field]")?.dataset.assetField === item.field
        && control.closest<HTMLElement>("[data-command-index]")?.dataset.commandIndex === String(item.command_index)
        && !control.closest("[inert]");
    }, controller.signal);
    if (!current()) return false;
    if (!focused) throw Error("目标素材设置尚未获得焦点，请重试定位。");
    return true;
  } catch (error) {
    if (current()) useEditorStore.getState().setNotice({
      source: "资源定位", tone: "warning", reportable: false,
      message: error instanceof Error ? error.message : "资源定位失败，请重试。",
    });
    return false;
  } finally {
    unsubscribeProject();
    unsubscribeEditor();
    controller.abort();
    if (activeLocation === controller) activeLocation = undefined;
  }
}
