import { ArrowLeft } from "lucide-react";
import { useRuntimeStore } from "../../store/runtimeStore";
import { useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { Button } from "../common/Button";

export function GalleryScreen() {
  const game = useRuntimeStore((state) => state.currentGame);
  const gridLayout = useUILayoutStyle("gallery", "gallery_grid");
  const items = game?.gallery.length
    ? game.gallery
    : Array.from({ length: 8 }, (_, index) => ({ item_id: `placeholder_${index}`, title: "未解锁", unlocked: false, asset_id: "" }));

  return (
    <main className="screen-panel" aria-label="画廊" data-testid="gallery-screen" data-runtime-screen="gallery">
      <header>
        <h2>画廊</h2>
        <Button aria-label="返回主菜单" data-testid="back-to-main-menu" onClick={() => useRuntimeStore.getState().closeMenu()}>
          <ArrowLeft size={17} /> 返回
        </Button>
      </header>
      <div className="gallery-grid ui-layouted" style={gridLayout.style}>
        {items.map((item) => (
          <article className={item.unlocked ? "gallery-item" : "gallery-item locked"} key={item.item_id}>
            <div>{item.unlocked ? item.title : "?"}</div>
            <span>{item.title}</span>
          </article>
        ))}
      </div>
    </main>
  );
}
