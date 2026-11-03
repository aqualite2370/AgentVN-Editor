import { useEffect, useRef } from "react";
import { assetResolver } from "../../engine/assetResolver";
import { useRuntimeStore } from "../../store/runtimeStore";
import { useSettingsStore } from "../../store/settingsStore";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { normalizeBgmCommandFields } from "../../../../shared/cartridge/bgmTransition";
import { BgmAudioController } from "./bgmAudioController";
import { resolvePlayableMediaUrl } from "../../utils/runtimeAssetUrl";
import { recordRuntimeAudio } from "../../utils/runtimeDiagnostics";

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

function playAudio(audio: HTMLAudioElement, label: string) {
  void audio.play().catch((error) => {
    reportFrontendError("player.audio", error, { operation: "play", label, source: audio.src });
  });
}

export function RuntimeAudio() {
  const bgmState = useRuntimeStore((state) => state.engineState.bgmState);
  const sfxEvent = useRuntimeStore((state) => state.engineState.sfxEvent);
  const dialog = useRuntimeStore((state) => state.engineState.dialog);
  const dialogRestored = useRuntimeStore((state) => state.engineState.dialogRestored);
  const screen = useRuntimeStore((state) => state.screen);
  const setVoicePlaying = useRuntimeStore((state) => state.setVoicePlaying);
  const settings = useSettingsStore((state) => state.settings);
  const bgmControllerRef = useRef<BgmAudioController | null>(null);
  const voiceRef = useRef<HTMLAudioElement | null>(null);
  const sfxVolumeRef = useRef(settings.volumeSfx);
  const voiceVolumeRef = useRef(settings.volumeVoice);
  const audioEmphasisRef = useRef(settings.audioEmphasis);
  const audioWhenUnfocusedRef = useRef(settings.audioWhenUnfocused);
  const audioWhenMinimizedRef = useRef(settings.audioWhenMinimized);
  const voiceSustainRef = useRef(settings.voiceSustain);
  const bgmVolumeRef = useRef(1);
  const selfVoicingRef = useRef(settings.selfVoicing);
  const selfVoicingVolumeDropRef = useRef(settings.selfVoicingVolumeDrop);
  const voicePlayingRef = useRef(false);
  const focusedRef = useRef(typeof document === "undefined" ? true : document.visibilityState === "visible");

  const masterVolume = settings.muteAll ? 0 : settings.volumeMaster;
  const bgmVolume = settings.muteBgm ? 0 : masterVolume * settings.volumeBgm;
  const sfxVolume = settings.muteSfx ? 0 : masterVolume * settings.volumeSfx;
  const voiceVolume = settings.muteVoice ? 0 : masterVolume * settings.volumeVoice;

  if (!bgmControllerRef.current) {
    bgmControllerRef.current = new BgmAudioController({
      createAudio: (url) => new Audio(url),
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (id) => window.cancelAnimationFrame(id),
      now: () => performance.now(),
      onPlayError: (error, audio) => {
        recordRuntimeAudio({ phase: "error", kind: "bgm", source: audio.src, error: String(error) });
        reportFrontendError("player.audio", error, { operation: "play", label: "BGM", source: audio.src });
      },
    });
  }

  useEffect(() => {
    return () => {
      bgmControllerRef.current?.dispose();
      voiceRef.current?.pause();
      setVoicePlaying(false);
    };
  }, [setVoicePlaying]);

  useEffect(() => {
    const emphasis = settings.audioEmphasis && voicePlayingRef.current
      ? 0.35
      : settings.selfVoicing ? settings.selfVoicingVolumeDrop : 1;
    const focusGain = focusedRef.current || settings.audioWhenUnfocused ? 1 : 0;
    bgmControllerRef.current?.setMasterVolume(bgmVolume * emphasis * focusGain);
  }, [bgmVolume, settings.audioEmphasis, settings.audioWhenUnfocused, settings.selfVoicing, settings.selfVoicingVolumeDrop]);

  useEffect(() => {
    if (bgmState?.action !== "play") return;
    bgmControllerRef.current?.setCurrentVolume(bgmState.volume);
  }, [bgmState?.action, bgmState?.volume]);

  useEffect(() => {
    sfxVolumeRef.current = sfxVolume;
  }, [sfxVolume]);

  useEffect(() => {
    audioEmphasisRef.current = settings.audioEmphasis;
    audioWhenUnfocusedRef.current = settings.audioWhenUnfocused;
    audioWhenMinimizedRef.current = settings.audioWhenMinimized;
    voiceSustainRef.current = settings.voiceSustain;
    bgmVolumeRef.current = bgmVolume;
    selfVoicingRef.current = settings.selfVoicing;
    selfVoicingVolumeDropRef.current = settings.selfVoicingVolumeDrop;
  }, [
    bgmVolume,
    settings.audioEmphasis,
    settings.audioWhenMinimized,
    settings.audioWhenUnfocused,
    settings.selfVoicing,
    settings.selfVoicingVolumeDrop,
    settings.voiceSustain,
  ]);

  useEffect(() => {
    voiceVolumeRef.current = voiceVolume;
    if (voiceRef.current) voiceRef.current.volume = clampVolume(voiceVolume);
  }, [voiceVolume]);

  useEffect(() => {
    const syncFocus = () => {
      focusedRef.current = document.visibilityState === "visible" && document.hasFocus();
      const focusGain = document.visibilityState !== "visible"
        ? (settings.audioWhenMinimized ? 1 : 0)
        : (focusedRef.current || settings.audioWhenUnfocused ? 1 : 0);
      const emphasis = settings.audioEmphasis && voicePlayingRef.current
        ? 0.35
        : settings.selfVoicing ? settings.selfVoicingVolumeDrop : 1;
      bgmControllerRef.current?.setMasterVolume(bgmVolume * emphasis * focusGain);
      if (voiceRef.current) voiceRef.current.volume = clampVolume(voiceVolume * focusGain);
    };
    window.addEventListener("focus", syncFocus);
    window.addEventListener("blur", syncFocus);
    document.addEventListener("visibilitychange", syncFocus);
    syncFocus();
    return () => {
      window.removeEventListener("focus", syncFocus);
      window.removeEventListener("blur", syncFocus);
      document.removeEventListener("visibilitychange", syncFocus);
    };
  }, [
    bgmVolume,
    settings.audioEmphasis,
    settings.audioWhenMinimized,
    settings.audioWhenUnfocused,
    settings.selfVoicing,
    settings.selfVoicingVolumeDrop,
    voiceVolume,
  ]);

  useEffect(() => {
    if (!bgmState) return;
    const command = normalizeBgmCommandFields(bgmState);
    if (command.action === "stop") {
      recordRuntimeAudio({ phase: "stop", kind: "bgm", assetId: bgmState.bgm_id, fadeMs: command.fade_ms });
      bgmControllerRef.current?.stop({ fadeMs: command.fade_ms });
      return;
    }

    const sourceUrl = assetResolver.resolveBgm(bgmState.bgm_id);
    if (!sourceUrl) {
      reportFrontendError("player.audio", "找不到背景音乐素材。", {
        operation: "resolve",
        label: "BGM",
        assetId: bgmState.bgm_id,
      });
      return;
    }
    let cancelled = false;
    void resolvePlayableMediaUrl(sourceUrl)
      .then((url) => {
        if (!cancelled && url) {
          recordRuntimeAudio({ phase: "play-request", kind: "bgm", assetId: bgmState.bgm_id, source: url, volume: bgmState.volume, fadeMs: command.fade_ms });
          bgmControllerRef.current?.play({ url, volume: bgmState.volume, fadeMs: command.fade_ms });
        }
      })
      .catch((error) => {
        reportFrontendError("player.audio", error, { operation: "prepare-bgm", source: sourceUrl });
      });
    return () => {
      cancelled = true;
    };
  }, [bgmState?.action, bgmState?.bgm_id, bgmState?.fade_ms]);

  useEffect(() => {
    if (!sfxEvent) return;
    const sourceUrl = assetResolver.resolveSfx(sfxEvent.sfx_id);
    if (!sourceUrl) {
      reportFrontendError("player.audio", "找不到音效素材。", {
        operation: "resolve",
        label: "SFX",
        assetId: sfxEvent.sfx_id,
      });
      return;
    }
    let cancelled = false;
    void resolvePlayableMediaUrl(sourceUrl).then((url) => {
      if (cancelled || !url) return;
      const audio = new Audio(url);
      const emphasis = audioEmphasisRef.current && voicePlayingRef.current
        ? 0.35
        : selfVoicingRef.current ? selfVoicingVolumeDropRef.current : 1;
      audio.volume = clampVolume(sfxVolumeRef.current * emphasis * (sfxEvent.volume ?? 1));
      playAudio(audio, "SFX");
    });
    return () => {
      cancelled = true;
    };
  }, [sfxEvent?.id]);

  useEffect(() => {
    if (dialogRestored) {
      voiceRef.current?.pause();
      voiceRef.current = null;
      voicePlayingRef.current = false;
      setVoicePlaying(false);
      return;
    }
    const voiceId = dialog?.voice;
    if (!voiceId) {
      if (voiceSustainRef.current && voiceRef.current && !voiceRef.current.ended) return;
      voiceRef.current?.pause();
      voiceRef.current = null;
      voicePlayingRef.current = false;
      setVoicePlaying(false);
      return;
    }
    const sourceUrl = assetResolver.resolveVoice(voiceId);
    if (!sourceUrl) {
      reportFrontendError("player.audio", "找不到语音素材。", {
        operation: "resolve",
        label: "Voice",
        assetId: voiceId,
      });
      return;
    }
    let cancelled = false;
    voiceRef.current?.pause();
    const audioPromise = resolvePlayableMediaUrl(sourceUrl);
    void audioPromise.then((url) => {
      if (cancelled || !url) return;
      const audio = new Audio(url);
      audio.volume = clampVolume(voiceVolumeRef.current);
    audio.onplay = () => {
      voicePlayingRef.current = true;
      setVoicePlaying(true);
      const focusGain = document.visibilityState !== "visible"
        ? (audioWhenMinimizedRef.current ? 1 : 0)
        : (focusedRef.current || audioWhenUnfocusedRef.current ? 1 : 0);
      bgmControllerRef.current?.setMasterVolume(bgmVolumeRef.current * (audioEmphasisRef.current ? 0.35 : 1) * focusGain);
    };
    audio.onended = () => {
      if (voiceRef.current === audio) voiceRef.current = null;
      voicePlayingRef.current = false;
      setVoicePlaying(false);
      const focusGain = document.visibilityState !== "visible"
        ? (audioWhenMinimizedRef.current ? 1 : 0)
        : (focusedRef.current || audioWhenUnfocusedRef.current ? 1 : 0);
      bgmControllerRef.current?.setMasterVolume(bgmVolumeRef.current * focusGain);
    };
      voiceRef.current = audio;
      playAudio(audio, "Voice");
    });
    return () => {
      cancelled = true;
      if (voiceRef.current && !voiceSustainRef.current) {
        voiceRef.current.pause();
        voiceRef.current = null;
        voicePlayingRef.current = false;
        setVoicePlaying(false);
      }
    };
  }, [dialog?.text_key, dialog?.voice, dialogRestored]);

  useEffect(() => {
    if (screen === "playing" || settings.voiceAfterMenu) return;
    voiceRef.current?.pause();
    voiceRef.current = null;
    voicePlayingRef.current = false;
    setVoicePlaying(false);
  }, [screen, setVoicePlaying, settings.voiceAfterMenu]);

  return null;
}
