import { useEffect, useRef, useState } from "react";
import {
  Brush,
  Crop,
  Eraser,
  Minus,
  Plus,
  Redo2,
  RotateCcw,
  Undo2,
} from "lucide-react";
import type { ImageGenerationRecipeV1 } from "../../../asset-studio/types";

interface AssetStudioCanvasEditorProps {
  sourceUrl: string;
  recipe: ImageGenerationRecipeV1;
  onMaskChange: (dataUrl: string) => void;
  onLocalOutput: (dataUrl: string, label: string) => void;
}

type EditorTool = "mask" | "erase";

function canvasDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

export function AssetStudioCanvasEditor({
  sourceUrl,
  recipe,
  onMaskChange,
  onLocalOutput,
}: AssetStudioCanvasEditorProps) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number }>();
  const [tool, setTool] = useState<EditorTool>("mask");
  const [brushSize, setBrushSize] = useState(54);
  const [zoom, setZoom] = useState(1);
  const [history, setHistory] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const [error, setError] = useState("");
  const supportsMask = recipe.operation === "inpaint";
  const outpaintPadding = recipe.operation === "outpaint"
    ? {
        paddingTop: Math.min(96, recipe.outpaintInsets.top / 4),
        paddingRight: Math.min(96, recipe.outpaintInsets.right / 4),
        paddingBottom: Math.min(96, recipe.outpaintInsets.bottom / 4),
        paddingLeft: Math.min(96, recipe.outpaintInsets.left / 4),
      }
    : undefined;

  useEffect(() => {
    const base = baseRef.current;
    const overlay = overlayRef.current;
    if (!base || !overlay) return;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const maxSide = 1400;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      base.width = width;
      base.height = height;
      overlay.width = width;
      overlay.height = height;
      base.getContext("2d")?.drawImage(image, 0, 0, width, height);
      overlay.getContext("2d")?.clearRect(0, 0, width, height);
      setHistory([]);
      setFuture([]);
      setError("");
    };
    image.onerror = () => setError("无法读取来源图片，远程图片可能禁止本地编辑。");
    image.src = sourceUrl;
  }, [sourceUrl]);

  function restoreOverlay(dataUrl?: string) {
    const canvas = overlayRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!dataUrl) return;
    const image = new Image();
    image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = dataUrl;
  }

  function pushHistory() {
    const overlay = overlayRef.current;
    if (!overlay) return;
    setHistory((current) => [...current.slice(-18), canvasDataUrl(overlay)]);
    setFuture([]);
  }

  function undo() {
    const overlay = overlayRef.current;
    if (!overlay || history.length === 0) return;
    const current = canvasDataUrl(overlay);
    const previous = history.length > 1 ? history[history.length - 2] : undefined;
    setHistory((items) => items.slice(0, -1));
    setFuture((items) => [current, ...items].slice(0, 20));
    restoreOverlay(previous);
  }

  function redo() {
    const overlay = overlayRef.current;
    if (!overlay || future.length === 0) return;
    const next = future[0];
    setFuture((items) => items.slice(1));
    setHistory((items) => [...items, next].slice(-20));
    restoreOverlay(next);
  }

  function pointForEvent(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = overlayRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = overlayRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const next = pointForEvent(event);
    const previous = lastPointRef.current ?? next;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = brushSize;
    context.globalCompositeOperation = tool === "mask" ? "source-over" : "destination-out";
    context.strokeStyle = "rgba(234, 92, 125, .68)";
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    context.restore();
    lastPointRef.current = next;
  }

  function clearMask() {
    const canvas = overlayRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    pushHistory();
  }

  function buildMaskDataUrl(): string | undefined {
    const overlay = overlayRef.current;
    if (!overlay) return undefined;
    const mask = document.createElement("canvas");
    mask.width = overlay.width;
    mask.height = overlay.height;
    const context = mask.getContext("2d");
    if (!context) return undefined;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, mask.width, mask.height);
    context.globalCompositeOperation = "destination-out";
    context.drawImage(overlay, 0, 0);
    return canvasDataUrl(mask);
  }

  function applyMask() {
    const dataUrl = buildMaskDataUrl();
    if (dataUrl) onMaskChange(dataUrl);
  }

  function eraseToTransparency() {
    const base = baseRef.current;
    const overlay = overlayRef.current;
    if (!base || !overlay) return;
    try {
      const output = document.createElement("canvas");
      output.width = base.width;
      output.height = base.height;
      const context = output.getContext("2d");
      if (!context) return;
      context.drawImage(base, 0, 0);
      context.globalCompositeOperation = "destination-out";
      context.drawImage(overlay, 0, 0);
      onLocalOutput(canvasDataUrl(output), "透明擦除");
    } catch {
      setError("当前图片不允许导出本地编辑结果，请先保存到素材库后再试。");
    }
  }

  function cropToRecipe() {
    const base = baseRef.current;
    if (!base) return;
    try {
      const output = document.createElement("canvas");
      output.width = recipe.width;
      output.height = recipe.height;
      const context = output.getContext("2d");
      if (!context) return;
      const scale = Math.max(output.width / base.width, output.height / base.height);
      const drawWidth = base.width * scale;
      const drawHeight = base.height * scale;
      context.drawImage(base, (output.width - drawWidth) / 2, (output.height - drawHeight) / 2, drawWidth, drawHeight);
      onLocalOutput(canvasDataUrl(output), "居中裁切");
    } catch {
      setError("当前图片不允许导出裁切结果。");
    }
  }

  return (
    <section
      className="asset-studio-canvas-editor"
      aria-label="图片编辑画布"
      tabIndex={0}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
          event.preventDefault();
          event.shiftKey ? redo() : undo();
        }
      }}
    >
      <div className="asset-studio-canvas-toolbar">
        <div role="group" aria-label="蒙版工具">
          <button type="button" data-help-key="asset.maskBrush" disabled={!supportsMask} className={tool === "mask" ? "is-active" : ""} aria-pressed={tool === "mask"} onClick={() => setTool("mask")}>
            <Brush size={16} aria-hidden="true" />蒙版
          </button>
          <button type="button" data-help-key="asset.maskEraser" disabled={!supportsMask} className={tool === "erase" ? "is-active" : ""} aria-pressed={tool === "erase"} onClick={() => setTool("erase")}>
            <Eraser size={16} aria-hidden="true" />擦除蒙版
          </button>
        </div>
        <label>
          <span>笔刷 {brushSize}px</span>
          <input data-help-key="asset.brushSize" type="range" min={12} max={180} value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} />
        </label>
        <div role="group" aria-label="历史与缩放">
          <button type="button" data-help-key="asset.canvasUndo" aria-label="撤销" disabled={history.length === 0} onClick={undo}><Undo2 size={16} /></button>
          <button type="button" data-help-key="asset.canvasRedo" aria-label="重做" disabled={future.length === 0} onClick={redo}><Redo2 size={16} /></button>
          <button type="button" data-help-key="asset.zoomOut" aria-label="缩小" onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}><Minus size={16} /></button>
          <output>{Math.round(zoom * 100)}%</output>
          <button type="button" data-help-key="asset.zoomIn" aria-label="放大" onClick={() => setZoom((value) => Math.min(2, value + 0.1))}><Plus size={16} /></button>
        </div>
      </div>
      <div className="asset-studio-canvas-viewport">
        <div className={`asset-studio-outpaint-frame${outpaintPadding ? " is-active" : ""}`} style={outpaintPadding}>
          <div className="asset-studio-canvas-stack" style={{ transform: `scale(${zoom})` }}>
            <canvas ref={baseRef} aria-hidden="true" />
            <canvas
              ref={overlayRef}
              aria-label="在图片上绘制需要重绘或擦除的区域"
              onPointerDown={(event) => {
                if (!supportsMask) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                drawingRef.current = true;
                lastPointRef.current = pointForEvent(event);
                draw(event);
              }}
              onPointerMove={draw}
              onPointerUp={() => {
                drawingRef.current = false;
                lastPointRef.current = undefined;
                pushHistory();
              }}
              onPointerCancel={() => {
                drawingRef.current = false;
                lastPointRef.current = undefined;
              }}
            />
            {(recipe.assetType === "sprite" || recipe.assetType === "portrait") && (
              <div className="asset-studio-canvas-guides" aria-hidden="true">
                <span className="is-center" />
                <span className="is-ground" />
              </div>
            )}
          </div>
        </div>
      </div>
      {recipe.operation === "outpaint" && (
        <p className="asset-studio-hint">虚线区域表示将要扩展的画布边界；在左侧高级设置中调整上、右、下、左像素。</p>
      )}
      <div className="asset-studio-canvas-actions">
        {supportsMask && <button type="button" className="asset-studio-ghost-button" data-help-key="asset.clearMask" onClick={clearMask}><RotateCcw size={15} />清空蒙版</button>}
        <button type="button" className="asset-studio-ghost-button" data-help-key="asset.crop" onClick={cropToRecipe}><Crop size={15} />裁为当前画幅</button>
        {supportsMask && <button type="button" className="asset-studio-ghost-button" data-help-key="asset.eraseTransparency" onClick={eraseToTransparency}><Eraser size={15} />透明擦除</button>}
        {supportsMask && <button type="button" className="asset-studio-secondary-button" data-help-key="asset.applyMask" onClick={applyMask}><Brush size={15} />应用为重绘蒙版</button>}
      </div>
      {error && <p className="asset-studio-field-error" role="alert">{error}</p>}
    </section>
  );
}
