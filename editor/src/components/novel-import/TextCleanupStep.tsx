import { useNovelImportStore } from "../../store/novelImportStore";
import { normalizeText } from "../../novel-import/textChunker";

export function TextCleanupStep() {
  const document = useNovelImportStore((state) => state.session.document);
  const updateDocumentText = useNovelImportStore((state) => state.updateDocumentText);
  const splitChapters = useNovelImportStore((state) => state.splitChapters);
  if (!document) return null;
  return (
    <section className="advanced-card">
      <h3>2. 文本清洗</h3>
      <div className="advanced-grid-2">
        <textarea readOnly value={document.raw_text.slice(0, 5000)} data-help-key="novel.rawText" />
        <textarea value={document.normalized_text} data-help-key="novel.normalizedText" onChange={(event) => updateDocumentText(event.target.value)} />
      </div>
      <div className="row-actions">
        <button type="button" data-help-key="novel.clean" onClick={() => updateDocumentText(normalizeText(document.raw_text))}>重新清洗</button>
        <button type="button" data-help-key="novel.splitChapters" onClick={splitChapters}>切分章节</button>
      </div>
    </section>
  );
}
