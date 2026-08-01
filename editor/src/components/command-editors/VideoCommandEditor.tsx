import type { VideoCommand } from "../../types/commands";
import { backgroundFitOptions } from "../../utils/localizedOptions";
import { AssetPicker } from "../common/AssetPicker";
import { RichSelect } from "../common/RichSelect";

function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(10_000, Math.max(0, Math.round(value)));
}

export function VideoCommandEditor({
  command,
  onChange,
}: {
  command: VideoCommand;
  onChange: (command: VideoCommand) => void;
}) {
  return (
    <div className="form-grid video-command-editor">
      <AssetPicker
        label="过场视频素材"
        field="video_id"
        value={command.video_id}
        allowedTypes={["video"]}
        helpKey="command.video.videoId"
        emptyLabel="暂无可用视频素材"
        onChange={(videoId) => onChange({ ...command, video_id: videoId })}
      />
      <label>
        视频显示模式
        <RichSelect
          ariaLabel="过场视频显示模式"
          value={command.video_fit ?? "contain"}
          options={backgroundFitOptions}
          helpKey="command.video.fit"
          variant="compact"
          onChange={(videoFit) => onChange({ ...command, video_fit: videoFit })}
        />
      </label>
      <label>
        淡入时间（毫秒）
        <input
          type="number"
          min="0"
          max="10000"
          step="50"
          value={command.fade_in_ms ?? 500}
          data-help-key="command.video.fadeIn"
          onChange={(event) => onChange({ ...command, fade_in_ms: clampDuration(Number(event.target.value)) })}
        />
      </label>
      <label>
        淡出时间（毫秒）
        <input
          type="number"
          min="0"
          max="10000"
          step="50"
          value={command.fade_out_ms ?? 500}
          data-help-key="command.video.fadeOut"
          onChange={(event) => onChange({ ...command, fade_out_ms: clampDuration(Number(event.target.value)) })}
        />
      </label>
      <p className="inline-status video-spec-hint">
        推荐 1920×1080（最低 1280×720）、24/30 FPS、MP4 H.264 + AAC；建议单文件不超过 150 MB。
      </p>
    </div>
  );
}
