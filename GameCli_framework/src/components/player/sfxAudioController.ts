export interface SfxAudioElement {
  src: string;
  volume: number;
  onended: HTMLAudioElement["onended"];
  onerror: HTMLAudioElement["onerror"];
  play(): Promise<void> | void;
  pause(): void;
}

interface Track {
  assetId: string;
  volume: number;
  gain: number;
  audio?: SfxAudioElement;
  fade?: { start: number; duration: number; gain: number };
}

interface Options {
  createAudio: (url: string) => SfxAudioElement;
  resolveUrl: (assetId: string) => Promise<string | undefined>;
  requestFrame: (callback: (timestamp: number) => void) => number;
  cancelFrame: (id: number) => void;
  now: () => number;
  onError?: (error: unknown, assetId: string) => void;
}

const clamp = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));

/** Each request owns its instance, including preparation and an in-progress fade. */
export class SfxAudioController {
  private tracks = new Set<Track>();
  private masterVolume = 1;
  private frame?: number;
  constructor(private options: Options) {}

  setMasterVolume(value: number): void {
    this.masterVolume = clamp(value);
    for (const track of this.tracks) this.applyVolume(track);
  }

  async play(assetId: string, volume = 1): Promise<void> {
    if (!assetId) return;
    const track: Track = { assetId, volume: clamp(volume), gain: 1 };
    this.tracks.add(track);
    try {
      const url = await this.options.resolveUrl(assetId);
      if (!this.tracks.has(track)) return;
      if (!url) throw new Error("找不到音效素材。");
      track.audio = this.options.createAudio(url);
      track.audio.onended = () => this.release(track);
      track.audio.onerror = () => {
        if (this.tracks.has(track)) {
          this.options.onError?.(new Error("音效加载失败。"), assetId);
          this.release(track);
        }
      };
      this.applyVolume(track);
      await track.audio.play();
      // A pending play promise can settle after a stop/dispose.
      if (!this.tracks.has(track)) track.audio.pause();
    } catch (error) {
      if (this.tracks.has(track)) {
        this.options.onError?.(error, assetId);
        this.release(track);
      }
    }
  }

  stop(assetId = "", fadeMs = 0): void {
    const duration = Number.isFinite(fadeMs) ? Math.max(0, Math.min(60000, fadeMs)) : 0;
    for (const track of this.tracks) {
      if (assetId && track.assetId !== assetId) continue;
      if (!track.audio || duration === 0) this.release(track);
      else if (!track.fade) track.fade = { start: this.options.now(), duration, gain: track.gain };
    }
    this.schedule();
  }

  dispose(): void {
    for (const track of this.tracks) this.release(track);
    if (this.frame !== undefined) this.options.cancelFrame(this.frame);
    this.frame = undefined;
  }

  private release(track: Track): void {
    this.tracks.delete(track);
    if (track.audio) {
      track.audio.onended = null;
      track.audio.onerror = null;
      track.audio.pause();
      track.audio.src = "";
    }
  }

  private applyVolume(track: Track): void {
    if (track.audio) track.audio.volume = clamp(this.masterVolume * track.volume * track.gain);
  }

  private schedule(): void {
    if (this.frame !== undefined || ![...this.tracks].some(track => track.fade)) return;
    this.frame = this.options.requestFrame(() => {
      this.frame = undefined;
      const now = this.options.now();
      for (const track of this.tracks) {
        if (!track.fade) continue;
        const progress = Math.min(1, Math.max(0, (now - track.fade.start) / track.fade.duration));
        track.gain = track.fade.gain * (1 - progress);
        this.applyVolume(track);
        if (progress === 1) this.release(track);
      }
      this.schedule();
    });
  }
}
