import { Lock } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
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
import { GalleryImageViewer } from "./GalleryImageViewer";
import type { LibraryGame } from "../../types/cartridge";
import type { GalleryImageOrigin } from "./galleryImagePresentation";
import { DEFAULT_GALLERY_PRESENTATION } from "../../../../shared/cartridge/galleryPresentation";

// Only a live cartridge session keeps this view state. Never save image
// browsing to player preferences, save slots, or a portable project.
const galleryPages = new WeakMap<LibraryGame["script"], Map<string, number>>();

function GalleryItemView({ item, imageUrl, component, onView }: {
  item: GalleryItem; imageUrl?: string; component?: UILayoutComponent; onView: (origin?: GalleryImageOrigin) => void;
}) {
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
        disabled={!item.unlocked}
        onClick={event => {
          const rect = event.currentTarget.querySelector("img")?.getBoundingClientRect();
          onView(rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined);
        }}
        aria-label={item.unlocked ? `查看大图-${item.title}` : "未解锁画廊"}
      >
        {item.unlocked && item.asset_id
          ? <img key={attempt} src={imageUrl} alt="" onError={() => setImageFailed(true)}
              style={{ objectFit: item.image_fit === "contain" ? "contain" : "cover" }} />
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
  const screen = useRuntimeStore(state => state.screen);
  const marker = useRef<HTMLSpanElement>(null);
  const ownerId = game ? `${game.install_id}\0${game.game_id}` : "";
  const [image, setImage] = useState<{ script: LibraryGame["script"]; ownerId: string; itemId: string; origin?: GalleryImageOrigin }>();
  const gridLayout = useUILayoutStyle("gallery", "gallery_grid");
  const itemLayout = useUILayoutStyle("gallery", "gallery_item");
  const paginationLayout = useUILayoutStyle("gallery", "gallery_pagination");
  const layout = useRuntimeUILayout();
  const frame = useUILayoutFrameSize();
  const categoryRole = useRenpyButtonRoleStyle("category_pagination", "gallery", "var(--renpy-menu-scale)");
  const scale = Math.min(frame.width / 1280, frame.height / 720);
  const presentation = layout.galleryPresentation ?? DEFAULT_GALLERY_PRESENTATION;
  const pageTransition = useRef<SavePageTransitionHandle>(null);
  const navigation = useRef<HTMLElement>(null);
  const restoreFocus = useRef(false);
  const [selection, setSelection] = useState(() => ({
    script: game?.script, ownerId, page: game ? galleryPages.get(game.script)?.get(ownerId) ?? 0 : 0,
  }));
  const entryError = useRuntimeStore((state) => state.entryError);
  const items: GalleryItem[] = game?.gallery.length
    ? game.gallery
    : Array.from({ length: 8 }, (_, index) => ({ item_id: `placeholder_${index}`, title: "未解锁", unlocked: false, asset_id: "" }));
  const columns = Math.max(1, Math.min(8, Math.round(gridLayout.component?.style?.columns ?? 4)));
  const rows = Math.max(1, Math.min(8, Math.round(gridLayout.component?.style?.rows ?? 2)));
  const pageSize = columns * rows;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = selection.script === game?.script && selection.ownerId === ownerId
    ? Math.min(selection.page, pageCount - 1) : 0;
  const visibleItems = items.slice(page * pageSize, (page + 1) * pageSize);
  function changePage(next: number) {
    if (next < 0 || next >= pageCount || next === page) return;
    restoreFocus.current = Boolean(navigation.current?.contains(document.activeElement));
    pageTransition.current?.prepare(next > page ? 1 : -1);
    if (game) {
      const pages = galleryPages.get(game.script) ?? new Map<string, number>();
      pages.set(ownerId, next);
      galleryPages.set(game.script, pages);
    }
    setSelection({ script: game?.script, ownerId, page: next });
  }
  useLayoutEffect(() => {
    if (screen !== "gallery") setImage(undefined);
  }, [screen]);
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

  const host = marker.current?.closest(".runtime-layout-frame");
  return (<>
    <span hidden ref={marker} />
    <RenpyMenuFrame activeScreen="gallery" className="screen-panel gallery-screen" aria-label="画廊" data-testid="gallery-screen" data-runtime-screen="gallery">
      <header>
        <ScreenBackButton testId="back-to-main-menu" label="返回" onClick={() => useRuntimeStore.getState().closeMenu()} />
      </header>
      {entryError && <p role="alert" className="inline-error">{entryError}</p>}
      <UILayoutOpacitySurface className="gallery-panel ui-layouted"
        style={{ ...panelStyle, padding: Math.max(12 * scale, Number.parseFloat(String(panelStyle.padding)) || 0),
          "--gallery-image-aspect": `${presentation.width} / ${presentation.height}` } as CSSProperties}
        presentationComponent={gridLayout.component}>
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
            onView={origin => { if (game) setImage({ script: game.script, ownerId, itemId: item.item_id, origin }); }}
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
    {host && screen === "gallery" && game && image?.script === game.script && image.ownerId === ownerId
      && createPortal(<GalleryImageViewer items={items.filter(item => item.unlocked)}
        origin={image.origin}
        itemId={image.itemId} onSelect={itemId => setImage({ script: game.script, ownerId, itemId })}
        onClose={() => setImage(undefined)} />, host)}
    </>
  );
}
