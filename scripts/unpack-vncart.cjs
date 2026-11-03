const fs = require("node:fs");
const path = require("node:path");

function requireFromCandidates(candidates) {
  const errors = [];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Unable to load jszip. Tried: ${errors.join(" | ")}`);
}

const JSZip = requireFromCandidates([
  path.join(__dirname, "..", "editor", "node_modules", "jszip"),
  path.join(__dirname, "..", "GameCli_framework", "node_modules", "jszip"),
  "jszip",
]);

const [cartridgePath, outputDir] = process.argv.slice(2);
if (!cartridgePath || !outputDir) {
  throw new Error("Usage: node scripts/unpack-vncart.cjs <cartridge.vncart> <output-dir>");
}

const root = path.resolve(outputDir);
const source = path.resolve(cartridgePath);
const forbidden = /\.(exe|dll|bat|cmd|sh|ps1|msi|app|apk|jar)$/i;

function safeEntryPath(name) {
  if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/") || /^[a-z]:/i.test(name)) {
    throw new Error(`Unsafe cartridge entry path: ${name}`);
  }
  const normalized = path.posix.normalize(name);
  if (normalized === ".." || normalized.startsWith("../") || forbidden.test(normalized)) {
    throw new Error(`Unsafe cartridge entry path: ${name}`);
  }
  return normalized;
}

async function main() {
  const bytes = await fs.promises.readFile(source);
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  await fs.promises.rm(root, { recursive: true, force: true });
  await fs.promises.mkdir(root, { recursive: true });
  for (const entry of entries) {
    const relative = safeEntryPath(entry.name);
    const target = path.join(root, ...relative.split("/"));
    const resolved = path.resolve(target);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      throw new Error(`Cartridge entry escaped output directory: ${entry.name}`);
    }
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, await entry.async("nodebuffer"));
  }
  for (const required of ["manifest.json", "script.json", "checksum.json"]) {
    if (!fs.existsSync(path.join(root, required))) throw new Error(`Unpacked cartridge is missing ${required}.`);
  }
  console.log(JSON.stringify({ ok: true, entries: entries.length, outputDir: root }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
