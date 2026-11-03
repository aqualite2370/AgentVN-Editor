import { toCanvas } from "html-to-image";
import { assetResolver } from "./assetResolver";
import type { SaveData } from "../types/save";
import { DEFAULT_SPRITE_SCALE, sanitizeSpriteScale } from "../../../shared/cartridge/spriteScale";
import { sanitizeSpriteOffsetX, sanitizeSpriteOffsetY } from "../../../shared/cartridge/spritePlacement";
import { orderedVisibleSprites, resolveSpriteSlotIndices, resolveSpriteSlotLayout } from "./spriteStageLayout";

export const SAVE_PREVIEW_VERSION = 2;

const PREVIEW_WIDTH = 480;
const PREVIEW_HEIGHT = 270;
const FALLBACK_STAGE_WIDTH = 1280;
const FALLBACK_STAGE_HEIGHT = 720;
const MAX_PREVIEW_BYTES = 120 * 1024;
const PREVIEW_EXCLUDED_SELECTOR = [
  ".playback-controls",
  ".save-status-toast",
  ".animation-hint",
  "[data-save-preview-exclude='true']",
].join(",");

interface PreviewIdentity {
  scene_id: string;
  command_index: number;
}

interface CachedLivePreview extends PreviewIdentity {
  image: string;
}

let cachedLivePreview: CachedLivePreview | undefined;

function previewIdentity(save: PreviewIdentity): string {
  return `${save.scene_id}:${save.command_index}`;
}

function playerIdentity(player: HTMLElement): PreviewIdentity | undefined {
  const sceneId = player.dataset.currentSceneId;
  const commandIndex = Number(player.dataset.currentCommandIndex);
  if (!sceneId || !Number.isInteger(commandIndex)) return undefined;
  return { scene_id: sceneId, command_index: commandIndex };
}

function identityMatches(expected: PreviewIdentity, actual: PreviewIdentity | undefined): boolean {
  return Boolean(actual && previewIdentity(expected) === previewIdentity(actual));
}

function appendImage(
  parent: HTMLElement,
  src: string | undefined,
  style: Partial<CSSStyleDeclaration>,
  alt = "",
) {
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

function createFallbackPreviewStage(save: SaveData): HTMLElement {
  const stage = document.createElement("section");
  stage.setAttribute("aria-hidden", "true");
  Object.assign(stage.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${FALLBACK_STAGE_WIDTH}px`,
    height: `${FALLBACK_STAGE_HEIGHT}px`,
    overflow: "hidden",
    background: "#090d14",
    color: "#f6f8ff",
    fontFamily: 'Inter, "Segoe UI", sans-serif',
    zIndex: "-9999",
    pointerEvents: "none",
  } satisfies Partial<CSSStyleDeclaration>);

  const impulse = document.createElement("div");
  const pose = document.createElement("div");
  const frame = save.camera?.visual_frame;
  const cameraPose = frame?.pose ?? { center_x: 0.5, center_y: 0.5, zoom: 1 };
  const cameraImpulse = frame?.impulse ?? { offset_x: 0, offset_y: 0, zoom_delta: 0 };
  const translateX = (0.5 - cameraPose.zoom * cameraPose.center_x) * FALLBACK_STAGE_WIDTH;
  const translateY = (0.5 - cameraPose.zoom * cameraPose.center_y) * FALLBACK_STAGE_HEIGHT;
  Object.assign(impulse.style, {
    position: "absolute",
    inset: "0",
    transformOrigin: "50% 50%",
    transform: [
      `translate3d(${cameraImpulse.offset_x * FALLBACK_STAGE_WIDTH}px, ${cameraImpulse.offset_y * FALLBACK_STAGE_HEIGHT}px, 0)`,
      `scale(${1 + cameraImpulse.zoom_delta})`,
    ].join(" "),
  } satisfies Partial<CSSStyleDeclaration>);
  Object.assign(pose.style, {
    position: "absolute",
    inset: "0",
    transformOrigin: "0 0",
    transform: `matrix(${cameraPose.zoom}, 0, 0, ${cameraPose.zoom}, ${translateX}, ${translateY})`,
  } satisfies Partial<CSSStyleDeclaration>);
  impulse.append(pose);
  stage.append(impulse);

  appendImage(pose, assetResolver.resolveBackground(save.background), {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    objectFit: backgroundObjectFit(save.background_fit),
  });

  const sprites = orderedVisibleSprites(save.sprites, save.sprite_order);
  const slotIndices = resolveSpriteSlotIndices(sprites);
  sprites.forEach((sprite) => {
    const layout = resolveSpriteSlotLayout({
      stage: {
        width: FALLBACK_STAGE_WIDTH,
        height: FALLBACK_STAGE_HEIGHT,
        uiScale: 1,
      },
      spriteCount: Math.max(1, sprites.length),
      spriteIndex: slotIndices.get(sprite.character_id) ?? 0,
      position: sprite.position,
    });
    const offsetX = FALLBACK_STAGE_WIDTH * sanitizeSpriteOffsetX(sprite.offset_x) / 100;
    const offsetY = FALLBACK_STAGE_HEIGHT * sanitizeSpriteOffsetY(sprite.offset_y) / 100;
    const slot = document.createElement("div");
    Object.assign(slot.style, {
      position: "absolute",
      left: `${layout.left}px`,
      bottom: `${layout.bottom}px`,
      width: `${layout.width}px`,
      height: `${layout.height}px`,
      display: "grid",
      placeItems: "end center",
      transform: `translate3d(${offsetX}px, ${-offsetY}px, 0)`,
      transformOrigin: "center bottom",
      overflow: "visible",
    } satisfies Partial<CSSStyleDeclaration>);
    appendImage(slot, assetResolver.resolveSprite(sprite.sprite_id), {
      display: "block",
      width: "auto",
      maxWidth: "100%",
      height: "auto",
      maxHeight: "100%",
      objectFit: "contain",
      objectPosition: "center bottom",
      transform: `scale(${sanitizeSpriteScale(sprite.scale, DEFAULT_SPRITE_SCALE)})`,
      transformOrigin: "center bottom",
    });
    pose.append(slot);
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
      gap: "12px",
      transform: "translate(-50%, -50%)",
    });
    save.preview_choices.slice(0, 4).forEach((label) => {
      const choice = document.createElement("div");
      choice.textContent = label;
      Object.assign(choice.style, {
        padding: "16px 24px",
        border: "1px solid rgba(255,255,255,.38)",
        borderRadius: "7px",
        background: "rgba(12,17,27,.82)",
        fontSize: "24px",
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
      padding: "24px 34px",
      boxSizing: "border-box",
      border: "1px solid rgba(210,220,234,.38)",
      borderRadius: "10px",
      background: "rgba(8,13,22,.88)",
      boxShadow: "0 12px 30px rgba(0,0,0,.28)",
    });
    if (save.dialog.speaker) {
      const speaker = document.createElement("strong");
      speaker.textContent = save.dialog.speaker;
      Object.assign(speaker.style, {
        display: "block",
        marginBottom: "8px",
        color: "#d9b86c",
        fontSize: "25px",
      });
      dialog.append(speaker);
    }
    const text = document.createElement("span");
    text.textContent = save.dialog.text;
    Object.assign(text.style, {
      display: "-webkit-box",
      overflow: "hidden",
      fontSize: "25px",
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
    if (image.complete) return image.decode?.().catch(() => undefined) ?? Promise.resolve();
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

function encodePreview(canvas: HTMLCanvasElement): string | undefined {
  for (const quality of [0.82, 0.74, 0.64, 0.54, 0.44]) {
    const result = canvasDataUrl(canvas, quality);
    if (dataUrlBytes(result) <= MAX_PREVIEW_BYTES) return result;
  }
  const fallback = canvasDataUrl(canvas, 0.36);
  return dataUrlBytes(fallback) <= MAX_PREVIEW_BYTES ? fallback : undefined;
}

export function getCachedSavePreview(save: PreviewIdentity): string | undefined {
  return cachedLivePreview && identityMatches(save, cachedLivePreview)
    ? cachedLivePreview.image
    : undefined;
}

export function clearCachedSavePreview(): void {
  cachedLivePreview = undefined;
}

async function matchingStoryPlayer(save: PreviewIdentity): Promise<HTMLElement | undefined> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const player = document.querySelector<HTMLElement>(".story-player[data-runtime-screen='playing']");
    if (player && identityMatches(save, playerIdentity(player))) return player;
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  }
  return undefined;
}

export async function captureCurrentSavePreview(save: PreviewIdentity): Promise<string | undefined> {
  const player = await matchingStoryPlayer(save);
  if (!player) return undefined;
  const rect = player.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return undefined;
  try {
    await waitForImages(player);
    if (!player.isConnected || !identityMatches(save, playerIdentity(player))) return undefined;
    const canvas = await toCanvas(player, {
      width: rect.width,
      height: rect.height,
      canvasWidth: PREVIEW_WIDTH,
      canvasHeight: PREVIEW_HEIGHT,
      pixelRatio: 1,
      cacheBust: false,
      backgroundColor: "#090d14",
      filter: (node) => !(node instanceof Element && node.matches(PREVIEW_EXCLUDED_SELECTOR)),
    });
    const activePlayer = document.querySelector<HTMLElement>(".story-player[data-runtime-screen='playing']");
    if (activePlayer !== player || !identityMatches(save, playerIdentity(activePlayer))) return undefined;
    return encodePreview(canvas);
  } catch (error) {
    console.warn("Live save preview capture failed.", error);
    return undefined;
  }
}

export async function cacheCurrentSavePreview(save: PreviewIdentity): Promise<string | undefined> {
  const image = await captureCurrentSavePreview(save);
  if (image) cachedLivePreview = { ...save, image };
  return image;
}

export async function renderSavePreviewFromState(save: SaveData): Promise<string | undefined> {
  const stage = createFallbackPreviewStage(save);
  document.body.append(stage);
  try {
    await waitForImages(stage);
    const canvas = await toCanvas(stage, {
      width: FALLBACK_STAGE_WIDTH,
      height: FALLBACK_STAGE_HEIGHT,
      canvasWidth: PREVIEW_WIDTH,
      canvasHeight: PREVIEW_HEIGHT,
      pixelRatio: 1,
      cacheBust: false,
      backgroundColor: "#090d14",
    });
    return encodePreview(canvas);
  } catch (error) {
    console.warn("Save preview fallback render failed.", error);
    return undefined;
  } finally {
    stage.remove();
  }
}

export async function captureSavePreview(
  save: SaveData,
  preferredPreview?: string,
): Promise<string | undefined> {
  return preferredPreview
    ?? getCachedSavePreview(save)
    ?? await captureCurrentSavePreview(save)
    ?? await renderSavePreviewFromState(save);
}
