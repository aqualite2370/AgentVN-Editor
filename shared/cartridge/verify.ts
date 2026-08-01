import { packCartridgeToBlob } from "./packer";
import { loadCartridgeFromArrayBuffer } from "./unpacker";
import { validateAssetReferences, validateManifest, validateNoAIMetadata, validateNoEditorFields, validateRuntimeScript, validateSafePaths, validateNoExecutableFiles, validateVersionCompatibility } from "./validators";
import type { GalleryManifest, GameManifest, RuntimeScript } from "./types";

export async function runCartridgeVerification(): Promise<string[]> {
  const now = new Date().toISOString();
  const script: RuntimeScript = {
    schema_version: "1.1.0",
    game_id: "verify_game",
    title: "Verify Game",
    entry_scene_id: "start",
    scenes: [
      {
        scene_id: "start",
        title: "Start",
        summary: "Start",
        chapter: 1,
        tags: [],
        commands: [{ type: "choice", choices: [{ choice_id: "end", text: "End", target_scene_id: "end", conditions: [] }] }]
      },
      { scene_id: "end", title: "End", summary: "End", chapter: 1, tags: [], commands: [{ type: "narration", text: "Done" }], is_ending: true }
    ]
  };
  const manifest: GameManifest = {
    manifest_version: "1.0.0",
    cartridge_version: "1.0.0",
    runtime_version: "0.2.0",
    game_id: "verify_game",
    title: "Verify Game",
    author: "AgentVN",
    description: "Verification cartridge",
    version: "1.0.0",
    language: "zh-CN",
    tags: [],
    entry_script: "script.json",
    entry_scene_id: "start",
    assets: [],
    created_at: now,
    updated_at: now
  };
  const gallery: GalleryManifest = { gallery_version: "1.0.0", items: [] };
  const blob = await packCartridgeToBlob({ manifest, script, gallery, exportOptions: { includeGallery: true, includeMetadata: false } });
  const unpacked = await loadCartridgeFromArrayBuffer(await blob.arrayBuffer(), { runtimeVersion: "0.2.0" });
  const checks = [
    validateManifest(unpacked.manifest),
    validateRuntimeScript(unpacked.script, unpacked.manifest),
    validateAssetReferences(unpacked.script, unpacked.manifest),
    validateNoEditorFields(unpacked),
    validateNoAIMetadata(unpacked),
    validateSafePaths(["../bad"]),
    validateNoExecutableFiles(["assets/bad.exe"]),
    validateVersionCompatibility(unpacked.manifest, "0.2.0")
  ];
  return checks.map((result, index) => `check_${index}:${result.ok}`);
}
