import { ArrowDown, ArrowUp, Music2, Plus, Repeat2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { OpeningAudioPlayback, OpeningAudioTrack } from "../../../../shared/cartridge/types";
import { assetTypeDisplayLabel } from "../../../../shared/cartridge/assetTaxonomy";
import type { AssetRef } from "../../types/assets";
import { appendOpeningAudioTrack, normalizeOpeningAudioTracks, updateOpeningAudioTrack } from "../../utils/openingAudio";
import { AssetPicker } from "./AssetPicker";
import { RichSelect } from "./RichSelect";

interface OpeningAudioQueueEditorProps {
  tracks?: OpeningAudioTrack[];
  assets: AssetRef[];
  onChange: (tracks: OpeningAudioTrack[]) => void;
  helpKey: string;
}

function assetSource(asset?: AssetRef): string | undefined {
  return asset?.metadata.data_url ?? asset?.metadata.blob_url ?? asset?.metadata.url ?? asset?.metadata.path ?? asset?.metadata.filePath;
}

function assetName(asset: AssetRef | undefined, assetId: string): string {
  return asset?.metadata.display_name ?? asset?.metadata.filename ?? assetId;
}

export function OpeningAudioQueueEditor({ tracks = [], assets, onChange, helpKey }: OpeningAudioQueueEditorProps) {
  const normalizedTracks = useMemo(() => normalizeOpeningAudioTracks(tracks), [tracks]);
  const [pendingAssetId, setPendingAssetId] = useState("");
  const selectedAsset = assets.find((asset) => asset.asset_id === pendingAssetId);

  function addTrack() {
    if (!selectedAsset) return;
    const assetType = selectedAsset.asset_type === "sfx" || selectedAsset.asset_type === "voice" ? selectedAsset.asset_type : "bgm";
    onChange(appendOpeningAudioTrack(normalizedTracks, {
      asset_id: selectedAsset.asset_id,
      asset_type: assetType,
      playback: "once",
    }));
    setPendingAssetId("");
  }

  function updateTrack(index: number, patch: Partial<OpeningAudioTrack>) {
    onChange(updateOpeningAudioTrack(normalizedTracks, index, patch));
  }

  function moveTrack(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    const lastMovableIndex = normalizedTracks.some((track) => track.playback === "loop")
      ? normalizedTracks.length - 2
      : normalizedTracks.length - 1;
    if (targetIndex < 0 || targetIndex > lastMovableIndex) return;
    const next = [...normalizedTracks];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    onChange(normalizeOpeningAudioTracks(next));
  }

  function removeTrack(index: number) {
    onChange(normalizedTracks.filter((_, trackIndex) => trackIndex !== index));
  }

  return (
    <section className="opening-audio-panel loading-animation-panel" data-help-key={helpKey}>
      <header>
        <div>
          <strong><Music2 size={16} /> 开屏音频队列</strong>
          <span>线条加载结束后按顺序播放；进入剧情时自动停止。单曲循环会固定在队尾。</span>
        </div>
      </header>
      <div className="opening-audio-picker-row">
        <AssetPicker
          label="添加音频素材"
          field="opening_audio"
          value={pendingAssetId}
          allowedTypes={["bgm", "sfx", "voice"]}
          helpKey={`${helpKey}.picker`}
          emptyLabel="暂无可用音频素材"
          onChange={(assetId, asset) => {
            setPendingAssetId(assetId);
          }}
        />
        <button
          type="button"
          className="opening-audio-add"
          data-help-key={`${helpKey}.add`}
          disabled={!selectedAsset}
          onClick={addTrack}
        >
          <Plus size={15} /> 添加到队列
        </button>
      </div>
      {pendingAssetId && !selectedAsset && <p className="inline-status warning">当前音频素材已不存在，请从素材库重新选择。</p>}
      {normalizedTracks.length === 0 ? (
        <p className="opening-audio-empty">尚未添加开屏音频。</p>
      ) : (
        <div className="opening-audio-list" role="list" aria-label="开屏音频队列">
          {normalizedTracks.map((track, index) => {
            const asset = assets.find((candidate) => candidate.asset_id === track.asset_id);
            const source = assetSource(asset);
            const isLoop = track.playback === "loop";
            const lastMovableIndex = normalizedTracks.some((candidate) => candidate.playback === "loop")
              ? normalizedTracks.length - 2
              : normalizedTracks.length - 1;
            return (
              <article key={`${track.asset_id}_${index}`} className={`opening-audio-item${isLoop ? " is-loop" : ""}`} role="listitem">
                <span className="opening-audio-index">{index + 1}</span>
                <div className="opening-audio-copy">
                  <strong>{assetName(asset, track.asset_id)}</strong>
                  <small>{assetTypeDisplayLabel(track.asset_type)} · {track.playback === "loop" ? "单曲循环" : "播放一次"}</small>
                  {source && (
                    <audio className="opening-audio-preview" src={source} controls preload="none">
                      当前浏览器不支持音频试听。
                    </audio>
                  )}
                  {!asset && <small className="opening-audio-missing">素材缺失，请重新选择。</small>}
                </div>
                <label className="opening-audio-mode">
                  <span className="sr-only">第 {index + 1} 项播放方式</span>
                  <RichSelect
                    value={track.playback}
                    variant="compact"
                    ariaLabel={`第 ${index + 1} 项播放方式`}
                    helpKey={`${helpKey}.mode`}
                    options={[
                      { value: "once", label: "播放一次" },
                      { value: "loop", label: "单曲循环" },
                    ]}
                    onChange={(playback) => updateTrack(index, { playback: playback as OpeningAudioPlayback })}
                  />
                </label>
                <div className="opening-audio-actions">
                  <button type="button" aria-label={`上移第 ${index + 1} 项`} title="上移" data-help-key={`${helpKey}.moveUp`} disabled={index === 0} onClick={() => moveTrack(index, -1)}>
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" aria-label={`下移第 ${index + 1} 项`} title="下移" data-help-key={`${helpKey}.moveDown`} disabled={index >= lastMovableIndex} onClick={() => moveTrack(index, 1)}>
                    <ArrowDown size={14} />
                  </button>
                  <button type="button" aria-label={`移除第 ${index + 1} 项`} title="移除" data-help-key={`${helpKey}.remove`} onClick={() => removeTrack(index)}>
                    {isLoop ? <Repeat2 size={14} /> : <Trash2 size={14} />}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
