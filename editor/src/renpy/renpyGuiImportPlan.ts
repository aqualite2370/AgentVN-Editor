import {
  renpyGUIErrors,
  type RenpyGUI,
  type RenpyGUIParameterImport,
} from "../../../shared/cartridge/renpyGui";
import type { UISkinLayout } from "../../../shared/cartridge/uiSkin";
import type { AssetRef } from "../types/assets";
import { buildProjectAssetPath } from "../utils/projectAssets";
import type { RenpyGuiArchiveScan, RenpyGuiAssetCandidate } from "./renpyGuiImport";

export type RenpyGuiAssetImportChoice = "skip" | "add" | "replace";
export type RenpyGuiAssetBinding =
  | "title_background"
  | "dialog_panel"
  | "choice_button"
  | "interface_font"
  | "button_normal"
  | "button_hover"
  | "button_selected"
  | "button_disabled";
export interface PrepareRenpyGuiImportOptions {
  layout: UISkinLayout;
  existingAssets: AssetRef[];
  scan: RenpyGuiArchiveScan;
  parameterSelection: Record<string, boolean>;
  assetSelection: Record<string, RenpyGuiAssetImportChoice>;
  assetBindings?: Record<string, RenpyGuiAssetBinding | undefined>;
  createdAt?: string;
}

export interface PreparedRenpyGuiImport {
  layout: UISkinLayout;
  assets: AssetRef[];
  importedAssetIds: string[];
  appliedParameters: string[];
}

const blockingScanIssues = new Set([
  "invalid_archive", "unsafe_path", "symbolic_link", "archive_limit",
  "missing_gui", "ambiguous_gui", "invalid_encoding",
]);
const MAX_RENPY_GUI_ASSET_ID_LENGTH = 64;

export function renpyGuiAssetId(candidate: RenpyGuiAssetCandidate): string {
  const normalized = candidate.path.normalize("NFKC").toLocaleLowerCase("en-US");
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const slug = normalized
    .replace(/\.[^.]+$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(-48) || "asset";
  return `renpy_gui_${slug}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function isRenpyGuiReimport(asset: AssetRef | undefined, candidate: RenpyGuiAssetCandidate): asset is AssetRef {
  return Boolean(asset?.asset_id === renpyGuiAssetId(candidate)
    && asset.metadata.tags?.includes("renpy_gui_import")
    && asset.metadata.tags.includes(`renpy_gui_path:${candidate.path}`));
}

export function prepareRenpyGuiImport(options: PrepareRenpyGuiImportOptions): PreparedRenpyGuiImport {
  const { layout, existingAssets, scan, parameterSelection, assetSelection } = options;
  if (layout.layout_type !== "renpy") throw new Error("REN’PY_LAYOUT_REQUIRED");
  if (scan.issues.some((entry) => blockingScanIssues.has(entry.code))) {
    throw new Error("REN’PY_GUI_SCAN_BLOCKED");
  }
  const selectedValues = selectedRenpyGUIValues(scan.parameters.values, parameterSelection);
  const parameterErrors = renpyGUIErrors(selectedValues);
  if (parameterErrors.length) throw new Error(`REN’PY_GUI_PARAMETER_INVALID:${parameterErrors.join(",")}`);

  const nextLayout = structuredClone(layout);
  nextLayout.renpy = mergeRenpyGUI(nextLayout.renpy, selectedValues);
  const nextAssets = [...existingAssets];
  const importedAssetIds: string[] = [];
  const boundTargets = new Set<RenpyGuiAssetBinding>();
  for (const candidate of scan.assets) {
    const choice = assetSelection[candidate.path] ?? "skip";
    const binding = options.assetBindings?.[candidate.path];
    if (choice === "skip") {
      if (binding) {
        const existing = nextAssets.find((asset) => isRenpyGuiReimport(asset, candidate));
        if (!existing) throw new Error(`REN’PY_GUI_BINDING_SOURCE_MISSING:${candidate.path}`);
        assertCanBindTarget(binding, candidate, boundTargets);
        bindRenpyGUIAsset(nextLayout, binding, existing.asset_id, candidate.path);
      }
      continue;
    }
    if (choice !== "add" && choice !== "replace") {
      throw new Error(`REN’PY_GUI_ASSET_CHOICE_INVALID:${candidate.path}`);
    }
    const existing = choice === "replace"
      ? nextAssets.find((asset) => asset.asset_id === renpyGuiAssetId(candidate))
      : undefined;
    if (choice === "replace" && !isRenpyGuiReimport(existing, candidate)) {
      throw new Error(`REN’PY_GUI_REPLACE_NOT_OWNED:${candidate.path}`);
    }
    const asset = toAssetRef(candidate, nextAssets, options.createdAt, choice === "replace" ? existing : undefined);
    if (existing) {
      const index = nextAssets.findIndex((item) => item.asset_id === existing.asset_id);
      if (index < 0) throw new Error(`REN’PY_GUI_ASSET_STATE_CHANGED:${candidate.path}`);
      nextAssets[index] = asset;
    } else {
      nextAssets.push(asset);
    }
    importedAssetIds.push(asset.asset_id);

    if (binding) {
      assertCanBindTarget(binding, candidate, boundTargets);
      bindRenpyGUIAsset(nextLayout, binding, asset.asset_id, candidate.path);
    }
  }
  return {
    layout: nextLayout,
    assets: nextAssets,
    importedAssetIds,
    appliedParameters: Object.keys(parameterSelection).filter((key) => parameterSelection[key]),
  };
}

function assertCanBindTarget(
  binding: RenpyGuiAssetBinding,
  candidate: RenpyGuiAssetCandidate,
  boundTargets: Set<RenpyGuiAssetBinding>,
): void {
  const expectedKind = binding === "interface_font" ? "font" : "image";
  if (candidate.kind !== expectedKind) {
    throw new Error(`REN’PY_GUI_BINDING_REQUIRES_${expectedKind.toUpperCase()}:${candidate.path}`);
  }
  if (boundTargets.has(binding)) {
    throw new Error(`REN’PY_GUI_BINDING_CONFLICT:${binding}`);
  }
  boundTargets.add(binding);
}

function bindRenpyGUIAsset(
  layout: UISkinLayout,
  binding: RenpyGuiAssetBinding,
  assetId: string,
  sourcePath: string,
): void {
  if (binding === "interface_font") {
    layout.tokens.fontAssetId = assetId;
    return;
  }
  const buttonState = binding === "button_normal" ? "normal"
    : binding === "button_hover" ? "hover"
      : binding === "button_selected" ? "selected"
        : binding === "button_disabled" ? "disabled" : undefined;
  if (buttonState) {
    if (layout.layout_type !== "renpy") throw new Error(`REN’PY_LAYOUT_REQUIRED:${sourcePath}`);
    layout.renpy ??= {};
    layout.renpy.shared ??= {};
    const buttonImages = layout.renpy.shared.buttonImages ?? {};
    layout.renpy.shared.buttonImages = { ...buttonImages, [buttonState]: `asset:${assetId}` };
    return;
  }
  const target = {
    title_background: { screen: "title", component: "title_hero", type: "main_menu_hero" },
    dialog_panel: { screen: "player", component: "dialog_panel", type: "dialog_panel" },
    choice_button: { screen: "player", component: "choice_option", type: "choice_option" },
  }[binding as "title_background" | "dialog_panel" | "choice_button"];
  const component = layout.screens.find((screen) => screen.screen_id === target.screen)
    ?.components.find((entry) => entry.component_id === target.component);
  if (!component || component.component_type !== target.type) {
    throw new Error(`REN’PY_GUI_BINDING_TARGET_MISSING:${binding}:${sourcePath}`);
  }
  component.style = { ...component.style, backgroundImage: `asset:${assetId}` };
}

function selectedRenpyGUIValues(
  imported: RenpyGUIParameterImport["values"],
  selection: Record<string, boolean>,
): RenpyGUI {
  const selected: RenpyGUI = {};
  for (const [scope, fields] of Object.entries(imported)) {
    for (const [field, value] of Object.entries(fields ?? {})) {
      if (scope === "shared" && field === "buttonTextColors" && value && typeof value === "object") {
        for (const [state, color] of Object.entries(value as Record<string, unknown>)) {
          if (selection[`${scope}.${field}.${state}`] !== true) continue;
          selected.shared ??= {};
          selected.shared.buttonTextColors ??= {};
          selected.shared.buttonTextColors[state as "normal" | "hover" | "selected" | "disabled"] = color as string;
        }
        continue;
      }
      if (selection[`${scope}.${field}`] !== true) continue;
      selected[scope as keyof RenpyGUI] ??= {};
      (selected[scope as keyof RenpyGUI] as Record<string, unknown>)[field] = value;
    }
  }
  return selected;
}

function mergeRenpyGUI(current: RenpyGUI | undefined, imported: RenpyGUI): RenpyGUI {
  const merged: RenpyGUI = structuredClone(current ?? {});
  for (const [scope, values] of Object.entries(imported)) {
    const key = scope as keyof RenpyGUI;
    merged[key] = {
      ...merged[key],
      ...values,
      ...(values?.buttonImages
        ? { buttonImages: { ...merged[key]?.buttonImages, ...values.buttonImages } }
        : {}),
      ...(values?.buttonTextColors
        ? { buttonTextColors: { ...merged[key]?.buttonTextColors, ...values.buttonTextColors } }
        : {}),
    };
  }
  return merged;
}

function toAssetRef(
  candidate: RenpyGuiAssetCandidate,
  existingAssets: AssetRef[],
  createdAt = new Date().toISOString(),
  replaced?: AssetRef,
): AssetRef {
  const baseId = renpyGuiAssetId(candidate);
  const type = candidate.kind === "font" ? "font" : "ui";
  const filename = candidate.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "asset.bin";
  let assetId = replaced?.asset_id ?? baseId;
  let projectPath = replaced?.metadata.project_path;
  if (!replaced) {
    const usedIds = new Set(existingAssets.map((asset) => asset.asset_id));
    const usedPaths = new Set(existingAssets
      .map((asset) => asset.metadata.project_path)
      .filter((value): value is string => typeof value === "string" && value.length > 0));
    let suffix = 2;
    projectPath = buildProjectAssetPath(type, assetId, filename);
    while (usedIds.has(assetId) || usedPaths.has(projectPath)) {
      assetId = renpyGuiAssetIdWithSuffix(baseId, suffix);
      projectPath = buildProjectAssetPath(type, assetId, filename);
      suffix += 1;
    }
  }
  projectPath ??= buildProjectAssetPath(type, assetId, filename);
  const dataUrl = `data:${candidate.mimeType};base64,${bytesToBase64(candidate.bytes)}`;
  const previousMetadata = replaced?.metadata ?? {};
  return {
    asset_id: assetId,
    asset_type: type,
    metadata: {
      ...previousMetadata,
      display_name: previousMetadata.display_name ?? filename.replace(/\.[^.]+$/, ""),
      filename,
      mime_type: candidate.mimeType,
      size_bytes: candidate.bytes.byteLength,
      source: "imported",
      data_url: dataUrl,
      blob_url: undefined,
      url: undefined,
      filePath: undefined,
      project_path: projectPath,
      tags: [...new Set([
        ...(previousMetadata.tags ?? []).filter((tag) => !tag.startsWith("renpy_gui_path:")),
        "renpy_gui_import",
        `renpy_gui_path:${candidate.path}`,
      ])],
      created_at: previousMetadata.created_at ?? createdAt,
    },
  };
}

function renpyGuiAssetIdWithSuffix(baseId: string, suffix: number): string {
  const suffixText = `_${suffix}`;
  const hashTail = /_[\da-f]{8}$/i.exec(baseId)?.[0] ?? "";
  const prefix = hashTail
    ? baseId.slice(0, -hashTail.length)
    : baseId;
  const prefixBudget = Math.max(1, MAX_RENPY_GUI_ASSET_ID_LENGTH - hashTail.length - suffixText.length);
  const compactPrefix = Array.from(prefix).slice(0, prefixBudget).join("");
  const candidate = `${compactPrefix}${hashTail}${suffixText}`;
  return Array.from(candidate).slice(0, MAX_RENPY_GUI_ASSET_ID_LENGTH).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
