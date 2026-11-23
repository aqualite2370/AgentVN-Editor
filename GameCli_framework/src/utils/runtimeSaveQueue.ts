export interface SerialSaveQueue<T> {
  enqueue: (operation: () => Promise<T>) => Promise<T>;
  wait: () => Promise<T | undefined>;
}

/** Keeps save writes ordered while allowing a failed write to be retried. */
export function createSerialSaveQueue<T>(): SerialSaveQueue<T> {
  let tail: Promise<T | undefined> = Promise.resolve(undefined);
  let latestResult: T | undefined;

  return {
    enqueue(operation) {
      const current = tail.then(operation, operation).then((result) => {
        latestResult = result;
        return result;
      });
      tail = current.then(() => undefined, () => undefined);
      return current;
    },
    wait: async () => {
      await tail;
      return latestResult;
    },
  };
}

export type SaveWriteBarrierResult =
  | { status: "saved" }
  | { status: "failed"; message: string };

/** Includes all writes already underway, even if autosaving has been disabled. */
export function createSaveWriteBarrier() {
  const pending = new Map<Promise<SaveWriteBarrierResult>, number | undefined>();
  let retainedFailure: { owner: number; message: string } | undefined;
  let currentOwner: number | undefined;
  return {
    setOwner(owner: number) {
      currentOwner = owner;
      retainedFailure = undefined;
    },
    track<T>(
      operation: () => Promise<T>,
      options: { owner?: number; retainFailure?: boolean } = {},
    ): Promise<T> {
      const write = Promise.resolve().then(operation);
      const settled = write.then<SaveWriteBarrierResult, SaveWriteBarrierResult>(
        () => {
          if (options.retainFailure && options.owner === currentOwner) retainedFailure = undefined;
          return { status: "saved" };
        },
        error => {
          const message = error instanceof Error ? error.message : String(error);
          if (options.retainFailure && options.owner !== undefined && options.owner === currentOwner) {
            retainedFailure = { owner: options.owner, message };
          }
          return { status: "failed", message };
        },
      );
      pending.set(settled, options.owner);
      void settled.then(() => pending.delete(settled));
      return write;
    },
    async wait({ includeRetainedFailure = false } = {}): Promise<SaveWriteBarrierResult> {
      const owner = currentOwner;
      let failed: SaveWriteBarrierResult | undefined;
      // Writes enqueued while draining also belong to the same exit barrier.
      while (pending.size > 0) {
        const results = await Promise.all([...pending].map(async ([write, writeOwner]) => ({
          owner: writeOwner,
          result: await write,
        })));
        failed ??= results.find(entry =>
          (entry.owner === undefined || entry.owner === owner) && entry.result.status === "failed"
        )?.result;
      }
      if (includeRetainedFailure && retainedFailure && retainedFailure.owner === owner) {
        return { status: "failed", message: retainedFailure.message };
      }
      return failed ?? { status: "saved" };
    },
  };
}
