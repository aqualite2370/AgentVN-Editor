import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  formatHoverHelp,
  type HoverHelpEntry,
  getHoverHelpEntry,
  getPatternHelpEntry,
  titleReplacements,
} from "./hoverHelpCatalog";

interface HoverHelpState {
  title: string;
  body: string;
  contentVersion: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  placement: "top" | "bottom" | "right" | "left";
  phase: "open" | "closing";
  mode: "pointer" | "focus";
}

interface CardSize {
  width: number;
  height: number;
}

interface PointerPosition {
  x: number;
  y: number;
}

const tooltipId = "agentvn-hover-help-tooltip";
const estimatedCardSize: CardSize = { width: 340, height: 140 };
const viewportMargin = 12;
const controlGap = 9;
const pointerOffset = 14;
const followEase = 0.045;
const followSnapDistance = 0.4;
const pointerShowDelayMs = 200;
const closeGraceDelayMs = 120;
const closeDelayMs = 380;

const homeHelpEntries: Record<string, HoverHelpEntry> = {
  "home.openDraft": {
    title: "继续上次编辑",
    purpose: "打开自动保存的上次工程，恢复最近编辑的节点、素材和创作状态。",
    usage: "适合继续未完成的创作，不需要重新导入工程文件。",
    effect: "只会加载编辑器工程数据，不会修改已导出的卡带或玩家存档。",
  },
  "home.createProject": {
    title: "新建项目",
    purpose: "创建一个新的创作者工程，用于从零开始搭建视觉小说节点图。",
    usage: "适合开始新作品，或在当前工程之外另起一个干净草稿。",
    effect: "会初始化默认入口和开场场景，不会把旧工程写入新项目。",
  },
  "home.importProject": {
    title: "导入项目",
    purpose: "读取本地 project.vnproj 或 JSON 工程文件，并恢复其中的编辑器数据。",
    usage: "用于继续外部保存的创作者工程，不用于导入玩家端 .vncart 卡带；若想把另一份工程作为独立线路加入当前画布，请进入编辑器后使用顶部工具栏的导入工程。",
    effect: "主页导入会把该工程作为当前工程打开，不会把它合并到已有节点流。",
  },
  "home.recentProject": {
    title: "最近项目",
    purpose: "打开最近编辑过的工程记录，方便继续创作。",
    usage: "点击条目即可恢复对应工程的节点图和工程元数据。",
    effect: "只影响创作者编辑器状态，不会直接启动玩家端或覆盖卡带。",
  },
};

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function humanizeTitle(text: string): string {
  const normalized = normalizeText(text);
  const replacement = titleReplacements.find(([pattern]) => pattern.test(normalized));
  return replacement ? replacement[1] : normalized;
}

function getInheritedHelpEntry(element: HTMLElement): HoverHelpEntry | undefined {
  const homeEntry = element.dataset.helpKey ? homeHelpEntries[element.dataset.helpKey] : undefined;
  if (homeEntry) return homeEntry;

  const direct = getHoverHelpEntry(element.dataset.helpKey);
  if (direct) return direct;

  const field = getHoverHelpEntry(element.dataset.field ? `field.${element.dataset.field}` : undefined);
  if (field) return field;

  const label = element.closest("label");
  const fieldHelp = label?.querySelector<HTMLElement>(".field-help[data-field], .field-help[data-help-key]");
  if (!fieldHelp) return undefined;

  return (
    getHoverHelpEntry(fieldHelp.dataset.helpKey) ??
    getHoverHelpEntry(fieldHelp.dataset.field ? `field.${fieldHelp.dataset.field}` : undefined)
  );
}

function getLabelText(element: HTMLElement): string {
  const catalog = getInheritedHelpEntry(element);
  if (catalog) return catalog.title;

  const explicit = element.dataset.helpTitle || element.getAttribute("aria-label") || element.getAttribute("title") || "";
  if (explicit) return humanizeTitle(explicit);

  const ownText = normalizeText(element.textContent ?? "");
  if (ownText) return humanizeTitle(ownText);

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const label = element.closest("label");
    const labelText = label ? normalizeText(label.textContent ?? "") : "";
    const placeholder = element instanceof HTMLSelectElement ? "" : element.placeholder;
    return humanizeTitle(labelText || placeholder || element.name || element.id || "控件");
  }

  return "控件";
}

function getHelpBody(title: string, element: HTMLElement): string | undefined {
  const catalog = getInheritedHelpEntry(element);
  if (catalog) return formatHoverHelp(catalog);

  const explicit = element.dataset.help || element.getAttribute("data-tooltip");
  if (explicit) return explicit;

  const matched = getPatternHelpEntry(title);
  if (matched) return formatHoverHelp(matched);

  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isInputLike(element: HTMLElement): boolean {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}

function isActionLike(element: HTMLElement): boolean {
  return element.tagName === "BUTTON" || element.getAttribute("role") === "button" || element.classList.contains("field-help");
}

function getPreferredPlacements(element: HTMLElement): HoverHelpState["placement"][] {
  if (isInputLike(element)) return ["bottom", "top", "right", "left"];
  if (isActionLike(element)) return ["right", "bottom", "top", "left"];
  return ["bottom", "top", "right", "left"];
}

function getBoundedCardSize(size: CardSize): CardSize {
  return {
    width: Math.min(Math.max(size.width, 1), Math.max(1, window.innerWidth - viewportMargin * 2)),
    height: Math.min(Math.max(size.height, 1), Math.max(1, window.innerHeight - viewportMargin * 2)),
  };
}

function getPositionForPlacement(
  rect: DOMRect,
  placement: HoverHelpState["placement"],
  width: number,
  height: number,
): { x: number; y: number } {
  if (placement === "right") {
    return {
      x: rect.right + controlGap,
      y: rect.top + rect.height / 2 - height / 2,
    };
  }
  if (placement === "left") {
    return {
      x: rect.left - width - controlGap,
      y: rect.top + rect.height / 2 - height / 2,
    };
  }
  if (placement === "top") {
    return {
      x: rect.left + rect.width / 2 - width / 2,
      y: rect.top - height - controlGap,
    };
  }
  return {
    x: rect.left + rect.width / 2 - width / 2,
    y: rect.bottom + controlGap,
  };
}

function fitsViewport(position: { x: number; y: number }, width: number, height: number): boolean {
  return (
    position.x >= viewportMargin &&
    position.y >= viewportMargin &&
    position.x + width <= window.innerWidth - viewportMargin &&
    position.y + height <= window.innerHeight - viewportMargin
  );
}

function getCardPosition(
  element: HTMLElement,
  rect: DOMRect,
  size: CardSize = estimatedCardSize,
): { x: number; y: number; placement: HoverHelpState["placement"] } {
  const { width, height } = getBoundedCardSize(size);
  const placements = getPreferredPlacements(element);
  for (const placement of placements) {
    const position = getPositionForPlacement(rect, placement, width, height);
    if (fitsViewport(position, width, height)) {
      return { ...position, placement };
    }
  }

  const fallbackPlacement = placements[0];
  const fallback = getPositionForPlacement(rect, fallbackPlacement, width, height);
  return {
    x: clamp(fallback.x, viewportMargin, window.innerWidth - width - viewportMargin),
    y: clamp(fallback.y, viewportMargin, window.innerHeight - height - viewportMargin),
    placement: fallbackPlacement,
  };
}

function getPointerPositionForPlacement(
  pointerX: number,
  pointerY: number,
  placement: HoverHelpState["placement"],
  width: number,
  height: number,
): { x: number; y: number } {
  if (placement === "right") return { x: pointerX + pointerOffset, y: pointerY + pointerOffset };
  if (placement === "left") return { x: pointerX - width - pointerOffset, y: pointerY + pointerOffset };
  if (placement === "top") return { x: pointerX - width / 2, y: pointerY - height - pointerOffset };
  return { x: pointerX - width / 2, y: pointerY + pointerOffset };
}

function uniquePlacements(placements: Array<HoverHelpState["placement"] | undefined>): HoverHelpState["placement"][] {
  const seen = new Set<HoverHelpState["placement"]>();
  return placements.filter((placement): placement is HoverHelpState["placement"] => {
    if (!placement || seen.has(placement)) return false;
    seen.add(placement);
    return true;
  });
}

function clampCardPosition(position: { x: number; y: number }, size: CardSize): { x: number; y: number } {
  const { width, height } = getBoundedCardSize(size);
  return {
    x: clamp(position.x, viewportMargin, Math.max(viewportMargin, window.innerWidth - width - viewportMargin)),
    y: clamp(position.y, viewportMargin, Math.max(viewportMargin, window.innerHeight - height - viewportMargin)),
  };
}

function getPointerCardPosition(
  pointerX: number,
  pointerY: number,
  size: CardSize = estimatedCardSize,
  preferredPlacement?: HoverHelpState["placement"],
): { x: number; y: number; placement: HoverHelpState["placement"] } {
  const { width, height } = getBoundedCardSize(size);
  const placements = uniquePlacements([preferredPlacement, "right", "bottom", "left", "top"]);
  for (const placement of placements) {
    const position = getPointerPositionForPlacement(pointerX, pointerY, placement, width, height);
    if (fitsViewport(position, width, height)) return { ...position, placement };
  }

  const placement = placements[0];
  const fallback = getPointerPositionForPlacement(pointerX, pointerY, placement, width, height);
  return {
    ...clampCardPosition(fallback, { width, height }),
    placement,
  };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function HoverHelpLayer() {
  const [help, setHelp] = useState<HoverHelpState | null>(null);
  const helpRef = useRef<HoverHelpState | null>(null);
  const contentVersionRef = useRef(0);
  const showTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const followFrameRef = useRef<number | null>(null);
  const activeElementRef = useRef<HTMLElement | null>(null);
  const describedElementRef = useRef<HTMLElement | null>(null);
  const previousDescribedByRef = useRef<string | null>(null);
  const targetRef = useRef<{ x: number; y: number; placement: HoverHelpState["placement"] } | null>(null);
  const positionRef = useRef<{ x: number; y: number } | null>(null);
  const pointerRef = useRef<PointerPosition | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const cardSizeRef = useRef<CardSize>(estimatedCardSize);

  function setHelpState(next: HoverHelpState | null | ((current: HoverHelpState | null) => HoverHelpState | null)) {
    if (typeof next !== "function") helpRef.current = next;
    setHelp((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      helpRef.current = resolved;
      return resolved;
    });
  }

  function clearFollowFrame() {
    if (followFrameRef.current !== null) {
      window.cancelAnimationFrame(followFrameRef.current);
      followFrameRef.current = null;
    }
  }

  function startFollowLoop() {
    if (followFrameRef.current !== null || prefersReducedMotion()) return;
    const step = () => {
      followFrameRef.current = null;
      const target = targetRef.current;
      const position = positionRef.current;
      if (!target || !position) return;
      const dx = target.x - position.x;
      const dy = target.y - position.y;
      const distance = Math.hypot(dx, dy);
      const nextPosition = distance <= followSnapDistance
        ? { x: target.x, y: target.y }
        : { x: position.x + dx * followEase, y: position.y + dy * followEase };
      positionRef.current = nextPosition;
      setHelpState((current) => current && current.mode === "pointer"
        ? {
            ...current,
            phase: "open",
            x: nextPosition.x,
            y: nextPosition.y,
            targetX: target.x,
            targetY: target.y,
            placement: target.placement,
          }
        : current);
      if (distance > followSnapDistance) followFrameRef.current = window.requestAnimationFrame(step);
    };
    followFrameRef.current = window.requestAnimationFrame(step);
  }

  useEffect(() => {
    helpRef.current = help;
  }, [help]);

  useEffect(() => {
    if (!help) return;
    const node = cardRef.current;
    if (!node) return;

    const syncMeasuredSize = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nextSize = { width: rect.width, height: rect.height };
      const previousSize = cardSizeRef.current;
      if (
        Math.abs(previousSize.width - nextSize.width) < 0.5 &&
        Math.abs(previousSize.height - nextSize.height) < 0.5
      ) {
        return;
      }

      cardSizeRef.current = nextSize;
      const current = helpRef.current;
      if (!current) return;

      if (current.mode === "pointer" && pointerRef.current) {
        const target = getPointerCardPosition(
          pointerRef.current.x,
          pointerRef.current.y,
          nextSize,
          current.placement,
        );
        const position = clampCardPosition(positionRef.current ?? { x: current.x, y: current.y }, nextSize);
        targetRef.current = target;
        positionRef.current = position;
        setHelpState((latest) => latest && latest.mode === "pointer"
          ? {
              ...latest,
              x: position.x,
              y: position.y,
              targetX: target.x,
              targetY: target.y,
              placement: target.placement,
              phase: "open",
            }
          : latest);
        startFollowLoop();
        return;
      }

      if (current.mode === "focus" && activeElementRef.current) {
        const rect = activeElementRef.current.getBoundingClientRect();
        const nextPosition = getCardPosition(activeElementRef.current, rect, nextSize);
        positionRef.current = { x: nextPosition.x, y: nextPosition.y };
        setHelpState((latest) => latest && latest.mode === "focus"
          ? {
              ...latest,
              x: nextPosition.x,
              y: nextPosition.y,
              targetX: nextPosition.x,
              targetY: nextPosition.y,
              placement: nextPosition.placement,
              phase: "open",
            }
          : latest);
      }
    };

    syncMeasuredSize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(syncMeasuredSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [help?.title, help?.body, help?.mode]);

  useEffect(() => {
    const selector = [
      "button",
      ".file-button",
      "input",
      "textarea",
      "select",
      ".field-help",
      "[role='button']",
      "[data-help-key]",
      "[data-help]",
      "[data-tooltip]",
      "[data-help-title]",
    ].join(", ");

    function clearShowTimer() {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
    }

    function clearCloseTimer() {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    }

    function getHelpTarget(target: EventTarget | null): HTMLElement | null {
      const element = target instanceof HTMLElement ? target.closest<HTMLElement>(selector) : null;
      if (!element || element.closest(".hover-help-card")) return null;
      if (element.closest("[data-hover-help-suppressed='true']")) return null;
      if (element instanceof HTMLInputElement && element.type === "file") return null;
      return element;
    }

    function clearDescribedElement() {
      const element = describedElementRef.current;
      if (!element) return;
      const previous = previousDescribedByRef.current;
      if (previous) element.setAttribute("aria-describedby", previous);
      else element.removeAttribute("aria-describedby");
      describedElementRef.current = null;
      previousDescribedByRef.current = null;
    }

    function describeFocusedElement(element: HTMLElement) {
      if (document.activeElement !== element) return;
      if (describedElementRef.current === element) return;
      clearDescribedElement();
      const previous = element.getAttribute("aria-describedby");
      previousDescribedByRef.current = previous;
      describedElementRef.current = element;
      const tokens = previous ? previous.split(/\s+/).filter(Boolean) : [];
      if (!tokens.includes(tooltipId)) tokens.push(tooltipId);
      element.setAttribute("aria-describedby", tokens.join(" "));
    }

    function closeHelp(immediate = false) {
      clearShowTimer();
      activeElementRef.current = null;
      clearDescribedElement();
      clearCloseTimer();
      clearFollowFrame();
      targetRef.current = null;
      positionRef.current = null;
      pointerRef.current = null;
      if (immediate || prefersReducedMotion()) {
        setHelpState(null);
        return;
      }
      setHelpState((current) => current ? { ...current, phase: "closing" } : null);
      closeTimerRef.current = window.setTimeout(() => {
        setHelpState(null);
        closeTimerRef.current = null;
      }, closeDelayMs);
    }

    function scheduleCloseHelp() {
      clearShowTimer();
      clearCloseTimer();
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        closeHelp();
      }, closeGraceDelayMs);
    }

    function buildHelp(element: HTMLElement, event: Event): HoverHelpState | null {
      const title = getLabelText(element);
      const body = getHelpBody(title, element);
      if (!body) return null;
      const current = helpRef.current;
      const contentVersion = current && current.title === title && current.body === body
        ? current.contentVersion
        : contentVersionRef.current + 1;
      contentVersionRef.current = Math.max(contentVersionRef.current, contentVersion);
      if (event instanceof MouseEvent || event instanceof PointerEvent) {
        const previousPlacement = helpRef.current?.mode === "pointer" ? helpRef.current.placement : targetRef.current?.placement;
        const { x, y, placement } = getPointerCardPosition(event.clientX, event.clientY, cardSizeRef.current, previousPlacement);
        return { title, body, contentVersion, x, y, targetX: x, targetY: y, placement, phase: "open", mode: "pointer" };
      }
      const rect = element.getBoundingClientRect();
      const { x, y, placement } = getCardPosition(element, rect, cardSizeRef.current);
      return { title, body, contentVersion, x, y, targetX: x, targetY: y, placement, phase: "open", mode: "focus" };
    }

    function showFor(event: Event) {
      const element = getHelpTarget(event.target);
      if (!element) {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (target?.closest("[data-hover-help-suppressed='true']")) closeHelp(true);
        return;
      }

      activeElementRef.current = element;
      const nextHelp = buildHelp(element, event);
      if (!nextHelp) {
        closeHelp(true);
        return;
      }
      clearShowTimer();
      clearCloseTimer();
      if (event.type === "focusin") {
        clearFollowFrame();
        targetRef.current = null;
        pointerRef.current = null;
        positionRef.current = { x: nextHelp.x, y: nextHelp.y };
        setHelpState(nextHelp);
        describeFocusedElement(element);
        return;
      }

      if (event instanceof MouseEvent || event instanceof PointerEvent) {
        pointerRef.current = { x: event.clientX, y: event.clientY };
        const target = { x: nextHelp.targetX, y: nextHelp.targetY, placement: nextHelp.placement };
        targetRef.current = target;
        const current = helpRef.current;
        if (current?.mode === "pointer") {
          positionRef.current = positionRef.current ?? { x: current.x, y: current.y };
          setHelpState({
            ...current,
            title: nextHelp.title,
            body: nextHelp.body,
            contentVersion: nextHelp.contentVersion,
            targetX: target.x,
            targetY: target.y,
            placement: target.placement,
            phase: "open",
            mode: "pointer",
          });
          startFollowLoop();
          return;
        }
      }

      showTimerRef.current = window.setTimeout(() => {
        if (activeElementRef.current === element) {
          const latestTarget = targetRef.current ?? { x: nextHelp.targetX, y: nextHelp.targetY, placement: nextHelp.placement };
          targetRef.current = latestTarget;
          positionRef.current = { x: nextHelp.x, y: nextHelp.y };
          setHelpState({
            ...nextHelp,
            targetX: latestTarget.x,
            targetY: latestTarget.y,
            placement: latestTarget.placement,
          });
          startFollowLoop();
        }
        showTimerRef.current = null;
      }, pointerShowDelayMs);
    }

    function moveFor(event: MouseEvent) {
      const element = getHelpTarget(event.target);
      if (!element || element !== activeElementRef.current) return;
      pointerRef.current = { x: event.clientX, y: event.clientY };
      const target = getPointerCardPosition(event.clientX, event.clientY, cardSizeRef.current, targetRef.current?.placement ?? helpRef.current?.placement);
      targetRef.current = target;
      setHelpState((current) => current && current.mode === "pointer" ? { ...current, targetX: target.x, targetY: target.y, placement: target.placement, phase: "open" } : current);
      startFollowLoop();
    }

    function hide(event?: Event) {
      if (event instanceof MouseEvent) {
        const from = getHelpTarget(event.target);
        const to = getHelpTarget(event.relatedTarget);
        if (from && to && from === to) return;
        if (to) {
          activeElementRef.current = to;
          clearCloseTimer();
          return;
        }
        scheduleCloseHelp();
        return;
      }

      closeHelp();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeHelp(true);
    }

    document.addEventListener("mouseover", showFor);
    document.addEventListener("mousemove", moveFor);
    document.addEventListener("focusin", showFor);
    document.addEventListener("mouseout", hide);
    document.addEventListener("focusout", hide);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mouseover", showFor);
      document.removeEventListener("mousemove", moveFor);
      document.removeEventListener("focusin", showFor);
      document.removeEventListener("mouseout", hide);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("keydown", onKeyDown);
      clearShowTimer();
      clearCloseTimer();
      clearFollowFrame();
      clearDescribedElement();
      pointerRef.current = null;
    };
  }, []);

  if (!help) return null;

  return createPortal(
    <aside
      ref={cardRef}
      id={tooltipId}
      className={`hover-help-card is-${help.placement} is-${help.phase}`}
      style={{
        "--hover-help-x": `${help.x}px`,
        "--hover-help-y": `${help.y}px`,
      } as CSSProperties}
      role="tooltip"
    >
      <div key={help.contentVersion} className="hover-help-copy">
        <strong>{help.title}</strong>
        <p>{help.body}</p>
      </div>
    </aside>,
    document.body,
  );
}
