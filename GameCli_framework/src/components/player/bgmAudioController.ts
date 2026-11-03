export interface BgmAudioElement {
  src: string;
  loop: boolean;
  paused: boolean;
  currentTime: number;
  volume: number;
  play(): Promise<void> | void;
  pause(): void;
}

export interface BgmAudioControllerOptions {
  createAudio: (url: string) => BgmAudioElement;
  requestFrame: (callback: (timestamp: number) => void) => number;
  cancelFrame: (id: number) => void;
  now: () => number;
  onPlayError?: (error: unknown, audio: BgmAudioElement) => void;
}

export interface BgmPlayOptions {
  url: string;
  volume?: number | null;
  fadeMs?: number | null;
}

export interface BgmStopOptions {
  fadeMs?: number | null;
}

interface BgmTrack {
  audio: BgmAudioElement;
  url: string;
  commandVolume: number;
  gain: number;
}

type Transition =
  | {
      kind: "fade_in";
      tracks: Array<{ track: BgmTrack; startGain: number }>;
      startedAt: number;
      durationMs: number;
    }
  | {
      kind: "fade_out";
      tracks: Array<{ track: BgmTrack; startGain: number }>;
      startedAt: number;
      durationMs: number;
    }
  | {
      kind: "crossfade";
      incoming: { track: BgmTrack; startGain: number };
      outgoing: { track: BgmTrack; startGain: number };
      startedAt: number;
      durationMs: number;
    };

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

function normalizeDuration(value: number | null | undefined): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
}

function normalizeCommandVolume(value: number | null | undefined): number {
  return clamp(Number(value ?? 1));
}

export class BgmAudioController {
  private readonly options: BgmAudioControllerOptions;
  private masterVolume = 1;
  private current?: BgmTrack;
  private outgoing?: BgmTrack;
  private transition?: Transition;
  private frameId?: number;
  private generation = 0;

  constructor(options: BgmAudioControllerOptions) {
    this.options = options;
  }

  setMasterVolume(value: number): void {
    this.masterVolume = clamp(value);
    this.applyVolume(this.current);
    this.applyVolume(this.outgoing);
  }

  setCurrentVolume(value: number | null | undefined): void {
    if (!this.current) return;
    this.current.commandVolume = normalizeCommandVolume(value);
    this.applyVolume(this.current);
  }

  play(options: BgmPlayOptions): void {
    if (!options.url) return;
    const fadeMs = normalizeDuration(options.fadeMs);
    const commandVolume = normalizeCommandVolume(options.volume);
    this.cancelTransition();

    if (this.current?.url === options.url) {
      this.disposeTrack(this.outgoing);
      this.outgoing = undefined;
      this.current.commandVolume = commandVolume;
      if (this.current.audio.paused) this.startAudio(this.current.audio);
      if (fadeMs > 0) {
        this.startFadeIn(this.current, fadeMs);
      } else {
        this.current.gain = 1;
        this.applyVolume(this.current);
      }
      return;
    }

    this.disposeTrack(this.outgoing);
    this.outgoing = undefined;
    const previous = this.current;
    const audio = this.options.createAudio(options.url);
    audio.loop = true;
    const incoming: BgmTrack = { audio, url: options.url, commandVolume, gain: fadeMs > 0 ? 0 : 1 };
    this.current = incoming;
    this.applyVolume(incoming);
    this.startAudio(audio);

    if (previous && fadeMs > 0) {
      this.outgoing = previous;
      this.startCrossfade(incoming, previous, fadeMs);
    } else {
      this.disposeTrack(previous);
      if (fadeMs > 0) this.startFadeIn(incoming, fadeMs);
      else this.applyVolume(incoming);
    }
  }

  stop(options: BgmStopOptions = {}): void {
    this.cancelTransition();
    const tracks = [this.current, this.outgoing].filter((track): track is BgmTrack => Boolean(track));
    if (tracks.length === 0) return;
    const fadeMs = normalizeDuration(options.fadeMs);
    if (fadeMs <= 0) {
      tracks.forEach((track) => this.disposeTrack(track));
      this.current = undefined;
      this.outgoing = undefined;
      return;
    }
    this.startFadeOut(tracks, fadeMs);
  }

  dispose(): void {
    this.cancelTransition();
    this.disposeTrack(this.current);
    this.disposeTrack(this.outgoing);
    this.current = undefined;
    this.outgoing = undefined;
  }

  private startAudio(audio: BgmAudioElement): void {
    try {
      const result = audio.play();
      if (result && typeof result.catch === "function") {
        void result.catch((error) => this.options.onPlayError?.(error, audio));
      }
    } catch (error) {
      this.options.onPlayError?.(error, audio);
    }
  }

  private startFadeIn(track: BgmTrack, durationMs: number): void {
    this.startTransition({
      kind: "fade_in",
      tracks: [{ track, startGain: track.gain }],
      startedAt: this.options.now(),
      durationMs,
    });
  }

  private startFadeOut(tracks: BgmTrack[], durationMs: number): void {
    this.startTransition({
      kind: "fade_out",
      tracks: tracks.map((track) => ({ track, startGain: track.gain })),
      startedAt: this.options.now(),
      durationMs,
    });
  }

  private startCrossfade(incoming: BgmTrack, outgoing: BgmTrack, durationMs: number): void {
    this.startTransition({
      kind: "crossfade",
      incoming: { track: incoming, startGain: incoming.gain },
      outgoing: { track: outgoing, startGain: outgoing.gain },
      startedAt: this.options.now(),
      durationMs,
    });
  }

  private startTransition(transition: Transition): void {
    const generation = ++this.generation;
    this.transition = transition;
    const tick = (timestamp: number) => {
      if (this.generation !== generation || this.transition !== transition) return;
      const progress = clamp((timestamp - transition.startedAt) / transition.durationMs);
      this.applyTransition(transition, progress);
      if (progress >= 1) {
        this.transition = undefined;
        this.frameId = undefined;
        if (transition.kind === "crossfade") {
          this.disposeTrack(transition.outgoing.track);
          if (this.outgoing === transition.outgoing.track) this.outgoing = undefined;
        } else if (transition.kind === "fade_out") {
          transition.tracks.forEach(({ track }) => {
            this.disposeTrack(track);
            if (this.current === track) this.current = undefined;
            if (this.outgoing === track) this.outgoing = undefined;
          });
        }
        return;
      }
      this.frameId = this.options.requestFrame(tick);
    };
    this.frameId = this.options.requestFrame(tick);
  }

  private applyTransition(transition: Transition, progress: number): void {
    if (transition.kind === "fade_in") {
      const eased = Math.sin(progress * Math.PI / 2);
      transition.tracks.forEach(({ track, startGain }) => {
        track.gain = startGain + (1 - startGain) * eased;
        this.applyVolume(track);
      });
      return;
    }
    if (transition.kind === "fade_out") {
      const remaining = Math.cos(progress * Math.PI / 2);
      transition.tracks.forEach(({ track, startGain }) => {
        track.gain = startGain * remaining;
        this.applyVolume(track);
      });
      return;
    }
    const incomingGain = Math.sin(progress * Math.PI / 2);
    const outgoingGain = Math.cos(progress * Math.PI / 2);
    transition.incoming.track.gain = transition.incoming.startGain
      + (1 - transition.incoming.startGain) * incomingGain;
    transition.outgoing.track.gain = transition.outgoing.startGain * outgoingGain;
    this.applyVolume(transition.incoming.track);
    this.applyVolume(transition.outgoing.track);
  }

  private applyVolume(track: BgmTrack | undefined): void {
    if (!track) return;
    track.audio.volume = clamp(this.masterVolume * track.commandVolume * track.gain);
  }

  private cancelTransition(): void {
    this.generation += 1;
    if (this.frameId !== undefined) this.options.cancelFrame(this.frameId);
    this.frameId = undefined;
    this.transition = undefined;
  }

  private disposeTrack(track: BgmTrack | undefined): void {
    if (!track) return;
    track.audio.pause();
    track.audio.currentTime = 0;
    track.gain = 0;
    this.applyVolume(track);
  }
}
