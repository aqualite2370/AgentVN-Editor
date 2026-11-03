import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { UILayoutScreenId, UISkinLayout } from "../../../../shared/cartridge/uiSkin";
import {
  LIVE_PREVIEW_PROTOCOL_VERSION,
  type LivePreviewInitMessage,
  type LivePreviewPatchMessage,
  type LivePreviewRuntimeMessage,
  type LivePreviewScreen,
} from "../../../../shared/preview/livePreviewProtocol";
import { createEditorLivePreviewData } from "../../cartridge/exportCartridge";
import { useProjectStore } from "../../store/projectStore";
import { useEditorStore } from "../../store/editorStore";
import { applyProjectRuntimeSettingsToScript, exportScript } from "../../utils/exportScript";
import { manifestAssetsFromProjectAssets } from "../../utils/projectAssets";
import type { AssetRef } from "../../types/assets";
import { backendClient } from "../../api/backendClient";
import type { RenpyNavigationPage } from "../../../../shared/cartridge/renpyGui";
import "./renpy-runtime-preview.css";
import { RenpyPreviewStage } from "./RenpyPreviewStage";
import type { DialogueLayoutMode } from "../../../../shared/cartridge/dialogueModeLayout";
import { resolveGameViewport } from "../../../../shared/cartridge/gameViewport";

const previewUrl = new URL("./gamecli-preview/?preview=1&embedded=1", window.location.href);

/** A separate Runtime instance; never reuses or remounts the node preview. */
export function RenpyRuntimePreview({ draft, page, mobile, assetManifest, onPage, onSelectControl, interactive = true, fitToStage = false,
  dialogueMode, confirmationPreview = false, choicePreview = false, overlay }: {
  draft: UISkinLayout;
  page: UILayoutScreenId;
  mobile: boolean;
  assetManifest?: AssetRef[];
  onPage?: (page: RenpyNavigationPage) => void;
  onSelectControl?: (componentId: string) => void;
  interactive?: boolean;
  fitToStage?: boolean;
  dialogueMode?: Exclude<DialogueLayoutMode, "dialog">;
  confirmationPreview?: boolean;
  choicePreview?: boolean;
  overlay?: ReactNode;
}) {
  const project = useProjectStore();
  const nodes = useEditorStore((state) => state.nodes);
  const edges = useEditorStore((state) => state.edges);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const onPageRef = useRef(onPage);
  onPageRef.current = onPage;
  const pageRef = useRef(page);
  const selectionRef = useRef(onSelectControl);
  selectionRef.current = onSelectControl;
  pageRef.current = page;
  const runtimeScreenRef = useRef<LivePreviewScreen | undefined>(undefined);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(0);
  const [retry, setRetry] = useState(0);
  const [scale, setScale] = useState(1);
  const [status, setStatus] = useState("正在连接实际 Runtime…");
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [session] = useState(() => globalThis.crypto?.randomUUID?.() ?? `renpy-layout-${Date.now()}`);
  const revisionRef = useRef(0);
  const presentedContentRef = useRef<string | undefined>(undefined);
  const design = resolveGameViewport(draft.gameViewport);
  const width = mobile ? 915 : design.width;
  const height = mobile ? 412 : design.height;
  const previewAssets = assetManifest ?? project.assetManifest;

  useLayoutEffect(() => {
    if (fitToStage) return;
    const node = viewportRef.current;
    if (!node) return;
    const measure = () => setScale(Math.min(node.clientWidth / width, node.clientHeight / height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [width, height, fitToStage]);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    let ready = false;
    const contentKey = JSON.stringify({ project: project.projectId, nodes, edges, dialogueMode, choicePreview,
      appearance: project.settings.packageAppearance, styles: project.settings.characterDialogStyles,
      defaultPresentation: project.settings.defaultDialogPresentation,
      characterPresentations: project.settings.characterDialogPresentations });
    const revision = ++revisionRef.current;
    const requestId = `${session}:${revision}`;
    const identity = { protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION, sessionId: session,
      revision, requestId, runId: requestId } as const;
    setPhase("loading");
    setStatus("正在更新实际 Runtime…");
    const timeout = window.setTimeout(() => {
      if (!cancelled) { setPhase("error"); setStatus("Runtime 预览响应超时，请重试。"); }
    }, 20000);
    const receive = (event: MessageEvent<LivePreviewRuntimeMessage>) => {
      if (cancelled || event.origin !== previewUrl.origin || event.source !== frameRef.current?.contentWindow) return;
      const message = event.data;
      if (message?.protocolVersion !== identity.protocolVersion || message.sessionId !== session
        || message.revision !== revision || message.requestId !== requestId || message.runId !== requestId) return;
      if (message.type === "agentvn.live-preview.ready") {
        ready = true;
        presentedContentRef.current = contentKey;
        window.clearTimeout(timeout);
        setPhase("ready");
        setStatus("实际 Runtime 页面 · 预览存档与玩家设置独立于游戏及节点预览");
        if (confirmationPreview) frameRef.current?.contentWindow?.postMessage({
          type: "agentvn.runtime.confirmation-preview", sessionId: session, revision,
        }, previewUrl.origin);
      } else if (message.type === "agentvn.live-preview.screen-change" && ready) {
        runtimeScreenRef.current = message.screen;
        const selected = message.screen === "title_menu" ? "title"
          : message.screen === "playing" ? "player"
            : message.screen === "settings" ? "preferences"
              : message.screen;
        if (!(pageRef.current === "game_menu" && selected === "preferences")
          && selected !== pageRef.current && isRenpyNavigationPage(selected)) onPageRef.current?.(selected);
      } else if (message.type === "agentvn.live-preview.error") {
        window.clearTimeout(timeout);
        setPhase("error");
        setStatus(message.message);
      }
    };
    window.addEventListener("message", receive);
    const sync = window.setTimeout(() => {
      void (async () => {
        try {
          const current = useProjectStore.getState();
          const gameId = `${current.projectId}-renpy-layout-preview`;
          const exported = applyProjectRuntimeSettingsToScript(exportScript(nodes, edges), current.settings);
          const script = choicePreview ? {
            schema_version: "1.1.0", game_id: gameId, title: current.title,
            entry_scene_id: "layout_choice_sample", characters: [],
            scenes: [
              { scene_id: "layout_choice_sample", title: "分支外观预览", summary: "", chapter: 0, tags: [],
                commands: [{ type: "choice" as const, choices: [
                  { choice_id: "sample_choice", text: "示例分支", target_scene_id: "layout_choice_end", conditions: [] },
                ] }] },
              { scene_id: "layout_choice_end", title: "预览结果", summary: "", chapter: 0, tags: [],
                commands: [{ type: "narration" as const, text: "预览分支，不改变工程剧情。" }] },
            ],
          } : dialogueMode ? {
            schema_version: "1.1.0", game_id: gameId, title: current.title,
            entry_scene_id: "layout_mode_sample", characters: [{ character_id: "layout_sample_speaker", name: "示例角色" }],
            scenes: [{ scene_id: "layout_mode_sample", title: "模式外观预览", summary: "", chapter: 0, tags: [],
              commands: [{ type: "dialog" as const, character_id: "layout_sample_speaker", presentation_mode: dialogueMode,
                text: `${dialogueMode === "nvl" ? "NVL 累积阅读" : "气泡对白"}布局预览。仅用于查看外观，不修改工程剧情。` }] }],
          } : exported.scenes.length ? { ...exported, title: current.title, game_id: gameId } : {
            schema_version: "1.1.0", game_id: gameId, title: current.title,
            entry_scene_id: "layout_preview", characters: [],
            scenes: [{ scene_id: "layout_preview", title: "布局预览", summary: "", chapter: 0, tags: [],
              commands: [{ type: "narration" as const, text: "布局预览，不改变工程剧情。" }] }],
          };
          const data = await createEditorLivePreviewData({
            script, gameId, title: current.title, author: current.author, version: "0.1.0-layout-preview",
            language: "zh-CN", description: current.settings.packageAppearance.about?.description ?? "",
            includeGallery: true, includeMetadata: false,
            projectAssets: manifestAssetsFromProjectAssets(previewAssets),
            projectAssetRefs: previewAssets,
            // A draft preview intentionally supplies only the draft, not the saved
            // profile collection (which otherwise takes precedence over uiSkin).
            uiSkin: draft,
            packageAppearance: current.settings.packageAppearance,
            characterDialogStyles: current.settings.characterDialogStyles,
          });
          if (cancelled || revisionRef.current !== revision) return;
          const appearanceOnly = presentedContentRef.current === contentKey;
          const dataMessage: LivePreviewInitMessage = {
            type: "agentvn.live-preview.init" as const, ...identity, ...data,
            assetUrls: Object.fromEntries(previewAssets.flatMap((asset) => {
              const url = asset.metadata.data_url ?? asset.metadata.blob_url ?? asset.metadata.url;
              return url ? [[asset.asset_id, backendClient.resolveProjectAssetUrl(url)]] : [];
            })),
            screen: runtimeScreenForUILayout(pageRef.current),
            start: { requestId, target: { sceneId: data.script.entry_scene_id, commandIndex: 0 },
              entryPath: [], mode: "stable_frame", playbackRate: 1, reducedMotion: true },
          };
          const message: LivePreviewInitMessage | LivePreviewPatchMessage = appearanceOnly ? {
            type: "agentvn.live-preview.patch", ...identity, presentationOnly: true,
            manifest: dataMessage.manifest, uiSkin: dataMessage.uiSkin, assetUrls: dataMessage.assetUrls,
          } : dataMessage;
          if (!appearanceOnly) runtimeScreenRef.current = dataMessage.screen;
          frameRef.current?.contentWindow?.postMessage(message, previewUrl.origin);
        } catch (error) {
          if (cancelled) return;
          window.clearTimeout(timeout);
          setPhase("error");
          setStatus(error instanceof Error ? error.message : "Runtime 预览失败");
        }
      })();
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(sync);
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
  }, [draft, loaded, retry, session, project.projectId, nodes, edges, dialogueMode, confirmationPreview, choicePreview,
    project.assetManifest, previewAssets, project.settings.packageAppearance, project.settings.characterDialogStyles,
    project.settings.defaultDialogPresentation, project.settings.characterDialogPresentations]);

  useEffect(() => {
    if (phase !== "ready") return;
    const screen = runtimeScreenForUILayout(page);
    // A Runtime navigation also selects its authoring page. That acknowledgement
    // must not reload the cartridge or interrupt the transition already running.
    if (screen === runtimeScreenRef.current) return;
    runtimeScreenRef.current = screen;
    frameRef.current?.contentWindow?.postMessage({
      type: "agentvn.runtime.screen", screen,
    }, previewUrl.origin);
  }, [page, phase]);

  useEffect(() => {
    if (!loaded || !onSelectControl) return;
    const document = frameRef.current?.contentDocument;
    if (!document) return;
    const select = (event: MouseEvent | KeyboardEvent) => {
      if (event.type === "keydown" && (event as KeyboardEvent).key !== "Enter" && (event as KeyboardEvent).key !== " ") return;
      const origin = event.target as Element | null;
      const target = typeof origin?.closest === "function" ? origin.closest<HTMLElement>("[data-ui-component-id]") : null;
      const id = target?.dataset.uiComponentId;
      if (!id) return;
      selectionRef.current?.(id);
      event.preventDefault(); event.stopImmediatePropagation();
    };
    document.addEventListener("click", select, true);
    document.addEventListener("keydown", select, true);
    return () => {
      document.removeEventListener("click", select, true);
      document.removeEventListener("keydown", select, true);
    };
  }, [loaded, Boolean(onSelectControl)]);

  const iframe = <iframe ref={frameRef}
        title={draft.layout_type === "renpy" ? "Ren'Py（进阶）实际页面预览" : "AgentVN 实际页面预览"} src={previewUrl.href}
        inert={phase !== "ready" || !interactive}
        onLoad={() => { presentedContentRef.current = undefined; setLoaded((value) => value + 1); }}
        style={{ width, height, transform: fitToStage ? undefined : `scale(${scale})`,
          pointerEvents: interactive ? undefined : "none" }} />;
  return <>
    {fitToStage ? <RenpyPreviewStage className="renpy-editor-runtime-viewport"
      width={width} height={height} phase={phase} page={page}>{iframe}{overlay}</RenpyPreviewStage>
      : <div className="renpy-editor-runtime-viewport" ref={viewportRef}
        style={{ aspectRatio: `${width} / ${height}` }} data-preview-phase={phase} data-preview-page={page}>{iframe}</div>}
    <p role="status" className="renpy-preview-status">{page === "game_menu"
      ? `共享游戏菜单框架 · 以设置页展示 · ${status}` : status}</p>
    {phase === "error" && <button type="button" onClick={() => setRetry((value) => value + 1)}>重试页面预览</button>}
  </>;
}

function runtimeScreenForUILayout(page: UILayoutScreenId): LivePreviewScreen {
  switch (page) {
    case "title": return "title_menu";
    case "player": return "playing";
    case "game_menu": return "settings";
    case "preferences": return "settings";
    case "save_load": return "save_load";
    case "history": return "history";
    case "gallery": return "gallery";
    case "about": return "about";
    case "help": return "help";
  }
}

function isRenpyNavigationPage(page: string): page is RenpyNavigationPage {
  return ["title", "preferences", "save_load", "history", "about", "help", "gallery"].includes(page);
}
