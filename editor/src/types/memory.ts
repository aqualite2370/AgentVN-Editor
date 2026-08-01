export type MemoryMode =
  | "none"
  | "chronicle_graph_only"
  | "emotion_trace_only"
  | "hybrid";

export interface RelationEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  valid_since_chapter: number;
  invalidated_at_chapter?: number | null;
  is_active: boolean;
  confidence: number;
  source_scene_id?: string | null;
  note?: string | null;
}

export interface EpisodicMemory {
  id: string;
  character_id: string;
  summary: string;
  embedding?: number[];
  memory_strength: number;
  original_emotion: string;
  current_emotion: string;
  created_at_chapter: number;
  last_accessed_chapter: number;
  source_scene_id?: string | null;
  valence: number;
  arousal: number;
  dominance: number;
}

export interface RelationInvalidation {
  relation_id?: string | null;
  source?: string | null;
  target?: string | null;
  relation?: string | null;
  invalidated_at_chapter?: number | null;
  note?: string | null;
}

export interface NewRelation {
  source: string;
  target: string;
  relation: string;
  confidence: number;
  source_scene_id?: string | null;
  note?: string | null;
}

export interface EmotionSnapshot {
  character_id: string;
  summary: string;
  original_emotion: string;
  current_emotion: string;
  memory_strength: number;
  source_scene_id?: string | null;
  valence: number;
  arousal: number;
  dominance: number;
}

export interface MemoryUpdate {
  summary_100: string;
  invalidated_relations: RelationInvalidation[];
  new_relations: NewRelation[];
  emotion_snapshots: EmotionSnapshot[];
}
