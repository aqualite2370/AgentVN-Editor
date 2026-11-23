const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const args = process.argv.slice(2);
const embeddedDir = path.resolve(args[0] || "");
const reportPath = path.resolve(option("--report") || path.join(embeddedDir, "android-audio-normalization.json"));
const compatibleExtensions = new Set([".mp3", ".m4a", ".aac"]);

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : "";
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, filePath);
}

function readJson(filePath) {
  const bytes = fs.readFileSync(filePath);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  if (text.includes("\uFFFD")) throw new Error(`ENCODING_INVALID: ${filePath}`);
  return JSON.parse(text);
}

function safeResourcePath(value) {
  if (
    typeof value !== "string"
    || !value
    || value.includes("\0")
    || value.includes("\\")
    || value.startsWith("/")
    || /^[A-Za-z]:/.test(value)
  ) {
    throw new Error(`Unsafe packaged audio path: ${value}`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Unsafe packaged audio path: ${value}`);
  }
  return normalized;
}

function absoluteResourcePath(relativePath) {
  const target = path.resolve(embeddedDir, ...safeResourcePath(relativePath).split("/"));
  if (target !== embeddedDir && !target.startsWith(`${embeddedDir}${path.sep}`)) {
    throw new Error(`Packaged audio escaped its root: ${relativePath}`);
  }
  return target;
}

function executableCandidates(name) {
  const extension = process.platform === "win32" ? ".exe" : "";
  const explicit = process.env[`AGENTVN_${name.toUpperCase()}_PATH`];
  return [
    explicit,
    path.join(__dirname, "tools", `${name}${extension}`),
    path.join(__dirname, "..", "tools", "ffmpeg", `${name}${extension}`),
    name,
  ].filter(Boolean);
}

function findExecutable(name) {
  for (const candidate of executableCandidates(name)) {
    const result = spawnSync(candidate, ["-version"], { windowsHide: true, encoding: "utf8" });
    if (!result.error && result.status === 0) return candidate;
  }
  return undefined;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function fail(error, report) {
  const message = error instanceof Error ? error.message : String(error);
  writeJsonAtomic(reportPath, { ...report, ok: false, failureCode: "AUDIO_TRANSCODE_FAILED", error: message });
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const baseReport = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  embeddedDir,
  tracks: [],
  converted: 0,
  kept: 0,
};

try {
  if (!fs.statSync(embeddedDir).isDirectory()) throw new Error(`Embedded cartridge directory is missing: ${embeddedDir}`);
  const manifestPath = path.join(embeddedDir, "manifest.json");
  const scriptPath = path.join(embeddedDir, "script.json");
  const manifest = readJson(manifestPath);
  const script = readJson(scriptPath);
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const tracks = Array.isArray(script.opening_audio) ? script.opening_audio : [];
  const ffmpeg = findExecutable("ffmpeg");
  const ffprobe = findExecutable("ffprobe");

  for (const track of tracks) {
    const asset = assets.find((item) => item?.asset_id === track?.asset_id);
    if (!asset) throw new Error(`Opening audio asset is missing from manifest: ${track?.asset_id}`);
    const oldRelative = safeResourcePath(asset.path);
    const oldPath = absoluteResourcePath(oldRelative);
    if (!fs.statSync(oldPath).isFile()) throw new Error(`Opening audio file is missing: ${oldRelative}`);
    const extension = path.posix.extname(oldRelative).toLowerCase();
    if (compatibleExtensions.has(extension)) {
      baseReport.kept += 1;
      baseReport.tracks.push({
        assetId: asset.asset_id,
        status: "kept-compatible",
        path: oldRelative,
        mimeType: asset.mime_type,
        bytes: fs.statSync(oldPath).size,
      });
      continue;
    }
    if (!ffmpeg || !ffprobe) {
      throw new Error(
        `AUDIO_TRANSCODE_FAILED: ${asset.asset_id} uses ${extension || "an unknown format"}, but bundled ffmpeg/ffprobe is unavailable.`,
      );
    }
    const probe = spawnSync(ffprobe, [
      "-v", "error",
      "-show_entries", "stream=codec_type,codec_name",
      "-of", "json",
      oldPath,
    ], { windowsHide: true, encoding: "utf8" });
    if (probe.status !== 0) throw new Error(`ffprobe failed for ${asset.asset_id}: ${probe.stderr || probe.stdout}`);
    const newRelative = safeResourcePath(`${oldRelative.slice(0, -extension.length)}.m4a`);
    const newPath = absoluteResourcePath(newRelative);
    const temporary = `${newPath}.tmp-${process.pid}.m4a`;
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    const conversion = spawnSync(ffmpeg, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-i", oldPath,
      "-vn", "-c:a", "aac", "-profile:a", "aac_low", "-b:a", "192k", "-movflags", "+faststart",
      temporary,
    ], { windowsHide: true, encoding: "utf8" });
    if (conversion.status !== 0 || !fs.existsSync(temporary)) {
      fs.rmSync(temporary, { force: true });
      throw new Error(`ffmpeg failed for ${asset.asset_id}: ${conversion.stderr || conversion.stdout}`);
    }
    fs.renameSync(temporary, newPath);
    if (newPath !== oldPath) fs.rmSync(oldPath, { force: true });
    asset.path = newRelative;
    asset.filename = path.posix.basename(newRelative);
    asset.mime_type = "audio/mp4";
    asset.size_bytes = fs.statSync(newPath).size;
    asset.hash_sha256 = sha256File(newPath);
    baseReport.converted += 1;
    baseReport.tracks.push({
      assetId: asset.asset_id,
      status: "converted",
      originalPath: oldRelative,
      path: newRelative,
      mimeType: "audio/mp4",
      bytes: asset.size_bytes,
      sha256: asset.hash_sha256,
    });
  }

  writeJsonAtomic(manifestPath, manifest);
  writeJsonAtomic(reportPath, {
    ...baseReport,
    ok: true,
    ffmpeg: ffmpeg || null,
    ffprobe: ffprobe || null,
  });
} catch (error) {
  fail(error, baseReport);
}
