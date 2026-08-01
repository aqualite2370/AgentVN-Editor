"""Memory retrieval scoring."""

import math


def cosine_similarity(left: list[float], right: list[float]) -> float:
    """Return cosine similarity normalized to 0..1."""

    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return max(0.0, min(1.0, (dot / (left_norm * right_norm) + 1.0) / 2.0))


def recency_score(current_chapter: int, last_accessed_chapter: int) -> float:
    """Score recent memories higher without deleting old memories."""

    distance = max(0, current_chapter - last_accessed_chapter)
    return 1.0 / (1.0 + distance)


def emotion_relevance(
    query_valence: float | None,
    query_arousal: float | None,
    query_dominance: float | None,
    memory_valence: float,
    memory_arousal: float,
    memory_dominance: float,
) -> float:
    """Return an affective similarity score in 0..1."""

    if query_valence is None and query_arousal is None and query_dominance is None:
        return 0.5
    qv = query_valence if query_valence is not None else 0.0
    qa = query_arousal if query_arousal is not None else 0.0
    qd = query_dominance if query_dominance is not None else 0.0
    distance = math.sqrt(
        (qv - memory_valence) ** 2
        + (qa - memory_arousal) ** 2
        + (qd - memory_dominance) ** 2
    )
    return max(0.0, 1.0 - distance / math.sqrt(12.0))


def recall_score(
    embedding_similarity: float,
    memory_strength: float,
    recency: float,
    emotion: float,
    weights: tuple[float, float, float, float],
) -> float:
    """Combine retrieval dimensions into one ranking score."""

    vw, sw, rw, ew = weights
    return (
        embedding_similarity * vw
        + memory_strength * sw
        + recency * rw
        + emotion * ew
    )
