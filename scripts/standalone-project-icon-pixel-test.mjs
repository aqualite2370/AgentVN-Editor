import fs from "node:fs";
import path from "node:path";
import JSZip from "../GameCli_framework/node_modules/jszip/lib/index.js";
import sharp from "../GameCli_framework/node_modules/sharp/dist/index.cjs";

const [apkArg, sourceArg] = process.argv.slice(2);
if (!apkArg || !sourceArg) {
  throw new Error("Usage: node scripts/standalone-project-icon-pixel-test.mjs <apk> <source-icon>");
}

const apkPath = path.resolve(apkArg);
const sourcePath = path.resolve(sourceArg);

async function rgbaAt48(input) {
  return sharp(input, { failOn: "error" })
    .ensureAlpha()
    .resize(48, 48, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
}

function mae(left, right) {
  if (left.info.width !== right.info.width || left.info.height !== right.info.height || left.info.channels !== right.info.channels) {
    throw new Error("Icon buffers have different dimensions.");
  }
  let sum = 0;
  let alphaWeight = 0;
  for (let i = 0; i < left.data.length; i += 4) {
    const alpha = (left.data[i + 3] + right.data[i + 3]) / 510;
    alphaWeight += alpha;
    for (let channel = 0; channel < 3; channel += 1) {
      sum += Math.abs(left.data[i + channel] - right.data[i + channel]) * (0.25 + alpha);
    }
    sum += Math.abs(left.data[i + 3] - right.data[i + 3]);
  }
  return sum / (left.data.length / 4 * 4 + alphaWeight * 3);
}

async function main() {
  if (!fs.existsSync(apkPath) || !fs.existsSync(sourcePath)) throw new Error("Icon comparison input is missing.");
  const source = await rgbaAt48(sourcePath);
  const zip = await JSZip.loadAsync(fs.readFileSync(apkPath), { checkCRC32: false });
  const iconEntries = Object.keys(zip.files).filter((name) => /^res\/.+\.png$/i.test(name) && /(?:launcher|9w|yn|FS|RJ|o-)/i.test(name));
  if (iconEntries.length === 0) throw new Error("No launcher icon PNG entries found in APK.");
  const comparisons = [];
  for (const entryName of iconEntries) {
    const entry = zip.file(entryName);
    if (!entry) continue;
    const actual = await rgbaAt48(await entry.async("nodebuffer"));
    comparisons.push({ entry: entryName, mae: mae(source, actual) });
  }
  const best = Math.min(...comparisons.map((item) => item.mae));
  const threshold = 24;
  if (!(best <= threshold)) {
    throw new Error(`APK icon does not match project source: best MAE ${best.toFixed(3)} > ${threshold}`);
  }
  console.log(JSON.stringify({ ok: true, apkPath, sourcePath, threshold, bestMae: best, comparisons }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
