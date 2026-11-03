import { useRuntimeStore } from "../../store/runtimeStore";
import { useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { UILayoutOpacitySurface } from "../../uiSkin/UILayoutOpacitySurface";
import { ScreenBackButton } from "./ScreenBackButton";
import { RenpyMenuFrame } from "./RenpyMenuFrame";

function textOrFallback(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

export function AboutScreen() {
  const game = useRuntimeStore((state) => state.currentGame);
  const presentationMode = useRuntimeStore((state) => state.presentationMode);
  const aboutLayout = useUILayoutStyle("about", "about_panel");
  const aboutCopy = game?.manifest.shell?.about;
  const fields = aboutCopy?.fields?.filter((field) => field.label?.trim() || field.value?.trim()) ?? [];
  const title = textOrFallback(aboutCopy?.title, "关于");
  const kicker = textOrFallback(aboutCopy?.kicker, "作品信息");
  const note = aboutCopy?.note?.trim();

  return (
    <RenpyMenuFrame activeScreen="about" className="screen-panel about-screen-shell" aria-label={title} data-testid="about-screen" data-runtime-screen="about" data-presentation-mode={presentationMode}>
      <header>
        <ScreenBackButton label="返回主菜单" testId="back-to-main-menu" onClick={() => useRuntimeStore.getState().closeMenu()} />
      </header>
      <UILayoutOpacitySurface as="section" className="about-card ui-layouted" style={aboutLayout.style} presentationComponent={aboutLayout.component}>
        <div className="about-card-content">
          <h2 className="about-page-title">{title}</h2>
          <div className="about-intro">
            <span className="panel-kicker">{kicker}</span>
            <h1>{textOrFallback(aboutCopy?.heading, game?.title ?? "AgentVN 玩家端")}</h1>
            <p>{textOrFallback(aboutCopy?.description, game?.description ?? "视觉小说作品信息。")}</p>
          </div>
          {fields.length > 0 && (
            <dl className="about-field-list">
              {fields.map((field, index) => (
                <div key={`${field.label ?? "field"}-${index}`} className="about-field-row">
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {fields.length === 0 && <p className="runtime-about-fields-empty">暂无字段，请前往编辑器设置文本。</p>}
          {note && <p className="inline-note about-note">{note}</p>}
        </div>
      </UILayoutOpacitySurface>
    </RenpyMenuFrame>
  );
}
