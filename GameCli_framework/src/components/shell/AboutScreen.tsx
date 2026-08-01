import { ArrowLeft } from "lucide-react";
import { useRuntimeStore } from "../../store/runtimeStore";
import { useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { Button } from "../common/Button";

function textOrFallback(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

export function AboutScreen() {
  const game = useRuntimeStore((state) => state.currentGame);
  const runtimeMode = useRuntimeStore((state) => state.runtimeMode);
  const aboutLayout = useUILayoutStyle("about", "about_panel");
  const aboutCopy = game?.manifest.shell?.about;
  const modeDescription = runtimeMode === "preview"
    ? "编辑器预览模式：当前内容来自临时卡带。"
    : runtimeMode === "fixed"
      ? "固定卡带模式：此发布包只运行内置卡带。"
      : "卡带库模式：可以导入、移除和切换多张 .vncart 卡带。";
  const fields = aboutCopy?.fields?.filter((field) => field.label?.trim() || field.value?.trim()) ?? [];
  const title = textOrFallback(aboutCopy?.title, "关于");

  return (
    <main className="screen-panel" aria-label={title} data-testid="about-screen" data-runtime-screen="about">
      <header>
        <h2>{title}</h2>
        <Button aria-label="返回主菜单" data-testid="back-to-main-menu" onClick={() => useRuntimeStore.getState().closeMenu()}>
          <ArrowLeft size={17} /> 返回
        </Button>
      </header>
      <section className="about-card ui-layouted" style={aboutLayout.style}>
        <span className="panel-kicker">{textOrFallback(aboutCopy?.kicker, "GameCLI Framework")}</span>
        <h1>{textOrFallback(aboutCopy?.heading, game?.title ?? "AgentVN 玩家端")}</h1>
        <p>{textOrFallback(aboutCopy?.description, game?.description ?? "独立视觉小说卡带播放器。导入 .vncart 后，卡带和存档会保存在本机玩家库中。")}</p>
        {fields.length > 0 ? (
          <dl>
            {fields.map((field, index) => (
              <div key={`${field.label ?? "field"}-${index}`} className="about-field-row">
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="inline-note">暂无字段，请前往编辑器设置文本。</p>
        )}
        <p className="inline-note">{textOrFallback(aboutCopy?.note, modeDescription)}</p>
      </section>
    </main>
  );
}
