import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { assetResolver } from "../../engine/assetResolver";
import { useRuntimeStore } from "../../store/runtimeStore";
import type { GalleryItem } from "../../types/gallery";
import { Button } from "../common/Button";
import { Modal } from "../common/Modal";
import { SavePageTransition, type SavePageTransitionHandle } from "./SavePageTransition";
import "./gallery-viewer.css";
import { useRuntimeUILayout } from "../../uiSkin/uiSkinRuntime";
import { DEFAULT_GALLERY_PRESENTATION } from "../../../../shared/cartridge/galleryPresentation";
import { presentGalleryImage, type GalleryImageOrigin } from "./galleryImagePresentation";

function GalleryImage({ item, origin }: { item: GalleryItem; origin?: GalleryImageOrigin }) {
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const url = assetResolver.resolveAsset(item.asset_id);
  const imageRef = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    if (ready && imageRef.current) return presentGalleryImage(imageRef.current, origin);
  }, [ready, origin, attempt]);
  return url && !failed ? (
    <div className="gallery-viewer-media">
      <img ref={imageRef} key={attempt} className="gallery-viewer-image" src={url} alt={item.title}
        style={{ objectFit: item.image_fit === "cover" || item.image_fit === "fullscreen" ? "cover" : "contain",
          visibility: ready ? "visible" : "hidden" }}
        onLoad={() => setReady(true)} onError={() => setFailed(true)} />
      {!ready && <span className="gallery-viewer-loading" role="status">正在加载图片…</span>}
    </div>
  ) : (
    <div className="gallery-viewer-missing" role="status">
      <strong>图片暂时无法显示</strong>
      <p>可以重试加载，或通过下方按钮查看已解锁剧情。</p>
      <Button onClick={() => { setFailed(false); setReady(false); setAttempt(value => value + 1); }}
        aria-label="重试加载大图">重试加载图片</Button>
    </div>
  );
}

/** Image browsing is presentation only. Only the explicit scene action uses
 * the existing guarded launch flow and its replay/return snapshot. */
export function GalleryImageViewer({ items, itemId, onSelect, onClose, origin }: {
  items: GalleryItem[]; itemId: string; onSelect: (id: string) => void; onClose: () => void;
  origin?: GalleryImageOrigin;
}) {
  const game = useRuntimeStore(state => state.currentGame);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const submitting = useRef(false);
  const transition = useRef<SavePageTransitionHandle>(null);
  const index = items.findIndex(item => item.item_id === itemId);
  const item = items[index];
  const layout = useRuntimeUILayout();
  const frame = layout.galleryPresentation ?? DEFAULT_GALLERY_PRESENTATION;
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  function changeImage(next: number) {
    if (submitting.current || next < 0 || next >= items.length || next === index) return;
    transition.current?.prepare(next > index ? 1 : -1);
    setError("");
    onSelect(items[next].item_id);
  }
  async function replay() {
    const owner = useRuntimeStore.getState().currentGame;
    if (submitting.current || !item?.anchor_id || !owner || owner !== game) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      await useRuntimeStore.getState().openGalleryAnchor(item.anchor_id);
      // A reload or closed viewer must never receive the old request's UI.
      if (!alive.current || useRuntimeStore.getState().currentGame !== owner) return;
      const state = useRuntimeStore.getState();
      if (state.galleryReplayActive && state.screen === "playing") onClose();
      else setError(state.entryError || "未能进入该剧情场景，请重试。");
    } catch (cause) {
      if (alive.current && useRuntimeStore.getState().currentGame === owner)
        setError(cause instanceof Error ? cause.message : "未能进入该剧情场景，请重试。");
    } finally {
      submitting.current = false;
      if (alive.current && useRuntimeStore.getState().currentGame === owner) setPending(false);
    }
  }
  if (!item) return null;
  return (
    <Modal title="画廊大图" presentation="image-viewer" onClose={onClose}>
      <div className="gallery-viewer-shell" data-image-fit={item.image_fit ?? "contain"}
        style={{ "--gallery-viewer-ratio": frame.width / frame.height } as CSSProperties}
        onKeyDown={event => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey
          || event.currentTarget.closest("[inert]")) return;
        const modals = document.querySelectorAll("[data-runtime-modal='true']");
        if (modals[modals.length - 1] !== event.currentTarget.parentElement) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault(); event.stopPropagation();
          changeImage(index + (event.key === "ArrowLeft" ? -1 : 1));
        }
      }}>
        <header className="gallery-viewer-header">
          <Button variant="ghost" className="gallery-viewer-back" data-modal-initial-focus
            onClick={onClose}><ArrowLeft aria-hidden="true" size={18} />返回画廊</Button>
          <span role="status" aria-live="polite" data-testid="gallery-image-position">{index + 1} / {items.length}</span>
          <span className="gallery-viewer-key-hint" aria-hidden="true">Esc 返回</span>
        </header>
        <div className="gallery-viewer-stage">
          <Button variant="ghost" className="gallery-viewer-previous" aria-label="上一张图片"
            disabled={index === 0 || pending} onClick={() => changeImage(index - 1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <SavePageTransition ref={transition} pageKey={`gallery-image:${item.item_id}`}>
            <GalleryImage key={`${item.item_id}:${item.asset_id}`} item={item} origin={origin} />
          </SavePageTransition>
          <Button variant="ghost" className="gallery-viewer-next" aria-label="下一张图片"
            disabled={index + 1 >= items.length || pending} onClick={() => changeImage(index + 1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        <footer className="gallery-viewer-footer">
          <div className="gallery-viewer-caption">
            <h2>{item.title}</h2>
            {item.description && <p>{item.description}</p>}
            {error && <p className="inline-error" role="alert">{error}</p>}
            {!item.anchor_id && <p>此图片未关联剧情场景</p>}
          </div>
          <Button className="gallery-viewer-scene" disabled={!item.anchor_id} loading={pending}
            onClick={() => void replay()}>回到剧情场景<ArrowUpRight aria-hidden="true" size={18} /></Button>
        </footer>
      </div>
    </Modal>
  );
}
