import { Play, RefreshCw, Settings, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { useLibraryStore } from "../../store/libraryStore";
import { useRuntimeStore } from "../../store/runtimeStore";
import type { LibraryGame } from "../../types/cartridge";
import { shellBackgroundStyle } from "../../utils/backgroundFit";
import { toRuntimeAssetUrl } from "../../utils/runtimeAssetUrl";
import { Button } from "../common/Button";
import { Modal } from "../common/Modal";
import { CartridgeImport } from "./CartridgeImport";

function displayLanguage(language?: string) {
  if (!language) return "未知语言";
  if (language.toLowerCase().startsWith("zh")) return "中文";
  return language;
}

function cartridgeInitials(title: string) {
  return title.trim().slice(0, 2).toUpperCase() || "VN";
}

function resolveGameAsset(game: LibraryGame | undefined, assetId?: string): string | undefined {
  if (!game || !assetId) return undefined;
  const assetPath = game.manifest.assets.find((asset) => asset.asset_id === assetId)?.path;
  return toRuntimeAssetUrl(game.assetUrls[assetId] ?? (assetPath ? game.assetUrls[assetPath] : undefined));
}

export function GameLibrary() {
  const records = useLibraryStore((state) => state.records);
  const games = useLibraryStore((state) => state.games);
  const loading = useLibraryStore((state) => state.loading);
  const importing = useLibraryStore((state) => state.importing);
  const message = useLibraryStore((state) => state.message);
  const error = useLibraryStore((state) => state.error);
  const selectedInstallId = useLibraryStore((state) => state.selectedInstallId);
  const selectGame = useLibraryStore((state) => state.selectGame);
  const loadGameByInstallId = useLibraryStore((state) => state.loadGameByInstallId);
  const removeGame = useLibraryStore((state) => state.removeGame);
  const importFromDialog = useLibraryStore((state) => state.importFromDialog);
  const initialize = useLibraryStore((state) => state.initialize);
  const loadGame = useRuntimeStore((state) => state.loadGame);
  const openSettings = useRuntimeStore((state) => state.openSettings);
  const [launchingId, setLaunchingId] = useState<string>();
  const [removeTarget, setRemoveTarget] = useState<string>();

  const selected = useMemo(
    () => records.find((record) => record.installId === selectedInstallId) ?? records[0],
    [records, selectedInstallId],
  );
  const gamesByInstallId = useMemo(() => new Map(games.map((game) => [game.install_id, game])), [games]);
  const selectedGame = selected ? gamesByInstallId.get(selected.installId) : undefined;
  const selectedCoverUrl = resolveGameAsset(selectedGame, selectedGame?.manifest.cover ?? selected?.coverAssetId);
  const selectedIconUrl = resolveGameAsset(selectedGame, selectedGame?.manifest.shell?.icon ?? selectedGame?.manifest.cover ?? selected?.coverAssetId);
  const selectedBackgroundUrl = resolveGameAsset(selectedGame, selectedGame?.manifest.shell?.background);

  useEffect(() => {
    if (!selected || selectedGame) return;
    void loadGameByInstallId(selected.installId).catch((error) => {
      reportFrontendError("player.library", error, {
        operation: "auto-load-selected-cartridge",
        installId: selected.installId,
      });
    });
  }, [loadGameByInstallId, selected, selectedGame]);

  async function launch(installId: string) {
    setLaunchingId(installId);
    try {
      const game = await loadGameByInstallId(installId);
      await loadGame(game);
    } finally {
      setLaunchingId(undefined);
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    await removeGame(removeTarget);
    setRemoveTarget(undefined);
  }

  return (
    <main className="library-shell" data-testid="game-state-library">
      <header className="library-topbar">
        <div>
          <span>GameCLI 卡带容器</span>
          <h1>卡带库</h1>
        </div>
        <nav aria-label="卡带库操作">
          <Button onClick={() => void initialize()} loading={loading}><RefreshCw size={17} /> 刷新</Button>
          <Button onClick={openSettings}><Settings size={17} /> 设置</Button>
          <Button variant="primary" onClick={() => void importFromDialog()} loading={importing}><Upload size={17} /> 导入卡带</Button>
        </nav>
      </header>

      <section className="library-workbench">
        <div className="cartridge-rail" aria-label="已安装卡带">
          <CartridgeImport />
          {error && <p className="inline-error" role="alert">{error}</p>}
          {message && !error && <p className="inline-note">{message}</p>}
          {records.length === 0 ? (
            <div className="library-empty">
              <strong>{loading ? "正在读取卡带库" : "还没有安装卡带"}</strong>
              <span>导入 `.vncart` 后，GameCLI 会校验卡带并保存到本地库。每张卡带拥有独立存档、历史和画廊记录。</span>
            </div>
          ) : (
            <div className="cartridge-list">
              {records.map((record) => {
                const game = gamesByInstallId.get(record.installId);
                const iconUrl = resolveGameAsset(game, game?.manifest.shell?.icon ?? game?.manifest.cover ?? record.coverAssetId);
                return (
                  <button
                    type="button"
                    className={`cartridge-spine ${record.installId === selected?.installId ? "active" : ""}`}
                    key={record.installId}
                    aria-pressed={record.installId === selected?.installId}
                    onClick={() => selectGame(record.installId)}
                  >
                    <span className={iconUrl ? "has-cartridge-icon" : ""}>
                      {iconUrl ? <img src={iconUrl} alt="" aria-hidden="true" /> : cartridgeInitials(record.title)}
                    </span>
                    <strong>{record.title}</strong>
                    <small>{record.author || "未知作者"} / v{record.version}</small>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <aside className={`launch-panel${selectedBackgroundUrl ? " has-cartridge-background" : ""}`} style={shellBackgroundStyle(selectedBackgroundUrl, selectedGame?.manifest.shell?.background_fit)} aria-label="卡带详情">
          {selected ? (
            <>
              <div className={`cover-preview cartridge-cover${selectedCoverUrl ? " has-cover-image" : ""}`} aria-hidden="true">
                {selectedCoverUrl ? <img className="cartridge-cover-image" src={selectedCoverUrl} alt="" /> : <span>{cartridgeInitials(selected.title)}</span>}
                {selectedIconUrl && <img className="cartridge-cover-icon" src={selectedIconUrl} alt="" />}
                <i />
              </div>
              <div className="launch-copy">
                <span>{displayLanguage(selected.language)} / v{selected.version}</span>
                <h2>{selected.title}</h2>
                <p>{selected.description || "这张卡带没有提供简介。启动后可从标题页进入游戏。"}</p>
              </div>
              <dl className="meta-grid">
                <dt>作者</dt><dd>{selected.author || "未知作者"}</dd>
                <dt>导入时间</dt><dd>{new Date(selected.installedAt).toLocaleString()}</dd>
                <dt>来源文件</dt><dd>{selected.sourceFileName ?? "game.vncart"}</dd>
              </dl>
              <div className="launch-actions">
                <Button variant="primary" onClick={() => void launch(selected.installId)} loading={launchingId === selected.installId}><Play size={19} /> 启动卡带</Button>
                <Button variant="ghost" onClick={() => setRemoveTarget(selected.installId)}><Trash2 size={17} /> 移除</Button>
              </div>
            </>
          ) : (
            <div className="library-empty">
              <strong>选择一张卡带</strong>
              <span>右侧会显示版本、来源和启动操作。</span>
            </div>
          )}
        </aside>
      </section>

      {removeTarget && (
        <Modal title="移除卡带" onClose={() => setRemoveTarget(undefined)}>
          <p>这会从 GameCLI 卡带库移除当前卡带。已有存档默认保留，之后重新导入同一张卡带仍可继续读取。</p>
          <div className="modal-actions">
            <Button variant="ghost" onClick={() => setRemoveTarget(undefined)}>取消</Button>
            <Button variant="primary" onClick={() => void confirmRemove()}><Trash2 size={16} /> 确认移除</Button>
          </div>
        </Modal>
      )}
    </main>
  );
}
