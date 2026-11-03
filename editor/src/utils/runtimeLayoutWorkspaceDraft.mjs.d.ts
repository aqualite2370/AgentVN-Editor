import type { RuntimeLayoutType } from "../../../shared/cartridge/uiLayoutProfiles";

export declare function readRuntimeLayoutWorkspaceDraft<T>(
  projectId: string,
  layoutType: RuntimeLayoutType,
  clone: (value: T) => T,
): T | undefined;

export declare function writeRuntimeLayoutWorkspaceDraft<T>(
  projectId: string,
  layoutType: RuntimeLayoutType,
  draft: T,
  clone: (value: T) => T,
): void;

export declare function clearRuntimeLayoutWorkspaceDraft(projectId: string, layoutType: RuntimeLayoutType): void;
