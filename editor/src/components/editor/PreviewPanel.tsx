import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import {
  applyCharacterDialogStylesToScript,
  createEditorLivePreviewData,
} from "../../cartridge/exportCartridge";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import type { RuntimeScript, Scene } from "../../../../shared/cartridge/types";
import {
  LIVE_PREVIEW_PROTOCOL_VERSION,
  type LivePreviewEditorMessage,
  type LivePreviewRuntimeMessage,
  type PreviewStartSpec,
} from "../../../../shared/preview/livePreviewProtocol";
import { applyProjectRuntimeSettingsToScript } from "../../utils/exportScript";
import { manifestAssetsFromProjectAssets } from "../../utils/projectAssets";
import {
  findPreviewEntryPaths,
  type PreviewEntryPathCandidate,
} from "../../utils/previewEntryPaths";
import type { AssetRef } from "../../types/assets";
import { RuntimePreviewMask } from "../common/RuntimePreviewMask";
import { useRuntimePreviewTransition } from "../../hooks/useRuntimePreviewTransition";

type RuntimePreviewScreen = "title_menu" | "playing" | "settings" | "save_load" | "history" | "gallery" | "about";
type PreviewStatus = "idle" | "exporting" | "replaying" | "ready" | "error";
type RoutePickerPosition = { top: number; left: number; width: number; maxHeight: number };

const runtimePreviewUrl = new URL("./gamecli-preview/?preview=1&embedded=1", window.location.href).toString();
const runtimePreviewOrigin = new URL(runtimePreviewUrl).origin;
const livePreviewDebounceMs = 150;
const livePreviewHandshakeTimeoutMs = 2500;
const livePreviewHandshakeRetryLimit = 8;
const livePreviewHandshakeBackoffMs = 10000;

const previewScreens: Array<{ id: RuntimePreviewScreen; label: string }> = [
  { id: "title_menu", label: "标题" },
  { id: "playing", label: "播放" },
  { id: "settings", label: "设置" },
  { id: "save_load", label: "存读档" },
  { id: "history", label: "历史" },
  { id: "gallery", label: "画廊" },
  { id: "about", label: "关于" },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function liveAssetUrls(assets: AssetRef[]): Record<string, string> {
  return Object.fromEntries(assets.flatMap((asset) => {
    const source = asset.metadata.data_url ?? asset.metadata.blob_url ?? asset.metadata.url;
    return source ? [[asset.asset_id, source]] : [];
  }));
}

function runtimeGraphChanges(
  current: ReturnType<typeof useEditorStore.getState>,
  previous: ReturnType<typeof useEditorStore.getState>,
): { fullScript: boolean; sceneIds: string[] } {
  if (current.edges !== previous.edges || current.nodes.length !== previous.nodes.length) {
    return { fullScript: true, sceneIds: [] };
  }
  const sceneIds = new Set<string>();
  for (let index = 0; index < current.nodes.length; index += 1) {
    const currentNode = current.nodes[index];
    const previousNode = previous.nodes[index];
    if (currentNode.id !== previousNode?.id) return { fullScript: true, sceneIds: [] };
    if (currentNode.data === previousNode.data) continue;
    if (currentNode.data.nodeKind !== "scene" || previousNode.data.nodeKind !== "scene" || !currentNode.data.scene) {
      return { fullScript: true, sceneIds: [] };
    }
    sceneIds.add(currentNode.data.scene.scene_id);
  }
  return { fullScript: false, sceneIds: [...sceneIds] };
}

function liveScene(scene: NonNullable<ReturnType<typeof useEditorStore.getState>["nodes"][number]["data"]["scene"]>): Scene {
  return {
    scene_id: scene.scene_id,
    title: scene.title,
    summary: scene.summary,
    chapter: scene.chapter,
    tags: scene.tags,
    commands: scene.commands,
    is_ending: scene.is_ending,
    ending_id: scene.ending_id,
  };
}

export function PreviewPanel({
  collapsed,
  resizing,
  onCollapsedChange,
}: {
  collapsed: boolean;
  resizing: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "opening" | "closing">("idle");
  const [activeScreen, setActiveScreen] = useState<RuntimePreviewScreen>("playing");
  const [status, setStatus] = useState<PreviewStatus>("idle");
  const [message, setMessage] = useState("展开后会连接内嵌 GameCLI 实时预览。");
  const phaseTimerRef = useRef<number | null>(null);
  const handshakeTimerRef = useRef<number | null>(null);
  const handshakeRetryRef = useRef(0);
  const initializationAttemptRef = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const reloadButtonRef = useRef<HTMLButtonElement>(null);
  const routePickerRef = useRef<HTMLDivElement>(null);
  const liveRevisionRef = useRef(0);
  const liveSessionRef = useRef(
    globalThis.crypto?.randomUUID?.() ?? `preview-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const liveRequestCounterRef = useRef(0);
  const liveRunCounterRef = useRef(0);
  const activeRunIdRef = useRef("");
  const liveInitializedRef = useRef(false);
  const liveRefreshTimerRef = useRef<number | null>(null);
  const pendingFullScriptRef = useRef(false);
  const pendingPresentationRef = useRef(false);
  const pendingSceneIdsRef = useRef(new Set<string>());
  const wasResizingRef = useRef(false);
  const activeSceneIdRef = useRef<string>();
  const replaySourceLabelRef = useRef<string>();
  const [activeSceneId, setActiveSceneId] = useState<string>();
  const [routePickerOpen, setRoutePickerOpen] = useState(false);
  const [routePickerCandidates, setRoutePickerCandidates] = useState<PreviewEntryPathCandidate[]>([]);
  const [routePickerPosition, setRoutePickerPosition] = useState<RoutePickerPosition>({
    top: 0,
    left: 0,
    width: 300,
    maxHeight: 360,
  });
  const nodes = useEditorStore((state) => state.nodes);
  const selectedNode = useEditorStore((state) => state.nodes.find((node) => node.id === state.selectedNodeId));
  const project = useProjectStore();
  const commandCount = nodes.reduce((total, node) => total + (node.data.scene?.commands.length ?? 0), 0);

  useEffect(() => () => {
    if (phaseTimerRef.current !== null) window.clearTimeout(phaseTimerRef.current);
    if (handshakeTimerRef.current !== null) window.clearTimeout(handshakeTimerRef.current);
    if (liveRefreshTimerRef.current !== null) window.clearTimeout(liveRefreshTimerRef.current);
  }, []);

  function clearPhaseTimer() {
    if (phaseTimerRef.current === null) return;
    window.clearTimeout(phaseTimerRef.current);
    phaseTimerRef.current = null;
  }

  function nextLiveRevision(): number {
    liveRevisionRef.current += 1;
    return liveRevisionRef.current;
  }

  function nextRequestId(prefix: string): string {
    liveRequestCounterRef.current += 1;
    return `${prefix}-${liveRequestCounterRef.current}`;
  }

  function nextRunId(): string {
    liveRunCounterRef.current += 1;
    const runId = `run-${liveRunCounterRef.current}`;
    activeRunIdRef.current = runId;
    return runId;
  }

  function stableSceneStart(sceneId: string, requestId: string): PreviewStartSpec {
    return {
      requestId,
      target: { sceneId },
      entryPath: [],
      mode: "stable_frame",
      playbackRate: 1,
    };
  }

  function runtimeSceneIdForNode(node: ReturnType<typeof useEditorStore.getState>["nodes"][number]): string | undefined {
    if (node.data.nodeKind === "start") return undefined;
    return node.data.scene?.scene_id ?? `${node.data.nodeKind}_${node.id}`;
  }

  function previousSceneLabel(candidate: PreviewEntryPathCandidate): string {
    const editor = useEditorStore.getState();
    const predecessorId = candidate.nodeIds[candidate.nodeIds.length - 2];
    const predecessor = editor.nodes.find((node) => node.id === predecessorId);
    return predecessor?.data.nodeKind === "start"
      ? "初始画面"
      : predecessor?.data.label || "上一个场景";
  }

  function clearHandshakeTimer() {
    if (handshakeTimerRef.current === null) return;
    window.clearTimeout(handshakeTimerRef.current);
    handshakeTimerRef.current = null;
  }

  function armHandshakeWatchdog() {
    clearHandshakeTimer();
    handshakeTimerRef.current = window.setTimeout(() => {
      handshakeTimerRef.current = null;
      if (liveInitializedRef.current || !iframeRef.current) return;
      handshakeRetryRef.current += 1;
      if (handshakeRetryRef.current > livePreviewHandshakeRetryLimit) {
        setStatus("error");
        setMessage("GameCLI 实时预览服务尚未就绪，正在后台继续重连...");
        handshakeTimerRef.current = window.setTimeout(() => {
          handshakeTimerRef.current = null;
          if (liveInitializedRef.current || !iframeRef.current) return;
          void initializeLivePreview();
        }, livePreviewHandshakeBackoffMs);
        return;
      }
      setStatus("exporting");
      setMessage(`正在重新连接 GameCLI 实时预览（${handshakeRetryRef.current}/${livePreviewHandshakeRetryLimit}）...`);
      void initializeLivePreview();
    }, livePreviewHandshakeTimeoutMs);
  }

  const postLiveMessage = useCallback((payload: LivePreviewEditorMessage) => {
    iframeRef.current?.contentWindow?.postMessage(payload, runtimePreviewOrigin);
  }, []);

  const updateRoutePickerPosition = useCallback(() => {
    const rect = reloadButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(320, Math.max(220, window.innerWidth - 24));
    const left = Math.min(
      Math.max(12, rect.right - width),
      Math.max(12, window.innerWidth - width - 12),
    );
    const estimatedHeight = Math.min(360, 72 + routePickerCandidates.length * 54);
    const availableBelow = window.innerHeight - rect.bottom - 18;
    const availableAbove = rect.top - 18;
    const openBelow = availableBelow >= Math.min(estimatedHeight, 220) || availableBelow >= availableAbove;
    const maxHeight = Math.max(120, Math.min(360, openBelow ? availableBelow : availableAbove));
    setRoutePickerPosition({
      top: openBelow ? rect.bottom + 6 : Math.max(12, rect.top - maxHeight - 6),
      left,
      width,
      maxHeight,
    });
  }, [routePickerCandidates.length]);

  function requestFreezeFrame(): string | undefined {
    if (!iframeRef.current?.contentWindow || !activeRunIdRef.current) return undefined;
    const requestId = nextRequestId("freeze");
    postLiveMessage({
      type: "agentvn.live-preview.freeze-frame.request",
      protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
      sessionId: liveSessionRef.current,
      revision: nextLiveRevision(),
      requestId,
      runId: activeRunIdRef.current,
      width: 480,
      height: 270,
    });
    return requestId;
  }

  function pauseForGeometryChange() {
    if (!activeRunIdRef.current) return;
    const requestId = nextRequestId("pause");
    postLiveMessage({
      type: "agentvn.live-preview.control",
      protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
      sessionId: liveSessionRef.current,
      revision: nextLiveRevision(),
      requestId,
      runId: activeRunIdRef.current,
      action: "pause",
    });
  }

  function resumeForGeometryChange() {
    if (!activeRunIdRef.current) return;
    const requestId = nextRequestId("resume");
    postLiveMessage({
      type: "agentvn.live-preview.control",
      protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
      sessionId: liveSessionRef.current,
      revision: nextLiveRevision(),
      requestId,
      runId: activeRunIdRef.current,
      action: "resume",
    });
  }

  function postRuntimeMessage(payload: Record<string, unknown>, transfer?: Transferable[]) {
    iframeRef.current?.contentWindow?.postMessage(payload, runtimePreviewOrigin, transfer ?? []);
  }

  function sendScreen(screen: RuntimePreviewScreen) {
    postRuntimeMessage({ type: "agentvn.runtime.screen", screen });
  }

  function selectedSceneId(): string | undefined {
    const editor = useEditorStore.getState();
    return editor.nodes.find((node) => node.id === editor.selectedNodeId)?.data.scene?.scene_id;
  }

  function currentLiveScript(): RuntimeScript {
    const editor = useEditorStore.getState();
    const currentProject = useProjectStore.getState();
    const exported = applyCharacterDialogStylesToScript(
      applyProjectRuntimeSettingsToScript(editor.exportScript() as RuntimeScript, currentProject.settings),
      currentProject.settings.characterDialogStyles,
    );
    const exportedSceneIds = new Set(exported.scenes.map((scene) => scene.scene_id));
    const draftScenes = editor.nodes.flatMap((node) => {
      const scene = node.data.scene;
      if (!scene || exportedSceneIds.has(scene.scene_id)) return [];
      return [{
        scene_id: scene.scene_id,
        title: scene.title,
        summary: scene.summary,
        chapter: scene.chapter,
        tags: scene.tags,
        commands: scene.commands,
        is_ending: scene.is_ending,
        ending_id: scene.ending_id,
      }];
    });
    return draftScenes.length > 0 ? { ...exported, scenes: [...exported.scenes, ...draftScenes] } : exported;
  }

  function liveExportInput(script: RuntimeScript) {
    const currentProject = useProjectStore.getState();
    return {
      script,
      gameId: currentProject.projectId,
      title: currentProject.title,
      author: currentProject.author,
      version: "0.1.0-live-preview",
      language: "zh-CN",
      description: currentProject.settings.packageAppearance.about?.description ?? `${currentProject.title} GameCLI 实时预览`,
      includeGallery: true,
      includeMetadata: false,
      projectAssets: manifestAssetsFromProjectAssets(currentProject.assetManifest),
      projectAssetRefs: currentProject.assetManifest,
      uiSkin: currentProject.settings.runtimeUILayout,
      packageAppearance: currentProject.settings.packageAppearance,
      characterDialogStyles: currentProject.settings.characterDialogStyles,
    };
  }

  const initializeLivePreview = useCallback(async () => {
    if (!iframeRef.current?.contentWindow) return;
    const attempt = ++initializationAttemptRef.current;
    clearHandshakeTimer();
    setStatus("exporting");
    setMessage("正在初始化实时场景预览...");
    try {
      const script = currentLiveScript();
      const currentProject = useProjectStore.getState();
      const data = await createEditorLivePreviewData(liveExportInput(script));
      if (attempt !== initializationAttemptRef.current || !iframeRef.current?.contentWindow) return;
      const requestId = nextRequestId("init");
      const runId = nextRunId();
      const sceneId = selectedSceneId() ?? data.script.entry_scene_id;
      postLiveMessage({
        type: "agentvn.live-preview.init",
        protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
        sessionId: liveSessionRef.current,
        revision: nextLiveRevision(),
        requestId,
        runId,
        manifest: data.manifest,
        script: data.script,
        uiSkin: data.uiSkin,
        assetUrls: liveAssetUrls(currentProject.assetManifest),
        start: stableSceneStart(sceneId, requestId),
        screen: activeScreen,
      });
      setMessage("实时预览数据已发送，正在等待 GameCLI 确认...");
      armHandshakeWatchdog();
    } catch (error) {
      reportFrontendError("editor.preview", error, { operation: "initialize-live-preview" });
      if (attempt !== initializationAttemptRef.current) return;
      liveInitializedRef.current = false;
      setStatus("error");
      setMessage(errorMessage(error));
    }
  }, [activeScreen, postLiveMessage]);

  const previewTransition = useRuntimePreviewTransition({
    containerRef: previewFrameRef,
    initialize: initializeLivePreview,
    requestFreezeFrame,
    pause: pauseForGeometryChange,
    resume: resumeForGeometryChange,
    active: !collapsed,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  });

  useEffect(() => {
    if (collapsed) {
      wasResizingRef.current = false;
      setRoutePickerOpen(false);
      return;
    }
    if (resizing && !wasResizingRef.current) {
      wasResizingRef.current = true;
      previewTransition.beginTransition();
    } else if (!resizing && wasResizingRef.current) {
      wasResizingRef.current = false;
      previewTransition.finishTransition();
    }
  }, [collapsed, resizing]);

  useEffect(() => {
    if (!routePickerOpen) return;
    updateRoutePickerPosition();
    const focusTimer = window.setTimeout(() => {
      routePickerRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    }, 0);
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (reloadButtonRef.current?.contains(target) || routePickerRef.current?.contains(target)) return;
      setRoutePickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setRoutePickerOpen(false);
      reloadButtonRef.current?.focus();
    };
    window.addEventListener("resize", updateRoutePickerPosition);
    window.addEventListener("scroll", updateRoutePickerPosition, true);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("resize", updateRoutePickerPosition);
      window.removeEventListener("scroll", updateRoutePickerPosition, true);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [routePickerOpen, updateRoutePickerPosition]);

  useEffect(() => {
    setRoutePickerOpen(false);
  }, [activeSceneId]);

  const scheduleLivePatch = useCallback((options: {
    includePresentation?: boolean;
    fullScript?: boolean;
    sceneIds?: string[];
  }) => {
    if (collapsed || !liveInitializedRef.current) return;
    pendingPresentationRef.current ||= options.includePresentation === true;
    pendingFullScriptRef.current ||= options.fullScript === true || options.includePresentation === true;
    options.sceneIds?.forEach((sceneId) => pendingSceneIdsRef.current.add(sceneId));
    if (liveRefreshTimerRef.current !== null) window.clearTimeout(liveRefreshTimerRef.current);
    liveRefreshTimerRef.current = window.setTimeout(() => {
      liveRefreshTimerRef.current = null;
      void (async () => {
        try {
          const includePresentation = pendingPresentationRef.current;
          const fullScript = pendingFullScriptRef.current;
          const sceneIds = [...pendingSceneIdsRef.current];
          pendingPresentationRef.current = false;
          pendingFullScriptRef.current = false;
          pendingSceneIdsRef.current.clear();
          const currentProject = useProjectStore.getState();
          const script = fullScript ? currentLiveScript() : undefined;
          const presentation = includePresentation && script
            ? await createEditorLivePreviewData(liveExportInput(script))
            : undefined;
          const editor = useEditorStore.getState();
          const scenes = !fullScript
            ? editor.nodes
              .map((node) => node.data.scene)
              .filter((scene): scene is NonNullable<typeof scene> => Boolean(scene && sceneIds.includes(scene.scene_id)))
              .map(liveScene)
            : undefined;
          const requestId = nextRequestId("patch");
          const runId = nextRunId();
          const sceneId = selectedSceneId() ?? script?.entry_scene_id;
          postLiveMessage({
            type: "agentvn.live-preview.patch",
            protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
            sessionId: liveSessionRef.current,
            revision: nextLiveRevision(),
            requestId,
            runId,
            script: presentation?.script ?? script,
            scenes,
            ...(includePresentation ? {
              manifest: presentation?.manifest,
              uiSkin: presentation?.uiSkin,
              assetUrls: liveAssetUrls(currentProject.assetManifest),
            } : {}),
            start: sceneId ? stableSceneStart(sceneId, requestId) : undefined,
          });
        } catch (error) {
          reportFrontendError("editor.preview", error, { operation: "patch-live-preview" });
          setStatus("error");
          setMessage(errorMessage(error));
        }
      })();
    }, livePreviewDebounceMs);
  }, [collapsed, postLiveMessage]);

  function replaySceneFromPath(sceneId: string, candidate?: PreviewEntryPathCandidate) {
    const script = currentLiveScript();
    const scene = script.scenes.find((item) => item.scene_id === sceneId);
    if (!scene) {
      setStatus("error");
      setMessage(`找不到当前预览场景：${sceneId}`);
      return;
    }
    if (scene.commands.length === 0) {
      setStatus("error");
      setMessage(`当前场景“${scene.title || sceneId}”没有可重放事件。`);
      return;
    }

    const requestId = nextRequestId("reload-scene");
    const runId = nextRunId();
    const sourceLabel = candidate ? previousSceneLabel(candidate) : "初始画面";
    replaySourceLabelRef.current = sourceLabel;
    setRoutePickerOpen(false);
    setActiveScreen("playing");
    sendScreen("playing");
    setStatus("replaying");
    setMessage(`正在从“${sourceLabel}”重载 ${sceneId}...`);
    postLiveMessage({
      type: "agentvn.live-preview.start",
      protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
      sessionId: liveSessionRef.current,
      revision: nextLiveRevision(),
      requestId,
      runId,
      start: {
        requestId,
        target: { sceneId, commandIndex: 0 },
        entryPath: candidate?.steps ?? [],
        mode: "play_target_event",
        playbackRate: 1,
        reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
      },
    });
  }

  function reloadCurrentScene() {
    if (!liveInitializedRef.current || status === "exporting" || status === "replaying") return;
    const editor = useEditorStore.getState();
    const sceneId = activeSceneIdRef.current ?? selectedSceneId();
    if (!sceneId) {
      setStatus("error");
      setMessage("当前没有可重载的预览场景。");
      return;
    }
    const targetNode = editor.nodes.find((node) => runtimeSceneIdForNode(node) === sceneId);
    if (!targetNode) {
      setStatus("error");
      setMessage(`无法在画布中定位当前场景：${sceneId}`);
      return;
    }
    const candidates = findPreviewEntryPaths(editor.nodes, editor.edges, targetNode.id);
    if (candidates.length === 0) {
      replaySceneFromPath(sceneId);
      return;
    }
    if (candidates.length === 1) {
      replaySceneFromPath(sceneId, candidates[0]);
      return;
    }
    setRoutePickerCandidates(candidates);
    setRoutePickerOpen(true);
  }

  const openPanel = () => {
    clearPhaseTimer();
    previewTransition.beginTransition();
    onCollapsedChange(false);
    setPhase("opening");
    phaseTimerRef.current = window.setTimeout(() => {
      setPhase("idle");
      phaseTimerRef.current = null;
      previewTransition.finishTransition();
    }, 260);
  };

  const closePanel = () => {
    clearPhaseTimer();
    previewTransition.beginTransition();
    setPhase("closing");
    phaseTimerRef.current = window.setTimeout(() => {
      onCollapsedChange(true);
      setPhase("idle");
      phaseTimerRef.current = null;
      previewTransition.completeWithoutReload();
    }, 260);
  };

  function selectScreen(screen: RuntimePreviewScreen) {
    setActiveScreen(screen);
    sendScreen(screen);
  }

  useEffect(() => {
    if (collapsed || !liveInitializedRef.current) return;
    const sceneId = selectedNode?.data.scene?.scene_id;
    if (!sceneId) return;
    const requestId = nextRequestId("scene");
    const runId = nextRunId();
    postLiveMessage({
      type: "agentvn.live-preview.start",
      protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
      sessionId: liveSessionRef.current,
      revision: nextLiveRevision(),
      requestId,
      runId,
      start: stableSceneStart(sceneId, requestId),
    });
  }, [collapsed, postLiveMessage, selectedNode?.data.scene?.scene_id]);

  useEffect(() => useEditorStore.subscribe((current, previous) => {
    const changes = runtimeGraphChanges(current, previous);
    if (changes.fullScript) {
      scheduleLivePatch({ fullScript: true });
    } else if (changes.sceneIds.length > 0) {
      scheduleLivePatch({ sceneIds: changes.sceneIds });
    }
  }), [scheduleLivePatch]);

  useEffect(() => {
    scheduleLivePatch({ fullScript: true });
  }, [project.settings.characterDialogStyles, scheduleLivePatch]);

  useEffect(() => {
    scheduleLivePatch({ includePresentation: true });
  }, [
    project.assetManifest,
    project.settings.packageAppearance,
    project.settings.runtimeUILayout,
    scheduleLivePatch,
  ]);

  useEffect(() => {
    function handleLivePreviewResponse(event: MessageEvent<LivePreviewRuntimeMessage>) {
      if (event.origin !== runtimePreviewOrigin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.protocolVersion !== LIVE_PREVIEW_PROTOCOL_VERSION) return;
      if (
        event.data.type === "agentvn.live-preview.ready"
        && event.data.revision === 0
        && event.data.sessionId === "runtime-boot"
      ) {
        liveInitializedRef.current = false;
        if (previewTransition.phase === "ready") void initializeLivePreview();
        return;
      }
      if (event.data.sessionId !== liveSessionRef.current) return;
      if (event.data.type === "agentvn.live-preview.freeze-frame.result") {
        previewTransition.acceptFreezeFrame(event.data.requestId, event.data.image);
        return;
      }
      if (event.data.revision < liveRevisionRef.current) return;
      if (event.data.type === "agentvn.live-preview.error") {
        clearHandshakeTimer();
        liveInitializedRef.current = false;
        replaySourceLabelRef.current = undefined;
        setStatus("error");
        setMessage(event.data.message);
      } else if (event.data.type === "agentvn.live-preview.ready") {
        clearHandshakeTimer();
        handshakeRetryRef.current = 0;
        liveInitializedRef.current = true;
        activeSceneIdRef.current = event.data.sceneId;
        setActiveSceneId(event.data.sceneId);
        setStatus("ready");
        const replaySourceLabel = replaySourceLabelRef.current;
        replaySourceLabelRef.current = undefined;
        setMessage(replaySourceLabel
          ? `已从“${replaySourceLabel}”重载：${event.data.sceneId ?? "当前场景"}`
          : `实时渲染：${event.data.sceneId ?? "当前场景"}`);
        sendScreen(activeScreen);
        previewTransition.markReady();
      }
    }
    window.addEventListener("message", handleLivePreviewResponse);
    return () => window.removeEventListener("message", handleLivePreviewResponse);
  }, [activeScreen, initializeLivePreview, previewTransition.phase]);

  if (collapsed) {
    return (
      <aside className="preview-panel is-collapsed">
        <button type="button" className="preview-rail-button" data-help-key="preview.openPanel" onClick={openPanel}>
          <strong>预览</strong>
          <span>{commandCount} 条</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className={`preview-panel is-expanded${phase !== "idle" ? ` is-${phase}` : ""}`}>
      <header className="embedded-runtime-preview-header">
        <div className="embedded-runtime-preview-heading">
          <strong>真实客户端预览</strong>
          <span>{project.title}</span>
        </div>
        <button type="button" className="preview-collapse-button" data-help-key="preview.closePanel" onClick={closePanel}>
          收起
        </button>
      <div className="embedded-runtime-preview-toolbar">
        {previewScreens.map((screen) => (
          <button key={screen.id} type="button" data-help-key="preview.screen" className={activeScreen === screen.id ? "is-active" : ""} onClick={() => selectScreen(screen.id)}>
            {screen.label}
          </button>
        ))}
        <button
          ref={reloadButtonRef}
          type="button"
          data-help-key="preview.reloadScene"
          className="embedded-runtime-refresh"
          disabled={status === "exporting" || status === "replaying" || !activeSceneId}
          aria-haspopup="menu"
          aria-expanded={routePickerOpen}
          onClick={reloadCurrentScene}
        >
          <RefreshCw size={14} /> 重载场景
        </button>
      </div>
      <div className={`embedded-runtime-preview-status is-${status}`} title={message}>{message}</div>
      </header>
      <div
        ref={previewFrameRef}
        className={`embedded-runtime-preview-frame is-transition-${previewTransition.phase}`}
      >
        <iframe
          ref={iframeRef}
          title="GameCLI 内嵌预览"
          src={runtimePreviewUrl}
          onLoad={() => {
            liveInitializedRef.current = false;
            if (previewTransition.phase === "ready") void initializeLivePreview();
          }}
        />
        <RuntimePreviewMask
          visible={previewTransition.maskVisible}
          snapshot={previewTransition.snapshot}
          phase={previewTransition.phase}
        />
      </div>
      {routePickerOpen && createPortal(
        <div
          ref={routePickerRef}
          className="preview-route-picker"
          role="menu"
          aria-label="选择当前场景的进入路线"
          data-toolbar-popover-keepopen="true"
          data-hover-help-suppressed="true"
          style={{
            top: routePickerPosition.top,
            left: routePickerPosition.left,
            width: routePickerPosition.width,
            maxHeight: routePickerPosition.maxHeight,
          }}
        >
          <header>
            <strong>选择进入路线</strong>
            <span>从不同的上一个场景重放当前场景过渡</span>
          </header>
          <div className="preview-route-picker-list">
            {routePickerCandidates.map((candidate, index) => {
              const sourceLabel = previousSceneLabel(candidate);
              return (
                <button
                  key={candidate.id}
                  type="button"
                  role="menuitem"
                  data-help-key="preview.reloadSceneRoute"
                  onClick={() => {
                    const sceneId = activeSceneIdRef.current;
                    if (sceneId) replaySceneFromPath(sceneId, candidate);
                  }}
                >
                  <span>路线 {index + 1} · 从“{sourceLabel}”进入</span>
                  <small>{candidate.label}</small>
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </aside>
  );
}
