import { isCustomComponentDefinition, type CustomComponentDefinition } from "../../../shared/cartridge/customComponent";
import type { UILayoutComponent, UILayoutRect, UILayoutScreenId, UISkinLayout } from "../../../shared/cartridge/uiSkin";
import type { AssetRef } from "../types/assets";
import { buildProjectAssetPath } from "../utils/projectAssets";
import type { PersonalComponentRecord } from "./personalComponentLibrary";

export interface AddPersonalComponentOptions {
  componentId: string;
  rect: UILayoutRect;
  createAssetId?: () => string;
}

export interface AddPersonalComponentResult {
  layout: UISkinLayout;
  assets: AssetRef[];
}

function validateRect(rect: UILayoutRect): void {
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (values.some((value) => !Number.isFinite(value))
    || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0
    || rect.x + rect.width > 100 || rect.y + rect.height > 100) {
    throw new Error("组件位置与尺寸必须完整位于 0–100% 画布范围内。");
  }
}

function cloneDefinition(value: unknown): CustomComponentDefinition {
  if (!isCustomComponentDefinition(value)) {
    throw new Error("个人组件结构已损坏或不安全，未写入工程布局。");
  }
  return structuredClone(value);
}

function referencedAssetIds(definition: CustomComponentDefinition): Set<string> {
  const ids = new Set<string>();
  const visit = (node: CustomComponentDefinition["root"]) => {
    if (node.assetId) ids.add(node.assetId);
    node.children.forEach(visit);
  };
  visit(definition.root);
  return ids;
}

function dataUrlFromBytes(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function defaultAssetId(): string {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `component-asset-${id}`;
}

/**
 * Copy a personal-library component into one project layout. The returned
 * snapshot is immutable with respect to both inputs, and unsupported assets
 * are rejected rather than silently omitted.
 */
export function addPersonalComponentToProjectLayout(
  layout: UISkinLayout,
  screenId: UILayoutScreenId,
  record: Pick<PersonalComponentRecord, "name" | "definition" | "assets">,
  options: AddPersonalComponentOptions,
): UISkinLayout {
  if (layout.layout_type !== "renpy") throw new Error("自定义组件目前只能添加到进阶布局。");
  const targetIndex = layout.screens.findIndex((screen) => screen.screen_id === screenId);
  if (targetIndex < 0) throw new Error(`目标页面不存在：${screenId}`);
  if (!options.componentId.trim()) throw new Error("组件实例编号不能为空。");
  if (layout.screens.some((screen) => screen.components.some((item) => item.component_id === options.componentId)))
    throw new Error(`组件编号冲突：${options.componentId}`);
  validateRect(options.rect);
  if ((record.assets?.length ?? 0) > 0)
    throw new Error("该组件包含素材；请先完成工程素材映射，当前未修改布局。");

  const definition = cloneDefinition(record.definition);
  const component: UILayoutComponent = {
    component_id: options.componentId,
    component_type: "custom_component",
    label: record.name.trim().slice(0, 160) || "自定义组件",
    required: false,
    locked: false,
    visible: true,
    rect: { ...options.rect },
    customComponent: definition,
  };
  const next = structuredClone(layout);
  next.screens[targetIndex].components.push(component);
  return next;
}

/**
 * Copy a personal component and only the image dependencies actually used by
 * its safe AST. Project asset IDs are regenerated so imported packages cannot
 * alias or overwrite an existing project's assets.
 */
export function addPersonalComponentToProject(
  layout: UISkinLayout,
  screenId: UILayoutScreenId,
  record: Pick<PersonalComponentRecord, "name" | "definition" | "assets">,
  options: AddPersonalComponentOptions,
  existingAssets: AssetRef[],
): AddPersonalComponentResult {
  const definition = cloneDefinition(record.definition);
  const referencedIds = referencedAssetIds(definition);
  const personalAssets = record.assets ?? [];
  const personalById = new Map<string, typeof personalAssets[number]>();
  for (const asset of personalAssets) {
    if (personalById.has(asset.id)) throw new Error(`个人组件素材编号重复：${asset.id}`);
    personalById.set(asset.id, asset);
  }

  const usedIds = new Set(existingAssets.map((asset) => asset.asset_id));
  const mappedIds = new Map<string, string>();
  const additions: AssetRef[] = [];
  for (const sourceId of referencedIds) {
    const source = personalById.get(sourceId);
    if (!source) throw new Error(`个人组件引用了不存在的素材“${sourceId}”，未写入工程。`);
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(source.mimeType)
      || !(source.bytes instanceof Uint8Array)
      || source.bytes.byteLength < 1
      || source.bytes.byteLength > 8 * 1024 * 1024) {
      throw new Error(`素材“${source.filename}”不是受支持的有效图片，未写入工程。`);
    }
    const assetId = (options.createAssetId ?? defaultAssetId)();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(assetId) || usedIds.has(assetId))
      throw new Error(`工程素材编号冲突或无效：“${assetId}”。`);
    usedIds.add(assetId);
    mappedIds.set(sourceId, assetId);
    additions.push({
      asset_id: assetId,
      asset_type: "ui",
      metadata: {
        display_name: source.filename,
        filename: source.filename,
        mime_type: source.mimeType,
        size_bytes: source.bytes.byteLength,
        source: "imported",
        data_url: dataUrlFromBytes(source.bytes, source.mimeType),
        project_path: buildProjectAssetPath("ui", assetId, source.filename),
        tags: ["custom_component"],
      },
    });
  }

  const rewriteAssetIds = (node: CustomComponentDefinition["root"]) => {
    if (node.assetId && mappedIds.has(node.assetId)) node.assetId = mappedIds.get(node.assetId)!;
    node.children.forEach(rewriteAssetIds);
  };
  rewriteAssetIds(definition.root);
  const nextLayout = addPersonalComponentToProjectLayout(
    layout,
    screenId,
    { ...record, definition, assets: [] },
    options,
  );
  const component = nextLayout.screens.find((screen) => screen.screen_id === screenId)!
    .components.find((item) => item.component_id === options.componentId)!;
  component.customComponent = definition;
  return { layout: nextLayout, assets: [...existingAssets, ...additions] };
}
