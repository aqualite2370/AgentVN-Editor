import { isBuiltinTitleButton, type UILayoutComponent, type UILayoutScreenId } from "../../../shared/cartridge/uiSkin";
import { RENPY_BUTTON_ROLE_PAGES, type RenpyGUI } from "../../../shared/cartridge/renpyGui";
import { prepareRenpyGuiImport, type PrepareRenpyGuiImportOptions, type RenpyGuiAssetBinding } from "./renpyGuiImportPlan";

export type GuiPackScope = { kind: "project" } | { kind: "page"; screenId: UILayoutScreenId }
  | { kind: "control"; screenId: UILayoutScreenId; componentId: string;
    state: "normal" | "hover" | "selected" | "disabled" };
export type GuiPackBinding = RenpyGuiAssetBinding | "control_background";
export function guiPackParameterAllowed(scope: GuiPackScope, key: string): boolean {
  if (scope.kind === "project") return true;
  if (scope.kind === "control") return false;
  if (!(RENPY_BUTTON_ROLE_PAGES as readonly string[]).includes(scope.screenId)) return false;
  const [page, field] = key.split(".");
  if (["buttonImages", "buttonTextColors", "buttonBorders", "buttonTile", "buttonRoles"].includes(field)) return false;
  return page === "shared" || page === scope.screenId;
}
function applyImage(component: UILayoutComponent, image: string, state = "normal") {
  if (component.locked) throw new Error(`GUI_PACK_TARGET_LOCKED: ${component.label || component.component_id}`);
  if (isBuiltinTitleButton(component) && component.titleButtonStyleSource !== "layout") {
    component.style = undefined; component.titleButtonStyleSource = "layout";
  }
  if (state === "normal") component.style = { ...component.style, backgroundImage: image };
  else component.stateStyles = { ...component.stateStyles,
    [state]: { ...component.stateStyles?.[state as "hover" | "selected" | "disabled"], backgroundImage: image } };
}
/** Pure preparation: all checks complete before the caller publishes layout/assets together. */
export function prepareGuiPackApplication(options: Omit<PrepareRenpyGuiImportOptions, "assetBindings"> & {
  scope: GuiPackScope; assetBindings: Record<string, GuiPackBinding | undefined>;
}) {
  const { scope } = options;
  const selections = Object.fromEntries(Object.entries(options.parameterSelection)
    .filter(([key, selected]) => selected && guiPackParameterAllowed(scope, key)));
  const incompatible = Object.entries(options.parameterSelection).filter(([key, selected]) =>
    selected && !guiPackParameterAllowed(scope, key));
  if (incompatible.length) throw new Error(`GUI_PACK_SCOPE_PARAMETERS: 当前范围不能应用 ${incompatible.map(([key]) => key).join("、")}。`);
  // Both layout profiles can reference the same asset ID. Even project-wide
  // styling must copy bytes so the inactive profile and manual edits stay intact.
  if (Object.values(options.assetSelection).includes("replace"))
    throw new Error("GUI_PACK_SCOPE_REPLACE: 资源包应用只允许复制新素材，不能替换其它控件或布局共用的字节。");
  if (scope.kind === "project") {
    if (Object.values(options.assetBindings).includes("control_background"))
      throw new Error("GUI_PACK_SCOPE_BINDING: 请先选择具体控件。");
    const result = prepareRenpyGuiImport({ ...options, parameterSelection: selections,
      assetBindings: options.assetBindings as Record<string, RenpyGuiAssetBinding | undefined> });
    return { ...result, targets: ["当前Ren’Py布局的已选参数与用途；其它布局不变"] };
  }
  const originalScreen = options.layout.screens.find(screen => screen.screen_id === scope.screenId);
  if (!originalScreen) throw new Error("GUI_PACK_TARGET_MISSING: 目标页面不存在。");
  if (scope.kind === "control" && !originalScreen.components.some(component => component.component_id === scope.componentId))
    throw new Error("GUI_PACK_TARGET_MISSING: 目标控件不存在。");
  // Import selected dependencies first, using no global bindings or parameters.
  const result = prepareRenpyGuiImport({ ...options, parameterSelection: {}, assetBindings: {} });
  if (options.layout.renpy === undefined) delete result.layout.renpy;
  else result.layout.renpy = structuredClone(options.layout.renpy);
  const targetScreen = result.layout.screens.find(screen => screen.screen_id === scope.screenId)!;
  const targets: string[] = [];
  let nextAssetIndex = 0;
  const claimed = new Set<string>();
  for (const candidate of options.scan.assets) {
    const choice = options.assetSelection[candidate.path] ?? "skip";
    const binding = options.assetBindings[candidate.path];
    if (choice === "skip") {
      if (binding) throw new Error(`GUI_PACK_SOURCE_SKIPPED: 请选中要绑定的素材 ${candidate.path}。`);
      continue;
    }
    const assetId = result.importedAssetIds[nextAssetIndex++];
    if (!binding) continue;
    if (candidate.kind !== "image" || binding === "interface_font") throw new Error("GUI_PACK_SCOPE_FONT: 界面字体只允许在工程范围应用。");
    let controls: UILayoutComponent[], state = scope.kind === "control" ? scope.state : "normal";
    if (scope.kind === "control") {
      if (binding !== "control_background") throw new Error("GUI_PACK_SCOPE_BINDING: 单控件范围请选择“当前控件背景”。");
      controls = targetScreen.components.filter(component => component.component_id === scope.componentId);
    } else if (binding.startsWith("button_")) {
      state = binding === "button_hover" ? "hover" : binding === "button_selected" ? "selected"
        : binding === "button_disabled" ? "disabled" : "normal";
      controls = targetScreen.components.filter(component => !component.locked
        && (component.component_type.includes("button") || component.component_type === "choice_option"));
    } else {
      const id = { title_background: "title_hero", dialog_panel: "dialog_panel", choice_button: "choice_option" }[binding as "title_background"];
      controls = targetScreen.components.filter(component => component.component_id === id);
    }
    if (!controls.length) throw new Error(`GUI_PACK_SCOPE_BINDING: 目标页面没有对应控件：${binding}。`);
    for (const component of controls) {
      const key = `${component.component_id}:${state}`;
      if (claimed.has(key)) throw new Error(`GUI_PACK_BINDING_CONFLICT: 多个素材指向 ${key}，请只保留一个。`);
      claimed.add(key);
      applyImage(component, `asset:${assetId}`, state);
      targets.push(`${targetScreen.screen_id} / ${component.label || component.component_id} / ${state}`);
    }
  }
  if (scope.kind === "page" && Object.keys(selections).length) {
    const values: RenpyGUI = {};
    for (const [source, fields] of Object.entries(options.scan.parameters.values)) {
      for (const [key, value] of Object.entries(fields ?? {})) if (selections[`${source}.${key}`]) {
        values[scope.screenId as keyof RenpyGUI] ??= {};
        const pageValues = values[scope.screenId as keyof RenpyGUI]!;
        if (Object.prototype.hasOwnProperty.call(pageValues, key))
          throw new Error(`GUI_PACK_PARAMETER_CONFLICT: 多个参数映射到 ${scope.screenId}.${key}，请只选择一个来源。`);
        Object.assign(pageValues, { [key]: value });
        targets.push(`${scope.screenId} / ${key}`);
      }
    }
    result.layout.renpy = { ...result.layout.renpy,
      [scope.screenId]: { ...result.layout.renpy?.[scope.screenId as keyof RenpyGUI],
        ...values[scope.screenId as keyof RenpyGUI] } };
    result.appliedParameters = Object.keys(selections);
  }
  return { ...result, targets };
}
