import {
  exportCustomComponentArchive,
  type CustomComponentArchiveItemInput,
  type ScannedCustomComponent,
} from "./customComponentArchive";
import type { CustomComponentDefinition } from "./customComponentMarkup";

const DATABASE_NAME = "agentvn-personal-component-library";
const DATABASE_VERSION = 1;
const STORE_NAME = "components";

export interface PersonalComponentRecord extends CustomComponentArchiveItemInput {
  id: string;
  name: string;
  definition: CustomComponentDefinition;
  createdAt: number;
  updatedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("当前运行环境不支持本机组件库存储。"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME))
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本机组件库。"));
    request.onblocked = () => reject(new Error("组件库升级被其他编辑器窗口阻止，请关闭旧窗口后重试。"));
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, done: (value: T) => void, fail: (error: unknown) => void) => void,
): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, mode);
    let result: T;
    let hasResult = false;
    let operationError: unknown;
    operation(tx.objectStore(STORE_NAME), (value) => { result = value; hasResult = true; },
      (error) => { operationError = error; try { tx.abort(); } catch {} });
    tx.oncomplete = () => {
      database.close();
      if (operationError !== undefined) reject(operationError);
      else if (hasResult) resolve(result!);
      else reject(new Error("组件库事务未返回结果。"));
    };
    tx.onerror = () => {
      database.close();
      reject(operationError ?? tx.error ?? new Error("组件库事务失败。"));
    };
    tx.onabort = () => {
      database.close();
      reject(operationError ?? tx.error ?? new Error("组件库事务已回滚。"));
    };
  });
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `component-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function listPersonalComponents(): Promise<PersonalComponentRecord[]> {
  return transaction("readonly", (store, done, fail) => {
    const request = store.getAll();
    request.onsuccess = () => done((request.result as PersonalComponentRecord[])
      .sort((a, b) => b.updatedAt - a.updatedAt));
    request.onerror = () => fail(request.error);
  });
}

export async function savePersonalComponent(
  value: Omit<PersonalComponentRecord, "createdAt" | "updatedAt">,
): Promise<PersonalComponentRecord> {
  const existing = (await listPersonalComponents()).find((item) => item.id === value.id);
  const now = Date.now();
  const record: PersonalComponentRecord = {
    ...value,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    assets: (value.assets ?? []).map((asset) => ({ ...asset, bytes: new Uint8Array(asset.bytes) })),
  };
  return transaction("readwrite", (store, done, fail) => {
    const request = store.put(record);
    request.onsuccess = () => done(record);
    request.onerror = () => fail(request.error);
  });
}

export function deletePersonalComponent(id: string): Promise<void> {
  return transaction("readwrite", (store, done, fail) => {
    const request = store.delete(id);
    request.onsuccess = () => done(undefined);
    request.onerror = () => fail(request.error);
  });
}

export async function importPersonalComponentCopies(
  imported: ScannedCustomComponent[],
): Promise<PersonalComponentRecord[]> {
  if (!imported.length) return [];
  const existing = await listPersonalComponents();
  const names = new Set(existing.map((item) => item.name.normalize("NFC").toLocaleLowerCase("zh-CN")));
  const now = Date.now();
  const copies = imported.map((component) => {
    const normalizeName = (value: string) => value.normalize("NFC").toLocaleLowerCase("zh-CN");
    let name = component.name;
    if (names.has(normalizeName(name))) {
      name = `${component.name}（副本）`;
      let suffix = 2;
      while (names.has(normalizeName(name))) {
        name = `${component.name}（副本 ${suffix}）`;
        suffix++;
      }
    }
    names.add(normalizeName(name));
    return {
      ...component,
      id: newId(),
      name,
      html: component.html,
      css: component.css,
      definition: structuredClone(component.definition),
      assets: component.assets.map((asset) => ({ ...asset, bytes: new Uint8Array(asset.bytes) })),
      createdAt: now,
      updatedAt: now,
    } satisfies PersonalComponentRecord;
  });
  return transaction("readwrite", (store, done, fail) => {
    let remaining = copies.length;
    for (const copy of copies) {
      const request = store.add(copy);
      request.onerror = () => fail(request.error ?? new Error("导入组件副本失败。"));
      request.onsuccess = () => {
        remaining--;
        if (remaining === 0) done(copies);
      };
    }
  });
}

export function exportPersonalComponentCopies(
  components: PersonalComponentRecord[],
): Promise<Uint8Array> {
  return exportCustomComponentArchive(components.map((component) => ({
    id: component.id,
    name: component.name,
    description: component.description,
    html: component.html,
    css: component.css,
    assets: component.assets,
  })));
}
