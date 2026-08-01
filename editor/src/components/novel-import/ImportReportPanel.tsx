import { useNovelImportStore } from "../../store/novelImportStore";
import { novelImportStatusLabel } from "../../novel-import/displayLabels";

export function ImportReportPanel() {
  const session = useNovelImportStore((state) => state.session);
  const importJob = useNovelImportStore((state) => state.importJob);
  const warnings = useNovelImportStore((state) => state.warnings);
  const warningCount = session.adapted_scenes.reduce((sum, scene) => sum + scene.warnings.length, 0) + warnings.length;

  return (
    <section className="advanced-card">
      <h3>8. 导入报告</h3>
      <dl className="report-list">
        <div><dt>总字符数</dt><dd>{session.document?.total_chars ?? 0}</dd></div>
        <div><dt>章节数量</dt><dd>{session.chapters.length}</dd></div>
        <div><dt>候选场景</dt><dd>{session.scenes.length}</dd></div>
        <div><dt>已生成节点</dt><dd>{importJob?.generatedCount ?? session.adapted_scenes.length}</dd></div>
        <div><dt>失败场景</dt><dd>{importJob?.failedSceneIds.length ?? 0}</dd></div>
        <div><dt>角色数量</dt><dd>{session.characters.length}</dd></div>
        <div><dt>警告数量</dt><dd>{warningCount}</dd></div>
        <div><dt>需要复查</dt><dd>{session.adapted_scenes.filter((scene) => scene.needs_review).length}</dd></div>
        <div><dt>导入状态</dt><dd>{novelImportStatusLabel(importJob?.status ?? session.status)}</dd></div>
      </dl>
      <p>生成的节点已标注“来源于解析小说”。空白蓝图会接入入口主线；已有蓝图会保留原入口和连线，在画布空白处另开小说工程线。</p>
    </section>
  );
}
