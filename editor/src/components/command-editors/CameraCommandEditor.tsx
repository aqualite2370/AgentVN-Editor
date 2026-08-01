import { Clapperboard, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { CameraCommand, GameCommand } from "../../types/commands";
import {
  isLegacyCameraCommand,
  isStructuredCameraCommand,
  type StructuredCameraCommand,
} from "../../../../shared/camera/cameraMotion";
import { convertibleLegacyCamera } from "../../utils/cameraLegacyConversion";
import { CameraStudioDialog } from "./CameraStudioDialog";

export function CameraCommandEditor({
  command,
  commands,
  commandIndex,
  sceneId,
  onChange,
}: {
  command: CameraCommand;
  commands: GameCommand[];
  commandIndex: number;
  sceneId: string;
  onChange: (command: CameraCommand) => void;
}) {
  const [studioCommand, setStudioCommand] = useState<StructuredCameraCommand>();
  if (isStructuredCameraCommand(command)) {
    return (
      <div className="camera-command-editor">
        <div>
          <Clapperboard size={18} aria-hidden="true" />
          <span>
            <strong>结构化运镜</strong>
            <small>在独立工作室里调整构图、节奏和真实演出预览。</small>
          </span>
        </div>
        <button type="button" onClick={() => setStudioCommand(structuredClone(command))}>打开运镜工作室</button>
        {studioCommand && (
          <CameraStudioDialog
            command={studioCommand}
            commands={commands}
            commandIndex={commandIndex}
            sceneId={sceneId}
            onApply={(next) => {
              onChange(next);
              setStudioCommand(undefined);
            }}
            onClose={() => setStudioCommand(undefined)}
          />
        )}
      </div>
    );
  }

  if (!isLegacyCameraCommand(command)) {
    return <p className="camera-command-warning">这条镜头设置不完整，请删除后重新添加运镜。</p>;
  }

  const convertible = convertibleLegacyCamera(command);
  return (
    <div className="legacy-camera-command-editor">
      <header>
        <RotateCcw size={17} aria-hidden="true" />
        <span>
          <strong>旧版镜头效果</strong>
          <small>继续按旧版方式播放，不会自动改变作品表现。</small>
        </span>
      </header>
      <label>
        旧版动作名称
        <input value={command.action} onChange={(event) => onChange({ ...command, action: event.target.value })} />
      </label>
      <label>
        旧版参数
        <textarea
          value={JSON.stringify(command.params, null, 2)}
          onChange={(event) => {
            try {
              onChange({ ...command, params: JSON.parse(event.target.value) as typeof command.params });
            } catch {
              // error-log-ignore: 作者输入 JSON 的过程中允许暂时不完整，继续保留上次有效值。
              // Keep the last valid value while the author is still typing.
            }
          }}
        />
      </label>
      <label className="camera-check-row">
        <input type="checkbox" checked={command.blocking} onChange={(event) => onChange({ ...command, blocking: event.target.checked })} />
        等旧版效果结束再继续剧情
      </label>
      {convertible ? (
        <button type="button" onClick={() => setStudioCommand(convertible)}>预览并转换为新版运镜</button>
      ) : (
        <p className="camera-command-warning">这个旧效果包含无法可靠还原的设置，请保留旧版播放。</p>
      )}
      {studioCommand && (
        <CameraStudioDialog
          command={studioCommand}
          legacyComparisonCommand={command}
          commands={commands}
          commandIndex={commandIndex}
          sceneId={sceneId}
          onApply={(next) => {
            onChange(next);
            setStudioCommand(undefined);
          }}
          onClose={() => setStudioCommand(undefined)}
        />
      )}
    </div>
  );
}
