export interface GameCliPreviewRequest {
  cartridge: Blob;
  fileName: string;
  onProgress?: (event: GameCliPreviewProgressEvent) => void;
}

export interface GameCliDirectoryPreviewTextFile {
  path: string;
  contents: string;
}

export interface GameCliDirectoryPreviewAsset {
  cartridgePath: string;
  assetId: string;
  sourceFilePath?: string;
  data?: Uint8Array;
  expectedSize?: number;
}

export interface GameCliDirectoryPreviewRequest {
  fileName: string;
  textFiles: GameCliDirectoryPreviewTextFile[];
  assets: GameCliDirectoryPreviewAsset[];
  onProgress?: (event: GameCliPreviewProgressEvent) => void;
}

export interface PreviewLaunchResult {
  mode: "gamecli" | "browser";
  message: string;
}

export interface GameCliPreviewProgressEvent {
  phase: "browser" | "upload" | "unpack" | "validate" | "launch" | "legacy";
  percent?: number;
  message: string;
}

interface GameCliPreviewUpload {
  uploadId: string;
  path: string;
}

interface GameCliPreviewUploadAppendResult {
  writtenBytes: number;
}

const GAMECLI_PREVIEW_UPLOAD_CHUNK_BYTES = 256 * 1024;
const LEGACY_GAMECLI_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function blobSliceToByteArray(blob: Blob): Promise<number[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const result = new Array<number>(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    result[index] = bytes[index];
  }
  return result;
}

function uint8ArrayToNumberArray(bytes: Uint8Array): number[] {
  const result = new Array<number>(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) result[index] = bytes[index];
  return result;
}

async function blobToByteArray(blob: Blob, onProgress?: GameCliPreviewRequest["onProgress"]): Promise<number[]> {
  const result = new Array<number>(blob.size);
  let writeOffset = 0;
  for (let offset = 0; offset < blob.size; offset += GAMECLI_PREVIEW_UPLOAD_CHUNK_BYTES) {
    const slice = blob.slice(offset, Math.min(blob.size, offset + GAMECLI_PREVIEW_UPLOAD_CHUNK_BYTES));
    const chunk = await blobSliceToByteArray(slice);
    for (let index = 0; index < chunk.length; index += 1) {
      result[writeOffset + index] = chunk[index];
    }
    writeOffset += chunk.length;
    onProgress?.({
      phase: "legacy",
      percent: blob.size > 0 ? Math.min(100, Math.round((writeOffset / blob.size) * 100)) : 100,
      message: `Preparing legacy preview transfer: ${Math.min(writeOffset, blob.size)} / ${blob.size} bytes`,
    });
  }
  return result;
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function isMissingTauriCommand(error: unknown, command: string): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes(`Command ${command} not found`) || message.includes(`command ${command} not found`);
}

function runtimePreviewUrl(): URL {
  const url = new URL("http://127.0.0.1:6868/");
  url.searchParams.set("preview", "1");
  return url;
}

async function openBrowserPreview(request: GameCliPreviewRequest, statusMessage?: string): Promise<PreviewLaunchResult> {
  request.onProgress?.({ phase: "browser", percent: 10, message: "Opening browser GameCLI preview window." });
  const url = runtimePreviewUrl();
  const target = window.open(url.toString(), "agentvn-gamecli-preview");
  if (!target) {
    throw new Error("The browser blocked the GameCLI preview window. Allow popups or use the desktop app.");
  }

  request.onProgress?.({ phase: "browser", percent: 48, message: "Sending temporary cartridge to browser preview window." });
  const previewNonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const previewMessage = {
    type: "agentvn.runtime.preview",
    cartridgeBuffer: await request.cartridge.arrayBuffer(),
    fileName: request.fileName,
    previewNonce,
  };

  for (const delayMs of [250, 750, 1400, 2400, 4000, 6500, 9000]) {
    window.setTimeout(() => target.postMessage(previewMessage, url.origin), delayMs);
  }

  request.onProgress?.({ phase: "browser", percent: 100, message: "Temporary cartridge sent to browser preview window." });
  return {
    mode: "browser",
    message: statusMessage ?? "Opened the browser GameCLI preview window and sent the temporary cartridge.",
  };
}

export async function openGameCliPreview(request: GameCliPreviewRequest): Promise<PreviewLaunchResult> {
  if (!isTauriRuntime()) return openBrowserPreview(request);

  try {
    request.onProgress?.({ phase: "upload", percent: 0, message: "Creating GameCLI disk preview upload." });
    const upload = await invokeTauri<GameCliPreviewUpload>("begin_gamecli_preview_disk_upload", {
      fileName: request.fileName,
      expectedSize: request.cartridge.size,
    });
    let acknowledgedBytes = 0;
    for (let offset = 0; offset < request.cartridge.size; offset += GAMECLI_PREVIEW_UPLOAD_CHUNK_BYTES) {
      const slice = request.cartridge.slice(offset, Math.min(request.cartridge.size, offset + GAMECLI_PREVIEW_UPLOAD_CHUNK_BYTES));
      const chunkBytes = await blobSliceToByteArray(slice);
      const appendResult = await invokeTauri<GameCliPreviewUploadAppendResult>("append_gamecli_preview_disk_chunk", {
        uploadId: upload.uploadId,
        offsetBytes: acknowledgedBytes,
        chunkBytes,
      });
      const uploadedBytes = Math.min(offset + chunkBytes.length, request.cartridge.size);
      acknowledgedBytes = appendResult.writtenBytes;
      if (acknowledgedBytes !== uploadedBytes) {
        throw new Error(`GameCLI disk preview upload verification failed: acknowledged ${acknowledgedBytes} / expected ${uploadedBytes} bytes.`);
      }
      request.onProgress?.({
        phase: "upload",
        percent: request.cartridge.size > 0 ? Math.min(65, Math.round((acknowledgedBytes / request.cartridge.size) * 65)) : 65,
        message: `Uploading cartridge: ${acknowledgedBytes} / ${request.cartridge.size} bytes`,
      });
    }
    if (acknowledgedBytes !== request.cartridge.size) {
      throw new Error(`GameCLI disk preview upload incomplete: acknowledged ${acknowledgedBytes} / ${request.cartridge.size} bytes.`);
    }
    request.onProgress?.({ phase: "unpack", percent: 72, message: "Upload complete; unpacking cartridge to disk preview directory." });
    request.onProgress?.({ phase: "validate", percent: 86, message: "Validating temporary cartridge structure and resources." });
    const previewRoot = await invokeTauri<string>("open_gamecli_preview_disk_upload", {
      uploadId: upload.uploadId,
    });
    request.onProgress?.({ phase: "launch", percent: 100, message: "GameCLI disk preview started." });
    return { mode: "gamecli", message: `GameCLI disk preview root: ${previewRoot}` };
  } catch (error) {
    if (!isMissingTauriCommand(error, "begin_gamecli_preview_disk_upload")) throw error;
    if (request.cartridge.size > LEGACY_GAMECLI_PREVIEW_MAX_BYTES) {
      throw new Error("Current desktop host does not support large disk preview. Please install the latest desktop build and try again.");
    }
  }

  try {
    request.onProgress?.({ phase: "upload", percent: 0, message: "Creating legacy GameCLI preview upload." });
    const upload = await invokeTauri<GameCliPreviewUpload>("begin_gamecli_preview_upload", {
      fileName: request.fileName,
    });
    for (let offset = 0; offset < request.cartridge.size; offset += GAMECLI_PREVIEW_UPLOAD_CHUNK_BYTES) {
      const slice = request.cartridge.slice(offset, Math.min(request.cartridge.size, offset + GAMECLI_PREVIEW_UPLOAD_CHUNK_BYTES));
      const chunkBytes = await blobSliceToByteArray(slice);
      await invokeTauri<void>("append_gamecli_preview_chunk", {
        uploadId: upload.uploadId,
        chunkBytes,
      });
      const uploadedBytes = Math.min(offset + chunkBytes.length, request.cartridge.size);
      request.onProgress?.({
        phase: "upload",
        percent: request.cartridge.size > 0 ? Math.min(100, Math.round((uploadedBytes / request.cartridge.size) * 100)) : 100,
        message: `Uploading temporary cartridge: ${uploadedBytes} / ${request.cartridge.size} bytes`,
      });
    }
    request.onProgress?.({ phase: "launch", percent: 96, message: "Temporary cartridge written; launching GameCLI." });
    const path = await invokeTauri<string>("open_gamecli_preview_upload", {
      uploadId: upload.uploadId,
    });
    request.onProgress?.({ phase: "launch", percent: 100, message: "GameCLI preview launch request sent." });
    return { mode: "gamecli", message: `GameCLI preview cartridge written: ${path}` };
  } catch (error) {
    if (!isMissingTauriCommand(error, "begin_gamecli_preview_upload")) throw error;
    request.onProgress?.({ phase: "legacy", percent: 0, message: "Desktop preview host is old; preparing compatibility transfer." });
    const cartridgeBytes = await blobToByteArray(request.cartridge, request.onProgress);
    request.onProgress?.({ phase: "launch", percent: 96, message: "Compatibility transfer prepared; launching GameCLI." });
    const path = await invokeTauri<string>("open_gamecli_preview", {
      cartridgeBytes,
      fileName: request.fileName,
    });
    request.onProgress?.({ phase: "launch", percent: 100, message: "GameCLI preview launch request sent." });
    return { mode: "gamecli", message: `GameCLI preview cartridge written through legacy host: ${path}` };
  }
}

export function isMissingDirectoryPreviewSupport(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("Current desktop host does not support fast directory preview")
    || isMissingTauriCommand(error, "begin_gamecli_preview_directory");
}

function directoryPreviewTotalBytes(request: GameCliDirectoryPreviewRequest): number {
  const textBytes = request.textFiles.reduce((total, file) => total + new TextEncoder().encode(file.contents).byteLength, 0);
  const assetBytes = request.assets.reduce((total, asset) => total + (asset.expectedSize ?? asset.data?.byteLength ?? 0), 0);
  return textBytes + assetBytes;
}

export async function openGameCliPreviewDirectory(request: GameCliDirectoryPreviewRequest): Promise<PreviewLaunchResult> {
  if (!isTauriRuntime()) {
    throw new Error("Fast directory preview is only available in the AgentVN desktop app.");
  }
  const totalBytes = directoryPreviewTotalBytes(request);
  try {
    request.onProgress?.({ phase: "upload", percent: 0, message: "Creating GameCLI directory preview session." });
    const session = await invokeTauri<{ sessionId: string; path: string }>("begin_gamecli_preview_directory", {
      expectedFileCount: request.textFiles.length + request.assets.length,
      expectedAssetCount: request.assets.length,
    });
    let completedBytes = 0;
    const reportProgress = (message: string) => {
      request.onProgress?.({
        phase: "upload",
        percent: totalBytes > 0 ? Math.min(80, Math.round((completedBytes / totalBytes) * 80)) : 80,
        message,
      });
    };

    for (const file of request.textFiles) {
      await invokeTauri<void>("write_gamecli_preview_text_file", {
        sessionId: session.sessionId,
        relativePath: file.path,
        contents: file.contents,
      });
      completedBytes += new TextEncoder().encode(file.contents).byteLength;
      reportProgress(`Wrote preview file: ${file.path}`);
    }

    for (const asset of request.assets) {
      if (asset.sourceFilePath) {
        await invokeTauri<void>("link_or_copy_gamecli_preview_asset", {
          sessionId: session.sessionId,
          relativePath: asset.cartridgePath,
          sourceFilePath: asset.sourceFilePath,
        });
        completedBytes += asset.expectedSize ?? 0;
        reportProgress(`Linked/copied preview asset: ${asset.assetId}`);
        continue;
      }
      if (!asset.data) {
        throw new Error(`Preview asset has neither source file nor bytes: ${asset.assetId}`);
      }
      await invokeTauri<void>("begin_gamecli_preview_asset_upload", {
        sessionId: session.sessionId,
        relativePath: asset.cartridgePath,
        expectedSize: asset.data.byteLength,
      });
      let acknowledged = 0;
      for (let offset = 0; offset < asset.data.byteLength; offset += GAMECLI_PREVIEW_UPLOAD_CHUNK_BYTES) {
        const chunk = asset.data.slice(offset, Math.min(asset.data.byteLength, offset + GAMECLI_PREVIEW_UPLOAD_CHUNK_BYTES));
        const appendResult = await invokeTauri<GameCliPreviewUploadAppendResult>("append_gamecli_preview_asset_chunk", {
          sessionId: session.sessionId,
          relativePath: asset.cartridgePath,
          offsetBytes: acknowledged,
          chunkBytes: uint8ArrayToNumberArray(chunk),
        });
        const expected = Math.min(offset + chunk.byteLength, asset.data.byteLength);
        acknowledged = appendResult.writtenBytes;
        if (acknowledged !== expected) {
          throw new Error(`Preview asset upload verification failed for ${asset.assetId}: ${acknowledged} / ${expected}.`);
        }
        completedBytes += chunk.byteLength;
        reportProgress(`Uploading preview asset: ${asset.assetId} (${acknowledged} / ${asset.data.byteLength} bytes)`);
      }
    }

    request.onProgress?.({ phase: "validate", percent: 88, message: "Generating checksum.json and validating preview directory." });
    const previewRoot = await invokeTauri<string>("finalize_gamecli_preview_directory", {
      sessionId: session.sessionId,
    });
    request.onProgress?.({ phase: "launch", percent: 100, message: "GameCLI directory preview started." });
    return { mode: "gamecli", message: `GameCLI directory preview root: ${previewRoot}` };
  } catch (error) {
    if (isMissingTauriCommand(error, "begin_gamecli_preview_directory")) {
      throw new Error("Current desktop host does not support fast directory preview. Please install the latest desktop build and try again.");
    }
    throw error;
  }
}

export async function closeGameCliPreview(): Promise<void> {
  if (!isTauriRuntime()) {
    const target = window.open("", "agentvn-gamecli-preview");
    target?.close();
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("close_gamecli_preview");
}
