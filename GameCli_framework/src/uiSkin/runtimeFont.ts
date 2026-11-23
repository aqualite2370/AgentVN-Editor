export const runtimeFontFallback = `Inter, "Segoe UI", system-ui, sans-serif`;

export function fontFamilyName(assetId: string): string {
  return `AgentVNFont_${assetId.replace(/[^a-z0-9_-]/gi, "_")}`;
}

export function fontFamilyForAsset(assetId?: string | null): string | undefined {
  const normalized = assetId?.trim();
  return normalized ? `"${fontFamilyName(normalized)}", ${runtimeFontFallback}` : undefined;
}

function cssUrl(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "");
}

function fontFaceFormat(filename?: string, mimeType?: string): string | undefined {
  const lower = `${filename ?? ""} ${mimeType ?? ""}`.toLowerCase();
  if (lower.includes("woff2")) return "woff2";
  if (lower.includes("woff")) return "woff";
  if (lower.includes("ttf") || lower.includes("truetype")) return "truetype";
  if (lower.includes("otf") || lower.includes("opentype")) return "opentype";
  return undefined;
}

export function runtimeFontFaceRule(assetId: string, filename: string | undefined, mimeType: string | undefined, source: string): string {
  const format = fontFaceFormat(filename, mimeType);
  return `@font-face{font-family:"${fontFamilyName(assetId)}";src:url("${cssUrl(source)}")${format ? ` format("${format}")` : ""};font-display:swap;}`;
}
