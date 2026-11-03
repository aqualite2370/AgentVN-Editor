import JSZip from "jszip";
import type { EditorProjectFile } from "../types/nodes";
import type { AssetRef } from "../types/assets";

const zipMagic = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Blob(blob: Blob): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())));
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new Error(`PROJECT_CONTAINER_INVALID: ${label} 不是严格 UTF-8。`);
  }
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function safeZipPath(value: string): string {
  if (
    !value
    || value.includes("\0")
    || value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z]:/.test(value)
    || value.split("/").some((part) => part === "..")
  ) {
    throw new Error(`PROJECT_ZIP_PATH_UNSAFE: ${value || "<empty>"}`);
  }
  const normalized = value.replace(/^\/+/, "");
  if (!normalized.startsWith("assets/")) throw new Error(`PROJECT_ZIP_PATH_UNSAFE: ${value}`);
  return normalized;
}

function defaultProjectPath(asset: AssetRef): string {
  const safe = (value: string) => value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
  const filename = safe(asset.metadata?.filename || `${asset.asset_id}.bin`);
  return `assets/${safe(asset.asset_type)}/${safe(asset.asset_id)}-${filename}`;
}

async function readAssetBlob(asset: AssetRef): Promise<Blob> {
  const metadata = asset.metadata ?? {};
  const sources = [
    metadata.data_url?.startsWith("data:") ? metadata.data_url : undefined,
    metadata.blob_url?.startsWith("blob:") ? metadata.blob_url : undefined,
    metadata.url || undefined,
  ].filter((value): value is string => Boolean(value));
  const failures: string[] = [];
  for (const source of sources) {
    try {
      const response = await fetch(source, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.blob();
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (metadata.filePath && isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const bytes = await invoke<number[]>("read_project_asset_file_bytes", { filePath: metadata.filePath });
      return new Blob([new Uint8Array(bytes)], { type: metadata.mime_type || "application/octet-stream" });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`没有可读取的素材来源${failures.length ? `：${failures.join("；")}` : ""}`);
}

function portableAsset(
  asset: AssetRef,
  projectPath: string,
  integrity?: { sizeBytes: number; hashSha256: string; mimeType?: string },
): AssetRef {
  return {
    ...asset,
    metadata: {
      ...asset.metadata,
      project_path: projectPath,
      path: projectPath,
      size_bytes: integrity?.sizeBytes ?? asset.metadata?.size_bytes,
      hash_sha256: integrity?.hashSha256 ?? asset.metadata?.hash_sha256,
      mime_type: integrity?.mimeType || asset.metadata?.mime_type,
      data_url: undefined,
      blob_url: undefined,
      filePath: undefined,
      url: undefined,
      backend_asset_path: undefined,
    },
  };
}

export function isProjectZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && zipMagic.every((value, index) => bytes[index] === value);
}

export async function writeNativeProjectBundle(
  project: EditorProjectFile,
  fileName: string,
  outputDirectory?: string,
): Promise<string | undefined> {
  if (!isTauriRuntime()) return undefined;
  const assets = Array.isArray(project.asset_manifest) ? project.asset_manifest as AssetRef[] : [];
  const seen = new Set<string>();
  const { invoke } = await import("@tauri-apps/api/core");
  const stagedUploadIds: string[] = [];
  try {
    const portableAssets = [];
    for (const asset of assets) {
      const projectPath = safeZipPath(asset.metadata?.project_path || defaultProjectPath(asset));
      if (seen.has(projectPath)) throw new Error(`PROJECT_ZIP_PATH_UNSAFE: duplicate entry ${projectPath}`);
      seen.add(projectPath);
      const filePathReadable = asset.metadata?.filePath
        ? await invoke<boolean>("project_asset_file_is_readable", { filePath: asset.metadata.filePath })
        : false;
      if (asset.metadata?.filePath && filePathReadable) {
        portableAssets.push({
          zipPath: projectPath,
          filePath: asset.metadata.filePath,
          temporary: false,
          asset,
          projectPath,
        });
        continue;
      }
      const blob = await readAssetBlob(asset);
      const upload = await invoke<{ uploadId: string; path: string }>("begin_project_bundle_asset_upload", {
        fileName: asset.metadata?.filename || `${asset.asset_id}.bin`,
      });
      stagedUploadIds.push(upload.uploadId);
      const chunkSize = 4 * 1024 * 1024;
      let offset = 0;
      while (offset < blob.size) {
        const chunk = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
        offset = await invoke<number>("append_project_bundle_asset_chunk", {
          uploadId: upload.uploadId,
          offset,
          chunkBytes: Array.from(chunk),
        });
      }
      portableAssets.push({
        zipPath: projectPath,
        filePath: upload.path,
        temporary: true,
        asset,
        projectPath,
      });
    }
    const portableProject: EditorProjectFile = {
      ...project,
      asset_manifest: portableAssets.map(({ asset, projectPath }) => portableAsset(asset, projectPath)),
    };
    const result = await invoke<{ outputPath: string }>("write_project_bundle", {
      fileName,
      outputDirectory: outputDirectory || null,
      projectJson: JSON.stringify(portableProject, null, 2),
      assets: portableAssets.map(({ zipPath, filePath, temporary }) => ({ zipPath, filePath, temporary })),
    });
    return result.outputPath;
  } finally {
    await Promise.all(stagedUploadIds.map(async (uploadId) => {
      try {
        await invoke("cleanup_project_bundle_asset_upload", { uploadId });
      } catch {
        // The Rust writer removes successful staging files itself.
      }
    }));
  }
}

export async function buildProjectBundle(
  project: EditorProjectFile,
  onProgress?: (message: string, completed: number, total: number) => void,
): Promise<Blob> {
  const zip = new JSZip();
  const assets = Array.isArray(project.asset_manifest) ? project.asset_manifest as AssetRef[] : [];
  const portableAssets: AssetRef[] = [];
  const integrity: Array<{ path: string; sizeBytes: number; hashSha256: string }> = [];
  const seen = new Set<string>();
  let completed = 0;
  for (const asset of assets) {
    const projectPath = safeZipPath(asset.metadata?.project_path || defaultProjectPath(asset));
    if (seen.has(projectPath)) throw new Error(`PROJECT_ZIP_PATH_UNSAFE: duplicate entry ${projectPath}`);
    seen.add(projectPath);
    onProgress?.(`准备素材：${asset.asset_id}`, completed, assets.length);
    const blob = await readAssetBlob(asset);
    const hashSha256 = await sha256Blob(blob);
    zip.file(projectPath, blob, { binary: true, compression: "STORE", createFolders: true });
    portableAssets.push(portableAsset(asset, projectPath, {
      sizeBytes: blob.size,
      hashSha256,
      mimeType: blob.type || asset.metadata?.mime_type,
    }));
    integrity.push({ path: projectPath, sizeBytes: blob.size, hashSha256 });
    completed += 1;
    onProgress?.(`已加入素材：${asset.asset_id}`, completed, assets.length);
  }
  const projectJson: EditorProjectFile = {
    ...project,
    asset_manifest: portableAssets,
  };
  const projectText = JSON.stringify(projectJson, null, 2);
  const projectHashSha256 = bytesToHex(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(projectText),
  )));
  zip.file("project.json", projectText);
  zip.file("format.json", JSON.stringify({
    format: "agentvn-vnproj-zip",
    version: 1,
    assetCount: portableAssets.length,
    totalAssetBytes: integrity.reduce((total, item) => total + item.sizeBytes, 0),
    projectHashSha256,
    assets: integrity,
    createdAt: new Date().toISOString(),
  }, null, 2));
  return await zip.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level: 3 }, streamFiles: true },
    (metadata) => onProgress?.("正在写入工程包", completed + Math.round(metadata.percent / 100), assets.length + 1),
  );
}

export async function readProjectJsonFromBundle(file: File): Promise<EditorProjectFile> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: true });
  for (const [name, zipEntry] of Object.entries(zip.files)) {
    if (
      name.includes("\\")
      || name.startsWith("/")
      || /^[A-Za-z]:/.test(name)
      || name.split("/").some((part) => part === "..")
      || (typeof zipEntry.unixPermissions === "number" && (zipEntry.unixPermissions & 0o170000) === 0o120000)
    ) {
      throw new Error(`PROJECT_ZIP_PATH_UNSAFE: ${name}`);
    }
  }
  const entry = zip.file("project.json");
  if (!entry) throw new Error("PROJECT_CONTAINER_INVALID: missing project.json");
  const project = JSON.parse(decodeUtf8(await entry.async("uint8array"), "project.json")) as EditorProjectFile;
  const formatEntry = zip.file("format.json");
  if (formatEntry) {
    JSON.parse(decodeUtf8(await formatEntry.async("uint8array"), "format.json"));
  }
  const assets = Array.isArray(project.asset_manifest) ? project.asset_manifest as AssetRef[] : [];
  const seen = new Set<string>();
  for (const asset of assets) {
    const projectPath = asset.metadata?.project_path;
    if (!projectPath) throw new Error(`PROJECT_ASSET_MISSING: ${asset.asset_id}`);
    safeZipPath(projectPath);
    if (seen.has(projectPath)) throw new Error(`PROJECT_ZIP_PATH_UNSAFE: duplicate entry ${projectPath}`);
    seen.add(projectPath);
    const assetEntry = zip.file(projectPath);
    if (!assetEntry) throw new Error(`PROJECT_ASSET_MISSING: ${projectPath}`);
    const bytes = await assetEntry.async("uint8array");
    const hashInput = Uint8Array.from(bytes).buffer;
    const actualHash = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", hashInput)));
    if (asset.metadata?.size_bytes !== undefined && asset.metadata.size_bytes !== bytes.byteLength) {
      throw new Error(`PROJECT_ASSET_HASH_MISMATCH: ${projectPath} size`);
    }
    if (asset.metadata?.hash_sha256 && asset.metadata.hash_sha256.toLowerCase() !== actualHash) {
      throw new Error(`PROJECT_ASSET_HASH_MISMATCH: ${projectPath}`);
    }
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    const base64 = btoa(binary);
    const mime = asset.metadata?.mime_type || "application/octet-stream";
    asset.metadata = {
      ...asset.metadata,
      size_bytes: bytes.byteLength,
      hash_sha256: actualHash,
      data_url: `data:${mime};base64,${base64}`,
      blob_url: undefined,
      filePath: undefined,
      url: undefined,
      backend_asset_path: undefined,
    };
  }
  return project;
}
