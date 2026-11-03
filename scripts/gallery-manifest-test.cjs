#!/usr/bin/env node
"use strict";

const path = require("node:path");
const esbuild = require("../editor/node_modules/esbuild");

const root = path.resolve(__dirname, "..");
const source = `
  import { buildGalleryManifestFromScript } from "./shared/cartridge/gallery";

  const script = {
    schema_version: "1.0.0",
    game_id: "gallery_manifest_test",
    title: "Gallery manifest test",
    entry_scene_id: "scene_opening",
    scenes: [
      {
        scene_id: "scene_opening",
        title: "Opening",
        summary: "",
        chapter: 1,
        tags: [],
        commands: [
          { type: "show_image", image_id: "cg_01", image_display_name: "CG 01" },
          {
            type: "gallery_anchor",
            anchor_id: "gallery_cg_01",
            title: "雨夜告白",
            asset_id: "cg_01",
            description: "第一张 CG",
          },
        ],
      },
    ],
  };

  const manifest = buildGalleryManifestFromScript(script);
  if (manifest.gallery_version !== "1.0.0") throw new Error("gallery manifest version must be stable");
  if (manifest.items.length !== 1) throw new Error("every gallery anchor must produce one gallery item");
  const [item] = manifest.items;
  if (
    item.item_id !== "gallery_cg_01"
    || item.anchor_id !== "gallery_cg_01"
    || item.scene_id !== "scene_opening"
    || item.command_index !== 1
    || item.title !== "雨夜告白"
    || item.asset_id !== "cg_01"
    || item.description !== "第一张 CG"
  ) {
    throw new Error("gallery item did not preserve authored metadata");
  }

  console.log("gallery manifest test OK");
`;

const result = esbuild.buildSync({
  stdin: {
    contents: source,
    resolveDir: root,
    sourcefile: "gallery-manifest-test.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  target: "node20",
  logLevel: "silent",
});

new Function("require", "module", "exports", result.outputFiles[0].text)(
  require,
  { exports: {} },
  {},
);
