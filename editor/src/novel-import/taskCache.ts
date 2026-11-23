import type { NovelPersistenceState } from "./types";

const databaseName = "agentvn-novel-task-cache";
const storeName = "projects";
const smallCacheLimit = 512 * 1024;
const pending = new Map<string, Promise<unknown>>();
// A stream may publish a complete snapshot every frame while IndexedDB is
// slower. Keep one active write and one latest pending snapshot per project,
// rather than a promise chain retaining every large serialized intermediate.
const queuedWrites = new Map<string, { key: string; serialized: string; promise: Promise<void> }>();
export const novelTaskCacheKey = (id: string) => `agentvn.novelProcessing.persistence.${encodeURIComponent(id)}`;

function serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const next = (pending.get(id) ?? Promise.resolve()).catch(() => undefined).then(operation);
  pending.set(id, next);
  void next.finally(() => { if (pending.get(id) === next) pending.delete(id); }).catch(() => undefined);
  return next;
}

async function databaseOperation<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  if (typeof indexedDB === "undefined") throw new Error("当前环境无法使用大型任务缓存。");
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    let rejected = false;
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = () => reject(request.error ?? new Error("任务缓存打开失败。"));
    request.onblocked = () => { rejected = true; reject(new Error("任务缓存升级被其他窗口阻止。")); };
    request.onsuccess = () => {
      if (rejected) request.result.close();
      else resolve(request.result);
    };
  });
  return new Promise<T>((resolve, reject) => {
    try {
      const transaction = db.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      transaction.oncomplete = () => { db.close(); resolve(request.result); };
      transaction.onabort = () => { db.close(); reject(transaction.error ?? request.error ?? new Error("任务缓存事务中止。")); };
      transaction.onerror = () => { /* The abort handler owns failure and connection cleanup. */ };
    } catch (error) { db.close(); reject(error); }
  });
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

export function readSmallNovelTaskCache<T = NovelPersistenceState>(id: string, key = novelTaskCacheKey(id)): T | undefined {
  const raw = window.localStorage.getItem(key);
  if (!raw) return undefined;
  const parsed = JSON.parse(raw);
  return parsed?.storage === "indexeddb" ? undefined : parsed as T;
}

/** Full snapshots stay lossless; localStorage holds only a locator for large novels. */
export function writeNovelTaskCache<T>(id: string, value: T, key = novelTaskCacheKey(id)): Promise<void> {
  const serialized = JSON.stringify(value);
  const queued = queuedWrites.get(id);
  if (queued?.key === key) {
    queued.serialized = serialized;
    return queued.promise;
  }
  const entry = { key, serialized, promise: undefined as unknown as Promise<void> };
  entry.promise = serial(id, async () => {
    if (queuedWrites.get(id) === entry) queuedWrites.delete(id);
    const serialized = entry.serialized;
    entry.serialized = "";
    if (serialized.length <= smallCacheLimit) {
      try { window.localStorage.setItem(key, serialized); return; }
      catch (error) { if (!isQuotaError(error)) throw error; }
    }
    await databaseOperation("readwrite", store => store.put(serialized, id));
    const marker = JSON.stringify({ storage: "indexeddb", version: 1, projectId: id });
    try { window.localStorage.setItem(key, marker); }
    catch (error) {
      if (!isQuotaError(error)) throw error;
      // Replace only this project's stale small cache, after the full transaction
      // commits. Other projects, history, and credentials are never evicted.
      window.localStorage.removeItem(key);
      try { window.localStorage.setItem(key, marker); }
      catch (retryError) { if (!isQuotaError(retryError)) throw retryError; }
    }
  });
  queuedWrites.set(id, entry);
  return entry.promise;
}

export function readLargeNovelTaskCache<T = NovelPersistenceState>(id: string, key = novelTaskCacheKey(id)): Promise<T | undefined> {
  // Reads and explicit clearing are ordering barriers. A later write must not
  // replace a snapshot that this read is supposed to observe.
  queuedWrites.delete(id);
  return serial(id, async () => {
    // A queued newer small snapshot supersedes an older large one.
    const small = readSmallNovelTaskCache<T>(id, key);
    if (small) return small;
    const serialized = await databaseOperation("readonly", store => store.get(id));
    return typeof serialized === "string" ? JSON.parse(serialized) as T : undefined;
  });
}

export function readNovelTaskCacheCopies(id: string): Promise<Array<NovelPersistenceState | undefined>> {
  queuedWrites.delete(id);
  return serial(id, async () => {
    const small = readSmallNovelTaskCache(id);
    // The IndexedDB transaction can finish before localStorage's locator is
    // replaced. Look in both stores when recovering missing paid receipts.
    const serialized = await databaseOperation("readonly", store => store.get(id));
    return [small, typeof serialized === "string" ? JSON.parse(serialized) as NovelPersistenceState : undefined];
  });
}

export function clearNovelTaskCache(id: string): Promise<void> {
  queuedWrites.delete(id);
  return serial(id, async () => {
    await databaseOperation("readwrite", store => store.delete(id));
    window.localStorage.removeItem(novelTaskCacheKey(id));
  });
}
