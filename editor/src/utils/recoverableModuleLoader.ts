import type { ComponentType } from "react";

/**
 * Keep successful loads shared with React.lazy, but retry a failed app-owned
 * import with a fresh URL: browsers remember network failures per module URL.
 */
export function recoverableComponentLoader<M, T extends ComponentType<any>>(
  load: () => Promise<M>,
  select: (module: M) => T,
) {
  let cached: Promise<{ default: T }> | undefined;
  let failedUrl: string | undefined;
  let retry = 0;
  return () => {
    if (cached) return cached;
    const request = failedUrl ? async (): Promise<M> => {
      const url = new URL(failedUrl!);
      url.searchParams.set("agentvn-retry", String(++retry));
      return import(/* @vite-ignore */ url.href);
    } : load;
    cached = request().then(module => {
      failedUrl = undefined;
      const component = select(module);
      if (!component) throw new Error("页面模块不完整，请重新安装当前版本。");
      return { default: component };
    }).catch(error => {
      cached = undefined;
      const match = error instanceof TypeError
        ? error.message.match(/Failed to fetch dynamically imported module:\s*(\S+)/) : null;
      if (match) {
        try {
          const url = new URL(match[1]);
          if (url.origin === window.location.origin
            && (/^\/src\/components\/.+\.tsx$/.test(url.pathname) || /^\/assets\/[^/]+\.js$/.test(url.pathname))) {
            failedUrl = url.href;
          }
        } catch { /* Preserve and report the original error. */ }
      }
      throw error;
    });
    return cached;
  };
}

export function awaitModuleLoad<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs = 30_000) {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => fail(new Error("页面载入超时，原页面已保留，请重试。")), timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", aborted);
    };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const aborted = () => fail(new DOMException("Navigation superseded", "AbortError"));
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    promise.then(value => { cleanup(); resolve(value); }, fail);
  });
}
