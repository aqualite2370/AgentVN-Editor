import { useRef, useState } from "react";

export function SketchPad({ onExport }: { onExport: (blobUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<"brush" | "eraser">("brush");
  const drawing = useRef(false);

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !drawing.current) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = mode === "brush" ? "#111827" : "#ffffff";
    ctx.beginPath();
    ctx.arc(event.clientX - rect.left, event.clientY - rect.top, mode === "brush" ? 4 : 12, 0, Math.PI * 2);
    ctx.fill();
  }

  return (
    <section className="advanced-card">
      <h3>草图板</h3>
      <div className="row-actions">
        <button type="button" data-help-key="sketch.brush" onClick={() => setMode("brush")}>画笔</button>
        <button type="button" data-help-key="sketch.eraser" onClick={() => setMode("eraser")}>橡皮</button>
        <button type="button" data-help-key="sketch.clear" onClick={() => {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }}>清空</button>
        <button type="button" data-help-key="sketch.export" onClick={() => {
          canvasRef.current?.toBlob((blob) => {
            if (blob) onExport(URL.createObjectURL(blob));
          }, "image/png");
        }}>作为参考图</button>
      </div>
      <canvas ref={canvasRef} className="sketch-pad" width={360} height={220} onPointerDown={(event) => { drawing.current = true; draw(event); }} onPointerMove={draw} onPointerUp={() => { drawing.current = false; }} />
    </section>
  );
}
