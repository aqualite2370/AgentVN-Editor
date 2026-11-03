export const DIALOG_TEXT_RECOMMENDED_CHARACTER_LIMIT = 150;
export const DIALOG_TEXT_MIN_AUTO_FONT_SIZE_PX = 12;

export function countDialogTextCharacters(text: string): number {
  return Array.from(text).length;
}
