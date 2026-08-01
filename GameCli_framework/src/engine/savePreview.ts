import { toCanvas } from "html-to-image";
import { assetResolver } from "./assetResolver";
import type { SaveData } from "../types/save";
import { DEFAULT_SPRITE_SCALE, sanitizeSpriteScale } from "../../../shared/cartridge/spriteScale";

const PREVIEW_WIDTH = 480;
const PREVIEW_HEIGHT = 270;
const MAX_PREVIEW_BYTES = 120 * 1024;

function appendImage(parent: HTMLElement, src: string | undefined, style: Partial<CSSStyleDeclaration>, alt = "") {
  if (!src) return;
  const image = document.createElement("img");
  image.src = src;
  image.alt = alt;
  Object.assign(image.style, style);
  parent.append(image);
}

function backgroundObjectFit(fit?: SaveData["background_fit"]): CSSStyleDeclaration["objectFit"] {
  if (fit === "contain" || fit === "cover") return fit;
  return "fill";
}

function spritePosition(position?: string | null): string {
  if (position === "left") return "8%";
  if (position === "right") return "68%";
  return "38%";
}

function createPreviewStage(save: SaveData): HTMLElement {
  const stage = document.createElement("section");
  stage.setAttribute("aria-hidden", "true");
  Object.assign(stage.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${PREVIEW_WIDTH}px`,
    height: `${PREVIEW_HEIGHT}px`,
    overflow: "hidden",
    background: "#090d14",
    color: "#f6f8ff",
    fontFamily: 'Inter, "Segoe UI", sans-serif',
    zIndex: "-9999",
    pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);

  const world = document.createElement("div");
  const frame = save.camera?.visual_frame;
  const pose = frame?.pose ?? { center_x: 0.5, center_y: 0.5, zoom: 1 };
  const impulse = frame?.impulse ?? { offset_x: 0, offset_y: 0, zoom_delta: 0 };
  const scale = pose.zoom * (1 + impulse.zoom_delta);
  const translateX = (0.5 - pose.zoom * pose.center_x + impulse.offset_x) * PREVIEW_WIDTH;
  const translateY = (0.5 - pose.zoom * pose.center_y + impulse.offset_y) * PREVIEW_HEIGHT;
  Object.assign(world.style, {
    position: "absolute",
    inset: "0",
    transformOrigin: "0 0",
    transform: `matrix(${scale}, 0, 0, ${scale}, ${translateX}, ${translateY})`,
  } satisfies Partial<CSSStyleDeclaration>);
  stage.append(world);

  appendImage(world, assetResolver.resolveBackground(save.background), {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    objectFit: backgroundObjectFit(save.background_fit),
  });

  const orderedIds = save.sprite_order ?? Object.keys(save.sprites);
  orderedIds.forEach((characterId) => {
    const sprite = save.sprites[characterId];
    if (!sprite?.visible) return;
    const scale = sanitizeSpriteScale(sprite.scale, DEFAULT_SPRITE_SCALE);
    appendImage(world, assetResolver.resolveSprite(sprite.sprite_id), {
      position: "absolute",
      left: spritePosition(sprite.position),
      bottom: "12px",
      width: "24%",
      height: "82%",
      objectFit: "contain",
      objectPosition: "center bottom",
      transform: `scale(${scale})`,
      transformOrigin: "center bottom",
    });
  });

  if (save.focused_image) {
    const backdrop = document.createElement("div");
    Object.assign(backdrop.style, {
      position: "absolute",
      inset: "0",
      display: "grid",
      placeItems: "center",
      background: `rgba(0, 0, 0, ${save.focused_image.backdrop_opacity})`,
    });
    appendImage(backdrop, assetResolver.resolveAsset(save.focused_image.image_id), {
      width: "78%",
      height: "78%",
      objectFit: backgroundObjectFit(save.focused_image.image_fit),
    });
    stage.append(backdrop);
  }

  if (save.preview_choices?.length) {
    const choices = document.createElement("div");
    Object.assign(choices.style, {
      position: "absolute",
      left: "50%",
      top: "44%",
      width: "58%",
      display: "grid",
      gap: "5px",
      transform: "translate(-50%, -50%)",
    });
    save.preview_choices.slice(0, 4).forEach((text) => {
      const choice = document.createElement("div");
      choice.textContent = text;
      Object.assign(choice.style, {
        padding: "6px 10px",
        border: "1px solid rgba(255,255,255,.38)",
        borderRadius: "4px",
        background: "rgba(12,17,27,.82)",
        fontSize: "9px",
        textAlign: "center",
      });
      choices.append(choice);
    });
    stage.append(choices);
  }

  if (save.dialog?.text) {
    const dialog = document.createElement("div");
    Object.assign(dialog.style, {
      position: "absolute",
      left: "5%",
      right: "5%",
      bottom: "5%",
      minHeight: "22%",
      padding: "10px 14px",
      boxSizing: "border-box",
      border: "1px solid rgba(210,220,234,.38)",
      borderRadius: "5px",
      background: "rgba(8,13,22,.88)",
      boxShadow: "0 12px 30px rgba(0,0,0,.28)",
    });
    if (save.dialog.speaker) {
      const speaker = document.createElement("strong");
      speaker.textContent = save.dialog.speaker;
      Object.assign(speaker.style, {
        display: "block",
        marginBottom: "4px",
        color: "#d9b86c",
        fontSize: "10px",
      });
      dialog.append(speaker);
    }
    const text = document.createElement("span");
    text.textContent = save.dialog.text;
    Object.assign(text.style, {
      display: "-webkit-box",
      overflow: "hidden",
      fontSize: "10px",
      lineHeight: "1.45",
      webkitLineClamp: "2",
      webkitBoxOrient: "vertical",
    });
    dialog.append(text);
    stage.append(dialog);
  }

  return stage;
}

async function waitForImages(stage: HTMLElement): Promise<void> {
  const images = Array.from(stage.querySelectorAll("img"));
  await Promise.all(images.map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
      window.setTimeout(resolve, 1800);
    });
  }));
}

function canvasDataUrl(canvas: HTMLCanvasElement, quality: number): string {
  return canvas.toDataURL("image/webp", quality);
}

function dataUrlBytes(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.ceil(payload.length * 0.75);
}

export async function captureSavePreview(save: SaveData): Promise<string | undefined> {
  const stage = createPreviewStage(save);
  document.body.append(stage);
  try {
    await waitForImages(stage);
    const canvas = await toCanvas(stage, {
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      pixelRatio: 1,
      cacheBust: false,
      backgroundColor: "#090d14",
    });
    for (const quality of [0.78, 0.68, 0.56, 0.44]) {
      const result = canvasDataUrl(canvas, quality);
      if (dataUrlBytes(result) <= MAX_PREVIEW_BYTES) return result;
    }
    const fallback = canvasDataUrl(canvas, 0.36);
    return dataUrlBytes(fallback) <= MAX_PREVIEW_BYTES ? fallback : undefined;
  } catch (error) {
    console.warn("Save preview capture failed.", error);
    return undefined;
  } finally {
    stage.remove();
  }
}
