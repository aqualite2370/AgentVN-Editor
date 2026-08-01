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

export interface RichSelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

interface RichSelectPosition {
  top: number;
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
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
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
    const belowSpace = window.innerHeight - rect.bottom - viewportGap;
    const aboveSpace = rect.top - viewportGap;
    const placement: RichSelectPosition["placement"] = belowSpace < 220 && aboveSpace > belowSpace ? "top" : "bottom";
    const available = placement === "top" ? aboveSpace : belowSpace;
    const maxHeight = Math.max(156, Math.min(320, available - gap));
    const top = placement === "top"
      ? Math.max(viewportGap, rect.top - maxHeight - gap)
      : Math.min(window.innerHeight - viewportGap - maxHeight, rect.bottom + gap);
    const left = Math.min(
      Math.max(viewportGap, rect.left),
      Math.max(viewportGap, window.innerWidth - width - viewportGap),
    );

    setPosition({ top, left, width, maxHeight, placement });
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
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (selectedIndex >= 0) {
      setActiveIndex(selectedIndex);
    } else if (!enabledIndexes.includes(activeIndex)) {
      setActiveIndex(enabledIndexes[0] ?? -1);
    }
  }, [activeIndex, enabledIndexes, selectedIndex]);

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
        <div
          ref={listboxRef}
          id={listboxId}
          className={`rich-select-popover is-${variant} is-${position.placement}`}
          role="listbox"
          aria-label={ariaLabel}
          style={{
            top: position.top,
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
        </div>,
        document.body,
      )}
    </span>
  );
}
