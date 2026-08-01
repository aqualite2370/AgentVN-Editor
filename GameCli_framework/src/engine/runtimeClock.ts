export type RuntimeSuspensionReason =
  | "system-ui"
  | "focused-image"
  | "video"
  | "document-hidden"
  | string;

export class RuntimeClock {
  private readonly readRealNow: () => number;
  private segmentStartedReal: number;
  private logicalAtSegmentStart = 0;
  private pausedAtReal?: number;
  private rate = 1;
  private readonly suspensionReasons = new Set<RuntimeSuspensionReason>();

  constructor(readRealNow: () => number = () => performance.now()) {
    this.readRealNow = readRealNow;
    this.segmentStartedReal = readRealNow();
  }

  get paused(): boolean {
    return this.suspensionReasons.size > 0;
  }

  get reasons(): ReadonlySet<RuntimeSuspensionReason> {
    return this.suspensionReasons;
  }

  get playbackRate(): number {
    return this.rate;
  }

  now(): number {
    if (this.paused) return this.logicalAtSegmentStart;
    const elapsedReal = Math.max(0, this.readRealNow() - this.segmentStartedReal);
    return Math.max(0, this.logicalAtSegmentStart + elapsedReal * this.rate);
  }

  setSuspended(reason: RuntimeSuspensionReason, suspended: boolean): boolean {
    const wasPaused = this.paused;
    const logicalNow = this.now();
    if (suspended) this.suspensionReasons.add(reason);
    else this.suspensionReasons.delete(reason);
    const isPaused = this.paused;
    if (wasPaused === isPaused) return false;
    const realNow = this.readRealNow();
    this.logicalAtSegmentStart = logicalNow;
    this.segmentStartedReal = realNow;
    if (isPaused) {
      this.pausedAtReal = realNow;
    } else {
      this.pausedAtReal = undefined;
    }
    return true;
  }

  setPlaybackRate(rate: number): boolean {
    if (!Number.isFinite(rate) || rate <= 0 || rate > 4 || rate === this.rate) return false;
    const logicalNow = this.now();
    const realNow = this.readRealNow();
    this.logicalAtSegmentStart = logicalNow;
    this.segmentStartedReal = realNow;
    if (this.paused) this.pausedAtReal = realNow;
    this.rate = rate;
    return true;
  }

  reset(): void {
    const realNow = this.readRealNow();
    this.segmentStartedReal = realNow;
    this.logicalAtSegmentStart = 0;
    this.pausedAtReal = this.paused ? realNow : undefined;
    this.rate = 1;
  }
}

interface ScheduledRuntimeTask {
  owner: string;
  dueAt: number;
  callback: () => void;
  handle?: ReturnType<typeof setTimeout>;
}

export class RuntimeScheduler {
  private readonly tasks = new Map<string, ScheduledRuntimeTask>();

  constructor(readonly clock: RuntimeClock) {}

  schedule(owner: string, dueAt: number, callback: () => void): void {
    this.cancel(owner);
    const task: ScheduledRuntimeTask = { owner, dueAt, callback };
    this.tasks.set(owner, task);
    this.arm(task);
  }

  cancel(owner: string): void {
    const task = this.tasks.get(owner);
    if (!task) return;
    if (task.handle !== undefined) clearTimeout(task.handle);
    this.tasks.delete(owner);
  }

  cancelMatching(predicate: (owner: string) => boolean): void {
    for (const owner of [...this.tasks.keys()]) {
      if (predicate(owner)) this.cancel(owner);
    }
  }

  cancelAll(): void {
    for (const owner of [...this.tasks.keys()]) this.cancel(owner);
  }

  setSuspended(reason: RuntimeSuspensionReason, suspended: boolean): boolean {
    const changed = this.clock.setSuspended(reason, suspended);
    if (!changed) return false;
    if (this.clock.paused) {
      for (const task of this.tasks.values()) {
        if (task.handle !== undefined) clearTimeout(task.handle);
        task.handle = undefined;
      }
      return true;
    }
    for (const task of this.tasks.values()) this.arm(task);
    return true;
  }

  setPlaybackRate(rate: number): boolean {
    const changed = this.clock.setPlaybackRate(rate);
    if (!changed) return false;
    if (!this.clock.paused) {
      for (const task of this.tasks.values()) this.arm(task);
    }
    return true;
  }

  reset(): void {
    this.cancelAll();
    this.clock.reset();
  }

  private arm(task: ScheduledRuntimeTask): void {
    if (this.clock.paused) return;
    if (task.handle !== undefined) clearTimeout(task.handle);
    const delay = Math.max(0, task.dueAt - this.clock.now()) / this.clock.playbackRate;
    task.handle = setTimeout(() => {
      const current = this.tasks.get(task.owner);
      if (current !== task) return;
      this.tasks.delete(task.owner);
      task.handle = undefined;
      task.callback();
    }, delay);
  }
}
