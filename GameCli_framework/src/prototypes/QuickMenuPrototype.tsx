import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  EyeOff,
  FastForward,
  History,
  Menu,
  MousePointer2,
  Play,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { PrecisionIcon } from "../components/common/PrecisionIcon";
import "./quickMenuPrototype.css";

type VariantKey = "A" | "C";
type MenuDirection = "auto" | "up" | "down" | "left" | "right";
type MenuPhase = "collapsed" | "expanding" | "expanded" | "collapsing";

interface MenuAction {
  id: string;
  label: string;
  hint: string;
  icon: ReactNode;
  accent?: boolean;
}

const VARIANTS: Record<VariantKey, { name: string; subtitle: string }> = {
  A: { name: "胶囊展开", subtitle: "三点按钮直接变成横向工具轨，动作在同一层渐显" },
  C: { name: "形变工具轨", subtitle: "三点按钮向上拉伸成窄工具轨，动作按队列渐显" },
};

const DIRECTIONS: Array<{ value: MenuDirection; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "up", label: "向上" },
  { value: "down", label: "向下" },
  { value: "left", label: "向左" },
  { value: "right", label: "向右" },
];

const DIRECTIONS_C: Array<{ value: MenuDirection; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "up", label: "向上" },
  { value: "down", label: "向下" },
];

const ACTIONS: MenuAction[] = [
  { id: "rollback", label: "回退", hint: "回到上一段剧情", icon: <RotateCcw size={18} /> },
  { id: "auto", label: "自动", hint: "自动播放对白", icon: <Play size={18} /> },
  { id: "skip", label: "快进", hint: "跳过已读内容", icon: <FastForward size={18} /> },
  { id: "save", label: "存档", hint: "打开存档 / 读档", icon: <Save size={18} /> },
  { id: "history", label: "历史", hint: "查看对白记录", icon: <History size={18} /> },
  { id: "hide", label: "隐藏", hint: "隐藏游戏界面", icon: <EyeOff size={18} /> },
  { id: "menu", label: "菜单", hint: "打开主菜单", icon: <Menu size={18} />, accent: true },
];

const variantKeys = Object.keys(VARIANTS) as VariantKey[];

function readVariant(): VariantKey {
  const value = new URLSearchParams(window.location.search).get("variant")?.toUpperCase();
  return value === "A" || value === "C" ? value : "C";
}

function nextVariant(current: VariantKey, delta: number): VariantKey {
  const index = variantKeys.indexOf(current);
  return variantKeys[(index + delta + variantKeys.length) % variantKeys.length];
}

function readDirection(): MenuDirection {
  const value = new URLSearchParams(window.location.search).get("direction")?.toLowerCase();
  return value === "up" || value === "down" || value === "left" || value === "right" ? value : "auto";
}

function normalizeDirection(variant: VariantKey, direction: MenuDirection): MenuDirection {
  if (variant === "C" && (direction === "left" || direction === "right")) return "auto";
  return direction;
}

function setVariantInUrl(variant: VariantKey, direction: MenuDirection): void {
  const url = new URL(window.location.href);
  url.searchParams.set("prototype", "quick-menu");
  url.searchParams.set("variant", variant);
  url.searchParams.set("direction", direction);
  window.history.replaceState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function useMenuSequence(variant: VariantKey, direction: MenuDirection) {
  const [phase, setPhase] = useState<MenuPhase>("collapsed");
  const [visibleCount, setVisibleCount] = useState(0);
  const [revealCount, setRevealCount] = useState(0);
  const [morphReady, setMorphReady] = useState(false);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);
  useEffect(() => {
    clearTimers();
    setPhase("collapsed");
    setVisibleCount(0);
    setRevealCount(0);
    setMorphReady(false);
  }, [clearTimers, variant, direction]);

  const open = useCallback(() => {
    clearTimers();
    setPhase("expanding");
    setVisibleCount(0);
    setRevealCount(0);
    setMorphReady(false);
    const shellDuration = variant === "C" ? 90 : 200;
    timers.current.push(window.setTimeout(() => setMorphReady(true), shellDuration));
    if (variant === "C") {
      ACTIONS.forEach((_, index) => {
        timers.current.push(window.setTimeout(() => {
          setRevealCount((count) => Math.max(count, index + 1));
        }, shellDuration + index * 24));
        timers.current.push(window.setTimeout(() => {
          setVisibleCount((count) => Math.max(count, index + 1));
          if (index === ACTIONS.length - 1) setPhase("expanded");
        }, shellDuration + 40 + index * 24));
      });
      return;
    }
    timers.current.push(window.setTimeout(() => {
      setRevealCount(ACTIONS.length);
      setVisibleCount(ACTIONS.length);
      setPhase("expanded");
    }, shellDuration + 60));
  }, [clearTimers, variant]);

  const close = useCallback(() => {
    clearTimers();
    setPhase("collapsing");
    setVisibleCount(0);
    setRevealCount(0);
    setMorphReady(false);
    timers.current.push(window.setTimeout(() => setPhase("collapsed"), variant === "C" ? 180 : 220));
  }, [clearTimers]);

  const toggle = useCallback(() => {
    if (phase === "collapsed" || phase === "collapsing") open();
    else close();
  }, [close, open, phase]);

  return { phase, visibleCount, revealCount, morphReady, toggle };
}

function QuickActionButton({
  action,
  visible,
  variant,
  index,
}: {
  action: MenuAction;
  visible: boolean;
  variant: VariantKey;
  index: number;
}) {
  return (
    <button
      className={`prototype-action prototype-action-${variant.toLowerCase()}${action.accent ? " is-accent" : ""}${visible ? " is-visible" : ""}`}
      type="button"
      data-testid={`quick-action-${action.id}`}
      data-action-index={index}
      aria-label={action.hint}
      tabIndex={visible ? 0 : -1}
      style={{ "--action-index": index } as React.CSSProperties}
    >
      <span className="prototype-action-icon">{action.icon}</span>
      <span className="prototype-action-label">{action.label}</span>
    </button>
  );
}

function ToggleButton({ phase, onClick }: { phase: MenuPhase; onClick: () => void }) {
  const expanded = phase === "expanded" || phase === "expanding";
  const collapsing = phase === "collapsing";
  return (
    <button
      className={`prototype-toggle${expanded ? " is-open" : ""}${collapsing ? " is-collapsing" : ""}`}
      type="button"
      data-testid="prototype-quick-menu-toggle"
      data-testid-icon="prototype-toggle-icon"
      data-icon={expanded ? "close" : "expand"}
      aria-label={expanded ? "收起快捷菜单" : "展开快捷菜单"}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <span className={`prototype-toggle-icon prototype-toggle-icon-expand${expanded ? "" : " is-visible"}`} aria-hidden="true">
        <PrecisionIcon name="expand" size={18} />
      </span>
      <span className={`prototype-toggle-icon prototype-toggle-icon-close${expanded ? " is-visible" : ""}`} aria-hidden="true">
        <X size={19} />
      </span>
    </button>
  );
}

function resolveDirection(variant: VariantKey, direction: MenuDirection): Exclude<MenuDirection, "auto"> {
  const normalized = normalizeDirection(variant, direction);
  if (normalized !== "auto") return normalized;
  return variant === "C" ? "up" : "left";
}

function VariantA({ phase, visibleCount, morphReady, direction, onToggle }: { phase: MenuPhase; visibleCount: number; morphReady: boolean; direction: MenuDirection; onToggle: () => void }) {
  const open = phase === "expanded" || phase === "expanding";
  const renderActions = phase !== "collapsed";
  const actionsVisible = visibleCount === ACTIONS.length;
  return (
    <div className={`prototype-menu prototype-menu-a direction-${resolveDirection("A", direction)}`} data-variant-layout="capsule">
      <div className={`prototype-capsule${open ? " is-open" : ""}${morphReady ? " is-settled" : ""}`} data-testid="quick-menu-surface" data-morph-origin="toggle">
        {(renderActions ? ACTIONS : []).map((action, index) => (
          <QuickActionButton key={action.id} action={action} visible={actionsVisible} variant="A" index={index} />
        ))}
        <ToggleButton phase={phase} onClick={onToggle} />
      </div>
    </div>
  );
}

function VariantC({ phase, visibleCount, revealCount, morphReady, direction, onToggle }: { phase: MenuPhase; visibleCount: number; revealCount: number; morphReady: boolean; direction: MenuDirection; onToggle: () => void }) {
  const open = phase === "expanded" || phase === "expanding";
  const renderActions = phase !== "collapsed";
  const revealHeight = revealCount === 0 ? "50px" : `${81 + (revealCount - 1) * 33}px`;
  return (
    <div className={`prototype-menu prototype-menu-c direction-${resolveDirection("C", direction)}`} data-variant-layout="drawer">
      <div
        className={`prototype-drawer${open ? " is-open" : ""}${morphReady ? " is-settled" : ""}`}
        data-testid="quick-menu-surface"
        data-morph-origin="toggle"
        data-visible-count={visibleCount}
        data-reveal-count={revealCount}
        style={{ "--drawer-reveal-height": revealHeight } as React.CSSProperties}
      >
        {(renderActions ? ACTIONS : []).map((action, index) => (
          <QuickActionButton key={action.id} action={action} visible={index >= ACTIONS.length - visibleCount} variant="C" index={index} />
        ))}
        <ToggleButton phase={phase} onClick={onToggle} />
      </div>
    </div>
  );
}

function PrototypeSwitcher({ variant, onVariantChange }: { variant: VariantKey; onVariantChange: (variant: VariantKey) => void }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onVariantChange(nextVariant(variant, -1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onVariantChange(nextVariant(variant, 1));
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onVariantChange, variant]);

  return (
    <nav className="prototype-switcher" aria-label="快捷菜单原型方案切换">
      <button type="button" aria-label="上一个方案" onClick={() => onVariantChange(nextVariant(variant, -1))}>
        <ChevronLeft size={16} />
      </button>
      <div className="prototype-switcher-label">
        <span>方案 {variant}</span>
        <strong>{VARIANTS[variant].name}</strong>
      </div>
      <button type="button" aria-label="下一个方案" onClick={() => onVariantChange(nextVariant(variant, 1))}>
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}

export function QuickMenuPrototype() {
  const [variant, setVariant] = useState<VariantKey>(() => readVariant());
  const [direction, setDirection] = useState<MenuDirection>(() => normalizeDirection(readVariant(), readDirection()));
  const activeDirection = normalizeDirection(variant, direction);
  const { phase, visibleCount, revealCount, morphReady, toggle } = useMenuSequence(variant, activeDirection);
  const variantInfo = useMemo(() => VARIANTS[variant], [variant]);

  useEffect(() => {
    document.title = `快捷菜单动效原型 · 方案 ${variant}`;
    function handlePopState() {
      const nextVariant = readVariant();
      setVariant(nextVariant);
      setDirection(normalizeDirection(nextVariant, readDirection()));
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [variant]);

  const changeVariant = useCallback((next: VariantKey) => {
    const nextDirection = normalizeDirection(next, direction);
    setVariant(next);
    setDirection(nextDirection);
    setVariantInUrl(next, nextDirection);
  }, [direction]);

  const changeDirection = useCallback((next: MenuDirection) => {
    setDirection(next);
    setVariantInUrl(variant, next);
  }, [variant]);

  return (
    <main className="quick-menu-prototype" data-testid="quick-menu-prototype">
      <section className="prototype-stage" data-runtime-screen="playing">
        <div className="prototype-stage-glow" />
        <div className="prototype-topbar">
          <div className="prototype-brand">
            <span className="prototype-brand-mark">A</span>
            <span>AGENTVN / PLAYER</span>
          </div>
          <div className="prototype-stage-meta">
            <span className="prototype-live-dot" /> 原型预览
          </div>
        </div>
        <div className="prototype-scene" aria-hidden="true">
          <div className="prototype-moon" />
          <div className="prototype-cloud prototype-cloud-one" />
          <div className="prototype-cloud prototype-cloud-two" />
          <div className="prototype-character prototype-character-left" />
          <div className="prototype-character prototype-character-right" />
          <div className="prototype-horizon" />
        </div>
        <div className="prototype-copy">
          <div className="prototype-kicker">CHAPTER 04 · THE QUIET BETWEEN LINES</div>
          <h1>自然展开，随后抵达</h1>
          <p>点击右下角快捷菜单，观察“三点先成形，动作在同一层渐显”的节奏。</p>
        </div>
        <div className="prototype-dialog">
          <div className="prototype-dialog-speaker">Kuro</div>
          <p>「如果工具也有自己的呼吸，玩家会更愿意去触碰它。」</p>
          <span className="prototype-dialog-caret">▾</span>
        </div>
        <div
          className={`prototype-status phase-${phase}`}
          data-testid="quick-menu-status"
          data-phase={phase}
          data-visible-count={visibleCount}
        >
          <MousePointer2 size={14} />
          <span>{variantInfo.subtitle}</span>
          <b>{phase === "collapsed" ? "待机" : phase === "expanding" ? "形态变换中" : phase === "collapsing" ? "收起中" : `动作已显现 ${visibleCount}/${ACTIONS.length}`}</b>
        </div>
        <div className={`prototype-runtime-hud variant-${variant.toLowerCase()}`}>
          <span>方案 {variant}</span>
          <strong>{variantInfo.name}</strong>
        </div>
        {variant === "A" && <VariantA phase={phase} visibleCount={visibleCount} morphReady={morphReady} direction={direction} onToggle={toggle} />}
        {variant === "C" && <VariantC phase={phase} visibleCount={visibleCount} revealCount={revealCount} morphReady={morphReady} direction={direction} onToggle={toggle} />}
      </section>
      <PrototypeSwitcher variant={variant} onVariantChange={changeVariant} />
      <nav className="prototype-direction-picker" data-testid="prototype-direction-picker" aria-label="展开方向">
        <span>展开方向</span>
        {(variant === "C" ? DIRECTIONS_C : DIRECTIONS).map((item) => (
          <button
            key={item.value}
            type="button"
            data-direction={item.value}
            className={activeDirection === item.value ? "is-active" : ""}
            aria-pressed={activeDirection === item.value}
            onClick={() => changeDirection(item.value)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <p className="prototype-footnote">PROTOTYPE ONLY · 方案切换会写入 URL 的 <code>?variant=</code> 参数</p>
    </main>
  );
}
