import type { Edge, Node, Viewport } from "@xyflow/react";
import type { AnimationCommand, ChoiceCommand, Condition, ConditionOperator, GameCommand, JsonValue, StateUpdateCommand } from "./commands";
import type { DialogVisualStyle, LoadingAnimationConfig, SpeakerFocusConfig } from "../../../shared/cartridge/types";
import type { MemoryMode } from "./memory";
import type { SceneBeat } from "./scene";
import type { PendingVisualAsset } from "./assets";

export type EditorNodeKind =
  | "scene"
  | "choice"
  | "modifier"
  | "condition"
  | "loop"
  | "animation"
  | "start"
  | "end";

export interface AiSettings {
  authorGoal: string;
  generationOutline?: string;
  autoExtractMemory: boolean;
  autoApplyMemory: boolean;
}

export interface PreviewState {
  currentCommandIndex: number;
  isPlaying: boolean;
}

export type GraphImportMode = "blank_autoconnect" | "append_isolated";

export interface EditorMeta {
  collapsedInspectorSections: string[];
  debugNotes?: string;
  styleVariant?: string;
  source?: "manual" | "ai_generated" | "ai_edited" | "imported";
  generatedAt?: string;
  generatedFromNodeId?: string;
  sourceMapping?: unknown;
  importSessionId?: string;
  importLineId?: string;
  importIndex?: number;
  sourceProcessJobId?: string;
  sourceProcessChapterIndex?: number;
  graphImportMode?: GraphImportMode;
  needsReview?: boolean;
  qualityRisk?: "low" | "medium" | "high";
  pendingVisualAssets?: PendingVisualAsset[];
}

export interface ConditionData {
  expression: string;
  trueLabel: string;
  falseLabel: string;
  mode?: "builder" | "advanced";
  key?: string;
  operator?: ConditionOperator;
  value?: JsonValue;
  valueType?: "boolean" | "number" | "text" | "list";
}

export interface LoopData {
  variableKey: string;
  initialValue: number;
  step: number;
  continueCondition: Condition;
  loopLabel: string;
  exitLabel: string;
}

export interface EndData {
  ending_id: string;
  ending_title: string;
}

export interface EditorNodeData extends Record<string, unknown> {
  nodeKind: EditorNodeKind;
  scene?: SceneBeat;
  choice?: ChoiceCommand;
  label: string;
  description: string;
  memoryMode?: MemoryMode;
  aiSettings: AiSettings;
  previewState: PreviewState;
  editorMeta: EditorMeta;
  stateUpdate?: StateUpdateCommand;
  condition?: ConditionData;
  loop?: LoopData;
  animation?: AnimationCommand;
  loadingAnimation?: LoadingAnimationConfig;
  ending?: EndData;
}

export type EditorNode = Node<EditorNodeData>;
export type EditorEdge = Edge;

export interface EditorGraphState {
  nodes: EditorNode[];
  edges: EditorEdge[];
  viewport: Viewport;
}

export interface EditorProjectFile {
  schema_version: string;
  project_id: string;
  title: string;
  author: string;
  nodes: EditorNode[];
  edges: EditorEdge[];
  viewport: Viewport;
  memory_mode: MemoryMode;
  asset_manifest: unknown[];
  editor_settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RuntimeScene {
  scene_id: string;
  scene_display_name?: string | null;
  title: string;
  summary: string;
  commands: GameCommand[];
  tags: string[];
  chapter: number;
  next_scene_id?: string;
  is_ending?: boolean;
  ending_id?: string;
  ending_title?: string;
}

export interface RuntimeScript {
  schema_version: string;
  entry_scene_id: string;
  default_sprite_scale?: number;
  speaker_focus?: SpeakerFocusConfig;
  loading_animation?: LoadingAnimationConfig;
  characters?: Array<{
    character_id: string;
    name: string;
    aliases?: string[];
    dialog_style?: DialogVisualStyle | null;
  }>;
  scenes: RuntimeScene[];
}
