import type { Choice } from "../types/commands";

export const EMPTY_CHOICE_TEXT_HINT = "未填写选项文本";

export function choiceEditorDisplayText(choice: Pick<Choice, "choice_display_name" | "text" | "choice_id">): string {
  return choice.choice_display_name?.trim() || choice.text?.trim() || EMPTY_CHOICE_TEXT_HINT;
}

export function isChoiceTextPlaceholder(choice: Pick<Choice, "choice_display_name" | "text">): boolean {
  return !choice.choice_display_name?.trim() && !choice.text?.trim();
}

export function choiceRuntimeText(choice: Pick<Choice, "choice_display_name" | "text">, index: number): string {
  return choice.text?.trim() || choice.choice_display_name?.trim() || `选项 ${index + 1}`;
}
