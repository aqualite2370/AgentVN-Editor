import type { OpeningAudioAssetType, OpeningAudioPlayback, OpeningAudioTrack } from "../../../shared/cartridge/types";

const openingAudioAssetTypes = new Set<OpeningAudioAssetType>(["bgm", "sfx", "voice"]);

export function isOpeningAudioAssetType(value: unknown): value is OpeningAudioAssetType {
  return typeof value === "string" && openingAudioAssetTypes.has(value as OpeningAudioAssetType);
}

export function normalizeOpeningAudioTracks(value: unknown): OpeningAudioTrack[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, OpeningAudioTrack>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    const assetId = typeof record.asset_id === "string" ? record.asset_id.trim() : "";
    if (!assetId || !isOpeningAudioAssetType(record.asset_type)) continue;
    const playback: OpeningAudioPlayback = record.playback === "loop" ? "loop" : "once";
    if (!unique.has(assetId)) unique.set(assetId, { asset_id: assetId, asset_type: record.asset_type, playback });
  }
  const tracks = [...unique.values()];
  const loop = tracks.find((track) => track.playback === "loop");
  if (!loop) return tracks;
  return [...tracks.filter((track) => track !== loop).map((track) => ({ ...track, playback: "once" as const })), loop];
}

export function updateOpeningAudioTrack(
  tracks: OpeningAudioTrack[],
  index: number,
  patch: Partial<OpeningAudioTrack>,
): OpeningAudioTrack[] {
  const next = tracks.map((track, trackIndex) => (
    trackIndex === index ? { ...track, ...patch } : { ...track, playback: track.playback === "loop" ? "once" as const : track.playback }
  ));
  return normalizeOpeningAudioTracks(next);
}

export function appendOpeningAudioTrack(
  tracks: OpeningAudioTrack[],
  track: OpeningAudioTrack,
): OpeningAudioTrack[] {
  return normalizeOpeningAudioTracks([...tracks, track]);
}
