import { useNovelImportStore } from "../../store/novelImportStore";
import { novelImportStatusLabel } from "../../novel-import/displayLabels";

export function CharacterReviewStep() {
  const characters = useNovelImportStore((state) => state.session.characters);
  const updateCharacter = useNovelImportStore((state) => state.updateCharacter);
  const generateBlueprintLine = useNovelImportStore((state) => state.generateBlueprintLine);
  const cancelBlueprintGeneration = useNovelImportStore((state) => state.cancelBlueprintGeneration);
  const importJob = useNovelImportStore((state) => state.importJob);
  const isProcessing = useNovelImportStore((state) => state.isProcessing);

  return (
    <section className="advanced-card">
      <h3>5. 角色复核</h3>
      <p>确认角色编号和描述后，可以直接生成蓝图。空白蓝图会接入入口主线；已有内容的蓝图会在旁边新建一条独立小说工程线。</p>
      {characters.map((character) => (
        <div className="advanced-list-item" key={character.character_id}>
          <input value={character.character_id} data-help-key="novel.characterId" onChange={(event) => updateCharacter({ ...character, character_id: event.target.value })} />
          <input value={character.name} data-help-key="novel.characterName" onChange={(event) => updateCharacter({ ...character, name: event.target.value })} />
          <textarea value={character.description} data-help-key="novel.characterDescription" onChange={(event) => updateCharacter({ ...character, description: event.target.value })} />
        </div>
      ))}
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
