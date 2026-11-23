const fs = require("node:fs");
const path = require("node:path");

const [sourcePath, outputPath, mode = "quality"] = process.argv.slice(2);
if (!sourcePath || !outputPath || !["quality", "lossless"].includes(mode)) {
  throw new Error("Usage: node scripts/optimize-release-image.cjs <source> <output> <quality|lossless>");
}

const repoRoot = path.resolve(__dirname, "..");

function loadSharp() {
  const candidates = [
    path.join(repoRoot, "GameCli_framework", "node_modules", "sharp"),
    path.join(repoRoot, "editor", "node_modules", "sharp"),
    path.join(repoRoot, "node_modules", "sharp"),
    "sharp",
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Try the next bundled location.
    }
  }
  throw new Error("sharp is not bundled with the AgentVN release toolchain.");
}

async function main() {
  const sharp = loadSharp();
  const pipeline = sharp(sourcePath, {
    failOn: "error",
    limitInputPixels: 268_402_689,
    sequentialRead: true,
  });
  const sourceMetadata = await pipeline.metadata();
  const resultInfo = await pipeline
    .webp(mode === "lossless"
      ? { lossless: true, effort: 6 }
      : { quality: 90, alphaQuality: 100, smartSubsample: true, effort: 5 })
    .toFile(outputPath);
  if (
    resultInfo.width !== sourceMetadata.width ||
    resultInfo.height !== sourceMetadata.height
  ) {
    fs.rmSync(outputPath, { force: true });
    throw new Error("converted dimensions differ from the source");
  }
  console.log(JSON.stringify({
    ok: true,
    sharpVersion: sharp.versions?.sharp ?? "available",
    width: resultInfo.width,
    height: resultInfo.height,
    sizeBytes: resultInfo.size,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
