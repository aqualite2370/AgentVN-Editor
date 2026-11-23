const fs = require("node:fs");
const path = require("node:path");

const [sourcePath, outputPath, textPath] = process.argv.slice(2);
if (!sourcePath || !outputPath || !textPath) {
  throw new Error("Usage: node scripts/subset-release-font.cjs <source> <output> <text-file>");
}

const repoRoot = path.resolve(__dirname, "..");

function loadSubsetFont() {
  const candidates = [
    path.join(repoRoot, "GameCli_framework", "node_modules", "subset-font"),
    path.join(repoRoot, "editor", "node_modules", "subset-font"),
    path.join(repoRoot, "node_modules", "subset-font"),
    "subset-font",
  ];
  for (const candidate of candidates) {
    try {
      const module = require(candidate);
      return module.default ?? module;
    } catch {
      // Try the next bundled location.
    }
  }
  throw new Error("subset-font is not bundled with the AgentVN release toolchain.");
}

async function main() {
  const subsetFont = loadSubsetFont();
  const subsetBuffer = await subsetFont(
    fs.readFileSync(sourcePath),
    fs.readFileSync(textPath, "utf8"),
    { targetFormat: "woff2" },
  );
  fs.writeFileSync(outputPath, subsetBuffer);
  console.log(JSON.stringify({
    ok: true,
    subsetFontVersion: "2.5.0",
    sizeBytes: subsetBuffer.length,
  }));
}

main().catch((error) => {
  fs.rmSync(outputPath, { force: true });
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
