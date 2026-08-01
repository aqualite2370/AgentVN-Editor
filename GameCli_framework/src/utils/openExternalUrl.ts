import { openUrl } from "@tauri-apps/plugin-opener";
import { validateExternalUrl } from "../../../shared/cartridge/externalAction";
import { isTauriRuntime } from "./platform";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";

export type ExternalUrlOpenStatus =
  | "opened"
  | "ignored"
  | "invalid"
  | "unsupported_action"
  | "popup_blocked"
  | "failed";

export interface ExternalUrlOpenResult {
  status: ExternalUrlOpenStatus;
  normalizedUrl?: string;
  message?: string;
}

export interface ExternalUrlOpenDependencies {
  isDesktop?: () => boolean;
  openDesktop?: (url: string) => Promise<void>;
  openWeb?: (url: string) => boolean;
}

function defaultWebOpen(url: string): boolean {
  const target = window.open(url, "_blank", "noopener,noreferrer");
  if (!target) return false;
  try {
    target.opener = null;
  } catch {
    // error-log-ignore: 已在 window.open 中启用 noopener；部分跨域窗口会正常拒绝再次写入 opener。
  }
  return true;
}

async function defaultDesktopOpen(url: string): Promise<void> {
  await openUrl(url);
}

export async function openExternalUrl(
  value: unknown,
  dependencies: ExternalUrlOpenDependencies = {},
): Promise<ExternalUrlOpenResult> {
  const validation = validateExternalUrl(value);
  if (!validation.ok) {
    return {
      status: "invalid",
      message: validation.message,
    };
  }

  const isDesktop = dependencies.isDesktop ?? isTauriRuntime;
  const openDesktop = dependencies.openDesktop ?? defaultDesktopOpen;
  const openWeb = dependencies.openWeb ?? defaultWebOpen;

  try {
    if (isDesktop()) {
      await openDesktop(validation.normalizedUrl);
      return { status: "opened", normalizedUrl: validation.normalizedUrl };
    }
    const opened = openWeb(validation.normalizedUrl);
    return opened
      ? { status: "opened", normalizedUrl: validation.normalizedUrl }
      : {
        status: "popup_blocked",
        normalizedUrl: validation.normalizedUrl,
        message: "Browser blocked the new window.",
      };
  } catch (error) {
    reportFrontendError("player.external-link", error, { url: validation.normalizedUrl });
    return {
      status: "failed",
      normalizedUrl: validation.normalizedUrl,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function executeUILayoutAction(
  action: unknown,
  dependencies: ExternalUrlOpenDependencies = {},
): Promise<ExternalUrlOpenResult> {
  if (!action || typeof action !== "object") return { status: "ignored" };
  const candidate = action as { kind?: unknown; url?: unknown };
  if (candidate.kind === "none" || candidate.kind === undefined) return { status: "ignored" };
  if (candidate.kind !== "external_url") return { status: "unsupported_action" };
  return openExternalUrl(candidate.url, dependencies);
}
