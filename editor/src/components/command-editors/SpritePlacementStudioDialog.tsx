import { ChevronLeft, ChevronRight, Move, RotateCcw, Scaling, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MAX_SPRITE_OFFSET_X,
  MAX_SPRITE_OFFSET_Y,
  MIN_SPRITE_OFFSET_X,
  MIN_SPRITE_OFFSET_Y,
  SPRITE_OFFSET_STEP,
  sanitizeSpriteOffsetX,
  sanitizeSpriteOffsetY,
} from "../../../../shared/cartridge/spritePlacement";
import {
  DEFAULT_SPRITE_SCALE,
  MAX_SPRITE_SCALE,
  MIN_SPRITE_SCALE,
  SPRITE_SCALE_STEP,
  sanitizeSpriteScale,
  spriteScalePercent,
} from "../../../../shared/cartridge/spriteScale";
import type { RuntimeScript, Scene } from "../../../../shared/cartridge/types";
import {
  LIVE_PREVIEW_PROTOCOL_VERSION,
  type LivePreviewRuntimeMessage,
  type PreviewStartSpec,
} from "../../../../shared/preview/livePreviewProtocol";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import {
  applyCharacterDialogStylesToScript,
  createEditorLivePreviewData,
} from "../../cartridge/exportCartridge";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import type { GameCommand, SpriteCommand } from "../../types/commands";
import type { CharacterSpriteLayoutSettings } from "../../types/project";
import { applyProjectRuntimeSettingsToScript } from "../../utils/exportScript";
import { findPreviewEntryPaths } from "../../utils/previewEntryPaths";
import { manifestAssetsFromProjectAssets } from "../../utils/projectAssets";
import { resolveSpriteScaleDisplayName } from "../../utils/spriteScaleApply";
import {
  countSpritePlacementTargets,
  resolveCharacterSpriteLayout,
  spritePlacementFromCommand,
  type SpritePlacementScope,
} from "../../utils/spritePlacementApply";
import { RangeControl } from "../common/RangeControl";
import { RichSelect, type RichSelectOption } from "../common/RichSelect";

const runtimePreviewUrl = new URL("./gamecli-preview/?preview=1&embedded=1", window.location.href).toString();
const runtimePreviewOrigin = new URL(runtimePreviewUrl).origin;
const previewDebounceMs = 120;
const standardSpritePositions = new Set(["left", "center", "right"]);
const spritePositionOptions: ReadonlyArray<RichSelectOption<string>> = [
  { value: "left", label: "左侧" },
  { value: "center", label: "居中" },
  { value: "right", label: "右侧" },
];

function liveAssetUrls(assets: ReturnType<typeof useProjectStore.getState>["assetManifest"]): Record<string, string> {
  return Object.fromEntries(assets.flatMap((asset) => {
    const source = asset.metadata.data_url ?? asset.metadata.blob_url ?? asset.metadata.url;
    return source ? [[asset.asset_id, source]] : [];
  }));
}

function matchingDialogIndices(
  commands: GameCommand[],
  characterId: string,
  displayNames: Record<string, string>,
): number[] {
  const targetName = resolveSpriteScaleDisplayName(characterId, { characterDisplayNames: displayNames });
  return commands.flatMap((command, index) => (
    command.type === "dialog"
      && resolveSpriteScaleDisplayName(command.character_id, { characterDisplayNames: displayNames }) === targetName
      ? [index]
      : []
  ));
}

function previewSceneCommands(
  commands: GameCommand[],
  commandIndex: number,
  draftCommand: SpriteCommand,
  dialogIndex?: number,
): { commands: GameCommand[]; targetIndex: number } {
  if (commandIndex >= commands.length) {
    const previewSprite: SpriteCommand = {
      ...draftCommand,
      visible: true,
      animation: null,
      animation_config: null,
      switch_transition: null,
    };
    if (dialogIndex !== undefined) {
      return {
        commands: [
          ...commands.slice(0, dialogIndex),
          previewSprite,
          ...commands.slice(dialogIndex),
        ],
        targetIndex: dialogIndex + 1,
      };
    }
    return {
      commands: [...commands, previewSprite],
      targetIndex: commands.length,
    };
  }
  const safeIndex = Math.min(Math.max(commandIndex, 0), Math.max(0, commands.length - 1));
  const patched = commands.map((command, index) => index === safeIndex ? draftCommand : command);
  const previewSprite: SpriteCommand = {
    ...draftCommand,
    visible: true,
    animation: null,
    animation_config: null,
    switch_transition: null,
  };
  if (dialogIndex === undefined) {
    if (patched.length === 0) return { commands: [previewSprite], targetIndex: 0 };
    return {
      commands: patched.map((command, index) => index === safeIndex ? previewSprite : command),
      targetIndex: safeIndex,
    };
  }
  if (safeIndex < dialogIndex && draftCommand.visible) {
    return { commands: patched, targetIndex: dialogIndex };
  }
  return {
    commands: [
      ...patched.slice(0, dialogIndex),
      previewSprite,
      ...patched.slice(dialogIndex),
    ],
    targetIndex: dialogIndex + 1,
  };
}

export function SpritePlacementStudioDialog({
  command,
  commands,
  commandIndex,
  sceneId,
  sceneTitle,
  requireScope = true,
  onApply,
  onClose,
}: {
  command: SpriteCommand;
  commands: GameCommand[];
  commandIndex: number;
  sceneId: string;
  sceneTitle?: string;
  requireScope?: boolean;
  onApply: (layout: CharacterSpriteLayoutSettings, scope: SpritePlacementScope) => void;
  onClose: () => void;
}) {
  const project = useProjectStore();
  const editorNodes = useEditorStore((state) => state.nodes);
  const editorEdges = useEditorStore((state) => state.edges);
  const defaultScale = project.settings.defaultSpriteScale ?? DEFAULT_SPRITE_SCALE;
  const characterDefault = resolveCharacterSpriteLayout(command.character_id, project.settings);
  const initialLayout = useMemo(
    () => spritePlacementFromCommand(command, characterDefault?.scale ?? defaultScale),
    [characterDefault?.scale, command, defaultScale],
  );
  const [draft, setDraft] = useState<CharacterSpriteLayoutSettings>(initialLayout);
  const dialogIndices = useMemo(
    () => matchingDialogIndices(commands, command.character_id, project.settings.characterDisplayNames),
    [command.character_id, commands, project.settings.characterDisplayNames],
  );
  const [dialogCursor, setDialogCursor] = useState(0);
  const selectedDialogIndex = dialogIndices[dialogCursor];
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scope, setScope] = useState<SpritePlacementScope>("scene");
  const [runtimeStatus, setRuntimeStatus] = useState<"connecting" | "ready" | "error">("connecting");
  const [runtimeMessage, setRuntimeMessage] = useState("正在连接预览…");
  const [selectedPathId, setSelectedPathId] = useState("");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const initializedRef = useRef(false);
  const syncTimerRef = useRef<number | null>(null);
  const revisionRef = useRef(0);
  const runRef = useRef(0);
  const sessionRef = useRef(globalThis.crypto?.randomUUID?.() ?? `sprite-placement-${Date.now()}`);
  const targetNodeId = editorNodes.find((node) => node.data.scene?.scene_id === sceneId)?.id;
  const pathCandidates = useMemo(
    () => targetNodeId ? findPreviewEntryPaths(editorNodes, editorEdges, targetNodeId) : [],
    [editorEdges, editorNodes, targetNodeId],
  );
  const selectedPath = pathCandidates.find((candidate) => candidate.id === selectedPathId) ?? pathCandidates[0];
  const draftCommand: SpriteCommand = {
    ...command,
    position: draft.position ?? command.position ?? null,
    offset_x: sanitizeSpriteOffsetX(draft.offset_x),
    offset_y: sanitizeSpriteOffsetY(draft.offset_y),
    scale: sanitizeSpriteScale(draft.scale, defaultScale),
  };
  const sceneTargetCount = countSpritePlacementTargets(
    editorNodes,
    sceneId,
    command.character_id,
    "scene",
    project.settings,
  );
  const characterTargetCount = countSpritePlacementTargets(
    editorNodes,
    sceneId,
    command.character_id,
    "character",
    project.settings,
  );
  const characterLabel = resolveSpriteScaleDisplayName(command.character_id, project.settings);

  useEffect(() => {
    if (pathCandidates.length === 1 && selectedPathId !== pathCandidates[0].id) {
      setSelectedPathId(pathCandidates[0].id);
    }
  }, [pathCandidates, selectedPathId]);

  function previewStart(requestId: string, targetIndex: number): PreviewStartSpec {
    return {
      requestId,
      target: { sceneId, commandIndex: targetIndex },
      entryPath: selectedPath?.steps ?? [],
      mode: "stable_frame",
      playbackRate: 1,
      reducedMotion: true,
    };
  }

  function editorScriptWithDraft(): { script: RuntimeScript; scene: Scene; targetIndex: number } {
    const editor = useEditorStore.getState();
    const settings = useProjectStore.getState().settings;
    const exported = applyCharacterDialogStylesToScript(
      applyProjectRuntimeSettingsToScript(editor.exportScript() as RuntimeScript, settings),
      settings.characterDialogStyles,
    );
    const preview = previewSceneCommands(commands, commandIndex, draftCommand, selectedDialogIndex);
    const existing = exported.scenes.find((scene) => scene.scene_id === sceneId);
    const scene: Scene = {
      scene_id: sceneId,
      title: existing?.title ?? sceneTitle ?? sceneId,
      summary: existing?.summary ?? "",
      chapter: existing?.chapter ?? 0,
      tags: existing?.tags ?? [],
      commands: preview.commands,
      next_scene_id: existing?.next_scene_id,
      is_ending: existing?.is_ending,
      ending_id: existing?.ending_id,
    };
    return {
      script: {
        ...exported,
        entry_scene_id: exported.entry_scene_id || sceneId,
        scenes: exported.scenes.some((item) => item.scene_id === sceneId)
          ? exported.scenes.map((item) => item.scene_id === sceneId ? scene : item)
          : [...exported.scenes, scene],
      },
      scene,
      targetIndex: preview.targetIndex,
    };
  }

  function postToRuntime(payload: Record<string, unknown>) {
    iframeRef.current?.contentWindow?.postMessage(payload, runtimePreviewOrigin);
  }

  async function initializeRuntimePreview() {
    if (!iframeRef.current?.contentWindow) return;
    setRuntimeStatus("connecting");
    setRuntimeMessage("正在连接预览…");
    try {
      const currentProject = useProjectStore.getState();
      const preview = editorScriptWithDraft();
      const data = await createEditorLivePreviewData({
        script: preview.script,
        gameId: currentProject.projectId,
        title: currentProject.title,
        author: currentProject.author,
        version: "0.1.0-sprite-placement-preview",
        language: "zh-CN",
        description: `${currentProject.title} 立绘布局预览`,
        includeGallery: false,
        includeMetadata: false,
        projectAssets: manifestAssetsFromProjectAssets(currentProject.assetManifest),
        projectAssetRefs: currentProject.assetManifest,
        uiSkin: currentProject.settings.runtimeUILayout,
        uiLayoutProfiles: currentProject.settings.runtimeUILayoutProfiles,
        packageAppearance: currentProject.settings.packageAppearance,
        characterDialogStyles: currentProject.settings.characterDialogStyles,
      });
      const requestId = `sprite-placement-init-${Date.now()}`;
      const runId = `sprite-placement-run-${++runRef.current}`;
      revisionRef.current += 1;
      postToRuntime({
        type: "agentvn.live-preview.init",
        protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
        sessionId: sessionRef.current,
        revision: revisionRef.current,
        requestId,
        runId,
        manifest: data.manifest,
        script: data.script,
        uiSkin: data.uiSkin,
        assetUrls: liveAssetUrls(currentProject.assetManifest),
        start: previewStart(requestId, preview.targetIndex),
        screen: "playing",
      });
      initializedRef.current = true;
    } catch (error) {
      reportFrontendError("editor.sprite-placement-preview", error, { operation: "initialize" });
      setRuntimeStatus("error");
      setRuntimeMessage(error instanceof Error ? error.message : "预览连接失败。");
    }
  }

  useEffect(() => {
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (confirmOpen) setConfirmOpen(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
      previousFocusRef.current?.focus();
    };
  }, [confirmOpen, onClose]);

  useEffect(() => {
    if (!initializedRef.current) return;
    if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => {
      const preview = editorScriptWithDraft();
      const requestId = `sprite-placement-patch-${Date.now()}`;
      const runId = `sprite-placement-run-${++runRef.current}`;
      revisionRef.current += 1;
      postToRuntime({
        type: "agentvn.live-preview.patch",
        protocolVersion: LIVE_PREVIEW_PROTOCOL_VERSION,
        sessionId: sessionRef.current,
        revision: revisionRef.current,
        requestId,
        runId,
        scenes: [preview.scene],
        start: previewStart(requestId, preview.targetIndex),
      });
    }, previewDebounceMs);
    return () => {
      if (syncTimerRef.current !== null) window.clearTimeout(syncTimerRef.current);
    };
  }, [draft.offset_x, draft.offset_y, draft.position, draft.scale, selectedDialogIndex, selectedPath?.id]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<LivePreviewRuntimeMessage>) => {
      if (event.origin !== runtimePreviewOrigin || event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.protocolVersion !== LIVE_PREVIEW_PROTOCOL_VERSION) return;
      if (event.data.sessionId !== sessionRef.current) return;
      if (event.data.type === "agentvn.live-preview.error") {
        setRuntimeStatus("error");
        setRuntimeMessage(event.data.message);
      }
      if (event.data.type === "agentvn.live-preview.ready") {
        setRuntimeStatus("ready");
        setRuntimeMessage("");
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [dialogCursor, dialogIndices.length]);

  function updateDraft(patch: Partial<CharacterSpriteLayoutSettings>) {
    setDraft((current) => ({
      ...current,
      ...patch,
      offset_x: sanitizeSpriteOffsetX(patch.offset_x ?? current.offset_x),
      offset_y: sanitizeSpriteOffsetY(patch.offset_y ?? current.offset_y),
      scale: sanitizeSpriteScale(patch.scale ?? current.scale, defaultScale),
    }));
  }

  function applyAndClose() {
    onApply({
      position: draft.position ?? null,
      offset_x: sanitizeSpriteOffsetX(draft.offset_x),
      offset_y: sanitizeSpriteOffsetY(draft.offset_y),
      scale: sanitizeSpriteScale(draft.scale, defaultScale),
    }, requireScope ? scope : "scene");
  }

  return createPortal(
    <div className="sprite-placement-studio-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="sprite-placement-studio-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sprite-placement-studio-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sprite-placement-studio-header">
          <div>
            <h3 id="sprite-placement-studio-title">调整 {characterLabel || "角色"} 立绘</h3>
            <p>{sceneTitle || sceneId} · {command.sprite_id || "尚未选择立绘素材"}</p>
          </div>
          <button data-help-key="editor.control" type="button" aria-label="关闭立绘位置调整" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="sprite-placement-preview-pane">
          {runtimeStatus !== "ready" && (
            <div className={`sprite-placement-runtime-status is-${runtimeStatus}`}>{runtimeMessage}</div>
          )}
          {dialogIndices.length === 0 && (
            <div className="sprite-placement-runtime-empty" role="status">
              <strong>此场景暂无 {characterLabel || "该角色"} 对白</strong>
              <span>舞台、背景和立绘仍按当前场景布局显示；添加对白后可在这里切换预览。</span>
            </div>
          )}
          {pathCandidates.length > 1 && (
            <label className="sprite-placement-path-picker">
              预览进入路径
              <RichSelect
                value={selectedPath?.id ?? ""}
                variant="compact"
                ariaLabel="预览进入路径"
                options={pathCandidates.map((candidate, index) => ({
                  value: candidate.id,
                  label: `路径 ${index + 1} · ${candidate.label}`,
                }))}
                onChange={setSelectedPathId}
              />
            </label>
          )}
          <iframe
            ref={iframeRef}
            title="立绘位置预览"
            src={runtimePreviewUrl}
            onLoad={() => {
              initializedRef.current = false;
              void initializeRuntimePreview();
            }}
          />
          <div className="sprite-placement-dialogue-switcher" aria-label="预览对白选择">
            <button data-help-key="editor.control"
              type="button"
              aria-label="上一条对白"
              disabled={dialogIndices.length < 2}
              onClick={() => setDialogCursor((current) => (current - 1 + dialogIndices.length) % dialogIndices.length)}
            >
              <ChevronLeft size={16} />
            </button>
            <RichSelect
              value={dialogIndices.length > 0 ? String(dialogCursor) : ""}
              disabled={dialogIndices.length === 0}
              variant="compact"
              ariaLabel="选择预览对白"
              options={dialogIndices.length === 0
                ? [{ value: "", label: "此角色没有对白" }]
                : dialogIndices.map((index, cursor) => {
                    const dialog = commands[index];
                    return {
                      value: String(cursor),
                      label: `第 ${cursor + 1} 条 · ${dialog.type === "dialog" ? dialog.text.slice(0, 28) : ""}`,
                    };
                  })}
              onChange={(value) => setDialogCursor(Number(value))}
            />
            <button data-help-key="editor.control"
              type="button"
              aria-label="下一条对白"
              disabled={dialogIndices.length < 2}
              onClick={() => setDialogCursor((current) => (current + 1) % dialogIndices.length)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="sprite-placement-control-pane">
          <div className="sprite-placement-anchor-row">
            <label>
              水平锚点
              <RichSelect
                value={draft.position ?? "center"}
                ariaLabel="水平锚点"
                options={[
                  ...spritePositionOptions,
                  ...(draft.position && !standardSpritePositions.has(draft.position)
                    ? [{ value: draft.position, label: draft.position }]
                    : []),
                ]}
                onChange={(position) => updateDraft({ position })}
              />
            </label>
            <div className="sprite-placement-reset-actions">
              <button data-help-key="editor.control" type="button" onClick={() => setDraft(initialLayout)}><RotateCcw size={15} /> 场景原值</button>
              <button data-help-key="editor.control" type="button" disabled={!characterDefault} onClick={() => characterDefault && setDraft(characterDefault)}>角色默认</button>
            </div>
          </div>

          <div className="sprite-placement-slider-grid">
            <label>
              <span><Move size={15} /> X 偏移 <output>{draft.offset_x.toFixed(1)}%</output></span>
              <RangeControl
                value={draft.offset_x}
                min={MIN_SPRITE_OFFSET_X}
                max={MAX_SPRITE_OFFSET_X}
                step={SPRITE_OFFSET_STEP}
                ariaLabel="立绘 X 偏移"
                helpKey="command.sprite.offsetX"
                onChange={(offset_x) => updateDraft({ offset_x })}
              />
              <input data-help-key="editor.control" type="number" min={MIN_SPRITE_OFFSET_X} max={MAX_SPRITE_OFFSET_X} step={SPRITE_OFFSET_STEP} value={draft.offset_x} onChange={(event) => updateDraft({ offset_x: Number(event.target.value) })} />
            </label>
            <label>
              <span><Move size={15} /> Y 偏移 <output>{draft.offset_y.toFixed(1)}%</output></span>
              <RangeControl
                value={draft.offset_y}
                min={MIN_SPRITE_OFFSET_Y}
                max={MAX_SPRITE_OFFSET_Y}
                step={SPRITE_OFFSET_STEP}
                ariaLabel="立绘 Y 偏移"
                helpKey="command.sprite.offsetY"
                onChange={(offset_y) => updateDraft({ offset_y })}
              />
              <input data-help-key="editor.control" type="number" min={MIN_SPRITE_OFFSET_Y} max={MAX_SPRITE_OFFSET_Y} step={SPRITE_OFFSET_STEP} value={draft.offset_y} onChange={(event) => updateDraft({ offset_y: Number(event.target.value) })} />
            </label>
            <label>
              <span><Scaling size={15} /> 等比缩放 <output>{spriteScalePercent(draft.scale)}</output></span>
              <RangeControl
                value={draft.scale}
                min={MIN_SPRITE_SCALE}
                max={MAX_SPRITE_SCALE}
                step={SPRITE_SCALE_STEP}
                ariaLabel="立绘等比缩放"
                helpKey="command.sprite.scale"
                onChange={(scale) => updateDraft({ scale })}
              />
              <input data-help-key="editor.control" type="number" min={MIN_SPRITE_SCALE} max={MAX_SPRITE_SCALE} step={SPRITE_SCALE_STEP} value={draft.scale} onChange={(event) => updateDraft({ scale: Number(event.target.value) })} />
            </label>
          </div>
        </div>

        <footer className="sprite-placement-studio-footer">
          <span>X 正值向右，Y 正值向上；取消不会修改场景。</span>
          <div>
            <button data-help-key="editor.control" type="button" onClick={onClose}>取消</button>
            <button data-help-key="editor.control" type="button" className="sprite-placement-apply" onClick={() => requireScope ? setConfirmOpen(true) : applyAndClose()}>
              应用
            </button>
          </div>
        </footer>

        {confirmOpen && (
          <div className="sprite-placement-confirm-backdrop" role="presentation" onMouseDown={() => setConfirmOpen(false)}>
            <section role="dialog" aria-modal="true" aria-labelledby="sprite-placement-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
              <h4 id="sprite-placement-confirm-title">应用 {characterLabel} 的立绘设置</h4>
              <p>位置：{draft.position || "继承"} · X {draft.offset_x.toFixed(1)}% · Y {draft.offset_y.toFixed(1)}% · {spriteScalePercent(draft.scale)}</p>
              <label className={scope === "scene" ? "is-selected" : ""}>
                <input data-help-key="editor.control" type="radio" name="sprite-placement-scope" checked={scope === "scene"} onChange={() => setScope("scene")} />
                <span><strong>应用到当前场景</strong><small>预计更新 {sceneTargetCount} 条立绘命令</small></span>
              </label>
              <label className={scope === "character" ? "is-selected" : ""}>
                <input data-help-key="editor.control" type="radio" name="sprite-placement-scope" checked={scope === "character"} onChange={() => setScope("character")} />
                <span><strong>应用到全部「{characterLabel}」立绘</strong><small>预计更新 {characterTargetCount} 条，并保存为角色默认</small></span>
              </label>
              <div>
                <button data-help-key="editor.control" type="button" onClick={() => setConfirmOpen(false)}>返回调整</button>
                <button data-help-key="editor.control" type="button" className="sprite-placement-apply" onClick={applyAndClose}>确认应用</button>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
