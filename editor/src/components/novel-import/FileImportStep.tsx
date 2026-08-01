import { useNovelImportStore } from "../../store/novelImportStore";
import { estimateTokens } from "../../novel-import/textChunker";

export function FileImportStep() {
  const importFile = useNovelImportStore((state) => state.importFile);
  const pendingImport = useNovelImportStore((state) => state.pendingImport);
  const document = useNovelImportStore((state) => state.session.document);
  const preflight = pendingImport?.preflight;
  return (
    <section className="advanced-card">
      <h3>1. 文件导入</h3>
      <input type="file" accept=".txt,.md,.epub,.html,.htm,.xhtml,.docx,.json" data-help-key="novel.importFile" onChange={(event) => event.target.files?.[0] && importFile(event.target.files[0])} />
      {preflight && <div className="advanced-result"><strong>{preflight.file_name}</strong><span>{preflight.file_type} · {preflight.total_chars} 字符 · 约 {preflight.estimated_tokens} Token · {preflight.recommendation_label}</span></div>}
      {document && <div className="advanced-result"><strong>{document.file_name}</strong><span>{document.file_type} · {document.total_chars} 字符 · 约 {estimateTokens(document.normalized_text)} Token</span></div>}
    </section>
  );
}
