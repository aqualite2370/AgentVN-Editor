import { GripHorizontal, RotateCcw, Sparkles, X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import type { NovelProcessJob } from "../../novel-import/processJobTypes";
import { getNovelCardPositionStore, type NovelCardPosition } from "../../novel-import/novelCardPosition";
import { novelTaskMotion } from "./novelTaskMotion";

type Point = { x: number; y: number };
type Bounds = { left: number; top: number; right: number; bottom: number };
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
const activeAvoidAreas = () => Array.from(document.querySelectorAll<HTMLElement>("[data-novel-task-avoid]"))
  .filter(element => !element.closest('[inert], [aria-hidden="true"], .toolbar-popover-morph-ghost')
    && element.getClientRects().length > 0 && getComputedStyle(element).visibility === "visible");

export function NovelTaskCard({ projectId, job, label, tone, inactive, suppressed = false, dismissed = false, onDismiss, onOpen }: {
  projectId: string; job: NovelProcessJob; label: string; tone: string; inactive: boolean;
  suppressed?: boolean;
  dismissed?: boolean;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const normalizedRef = useRef<Point | undefined>(undefined);
  const positionRef = useRef<Point>({ x: 0, y: 0 });
  const boundsRef = useRef<Bounds>({ left: 12, top: 12, right: 280, bottom: 88 });
  const dragRef = useRef<{ id: number; start: Point; origin: Point; dragged: boolean } | undefined>(undefined);
  const ignoreClickRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hidden, setHidden] = useState(dismissed);
  const materialWasVisible = useRef(false);
  const positionStore = getNovelCardPositionStore();
  const positionSessionRef = useRef({ projectId, revision: 0, alive: false });
  const lastPositionOperationRef = useRef<{ kind: "read" } | { kind: "write"; position: NovelCardPosition | null }>({ kind: "read" });
  const [positionPersistence, setPositionPersistence] = useState<"loading" | "pending" | "saved" | "error">("loading");
  const [positionError, setPositionError] = useState<string | null>(null);
  const materialRef = useRef<HTMLDivElement>(null);
  const positionAnimationRef = useRef<Animation | null>(null);
  const percentage = Math.max(0, Math.min(100, job.progressPercent));

  const current = (session: typeof positionSessionRef.current, revision: number) =>
    session.alive && positionSessionRef.current === session && session.revision === revision;
  const positionFailed = (error: unknown, operation: string, session: typeof positionSessionRef.current, revision: number) => {
    reportFrontendError("editor.novel-task", error, { operation, projectId: session.projectId });
    if (!current(session, revision)) return;
    setPositionPersistence("error");
    setPositionError(operation === "restore-card-position"
      ? "任务卡片位置读取失败，请重试。"
      : "任务卡片位置未保存到本机，请重试。");
    setReady(true);
  };
  const savePosition = (position: NovelCardPosition | null) => {
    const session = positionSessionRef.current, revision = ++session.revision;
    lastPositionOperationRef.current = { kind: "write", position };
    setPositionPersistence("pending");
    setPositionError(null);
    setReady(true);
    void positionStore.write(session.projectId, position).then(() => {
      if (current(session, revision)) setPositionPersistence("saved");
    }, error => positionFailed(error, "persist-card-position", session, revision));
  };
  const restorePosition = (session: typeof positionSessionRef.current) => {
    const revision = ++session.revision;
    lastPositionOperationRef.current = { kind: "read" };
    setPositionPersistence("loading");
    setPositionError(null);
    void positionStore.read(session.projectId).then(saved => {
      if (!current(session, revision)) return;
      normalizedRef.current = saved ?? undefined;
      measure();
      setPositionPersistence("saved");
      setReady(true);
    }, error => positionFailed(error, "restore-card-position", session, revision));
  };
  const place = (position: Point, animate = false) => {
    const bounds = boundsRef.current;
    const target = {
      x: bounds.left + clamp(position.x - bounds.left, bounds.right - bounds.left),
      y: bounds.top + clamp(position.y - bounds.top, bounds.bottom - bounds.top),
    };
    const root = rootRef.current;
    if (!root) return;
    if (root.style.transform && Math.abs(target.x - positionRef.current.x) < .1
      && Math.abs(target.y - positionRef.current.y) < .1) return;
    // Reflow is a presentation-only adjustment. Retarget from the current
    // displayed transform; never overwrite the user's normalized preference.
    const from = getComputedStyle(root).transform;
    positionAnimationRef.current?.cancel();
    positionRef.current = target;
    root.style.transform = `translate3d(${target.x}px, ${target.y}px, 0)`;
    if (animate && root.dataset.ready === "true" && !dragRef.current?.dragged && from !== "none") {
      const { duration, easing } = novelTaskMotion(root, 160);
      const animation = root.animate([{ transform: from }, { transform: root.style.transform }], { duration, easing });
      positionAnimationRef.current = animation;
      const release = () => { if (positionAnimationRef.current === animation) positionAnimationRef.current = null; };
      animation.onfinish = release;
      animation.oncancel = release;
    }
  };
  const measure = () => {
    const root = rootRef.current;
    if (!root) return;
    const visual = window.visualViewport;
    const left = (visual?.offsetLeft ?? 0) + 12;
    const viewportTop = (visual?.offsetTop ?? 0) + 12;
    const viewportBottom = (visual?.offsetTop ?? 0) + (visual?.height ?? innerHeight) - 12;
    const toolbar = document.querySelector(".editor-workspace-toolbar")?.getBoundingClientRect();
    const status = document.querySelector(".workspace-status-bar")?.getBoundingClientRect();
    const top = Math.min(viewportBottom - root.offsetHeight,
      Math.max(viewportTop, toolbar && toolbar.bottom < viewportBottom - root.offsetHeight ? toolbar.bottom + 12 : viewportTop));
    let bottom = Math.min(viewportBottom, status && status.top > top + root.offsetHeight ? status.top - 12 : viewportBottom);
    const avoidAreas = activeAvoidAreas();
    for (const area of avoidAreas) {
      const rect = area.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.top - 12 >= top + root.offsetHeight)
        bottom = Math.min(bottom, rect.top - 12);
    }
    root.dataset.positionBounds = avoidAreas.length ? "publish-dock" : "workspace";
    boundsRef.current = { left, top: Math.max(viewportTop, top),
      right: Math.max(left, (visual?.offsetLeft ?? 0) + (visual?.width ?? innerWidth) - 12 - root.offsetWidth),
      bottom: Math.max(top, bottom - root.offsetHeight) };
    const bounds = boundsRef.current;
    // Live task/DOM updates must not pull a captured drag back to its last
    // saved preference. Pointer movement owns placement until release.
    if (dragRef.current?.dragged) return;
    place(normalizedRef.current
      ? { x: bounds.left + normalizedRef.current.x * (bounds.right - bounds.left),
        y: bounds.top + normalizedRef.current.y * (bounds.bottom - bounds.top) }
      : { x: bounds.right, y: bounds.bottom }, true);
  };
  const persist = () => {
    const bounds = boundsRef.current, position = positionRef.current;
    normalizedRef.current = {
      x: clamp((position.x - bounds.left) / Math.max(1, bounds.right - bounds.left), 1),
      y: clamp((position.y - bounds.top) / Math.max(1, bounds.bottom - bounds.top), 1),
    };
    savePosition(normalizedRef.current);
  };
  useLayoutEffect(() => {
    const session = { projectId, revision: 0, alive: true };
    positionSessionRef.current = session;
    try {
      normalizedRef.current = positionStore.peek(projectId) ?? undefined;
    } catch (error) {
      normalizedRef.current = undefined;
      reportFrontendError("editor.novel-task", error, { operation: "restore-card-position", projectId });
    }
    measure();
    // Existing local position can appear immediately. Without one, wait for
    // the first authoritative native read so restoration does not flash at
    // the default corner and then jump.
    setReady(!positionStore.isNative || normalizedRef.current !== undefined);
    restorePosition(session);
    let frame = 0, alive = true;
    const observedAreas = new Set<HTMLElement>();
    const schedule = () => { if (alive && !frame) frame = requestAnimationFrame(refresh); };
    const refresh = () => {
      frame = 0;
      const areas = activeAvoidAreas();
      for (const area of observedAreas) if (!areas.includes(area)) { observer.unobserve(area); observedAreas.delete(area); }
      for (const area of areas) if (!observedAreas.has(area)) { observer.observe(area); observedAreas.add(area); }
      measure();
      // ResizeObserver does not report an ancestor's FLIP/entry transform.
      // Follow only the live publish owner's finite motion until it settles.
      if (areas.some(area => area.closest(".toolbar-popover")?.getAnimations()
        .some(animation => animation.playState === "running" || animation.pending))) schedule();
    };
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    const observer = new ResizeObserver(schedule);
    if (rootRef.current) observer.observe(rootRef.current);
    for (const selector of [".editor-workspace-toolbar", ".workspace-status-bar"]) {
      const element = document.querySelector(selector);
      if (element) observer.observe(element);
    }
    // The publish workspace mounts after the card. Discover live reserved
    // areas and release them on close; inert/aria-hidden snapshots never own bounds.
    const mutation = new MutationObserver(records => {
      if (records.some(record => !rootRef.current?.contains(record.target))) schedule();
    });
    mutation.observe(document.body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ["class", "inert", "aria-hidden", "data-novel-task-avoid"] });
    schedule();
    return () => {
      alive = false;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      mutation.disconnect();
      positionAnimationRef.current?.cancel();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      dragRef.current = undefined;
      session.alive = false;
    };
  }, [projectId]);
  useLayoutEffect(() => {
    if (suppressed) { materialWasVisible.current = false; return; }
    if (!materialRef.current) return;
    const material = materialRef.current;
    const from = materialWasVisible.current ? Number(getComputedStyle(material).opacity) : .55;
    materialWasVisible.current = true;
    setHidden(false);
    const { reduced, duration, easing } = novelTaskMotion(material, 160);
    const animation = material.animate([
      { opacity: from, transform: reduced ? "none" : getComputedStyle(material).transform },
      { opacity: dismissed ? 0 : 1, transform: reduced || !dismissed ? "none" : "translateY(3px)" },
    ], { duration, easing, fill: "both" });
    animation.onfinish = () => {
      material.style.opacity = dismissed ? "0" : "1";
      material.style.transform = reduced || !dismissed ? "none" : "translateY(3px)";
      setHidden(dismissed);
      animation.cancel();
    };
    return () => {
      // Retarget interrupted fades from their real presentation, not a fresh entry.
      const style = getComputedStyle(material);
      material.style.opacity = style.opacity;
      material.style.transform = style.transform;
      animation.cancel();
    };
  }, [suppressed, dismissed]);

  const begin = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (inactive || event.button !== 0 || dragRef.current) return;
    if (positionAnimationRef.current && rootRef.current) {
      const root = rootRef.current, matrix = new DOMMatrixReadOnly(getComputedStyle(root).transform);
      positionAnimationRef.current.cancel();
      positionAnimationRef.current = null;
      positionRef.current = { x: matrix.m41, y: matrix.m42 };
      root.style.transform = `translate3d(${matrix.m41}px, ${matrix.m42}px, 0)`;
    }
    ignoreClickRef.current = false;
    dragRef.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY },
      origin: positionRef.current, dragged: false };
    // Capture the candidate pointer so a fast first move outside the handle is
    // still observed; no movement or drag state is committed below 6px.
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.start.x, dy = event.clientY - drag.start.y;
    if (!drag.dragged && Math.hypot(dx, dy) <= 6) return;
    if (!drag.dragged) {
      // A late initial native read must not move the card under the pointer.
      positionSessionRef.current.revision++;
      drag.dragged = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    event.preventDefault();
    place({ x: drag.origin.x + dx, y: drag.origin.y + dy });
  };
  const finish = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.dragged) {
      ignoreClickRef.current = true;
      persist();
    }
    dragRef.current = undefined;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div ref={rootRef} className={`novel-task-mini-entry is-${tone}${dragging ? " is-dragging" : ""}`}
      data-testid="novel-task-mini-entry" data-job-status={job.status} data-project-id={projectId}
      data-ready={ready} data-suppressed={suppressed} data-card-hidden={hidden} data-dismissed={dismissed}
      inert={inactive || suppressed || dismissed}
      data-position-persistence={positionPersistence}
      data-position-storage={positionStore.isNative ? "native" : "browser"}
      aria-hidden={inactive || suppressed || dismissed || undefined}
      title={`${job.novelTitle} · ${label} · ${job.completedChunks}/${job.totalChunks} · ${Math.round(percentage)}%`}>
      <div ref={materialRef} className="novel-task-card-material">
        <button className="novel-task-card-grip" type="button" aria-label="拖动小说任务卡片"
          onPointerDown={begin} onPointerMove={move} onPointerUp={finish}
          onPointerCancel={finish} onLostPointerCapture={finish}
          onClick={event => {
            if (ignoreClickRef.current) { ignoreClickRef.current = false; event.preventDefault(); return; }
            onOpen();
          }}>
          <GripHorizontal size={14} /><strong>{job.novelTitle}</strong>
        </button>
        <button type="button" className="novel-task-card-open"
          aria-label={`打开小说任务面板，当前状态：${label}`} onClick={onOpen}>
          <Sparkles size={14} /><span>{label}</span>
          <small>{job.completedChunks}/{job.totalChunks} · {Math.round(percentage)}%</small>
        </button>
        <div className="novel-task-card-progress" role="progressbar" aria-label="小说解析进度"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}>
          <span style={{ transform: `scaleX(${percentage / 100})` }} />
        </div>
        <button type="button" className="novel-task-card-reset" aria-label="恢复任务卡片默认位置"
          onClick={() => {
            normalizedRef.current = undefined;
            savePosition(null);
            measure();
          }}><RotateCcw size={13} /></button>
        <button type="button" className="novel-task-card-close" aria-label="隐藏任务卡片"
          title="隐藏卡片，任务继续运行；从小说导入恢复" onClick={onDismiss}><X size={13} /></button>
        <span className="novel-task-position-status" role="status" aria-live="polite">
          {positionPersistence === "pending" ? "正在保存任务卡片位置" : ""}
        </span>
        {positionError && <div className="novel-task-position-error" role="alert">
          <span>{positionError}</span>
          <button type="button" aria-label={lastPositionOperationRef.current.kind === "read"
            ? "重试读取任务卡片位置" : "重试保存任务卡片位置"} onClick={() => {
            const operation = lastPositionOperationRef.current;
            rootRef.current?.querySelector<HTMLButtonElement>(".novel-task-card-reset")?.focus({ preventScroll: true });
            if (operation.kind === "write") savePosition(operation.position);
            else restorePosition(positionSessionRef.current);
          }}>重试</button>
        </div>}
      </div>
    </div>
  );
}
