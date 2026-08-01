import type { JsonValue } from "./commands";
import type { BackgroundFit } from "./manifest";
import type { DialogState, FocusedImageState, SpriteState } from "./settings";
import type {
  CameraBlockingGate,
  CameraEventRef,
  CameraImpulseFrame,
  CameraMotionV1,
  CameraPoseV1,
} from "../../../shared/camera/cameraMotion";

export interface HistoryEntry {
  id: string;
  scene_id: string;
  scene_title: string;
  speaker?: string;
  text: string;
  emotion?: string | null;
  timestamp: string;
}

export type SaveKind = "manual" | "auto";

export interface SaveSlotRef {
  kind: SaveKind;
  slot: number;
}

export interface CameraReplayRecord {
  lane: "pose" | "impulse";
  event_ref: CameraEventRef;
  motion: CameraMotionV1;
  from?: CameraPoseV1;
  start_offset_ms: number;
  elapsed_ms?: number;
  blocking: boolean;
  visual_only: boolean;
}

export interface CameraSaveStateV1 {
  schema_version: 1;
  persistent_pose: CameraPoseV1;
  visual_frame: {
    pose: CameraPoseV1;
    impulse: CameraImpulseFrame;
  };
  active_replays: CameraReplayRecord[];
  blocking_gate?: CameraBlockingGate;
}

export interface SaveData {
  save_version?: 2 | 3;
  save_kind?: SaveKind;
  save_id: string;
  game_id: string;
  install_id?: string;
  slot: number;
  created_at: string;
  preview_image?: string;
  preview_choices?: string[];
  scene_id: string;
  command_index: number;
  variables: Record<string, JsonValue>;
  history: HistoryEntry[];
  background?: string;
  background_fit?: BackgroundFit;
  sprites: Record<string, SpriteState>;
  sprite_order?: string[];
  dialog?: DialogState;
  focused_image?: FocusedImageState;
  unlocked_gallery: string[];
  playtime_seconds: number;
  camera?: CameraSaveStateV1;
}
