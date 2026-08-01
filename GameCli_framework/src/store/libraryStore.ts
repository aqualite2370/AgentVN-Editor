import { create } from "zustand";
import type { InstalledCartridgeIndex, LibraryGame } from "../types/cartridge";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";

export interface LibraryImportProgress {
  stage: string;
  detail: string;
  startedAt: number;
  updatedAt: number;
}

interface LibraryStore {
  records: InstalledCartridgeIndex[];
  games: LibraryGame[];
  selectedInstallId?: string;
  loading: boolean;
  importing: boolean;
  importProgress?: LibraryImportProgress;
  message?: string;
  error?: string;
  initialize: () => Promise<void>;
  importFromDialog: () => Promise<LibraryGame | undefined>;
  importFromFile: (file: File) => Promise<LibraryGame | undefined>;
  loadGameByInstallId: (installId: string) => Promise<LibraryGame>;
  removeGame: (installId: string, deleteSaves?: boolean) => Promise<void>;
  selectGame: (installId: string) => void;
}

function upsertGame(games: LibraryGame[], game: LibraryGame): LibraryGame[] {
  return [game, ...games.filter((item) => item.install_id !== game.install_id)];
}

function createImportProgress(stage: string, detail: string, previous?: LibraryImportProgress): LibraryImportProgress {
  const now = Date.now();
  return {
    stage,
    detail,
    startedAt: previous?.startedAt ?? now,
    updatedAt: now,
  };
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  records: [],
  games: [],
  loading: false,
  importing: false,
  async initialize() {
    set({ loading: true, error: undefined });
    try {
      const { listInstalledCartridges } = await import("../cartridge/desktopLibrary");
      const records = await listInstalledCartridges();
      set({
        records,
        selectedInstallId: records[0]?.installId,
        loading: false,
        message: records.length ? undefined : "导入 .vncart 卡带后会出现在这里。",
      });
    } catch (error) {
      reportFrontendError("player.library", error, { operation: "initialize" });
      set({ loading: false, error: error instanceof Error ? error.message : "读取卡带库失败" });
    }
  },
  async importFromDialog() {
    if (get().importing) return undefined;
    set({
      importing: true,
      error: undefined,
      message: "等待选择卡带文件...",
      importProgress: createImportProgress("等待选择", "正在打开系统文件选择器。"),
    });
    try {
      const { selectCartridgePath, importCartridgeFromPath } = await import("../cartridge/desktopLibrary");
      const sourcePath = await selectCartridgePath();
      if (!sourcePath) {
        set({ importing: false, importProgress: undefined, message: "已取消导入。" });
        return undefined;
      }
      set((state) => ({
        message: "正在校验并复制卡带...",
        importProgress: createImportProgress("校验与复制", "正在解析 .vncart、校验脚本和写入本地库。", state.importProgress),
      }));
      const { index, game, duplicate } = await importCartridgeFromPath(sourcePath, get().records);
      const records = [index, ...get().records.filter((item) => item.installId !== index.installId)];
      set({
        records,
        games: upsertGame(get().games, game),
        selectedInstallId: index.installId,
        importing: false,
        importProgress: undefined,
        message: duplicate ? "已更新同一游戏同版本卡带。" : "卡带已导入游戏库。",
      });
      return game;
    } catch (error) {
      reportFrontendError("player.library", error, { operation: "import-from-dialog" });
      set({ importing: false, importProgress: undefined, error: error instanceof Error ? error.message : "导入卡带失败" });
      return undefined;
    }
  },
  async importFromFile(file) {
    if (get().importing) return undefined;
    set({
      importing: true,
      error: undefined,
      message: "正在校验并导入卡带...",
      importProgress: createImportProgress("校验与导入", `正在解析 ${file.name}，随后写入本地卡带库。`),
    });
    try {
      const { importCartridgeFromFile } = await import("../cartridge/desktopLibrary");
      const { index, game, duplicate } = await importCartridgeFromFile(file, get().records);
      const records = [index, ...get().records.filter((item) => item.installId !== index.installId)];
      set({
        records,
        games: upsertGame(get().games, game),
        selectedInstallId: index.installId,
        importing: false,
        importProgress: undefined,
        message: duplicate ? "已更新同一游戏同版本卡带。" : "卡带已导入游戏库。",
      });
      return game;
    } catch (error) {
      reportFrontendError("player.library", error, { operation: "import-from-file", fileName: file.name });
      set({ importing: false, importProgress: undefined, error: error instanceof Error ? error.message : "导入卡带失败" });
      return undefined;
    }
  },
  async loadGameByInstallId(installId) {
    const cached = get().games.find((game) => game.install_id === installId);
    if (cached) return cached;
    const record = get().records.find((item) => item.installId === installId);
    if (!record) throw new Error("未找到已安装卡带。");
    const { loadInstalledGame } = await import("../cartridge/desktopLibrary");
    const game = await loadInstalledGame(record);
    set({ games: upsertGame(get().games, game), selectedInstallId: installId, error: undefined });
    return game;
  },
  async removeGame(installId, deleteSaves = false) {
    try {
      const { removeInstalledCartridge } = await import("../cartridge/desktopLibrary");
      const records = await removeInstalledCartridge(installId, deleteSaves);
      set({
        records,
        games: get().games.filter((game) => game.install_id !== installId),
        selectedInstallId: get().selectedInstallId === installId ? records[0]?.installId : get().selectedInstallId,
        message: "卡带已从游戏库移除。",
        error: undefined,
      });
    } catch (error) {
      reportFrontendError("player.library", error, { operation: "remove", installId, deleteSaves });
      set({ error: error instanceof Error ? error.message : "删除卡带失败" });
    }
  },
  selectGame(installId) {
    set({ selectedInstallId: installId });
  },
}));
