import type { AssetStudioProjectCache, ImageGenerationJob } from "./types";

const databaseName = "agentvn-asset-studio";
const databaseVersion = 1;
const storeName = "project-cache";
const fallbackPrefix = "agentvn.assetStudio.cache.";
const maxHistoryItems = 500;
const unsavedOutputTtlMs = 7 * 24 * 60 * 60 * 1000;
const maxUnsavedOutputBytes = 512 * 1024 * 1024;

function estimatedDataUrlBytes(value: string): number {
  if (!value.startsWith("data:")) return value.length * 2;
  const comma = value.indexOf(",");
  const payloadLength = comma >= 0 ? value.length - comma - 1 : value.length;
  return Math.ceil(payloadLength * 0.75);
}

function enforceOutputBudget(jobs: ImageGenerationJob[]): ImageGenerationJob[] {
  let usedBytes = 0;
  return jobs.map((job) => ({
    ...job,
    candidates: job.candidates.map((candidate) => {
      const bytes = estimatedDataUrlBytes(candidate.blob_url);
      if (!candidate.blob_url || usedBytes + bytes <= maxUnsavedOutputBytes) {
        usedBytes += bytes;
        return candidate;
      }
      return {
        ...candidate,
        blob_url: "",
        canSave: false,
        saveBlockedReason: "未保存结果已超出本项目 512MB 缓存上限；元数据仍保留，可恢复配方后重新生成。",
      };
    }),
  }));
}

function stripExpiredOutputs(jobs: ImageGenerationJob[]): ImageGenerationJob[] {
  const now = Date.now();
  return jobs.slice(0, maxHistoryItems).map((job) => {
    const finishedAt = Date.parse(job.finishedAt ?? job.queuedAt);
    if (!Number.isFinite(finishedAt) || now - finishedAt <= unsavedOutputTtlMs) return job;
    return {
      ...job,
      candidates: job.candidates.map((candidate) => ({
        ...candidate,
        blob_url: "",
        canSave: false,
        saveBlockedReason: "未保存结果的本地缓存已过期，可恢复配方后重新生成。",
      })),
    };
  });
}

function interruptedJobs(jobs: ImageGenerationJob[]): ImageGenerationJob[] {
  return jobs.map((job) =>
    job.status === "running" || job.status === "validating"
      ? {
          ...job,
          status: "interrupted",
          progress: 0,
          phase: "应用上次关闭时任务仍在运行，可恢复配方后重试。",
          finishedAt: new Date().toISOString(),
        }
      : job
  );
}

function fallbackCache(cache: AssetStudioProjectCache): AssetStudioProjectCache {
  return {
    ...cache,
    jobs: cache.jobs.map((job) => ({
      ...job,
      candidates: job.candidates.map((candidate) => ({ ...candidate, blob_url: "" })),
    })),
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName, { keyPath: "projectId" });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function loadAssetStudioCache(projectId: string): Promise<AssetStudioProjectCache | undefined> {
  if (typeof indexedDB === "undefined") {
    const raw = localStorage.getItem(`${fallbackPrefix}${projectId}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as AssetStudioProjectCache;
    return { ...parsed, jobs: interruptedJobs(stripExpiredOutputs(parsed.jobs)) };
  }
  try {
    const database = await openDatabase();
    const value = await new Promise<AssetStudioProjectCache | undefined>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(projectId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as AssetStudioProjectCache | undefined);
    });
    database.close();
    return value ? { ...value, jobs: interruptedJobs(stripExpiredOutputs(value.jobs)) } : undefined;
  } catch {
    const raw = localStorage.getItem(`${fallbackPrefix}${projectId}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as AssetStudioProjectCache;
    return { ...parsed, jobs: interruptedJobs(stripExpiredOutputs(parsed.jobs)) };
  }
}

export async function saveAssetStudioCache(cache: AssetStudioProjectCache): Promise<void> {
  const trimmed = { ...cache, jobs: enforceOutputBudget(stripExpiredOutputs(cache.jobs)) };
  if (typeof indexedDB === "undefined") {
    localStorage.setItem(`${fallbackPrefix}${cache.projectId}`, JSON.stringify(fallbackCache(trimmed)));
    return;
  }
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
      transaction.objectStore(storeName).put(trimmed);
    });
    database.close();
  } catch {
    localStorage.setItem(`${fallbackPrefix}${cache.projectId}`, JSON.stringify(fallbackCache(trimmed)));
  }
}

export async function clearAssetStudioOutputs(projectId: string): Promise<void> {
  const cache = await loadAssetStudioCache(projectId);
  if (!cache) return;
  await saveAssetStudioCache({
    ...cache,
    jobs: cache.jobs.map((job) => ({
      ...job,
      candidates: job.candidates.map((candidate) => ({
        ...candidate,
        blob_url: "",
        canSave: false,
        saveBlockedReason: "未保存结果缓存已被清理。",
      })),
    })),
    savedAt: new Date().toISOString(),
  });
}
