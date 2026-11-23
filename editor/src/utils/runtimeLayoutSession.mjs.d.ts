export interface RuntimeLayoutSaveRequest<T> {
  requestId: number;
  version: number;
  projectKey: string;
  draft: T;
}

export interface RuntimeLayoutSessionState<T> {
  draft: T;
  savedSnapshot: T;
  history: {
    past: T[];
    future: T[];
  };
  dirty: boolean;
  projectKey: string;
  version: number;
  nextRequestId: number;
  pendingSave?: RuntimeLayoutSaveRequest<T>;
  clone: (value: T) => T;
  equals: (left: T, right: T) => boolean;
}

export declare function createRuntimeLayoutSession<T>(
  initialSnapshot: T,
  projectKey: string,
  clone: (value: T) => T,
  equals: (left: T, right: T) => boolean,
): RuntimeLayoutSessionState<T>;

export declare function editRuntimeLayoutSession<T>(
  session: RuntimeLayoutSessionState<T>,
  updater: (draft: T) => T,
): RuntimeLayoutSessionState<T>;

export declare function undoRuntimeLayoutSession<T>(
  session: RuntimeLayoutSessionState<T>,
): RuntimeLayoutSessionState<T>;

export declare function redoRuntimeLayoutSession<T>(
  session: RuntimeLayoutSessionState<T>,
): RuntimeLayoutSessionState<T>;

export declare function beginRuntimeLayoutSave<T>(
  session: RuntimeLayoutSessionState<T>,
): {
  session: RuntimeLayoutSessionState<T>;
  request: RuntimeLayoutSaveRequest<T>;
};

export declare function receiveRuntimeLayoutSnapshot<T>(
  session: RuntimeLayoutSessionState<T>,
  snapshot: T,
  metadata?: { projectKey?: string; requestId?: number; version?: number },
): { accepted: boolean; session: RuntimeLayoutSessionState<T> };

export declare function failRuntimeLayoutSave<T>(
  session: RuntimeLayoutSessionState<T>,
  requestId: number,
): RuntimeLayoutSessionState<T>;
