import { Clipboard, Library, RotateCcw } from "lucide-react";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { useRuntimeStore } from "../../store/runtimeStore";
import { Button } from "./Button";

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const runtimeMode = useRuntimeStore((state) => state.runtimeMode);
  const openLibrary = useRuntimeStore((state) => state.openLibrary);
  async function copyError() {
    await navigator.clipboard?.writeText(message).catch((error) => {
      reportFrontendError("player.clipboard", error, { operation: "copy-error-diagnostics" });
    });
  }
  return (
    <div className="error-view" role="alert">
      <span className="panel-kicker">GameCLI Error</span>
      <strong>卡带加载或运行失败</strong>
      <p>{message}</p>
      <small>请把这段诊断信息发送给开发者，并说明当前运行模式与操作步骤。</small>
      <div className="card-actions">
        {onRetry && <Button onClick={onRetry}><RotateCcw size={16} /> 重试</Button>}
        {runtimeMode === "library" && <Button variant="ghost" onClick={openLibrary}><Library size={16} /> 返回卡带库</Button>}
        <Button variant="ghost" onClick={() => void copyError()}><Clipboard size={16} /> 复制诊断</Button>
      </div>
    </div>
  );
}
