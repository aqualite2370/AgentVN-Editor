import { parseAssistantCreationDraftBatchValue } from "./creationAgent";
import type { AssistantCreationPendingProcess } from "./creationRecovery";
import type { AssistantCreationProcess, AssistantCreationLocalToolResult } from "../api/types";
import { addPersonalComponentToProject } from "../renpy/customComponentProject";
import { planAssistantCreationElementEditBatch } from "./assistantCreationProjectMerge";
import type { AssetRef } from "../types/assets";
import { createEditorLivePreviewData } from "../cartridge/exportCartridge";
import { manifestAssetsFromProjectAssets } from "../utils/projectAssets";
import { LIVE_PREVIEW_PROTOCOL_VERSION, type LivePreviewRuntimeMessage } from "../../../shared/preview/livePreviewProtocol";
import { backendClient } from "../api/backendClient";
import { assistantCreationDefaultRect } from "./creationPlacement";

const previewScreens = { title: "title_menu", player: "playing", game_menu: "settings", preferences: "settings",
  save_load: "save_load", history: "history", gallery: "gallery", about: "about", help: "help" } as const;

export async function executeAssistantCreationLocalTool(process: AssistantCreationProcess,
  pending: AssistantCreationPendingProcess, owns: () => boolean): Promise<AssistantCreationLocalToolResult | undefined> {
  const request = process.localToolRequest;
  if (!request || process.id !== pending.id || !owns()) return;
  const parsed = parseAssistantCreationDraftBatchValue(request.draft, new Date().toISOString(), {
    authorizedAssets: pending.authorizedAssets, authorizedTargets: pending.targets,
  });
  const count = (parsed.drafts?.length ?? 0) + (parsed.edits?.length ?? 0);
  if (!parsed.ok) return { ok: false, status: "invalid", issues: parsed.issues.slice(0, 16).map(issue => issue.slice(0, 300)), component_count: 0 };
  if (request.action === "validate_assistant_draft") return { ok: true, status: "validated", issues: [], component_count: count };
  if (request.action !== "preview_assistant_draft" || !pending.previewLayout || !pending.baseline) {
    return { ok: false, status: "unavailable", issues: ["本次没有可用的本机布局预览快照。"], component_count: count };
  }
  let layout = structuredClone(pending.previewLayout);
  let assets: AssetRef[] = structuredClone(pending.previewAssets ?? []);
  if (parsed.edits?.length) {
    const plan = planAssistantCreationElementEditBatch({ currentProjectId: pending.baseline.projectId,
      currentLayout: layout, baseline: pending.baseline, authorizedTargets: pending.targets, edits: parsed.edits });
    if (plan.status !== "ready") return { ok: false, status: "invalid", issues: [plan.reason.slice(0, 300)], component_count: count };
    layout = plan.layout;
  }
  for (const [index, draft] of (parsed.drafts ?? []).entries()) {
    const screenId = parsed.screenIds?.[index] ?? "title";
    const merged = addPersonalComponentToProject(layout, parsed.screenIds?.[index] ?? "title", draft, {
      componentId: `agent-preview-component-${index}`,
      rect: assistantCreationDefaultRect(index, parsed.drafts?.length ?? 1, screenId),
    }, assets);
    layout = merged.layout; assets = merged.assets;
  }
  const pages = [...new Set([...(parsed.screenIds ?? []), ...(parsed.edits ?? []).map(edit => edit.screenId)])];
  const diagnostics: NonNullable<AssistantCreationLocalToolResult["preview"]> = [];
  try {
    for (const page of pages) {
      if (!owns()) return;
      diagnostics.push(await renderLocalRuntimePage(layout, assets, page, owns));
    }
    if (!owns()) return;
    const ok = diagnostics.every(item => !item.missing_images && !item.overflow && !item.clipped);
    return { ok, status: ok ? "rendered" : "invalid", issues: ok ? [] : ["实际Runtime存在图片缺失、越界或内容裁切。"],
      component_count: count, preview: diagnostics };
  } catch {
    if (!owns()) return;
    return { ok: false, status: "unavailable", issues: ["本机Runtime未完成可验证渲染；没有把预览请求视为成功。"], component_count: count };
  }
}

async function renderLocalRuntimePage(layout: NonNullable<AssistantCreationPendingProcess["previewLayout"]>,
  assets: AssetRef[], page: keyof typeof previewScreens, owns: () => boolean) {
  const width = 1280; const height = 720;
  const data = await createEditorLivePreviewData({ script: { schema_version: "1.1.0", game_id: "assistant-isolated-tool",
    title: "隔离草稿预览", entry_scene_id: "preview", scenes: [{ scene_id: "preview", title: "隔离预览", summary: "",
      chapter: 0, tags: [], commands: [{ type: "narration", text: "只读草稿预览，不操作工程剧情。" }] }] },
    gameId: "assistant-isolated-tool", title: "隔离草稿预览", author: "", version: "0.1.0", language: "zh-CN",
    description: "", includeGallery: false, includeMetadata: false, uiSkin: layout,
    projectAssetRefs: assets, projectAssets: manifestAssetsFromProjectAssets(assets) });
  if (!owns()) throw new Error("Stale preview");
  const panel = document.createElement("section");
  panel.dataset.testid = "assistant-agent-runtime-tool-preview";
  panel.setAttribute("aria-label", "Agent 正在预览隔离草稿（只读）");
  panel.style.cssText = "position:absolute;right:12px;bottom:12px;width:min(900px,calc(100% - 24px));padding:12px;z-index:4;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);pointer-events:none;box-sizing:border-box";
  panel.inert = true;
  const label = document.createElement("p"); label.textContent = page === "game_menu"
    ? "Agent 共享游戏菜单预览 · 以设置页展示 · 只读隔离草稿" : "Agent 实际 Runtime 预览 · 只读隔离草稿";
  const viewport = document.createElement("div"); viewport.style.cssText = "position:relative;width:100%;aspect-ratio:16/9;overflow:hidden";
  const frame = document.createElement("iframe"); frame.title = "Agent 隔离Runtime工具预览"; frame.inert = true;
  frame.style.cssText = "position:absolute;top:0;left:0;border:0;transform-origin:top left;pointer-events:none";
  frame.width = String(width); frame.height = String(height);
  const host = document.querySelector('[data-testid="assistant-creation-workbench-window"]');
  if (!host) throw new Error("Owning workbench absent");
  viewport.append(frame); panel.append(label, viewport); host.append(panel);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = reducedMotion ? 160 : 240;
  const entrance = panel.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration, easing: "cubic-bezier(0.23,1,0.32,1)", fill: "both" });
  const observer = new ResizeObserver(() => { frame.style.transform = `scale(${viewport.clientWidth / width})`; });
  observer.observe(viewport);
  const sessionId = crypto.randomUUID();
  const identity = { protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION, sessionId, revision: 1, requestId: sessionId, runId: sessionId };
  const url = new URL("./gamecli-preview/?preview=1&embedded=1", location.href);
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => finish(new Error("Runtime tool timeout")), 20000);
      const ownership = window.setInterval(() => { if (!owns()) finish(new Error("Preview ownership changed")); }, 100);
      const finish = (error?: Error) => { clearTimeout(timeout); clearInterval(ownership); window.removeEventListener("message", receive); error ? reject(error) : resolve(); };
      const receive = (event: MessageEvent<LivePreviewRuntimeMessage>) => {
        if (event.origin !== url.origin || event.source !== frame.contentWindow) return;
        if (event.data?.type === "agentvn.live-preview.ready" && event.data.sessionId === "runtime-boot") {
          initialize();
          return;
        }
        if (event.data?.sessionId !== sessionId
          || event.data.requestId !== sessionId || event.data.runId !== sessionId || event.data.revision !== 1) return;
        if (event.data.type === "agentvn.live-preview.ready") finish();
        else if (event.data.type === "agentvn.live-preview.error") finish(new Error("Runtime reported error"));
      };
      const initialize = () => frame.contentWindow?.postMessage({ type: "agentvn.live-preview.init", ...identity, ...data,
        assetUrls: Object.fromEntries(assets.flatMap(asset => {
          const source = asset.metadata.data_url ?? asset.metadata.blob_url ?? asset.metadata.url;
          return source ? [[asset.asset_id, backendClient.resolveProjectAssetUrl(source)]] : [];
        })), screen: previewScreens[page],
        start: { requestId: sessionId, target: { sceneId: "preview", commandIndex: 0 }, entryPath: [],
          mode: "stable_frame", playbackRate: 1, reducedMotion: true } }, url.origin);
      window.addEventListener("message", receive);
      frame.src = url.href;
    });
    const doc = frame.contentDocument;
    if (!doc) throw new Error("Runtime inaccessible");
    const deadline = performance.now() + 10000;
    let settled = false;
    while (performance.now() < deadline) {
      if (!owns()) throw new Error("Stale preview");
      const visible = doc.querySelectorAll('[data-testid="runtime-custom-component"]');
      const loading = doc.querySelector('.loading-screen,.boot-overlay');
      const images = [...doc.querySelectorAll<HTMLImageElement>('[data-testid="runtime-custom-component"] img')];
      const navigationReady = doc.querySelector('[data-runtime-screen-transition]')?.getAttribute("data-runtime-screen-transition") === "idle"
        && !doc.querySelector('[data-testid="game-launch-blackout"]');
      if ((visible.length || !(layout.screens.find(screen => screen.screen_id === page)?.components.some(component => component.component_type === "custom_component")))
        && (!loading || getComputedStyle(loading).display === "none" || Number(getComputedStyle(loading).opacity) < 0.01)
        && navigationReady && images.every(image => image.complete)) { settled = true; break; }
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    if (!settled) throw new Error("Runtime did not reach a rendered final state");
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const nodes = [...doc.querySelectorAll<HTMLElement>('[data-testid="runtime-custom-component"]')];
    const images = [...doc.querySelectorAll<HTMLImageElement>('[data-testid="runtime-custom-component"] img')];
    if (!nodes.length && layout.screens.find(screen => screen.screen_id === page)?.components.some(component => component.component_type === "custom_component")) throw new Error("Runtime nodes absent");
    return { screen: page, width, height, components: nodes.length, images: images.length,
      missing_images: images.filter(image => !image.complete || !image.naturalWidth || image.dataset.assetMissing === "true").length,
      overflow: nodes.some(node => { const r = node.getBoundingClientRect(); return r.left < -1 || r.top < -1 || r.right > width + 1 || r.bottom > height + 1; }),
      clipped: nodes.some(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1) };
  } finally {
    observer.disconnect(); frame.onload = null;
    const opacity = getComputedStyle(panel).opacity;
    entrance.cancel();
    await panel.animate([{ opacity }, { opacity: 0 }], { duration: reducedMotion ? 100 : 160,
      easing: "cubic-bezier(0.23,1,0.32,1)", fill: "both" }).finished.catch(() => undefined);
    panel.remove();
  }
}
