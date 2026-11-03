import type { FontCoverageResult } from "./fontCoverage";

interface FontCoverageWorkerResponse {
  status: "success" | "error";
  result?: FontCoverageResult;
  message?: string;
}

export async function inspectFontCoverage(
  source: string,
  text: string,
  signal: AbortSignal,
): Promise<FontCoverageResult> {
  const response = await fetch(source, { signal });
  if (!response.ok) throw new Error(`字体文件读取失败（HTTP ${response.status}）`);
  const fontData = await response.arrayBuffer();

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("字体覆盖检测已取消。", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./fontCoverage.worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("字体覆盖检测已取消。", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "字体解析器启动失败。"));
    };
    worker.onmessage = (event: MessageEvent<FontCoverageWorkerResponse>) => {
      cleanup();
      if (event.data.status === "success" && event.data.result) {
        resolve(event.data.result);
      } else {
        reject(new Error(event.data.message || "字体文件无法解析。"));
      }
    };
    worker.postMessage({ fontData, text }, [fontData]);
  });
}
