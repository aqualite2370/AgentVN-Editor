import { useState } from "react";
import { backendClient } from "../../api/backendClient";
import { hydrateEditorFromSharedState } from "../../app/projectHydration";
import { exportEditorCartridge, exportEditorPreviewDirectory } from "../../cartridge/exportCartridge";
import { closeGameCliPreview, isMissingDirectoryPreviewSupport, isTauriRuntime, openGameCliPreview, openGameCliPreviewDirectory } from "../../preview/previewWindow";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import { applyProjectRuntimeSettingsToScript, validateExportScript } from "../../utils/exportScript";
import { manifestAssetsFromProjectAssets } from "../../utils/projectAssets";
import type { RuntimeScript } from "../../../../shared/cartridge/types";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

type PreviewProgressTone = "idle" | "running" | "success" | "error";

interface PreviewProgressState {
  percent: number;
  label: string;
  detail: string;
  tone: PreviewProgressTone;
}

interface PreviewLogEntry {
  id: string;
  time: string;
  tone: Exclude<PreviewProgressTone, "idle"> | "info";
  message: string;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function previewLogTime(): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const LEGACY_GAMECLI_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;

export function PreviewWindowControls() {
  const exportScript = useEditorStore((state) => state.exportScript);
  const nodes = useEditorStore((state) => state.nodes);
  const edges = useEditorStore((state) => state.edges);
  const selectedNode = useEditorStore((state) => state.nodes.find((node) => node.id === state.selectedNodeId));
  const setNotice = useEditorStore((state) => state.setNotice);
  const project = useProjectStore();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [progress, setProgress] = useState<PreviewProgressState>({
    percent: 0,
    label: "等待预览",
    detail: "",
    tone: "idle",
  });
  const [logs, setLogs] = useState<PreviewLogEntry[]>([]);

  const script = {
    ...applyProjectRuntimeSettingsToScript(exportScript() as RuntimeScript, project.settings),
    game_id: project.projectId,
    title: project.title,
  };
  const previewScript: RuntimeScript = selectedNode?.data.scene?.scene_id
    ? { ...script, entry_scene_id: selectedNode.data.scene.scene_id }
    : script;

  function addLog(nextMessage: string, tone: PreviewLogEntry["tone"] = "info") {
    setLogs((current) => [
      ...current.slice(-79),
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        time: previewLogTime(),
        tone,
        message: nextMessage,
      },
    ]);
  }

  function updateProgress(percent: number, label: string, detail: string, tone: PreviewProgressTone = "running") {
    setProgress({ percent: clampProgress(percent), label, detail, tone });
  }

  async function reloadProjectFromBackend() {
    setBusy(true);
    setMessage("正在从后端重新加载当前工程...");
    setLogs([]);
    updateProgress(12, "重新加载工程", "正在请求 /api/project/state。");
    addLog("开始从后端重新加载当前工程。");
    try {
      const sharedState = await backendClient.loadProjectState();
      if (!sharedState) throw new Error("后端没有可加载的工程状态。");
      updateProgress(58, "解析工程", "后端已返回工程状态，正在应用到编辑器。");
      addLog("后端工程状态已返回。");

      const draft = hydrateEditorFromSharedState(sharedState);
      if (!draft) throw new Error("后端工程状态没有可导入的节点。");
      const text = `已从后端重载工程：${draft.title}`;
      setMessage(text);
      updateProgress(100, "重载完成", `已加载 ${draft.nodes.length} 个节点、${draft.edges.length} 条连线。`, "success");
      addLog(text, "success");
      setNotice({
        tone: "success",
        message: text,
        source: "GameCLI Preview",
        action: "现在点击 GameCLI 预览会从这份新内存状态导出卡带。",
        context: { projectId: draft.project_id, nodeCount: draft.nodes.length, edgeCount: draft.edges.length },
      });
    } catch (error) {
      reportFrontendError("editor.preview", error, { operation: "reload-project" });
      const detail = errorText(error, "从后端重载工程失败。");
      setMessage(detail);
      updateProgress(progress.percent, "重载失败", detail, "error");
      addLog(detail, "error");
      setNotice({
        tone: "error",
        message: "从后端重载工程失败",
        source: "GameCLI Preview",
        detail,
        error,
        action: "确认后端服务正在运行，并且 /api/project/state 已写入目标工程。",
      });
    } finally {
      setBusy(false);
    }
  }

  async function syncPreview() {
    setBusy(true);
    setMessage("正在生成临时预览卡带...");
    setLogs([]);
    updateProgress(4, "准备预览", "正在读取当前编辑器内存状态。");
    addLog("开始生成 GameCLI 预览。");
    try {
      updateProgress(10, "校验剧本", "正在检查入口、场景连线和导出结构。");
      addLog("正在校验导出剧本。");
      const issues = validateExportScript(previewScript, { nodes, edges });
      const errors = issues.filter((issue) => issue.severity !== "warning");
      const warnings = issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message);
      if (errors.length > 0) {
        const detail = errors.map((issue) => issue.message).join("\n");
        const text = `预览失败：${detail}`;
        setMessage(text);
        updateProgress(10, "校验失败", detail, "error");
        addLog(`校验失败：${detail}`, "error");
        setNotice({
          tone: "error",
          message: "GameCLI 预览前校验失败",
          source: "GameCLI Preview",
          detail,
          action: "先修复导出校验错误，再重新启动 GameCLI 调试预览。",
          context: { warnings, issueCount: issues.length, selectedNodeId: selectedNode?.id },
        });
        return;
      }

      updateProgress(24, "收集素材", `正在整理 ${project.assetManifest.length} 个素材引用。`);
      addLog(`校验通过，发现 ${warnings.length} 条警告，准备整理素材清单。`, warnings.length > 0 ? "info" : "success");
      const manifestAssets = manifestAssetsFromProjectAssets(project.assetManifest);
      updateProgress(34, "生成预览清单", `正在整理 ${manifestAssets.length} 个运行时素材。`);
      addLog(`运行时素材清单：${manifestAssets.length} 个。`);

      const exportInput = {
        script: previewScript,
        title: project.title,
        author: project.author,
        version: "0.1.0-preview",
        language: "zh-CN",
        description: project.settings.packageAppearance.about?.description ?? `${project.title} GameCLI 预览`,
        includeGallery: true,
        includeMetadata: true,
        projectAssets: manifestAssets,
        projectAssetRefs: project.assetManifest,
        uiSkin: project.settings.runtimeUILayout,
        packageAppearance: project.settings.packageAppearance,
        characterDialogStyles: project.settings.characterDialogStyles,
      };

      if (isTauriRuntime()) {
        try {
          const previewDirectory = await exportEditorPreviewDirectory(exportInput);
          const estimatedSize = previewDirectory.textFiles.reduce((total, file) => total + new TextEncoder().encode(file.contents).byteLength, 0)
            + previewDirectory.assets.reduce((total, asset) => total + (asset.expectedSize ?? asset.data?.byteLength ?? 0), 0);
          updateProgress(52, "同步素材", `正在同步 ${previewDirectory.assets.length} 个素材，预计 ${formatBytes(estimatedSize)}。`);
          addLog(`快速目录预览清单已生成：${previewDirectory.textFiles.length} 个 JSON 文件，${previewDirectory.assets.length} 个素材。`, "success");
          const result = await openGameCliPreviewDirectory({
            fileName: previewDirectory.fileName,
            textFiles: previewDirectory.textFiles,
            assets: previewDirectory.assets,
            onProgress: (event) => {
              const mappedPercent = event.phase === "launch"
                ? 94 + (((event.percent ?? 0) / 100) * 6)
                : event.phase === "validate"
                  ? 84 + (((event.percent ?? 0) / 100) * 10)
                  : 44 + (((event.percent ?? 0) / 100) * 38);
              updateProgress(mappedPercent, event.phase === "launch" ? "启动 GameCLI" : event.phase === "validate" ? "生成校验清单" : "同步素材", event.message);
              addLog(event.message);
            },
          });
          setMessage(warnings.length > 0 ? `${result.message}\n${warnings.join("\n")}` : result.message);
          updateProgress(100, "预览已启动", result.message, "success");
          addLog(result.message, "success");
          return;
        } catch (error) {
          if (!isMissingDirectoryPreviewSupport(error)) throw error;
          reportFrontendError("editor.preview", error, {
            operation: "directory-preview-fallback",
          });
          const detail = errorText(error, "当前桌面宿主不支持快速目录预览。");
          addLog(detail, "error");
          addLog("尝试回退到旧版临时卡带预览。");
        }
      }

      updateProgress(46, "导出卡带", `正在打包 ${manifestAssets.length} 个运行时素材。`);
      const cartridge = await exportEditorCartridge(exportInput);
      if (isTauriRuntime() && cartridge.blob.size > LEGACY_GAMECLI_PREVIEW_MAX_BYTES) {
        throw new Error("桌面宿主过旧，请更新后使用快速目录预览；当前大卡带不再通过旧版上传链路启动。");
      }
      updateProgress(62, "卡带生成完成", `临时卡带 ${cartridge.fileName}，大小 ${formatBytes(cartridge.blob.size)}。`);
      addLog(`临时卡带已生成：${cartridge.fileName}（${formatBytes(cartridge.blob.size)}）。`, "success");

      const result = await openGameCliPreview({
        cartridge: cartridge.blob,
        fileName: cartridge.fileName,
        onProgress: (event) => {
          const mappedPercent = event.phase === "upload" || event.phase === "legacy"
            ? 66 + ((event.percent ?? 0) * 0.24)
            : event.phase === "launch"
              ? 92 + (((event.percent ?? 0) / 100) * 8)
              : 70 + (((event.percent ?? 0) / 100) * 20);
          updateProgress(mappedPercent, event.phase === "launch" ? "启动 GameCLI" : "传输预览卡带", event.message);
          addLog(event.message);
        },
      });
      setMessage(warnings.length > 0 ? `${result.message}\n${warnings.join("\n")}` : result.message);
      updateProgress(100, "预览已启动", result.message, "success");
      addLog(result.message, "success");
    } catch (error) {
      reportFrontendError("editor.preview", error, { operation: "open" });
      const detail = errorText(error, "GameCLI 预览启动失败。");
      setMessage(detail);
      updateProgress(progress.percent, "预览失败", detail, "error");
      addLog(detail, "error");
      setNotice({
        tone: "error",
        message: "GameCLI 预览启动失败",
        source: "GameCLI Preview",
        detail,
        error,
        action: "确认正在使用 AgentVN 桌面版；检查 GameCLI 是否已构建，或设置 AGENTVN_GAMECLI_EXE 指向可执行文件。",
        context: {
          selectedNodeId: selectedNode?.id,
          entrySceneId: previewScript.entry_scene_id,
          commandCount: previewScript.scenes.reduce((total, scene) => total + scene.commands.length, 0),
        },
      });
    } finally {
      setBusy(false);
    }
  }

  async function closePreview() {
    try {
      await closeGameCliPreview();
      setMessage("已关闭 GameCLI 预览。");
      updateProgress(0, "等待预览", "已关闭预览窗口，可重新启动。", "idle");
      addLog("已请求关闭 GameCLI 预览。");
    } catch (error) {
      reportFrontendError("editor.preview", error, { operation: "close" });
      const detail = errorText(error, "关闭预览失败。");
      setMessage(detail);
      updateProgress(progress.percent, "关闭失败", detail, "error");
      addLog(detail, "error");
      setNotice({
        tone: "error",
        message: "GameCLI 预览关闭失败",
        source: "GameCLI Preview",
        detail,
        error,
        action: "如果当前不是桌面版，请手动关闭 GameCLI；如果是桌面版，检查预览进程是否已经退出。",
        context: { selectedNodeId: selectedNode?.id },
      });
    }
  }

  return (
    <section className="advanced-card gamecli-preview-card">
      <h3>GameCLI 完整预览</h3>
      <p>将当前编辑器内存中的工程导出为临时卡带，并交给 GameCLI 容器播放。</p>
      <div className="gamecli-preview-launch">
        <button className="gamecli-preview-launch-button" type="button" data-help-key="preview.open" onClick={() => void syncPreview()} disabled={busy}>
          <span className="gamecli-preview-launch-status">{busy ? "同步中" : "就绪"}</span>
          <span className="gamecli-preview-launch-copy">
            <strong>{busy ? "正在生成预览卡带" : "启动 GameCLI 预览"}</strong>
            <small>{busy ? "正在校验、打包并传输当前工程。" : "使用当前编辑器内存状态立即导出并播放。"}</small>
          </span>
          <span className="gamecli-preview-launch-arrow" aria-hidden="true">→</span>
        </button>
      </div>
      <div className="gamecli-preview-secondary-actions">
        <button type="button" data-help-key="preview.reload-project" onClick={() => void reloadProjectFromBackend()} disabled={busy}>
          从后端重载工程
        </button>
        <button type="button" data-help-key="preview.close" onClick={() => void closePreview()}>
          关闭预览
        </button>
      </div>
      <section className={`gamecli-preview-progress is-${progress.tone}`} aria-live="polite" aria-label="GameCLI 预览生成进度">
        <div className="gamecli-preview-progress-header">
          <strong>{progress.label}</strong>
          <span>{progress.percent}%</span>
        </div>
        <div className="gamecli-preview-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
          <span style={{ width: `${progress.percent}%` }} />
        </div>
        <p>{progress.detail}</p>
      </section>
      <section className="gamecli-preview-log" aria-label="GameCLI 预览日志">
        <header>
          <strong>预览日志</strong>
          <button type="button" data-help-key="preview.clear-log" onClick={() => setLogs([])} disabled={busy || logs.length === 0}>
            清空日志
          </button>
        </header>
        <ol>
          {logs.length === 0 ? (
            <li className="is-empty">暂无日志捏</li>
          ) : (
            logs.map((item) => (
              <li key={item.id} className={`is-${item.tone}`}>
                <time>{item.time}</time>
                <span>{item.message}</span>
              </li>
            ))
          )}
        </ol>
      </section>
      {message && (
        <section className="gamecli-preview-detail" aria-label="GameCLI 预览详情">
          <strong>预览详情</strong>
          <p>{message}</p>
        </section>
      )}
    </section>
  );
}
