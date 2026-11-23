export type NovelCardPosition = { x: number; y: number };
type PositionRecord = {
  schemaVersion: 1;
  projectId: string;
  position: NovelCardPosition | null;
};
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type NativePort = {
  read: (projectId: string) => Promise<unknown>;
  write: (projectId: string, position: NovelCardPosition | null) => Promise<unknown>;
};
export const novelCardPositionKey = (projectId: string) =>
  `agentvn.novelTask.position.${encodeURIComponent(projectId)}`;

function validateProjectId(projectId: string): void {
  if (!projectId.trim() || new TextEncoder().encode(projectId).length > 1024)
    throw new Error("CARD_POSITION_PROJECT_INVALID: 无效的工程标识。");
}
function point(value: unknown): NovelCardPosition | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || !("x" in value) || !("y" in value)
    || typeof value.x !== "number" || typeof value.y !== "number"
    || !Number.isFinite(value.x) || !Number.isFinite(value.y)
    || value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1)
    throw new Error("CARD_POSITION_RECORD_INVALID: 任务卡片位置数据无效。");
  return { x: value.x, y: value.y };
}
function record(value: unknown, projectId: string): PositionRecord {
  if (!value || typeof value !== "object" || !("schemaVersion" in value)
    || value.schemaVersion !== 1 || !("projectId" in value) || value.projectId !== projectId
    || !("position" in value))
    throw new Error("CARD_POSITION_RECORD_INVALID: 位置记录版本或工程归属不匹配。");
  return { schemaVersion: 1, projectId, position: point(value.position) };
}

export function createNovelCardPositionStore({ storage, native, onMirrorError }: {
  storage: StoragePort;
  native?: NativePort;
  onMirrorError?: (error: unknown) => void;
}) {
  // Shared by every mount of the card. A late read/migration cannot publish
  // after a later drag/reset for the same project. Different projects do not wait.
  const queues = new Map<string, Promise<unknown>>();
  function enqueue<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const pending = (queues.get(id) ?? Promise.resolve()).then(operation, operation);
    queues.set(id, pending);
    const release = () => { if (queues.get(id) === pending) queues.delete(id); };
    void pending.then(release, release);
    return pending;
  }
  function cached(projectId: string): NovelCardPosition | null {
    const bytes = storage.getItem(novelCardPositionKey(projectId));
    return bytes === null ? null : point(JSON.parse(bytes));
  }
  function mirror(projectId: string, position: NovelCardPosition | null) {
    const update = () => {
      if (position === null) storage.removeItem(novelCardPositionKey(projectId));
      else storage.setItem(novelCardPositionKey(projectId), JSON.stringify(position));
    };
    // Browser cache failure must not turn a successful native commit into a
    // claimed disk failure. Browser-only writes still fail normally.
    if (!native) update();
    else try { update(); } catch (error) { onMirrorError?.(error); }
  }
  async function commit(projectId: string, position: NovelCardPosition | null) {
    let committed = position;
    if (native) {
      const saved = record(await native.write(projectId, position), projectId);
      // Native f64 JSON transport can change a normalized coordinate's last
      // binary digit. Permit only machine precision, not a different position
      // (even 1e-12), null replacement, schema, or project identity.
      const same = position === null || saved.position === null ? saved.position === position
        : Math.abs(saved.position.x - position.x) <= Number.EPSILON
          && Math.abs(saved.position.y - position.y) <= Number.EPSILON;
      if (!same)
        throw new Error("CARD_POSITION_ACK_INVALID: 位置落盘确认与请求不匹配。");
      committed = saved.position;
    }
    mirror(projectId, committed);
  }
  return {
    isNative: Boolean(native),
    peek: cached,
    async read(projectId: string): Promise<NovelCardPosition | null> {
      validateProjectId(projectId);
      return enqueue(projectId, async () => {
        if (!native) return cached(projectId);
        const value = await native.read(projectId);
        if (value !== null) {
          const saved = record(value, projectId);
          mirror(projectId, saved.position);
          return saved.position;
        }
        const legacy = cached(projectId);
        if (legacy !== null) await commit(projectId, legacy);
        return legacy;
      });
    },
    async write(projectId: string, position: NovelCardPosition | null): Promise<void> {
      validateProjectId(projectId);
      const normalized = point(position);
      return enqueue(projectId, () => commit(projectId, normalized));
    },
  };
}

let defaultStore: ReturnType<typeof createNovelCardPositionStore> | undefined;
export function getNovelCardPositionStore() {
  if (!defaultStore) {
    const native: NativePort | undefined = "__TAURI_INTERNALS__" in window ? {
      async read(projectId) {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke("read_novel_task_card_position", { projectId });
      },
      async write(projectId, position) {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke("write_novel_task_card_position", { projectId, position });
      },
    } : undefined;
    defaultStore = createNovelCardPositionStore({ storage: window.localStorage, native,
      onMirrorError: error => {
        // Do not export local paths or payloads to AI; this is the existing
        // local diagnostic sink, loaded only on an actual mirror failure.
        void import("../../../shared/logging/frontendErrorLogger").then(({ reportFrontendError }) =>
          reportFrontendError("editor.novel-task", error, { operation: "mirror-card-position" }));
      } });
  }
  return defaultStore;
}
