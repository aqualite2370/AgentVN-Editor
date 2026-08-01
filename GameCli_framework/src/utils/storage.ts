import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";

export interface StorageAdapter {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
}

export const localStorageAdapter: StorageAdapter = {
  get<T>(key: string, fallback: T): T {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      reportFrontendError("player.storage", error, { operation: "read", key });
      return fallback;
    }
  },
  set<T>(key: string, value: T): void {
    window.localStorage.setItem(key, JSON.stringify(value));
  },
  remove(key: string): void {
    window.localStorage.removeItem(key);
  }
};
