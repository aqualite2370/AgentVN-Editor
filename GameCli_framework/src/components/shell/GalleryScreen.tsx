import { Lock } from "lucide-react";
import { useState } from "react";
import { useRuntimeStore } from "../../store/runtimeStore";
import { assetResolver } from "../../engine/assetResolver";
import { useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { UILayoutOpacitySurface } from "../../uiSkin/UILayoutOpacitySurface";
import type { GalleryItem } from "../../types/gallery";
import { ScreenBackButton } from "./ScreenBackButton";
import { RenpyMenuFrame } from "./RenpyMenuFrame";
import { Button } from "../common/Button";

function GalleryItemView({ item, imageUrl }: { item: GalleryItem; imageUrl?: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const failed = item.unlocked && Boolean(item.asset_id) && (!imageUrl || imageFailed);
  const retry = () => {
    setImageFailed(false);
    setAttempt(value => value + 1);
  };
  return (
    <article
      className={item.unlocked ? "gallery-item" : "gallery-item locked"}
      data-testid={`gallery-item-${item.item_id}`}
      aria-label={item.unlocked ? `已解锁：${item.title}` : "未解锁画廊条目"}
    >
      <Button
        className="gallery-replay"
        disabled={!item.unlocked || !item.anchor_id}
        onClick={() => item.anchor_id && void useRuntimeStore.getState().openGalleryAnchor(item.anchor_id)}
        aria-label={item.unlocked ? `读取画廊-${item.title}` : "未解锁画廊"}
      >
        {item.unlocked && item.asset_id
          ? <img key={attempt} src={imageUrl} alt="" onError={() => setImageFailed(true)} />
          : <div>?</div>}
        <span>{item.unlocked ? item.title : "未解锁"}</span>
        {item.unlocked && item.description && <small>{item.description}</small>}
      </Button>
      {failed && (
        <section className="gallery-resource-status" aria-label="画廊图片加载状态">
          <p className="inline-error" role="alert" data-testid="gallery-resource-error">
            无法加载画廊图片，资源可能缺失或损坏。仍可尝试回放或返回。
          </p>
          <Button onClick={retry} aria-label="重试加载画廊图片">重试加载图片</Button>
        </section>
      )}
      {!item.unlocked && (
        <span className="gallery-item-lock" aria-hidden="true">
          <Lock size={34} strokeWidth={1.8} />
        </span>
      )}
    </article>
  );
}

export function GalleryScreen() {
  const game = useRuntimeStore((state) => state.currentGame);
  const gridLayout = useUILayoutStyle("gallery", "gallery_grid");
  const entryError = useRuntimeStore((state) => state.entryError);
  const items: GalleryItem[] = game?.gallery.length
    ? game.gallery
    : Array.from({ length: 8 }, (_, index) => ({ item_id: `placeholder_${index}`, title: "未解锁", unlocked: false, asset_id: "" }));

  return (
    <RenpyMenuFrame activeScreen="gallery" className="screen-panel" aria-label="画廊" data-testid="gallery-screen" data-runtime-screen="gallery">
      <header>
        <ScreenBackButton testId="back-to-main-menu" label="返回" onClick={() => useRuntimeStore.getState().closeMenu()} />
      </header>
      {entryError && <p role="alert" className="inline-error">{entryError}</p>}
      <UILayoutOpacitySurface className="gallery-grid ui-layouted" style={gridLayout.style} presentationComponent={gridLayout.component}>
        {items.map((item) => (
          <GalleryItemView
            key={`${game?.install_id}:${item.item_id}:${item.asset_id}:${assetResolver.resolveAsset(item.asset_id) ?? ""}`}
            item={item}
            imageUrl={assetResolver.resolveAsset(item.asset_id)}
          />
        ))}
      </UILayoutOpacitySurface>
    </RenpyMenuFrame>
  );
}
