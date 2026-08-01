import { Layers, Palette, RotateCcw, Save, Users } from "lucide-react";
import { useState, type CSSProperties } from "react";
import type { DialogCommand } from "../../types/commands";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import { backgroundFitOptions, characterSideOptions } from "../../utils/localizedOptions";
import { FieldHelp } from "../common/FieldHelp";
import { AssetPicker } from "../common/AssetPicker";
import { ColorPickerDialog } from "../common/ColorPickerDialog";
import { RichSelect } from "../common/RichSelect";
import { DialogTextStyleControls, pickDialogTextStyle } from "./DialogTextStyleControls";

type DialogStyle = NonNullable<DialogCommand["dialog_style"]>;

function cleanDialogStyle(style: DialogStyle | null | undefined): DialogStyle | null {
  const backgroundAssetId = style?.background_asset_id?.trim() || null;
  const backgroundFit = style?.background_fit === "stretch" || style?.background_fit === "contain" || style?.background_fit === "cover"
    ? style.background_fit
    : null;
  const themeColor = /^#[0-9a-f]{6}$/i.test(style?.theme_color ?? "") ? String(style?.theme_color).toLowerCase() : null;
  const textColor = /^#[0-9a-f]{6}$/i.test(style?.text_color ?? "") ? String(style?.text_color).toLowerCase() : null;
  const fontSize = typeof style?.font_size === "number" && Number.isFinite(style.font_size) ? Math.min(96, Math.max(10, Math.round(style.font_size))) : null;
  const fontWeight = typeof style?.font_weight === "number" && Number.isFinite(style.font_weight) ? Math.min(900, Math.max(100, Math.round(style.font_weight / 50) * 50)) : null;
  const fontStyle = style?.font_style === "normal" || style?.font_style === "italic" ? style.font_style : null;
  return backgroundAssetId || backgroundFit || themeColor || textColor || fontSize || fontWeight || fontStyle
    ? { background_asset_id: backgroundAssetId, background_fit: backgroundFit, theme_color: themeColor, text_color: textColor, font_size: fontSize, font_weight: fontWeight, font_style: fontStyle }
    : null;
}

export function DialogCommandEditor({ command, onChange }: { command: DialogCommand; onChange: (command: DialogCommand) => void }) {
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const applyDialogPortraitToCharacter = useEditorStore((state) => state.applyDialogPortraitToCharacter);
  const applyDialogTextStyleToCharacter = useEditorStore((state) => state.applyDialogTextStyleToCharacter);
  const setNotice = useEditorStore((state) => state.setNotice);
  const characterDialogStyles = useProjectStore((state) => state.settings.characterDialogStyles);
  const setCharacterDialogStyle = useProjectStore((state) => state.setCharacterDialogStyle);
  const characterId = command.character_id.trim();
  const characterDefaultStyle = characterId ? characterDialogStyles[characterId] : undefined;
  const isManualStyle = command.dialog_style_mode === "manual" || Boolean(command.dialog_style);
  const effectiveStyle: DialogStyle = cleanDialogStyle(isManualStyle ? command.dialog_style : characterDefaultStyle) ?? {};

  function setManualStyle(partial: DialogStyle) {
    const nextStyle = cleanDialogStyle({ ...effectiveStyle, ...partial });
    onChange({
      ...command,
      dialog_style_mode: "manual",
      dialog_style: nextStyle,
    });
  }

  function saveAsCharacterDefault() {
    if (!characterId) return;
    setCharacterDialogStyle(characterId, cleanDialogStyle(effectiveStyle));
  }

  function clearCharacterDefault() {
    if (!characterId) return;
    setCharacterDialogStyle(characterId, null);
  }

  function applyPortraitToCharacterDialogs() {
    const portrait = command.portrait?.trim();
    if (!characterId || !portrait) return;
    const changedCount = applyDialogPortraitToCharacter(characterId, portrait);
    setNotice(
      changedCount > 0
        ? `已将 ${portrait} 应用到 ${characterId} 的 ${changedCount} 条对白。`
        : `${characterId} 的对白头像已经全部是 ${portrait}。`,
      changedCount > 0 ? "success" : "info",
    );
  }


  function applyTextStyleToCharacterDialogs() {
    if (!characterId) return;
    const textStyle = pickDialogTextStyle(effectiveStyle);
    const ok = window.confirm(`确认将当前文字大小和样式应用到角色「${characterId}」的全部对白吗？这会覆盖该角色所有对白命令的文字样式。`);
    if (!ok) return;
    const changedCount = applyDialogTextStyleToCharacter(characterId, textStyle);
    setNotice(
      changedCount > 0
        ? `已将当前文字样式应用到 ${characterId} 的 ${changedCount} 条对白。`
        : `${characterId} 没有可更新的对白。`,
      changedCount > 0 ? "success" : "info",
    );
  }
  return (
    <div className="form-grid">
      <label>角色编号 <FieldHelp field="character_id" /><input value={command.character_id} data-help-key="command.dialog.characterId" onChange={(e) => onChange({ ...command, character_id: e.target.value })} /></label>
      <label>台词文本 <FieldHelp field="text" /><textarea value={command.text} data-help-key="command.dialog.text" onChange={(e) => onChange({ ...command, text: e.target.value })} /></label>
      <label>情绪 / 表情 <FieldHelp field="emotion" /><input value={command.emotion ?? ""} data-help-key="command.dialog.emotion" onChange={(e) => onChange({ ...command, emotion: e.target.value })} /></label>
      <AssetPicker
        label="头像素材"
        field="portrait"
        value={command.portrait ?? ""}
        allowedTypes={["portrait"]}
        helpKey="command.dialog.portrait"
        onChange={(assetId) => onChange({ ...command, portrait: assetId || null })}
      />
      <div className="dialog-portrait-actions">
        <button
          type="button"
          data-help-key="command.dialog.portrait.applyAll"
          disabled={!characterId || !command.portrait?.trim()}
          onClick={applyPortraitToCharacterDialogs}
        >
          <Users size={15} />
          应用到该角色全部对白
        </button>
      </div>
      <AssetPicker
        label="语音素材"
        field="voice"
        value={command.voice ?? ""}
        allowedTypes={["voice"]}
        helpKey="command.dialog.voice"
        emptyLabel="暂无可用语音素材"
        onChange={(assetId) => onChange({ ...command, voice: assetId || null })}
      />
      <label>
        显示位置 <FieldHelp field="side" />
        <RichSelect
          value={command.side ?? ""}
          options={[{ value: "", label: "未设置" }, ...characterSideOptions]}
          helpKey="command.dialog.side"
          onChange={(nextSide) => onChange({ ...command, side: nextSide === "" ? null : nextSide as DialogCommand["side"] })}
        />
      </label>
      <section className={`dialog-visual-style-panel${isManualStyle ? " is-manual" : " is-inherit"}`}>
        <header>
          <div>
            <strong><Palette size={16} /> 对白外观</strong>
            <span>{isManualStyle ? "本句手动覆盖" : characterDefaultStyle ? "继承角色默认" : "继承玩家端 UI skin"}</span>
          </div>
          <button
            type="button"
            data-help-key="command.dialog.style.restoreInherit"
            disabled={!isManualStyle}
            onClick={() => onChange({ ...command, dialog_style_mode: "inherit", dialog_style: null })}
          >
            <RotateCcw size={15} />
            恢复继承
          </button>
        </header>
        <div className="dialog-visual-grid">
          <AssetPicker
            label="对白框底图"
            field="dialog_style.background_asset_id"
            value={effectiveStyle.background_asset_id ?? ""}
            allowedTypes={["ui"]}
            helpKey="command.dialog.style.background"
            emptyLabel="暂无可用 UI 底图"
            onChange={(assetId) => setManualStyle({ ...effectiveStyle, background_asset_id: assetId || null })}
          />
          <label>
            对白框底图显示模式
            <RichSelect
              ariaLabel="对白框底图显示模式"
              value={effectiveStyle.background_fit ?? "cover"}
              options={backgroundFitOptions}
              helpKey="command.dialog.style.backgroundFit"
              variant="compact"
              onChange={(backgroundFit) => setManualStyle({ ...effectiveStyle, background_fit: backgroundFit })}
            />
          </label>
          <div className="dialog-theme-color-control">
            <span>主题色</span>
            <button
              type="button"
              className="dialog-color-button"
              data-help-key="command.dialog.style.color"
              style={{ "--dialog-style-color": effectiveStyle.theme_color ?? "#d58a72" } as CSSProperties}
              onClick={() => setColorPickerOpen(true)}
            >
              <span aria-hidden="true" />
              {effectiveStyle.theme_color ?? "未设置"}
            </button>
            <small>打开调色盘后会自动把本句设为手动覆盖；保存为角色默认不会覆盖已有手动句。</small>
          </div>
          <DialogTextStyleControls
            title="对白文字大小和样式"
            value={pickDialogTextStyle(effectiveStyle)}
            onChange={(nextTextStyle) => setManualStyle({ ...effectiveStyle, ...nextTextStyle })}
          />
        </div>
        <div className="dialog-visual-actions">
          <button type="button" data-help-key="command.dialog.style.manual" onClick={() => setManualStyle(effectiveStyle)}>
            <Layers size={15} />
            本句单独覆盖
          </button>
          <button type="button" data-help-key="command.dialog.style.saveDefault" disabled={!characterId} onClick={saveAsCharacterDefault}>
            <Save size={15} />
            设为角色默认
          </button>
          <button type="button" data-help-key="command.dialog.style.clearDefault" disabled={!characterId || !characterDefaultStyle} onClick={clearCharacterDefault}>
            清除角色默认
          </button>
          <button type="button" data-help-key="command.dialog.style.manual" disabled={!characterId} onClick={applyTextStyleToCharacterDialogs}>
            <Users size={15} />
            {"\u5e94\u7528\u6587\u5b57\u6837\u5f0f\u5230\u8be5\u89d2\u8272\u5168\u90e8\u5bf9\u767d"}
          </button>
        </div>
        <ColorPickerDialog
          open={colorPickerOpen}
          title={`${characterId || "角色"}对白主题色`}
          value={effectiveStyle.theme_color}
          onClose={() => setColorPickerOpen(false)}
          onApply={(nextColor) => {
            setColorPickerOpen(false);
            setManualStyle({ ...effectiveStyle, theme_color: nextColor });
          }}
        />
      </section>
      <AssetPicker
        label="文本字体覆写"
        field="font_asset_id"
        value={command.font_asset_id ?? ""}
        allowedTypes={["font"]}
        helpKey="command.dialog.font"
        emptyLabel="暂无可用字体"
        onChange={(assetId) => onChange({ ...command, font_asset_id: assetId || null })}
      />
    </div>
  );
}
