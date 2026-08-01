import type { PreviewPayload } from "./previewStore";

const messageType = "agentvn.preview.payload";

export function sendPreviewPayloadToWindow(target: Window | null, payload: PreviewPayload): void {
  target?.postMessage({ type: messageType, payload }, window.location.origin);
}

export function listenPreviewPayload(callback: (payload: PreviewPayload) => void): () => void {
  const listener = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === messageType) callback(event.data.payload as PreviewPayload);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
