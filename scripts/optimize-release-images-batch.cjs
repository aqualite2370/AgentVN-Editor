const fs = require("node:fs");
const path = require("node:path");

const [jobsPath, resultsPath] = process.argv.slice(2);
if (!jobsPath || !resultsPath) {
  throw new Error("Usage: node scripts/optimize-release-images-batch.cjs <jobs.json> <results.json>");
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

function writeResults(results) {
  const temporaryPath = `${resultsPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, resultsPath);
}

async function main() {
  const sharp = loadSharp();
  sharp.cache(false);
  sharp.concurrency(1);
  const jobs = JSON.parse(fs.readFileSync(jobsPath, "utf8"));
  const results = [];
  for (const job of jobs) {
    try {
      const pipeline = sharp(job.sourcePath, {
        failOn: "error",
        limitInputPixels: 268_402_689,
        sequentialRead: true,
      });
      const sourceMetadata = await pipeline.metadata();
      const resultInfo = await pipeline
        .webp(job.mode === "lossless"
          ? { lossless: true, effort: 6 }
          : { quality: 90, alphaQuality: 100, smartSubsample: true, effort: 5 })
        .toFile(job.outputPath);
      if (
        resultInfo.width !== sourceMetadata.width ||
        resultInfo.height !== sourceMetadata.height
      ) {
        throw new Error("converted dimensions differ from the source");
      }
      results.push({
        assetId: job.assetId,
        ok: true,
        sizeBytes: resultInfo.size,
        width: resultInfo.width,
        height: resultInfo.height,
        sharpVersion: sharp.versions?.sharp ?? "available",
      });
    } catch (error) {
      fs.rmSync(job.outputPath, { force: true });
      results.push({
        assetId: job.assetId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    writeResults(results);
  }
  console.log(JSON.stringify({
    ok: true,
    processed: results.length,
    optimized: results.filter((item) => item.ok).length,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
