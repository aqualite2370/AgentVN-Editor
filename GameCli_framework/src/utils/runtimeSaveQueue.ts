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
  const pending = new Set<Promise<SaveWriteBarrierResult>>();
  return {
    track<T>(operation: () => Promise<T>): Promise<T> {
      const write = Promise.resolve().then(operation);
      const settled = write.then<SaveWriteBarrierResult, SaveWriteBarrierResult>(
        () => ({ status: "saved" }),
        error => ({ status: "failed", message: error instanceof Error ? error.message : String(error) }),
      );
      pending.add(settled);
      void settled.then(() => pending.delete(settled));
      return write;
    },
    async wait(): Promise<SaveWriteBarrierResult> {
      let failed: SaveWriteBarrierResult | undefined;
      // Writes enqueued while draining also belong to the same exit barrier.
      while (pending.size > 0) {
        const results = await Promise.all([...pending]);
        failed ??= results.find(result => result.status === "failed");
      }
      return failed ?? { status: "saved" };
    },
  };
}
