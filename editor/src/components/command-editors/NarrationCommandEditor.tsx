import { Users } from "lucide-react";
import type { NarrationCommand } from "../../types/commands";
import { useEditorStore } from "../../store/editorStore";
import { backgroundFitOptions } from "../../utils/localizedOptions";
import { FieldHelp } from "../common/FieldHelp";
import { AssetPicker } from "../common/AssetPicker";
import { RichSelect } from "../common/RichSelect";
import { DialogTextStyleControls, pickDialogTextStyle } from "./DialogTextStyleControls";

type NarrationStyle = NonNullable<NarrationCommand["dialog_style"]>;

function cleanNarrationStyle(style: NarrationStyle | null | undefined): NarrationStyle | null {
  const backgroundAssetId = style?.background_asset_id?.trim() || null;
  const backgroundFit = style?.background_fit === "stretch" || style?.background_fit === "contain" || style?.background_fit === "cover"
    ? style.background_fit
    : null;
  const textColor = /^#[0-9a-f]{6}$/i.test(style?.text_color ?? "") ? String(style?.text_color).toLowerCase() : null;
  const fontSize = typeof style?.font_size === "number" && Number.isFinite(style.font_size) ? Math.min(96, Math.max(10, Math.round(style.font_size))) : null;
  const fontWeight = typeof style?.font_weight === "number" && Number.isFinite(style.font_weight) ? Math.min(900, Math.max(100, Math.round(style.font_weight / 50) * 50)) : null;
  const fontStyle = style?.font_style === "normal" || style?.font_style === "italic" ? style.font_style : null;
  return backgroundAssetId || backgroundFit || textColor || fontSize || fontWeight || fontStyle
    ? { ...(style ?? {}), background_asset_id: backgroundAssetId, background_fit: backgroundFit, text_color: textColor, font_size: fontSize, font_weight: fontWeight, font_style: fontStyle }
    : null;
}

export function NarrationCommandEditor({ command, onChange }: { command: NarrationCommand; onChange: (command: NarrationCommand) => void }) {
  const applyNarrationStyleToAll = useEditorStore((state) => state.applyNarrationStyleToAll);
  const setNotice = useEditorStore((state) => state.setNotice);
  const effectiveStyle: NarrationStyle = cleanNarrationStyle(command.dialog_style) ?? {};

  function setManualStyle(partial: NarrationStyle) {
    onChange({
      ...command,
      dialog_style_mode: "manual",
      dialog_style: cleanNarrationStyle({ ...effectiveStyle, ...partial }),
    });
  }

  function applyStyleToAllNarrations() {
    const style = cleanNarrationStyle(effectiveStyle);
    if (!style) {
      setNotice("\u8bf7\u5148\u8bbe\u7f6e\u65c1\u767d\u6846\u5e95\u56fe\u3001\u663e\u793a\u6a21\u5f0f\u6216\u6587\u5b57\u6837\u5f0f\u3002", "warning");
      return;
    }
    const changedCount = applyNarrationStyleToAll(style);
    setNotice(
      changedCount > 0
        ? `\u5df2\u5c06\u5f53\u524d\u65c1\u767d\u5916\u89c2\u5e94\u7528\u5230 ${changedCount} \u6761\u65c1\u767d\u3002`
        : "\u6240\u6709\u65c1\u767d\u5df2\u4f7f\u7528\u5f53\u524d\u5916\u89c2\u3002",
      changedCount > 0 ? "success" : "info",
    );
  }

  return (
    <div className="form-grid">
      <label>{"\u65c1\u767d\u6587\u672c"} <FieldHelp field="text" /><textarea value={command.text} data-help-key="command.narration.text" onChange={(e) => onChange({ ...command, text: e.target.value })} /></label>
      <AssetPicker
        label={"\u65c1\u767d\u6846\u5e95\u56fe"}
        field="dialog_style.background_asset_id"
        value={effectiveStyle.background_asset_id ?? ""}
        allowedTypes={["ui"]}
        helpKey="command.narration.style.background"
        emptyLabel={"\u6682\u65e0\u53ef\u7528 UI \u5e95\u56fe"}
        onChange={(assetId) => setManualStyle({ ...effectiveStyle, background_asset_id: assetId || null })}
      />
      <label>
        {"\u65c1\u767d\u6846\u5e95\u56fe\u663e\u793a\u6a21\u5f0f"}
        <RichSelect
          ariaLabel={"\u65c1\u767d\u6846\u5e95\u56fe\u663e\u793a\u6a21\u5f0f"}
          value={effectiveStyle.background_fit ?? "cover"}
          options={backgroundFitOptions}
          helpKey="command.narration.style.backgroundFit"
          variant="compact"
          onChange={(backgroundFit) => setManualStyle({ ...effectiveStyle, background_fit: backgroundFit })}
        />
      </label>
      <DialogTextStyleControls
        title={"\u65c1\u767d\u6587\u5b57\u5927\u5c0f\u548c\u6837\u5f0f"}
        value={pickDialogTextStyle(effectiveStyle)}
        onChange={(nextTextStyle) => setManualStyle({ ...effectiveStyle, ...nextTextStyle })}
      />
      <div className="dialog-visual-actions">
        <button
          type="button"
          data-help-key="command.narration.style.applyAll"
          disabled={!cleanNarrationStyle(effectiveStyle)}
          onClick={applyStyleToAllNarrations}
        >
          <Users size={15} />
          {"\u5e94\u7528\u65c1\u767d\u5916\u89c2\u5230\u5168\u90e8\u65c1\u767d"}
        </button>
      </div>
      <AssetPicker
        label={"\u6587\u672c\u5b57\u4f53\u8986\u5199"}
        field="font_asset_id"
        value={command.font_asset_id ?? ""}
        allowedTypes={["font"]}
        helpKey="command.narration.font"
        emptyLabel={"\u6682\u65e0\u53ef\u7528\u5b57\u4f53"}
        onChange={(assetId) => onChange({ ...command, font_asset_id: assetId || null })}
      />
    </div>
  );
}
