import { useEffect, useMemo, useRef, useState } from "react";

type TypewriterVariant = "dialog" | "narration";

const punctuationPauses: Record<TypewriterVariant, Array<[RegExp, number]>> = {
  dialog: [
    [/[\r\n]/, 3.3],
    [/[，、；：]/, 1.9],
    [/[。！？!?]/, 3.9],
    [/[—…]/, 2.8],
  ],
  narration: [
    [/[\r\n]/, 4.1],
    [/[，、；：]/, 2.3],
    [/[。！？!?]/, 4.8],
    [/[—…]/, 3.5],
  ],
};

function stepDelayMs(text: string, count: number, charactersPerSecond: number, variant: TypewriterVariant): number {
  const baseDelay = charactersPerSecond <= 0 ? 0 : Math.max(12, Math.round(1000 / charactersPerSecond));
  if (baseDelay === 0 || count <= 0) return baseDelay;
  const previousChar = text[count - 1];
  const multiplier = punctuationPauses[variant].find(([pattern]) => pattern.test(previousChar))?.[1] ?? 1;
  const variantBias = variant === "narration" ? 1.12 : 1;
  const delay = Math.round(baseDelay * multiplier * variantBias);
  return Math.min(variant === "narration" ? 560 : 440, Math.max(baseDelay, delay));
}

export function TypewriterText({
  text,
  textKey,
  charactersPerSecond,
  instantReveal,
  onDone,
  variant = "dialog",
}: {
  text: string;
  textKey?: string;
  charactersPerSecond: number;
  instantReveal: boolean;
  onDone?: () => void;
  variant?: TypewriterVariant;
}) {
  const shouldReveal = instantReveal || charactersPerSecond <= 0;
  const [count, setCount] = useState(shouldReveal ? text.length : 0);
  const doneKeyRef = useRef("");
  const stableKey = textKey || text;
  const visible = useMemo(() => text.slice(0, count), [text, count]);

  useEffect(() => {
    doneKeyRef.current = "";
    setCount(shouldReveal ? text.length : 0);
  }, [stableKey, text]);

  useEffect(() => {
    if (shouldReveal) {
      setCount(text.length);
    }
  }, [shouldReveal, text.length]);

  useEffect(() => {
    if (shouldReveal || count >= text.length) {
      if (doneKeyRef.current !== stableKey) {
        doneKeyRef.current = stableKey;
        onDone?.();
      }
      return;
    }
    const delay = charactersPerSecond <= 0 ? 0 : Math.max(5, Math.round(1000 / charactersPerSecond));
    const nextDelay = delay === 0 ? 0 : stepDelayMs(text, count, charactersPerSecond, variant);
    if (nextDelay === 0) {
      setCount(text.length);
      return;
    }
    const timer = window.setTimeout(() => setCount((value) => Math.min(text.length, value + 1)), nextDelay);
    return () => window.clearTimeout(timer);
  }, [charactersPerSecond, count, onDone, shouldReveal, stableKey, text, variant]);

  return <span>{visible}</span>;
}
