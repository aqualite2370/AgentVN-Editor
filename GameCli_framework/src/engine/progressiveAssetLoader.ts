import type { LibraryGame, StartupIndex } from "../types/cartridge";
import type { AssetManifestItem } from "../types/manifest";

const PREWARM_CONCURRENCY = 2;
const SCENE_PREWARM_BUDGET_BYTES = 32 * 1024 * 1024;
const ASSET_LOAD_TIMEOUT_MS = 10_000;

export interface AssetPreparationProgress {
  phase: "entry" | "scene";
  loadedBytes: number;
  totalBytes: number;
  percent: number;
  assetId?: string;
}

interface PrepareOptions {
  phase: AssetPreparationProgress["phase"];
  budgetBytes: number;
  blockingOnly?: boolean;
  onProgress?: (progress: AssetPreparationProgress) => void;
}

function collectStrings(value: unknown, output = new Set<string>()): Set<string> {
  if (typeof value === "string") output.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, output));
  }
  return output;
}

function resolveReferencedAssetIds(value: unknown, assets: AssetManifestItem[]): string[] {
  const byId = new Map(assets.map((asset) => [asset.asset_id, asset]));
  const byPath = new Map(assets.map((asset) => [asset.path, asset]));
  const result = new Set<string>();
  for (const candidate of collectStrings(value)) {
    const normalized = candidate.startsWith("asset:") ? candidate.slice("asset:".length) : candidate;
    if (byId.has(normalized)) result.add(normalized);
    const byPathAsset = byPath.get(candidate);
    if (byPathAsset) result.add(byPathAsset.asset_id);
  }
  return [...result];
}

function sceneSuccessors(scene: LibraryGame["script"]["scenes"][number]): string[] {
  const result = new Set<string>();
  if (scene.next_scene_id) result.add(scene.next_scene_id);
  for (const command of scene.commands) {
    if (command.type === "choice") {
      command.choices.forEach((choice) => result.add(choice.target_scene_id));
    } else if (command.type === "jump") {
      result.add(command.target_scene_id);
    } else if (command.type === "conditional_jump") {
      result.add(command.target_scene_id);
      if (command.else_target_scene_id) result.add(command.else_target_scene_id);
    }
  }
  return [...result];
}

function deriveStartupIndex(game: LibraryGame): StartupIndex {
  const assets = game.manifest.assets;
  const titleScreen = game.uiSkin?.screens.find((screen) => screen.screen_id === "title");
  const playerScreen = game.uiSkin?.screens.find((screen) => screen.screen_id === "player");
  const playerAssets = resolveReferencedAssetIds(playerScreen, assets);
  const sceneAssets: Record<string, string[]> = {};
  const nextScenes: Record<string, string[]> = {};
  for (const scene of game.script.scenes) {
    sceneAssets[scene.scene_id] = [...new Set([
      ...playerAssets,
      ...resolveReferencedAssetIds(scene, assets),
    ])];
    nextScenes[scene.scene_id] = sceneSuccessors(scene);
  }
  const files = Object.fromEntries(assets.map((asset) => [
    asset.path,
    {
      assetId: asset.asset_id,
      mimeType: asset.mime_type ?? "application/octet-stream",
      sizeBytes: Number((asset as AssetManifestItem & { size_bytes?: number }).size_bytes ?? 0),
      sha256: "",
    },
  ]));
  return {
    schemaVersion: "1.0",
    contentId: game.contentId ?? `legacy-${game.game_id}-${game.version}`,
    files,
    titleAssets: resolveReferencedAssetIds({
      cover: game.manifest.cover,
      shell: game.manifest.shell,
      loadingAnimation: game.script.loading_animation,
      titleScreen,
    }, assets),
    entrySceneAssets: sceneAssets[game.script.entry_scene_id] ?? [],
    sceneAssets,
    nextScenes,
    legacyPreloadHints: assets.filter((asset) => asset.preload).map((asset) => asset.asset_id),
  };
}

function assetIsBlocking(asset: AssetManifestItem): boolean {
  return !["font", "bgm", "sfx", "voice", "video"].includes(asset.asset_type);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = ASSET_LOAD_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("asset preparation timed out")), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function prepareImage(url: string): Promise<void> {
  return withTimeout(new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (typeof image.decode === "function") {
        void image.decode()
          .catch(() => {
            // error-log-ignore: 图片已经触发 load；部分浏览器不支持异步解码，继续使用已加载图片。
            return undefined;
          })
          .finally(resolve);
      } else {
        resolve();
      }
    };
    image.onerror = () => reject(new Error(`image failed to load: ${url}`));
    image.src = url;
  }));
}

function prepareMedia(url: string, kind: "audio" | "video"): Promise<void> {
  return withTimeout(new Promise<void>((resolve, reject) => {
    const media = document.createElement(kind);
    const cleanup = () => {
      media.removeAttribute("src");
      media.load();
    };
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      cleanup();
      resolve();
    };
    media.onerror = () => {
      cleanup();
      reject(new Error(`${kind} metadata failed to load: ${url}`));
    };
    media.src = url;
    media.load();
  }));
}

async function prepareGeneric(url: string, sizeBytes: number): Promise<void> {
  if (sizeBytes > 1024 * 1024) return;
  const response = await withTimeout(fetch(url, { cache: "force-cache" }));
  if (!response.ok) throw new Error(`asset request failed with ${response.status}: ${url}`);
  await response.arrayBuffer();
}

class ProgressiveAssetLoader {
  private game?: LibraryGame;
  private index?: StartupIndex;
  private generation = 0;
  private paused = false;
  private prepared = new Set<string>();
  private inFlight = new Map<string, Promise<void>>();

  configure(game: LibraryGame): void {
    this.generation += 1;
    this.game = game;
    this.index = game.startupIndex ?? deriveStartupIndex(game);
    this.prepared.clear();
    this.inFlight.clear();
  }

  clear(): void {
    this.generation += 1;
    this.game = undefined;
    this.index = undefined;
    this.prepared.clear();
    this.inFlight.clear();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  warmEntry(): void {
    const generation = this.generation;
    const run = () => {
      if (generation !== this.generation || this.paused || document.visibilityState === "hidden") return;
      void this.prepareAssetIds(this.index?.entrySceneAssets ?? [], {
        phase: "entry",
        budgetBytes: SCENE_PREWARM_BUDGET_BYTES,
      });
    };
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(run, { timeout: 1200 });
    } else {
      globalThis.setTimeout(run, 180);
    }
  }

  async prepareEntry(
    timeoutMs: number,
    onProgress?: (progress: AssetPreparationProgress) => void,
  ): Promise<boolean> {
    let acceptingProgress = true;
    const preparation = this.prepareAssetIds(this.index?.entrySceneAssets ?? [], {
      phase: "entry",
      budgetBytes: SCENE_PREWARM_BUDGET_BYTES,
      blockingOnly: true,
      onProgress: (progress) => {
        if (acceptingProgress) onProgress?.(progress);
      },
    }).then(() => {
      acceptingProgress = false;
      return true;
    });
    const timedOut = new Promise<boolean>((resolve) => window.setTimeout(() => {
      acceptingProgress = false;
      resolve(false);
    }, timeoutMs));
    return Promise.race([preparation, timedOut]);
  }

  warmSuccessors(sceneId: string): void {
    if (!this.index || !sceneId || this.paused || document.visibilityState === "hidden") return;
    const successors = this.index.nextScenes[sceneId] ?? [];
    const assetIds = successors.flatMap((nextSceneId) => this.index?.sceneAssets[nextSceneId] ?? []);
    if (assetIds.length === 0) return;
    const generation = this.generation;
    const run = () => {
      if (generation !== this.generation || this.paused || document.visibilityState === "hidden") return;
      void this.prepareAssetIds(assetIds, {
        phase: "scene",
        budgetBytes: SCENE_PREWARM_BUDGET_BYTES,
      });
    };
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(run, { timeout: 1500 });
    } else {
      globalThis.setTimeout(run, 240);
    }
  }

  private async prepareAsset(asset: AssetManifestItem): Promise<void> {
    if (this.prepared.has(asset.asset_id)) return;
    const existing = this.inFlight.get(asset.asset_id);
    if (existing) return existing;
    const url = this.game?.assetUrls[asset.asset_id] ?? this.game?.assetUrls[asset.path];
    if (!url) return;
    const metadata = this.index?.files[asset.path];
    const mime = asset.mime_type ?? metadata?.mimeType ?? "";
    const promise = (async () => {
      if (mime.startsWith("image/")) await prepareImage(url);
      else if (mime.startsWith("audio/")) await prepareMedia(url, "audio");
      else if (mime.startsWith("video/")) await prepareMedia(url, "video");
      else if (!mime.startsWith("font/")) await prepareGeneric(url, metadata?.sizeBytes ?? 0);
      this.prepared.add(asset.asset_id);
    })().finally(() => {
      this.inFlight.delete(asset.asset_id);
    });
    this.inFlight.set(asset.asset_id, promise);
    return promise;
  }

  private async prepareAssetIds(assetIds: string[], options: PrepareOptions): Promise<void> {
    const game = this.game;
    const index = this.index;
    if (!game || !index) return;
    const unique = [...new Set(assetIds)];
    const selected: Array<{ asset: AssetManifestItem; sizeBytes: number }> = [];
    let selectedBytes = 0;
    for (const assetId of unique) {
      const asset = game.manifest.assets.find((candidate) => candidate.asset_id === assetId);
      if (!asset || (options.blockingOnly && !assetIsBlocking(asset))) continue;
      const sizeBytes = Math.max(0, index.files[asset.path]?.sizeBytes ?? 0);
      if (sizeBytes > options.budgetBytes || selectedBytes + sizeBytes > options.budgetBytes) continue;
      selected.push({ asset, sizeBytes });
      selectedBytes += sizeBytes;
    }
    let loadedBytes = selected
      .filter(({ asset }) => this.prepared.has(asset.asset_id))
      .reduce((total, item) => total + item.sizeBytes, 0);
    const pending = selected.filter(({ asset }) => !this.prepared.has(asset.asset_id));
    const emit = (assetId?: string) => options.onProgress?.({
      phase: options.phase,
      loadedBytes,
      totalBytes: selectedBytes,
      percent: selectedBytes > 0 ? Math.min(100, Math.round((loadedBytes / selectedBytes) * 100)) : 100,
      assetId,
    });
    emit();
    let cursor = 0;
    const workers = Array.from({ length: Math.min(PREWARM_CONCURRENCY, pending.length) }, async () => {
      while (cursor < pending.length) {
        if (this.paused && !options.blockingOnly) return;
        const current = pending[cursor++];
        try {
          await this.prepareAsset(current.asset);
          loadedBytes += current.sizeBytes;
        } catch (error) {
          console.warn(`[AgentVN Player] Asset prewarm skipped: ${current.asset.asset_id}`, error);
        }
        emit(current.asset.asset_id);
      }
    });
    await Promise.all(workers);
    emit();
  }
}

export const progressiveAssetLoader = new ProgressiveAssetLoader();
