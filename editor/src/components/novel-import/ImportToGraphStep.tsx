import { useNovelImportStore } from "../../store/novelImportStore";
import { useEditorStore } from "../../store/editorStore";
import { novelImportStatusLabel } from "../../novel-import/displayLabels";

export function ImportToGraphStep() {
  const sceneCount = useNovelImportStore((state) => state.session.scenes.length);
  const adaptedCount = useNovelImportStore((state) => state.session.adapted_scenes.length);
  const generateBlueprintLine = useNovelImportStore((state) => state.generateBlueprintLine);
  const cancelBlueprintGeneration = useNovelImportStore((state) => state.cancelBlueprintGeneration);
  const importJob = useNovelImportStore((state) => state.importJob);
  const isProcessing = useNovelImportStore((state) => state.isProcessing);
  const isBlankMainLine = useEditorStore((state) => state.nodes.length === 1 && state.nodes[0]?.data.nodeKind === "start" && state.edges.length === 0);

  return (
    <section className="advanced-card">
      <h3>7. 生成蓝图线</h3>
      <p>
        将 {sceneCount} 个小说场景逐个改编成场景节点。{isBlankMainLine ? "当前蓝图只有入口节点，生成结果会自动接入主工程线。" : "当前蓝图已有内容，生成结果会放在空白区域作为独立工程线。"}
      </p>
      <p>已写入节点：{adaptedCount} 个。节点会在每个场景完成后立刻出现在画布上，不会等整本小说全部完成后才出现。</p>
      {importJob && (
        <p className="inline-status">
          蓝图生成：{importJob.generatedCount}/{importJob.total}，失败 {importJob.failedSceneIds.length} 个，状态 {novelImportStatusLabel(importJob.status)}
        </p>
      )}
      <div className="row-actions">
        <button type="button" data-help-key="novel.generateBlueprintLine" disabled={isProcessing} onClick={() => void generateBlueprintLine()}>
          {importJob?.status === "cancelled" ? "继续生成蓝图线" : "生成蓝图线"}
        </button>
        {isProcessing && (
          <button type="button" data-help-key="novel.cancelBlueprintLine" onClick={cancelBlueprintGeneration}>
            取消生成
          </button>
        )}
      </div>
    </section>
  );
}
