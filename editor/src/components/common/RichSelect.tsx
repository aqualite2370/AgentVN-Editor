import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { GlassSelectionGroup } from "./GlassSelectionGroup";
import { readViewportMetrics, subscribeToViewportChanges } from "../../utils/viewportMetrics";

export interface RichSelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

interface RichSelectPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "top" | "bottom";
}

export function RichSelect<T extends string>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  helpKey,
  helpTitle,
  helpText,
  placeholder = "请选择",
  variant = "default",
  className,
  portalContainer,
}: {
  value: T;
  options: ReadonlyArray<RichSelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
  helpKey?: string;
  helpTitle?: string;
  helpText?: string;
  placeholder?: string;
  variant?: "default" | "compact" | "hero";
  className?: string;
  /** A modal may keep its popup inside its input-owned portal layer. */
  portalContainer?: HTMLElement | null;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const enabledIndexes = useMemo(() => options.map((option, index) => ({ option, index })).filter(({ option }) => !option.disabled).map(({ index }) => index), [options]);
  const [activeIndex, setActiveIndex] = useState(() => selectedIndex >= 0 ? selectedIndex : enabledIndexes[0] ?? -1);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const [position, setPosition] = useState<RichSelectPosition>({
    top: 0,
    left: 0,
    width: 220,
    maxHeight: 320,
    placement: "bottom",
  });

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 8;
    const viewportGap = 12;
    const minWidth = variant === "hero" ? 280 : 180;
    const width = Math.max(rect.width, minWidth);
    const viewport = readViewportMetrics();
    const belowSpace = viewport.bottom - rect.bottom - viewportGap;
    const aboveSpace = rect.top - viewport.top - viewportGap;
    const placement: RichSelectPosition["placement"] = belowSpace < 220 && aboveSpace > belowSpace ? "top" : "bottom";
    const available = Math.max(1, placement === "top" ? aboveSpace : belowSpace);
    const maxHeight = Math.max(1, Math.min(320, available - gap));
    const top = placement === "bottom" ? Math.min(viewport.bottom - viewportGap - maxHeight, rect.bottom + gap) : undefined;
    const bottom = placement === "top" ? Math.max(viewportGap, viewport.bottom - rect.top + gap) : undefined;
    const left = Math.min(
      Math.max(viewport.left + viewportGap, rect.left),
      Math.max(viewport.left + viewportGap, viewport.right - width - viewportGap),
    );

    setPosition({ top, bottom, left, width, maxHeight, placement });
  }, [variant]);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
  }, [isOpen, updatePosition, options.length]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || listboxRef.current?.contains(target)) return;
      setIsOpen(false);
    }

    function handleViewportChange() {
      updatePosition();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    const unsubscribeViewport = subscribeToViewportChanges(handleViewportChange);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      unsubscribeViewport();
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (selectedIndex >= 0) {
      setActiveIndex(selectedIndex);
    } else if (!enabledIndexes.includes(activeIndex)) {
      setActiveIndex(enabledIndexes[0] ?? -1);
    }
  }, [enabledIndexes, selectedIndex]);

  useLayoutEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const option = document.getElementById(`${id}-option-${activeIndex}`);
    const viewport = option?.closest<HTMLElement>(".glass-selection-viewport");
    if (!option || !viewport) return;
    const viewportRect = viewport.getBoundingClientRect();
    const optionRect = option.getBoundingClientRect();
    if (optionRect.top < viewportRect.top) {
      viewport.scrollTop -= viewportRect.top - optionRect.top;
    } else if (optionRect.bottom > viewportRect.bottom) {
      viewport.scrollTop += optionRect.bottom - viewportRect.bottom;
    }
  }, [activeIndex, id, isOpen]);

  const openListbox = useCallback(() => {
    if (disabled || enabledIndexes.length === 0) return;
    setActiveIndex(selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : enabledIndexes[0]);
    setIsOpen(true);
  }, [disabled, enabledIndexes, options, selectedIndex]);

  function moveActive(direction: 1 | -1) {
    if (enabledIndexes.length === 0) return;
    const currentEnabledIndex = enabledIndexes.indexOf(activeIndex);
    const nextPosition = currentEnabledIndex === -1
      ? direction > 0 ? 0 : enabledIndexes.length - 1
      : (currentEnabledIndex + direction + enabledIndexes.length) % enabledIndexes.length;
    setActiveIndex(enabledIndexes[nextPosition]);
  }

  function selectOption(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setIsOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function toggleListbox() {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    openListbox();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        openListbox();
        return;
      }
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      if (!isOpen) return;
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? enabledIndexes[0] ?? -1 : enabledIndexes[enabledIndexes.length - 1] ?? -1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isOpen) {
        openListbox();
      } else {
        selectOption(activeIndex);
      }
      return;
    }

    if (event.key === "Escape") {
      if (!isOpen) return;
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      return;
    }

    if (event.key === "Tab") {
      setIsOpen(false);
    }
  }

  const triggerClasses = [
    "rich-select-trigger",
    `is-${variant}`,
    isOpen ? "is-open" : "",
    selectedOption ? "has-value" : "is-empty",
  ].filter(Boolean).join(" ");
  const rootClasses = ["rich-select", `is-${variant}`, className ?? ""].filter(Boolean).join(" ");
  const listboxId = `${id}-listbox`;

  return (
    <span className={rootClasses}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClasses}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={isOpen && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        data-help-key={helpKey}
        data-help-title={helpTitle}
        data-help={helpText}
        onClick={toggleListbox}
        onKeyDown={handleKeyDown}
      >
        <span className="rich-select-value">
          <span className="rich-select-value-label">{selectedOption?.label ?? placeholder}</span>
          {selectedOption?.description && <small>{selectedOption.description}</small>}
        </span>
        <ChevronDown className="rich-select-chevron" size={16} aria-hidden="true" />
      </button>

      {mounted && isOpen && createPortal(
        <GlassSelectionGroup
          ref={listboxRef}
          id={listboxId}
          className={`rich-select-popover is-${variant} is-${position.placement}`}
          role="listbox"
          ariaLabel={ariaLabel}
          selectedKey={value}
          scrollAxis="y"
          viewportClassName="rich-select-viewport selection-scroll-region"
          viewportStyle={{ maxHeight: Math.max(0, position.maxHeight - 14) }}
          style={{
            top: position.top,
            bottom: position.bottom,
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <button
                id={`${id}-option-${index}`}
                key={option.value}
                type="button"
                className={`rich-select-option${isActive ? " is-active" : ""}`}
                role="option"
                aria-selected={isSelected}
                data-glass-selected={isSelected}
                data-glass-active={isActive}
                data-help-key={helpKey}
                data-help-title={typeof option.label === "string" ? option.label : helpTitle}
                data-help={typeof option.description === "string" ? option.description : helpText}
                disabled={option.disabled}
                onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                onClick={() => selectOption(index)}
              >
                <span className="rich-select-option-copy">
                  <span>{option.label}</span>
                  {option.description && <small>{option.description}</small>}
                </span>
                {isSelected && <Check className="rich-select-check" size={15} aria-hidden="true" />}
              </button>
            );
          })}
        </GlassSelectionGroup>,
        portalContainer ?? document.body,
      )}
    </span>
  );
}
