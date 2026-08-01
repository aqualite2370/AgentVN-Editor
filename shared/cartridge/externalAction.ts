export const SAFE_EXTERNAL_URL_PROTOCOLS = ["http:", "https:"] as const;

export type SafeExternalUrlProtocol = (typeof SAFE_EXTERNAL_URL_PROTOCOLS)[number];
export type ExternalUrlValidationCode =
  | "external_url_required"
  | "external_url_invalid"
  | "external_url_unsupported_protocol";

export interface ValidExternalUrlResult {
  ok: true;
  normalizedUrl: string;
  protocol: SafeExternalUrlProtocol;
}

export interface InvalidExternalUrlResult {
  ok: false;
  code: ExternalUrlValidationCode;
  message: string;
}

export type ExternalUrlValidationResult = ValidExternalUrlResult | InvalidExternalUrlResult;

export const EXTERNAL_URL_ERROR_MESSAGES: Record<ExternalUrlValidationCode, string> = {
  external_url_required: "External URL is required.",
  external_url_invalid: "External URL must be an absolute URL including http:// or https://.",
  external_url_unsupported_protocol: "External URL must use the http:// or https:// protocol.",
};

export function normalizeExternalUrl(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateExternalUrl(value: unknown): ExternalUrlValidationResult {
  const normalizedInput = normalizeExternalUrl(value);
  if (!normalizedInput) {
    return {
      ok: false,
      code: "external_url_required",
      message: EXTERNAL_URL_ERROR_MESSAGES.external_url_required,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedInput);
  } catch {
    return {
      ok: false,
      code: "external_url_invalid",
      message: EXTERNAL_URL_ERROR_MESSAGES.external_url_invalid,
    };
  }

  if (!SAFE_EXTERNAL_URL_PROTOCOLS.includes(parsed.protocol as SafeExternalUrlProtocol)) {
    return {
      ok: false,
      code: "external_url_unsupported_protocol",
      message: EXTERNAL_URL_ERROR_MESSAGES.external_url_unsupported_protocol,
    };
  }

  return {
    ok: true,
    normalizedUrl: parsed.href,
    protocol: parsed.protocol as SafeExternalUrlProtocol,
  };
}

export function isSafeExternalUrl(value: unknown): boolean {
  return validateExternalUrl(value).ok;
}
