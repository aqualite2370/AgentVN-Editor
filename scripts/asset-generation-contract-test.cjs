#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "output", "asset-generation-contract");
const bundlePath = path.join(outDir, "asset-generation-contract-bundle.cjs");

function requireEsbuild() {
  const candidates = [
    path.join(root, "editor", "node_modules", "esbuild"),
    "esbuild",
  ];
  const errors = [];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      errors.push(candidate + ": " + error.message);
    }
  }
  throw new Error("Unable to load esbuild. Tried: " + errors.join(" | "));
}

function bundlePublicInterface() {
  fs.mkdirSync(outDir, { recursive: true });
  const esbuild = requireEsbuild();
  esbuild.buildSync({
    stdin: {
      contents: [
        'export * from "./editor/src/asset-generation/session";',
        'export * from "./editor/src/asset-generation/saving";',
        'export { OpenAICompatibleImageProvider } from "./editor/src/providers/imageProviders";',
        'export { hydrateApiKeys } from "./editor/src/providers/apiKeyStorage";',
      ].join("\n"),
      resolveDir: root,
      sourcefile: "asset-generation-contract-entry.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "browser",
    format: "cjs",
    outfile: bundlePath,
  });
  delete require.cache[bundlePath];
  return require(bundlePath);
}

function providerConfig(patch = {}) {
  return {
    provider_id: patch.provider_id || "provider_image",
    connection_id: patch.connection_id || "connection_image",
    model_id: patch.model_id || "image-model",
    provider_type: patch.provider_type || "openai_compatible",
    display_name: patch.display_name || "Image model",
    connection_name: patch.connection_name || "Image connection",
    base_url: patch.base_url || "https://example.test/v1",
    model: patch.model || "image-model",
    api_key_storage: patch.api_key_storage || "local",
    capabilities: patch.capabilities || ["image_generation"],
    enabled: patch.enabled ?? true,
    is_relay: patch.is_relay ?? false,
    safety_level: patch.safety_level || "standard",
    default_parameters: patch.default_parameters || {},
  };
}

function dataCandidate(mod, patch = {}) {
  return {
    image_id: patch.image_id || "candidate one",
    blob_url: patch.blob_url || "data:image/png;base64,aGVsbG8=",
    mime_type: patch.mime_type || "image/png",
    width: patch.width || 1024,
    height: patch.height || 576,
    seed: patch.seed,
    metadata: patch.metadata || {},
    resultId: patch.resultId || "result_one",
    providerId: patch.providerId || "provider_image",
    model: patch.model || "image-model",
    prompt: patch.prompt || "rainy station",
    revisedPrompt: patch.revisedPrompt,
    warnings: patch.warnings || [],
    issues: patch.issues || [],
    canSave: patch.canSave ?? true,
    saveBlockedReason: patch.saveBlockedReason,
  };
}

async function main() {
  const mod = bundlePublicInterface();

  assert.deepEqual(mod.defaultImageSizeForAssetType("background"), { aspectRatio: "16:9", width: 1024, height: 576 });
  assert.deepEqual(mod.defaultImageSizeForAssetType("sprite"), { aspectRatio: "3:4", width: 768, height: 1024 });
  assert.deepEqual(mod.defaultImageSizeForAssetType("portrait"), { aspectRatio: "3:4", width: 768, height: 1024 });
  assert.deepEqual(mod.defaultImageSizeForAssetType("ui"), { aspectRatio: "1:1", width: 1024, height: 1024 });

  const missingProvider = mod.buildImageGenerationRequest({
    prompt: "",
    assetType: "background",
    referenceImages: [],
    count: 2,
  }, undefined);
  assert.equal(missingProvider.ok, false);
  assert(missingProvider.issues.some((issue) => issue.code === "missing_prompt"));
  assert(missingProvider.issues.some((issue) => issue.code === "missing_provider"));

  const invalidCount = mod.buildImageGenerationRequest({
    prompt: "rainy station",
    assetType: "background",
    referenceImages: [],
    count: 12,
  }, providerConfig());
  assert.equal(invalidCount.ok, false);
  assert(invalidCount.issues.some((issue) => issue.code === "invalid_count"));

  const completed = await mod.runAssetGenerationSession({
    draft: {
      prompt: "rainy station",
      negativePrompt: "low quality",
      assetType: "background",
      stylePreset: "anime_visual_novel",
      referenceImages: [],
      count: 2,
    },
    provider: providerConfig(),
    imageProvider: {
      generateImage: async (request) => ({
        result_id: "result_two",
        provider_id: request.provider_id,
        model: request.model,
        revised_prompt: "rainy station, visual novel",
        created_at: "2026-06-28T00:00:00.000Z",
        warnings: ["mock warning"],
        images: [
          { image_id: "img_a", blob_url: "data:image/png;base64,YQ==", mime_type: "image/png", width: request.width, height: request.height, metadata: {} },
          { image_id: "img_b", blob_url: "", mime_type: "image/png", width: request.width, height: request.height, metadata: {} },
        ],
      }),
    },
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.candidates.length, 2);
  assert.equal(completed.candidates[0].resultId, "result_two");
  assert.equal(completed.candidates[0].revisedPrompt, "rainy station, visual novel");
  assert.equal(completed.candidates[1].canSave, false);
  assert(completed.warnings.includes("mock warning"));

  const failed = await mod.runAssetGenerationSession({
    draft: { prompt: "rainy station", assetType: "background", referenceImages: [], count: 1 },
    provider: providerConfig(),
    imageProvider: {
      generateImage: async () => {
        throw new Error("provider exploded");
      },
    },
  });
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /provider exploded/);

  const savedData = await mod.saveGeneratedAssetCandidate(dataCandidate(mod), {
    assetType: "background",
    usedAssetIds: new Set(["candidate_one"]),
    licenseNote: "model license checked",
    now: () => "2026-06-28T00:00:00.000Z",
  });
  assert.equal(savedData.asset_id, "candidate_one_2");
  assert.equal(savedData.asset_type, "background");
  assert(savedData.blob_url.startsWith("data:image/png;base64,"));
  assert(!savedData.blob_url.startsWith("blob:"));
  assert(savedData.project_path.startsWith("assets/background/"));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("blob:")) {
      return {
        ok: true,
        blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      };
    }
    throw new Error("network unavailable");
  };
  const savedBlob = await mod.saveGeneratedAssetCandidate(dataCandidate(mod, { image_id: "blob image", blob_url: "blob:test-image" }), {
    assetType: "ui",
    usedAssetIds: new Set(),
    licenseNote: "",
    now: () => "2026-06-28T00:00:00.000Z",
  });
  assert(savedBlob.blob_url.startsWith("data:image/png;base64,"));
  assert.equal(savedBlob.filename.endsWith(".png"), true);

  await assert.rejects(
    () => mod.saveGeneratedAssetCandidate(dataCandidate(mod, { image_id: "remote image", blob_url: "https://cdn.example.test/image.png" }), {
      assetType: "background",
      usedAssetIds: new Set(),
      licenseNote: "",
    }),
    /无法把生成图片转换为可导出的 data_url|data_url|exportable/i,
  );

  const requests = [];
  mod.hydrateApiKeys({ connection_image: "sk-test" });
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : undefined });
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: "aW1hZ2U=", revised_prompt: "revised prompt" }] }),
      text: async () => "",
    };
  };
  const openaiProvider = new mod.OpenAICompatibleImageProvider(providerConfig());
  const openaiResult = await openaiProvider.generateImage({
    prompt: "rainy station",
    negative_prompt: "low quality",
    reference_images: [{ image_id: "ref", source: "upload", blob_url: "data:image/png;base64,cmVm", weight: 0.7 }],
    style_preset: "anime_visual_novel",
    asset_type: "background",
    aspect_ratio: "16:9",
    width: 1024,
    height: 576,
    count: 1,
    provider_id: "provider_image",
    model: "image-model",
    safety_level: "standard",
  });
  assert.equal(requests[0].url, "https://example.test/v1/images/generations");
  assert.equal(requests[0].body.size, "1024x576");
  assert(openaiResult.warnings.some((warning) => warning.includes("参考图")));
  assert(openaiResult.warnings.some((warning) => warning.includes("反向提示词")));

  requests.length = 0;
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : undefined });
    return {
      ok: true,
      status: 200,
      json: async () => ({ predictions: [{ bytesBase64Encoded: "aW1hZ2U=", mimeType: "image/png" }] }),
      text: async () => "",
    };
  };
  const geminiProvider = new mod.OpenAICompatibleImageProvider(providerConfig({
    base_url: "https://generativelanguage.googleapis.com/v1beta",
    model: "imagen-4.0-generate-001",
  }));
  const geminiResult = await geminiProvider.generateImage({
    prompt: "rainy station",
    negative_prompt: "low quality",
    reference_images: [{ image_id: "ref", source: "upload", blob_url: "data:image/png;base64,cmVm", weight: 0.7 }],
    style_preset: "anime_visual_novel",
    asset_type: "background",
    aspect_ratio: "16:9",
    width: 1024,
    height: 576,
    count: 1,
    provider_id: "provider_image",
    model: "imagen-4.0-generate-001",
    safety_level: "standard",
  });
  assert(requests[0].url.includes(":predict"));
  assert.equal(requests[0].body.parameters.aspectRatio, "16:9");
  assert(geminiResult.warnings.some((warning) => warning.includes("精确宽高")));
  assert(geminiResult.warnings.some((warning) => warning.includes("参考图")));

  globalThis.fetch = originalFetch;
  console.log("asset-generation-contract-test: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
