import { useEffect, useRef } from "react";
import { assetResolver } from "../../engine/assetResolver";
import { useRuntimeStore } from "../../store/runtimeStore";
import { useSettingsStore } from "../../store/settingsStore";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

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
  const settings = useSettingsStore((state) => state.settings);
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const bgmKeyRef = useRef<string | undefined>();
  const bgmActionKeyRef = useRef<string | undefined>();
  const bgmGenerationRef = useRef(0);
  const voiceRef = useRef<HTMLAudioElement | null>(null);
  const sfxVolumeRef = useRef(settings.volumeSfx);
  const voiceVolumeRef = useRef(settings.volumeVoice);

  useEffect(() => {
    return () => {
      bgmRef.current?.pause();
      voiceRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    const bgm = bgmRef.current;
    if (bgm) bgm.volume = clampVolume(settings.volumeBgm * (bgmState?.volume ?? 1));
  }, [bgmState?.volume, settings.volumeBgm]);

  useEffect(() => {
    sfxVolumeRef.current = settings.volumeSfx;
  }, [settings.volumeSfx]);

  useEffect(() => {
    voiceVolumeRef.current = settings.volumeVoice;
    if (voiceRef.current) voiceRef.current.volume = clampVolume(settings.volumeVoice);
  }, [settings.volumeVoice]);

  useEffect(() => {
    if (!bgmState) return;
    const current = bgmRef.current;
    const actionKey = `${bgmState.action}:${bgmState.bgm_id ?? ""}:${bgmState.fade_ms ?? ""}`;
    const fadeMs = Math.max(80, Number(bgmState.fade_ms ?? 240));
    if (bgmState.action === "stop" || bgmState.action === "fade") {
      if (bgmActionKeyRef.current === actionKey && !current) return;
      bgmActionKeyRef.current = actionKey;
      const generation = ++bgmGenerationRef.current;
      if (!current) return;
      const target = current;
      if (bgmState.action === "fade") {
        target.volume = 0;
        window.setTimeout(() => {
          if (bgmGenerationRef.current !== generation || bgmRef.current !== null) return;
          target.pause();
          target.currentTime = 0;
        }, fadeMs);
      } else {
        target.pause();
        target.currentTime = 0;
      }
      bgmRef.current = null;
      bgmKeyRef.current = undefined;
      return;
    }

    const url = assetResolver.resolveBgm(bgmState.bgm_id);
    if (!url) {
      reportFrontendError("player.audio", "找不到背景音乐素材。", {
        operation: "resolve",
        label: "BGM",
        assetId: bgmState.bgm_id,
      });
      return;
    }
    if (current && bgmKeyRef.current === url) {
      bgmActionKeyRef.current = actionKey;
      current.volume = clampVolume(settings.volumeBgm * (bgmState.volume ?? 1));
      if (current.paused) playAudio(current, "BGM");
      return;
    }
    bgmActionKeyRef.current = actionKey;
    bgmGenerationRef.current += 1;
    current?.pause();
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = clampVolume(settings.volumeBgm * (bgmState.volume ?? 1));
    bgmRef.current = audio;
    bgmKeyRef.current = url;
    playAudio(audio, "BGM");
  }, [bgmState?.action, bgmState?.bgm_id, bgmState?.fade_ms, settings.volumeBgm]);

  useEffect(() => {
    if (!sfxEvent) return;
    const url = assetResolver.resolveSfx(sfxEvent.sfx_id);
    if (!url) {
      reportFrontendError("player.audio", "找不到音效素材。", {
        operation: "resolve",
        label: "SFX",
        assetId: sfxEvent.sfx_id,
      });
      return;
    }
    const audio = new Audio(url);
    audio.volume = clampVolume(sfxVolumeRef.current * (sfxEvent.volume ?? 1));
    playAudio(audio, "SFX");
  }, [sfxEvent?.id]);

  useEffect(() => {
    const voiceId = dialog?.voice;
    if (!voiceId) {
      voiceRef.current?.pause();
      voiceRef.current = null;
      return;
    }
    const url = assetResolver.resolveVoice(voiceId);
    if (!url) {
      reportFrontendError("player.audio", "找不到语音素材。", {
        operation: "resolve",
        label: "Voice",
        assetId: voiceId,
      });
      return;
    }
    voiceRef.current?.pause();
    const audio = new Audio(url);
    audio.volume = clampVolume(voiceVolumeRef.current);
    voiceRef.current = audio;
    playAudio(audio, "Voice");
  }, [dialog?.text_key, dialog?.voice]);

  return null;
}
