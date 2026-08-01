# Memory Design

AgentVN uses two optional long-term memory systems behind `MemoryManager`.

## ChronicleGraph

ChronicleGraph stores objective temporal facts. A relation is an edge with a source, target, relation type, validity chapter, active flag, confidence, and source scene. When a fact changes, old rows are marked inactive instead of deleted. This preserves history while allowing current state queries through `is_active`.

Best suited for mystery, faction politics, world state, secrets, deaths, alliances, and causal event chains.

## EmotionTrace

EmotionTrace stores subjective character memories. Each memory belongs to a character and includes summary text, embedding, strength, emotion labels, chapter metadata, and valence/arousal/dominance dimensions.

Retrieval ranks memories with:

```text
recall_score =
  embedding_similarity * 0.55
  + memory_strength * 0.25
  + recency_score * 0.10
  + emotion_relevance * 0.10
```

Weights are configurable through environment variables. Decay reduces strength over chapter distance, and drift nudges emotion dimensions toward neutral over time.

## Memory Modes

- `none`: no long-term memory.
- `chronicle_graph_only`: objective facts only.
- `emotion_trace_only`: subjective memories only.
- `hybrid`: both systems.

Generation prompts strictly separate static character settings, objective facts, subjective memories, current goal, and output requirements.
