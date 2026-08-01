import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../utils/platform";

export type RuntimeMode = "library" | "preview" | "fixed";

export interface LaunchConfig {
  mode: RuntimeMode;
  cartridgePath?: string;
  previewRoot?: string;
}

interface RuntimeModeFile {
  mode?: string;
}

interface FixedOnlyFile {
  fixedOnly?: boolean;
}

function normalizeMode(mode: string | undefined): RuntimeMode {
  return mode === "preview" || mode === "fixed" ? mode : "library";
}

function readBuildRuntimeMode(): RuntimeMode | undefined {
  const mode = import.meta.env.VITE_AGENTVN_RUNTIME_MODE as string | undefined;
  return mode ? normalizeMode(mode) : undefined;
}

function readBuildFixedOnlyMarker(): boolean {
  return (import.meta.env.VITE_AGENTVN_FIXED_ONLY as string | undefined) === "true";
}

async function readRuntimeModeFile(): Promise<RuntimeMode | undefined> {
  try {
    const response = await fetch("/runtime-mode.json", { cache: "no-store" });
    if (!response.ok) return undefined;
    const modeFile = (await response.json()) as RuntimeModeFile;
    return normalizeMode(modeFile.mode);
  } catch {
    // error-log-ignore: 运行模式文件是浏览器与旧发行包的可选能力探测，缺失或格式不兼容时使用默认模式。
    return undefined;
  }
}

async function readFixedOnlyMarker(): Promise<boolean> {
  try {
    const fixedOnlyResponse = await fetch("/fixed-only.json", { cache: "no-store" });
    if (!fixedOnlyResponse.ok) return false;
    const fixedOnly = (await fixedOnlyResponse.json()) as FixedOnlyFile;
    return Boolean(fixedOnly.fixedOnly);
  } catch {
    // error-log-ignore: 固定卡带标记是可选能力探测，旧发行包没有该文件时按普通模式启动。
    return false;
  }
}

export async function getLaunchConfig(): Promise<LaunchConfig> {
  const params = new URLSearchParams(window.location.search);
  const queryMode = params.get("mode");
  const legacyPreviewMode = params.get("preview") === "1";
  const buildMode = readBuildRuntimeMode();
  const buildFixedOnly = readBuildFixedOnlyMarker();
  const modeFromFile = await readRuntimeModeFile();
  const fixedOnly = await readFixedOnlyMarker();
  const fixedOnlyActive = (buildFixedOnly && buildMode !== "library") || (fixedOnly && modeFromFile !== "library");

  if (fixedOnlyActive) {
    return {
      mode: "fixed",
      cartridgePath: params.get("cartridge") ?? undefined,
      previewRoot: params.get("previewRoot") ?? undefined,
    };
  }

  if (queryMode || legacyPreviewMode) {
    return {
      mode: legacyPreviewMode ? "preview" : normalizeMode(queryMode ?? undefined),
      cartridgePath: params.get("cartridge") ?? undefined,
      previewRoot: params.get("previewRoot") ?? undefined,
    };
  }

  if (isTauriRuntime()) {
    const config = await invoke<LaunchConfig>("get_launch_config");
    if (config.mode !== "library" || config.cartridgePath) {
      return {
        mode: normalizeMode(config.mode),
        cartridgePath: config.cartridgePath,
        previewRoot: config.previewRoot,
      };
    }
  }

  if (modeFromFile) {
    return {
      mode: modeFromFile,
      cartridgePath: params.get("cartridge") ?? undefined,
      previewRoot: params.get("previewRoot") ?? undefined,
    };
  }

  if (buildMode) {
    return {
      mode: buildMode,
      cartridgePath: params.get("cartridge") ?? undefined,
      previewRoot: params.get("previewRoot") ?? undefined,
    };
  }

  if (isTauriRuntime()) {
    const config = await invoke<LaunchConfig>("get_launch_config");
    return {
      mode: normalizeMode(config.mode),
      cartridgePath: config.cartridgePath,
      previewRoot: config.previewRoot,
    };
  }

  return {
    mode: "library",
    cartridgePath: params.get("cartridge") ?? undefined,
    previewRoot: params.get("previewRoot") ?? undefined,
  };
}
