import { useEffect, useMemo, useRef } from "react";

const roseConfig = {
  particleCount: 74,
  trailSpan: 0.3,
  durationMs: 5200,
  rotationDurationMs: 28000,
  pulseDurationMs: 4300,
  strokeWidth: 4.6,
  roseA: 9.2,
  roseABoost: 0.6,
  roseBreathBase: 0.72,
  roseBreathBoost: 0.28,
  roseScale: 3.25,
};

function normalizeProgress(progress: number): number {
  return ((progress % 1) + 1) % 1;
}

function getDetailScale(time: number): number {
  const pulseProgress = (time % roseConfig.pulseDurationMs) / roseConfig.pulseDurationMs;
  const pulseAngle = pulseProgress * Math.PI * 2;
  return 0.52 + ((Math.sin(pulseAngle + 0.55) + 1) / 2) * 0.48;
}

function getRotation(time: number): number {
  return -((time % roseConfig.rotationDurationMs) / roseConfig.rotationDurationMs) * 360;
}

function pointAt(progress: number, detailScale: number): { x: number; y: number } {
  const t = progress * Math.PI * 2;
  const a = roseConfig.roseA + detailScale * roseConfig.roseABoost;
  const r = a * (roseConfig.roseBreathBase + detailScale * roseConfig.roseBreathBoost) * Math.cos(2 * t);
  return {
    x: 50 + Math.cos(t) * r * roseConfig.roseScale,
    y: 50 + Math.sin(t) * r * roseConfig.roseScale,
  };
}

function buildPath(detailScale: number, steps = 480): string {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const point = pointAt(index / steps, detailScale);
    return `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }).join(" ");
}

function getParticle(index: number, progress: number, detailScale: number, particleCount: number): { x: number; y: number; radius: number; opacity: number } {
  const tailOffset = particleCount <= 1 ? 0 : index / (particleCount - 1);
  const point = pointAt(normalizeProgress(progress - tailOffset * roseConfig.trailSpan), detailScale);
  const fade = Math.pow(1 - tailOffset, 0.56);
  return {
    x: point.x,
    y: point.y,
    radius: 0.9 + fade * 2.7,
    opacity: 0.04 + fade * 0.96,
  };
}

export function RoseTwoLoader({ className = "", particleCount = roseConfig.particleCount }: { className?: string; particleCount?: number }) {
  const groupRef = useRef<SVGGElement | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);
  const particleRefs = useRef<Array<SVGCircleElement | null>>([]);
  const particleIndexes = useMemo(() => Array.from({ length: particleCount }, (_, index) => index), [particleCount]);

  useEffect(() => {
    const path = pathRef.current;
    const group = groupRef.current;
    if (!path || !group) return undefined;

    let animationFrame = 0;
    const startedAt = performance.now();
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    function paint(time: number): void {
      const progress = reducedMotion ? 0.18 : (time % roseConfig.durationMs) / roseConfig.durationMs;
      const detailScale = reducedMotion ? 0.76 : getDetailScale(time);
      group?.setAttribute("transform", `rotate(${reducedMotion ? 0 : getRotation(time)} 50 50)`);
      path?.setAttribute("d", buildPath(detailScale));
      particleRefs.current.forEach((node, index) => {
        if (!node) return;
        const particle = getParticle(index, progress, detailScale, particleCount);
        node.setAttribute("cx", particle.x.toFixed(2));
        node.setAttribute("cy", particle.y.toFixed(2));
        node.setAttribute("r", particle.radius.toFixed(2));
        node.setAttribute("opacity", particle.opacity.toFixed(3));
      });
    }

    paint(0);
    if (!reducedMotion) {
      const render = (now: number) => {
        paint(now - startedAt);
        animationFrame = requestAnimationFrame(render);
      };
      animationFrame = requestAnimationFrame(render);
    }

    return () => cancelAnimationFrame(animationFrame);
  }, [particleCount]);

  return (
    <svg className={`rose-two-loader${className ? ` ${className}` : ""}`} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <g ref={groupRef}>
        <path
          ref={pathRef}
          className="rose-two-loader-path"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={roseConfig.strokeWidth}
          opacity="0.1"
        />
        {particleIndexes.map((index) => (
          <circle
            key={index}
            ref={(node) => {
              particleRefs.current[index] = node;
            }}
            className="rose-two-loader-particle"
            fill="currentColor"
          />
        ))}
      </g>
    </svg>
  );
}
