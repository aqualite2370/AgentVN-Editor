import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLibraryStore } from "../../store/libraryStore";
import { isTauriRuntime } from "../../utils/platform";
import { Button } from "../common/Button";

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${seconds % 60} 秒`;
}

function useImportHeartbeat(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
}

export function CartridgeImport() {
  const importFromDialog = useLibraryStore((state) => state.importFromDialog);
  const importFromFile = useLibraryStore((state) => state.importFromFile);
  const importing = useLibraryStore((state) => state.importing);
  const importProgress = useLibraryStore((state) => state.importProgress);
  const inputRef = useRef<HTMLInputElement>(null);
  useImportHeartbeat(importing);

  async function handleImportClick() {
    if (importing) return;
    if (isTauriRuntime()) {
      await importFromDialog();
      return;
    }
    inputRef.current?.click();
  }

  return (
    <section className="cartridge-import" aria-label="导入卡带">
      <div>
        <strong>导入新卡带</strong>
        <span>选择 `.vncart` 后会先校验脚本、资源和元数据，再加入本地卡带库。</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".vncart,.zip"
        className="visually-hidden"
        data-testid="web-cartridge-file"
        aria-label="选择 vncart 卡带文件"
        disabled={importing}
        onChange={(event) => {
          if (importing) return;
          const file = event.currentTarget.files?.[0];
          if (file) void importFromFile(file);
          event.currentTarget.value = "";
        }}
      />
      <Button variant="primary" onClick={() => void handleImportClick()} loading={importing} disabled={importing}>
        <Upload size={18} /> {importing ? "正在导入" : "选择 .vncart"}
      </Button>
      {importing && importProgress && (
        <div className="runtime-operation-heartbeat" role="status" aria-live="polite">
          <span className="runtime-operation-pulse" aria-hidden="true" />
          <div>
            <strong>{importProgress.stage}</strong>
            <span>{importProgress.detail}</span>
          </div>
          <small>已运行 {formatElapsed(Date.now() - importProgress.startedAt)}</small>
        </div>
      )}
    </section>
  );
}
