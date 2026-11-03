import type { AssetRef } from "../types/assets";
import type { AssistantCreationDraft, AssistantCreationProjectBaseline } from "./creationAgent";
import type {
  AssistantCreationAuthorizedElementTarget,
  AssistantCreationElementEdit,
} from "./creationAgent";
import { addPersonalComponentToProject } from "../renpy/customComponentProject";
import type { UILayoutScreenId, UISkinLayout } from "../../../shared/cartridge/uiSkin";
import { stableSerialize } from "../utils/stableSerialize";

export interface AssistantCreationMergePlanInput {
  currentProjectId: string;
  currentLayout: UISkinLayout;
  currentAssets: AssetRef[];
  baseline?: AssistantCreationProjectBaseline;
  targetScreenId: UILayoutScreenId;
  rect: { x: number; y: number; width: number; height: number };
  draft: AssistantCreationDraft;
  componentId: string;
  createAssetId?: () => string;
}

export type AssistantCreationMergePlan =
  | { status: "ready"; layout: UISkinLayout; assets: AssetRef[]; expectedScreenSnapshot: string }
  | { status: "conflict"; reason: string };

export interface AssistantCreationMergeBatchItem {
  itemId: string;
  screenId: UILayoutScreenId;
  rect: { x: number; y: number; width: number; height: number };
  draft: AssistantCreationDraft;
  componentId: string;
}

export type AssistantCreationMergeBatchPlan =
  | {
    status: "ready";
    layout: UISkinLayout;
    assets: AssetRef[];
    expectedScreenSnapshots: Partial<Record<UILayoutScreenId, string>>;
    expectedRuntimeUILayoutSnapshot: string;
    expectedAssetManifestSnapshot: string;
    items: Array<{ itemId: string; screenId: UILayoutScreenId; componentId: string }>;
  }
  | { status: "conflict"; reason: string };

export interface AssistantCreationMergeBatchPlanInput {
  currentProjectId: string;
  currentLayout: UISkinLayout;
  currentAssets: AssetRef[];
  baseline?: AssistantCreationProjectBaseline;
  items: AssistantCreationMergeBatchItem[];
  createAssetId?: () => string;
}

export interface AssistantCreationElementEditTarget extends AssistantCreationAuthorizedElementTarget {
  componentId: string;
}

export type AssistantCreationElementEditPlan =
  | {
    status: "ready";
    layout: UISkinLayout;
    expectedScreenSnapshot: string;
  }
  | { status: "conflict"; reason: string };

export function planAssistantCreationElementEditBatch(input: {
  currentProjectId: string;
  currentLayout: UISkinLayout;
  baseline?: AssistantCreationProjectBaseline;
  authorizedTargets: readonly AssistantCreationElementEditTarget[];
  edits: readonly AssistantCreationElementEdit[];
}): AssistantCreationElementEditPlan {
  const { currentProjectId, currentLayout, baseline, authorizedTargets, edits } = input;
  if (!baseline || baseline.projectId !== currentProjectId || baseline.layoutType !== "renpy"
    || currentLayout.layout_type !== "renpy") {
    return { status: "conflict", reason: "草稿工程或布局类型已变化；请回到原工程重新生成和审核。" };
  }
  if (authorizedTargets.length < 1 || authorizedTargets.length > 8
    || edits.length < 1 || edits.length > 8) {
    return { status: "conflict", reason: "控件修改数量不符合本地审核范围；工程未修改。" };
  }
  const targets = new Map(authorizedTargets.map((target) => [target.targetId, target]));
  if (targets.size !== authorizedTargets.length) {
    return { status: "conflict", reason: "本地控件授权别名重复；工程未修改。" };
  }
  const screenIds = new Set(edits.map((edit) => edit.screenId));
  if (screenIds.size !== 1) {
    return { status: "conflict", reason: "一次审核只能应用同一页面的控件修改；工程未修改。" };
  }
  const screenId = edits[0].screenId;
  const expectedScreenSnapshot = baseline.screens[screenId];
  const currentScreenIndex = currentLayout.screens.findIndex((screen) => screen.screen_id === screenId);
  if (!expectedScreenSnapshot || currentScreenIndex < 0
    || stableSerialize(currentLayout.screens[currentScreenIndex]) !== expectedScreenSnapshot) {
    return { status: "conflict", reason: `“${screenId}”页面已在提案后变化；为避免覆盖新内容，工程未修改。` };
  }

  const seen = new Set<string>();
  const componentIndices = new Map<string, number>();
  const screen = currentLayout.screens[currentScreenIndex];
  for (const edit of edits) {
    if (seen.has(edit.targetId)) {
      return { status: "conflict", reason: "提案重复修改同一控件；工程未修改。" };
    }
    seen.add(edit.targetId);
    const target = targets.get(edit.targetId);
    if (!target || target.screenId !== screenId || edit.screenId !== target.screenId) {
      return { status: "conflict", reason: "提案包含未由用户授权的控件；工程未修改。" };
    }
    const componentIndex = screen.components.findIndex((component) =>
      component.component_id === target.componentId);
    if (componentIndex < 0) {
      return { status: "conflict", reason: "已授权的控件不再存在；工程未修改。" };
    }
    const component = screen.components[componentIndex];
    if (component.component_type !== target.componentType
      || (target.label !== undefined && component.label !== target.label)
      || (target.rect !== undefined && stableSerialize(component.rect) !== stableSerialize(target.rect))) {
      return { status: "conflict", reason: "已授权控件与本地审核快照不一致；工程未修改。" };
    }
    if (edit.label !== undefined
      && (typeof edit.label !== "string" || !edit.label.trim() || edit.label.length > 160)) {
      return { status: "conflict", reason: "提案包含无效控件文字；工程未修改。" };
    }
    if (edit.rect !== undefined) {
      const before = component.rect;
      if (!before) return { status: "conflict", reason: "控件缺少位置基线；工程未修改。" };
      const rect = { ...before, ...edit.rect };
      if (!["x", "y", "width", "height"].every((key) =>
        typeof rect[key as keyof typeof rect] === "number" && Number.isFinite(rect[key as keyof typeof rect]))
        || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0
        || rect.width > 100 || rect.height > 100 || rect.x + rect.width > 100 || rect.y + rect.height > 100) {
        return { status: "conflict", reason: "提案的位置超出画布或尺寸范围；工程未修改。" };
      }
    }
    componentIndices.set(target.componentId, componentIndex);
  }

  const layout = structuredClone(currentLayout);
  const nextScreen = layout.screens[currentScreenIndex];
  for (const edit of edits) {
    const component = nextScreen.components[componentIndices.get(targets.get(edit.targetId)!.componentId)!];
    if (edit.label !== undefined) component.label = edit.label.trim();
    if (edit.rect !== undefined) component.rect = { ...component.rect!, ...edit.rect };
  }
  return { status: "ready", layout, expectedScreenSnapshot };
}

export function captureAssistantCreationLayoutBaseline(
  projectId: string,
  layout: UISkinLayout,
): AssistantCreationProjectBaseline {
  if (!projectId.trim()) throw new Error("工程编号为空，无法为创造草稿建立归属基线。");
  if (layout.layout_type !== "renpy") throw new Error("创造组件只能在“进阶”布局中建立工程合并基线。");
  const screens: AssistantCreationProjectBaseline["screens"] = {};
  for (const screen of layout.screens) {
    const snapshot = stableSerialize(screen);
    if (snapshot.length > 512_000) {
      throw new Error(`“${screen.screen_id}”页面布局过大，无法安全建立合并基线。`);
    }
    screens[screen.screen_id] = snapshot;
  }
  return { projectId, layoutType: "renpy", screens };
}

export function planAssistantCreationProjectMergeBatch(
  input: AssistantCreationMergeBatchPlanInput,
): AssistantCreationMergeBatchPlan {
  const { baseline, currentProjectId, currentLayout, currentAssets, items } = input;
  if (!baseline) {
    return { status: "conflict", reason: "此草稿没有生成时的工程页面基线；请在“进阶”布局中重新生成后再应用。" };
  }
  if (baseline.projectId !== currentProjectId) {
    return { status: "conflict", reason: "当前工程与草稿所属工程不同；草稿不能跨工程合并。" };
  }
  if (baseline.layoutType !== "renpy" || currentLayout.layout_type !== "renpy") {
    return { status: "conflict", reason: "当前布局类型已变化；请切回“进阶”布局后重新审核。" };
  }
  if (!Array.isArray(items) || items.length < 1 || items.length > 16) {
    return { status: "conflict", reason: "批量审核必须包含 1 至 16 个组件；工程未修改。" };
  }
  const itemIds = new Set<string>();
  const componentIds = new Set<string>();
  const expectedScreenSnapshots: Partial<Record<UILayoutScreenId, string>> = {};
  for (const item of items) {
    if (!item || typeof item.itemId !== "string" || !item.itemId.trim() || item.itemId.length > 160
      || itemIds.has(item.itemId)) {
      return { status: "conflict", reason: "批量审核中存在无效或重复的项目编号；工程未修改。" };
    }
    itemIds.add(item.itemId);
    if (!item.componentId || componentIds.has(item.componentId)) {
      return { status: "conflict", reason: "批量审核中存在空或重复的组件编号；工程未修改。" };
    }
    componentIds.add(item.componentId);
    const expectedScreenSnapshot = baseline.screens[item.screenId];
    if (!expectedScreenSnapshot) {
      return { status: "conflict", reason: `“${item.screenId}”页面没有生成时的基线；工程未修改。` };
    }
    const currentScreen = currentLayout.screens.find((screen) => screen.screen_id === item.screenId);
    if (!currentScreen) {
      return { status: "conflict", reason: `目标页面“${item.screenId}”已不存在；工程未修改。` };
    }
    if (stableSerialize(currentScreen) !== expectedScreenSnapshot) {
      return {
        status: "conflict",
        reason: `目标页面“${item.screenId}”自生成后已变化；为避免部分合并，整批已阻止。`,
      };
    }
  }

  // Capture the complete screen set at planning time. The baseline check above is
  // intentionally limited to reviewed pages, while this commit snapshot prevents
  // a concurrent edit to any other page from being silently overwritten.
  for (const screen of currentLayout.screens) {
    expectedScreenSnapshots[screen.screen_id] = stableSerialize(screen);
  }

  let layout = structuredClone(currentLayout);
  let assets = [...currentAssets];
  const mergedItems: Array<{ itemId: string; screenId: UILayoutScreenId; componentId: string }> = [];
  try {
    for (const item of items) {
      const merged = addPersonalComponentToProject(
        layout,
        item.screenId,
        {
          name: item.draft.name,
          definition: item.draft.definition,
          assets: item.draft.assets ?? [],
        },
        {
          componentId: item.componentId,
          rect: item.rect,
          createAssetId: input.createAssetId
            ? () => input.createAssetId!()
            : undefined,
        },
        assets,
      );
      layout = merged.layout;
      assets = merged.assets;
      mergedItems.push({
        itemId: item.itemId,
        screenId: item.screenId,
        componentId: item.componentId,
      });
    }
  } catch (error) {
    return {
      status: "conflict",
      reason: error instanceof Error
        ? `${error.message} 批量未应用，工程未修改。`
        : "批量组件未能安全合并；工程未修改。",
    };
  }
  return {
    status: "ready",
    layout,
    assets,
    expectedScreenSnapshots,
    expectedRuntimeUILayoutSnapshot: stableSerialize(currentLayout),
    expectedAssetManifestSnapshot: stableSerialize(currentAssets),
    items: mergedItems,
  };
}

export function planAssistantCreationProjectMerge(
  input: AssistantCreationMergePlanInput,
): AssistantCreationMergePlan {
  const { baseline, currentProjectId, currentLayout, targetScreenId } = input;
  if (!baseline) {
    return { status: "conflict", reason: "此草稿没有生成时的工程页面基线；请在“进阶”布局中重新生成后再应用。" };
  }
  if (baseline.projectId !== currentProjectId) {
    return { status: "conflict", reason: "当前工程与草稿所属工程不同；草稿不能跨工程合并。" };
  }
  if (baseline.layoutType !== "renpy" || currentLayout.layout_type !== "renpy") {
    return { status: "conflict", reason: "当前布局类型已变化；请切回“进阶”布局后重新审核。" };
  }
  const expectedScreenSnapshot = baseline.screens[targetScreenId];
  const currentScreen = currentLayout.screens.find((screen) => screen.screen_id === targetScreenId);
  if (!expectedScreenSnapshot || !currentScreen) {
    return { status: "conflict", reason: "生成时或当前布局中不存在所选目标页面。" };
  }
  if (stableSerialize(currentScreen) !== expectedScreenSnapshot) {
    return { status: "conflict", reason: `目标页面“${targetScreenId}”自草稿生成后已变化；为避免覆盖新内容，已阻止合并。` };
  }

  try {
    const merged = addPersonalComponentToProject(
      currentLayout,
      targetScreenId,
      {
        name: input.draft.name,
        definition: input.draft.definition,
        assets: input.draft.assets ?? [],
      },
      {
        componentId: input.componentId,
        rect: input.rect,
        createAssetId: input.createAssetId,
      },
      input.currentAssets,
    );
    return {
      status: "ready",
      layout: merged.layout,
      assets: merged.assets,
      expectedScreenSnapshot,
    };
  } catch (error) {
    return {
      status: "conflict",
      reason: error instanceof Error ? error.message : "组件未能安全合并；工程未被修改。",
    };
  }
}
