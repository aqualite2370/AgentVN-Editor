"""EmotionTrace decay and drift utilities."""


def decay_strength(memory_strength: float, chapters_elapsed: int, rate: float = 0.04) -> float:
    """Decay memory strength while preserving a small floor."""

    decayed = memory_strength * ((1.0 - rate) ** max(0, chapters_elapsed))
    return max(0.05, min(1.0, decayed))


def drift_value(value: float, target: float = 0.0, rate: float = 0.10) -> float:
    """Move an emotion dimension gradually toward a target."""

    return value + (target - value) * rate
