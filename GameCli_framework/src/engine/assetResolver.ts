import type { GameManifest } from "../types/manifest";
import { toRuntimeAssetUrl } from "../utils/runtimeAssetUrl";

export class AssetResolver {
  constructor(
    private manifest?: GameManifest,
    private basePath = "",
    private blobUrls: Record<string, string> = {}
  ) {}

  configure(manifest: GameManifest, basePath = "", blobUrls: Record<string, string> = {}): void {
    this.manifest = manifest;
    this.basePath = basePath.endsWith("/") ? basePath : `${basePath}/`;
    this.blobUrls = blobUrls;
  }

  resolveAsset(assetId?: string | null): string | undefined {
    if (!assetId || !this.manifest) return undefined;
    if (this.blobUrls[assetId]) return toRuntimeAssetUrl(this.blobUrls[assetId]);
    const asset = this.manifest.assets.find((item) => item.asset_id === assetId);
    if (!asset) return undefined;
    return toRuntimeAssetUrl(
      asset.path.startsWith("blob:") || asset.path.startsWith("http")
        ? asset.path
        : `${this.basePath}${asset.path}`.replace(/([^:]\/)\/+/g, "$1"),
    );
  }

  isPlaceholderAsset(assetId?: string | null): boolean {
    if (!assetId || !this.manifest) return false;
    const asset = this.manifest.assets.find((item) => item.asset_id === assetId);
    return Boolean(asset?.placeholder || asset?.tags?.includes("placeholder"));
  }

  resolveBackground(backgroundId?: string | null): string | undefined {
    return this.resolveAsset(backgroundId);
  }
  resolveSprite(spriteId?: string | null): string | undefined {
    return this.resolveAsset(spriteId);
  }
  resolvePortrait(portraitId?: string | null): string | undefined {
    return this.resolveAsset(portraitId);
  }
  resolveBgm(bgmId?: string | null): string | undefined {
    return this.resolveAsset(bgmId);
  }
  resolveSfx(sfxId?: string | null): string | undefined {
    return this.resolveAsset(sfxId);
  }
  resolveVoice(voiceId?: string | null): string | undefined {
    return this.resolveAsset(voiceId);
  }
}

export const assetResolver = new AssetResolver();
