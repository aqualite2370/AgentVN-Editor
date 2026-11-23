import { useEffect, useRef } from "react";
import type { OpeningAudioTrack } from "../../../../shared/cartridge/types";
import type { LibraryGame } from "../../types/cartridge";
import { assetResolver } from "../../engine/assetResolver";
import { resolvePlayableMediaUrl } from "../../utils/runtimeAssetUrl";
import { useSettingsStore } from "../../store/settingsStore";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { recordRuntimeAudio } from "../../utils/runtimeDiagnostics";

interface OpeningAudioPlayerProps {
  game?: LibraryGame;
  tracks?: OpeningAudioTrack[];
  active: boolean;
  inStory: boolean;
  onWarning?: (message: string) => void;
}

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

function volumeForTrack(
  track: OpeningAudioTrack,
  settings: { volumeBgm: number; volumeSfx: number; volumeVoice: number },
): number {
  if (track.asset_type === "sfx") return settings.volumeSfx;
  if (track.asset_type === "voice") return settings.volumeVoice;
  return settings.volumeBgm;
}

function normalizeOpeningTracks(tracks: OpeningAudioTrack[]): OpeningAudioTrack[] {
  const unique = new Map<string, OpeningAudioTrack>();
  for (const track of tracks) {
    if (!track?.asset_id || !["bgm", "sfx", "voice"].includes(track.asset_type)) continue;
    if (!unique.has(track.asset_id)) {
      unique.set(track.asset_id, {
        asset_id: track.asset_id,
        asset_type: track.asset_type,
        playback: track.playback === "loop" ? "loop" : "once",
      });
    }
  }
  const values = [...unique.values()];
  const loop = values.find((track) => track.playback === "loop");
  if (!loop) return values;
  return [
    ...values
      .filter((track) => track !== loop)
      .map((track) => ({ ...track, playback: "once" as const })),
    loop,
  ];
}

export function OpeningAudioPlayer({
  game,
  tracks = [],
  active,
  inStory,
  onWarning,
}: OpeningAudioPlayerProps) {
  const settings = useSettingsStore((state) => state.settings);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tracksRef = useRef(tracks);
  const settingsRef = useRef(settings);
  const generationRef = useRef(0);
  const startedGameIdRef = useRef<string>();
  const startedRef = useRef(false);
  const indexRef = useRef(0);
  const retryCleanupRef = useRef<(() => void) | undefined>();

  useEffect(() => {
    tracksRef.current = normalizeOpeningTracks(tracks);
  }, [tracks]);

  useEffect(() => {
    settingsRef.current = settings;
    const audio = audioRef.current;
    const track = tracksRef.current[indexRef.current];
    if (audio && track) audio.volume = clampVolume(volumeForTrack(track, settings));
  }, [settings]);

  useEffect(() => {
    const gameId = game
      ? `${game.install_id ?? ""}:${game.game_id}:${game.version}:${game.updated_at ?? game.imported_at ?? ""}`
      : "";
    if (!gameId || startedGameIdRef.current === gameId) return;
    startedGameIdRef.current = gameId;
    startedRef.current = false;
    indexRef.current = 0;
    generationRef.current += 1;
    retryCleanupRef.current?.();
    retryCleanupRef.current = undefined;
    audioRef.current?.pause();
    audioRef.current = null;
  }, [game?.game_id, game?.install_id, game?.version, game?.updated_at, game?.imported_at]);

  useEffect(() => {
    if (!active || inStory || startedRef.current || !game || tracksRef.current.length === 0) return;
    startedRef.current = true;
    const generation = ++generationRef.current;
    let disposed = false;

    const cleanupRetry = () => {
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
      retryCleanupRef.current = undefined;
    };
    const retry = () => {
      const audio = audioRef.current;
      if (!audio || disposed || generation !== generationRef.current || !audio.paused) return;
      void audio.play().catch((error) => {
        reportFrontendError("player.opening-audio", error, {
          operation: "retry-play",
          source: audio.src,
        });
      });
    };
    const listenForRetry = () => {
      cleanupRetry();
      window.addEventListener("pointerdown", retry, { once: true });
      window.addEventListener("keydown", retry, { once: true });
      retryCleanupRef.current = cleanupRetry;
    };
    const playAt = (index: number) => {
      if (disposed || generation !== generationRef.current) return;
      const track = tracksRef.current[index];
      if (!track) {
        cleanupRetry();
        audioRef.current = null;
        return;
      }
      const sourceUrl = assetResolver.resolveAsset(track.asset_id);
      if (!sourceUrl) {
        recordRuntimeAudio({ phase: "resolve-failed", assetId: track.asset_id, assetType: track.asset_type });
        const message = `开屏音频素材无法加载（${track.asset_id}），已跳过该音频。`;
        reportFrontendError("player.opening-audio", "找不到开屏音频素材。", {
          operation: "resolve",
          assetId: track.asset_id,
          assetType: track.asset_type,
        });
        onWarning?.(message);
        playAt(index + 1);
        return;
      }

      indexRef.current = index;
      audioRef.current?.pause();
      void resolvePlayableMediaUrl(sourceUrl).then((url) => {
        if (disposed || generation !== generationRef.current) return;
        if (!url) return playAt(index + 1);
        const audio = new Audio(url);
        audio.preload = "auto";
        audio.loop = track.playback === "loop";
        audio.volume = clampVolume(volumeForTrack(track, settingsRef.current));
        audio.onloadedmetadata = () => {
          recordRuntimeAudio({
            phase: "loadedmetadata",
            assetId: track.asset_id,
            assetType: track.asset_type,
            source: sourceUrl,
            duration: audio.duration,
            readyState: audio.readyState,
          });
        };
        audio.oncanplay = () => {
          recordRuntimeAudio({
            phase: "canplay",
            assetId: track.asset_id,
            assetType: track.asset_type,
            source: sourceUrl,
            readyState: audio.readyState,
          });
        };
        audio.onplaying = () => {
          recordRuntimeAudio({
            phase: "playing",
            assetId: track.asset_id,
            assetType: track.asset_type,
            source: sourceUrl,
            readyState: audio.readyState,
          });
        };
      audio.onended = () => {
        recordRuntimeAudio({ phase: "ended", assetId: track.asset_id, assetType: track.asset_type });
        if (track.playback === "once") playAt(index + 1);
      };
        audio.onerror = () => {
        recordRuntimeAudio({
          phase: "error",
          assetId: track.asset_id,
          assetType: track.asset_type,
          source: sourceUrl,
          mediaErrorCode: audio.error?.code,
          networkState: audio.networkState,
          readyState: audio.readyState,
          currentSrc: audio.currentSrc,
        });
        const message = `开屏音频无法解码或播放（${track.asset_id}，${track.asset_type}），已跳过该音频。`;
        reportFrontendError("player.opening-audio", "开屏音频无法解码或播放。", {
          operation: "decode",
          assetId: track.asset_id,
          assetType: track.asset_type,
          source: sourceUrl,
          mediaErrorCode: audio.error?.code,
          networkState: audio.networkState,
          readyState: audio.readyState,
          currentSrc: audio.currentSrc,
        });
        cleanupRetry();
        audio.pause();
        onWarning?.(message);
        playAt(index + 1);
      };
        audioRef.current = audio;
        recordRuntimeAudio({
        phase: "load",
        assetId: track.asset_id,
        assetType: track.asset_type,
          source: sourceUrl,
        loop: audio.loop,
      });
        void audio.play().catch((error) => {
        recordRuntimeAudio({
          phase: "play-rejected",
          assetId: track.asset_id,
          assetType: track.asset_type,
          source: sourceUrl,
          error: error instanceof Error ? error.message : String(error),
          mediaErrorCode: audio.error?.code,
          networkState: audio.networkState,
          readyState: audio.readyState,
        });
        reportFrontendError("player.opening-audio", error, {
          operation: "play",
          assetId: track.asset_id,
          assetType: track.asset_type,
          source: sourceUrl,
          networkState: audio.networkState,
          readyState: audio.readyState,
          currentSrc: audio.currentSrc,
        });
        if ((error as DOMException | undefined)?.name !== "NotAllowedError") {
          onWarning?.(`开屏音频播放失败（${track.asset_id}），已等待用户交互重试。`);
        }
          listenForRetry();
        });
      }).catch((error) => {
        recordRuntimeAudio({ phase: "error", assetId: track.asset_id, assetType: track.asset_type, source: sourceUrl, error: String(error) });
        onWarning?.(`开屏音频加载失败（${track.asset_id}），已跳过该音频。`);
        playAt(index + 1);
      });
    };

    playAt(0);
    return () => {
      disposed = true;
      generationRef.current += 1;
      cleanupRetry();
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [active, game, inStory, onWarning, tracks]);

  useEffect(() => {
    if (!inStory) return;
    generationRef.current += 1;
    retryCleanupRef.current?.();
    retryCleanupRef.current = undefined;
    audioRef.current?.pause();
    audioRef.current = null;
  }, [inStory]);

  return null;
}
