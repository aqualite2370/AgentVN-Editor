const { analyze } = require("./lib/e2-etw-image-stack-analysis.cjs");

async function main() {
  const [, , root, stackAnalysisPath, outputPath] = process.argv;
  if (!root || !stackAnalysisPath || process.argv.length > 5) {
    throw new Error("Usage: node scripts/e2-etw-image-stack-analysis.cjs <capture-root> <stack-analysis.json> [new output.json]");
  }
  const result = await analyze(root, stackAnalysisPath, outputPath);
  process.stdout.write(`${JSON.stringify({
    outputPath: result.outputPath,
    targetImageEventCount: result.imageEventCount,
    targetStateFiveSwitchOutStackCount: result.mappedSamples.length,
    uniqueModules: result.uniqueModules,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
