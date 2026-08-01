import JSZip from "jszip";
import { downloadCartridge, exportEditorCartridge, type EditorCartridgeExportInput, type EditorCartridgeExportResult } from "../cartridge/exportCartridge";
import type { AssetManifestItem, GalleryManifest, GameManifest, RuntimeScript } from "../../../shared/cartridge/types";
import type { AssetRef } from "../types/assets";

export type PackageExportMode = "cartridge" | "standalone_package" | "standalone_project";
export type PackageTargetPlatform = "windows" | "android";

export interface RuntimeBundleExportResult {
  blob: Blob;
  fileName: string;
  manifest: GameManifest;
  script: RuntimeScript;
  gallery: GalleryManifest;
  assetReport: EditorCartridgeExportResult["assetReport"];
  warnings: string[];
}

function buildStandaloneReadme(gameTitle: string, platform: PackageTargetPlatform): string {
  const platformLabel = platform === "windows" ? "Windows" : "Android";
  const scriptName = platform === "windows" ? "scripts/build-runtime-standalone-windows.ps1" : "scripts/build-runtime-standalone-android.ps1";
  return [
    `${gameTitle} GameCLI 固定卡带容器工程`,
    "",
    `目标平台：${platformLabel}`,
    "",
    "这个压缩包包含：",
    "1. embedded-cartridge/game.vncart",
    "2. package-profile.json",
    "3. 本说明文件",
    "",
    "推荐构建方式：",
    `1. 保持 embedded-cartridge/game.vncart 不变。`,
    `2. 在项目根目录运行 ${scriptName} -CartridgePath <解压目录>/embedded-cartridge/game.vncart。`,
    "3. 运行端会以 GameCLI 固定卡带模式启动并打包。",
    "",
    "说明：",
    "这个工程包本质是 GameCLI 容器 + 固定内嵌卡带，不提供导入其他卡带的入口。",
    "它不会把编辑器布局、创作期设置或记忆数据库带入玩家端。",
  ].join("\n");
}

export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function exportStandaloneRuntimeBundle(
  input: EditorCartridgeExportInput & {
    targetPlatform: PackageTargetPlatform;
    projectAssets?: AssetManifestItem[];
    projectAssetRefs?: AssetRef[];
  }
): Promise<RuntimeBundleExportResult> {
  const cartridge = await exportEditorCartridge(input);
  const zip = new JSZip();
  const packageProfile = {
    mode: "gamecli_fixed_cartridge",
    target_platform: input.targetPlatform,
    game_id: cartridge.manifest.game_id,
    game_title: cartridge.manifest.title,
    game_version: cartridge.manifest.version,
    cartridge_cover_asset_id: cartridge.manifest.cover,
    shell_background_asset_id: cartridge.manifest.shell?.background,
    shell_icon_asset_id: cartridge.manifest.shell?.icon,
    standalone_icon_asset_id: input.packageAppearance?.standaloneIconAssetId ?? input.packageAppearance?.iconAssetId ?? input.packageAppearance?.coverAssetId,
    shell_settings_panel_background_asset_id: cartridge.manifest.shell?.settings_panel_background,
    shell_settings_entry_image_asset_id: cartridge.manifest.shell?.settings_entry_image,
    generated_at: new Date().toISOString(),
    gamecli_fixed_build_script:
      input.targetPlatform === "windows"
        ? "scripts/build-runtime-standalone-windows.ps1"
        : "scripts/build-runtime-standalone-android.ps1",
  };

  zip.file("embedded-cartridge/game.vncart", cartridge.blob);
  zip.file("package-profile.json", JSON.stringify(packageProfile, null, 2));
  zip.file("README-构建说明.txt", buildStandaloneReadme(cartridge.manifest.title, input.targetPlatform));

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return {
    blob,
    fileName: `${cartridge.manifest.game_id}-${cartridge.manifest.version}-${input.targetPlatform}-standalone.zip`,
    manifest: cartridge.manifest,
    script: input.script,
    gallery: cartridge.gallery,
    assetReport: cartridge.assetReport,
    warnings: cartridge.warnings,
  };
}

export async function exportPackagingArtifact(
  mode: PackageExportMode,
  input: EditorCartridgeExportInput & {
    targetPlatform: PackageTargetPlatform;
    projectAssets?: AssetManifestItem[];
    projectAssetRefs?: AssetRef[];
  }
): Promise<RuntimeBundleExportResult> {
  if (mode === "standalone_project") {
    return exportStandaloneRuntimeBundle(input);
  }

  const cartridge = await exportEditorCartridge(input);
  return {
    blob: cartridge.blob,
    fileName: cartridge.fileName,
    manifest: cartridge.manifest,
    script: input.script,
    gallery: cartridge.gallery,
    assetReport: cartridge.assetReport,
    warnings: cartridge.warnings,
  };
}

export function downloadPackagingArtifact(mode: PackageExportMode, result: RuntimeBundleExportResult): void {
  if (mode === "cartridge") {
    downloadCartridge(result.fileName, result.blob);
    return;
  }
  downloadBlob(result.fileName, result.blob);
}
