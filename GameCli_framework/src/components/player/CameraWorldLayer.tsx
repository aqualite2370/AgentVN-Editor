import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { CameraRuntimeState } from "../../../../shared/camera/cameraMotion";
import type { StoryEngine } from "../../engine/StoryEngine";

export function CameraWorldLayer({
  engine,
  camera,
  children,
}: {
  engine: StoryEngine;
  camera: CameraRuntimeState;
  children: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const impulseRef = useRef<HTMLDivElement | null>(null);
  const poseRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const impulseNode = impulseRef.current;
    const poseNode = poseRef.current;
    if (!viewport || !impulseNode || !poseNode) return undefined;
    const activeViewport = viewport;
    const activeImpulseNode = impulseNode;
    const activePoseNode = poseNode;

    let width = activeViewport.clientWidth;
    let height = activeViewport.clientHeight;
    let frameId: number | undefined;
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver((entries) => {
          const entry = entries[0];
          width = entry?.contentRect.width || activeViewport.clientWidth;
          height = entry?.contentRect.height || activeViewport.clientHeight;
        });
    resizeObserver?.observe(activeViewport);

    function renderFrame() {
      const frame = engine.cameraFrame();
      const pose = frame.pose;
      const translateX = (0.5 - pose.zoom * pose.center_x) * width;
      const translateY = (0.5 - pose.zoom * pose.center_y) * height;
      activePoseNode.style.transform = `matrix(${pose.zoom}, 0, 0, ${pose.zoom}, ${translateX}, ${translateY})`;
      activeImpulseNode.style.transform = [
        `translate3d(${frame.impulse.offset_x * width}px, ${frame.impulse.offset_y * height}px, 0)`,
        `scale(${1 + frame.impulse.zoom_delta})`,
      ].join(" ");
      activePoseNode.dataset.cameraActive = frame.active ? "true" : "false";
      activeImpulseNode.dataset.cameraActive = frame.active ? "true" : "false";
      if (frame.active && !engine.cameraClock.paused) {
        frameId = window.requestAnimationFrame(renderFrame);
      }
    }

    renderFrame();
    return () => {
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
    };
  }, [camera.revision, engine]);

  return (
    <div className="stage-viewport" ref={viewportRef} data-camera-paused={engine.cameraClock.paused ? "true" : "false"}>
      <div className="camera-impulse" ref={impulseRef}>
        <div className="camera-pose" ref={poseRef}>
          {children}
        </div>
      </div>
    </div>
  );
}
