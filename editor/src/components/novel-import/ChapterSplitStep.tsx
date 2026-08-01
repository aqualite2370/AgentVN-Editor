import { useNovelImportStore } from "../../store/novelImportStore";

export function ChapterSplitStep() {
  const chapters = useNovelImportStore((state) => state.session.chapters);
  const updateChapter = useNovelImportStore((state) => state.updateChapter);
  const splitScenes = useNovelImportStore((state) => state.splitScenes);
  return (
    <section className="advanced-card">
      <h3>3. 章节切分</h3>
      {chapters.map((chapter) => (
        <div className="advanced-list-item" key={chapter.chapter_id}>
          <input value={chapter.title} data-help-key="novel.chapterTitle" onChange={(event) => updateChapter({ ...chapter, title: event.target.value })} />
          <span>{chapter.start_offset} - {chapter.end_offset} · 置信度 {chapter.confidence}</span>
        </div>
      ))}
      <button type="button" data-help-key="novel.splitScenes" onClick={splitScenes}>切分场景</button>
    </section>
  );
}
