"""Context budget helpers for model calls."""

from __future__ import annotations

from dataclasses import dataclass

from app.schemas.requests import ProviderSelectionRequest

DEFAULT_CONTEXT_BUDGET = 24000
MIN_RESERVED_TOKENS = 1600
RESERVE_RATIO = 0.3
CJK_CHARS_PER_TOKEN = 0.7


@dataclass(frozen=True)
class PackedContext:
    text: str
    report: dict[str, object]


def estimate_tokens(text: str | None) -> int:
    value = text or ""
    cjk = sum(1 for char in value if "\u3400" <= char <= "\u9fff")
    latin = len([part for part in value.replace("\n", " ").split(" ") if part and not any("\u3400" <= char <= "\u9fff" for char in part)])
    punctuation = sum(1 for char in value if not char.isalnum() and not char.isspace())
    return int(cjk / CJK_CHARS_PER_TOKEN + latin * 1.3 + punctuation * 0.25 + 0.999)


def estimate_tokens_from_cjk_char_count(char_count: int) -> int:
    if char_count <= 0:
        return 0
    return int(char_count / CJK_CHARS_PER_TOKEN + 0.999)


def context_budget_tokens(selection: ProviderSelectionRequest | None) -> int:
    configured = None
    if selection and selection.parameters:
        configured = selection.parameters.context_budget_tokens
    if configured is None:
        return DEFAULT_CONTEXT_BUDGET
    return max(4000, min(200000, int(configured)))


def available_input_tokens(selection: ProviderSelectionRequest | None) -> tuple[int, int, int]:
    budget = context_budget_tokens(selection)
    max_tokens = 0
    if selection and selection.parameters and selection.parameters.max_tokens:
        max_tokens = int(selection.parameters.max_tokens)
    reserved = max(MIN_RESERVED_TOKENS, int(budget * RESERVE_RATIO), int(max_tokens * 1.25))
    return budget, reserved, max(1000, budget - reserved)


def tokens_to_approx_chars(tokens: int) -> int:
    if tokens <= 0:
        return 0
    return int(tokens * CJK_CHARS_PER_TOKEN)


def pack_text_context(text: str | None, selection: ProviderSelectionRequest | None, *, note: str) -> PackedContext:
    value = text or ""
    budget, reserved, available = available_input_tokens(selection)
    before = estimate_tokens(value)
    trimmed_chars = 0
    packed = value
    if before > available:
        max_chars = tokens_to_approx_chars(available)
        if len(value) > max_chars:
            head = int(max_chars * 0.68)
            tail = max(0, max_chars - head - 180)
            packed = value[:head] + "\n\n[ContextBudget: low priority middle content omitted by backend fallback]\n\n" + (value[-tail:] if tail else "")
            trimmed_chars = max(0, len(value) - len(packed))
    report = {
        "budget_tokens": budget,
        "reserved_tokens": reserved,
        "available_input_tokens": available,
        "estimated_input_tokens": before,
        "compression_triggered": before > available or trimmed_chars > 0,
        "compression_level": "fallback_trimmed" if before > available or trimmed_chars > 0 else "none",
        "dropped_low_priority_chars": trimmed_chars,
        "fallback_trimmed_chars": trimmed_chars,
        "notes": [
            note,
            "Backend only performs final safety trimming; frontend should already preserve P0/P1 context.",
        ],
    }
    return PackedContext(text=packed, report=report)
