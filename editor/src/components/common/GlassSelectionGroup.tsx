import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type FocusEvent,
  type ReactNode,
  type RefObject,
} from "react";
import LiquidGlass from "liquid-glass-react";

type GlassSelectionGroupElement = "div" | "nav" | "header" | "aside";
type GlassSelectionScrollAxis = "x" | "y";

interface GlassSelectionGroupProps {
  as?: GlassSelectionGroupElement;
  children: ReactNode;
  className?: string;
  id?: string;
  testId?: string;
  style?: CSSProperties;
  selectedKey?: string | number | boolean;
  role?: string;
  ariaLabel?: string;
  scrollAxis?: GlassSelectionScrollAxis;
  viewportClassName?: string;
  viewportStyle?: CSSProperties;
  observeViewportResize?: boolean;
  onMouseDown?: React.MouseEventHandler<HTMLElement>;
  motion?: "full" | "light";
}

interface SelectionGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SelectionMotionState {
  current: SelectionGeometry | null;
  target: SelectionGeometry | null;
  velocity: SelectionGeometry;
}

type GlassMotionReason = "selection" | "press" | "scroll" | "layout" | "visibility";

const zeroGeometry = (): SelectionGeometry => ({ x: 0, y: 0, width: 0, height: 0 });
const springResponseSeconds = 0.34;
const springDampingRatio = 0.72;
const springAngularFrequency = (Math.PI * 2) / springResponseSeconds;
const springStiffness = springAngularFrequency * springAngularFrequency;
const springDamping = 2 * springDampingRatio * springAngularFrequency;
const maximumFrameSeconds = 1 / 30;
const maximumSpringStepSeconds = 1 / 120;
const positionRestThreshold = 0.08;
const velocityRestThreshold = 0.5;
const targetGeometryTolerance = 0.1;
const maximumSpringRunMilliseconds = 900;
const maximumStretch = 0.18;
const maximumSquash = 0.08;
const scrollSafeInset = 8;

function sameGeometry(current: SelectionGeometry | null, next: SelectionGeometry | null) {
  if (!current || !next) return current === next;
  return Math.abs(current.x - next.x) < targetGeometryTolerance
    && Math.abs(current.y - next.y) < targetGeometryTolerance
    && Math.abs(current.width - next.width) < targetGeometryTolerance
    && Math.abs(current.height - next.height) < targetGeometryTolerance;
}

function springStep(value: number, velocity: number, target: number, deltaSeconds: number) {
  const acceleration = (-springStiffness * (value - target)) - (springDamping * velocity);
  const nextVelocity = velocity + acceleration * deltaSeconds;
  return {
    value: value + nextVelocity * deltaSeconds,
    velocity: nextVelocity,
  };
}

function isGeometryAtRest(current: SelectionGeometry, target: SelectionGeometry, velocity: SelectionGeometry) {
  return Math.abs(current.x - target.x) < positionRestThreshold
    && Math.abs(current.y - target.y) < positionRestThreshold
    && Math.abs(current.width - target.width) < positionRestThreshold
    && Math.abs(current.height - target.height) < positionRestThreshold
    && Math.abs(velocity.x) < velocityRestThreshold
    && Math.abs(velocity.y) < velocityRestThreshold
    && Math.abs(velocity.width) < velocityRestThreshold
    && Math.abs(velocity.height) < velocityRestThreshold;
}

function LiquidGlassAdapter({
  mouseContainer,
  overLight,
}: {
  mouseContainer: RefObject<HTMLElement | null>;
  overLight: boolean;
}) {
  return (
    <div className="liquid-glass-adapter" aria-hidden="true">
      <LiquidGlass
        className="liquid-glass-surface"
        displacementScale={64}
        blurAmount={0.1}
        saturation={150}
        aberrationIntensity={1.8}
        elasticity={0.35}
        cornerRadius={10}
        padding="0"
        overLight={overLight}
        mouseContainer={mouseContainer}
        mode="prominent"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      >
        <span className="liquid-glass-adapter-fill" />
      </LiquidGlass>
    </div>
  );
}

function StaticGlassAdapter() {
  return (
    <div className="static-glass-adapter" aria-hidden="true">
      <span className="static-glass-adapter-fill" />
    </div>
  );
}

export const GlassSelectionGroup = forwardRef<HTMLElement, GlassSelectionGroupProps>(function GlassSelectionGroup({
  as = "div",
  children,
  className,
  selectedKey,
  role,
  ariaLabel,
  id,
  testId,
  style,
  scrollAxis,
  viewportClassName,
  viewportStyle,
  observeViewportResize = false,
  onMouseDown,
  motion = "full",
}: GlassSelectionGroupProps, forwardedRef) {
  const rootRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const materialRef = useRef<HTMLDivElement | null>(null);
  const rimRef = useRef<HTMLSpanElement | null>(null);
  const measureFrameRef = useRef<number | null>(null);
  const motionFrameRef = useRef<number | null>(null);
  const deferredFrameRef = useRef<number | null>(null);
  const formationAnimationRef = useRef<{ cancel: () => void } | null>(null);
  const stableLayoutWaitRef = useRef<(() => void) | null>(null);
  const previousMotionTimeRef = useRef<number | null>(null);
  const motionStartTimeRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(false);
  const keyboardInputRef = useRef(false);
  const pendingReasonRef = useRef<GlassMotionReason>("layout");
  const motionStateRef = useRef<SelectionMotionState>({
    current: null,
    target: null,
    velocity: zeroGeometry(),
  });
  const [overLight, setOverLight] = useState(() => (
    typeof document !== "undefined" && document.documentElement.dataset.theme === "white_gray"
  ));
  const hideIndicator = useCallback(() => {
    const indicator = indicatorRef.current;
    if (!indicator) return;
    formationAnimationRef.current?.cancel();
    formationAnimationRef.current = null;
    indicator.dataset.glassVisible = "false";
    indicator.dataset.glassMoving = "false";
    indicator.dataset.glassState = "hidden";
    indicator.dataset.glassPressed = "false";
    indicator.style.opacity = "0";
    if (materialRef.current) materialRef.current.style.transform = "scale(1, 1)";
    if (rimRef.current) {
      rimRef.current.style.opacity = "1";
      rimRef.current.style.transform = "scale(1)";
    }
    pendingReasonRef.current = "layout";
    motionStateRef.current = {
      current: null,
      target: null,
      velocity: zeroGeometry(),
    };
    if (motionFrameRef.current !== null) {
      window.cancelAnimationFrame(motionFrameRef.current);
      motionFrameRef.current = null;
    }
    previousMotionTimeRef.current = null;
    motionStartTimeRef.current = null;
  }, []);

  const renderGeometry = useCallback((current: SelectionGeometry, target: SelectionGeometry, moving: boolean) => {
    const indicator = indicatorRef.current;
    if (!indicator || target.width <= 0 || target.height <= 0) return;

    const speedX = motionStateRef.current.velocity.x;
    const speedY = motionStateRef.current.velocity.y;
    const speed = Math.hypot(speedX, speedY);
    const stretch = moving && !reducedMotionRef.current
      ? Math.min(maximumStretch, speed / 1550)
      : 0;
    const horizontal = Math.abs(speedX) >= Math.abs(speedY);
    const deformX = horizontal ? 1 + stretch : 1 - Math.min(maximumSquash, stretch * 0.45);
    const deformY = horizontal ? 1 - Math.min(maximumSquash, stretch * 0.45) : 1 + stretch;
    const scaleX = current.width / target.width;
    const scaleY = current.height / target.height;
    const visualWidth = current.width * deformX;
    const visualHeight = current.height * deformY;
    const visualX = current.x - ((visualWidth - current.width) / 2);
    const visualY = current.y - ((visualHeight - current.height) / 2);

    /*
     * Keep the indicator as the position layer (no transform scale), while
     * exposing the elastic deformation through its measured box.  This lets
     * the exterior rim/shadow stretch with the selection without clipping at
     * the scroll viewport; the material layer only tracks the spring's base
     * geometry.
     */
    indicator.style.width = `${visualWidth}px`;
    indicator.style.height = `${visualHeight}px`;
    indicator.style.transform = `translate3d(${visualX}px, ${visualY}px, 0)`;
    if (materialRef.current) materialRef.current.style.transform = `scale(${scaleX}, ${scaleY})`;
    const forming = indicator.dataset.glassState === "forming";
    if (!forming) {
      indicator.style.opacity = "1";
      indicator.dataset.glassVisible = "true";
    }
    indicator.dataset.glassMoving = moving ? "true" : "false";
    if (!forming) indicator.dataset.glassState = "settled";
  }, []);

  const settleImmediately = useCallback((target: SelectionGeometry) => {
    if (motionFrameRef.current !== null) {
      window.cancelAnimationFrame(motionFrameRef.current);
      motionFrameRef.current = null;
    }
    previousMotionTimeRef.current = null;
    motionStartTimeRef.current = null;
    motionStateRef.current = {
      current: { ...target },
      target: { ...target },
      velocity: zeroGeometry(),
    };
    renderGeometry(target, target, false);
  }, [renderGeometry]);

  const settleLight = useCallback((target: SelectionGeometry) => {
    const indicator = indicatorRef.current;
    const previous = motionStateRef.current.current;
    const fromTransform = indicator && previous ? getComputedStyle(indicator).transform : undefined;
    formationAnimationRef.current?.cancel();
    if (motionFrameRef.current !== null) {
      window.cancelAnimationFrame(motionFrameRef.current);
      motionFrameRef.current = null;
    }
    motionStateRef.current = { current: { ...target }, target: { ...target }, velocity: zeroGeometry() };
    renderGeometry(target, target, false);
    if (indicator && previous && !sameGeometry(previous, target) && fromTransform) {
      indicator.dataset.glassMoving = "true";
      const style = getComputedStyle(document.documentElement);
      const scale = Number(style.getPropertyValue("--motion-scale").trim());
      const animation = indicator.animate(
        [{ transform: fromTransform }, { transform: indicator.style.transform }],
        // Keyboard and reduced motion still need a continuous ownership cue.
        // This lightweight layer has no elastic distortion or parallax.
        { duration: 120 * (Number.isFinite(scale) ? Math.max(1, scale) : 1),
          easing: style.getPropertyValue("--ease-ui-out").trim() || "cubic-bezier(0.23,1,0.32,1)" },
      );
      formationAnimationRef.current = animation;
      const finish = () => {
        if (formationAnimationRef.current !== animation) return;
        indicator.dataset.glassMoving = "false";
        formationAnimationRef.current = null;
      };
      animation.onfinish = finish;
      animation.oncancel = finish;
    }
  }, [renderGeometry]);

  const runSpring = useCallback((time: number) => {
    const state = motionStateRef.current;
    if (!state.current || !state.target) {
      motionFrameRef.current = null;
      previousMotionTimeRef.current = null;
      return;
    }

    const previousTime = previousMotionTimeRef.current ?? time;
    const motionStartTime = motionStartTimeRef.current ?? time;
    motionStartTimeRef.current = motionStartTime;
    const deltaSeconds = Math.min(maximumFrameSeconds, Math.max(0, (time - previousTime) / 1000));
    previousMotionTimeRef.current = time;

    const stepCount = Math.max(1, Math.ceil(deltaSeconds / maximumSpringStepSeconds));
    const stepSeconds = deltaSeconds / stepCount;
    for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
      const x = springStep(state.current.x, state.velocity.x, state.target.x, stepSeconds);
      const y = springStep(state.current.y, state.velocity.y, state.target.y, stepSeconds);
      const width = springStep(state.current.width, state.velocity.width, state.target.width, stepSeconds);
      const height = springStep(state.current.height, state.velocity.height, state.target.height, stepSeconds);
      state.current = {
        x: x.value,
        y: y.value,
        width: Math.max(1, width.value),
        height: Math.max(1, height.value),
      };
      state.velocity = {
        x: x.velocity,
        y: y.velocity,
        width: width.velocity,
        height: height.velocity,
      };
    }

    if (
      isGeometryAtRest(state.current, state.target, state.velocity)
      || time - motionStartTime >= maximumSpringRunMilliseconds
    ) {
      state.current = { ...state.target };
      state.velocity = zeroGeometry();
      renderGeometry(state.current, state.target, false);
      motionFrameRef.current = null;
      previousMotionTimeRef.current = null;
      motionStartTimeRef.current = null;
      return;
    }

    renderGeometry(state.current, state.target, true);
    motionFrameRef.current = window.requestAnimationFrame(runSpring);
  }, [renderGeometry]);

  const startSpring = useCallback((target: SelectionGeometry, reason: GlassMotionReason) => {
    if (motion === "light") {
      settleLight(target);
      return;
    }
    const state = motionStateRef.current;
    if (reason !== "selection" || !state.current || reducedMotionRef.current || keyboardInputRef.current) {
      settleImmediately(target);
      return;
    }
    if (sameGeometry(state.target, target)) return;
    if (sameGeometry(state.current, target)) {
      settleImmediately(target);
      return;
    }
    state.target = { ...target };
    motionStartTimeRef.current = null;
    if (motionFrameRef.current === null) {
      previousMotionTimeRef.current = null;
      motionFrameRef.current = window.requestAnimationFrame(runSpring);
    }
  }, [motion, runSpring, settleImmediately, settleLight]);

  const enterDeferredState = useCallback(() => {
    const indicator = indicatorRef.current;
    if (!indicator) return;
    formationAnimationRef.current?.cancel();
    formationAnimationRef.current = null;
    if (motionFrameRef.current !== null) {
      window.cancelAnimationFrame(motionFrameRef.current);
      motionFrameRef.current = null;
    }
    previousMotionTimeRef.current = null;
    motionStartTimeRef.current = null;
    motionStateRef.current = {
      current: null,
      target: null,
      velocity: zeroGeometry(),
    };
    indicator.style.opacity = "0";
    indicator.dataset.glassVisible = "false";
    indicator.dataset.glassMoving = "false";
    indicator.dataset.glassState = "deferred";
    if (materialRef.current) materialRef.current.style.transform = "scale(1, 1)";
  }, []);

  const deferToTarget = useCallback((target: SelectionGeometry) => {
    enterDeferredState();
    const indicator = indicatorRef.current;
    if (!indicator) return;
    motionStateRef.current = {
      current: { ...target },
      target: { ...target },
      velocity: zeroGeometry(),
    };
    indicator.style.width = `${target.width}px`;
    indicator.style.height = `${target.height}px`;
    indicator.style.transform = `translate3d(${target.x}px, ${target.y}px, 0)`;
  }, [enterDeferredState]);

  const formAtTarget = useCallback((target: SelectionGeometry) => {
    const indicator = indicatorRef.current;
    const material = materialRef.current;
    if (!indicator || !material || target.width <= 0 || target.height <= 0) return;
    formationAnimationRef.current?.cancel();
    indicator.style.width = `${target.width}px`;
    indicator.style.height = `${target.height}px`;
    indicator.style.transform = `translate3d(${target.x}px, ${target.y}px, 0)`;
    material.style.transform = "scale(1, 1)";
    indicator.style.opacity = "1";
    indicator.dataset.glassVisible = "true";
    indicator.dataset.glassMoving = "false";
    indicator.dataset.glassState = reducedMotionRef.current ? "settled" : "forming";
    motionStateRef.current = {
      current: { ...target },
      target: { ...target },
      velocity: zeroGeometry(),
    };
    const rim = rimRef.current;
    if (reducedMotionRef.current) {
      if (rim) {
        rim.style.opacity = "1";
        rim.style.transform = "scale(1)";
      }
      indicator.style.opacity = "1";
      return;
    }
    if (!rim) {
      indicator.dataset.glassState = "settled";
      return;
    }
    rim.style.opacity = "0";
    rim.style.transform = "scale(0.96)";
    const firstFrame = window.requestAnimationFrame(() => {
      const secondFrame = window.requestAnimationFrame(() => {
        rim.style.opacity = "1";
        rim.style.transform = "scale(1)";
      });
      const timer = window.setTimeout(() => {
        window.cancelAnimationFrame(secondFrame);
        rim.style.opacity = "1";
        rim.style.transform = "scale(1)";
        indicator.style.opacity = "1";
        indicator.dataset.glassState = "settled";
        formationAnimationRef.current = null;
      }, 320);
      formationAnimationRef.current = {
        cancel: () => {
          window.cancelAnimationFrame(secondFrame);
          window.clearTimeout(timer);
        },
      };
    });
    formationAnimationRef.current = {
      cancel: () => window.cancelAnimationFrame(firstFrame),
    };
    /*
     * CSS transitions keep the formation on the compositor. The two-frame
     * kick is intentional: it gives the browser a real initial opacity/scale
     * before the reveal, without forcing a synchronous layout read.
     */
    rim.style.transition = "opacity 300ms cubic-bezier(0.23, 1, 0.32, 1), transform 300ms cubic-bezier(0.23, 1, 0.32, 1)";
    if (reducedMotionRef.current) {
      rim.style.opacity = "1";
      rim.style.transform = "scale(1)";
      indicator.style.opacity = "1";
      formationAnimationRef.current = null;
      indicator.dataset.glassState = "settled";
    }
  }, []);

  const keepSelectedVisible = useCallback((viewport: HTMLElement, selected: HTMLElement) => {
    if (!scrollAxis) return;
    const viewportRect = viewport.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();

    if (scrollAxis === "x") {
      let nextScrollLeft = viewport.scrollLeft;
      const safeLeft = viewportRect.left + scrollSafeInset;
      const safeRight = viewportRect.right - scrollSafeInset;
      if (selectedRect.left < safeLeft) nextScrollLeft -= safeLeft - selectedRect.left;
      if (selectedRect.right > safeRight) nextScrollLeft += selectedRect.right - safeRight;
      nextScrollLeft = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, nextScrollLeft));
      if (Math.abs(nextScrollLeft - viewport.scrollLeft) > 0.5) viewport.scrollLeft = nextScrollLeft;
    } else {
      let nextScrollTop = viewport.scrollTop;
      const safeTop = viewportRect.top + scrollSafeInset;
      const safeBottom = viewportRect.bottom - scrollSafeInset;
      if (selectedRect.top < safeTop) nextScrollTop -= safeTop - selectedRect.top;
      if (selectedRect.bottom > safeBottom) nextScrollTop += selectedRect.bottom - safeBottom;
      nextScrollTop = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, nextScrollTop));
      if (Math.abs(nextScrollTop - viewport.scrollTop) > 0.5) viewport.scrollTop = nextScrollTop;
    }
  }, [scrollAxis]);

  const measure = useCallback((reason?: GlassMotionReason) => {
    if (reason === "selection") pendingReasonRef.current = "selection";
    else if (pendingReasonRef.current !== "selection") pendingReasonRef.current = reason ?? "layout";
    if (measureFrameRef.current !== null) {
      window.cancelAnimationFrame(measureFrameRef.current);
    }
    measureFrameRef.current = window.requestAnimationFrame(() => {
      measureFrameRef.current = null;
      const root = rootRef.current;
      if (!root) {
        hideIndicator();
        return;
      }
      if (motion !== "light" && root.closest('[data-layout-transitioning="true"]')) {
        enterDeferredState();
        stableLayoutWaitRef.current?.();
        pendingReasonRef.current = "layout";
        return;
      }
      const selected = root?.querySelector<HTMLElement>('[data-glass-selected="true"]');
      if (
        !selected
        || selected.hidden
        || selected.matches(":disabled, [aria-disabled='true']")
      ) {
        hideIndicator();
        return;
      }
      if (selected.getClientRects().length === 0) {
        hideIndicator();
        return;
      }

      const viewport = viewportRef.current;
      const track = trackRef.current;
      const focused = document.activeElement instanceof HTMLElement
        && root.contains(document.activeElement)
        ? document.activeElement.closest<HTMLElement>("button, [role='tab'], [role='option']")
        : null;
      if (viewport) {
        const active = root.querySelector<HTMLElement>("[data-glass-active='true']");
        keepSelectedVisible(viewport, focused ?? active ?? selected);
      }
      if (track) {
        const rootDisplay = window.getComputedStyle(root).display;
        root.dataset.glassLayout = rootDisplay.includes("grid") ? "grid" : "flex";
      }
      const rootRect = root.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      const viewportRect = viewport?.getBoundingClientRect();
      if (viewportRect && (
        selectedRect.right <= viewportRect.left
        || selectedRect.left >= viewportRect.right
        || selectedRect.bottom <= viewportRect.top
        || selectedRect.top >= viewportRect.bottom
      )) {
        hideIndicator();
        return;
      }
      // Client rectangles include the ancestor FLIP scale, while this
      // absolute positioning layer uses the untransformed layout space.
      // Convert once: otherwise the scale gets baked into the marker and
      // remains there even after the container animation has finished.
      if (rootRect.width <= 0 || rootRect.height <= 0) return;
      const layoutScaleX = rootRect.width / Math.max(1, root.offsetWidth);
      const layoutScaleY = rootRect.height / Math.max(1, root.offsetHeight);
      const target = {
        x: (selectedRect.left - rootRect.left) / layoutScaleX - root.clientLeft,
        y: (selectedRect.top - rootRect.top) / layoutScaleY - root.clientTop,
        width: selectedRect.width / layoutScaleX,
        height: selectedRect.height / layoutScaleY,
      };
      if (
        pendingReasonRef.current === "layout"
        && indicatorRef.current?.dataset.glassState === "deferred"
      ) {
        formAtTarget(target);
      } else {
        startSpring(target, pendingReasonRef.current);
      }
      pendingReasonRef.current = "layout";
    });
  }, [enterDeferredState, formAtTarget, hideIndicator, keepSelectedVisible, startSpring, motion]);

  const waitForStableLayout = useCallback(() => {
    if (deferredFrameRef.current !== null) window.cancelAnimationFrame(deferredFrameRef.current);
    const check = () => {
      const root = rootRef.current;
      if (!root) return;
      if (root.closest('[data-layout-transitioning="true"]')) {
        deferredFrameRef.current = window.requestAnimationFrame(check);
        return;
      }
      deferredFrameRef.current = window.requestAnimationFrame(() => {
        deferredFrameRef.current = window.requestAnimationFrame(() => {
          window.setTimeout(() => {
            deferredFrameRef.current = null;
            if (root.closest('[data-layout-transitioning="true"]')) {
              waitForStableLayout();
              return;
            }
            measure("layout");
          }, 180);
        });
      });
    };
    deferredFrameRef.current = window.requestAnimationFrame(check);
  }, [measure]);
  stableLayoutWaitRef.current = waitForStableLayout;

  useLayoutEffect(() => {
    pendingReasonRef.current = "selection";
    const root = rootRef.current;
    if (motion !== "light" && root?.closest('[data-layout-transitioning="true"]')) {
      enterDeferredState();
      waitForStableLayout();
      return;
    }
    measure("selection");
  }, [selectedKey, enterDeferredState, measure, waitForStableLayout, motion]);

  useLayoutEffect(() => {
    if (motion === "light") return;
    const root = rootRef.current;
    if (root?.closest('[data-layout-transitioning="true"]')) {
      enterDeferredState();
      waitForStableLayout();
      return;
    }
    measure("layout");
  }, [children, enterDeferredState, measure, waitForStableLayout, motion]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const observeContinuously = motion === "full" && typeof MutationObserver !== "undefined";
    const observeLayout = (motion === "full" || observeViewportResize)
      && typeof ResizeObserver !== "undefined";
    const resizeObserver = observeLayout
      ? new ResizeObserver(() => measure("layout"))
      : undefined;
    const observeTargets = () => {
      if (!resizeObserver) return;
      resizeObserver.observe(root);
      if (viewportRef.current) resizeObserver.observe(viewportRef.current);
      if (trackRef.current) resizeObserver.observe(trackRef.current);
      if (motion === "full") {
        root.querySelectorAll<HTMLElement>("button, [role='tab'], [role='option']").forEach((element) => {
          resizeObserver.observe(element);
        });
      }
    };
    observeTargets();
    const motionNodes = new Set<HTMLElement>();
    const refreshMotionNodes = () => {
      motionNodes.clear();
      [indicatorRef.current, materialRef.current, rimRef.current].forEach((node) => {
        if (node) motionNodes.add(node);
      });
      root.querySelectorAll<HTMLElement>(".glass-selection-press, .liquid-glass-adapter, .liquid-glass-surface").forEach((node) => motionNodes.add(node));
    };
    refreshMotionNodes();
    const mutationObserver = observeContinuously ? new MutationObserver((records) => {
      const relevant = records.some((record) => (
        record.type !== "attributes"
        || record.attributeName !== "style"
        || !(record.target instanceof HTMLElement)
        || !motionNodes.has(record.target)
      ));
      if (!relevant) return;
      observeTargets();
      refreshMotionNodes();
      measure("visibility");
    }) : undefined;
    const handlePointerDown = () => {
      keyboardInputRef.current = false;
      root.dataset.glassPointerActive = "true";
      indicatorRef.current?.setAttribute("data-glass-pressed", "true");
    };
    const clearPointerActive = () => {
      root.dataset.glassPointerActive = "false";
      indicatorRef.current?.setAttribute("data-glass-pressed", "false");
    };
    const handleKeyDown = () => {
      keyboardInputRef.current = true;
      clearPointerActive();
    };
    const handlePointerOver = (event: PointerEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-glass-selected="true"]')
        : null;
      const hoveringSelected = target && root.contains(target);
      root.dataset.glassHover = hoveringSelected ? "true" : "false";
      indicatorRef.current?.setAttribute("data-glass-hover", hoveringSelected ? "true" : "false");
    };
    const handlePointerOut = (event: PointerEvent) => {
      const relatedSelected = event.relatedTarget instanceof Element
        ? event.relatedTarget.closest<HTMLElement>('[data-glass-selected="true"]')
        : null;
      const hoveringSelected = Boolean(relatedSelected && root.contains(relatedSelected));
      root.dataset.glassHover = hoveringSelected ? "true" : "false";
      indicatorRef.current?.setAttribute("data-glass-hover", hoveringSelected ? "true" : "false");
    };
    mutationObserver?.observe(root, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["aria-disabled", "class", "data-glass-selected", "disabled", "hidden", "style"],
    });
    root.addEventListener("pointerdown", handlePointerDown);
    root.addEventListener("pointerup", clearPointerActive);
    root.addEventListener("pointercancel", clearPointerActive);
    root.addEventListener("keydown", handleKeyDown);
    root.addEventListener("pointerover", handlePointerOver);
    root.addEventListener("pointerout", handlePointerOut);
    const scrollTarget = viewportRef.current ?? root;
    const handleScroll = () => measure("scroll");
    const handleResize = () => measure("layout");
    scrollTarget.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);
    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      root.removeEventListener("pointerdown", handlePointerDown);
      root.removeEventListener("pointerup", clearPointerActive);
      root.removeEventListener("pointercancel", clearPointerActive);
      root.removeEventListener("keydown", handleKeyDown);
      root.removeEventListener("pointerover", handlePointerOver);
      root.removeEventListener("pointerout", handlePointerOut);
      scrollTarget.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [keepSelectedVisible, measure, motion, observeViewportResize]);

  useEffect(() => {
    if (motion === "light") return undefined;
    const rootElement = document.documentElement;
    const updateTheme = () => setOverLight(rootElement.dataset.theme === "white_gray");
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(rootElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [motion]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const updateReducedMotion = () => {
      reducedMotionRef.current = media?.matches ?? false;
      const target = motionStateRef.current.target;
      if (target && reducedMotionRef.current) settleImmediately(target);
      measure("visibility");
    };
    updateReducedMotion();
    media?.addEventListener?.("change", updateReducedMotion);
    return () => media?.removeEventListener?.("change", updateReducedMotion);
  }, [measure, settleImmediately]);

  useEffect(() => () => {
    if (measureFrameRef.current !== null) window.cancelAnimationFrame(measureFrameRef.current);
    if (motionFrameRef.current !== null) window.cancelAnimationFrame(motionFrameRef.current);
    if (deferredFrameRef.current !== null) window.cancelAnimationFrame(deferredFrameRef.current);
    formationAnimationRef.current?.cancel();
  }, []);

  const Component = as as ElementType;
  const setRootRef = useCallback((node: HTMLElement | null) => {
    rootRef.current = node;
    if (typeof forwardedRef === "function") {
      forwardedRef(node);
    } else if (forwardedRef) {
      forwardedRef.current = node;
    }
  }, [forwardedRef]);
  const handleFocusCapture = useCallback((event: FocusEvent<HTMLElement>) => {
    const target = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>("button, [role='tab'], [role='option']")
      : null;
    const viewport = viewportRef.current;
    if (!target || !viewport || !rootRef.current?.contains(target)) return;
    keyboardInputRef.current = true;
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    keepSelectedVisible(viewport, target);
    window.requestAnimationFrame(() => {
      if (document.activeElement === target && viewportRef.current) {
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
        keepSelectedVisible(viewportRef.current, target);
      }
    });
  }, [keepSelectedVisible]);

  return (
    <Component
      ref={setRootRef}
      className={`glass-selection-group${className ? ` ${className}` : ""}`}
      data-glass-scroll-axis={scrollAxis}
      data-glass-motion={motion}
      data-glass-layout={scrollAxis ? "flex" : undefined}
      id={id}
      data-testid={testId}
      style={style}
      role={role}
      aria-label={ariaLabel}
      onMouseDown={onMouseDown}
      onFocusCapture={handleFocusCapture}
    >
      <div ref={indicatorRef} className="glass-selection-indicator" data-glass-visible="false" data-glass-pressed="false" data-glass-state="hidden" aria-hidden="true">
        <div ref={materialRef} className="glass-selection-material">
          <div className="glass-selection-press">
            {motion === "light" ? (
              <StaticGlassAdapter />
            ) : (
              <LiquidGlassAdapter mouseContainer={rootRef} overLight={overLight} />
            )}
            <span ref={rimRef} className="glass-selection-rim" />
          </div>
        </div>
      </div>
      {scrollAxis ? (
        <div
          ref={viewportRef}
          className={`glass-selection-viewport${viewportClassName ? ` ${viewportClassName}` : ""}`}
          style={viewportStyle}
          role="presentation"
        >
          <div ref={trackRef} className="glass-selection-track" role="presentation">
            {children}
          </div>
        </div>
      ) : children}
    </Component>
  );
});
