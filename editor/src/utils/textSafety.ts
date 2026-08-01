const unreadableTextPattern = /(?:\?{4,}|\uFFFD{2,})/;

export function isLikelyUnreadableText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return unreadableTextPattern.test(value.trim());
}

export function safeVisibleText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed || isLikelyUnreadableText(trimmed)) return fallback;
  return trimmed;
}
