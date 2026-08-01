import { isStructuredCameraCommand } from "../camera/cameraMotion";
import type { RuntimeScript } from "./types";

export const LEGACY_RUNTIME_VERSION = "0.2.0";
export const STRUCTURED_CAMERA_RUNTIME_VERSION = "0.3.0";
export const CAMERA_SEQUENCE_RUNTIME_VERSION = "0.4.0";
export const LEGACY_SCRIPT_SCHEMA_VERSION = "1.1.0";
export const STRUCTURED_CAMERA_SCRIPT_SCHEMA_VERSION = "1.2.0";
export const CAMERA_SEQUENCE_SCRIPT_SCHEMA_VERSION = "1.3.0";

export function scriptUsesStructuredCamera(script: Pick<RuntimeScript, "scenes">): boolean {
  return script.scenes.some((scene) =>
    scene.commands.some((command) => command.type === "camera" && isStructuredCameraCommand(command))
  );
}

export function scriptUsesCameraSequence(script: Pick<RuntimeScript, "scenes">): boolean {
  return script.scenes.some((scene) =>
    scene.commands.some((command) =>
      command.type === "camera"
      && isStructuredCameraCommand(command)
      && command.motion.kind === "sequence"
    )
  );
}

export function minimumRuntimeVersionForScript(script: Pick<RuntimeScript, "scenes">): string {
  if (scriptUsesCameraSequence(script)) return CAMERA_SEQUENCE_RUNTIME_VERSION;
  return scriptUsesStructuredCamera(script)
    ? STRUCTURED_CAMERA_RUNTIME_VERSION
    : LEGACY_RUNTIME_VERSION;
}

export function runtimeScriptSchemaVersion(script: Pick<RuntimeScript, "scenes">): string {
  if (scriptUsesCameraSequence(script)) return CAMERA_SEQUENCE_SCRIPT_SCHEMA_VERSION;
  return scriptUsesStructuredCamera(script)
    ? STRUCTURED_CAMERA_SCRIPT_SCHEMA_VERSION
    : LEGACY_SCRIPT_SCHEMA_VERSION;
}
