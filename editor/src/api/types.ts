import type { MemoryMode, MemoryUpdate, RelationEdge, EpisodicMemory } from "../types/memory";
import type { SceneBeat } from "../types/scene";
import type {
  DiscoveredProviderModel,
  ProviderConnection,
  ProviderModel,
  ProviderModelParameters,
  ProviderSelectionState,
} from "../providers/types";
import type { EditorProjectFile } from "../types/nodes";
import type { ProjectMetadata } from "../types/project";
import type { AssistantChatMessage, AssistantDocChunk } from "../assistant/types";

export interface ProviderSelectionPayload {
  connection_id: string;
  model_id: string;
  base_url: string;
  api_key: string;
  parameters?: ProviderModelParameters;
}

export interface GenerateSceneRequest {
  current_scene: string;
  target_scene_stub?: string | null;
  previous_summary?: string | null;
  author_goal: string;
  generation_outline?: string | null;
  editor_context?: string | null;
  memory_mode: MemoryMode;
  chapter: number;
  provider_selection?: ProviderSelectionPayload;
}

export interface ExtractMemoryRequest {
  scene: SceneBeat;
  memory_mode: MemoryMode;
  chapter: number;
  provider_selection?: ProviderSelectionPayload;
}

export interface GenerationTraceEvent {
  id: string;
  time: string;
  phase: string;
  level: "info" | "success" | "warning" | "error" | string;
  title: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApplyMemoryUpdateResponse {
  invalidated_relations: number;
  new_relations: number;
  emotion_snapshots: number;
}

export interface HealthResponse {
  status: string;
  service: string;
}

export interface MemoryModeResponse {
  memory_mode: MemoryMode;
}

export interface TestProviderConnectionRequest {
  base_url: string;
  api_key: string;
}

export interface TestProviderConnectionResponse {
  ok: boolean;
  latency_ms: number;
  base_url: string;
  supports_model_discovery: boolean;
  models: DiscoveredProviderModel[];
  error_message?: string;
}

export interface TestProviderGenerationRequest {
  provider_selection: ProviderSelectionPayload;
}

export interface TestProviderGenerationResponse {
  ok: boolean;
  latency_ms: number;
  model_id: string;
  structured_mode: string;
  message: string;
  error_message?: string;
  tool_calling_ok?: boolean;
  scene_schema_ok?: boolean;
  json_mode_ok?: boolean;
  memory_schema_ok?: boolean;
  complex_schema_ok?: boolean;
  tool_unsupported?: boolean;
  fallback_reason?: string;
  recommended_structured_mode?: "auto" | "tools" | "json_object" | string;
  diagnostics?: string[];
}

export interface AssistantChatRequest {
  question: string;
  context_chunks: AssistantDocChunk[];
  messages: AssistantChatMessage[];
  editor_context?: string;
  provider_selection?: ProviderSelectionPayload;
}

export interface AssistantCitationResponse {
  id: string;
  source: string;
  title: string;
}

export interface AssistantChatResponse {
  answer: string;
  citations: AssistantCitationResponse[];
}

export interface SharedProjectGraphState {
  nodes: EditorProjectFile["nodes"];
  edges: EditorProjectFile["edges"];
  viewport: EditorProjectFile["viewport"];
  memoryMode: MemoryMode;
}

export interface SharedProviderState {
  provider_connections: ProviderConnection[];
  provider_models: ProviderModel[];
  provider_selections: ProviderSelectionState;
  provider_secrets: Record<string, string>;
}

export interface SharedEditorState extends SharedProviderState {
  project_graph: SharedProjectGraphState;
  project_metadata: Partial<ProjectMetadata> & {
    title?: string;
    author?: string;
    assetManifest?: unknown[];
    settings?: Record<string, unknown>;
  };
  recent_projects: EditorProjectFile[];
}

export type SharedEditorStateUpdate = Partial<SharedEditorState>;

export interface ProjectSummary {
  project_id: string;
  title: string;
  author: string;
  created_at?: string;
  updated_at: string;
  node_count: number;
  edge_count: number;
  schema_version?: string;
  has_detail?: boolean;
}

export type { MemoryUpdate, RelationEdge, EpisodicMemory };
