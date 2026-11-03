import { Suspense, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { UILayoutScreenId } from "../../../shared/cartridge/uiSkin";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";
import {
  RUNTIME_BLACKOUT_COVER_DURATION_MS,
  RUNTIME_BLACKOUT_REDUCED_DURATION_MS,
  RUNTIME_BLACKOUT_REVEAL_DURATION_MS,
  useRuntimeStore,
  type RuntimeScreen,
} from "../store/runtimeStore";
import { UISkinScreen, useRuntimeUILayout } from "../uiSkin/uiSkinRuntime";
import { RenpyMenuFrame, RenpyMenuManagedContext } from "../components/shell/RenpyMenuFrame";
import type { RenpyMenuScreen } from "../components/shell/RenpyMenuNavigation";
import { captureRuntimePage } from "./runtimePageCrossfade";

const menuPages = new Set<RuntimeScreen>(["settings", "save_load", "history", "gallery", "about", "help"]);
const scopeFor = (screen: RuntimeScreen): UILayoutScreenId =>
  screen === "settings" ? "preferences" : screen as UILayoutScreenId;
type TransitionPhase = "idle" | "loading" | "covering" | "swap" | "revealing" | "crossfade-swap" | "crossfading" | "failed";
type ScreenTransition = {
  token: number;
  navigationId?: number;
  from: RuntimeScreen;
  to: RuntimeScreen;
  ready: boolean;
  style?: "blackout" | "crossfade";
};

/**
 * One mounted functional page, one shared menu rail. Loading owns input until
 * the requested module is ready; decorative motion never delays ready input.
 */
export function RuntimeScreenNavigator({ loadScreen, renderScreen, fallback }: {
  loadScreen: (screen: RuntimeScreen) => Promise<void>;
  renderScreen: (screen: RuntimeScreen, withinMenu?: boolean) => ReactNode;
  fallback: ReactNode;
}) {
  const screen = useRuntimeStore(state => state.screen);
  const pending = useRuntimeStore(state => state.pendingScreenNavigation);
  const currentGame = useRuntimeStore(state => state.currentGame);
  const launchTransition = useRuntimeStore(state => state.launchTransition);
  const skin = useRuntimeUILayout();
  const [presented, setPresented] = useState(screen);
  const [phase, setPhase] = useState<TransitionPhase>("idle");
  const [error, setError] = useState<string>();
  const loadingFocusRef = useRef<HTMLElement | null>(null);
  const [retry, setRetry] = useState(0);
  const [motion, setMotion] = useState<ScreenTransition>();
  const rootRef = useRef<HTMLDivElement>(null);
  const snapshotRef = useRef<HTMLElement>();
  const fadeRef = useRef<Animation[]>([]);
  const generationRef = useRef(0);
  const phaseRef = useRef(phase);
  const presentedRef = useRef(presented);
  const motionRef = useRef(motion);
  phaseRef.current = phase;
  presentedRef.current = presented;
  motionRef.current = motion;
  const sharedMenu = skin.layout_type === "renpy" && menuPages.has(presented);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const coverDuration = reduced ? RUNTIME_BLACKOUT_REDUCED_DURATION_MS : RUNTIME_BLACKOUT_COVER_DURATION_MS;
  const revealDuration = reduced ? RUNTIME_BLACKOUT_REDUCED_DURATION_MS : RUNTIME_BLACKOUT_REVEAL_DURATION_MS;
  const duration = coverDuration + revealDuration;
  // Only transitions within the shared menu leave its rail/background intact.
  // Title/library ↔ menu transitions must retain the full authored frame.
  const pageSurface = (transition = motionRef.current) =>
    (transition && menuPages.has(transition.from) && menuPages.has(transition.to)
      ? rootRef.current?.querySelector<HTMLElement>("[data-runtime-motion-surface]") : undefined)
    ?? rootRef.current?.querySelector<HTMLElement>(".runtime-screen-transition-current");
  const discardFade = () => {
    fadeRef.current.forEach(animation => animation.cancel());
    fadeRef.current = [];
    snapshotRef.current?.remove();
    snapshotRef.current = undefined;
  };
  const prepareFade = (from: RuntimeScreen, to: RuntimeScreen) => {
    const surface = pageSurface({ token: generationRef.current, from, to, ready: true });
    if (!surface) return;
    const snapshot = captureRuntimePage(surface, snapshotRef.current);
    discardFade();
    snapshotRef.current = snapshot;
    surface.parentElement?.append(snapshot);
  };
  useEffect(() => () => discardFade(), []);
  useLayoutEffect(() => {
    if (phase === "idle" || phase === "failed") discardFade();
  }, [phase]);

  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!pending) {
      // A committed page remains behind its reveal curtain until the full
      // cover/swap/reveal sequence settles.
      // Only preserve an already-started visual phase. An in-flight `loading`
      // phase must restart when an effect dependency changes (for example when
      // a live-preview game finishes loading); its cleanup invalidates the
      // previous token, so skipping the replacement request would leave the
      // navigator stuck in `loading` forever.
      if (["covering", "swap", "revealing", "crossfade-swap", "crossfading"].includes(phaseRef.current)
        && motionRef.current?.to === screen) return;
      if (presentedRef.current === screen) {
        if (launchTransition === "idle" && motionRef.current?.style === "blackout"
          && ["covering", "swap", "revealing"].includes(phaseRef.current)) {
          // Back cancelled a not-yet-committed menu request. Keep the current
          // curtain value and smoothly reverse it over the same live page.
          setMotion({ token: ++generationRef.current, from: motionRef.current.to,
            to: screen, ready: true, style: "blackout" });
          setPhase("revealing");
          setError(undefined);
          return;
        }
        ++generationRef.current;
        setMotion(undefined);
        setPhase("idle");
        setError(undefined);
        discardFade();
        return;
      }
      const token = ++generationRef.current;
      const from = presentedRef.current;
      if (launchTransition !== "idle") {
        // Gameplay entry/return owns its own transaction and full-screen
        // blackout. Do not stack a second screen-level curtain over it.
        setMotion(undefined);
        setPhase("idle");
        setPresented(screen);
        discardFade();
        return;
      }

      // Runtime mode changes and cartridge loading can update `screen`
      // directly instead of creating pendingScreenNavigation. Keep those
      // public flows on the same global cover/swap/reveal path.
      setError(undefined);
      const style = skin.layout_type === "renpy" && from !== "playing" && screen !== "playing"
        ? "crossfade" : "blackout";
      setMotion({ token, from, to: screen, ready: false, style });
      setPhase("loading");
      const current = () => token === generationRef.current
        && !useRuntimeStore.getState().pendingScreenNavigation
        && useRuntimeStore.getState().screen === screen
        && useRuntimeStore.getState().launchTransition === "idle";
      let timer: number | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("页面加载超时，请重试。")), 10000);
      });
      void Promise.race([loadScreen(screen), timeout]).then(() => {
        if (!current()) return;
        setMotion(currentMotion => currentMotion?.token === token
          ? { ...currentMotion, ready: true }
          : currentMotion);
        if (style === "crossfade") prepareFade(from, screen);
        else discardFade();
        setPhase(style === "crossfade" ? "crossfade-swap" : "covering");
      }).catch(cause => {
        reportFrontendError("runtime.screen-preload", cause, { screen, source: "direct-runtime-change" });
        if (!current()) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setPhase("failed");
      }).finally(() => window.clearTimeout(timer));
      return () => {
        ++generationRef.current;
        window.clearTimeout(timer);
      };
    }
    const token = ++generationRef.current;
    setError(undefined);
    const from = presentedRef.current;
    const style = skin.layout_type === "renpy" && from !== "playing" && pending.toScreen !== "playing"
      ? "crossfade" : "blackout";
    const alreadyTransitioning = ["covering", "swap", "revealing"].includes(phaseRef.current);
    setMotion({ token, navigationId: pending.id, from, to: pending.toScreen,
      ready: false, style });
    setPhase(alreadyTransitioning ? "covering" : "loading");
    const current = () => token === generationRef.current
      && useRuntimeStore.getState().pendingScreenNavigation?.id === pending.id;
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error("页面加载超时，请重试。")), 10000);
    });
    void Promise.race([loadScreen(pending.toScreen), timeout]).then(() => {
      if (!current()) return;
      setMotion(currentMotion => currentMotion?.token === token
        ? { ...currentMotion, ready: true }
        : currentMotion);
      if (style === "crossfade") prepareFade(from, pending.toScreen);
      else discardFade();
      setPhase(style === "crossfade" ? "crossfade-swap" : "covering");
    }).catch(cause => {
      reportFrontendError("runtime.screen-preload", cause, { navigationId: pending.id, screen: pending.toScreen });
      if (!current()) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setMotion(undefined);
      setPhase("failed");
    }).finally(() => window.clearTimeout(timer));
    return () => {
      ++generationRef.current;
      window.clearTimeout(timer);
    };
  }, [pending?.id, retry, currentGame?.install_id, screen, launchTransition, loadScreen]);

  useLayoutEffect(() => {
    if ((phase !== "covering" && phase !== "revealing") || !motion?.ready) return;
    const root = rootRef.current;
    if (!root) return;
    const token = motion.token;
    let disposed = false;
    let frame = 0;
    const current = () => !disposed && motionRef.current?.token === token && phaseRef.current === phase;
    const complete = () => {
      if (!current()) return;
      if (phase === "covering") setPhase("swap");
      else {
        setMotion(undefined);
        setPhase("idle");
      }
    };
    const observe = () => {
      if (!current()) return;
      // Flush the new phase before reading its actual pseudo-element transition.
      // JS elapsed time can lead the compositor, particularly under load.
      const opacity = Number(getComputedStyle(root, "::before").opacity);
      const transitions = root.getAnimations({ subtree: true }).filter(animation =>
        animation instanceof CSSTransition && animation.transitionProperty === "opacity"
        && animation.effect instanceof KeyframeEffect && animation.effect.target === root
        && animation.effect.pseudoElement === "::before");
      if (transitions.length) {
        void Promise.all(transitions.map(animation => animation.finished)).then(complete).catch(() => {
          // A live CSS change can replace a transition. Re-observe only while
          // this request still owns the phase; genuine navigation invalidates it.
          if (current()) frame = window.requestAnimationFrame(observe);
        });
      } else if (Math.abs(opacity - (phase === "covering" ? 1 : 0)) < 0.000001) {
        // Reversal at an endpoint, or readiness after an already opaque cover.
        complete();
      } else frame = window.requestAnimationFrame(observe);
    };
    observe();
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
    };
  }, [motion?.token, motion?.ready, phase, coverDuration, revealDuration]);

  useLayoutEffect(() => {
    if (!["swap", "crossfade-swap"].includes(phase) || !motion?.ready) return;
    if (presented !== motion.to) {
      if (motion.navigationId !== undefined) {
        const pendingNavigation = useRuntimeStore.getState().pendingScreenNavigation;
        if (pendingNavigation?.id !== motion.navigationId) return;
        useRuntimeStore.getState().commitScreenNavigation(motion.navigationId);
      } else if (useRuntimeStore.getState().screen !== motion.to
        || useRuntimeStore.getState().pendingScreenNavigation) return;
      setPresented(motion.to);
      return;
    }
    if (screen !== motion.to) return;
    if (motion.style === "crossfade") {
      setPhase("crossfading");
      return;
    }
    const token = motion.token;
    let revealFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      revealFrame = window.requestAnimationFrame(() => {
        if (motionRef.current?.token === token && phaseRef.current === "swap")
          setPhase("revealing");
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(revealFrame);
    };
  }, [motion, phase, presented, screen]);

  useLayoutEffect(() => {
    if (phase !== "crossfading" || !motion || presented !== motion.to) return;
    const surface = pageSurface();
    const snapshot = snapshotRef.current;
    if (!surface || !snapshot) return;
    // For title ↔ shared-menu changes the old containing block is replaced.
    surface.parentElement?.append(snapshot);
    snapshot.style.left = `${surface.offsetLeft}px`;
    snapshot.style.top = `${surface.offsetTop}px`;
    snapshot.style.width = `${surface.offsetWidth}px`;
    snapshot.style.height = `${surface.offsetHeight}px`;
    const options: KeyframeAnimationOptions = {
      duration, easing: getComputedStyle(rootRef.current!).getPropertyValue("--ease-out").trim()
        || "cubic-bezier(0.23,1,0.32,1)", fill: "both",
    };
    const entering = surface.animate([{ opacity: 0 }, { opacity: 1 }], options);
    const leaving = snapshot.animate([{ opacity: 1 }, { opacity: 0 }], options);
    fadeRef.current = [entering, leaving];
    const token = motion.token;
    void Promise.all([entering.finished, leaving.finished]).then(() => {
      if (motionRef.current?.token !== token || phaseRef.current !== "crossfading") return;
      setMotion(undefined);
      setPhase("idle");
    }).catch(() => { /* A newer request captures the current composite before cancellation. */ });
  }, [phase, motion?.token, presented, duration]);

  useLayoutEffect(() => {
    if (!motion || presented !== motion.to || !["swap", "crossfade-swap"].includes(phase)) return;
    // An editor-driven preview update is not a request to focus its iframe.
    // User navigation inside an already focused frame still transfers focus.
    if (window.parent !== window && !document.hasFocus()) return;
    const surface = rootRef.current?.querySelector<HTMLElement>("[data-runtime-motion-surface]")
      ?? rootRef.current?.querySelector<HTMLElement>(".runtime-screen-transition-current");
    if (!surface) return;
    const layer = rootRef.current?.querySelector<HTMLElement>(".runtime-screen-transition-current");
    // A shared rail keeps its existing focus. A replaced title/page loses its
    // focused DOM node, so transfer ownership immediately when the target is
    // ready, not after its decorative entrance completes.
    if (layer && !layer.contains(document.activeElement)
      && !document.querySelector("[data-runtime-modal='true']")) {
      const target = layer.querySelector<HTMLElement>("[aria-current='page']:not([disabled])")
        ?? [...layer.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex='0']")]
          .find(element => !element.closest("[inert]") && element.getClientRects().length > 0);
      if (target) target.focus({ preventScroll: true });
      else {
        layer.tabIndex = -1;
        layer.focus({ preventScroll: true });
      }
    }
  }, [motion, pending, phase, presented, sharedMenu]);

  const waiting = phase === "loading";
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (waiting && !sharedMenu) {
      const active = document.activeElement;
      if (active instanceof HTMLElement
        && root.querySelector(".runtime-screen-transition-current")?.contains(active)) {
        loadingFocusRef.current = active;
        // The outgoing page just became inert. Move focus before the next
        // paint, keeping Escape available on a visible loading owner.
        root.querySelector<HTMLElement>(".runtime-navigation-status")?.focus({ preventScroll: true });
      }
    } else {
      const previous = loadingFocusRef.current;
      loadingFocusRef.current = null;
      if (document.activeElement === document.body && previous?.isConnected
        && root.contains(previous) && !previous.closest("[inert], [aria-hidden='true']")
        && !previous.matches(":disabled") && previous.getClientRects().length) {
        previous.focus({ preventScroll: true });
      }
    }
  }, [waiting, sharedMenu]);
  const activeMenu = waiting && pending && menuPages.has(pending.toScreen) ? pending.toScreen : presented;
  const active = !["idle", "failed"].includes(phase);
  const blocksInput = active && phase !== "crossfading";
  return (
    <div ref={rootRef} className={`runtime-screen-transition${active ? ` is-active is-${phase}` : " is-idle"}`}
      style={{
        "--runtime-screen-cover-duration": `${coverDuration}ms`,
        "--runtime-screen-reveal-duration": `${revealDuration}ms`,
      } as CSSProperties}
      onClickCapture={event => { if (blocksInput) event.stopPropagation(); }}
      onKeyDownCapture={event => {
        if (!blocksInput) return;
        // Escape remains a system/navigation command even while the curtain
        // is covering or revealing a page. All page-local keyboard actions
        // stay blocked until the committed page is interactive.
        if (event.key === "Escape") return;
        event.preventDefault();
        event.stopPropagation();
      }}
      data-runtime-screen-transition={active ? "active" : "idle"}
      data-runtime-transition-style={motion?.style ?? "none"}
      data-runtime-transition-phase={phase}
      data-runtime-transition-from={motion?.from}
      data-runtime-transition-to={pending?.toScreen ?? screen}
      data-runtime-transition-duration={active ? duration : 0}
      data-runtime-presented-screen={presented}
      data-runtime-committed-screen={screen}>
      <div className="runtime-screen-transition-layer runtime-screen-transition-current"
        ref={element => { if (element) element.inert = waiting && !sharedMenu; }}
        aria-hidden={waiting && !sharedMenu || undefined}>
        <Suspense fallback={fallback}>
          {sharedMenu ? (
            <UISkinScreen screen={scopeFor(presented)}>
              <RenpyMenuFrame activeScreen={activeMenu as RenpyMenuScreen}
                presentedScreen={presented as RenpyMenuScreen}
                managedOutlet contentBlocked={waiting}>
                <RenpyMenuManagedContext.Provider value={true}>
                  {renderScreen(presented, true)}
                </RenpyMenuManagedContext.Provider>
              </RenpyMenuFrame>
            </UISkinScreen>
          ) : renderScreen(presented)}
        </Suspense>
      </div>
      {waiting && <div className="runtime-navigation-status" role="status" tabIndex={-1}>正在加载页面…</div>}
      {error && <div className="runtime-navigation-status is-error" role="alert">
        <span>{error}</span>
        <button type="button" onClick={() => setRetry(value => value + 1)}>重试</button>
        <button type="button" onClick={() => {
          if (pending) useRuntimeStore.getState().cancelScreenNavigation(pending.id);
          else if (motion && useRuntimeStore.getState().screen === motion.to)
            useRuntimeStore.setState({ screen: motion.from });
          if (motion) setPresented(motion.from);
          setMotion(undefined);
          setPhase("idle");
        }}>留在当前页面</button>
      </div>}
    </div>
  );
}
