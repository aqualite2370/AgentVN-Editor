import { Lock } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useRuntimeStore } from "../../store/runtimeStore";
import { assetResolver } from "../../engine/assetResolver";
import { useUILayoutStyle, useRuntimeUILayout, useUILayoutFrameSize, useRenpyButtonRoleStyle } from "../../uiSkin/uiSkinRuntime";
import { PresentedControl } from "../../uiSkin/PresentedControl";
import type { UILayoutComponent } from "../../../../shared/cartridge/uiSkin";
import { UILayoutOpacitySurface } from "../../uiSkin/UILayoutOpacitySurface";
import type { GalleryItem } from "../../types/gallery";
import { ScreenBackButton } from "./ScreenBackButton";
import { RenpyMenuFrame } from "./RenpyMenuFrame";
import { Button } from "../common/Button";
import { SavePageTransition, type SavePageTransitionHandle } from "./SavePageTransition";

function GalleryItemView({ item, imageUrl, component }: { item: GalleryItem; imageUrl?: string; component?: UILayoutComponent }) {
  const layout = useRuntimeUILayout();
  const frame = useUILayoutFrameSize();
  const assetUrls = useRuntimeStore(state => state.currentGame?.assetUrls);
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
      <PresentedControl layout={layout} component={component} assetUrls={assetUrls}
        scale={Math.min(frame.width / 1280, frame.height / 720)}>
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
        {item.unlocked && item.description && <small className="gallery-item-description">{item.description}</small>}
      </Button>
      </PresentedControl>
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
  const itemLayout = useUILayoutStyle("gallery", "gallery_item");
  const paginationLayout = useUILayoutStyle("gallery", "gallery_pagination");
  const layout = useRuntimeUILayout();
  const frame = useUILayoutFrameSize();
  const categoryRole = useRenpyButtonRoleStyle("category_pagination", "gallery", "var(--renpy-menu-scale)");
  const scale = Math.min(frame.width / 1280, frame.height / 720);
  const pageTransition = useRef<SavePageTransitionHandle>(null);
  const navigation = useRef<HTMLElement>(null);
  const restoreFocus = useRef(false);
  const [selection, setSelection] = useState({ installId: game?.install_id, page: 0 });
  const entryError = useRuntimeStore((state) => state.entryError);
  const items: GalleryItem[] = game?.gallery.length
    ? game.gallery
    : Array.from({ length: 8 }, (_, index) => ({ item_id: `placeholder_${index}`, title: "未解锁", unlocked: false, asset_id: "" }));
  const columns = Math.max(1, Math.min(8, Math.round(gridLayout.component?.style?.columns ?? 4)));
  const rows = Math.max(1, Math.min(8, Math.round(gridLayout.component?.style?.rows ?? 2)));
  const pageSize = columns * rows;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = selection.installId === game?.install_id ? Math.min(selection.page, pageCount - 1) : 0;
  const visibleItems = items.slice(page * pageSize, (page + 1) * pageSize);
  function changePage(next: number) {
    if (next < 0 || next >= pageCount || next === page) return;
    restoreFocus.current = Boolean(navigation.current?.contains(document.activeElement));
    pageTransition.current?.prepare(next > page ? 1 : -1);
    setSelection({ installId: game?.install_id, page: next });
  }
  useLayoutEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    if (!(document.activeElement instanceof HTMLButtonElement) || document.activeElement.disabled)
      navigation.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [page]);
  const { gridTemplateColumns: _columns, ...panelStyle } = gridLayout.style;
  const paginationButton = (previous: boolean) => <PresentedControl layout={layout}
    component={paginationLayout.component} assetUrls={game?.assetUrls} scale={scale}>
    <Button variant="ghost" aria-label={previous ? "画廊上一页" : "画廊下一页"}
      disabled={previous ? page === 0 : page + 1 >= pageCount}
      className={categoryRole.enabled ? "renpy-role-custom-control" : ""}
      data-renpy-role-custom={categoryRole.enabled ? "true" : undefined}
      data-renpy-role-styled={categoryRole.styled ? "true" : undefined}
      data-renpy-role-bordered={categoryRole.bordered ? "true" : undefined}
      data-renpy-role-opacity={categoryRole.opacityConfigured ? "true" : undefined}
      style={categoryRole.style}
      onClick={() => changePage(page + (previous ? -1 : 1))}>{previous ? "上一页" : "下一页"}</Button>
  </PresentedControl>;

  return (
    <RenpyMenuFrame activeScreen="gallery" className="screen-panel gallery-screen" aria-label="画廊" data-testid="gallery-screen" data-runtime-screen="gallery">
      <header>
        <ScreenBackButton testId="back-to-main-menu" label="返回" onClick={() => useRuntimeStore.getState().closeMenu()} />
      </header>
      {entryError && <p role="alert" className="inline-error">{entryError}</p>}
      <UILayoutOpacitySurface className="gallery-panel ui-layouted" style={panelStyle} presentationComponent={gridLayout.component}>
        <SavePageTransition ref={pageTransition} pageKey={`gallery:${page}`}>
        <div className="gallery-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, gap: gridLayout.style.gap,
        } as CSSProperties}>
        {visibleItems.map((item) => (
          <GalleryItemView
            key={`${game?.install_id}:${item.item_id}:${item.asset_id}:${assetResolver.resolveAsset(item.asset_id) ?? ""}`}
            item={item}
            imageUrl={assetResolver.resolveAsset(item.asset_id)}
            component={itemLayout.component}
          />
        ))}
        </div>
        </SavePageTransition>
        <nav className="gallery-page-navigation" aria-label="画廊分页" ref={navigation}>
          {paginationButton(true)}
          <span role="status" aria-live="polite" data-testid="gallery-page-status">{page + 1} / {pageCount}</span>
          {paginationButton(false)}
        </nav>
      </UILayoutOpacitySurface>
    </RenpyMenuFrame>
  );
}
