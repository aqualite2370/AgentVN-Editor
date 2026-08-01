import type { GameManifest, RuntimeScript, Scene } from "../cartridge/types";
import type { UISkinLayout } from "../cartridge/uiSkin";

export const LIVE_PREVIEW_PROTOCOL_VERSION = 2;

export type LivePreviewScreen = "title_menu" | "playing" | "settings" | "save_load" | "history" | "gallery" | "about";
export type LivePreviewPlaybackRate = 0.5 | 1 | 2;

export type PreviewPathStep =
  | {
      kind: "choice";
      sceneId: string;
      commandIndex: number;
      choiceId: string;
      targetSceneId: string;
    }
  | {
      kind: "jump";
      sceneId: string;
      commandIndex: number;
      targetSceneId: string;
    }
  | {
      kind: "conditional";
      sceneId: string;
      commandIndex: number;
      branch: "matched" | "fallback";
      targetSceneId: string;
    }
  | {
      kind: "scene_end";
      sceneId: string;
      targetSceneId: string;
    };

export interface PreviewStartSpec {
  requestId: string;
  target: { sceneId: string; commandIndex?: number };
  entryPath: PreviewPathStep[];
  mode: "stable_frame" | "play_target_event";
  playbackRate: LivePreviewPlaybackRate;
  reducedMotion?: boolean;
}

interface LivePreviewMessageIdentity {
  protocolVersion: typeof LIVE_PREVIEW_PROTOCOL_VERSION;
  sessionId: string;
  revision: number;
  requestId: string;
  runId: string;
}

export interface LivePreviewInitMessage extends LivePreviewMessageIdentity {
  type: "agentvn.live-preview.init";
  manifest: GameManifest;
  script: RuntimeScript;
  uiSkin?: UISkinLayout;
  assetUrls: Record<string, string>;
  start: PreviewStartSpec;
  screen?: LivePreviewScreen;
}

export interface LivePreviewStartMessage extends LivePreviewMessageIdentity {
  type: "agentvn.live-preview.start";
  start: PreviewStartSpec;
}

export interface LivePreviewPatchMessage extends LivePreviewMessageIdentity {
  type: "agentvn.live-preview.patch";
  script?: RuntimeScript;
  scenes?: Scene[];
  manifest?: GameManifest;
  uiSkin?: UISkinLayout;
  assetUrls?: Record<string, string>;
  start?: PreviewStartSpec;
}

export interface LivePreviewControlMessage extends LivePreviewMessageIdentity {
  type: "agentvn.live-preview.control";
  action: "pause" | "resume" | "replay" | "finish" | "set_playback_rate";
  playbackRate?: LivePreviewPlaybackRate;
}

export interface PreviewFreezeFrameRequest extends LivePreviewMessageIdentity {
  type: "agentvn.live-preview.freeze-frame.request";
  width: 480;
  height: 270;
}

export interface LivePreviewReadyMessage extends LivePreviewMessageIdentity {
  type: "agentvn.live-preview.ready";
  sceneId?: string;
  commandIndex?: number;
}

export interface LivePreviewErrorMessage extends LivePreviewMessageIdentity {
  type: "agentvn.live-preview.error";
  message: string;
  sceneId?: string;
  commandIndex?: number;
}

export interface PreviewFreezeFrameResponse extends LivePreviewMessageIdentity {
  type: "agentvn.live-preview.freeze-frame.result";
  image?: string;
  unavailable?: true;
}

export type LivePreviewEditorMessage =
  | LivePreviewInitMessage
  | LivePreviewStartMessage
  | LivePreviewPatchMessage
  | LivePreviewControlMessage
  | PreviewFreezeFrameRequest;

export type LivePreviewRuntimeMessage =
  | LivePreviewReadyMessage
  | LivePreviewErrorMessage
  | PreviewFreezeFrameResponse;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasMessageIdentity(value: Record<string, unknown>): boolean {
  return value.protocolVersion === LIVE_PREVIEW_PROTOCOL_VERSION
    && isNonEmptyString(value.sessionId)
    && Number.isInteger(value.revision)
    && (value.revision as number) >= 0
    && isNonEmptyString(value.requestId)
    && isNonEmptyString(value.runId);
}

export function isLivePreviewEditorMessage(value: unknown): value is LivePreviewEditorMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (!hasMessageIdentity(message)) return false;
  return message.type === "agentvn.live-preview.init"
    || message.type === "agentvn.live-preview.start"
    || message.type === "agentvn.live-preview.patch"
    || message.type === "agentvn.live-preview.control"
    || (
      message.type === "agentvn.live-preview.freeze-frame.request"
      && message.width === 480
      && message.height === 270
    );
}
