import type { EditorProjectFile } from "../types/nodes";
import { countEmbeddedAssetPayloads, embeddedProjectPayloadImportLimitBytes, embeddedProjectPayloadInlineLimitChars } from "./embeddedAssetPayloads";
import { validateProject } from "./validation";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";

export interface ProjectImportResult {
  project?: EditorProjectFile;
  error?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEditorProjectFile(value: unknown): value is EditorProjectFile {
  if (!isObject(value)) return false;
  return (
    typeof value.schema_version === "string" &&
    typeof value.project_id === "string" &&
    typeof value.title === "string" &&
    typeof value.author === "string" &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges) &&
    isObject(value.viewport) &&
    typeof value.memory_mode === "string" &&
    Array.isArray(value.asset_manifest) &&
    isObject(value.editor_settings)
  );
}

export function parseProjectJson(parsed: unknown): ProjectImportResult {
  if (!isEditorProjectFile(parsed)) {
    return { error: "导入失败：这不是有效的 AgentVN 工程文件。" };
  }

  const issues = validateProject(parsed);
  if (issues.length > 0) {
    return { error: `导入失败：${issues.map((issue) => issue.message).join("；")}` };
  }

  const embeddedPayloads = countEmbeddedAssetPayloads(parsed);
  if (embeddedPayloads.totalChars > embeddedProjectPayloadInlineLimitChars) {
    return {
      error: `导入失败：工程内嵌素材约 ${Math.round(embeddedPayloads.totalChars / 1024 / 1024)}MB，容易导致编辑器崩溃。请先使用修复脚本外置素材后再导入。`,
    };
  }

  return { project: parsed };
}

export async function parseProjectFile(file: File): Promise<ProjectImportResult> {
  if (file.size > embeddedProjectPayloadImportLimitBytes) {
    return {
      error: `导入失败：工程文件约 ${Math.round(file.size / 1024 / 1024)}MB，超过安全上限。请先外置素材或运行修复脚本再导入。`,
    };
  }
  try {
    return parseProjectJson(JSON.parse(await file.text()));
  } catch (error) {
    reportFrontendError("editor.project-import", error, {
      operation: "parse",
      fileName: file.name,
      fileSize: file.size,
    });
    return { error: "导入失败：文件不是有效的 JSON。" };
  }
}
