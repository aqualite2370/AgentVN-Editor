import {
  DIALOG_TEXT_RECOMMENDED_CHARACTER_LIMIT,
  countDialogTextCharacters,
} from "../../../../shared/cartridge/dialogText";

export function DialogTextLengthHint({ id, text }: { id: string; text: string }) {
  const characterCount = countDialogTextCharacters(text);
  const isOverRecommendedLimit = characterCount > DIALOG_TEXT_RECOMMENDED_CHARACTER_LIMIT;

  return (
    <span
      className={`dialog-text-length-hint${isOverRecommendedLimit ? " is-warning" : ""}`}
      id={id}
      role={isOverRecommendedLimit ? "status" : undefined}
      aria-live={isOverRecommendedLimit ? "polite" : "off"}
    >
      <span>{characterCount} 字</span>
      {isOverRecommendedLimit && (
        <span>
          已超过当前建议容量（{DIALOG_TEXT_RECOMMENDED_CHARACTER_LIMIT} 字）。仍可继续添加，但更多文字可能导致显示不美观。
        </span>
      )}
    </span>
  );
}
