const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const os = require("node:os");

let JSZip;
let sharp;
try {
  JSZip = require(path.join(__dirname, "..", "editor", "node_modules", "jszip"));
} catch {
  try {
    JSZip = require(path.join(__dirname, "..", "GameCli_framework", "node_modules", "jszip"));
  } catch {
    JSZip = require("jszip");
  }
}
try {
  sharp = require(path.join(__dirname, "..", "GameCli_framework", "node_modules", "sharp"));
} catch {
  sharp = require("sharp");
}

const args = process.argv.slice(2);
const apkPath = path.resolve(args[0] || "");
const releaseIdentity = JSON.parse(
  option("--release-identity-base64")
    ? Buffer.from(option("--release-identity-base64"), "base64").toString("utf8")
    : option("--release-identity") || "{}",
);
const reportPath = path.resolve(option("--report") || `${apkPath}.inspection.json`);

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

function findAapt() {
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk"),
  ].filter(Boolean);
  for (const root of roots) {
    const buildTools = path.join(root, "build-tools");
    if (!fs.existsSync(buildTools)) continue;
    const versions = fs.readdirSync(buildTools).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) {
      const candidate = path.join(buildTools, version, process.platform === "win32" ? "aapt.exe" : "aapt");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error("APK_METADATA_MISMATCH: aapt was not found in the validated Android SDK.");
}

function readApkBadging(filePath, aapt) {
  let temporaryDirectory = null;
  let input = filePath;
  try {
    if (process.platform === "win32" && /[^\x00-\x7F]/.test(filePath)) {
      // Some aapt builds cannot decode Unicode argv. Do not use a shell or
      // depend on 8.3 names; keep the original APK untouched.
      const candidates = [os.tmpdir()];
      let parent = path.dirname(filePath);
      while (parent !== path.dirname(parent)) {
        candidates.push(parent);
        parent = path.dirname(parent);
      }
      let lastError;
      for (const candidate of [...new Set(candidates)]) {
        if (/[^\x00-\x7F]/.test(candidate)) continue;
        try {
          temporaryDirectory = fs.mkdtempSync(path.join(candidate, "agentvn-aapt-"));
          break;
        } catch (error) { lastError = error; }
      }
      if (!temporaryDirectory) {
        throw new Error(`AAPT_ASCII_STAGING_UNAVAILABLE: ${lastError?.message || "no writable ASCII temporary parent"}`);
      }
      input = path.join(temporaryDirectory, "input.apk");
      fs.copyFileSync(filePath, input, fs.constants.COPYFILE_EXCL);
    }
    const result = spawnSync(aapt, ["dump", "badging", input], { encoding: "utf8", windowsHide: true });
    if (result.error || result.status !== 0) {
      throw new Error(`APK_METADATA_MISMATCH: aapt failed: ${result.error?.message || result.stderr || result.stdout}`);
    }
    return { stdout: result.stdout, aaptInputPath: input, temporaryInputUsed: Boolean(temporaryDirectory) };
  } finally {
    if (temporaryDirectory) {
      fs.rmSync(path.join(temporaryDirectory, "input.apk"), { force: true });
      fs.rmdirSync(temporaryDirectory);
    }
  }
}

function strictJson(bytes, label) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  if (text.includes("\uFFFD")) throw new Error(`ENCODING_INVALID: ${label} contains replacement characters.`);
  return JSON.parse(text);
}

function parseBadging(text) {
  const packageLine = text.split(/\r?\n/).find((line) => line.startsWith("package:")) || "";
  const applicationLine = text.split(/\r?\n/).find((line) => line.startsWith("application:")) || "";
  const value = (line, name) => new RegExp(`${name}='([^']*)'`).exec(line)?.[1] || "";
  const icons = [...text.matchAll(/^application-icon-(\d+):'([^']+)'$/gm)].map((match) => ({
    density: Number(match[1]),
    path: match[2],
  }));
  return {
    applicationId: value(packageLine, "name"),
    versionCode: Number(value(packageLine, "versionCode")),
    versionName: value(packageLine, "versionName"),
    label: value(applicationLine, "label"),
    icon: value(applicationLine, "icon"),
    icons,
  };
}

async function inspectIcon(zip, entryName) {
  const entry = zip.file(entryName);
  if (!entry) throw new Error(`APK_ICON_INVALID: APK icon entry is missing: ${entryName}`);
  const bytes = await entry.async("nodebuffer");
  const image = sharp(bytes, { failOn: "error" });
  const metadata = await image.metadata();
  const { data, info } = await image.ensureAlpha().resize(48, 48, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let opaque = 0;
  let difference = 0;
  const colors = new Set();
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = (y * info.width + x) * info.channels;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];
      if (a > 8) opaque += 1;
      colors.add(`${r},${g},${b},${a}`);
      if (x + 1 < info.width) {
        const next = index + info.channels;
        difference += (Math.abs(r - data[next]) + Math.abs(g - data[next + 1]) + Math.abs(b - data[next + 2])) / 3;
      }
    }
  }
  const pixels = info.width * info.height;
  const averageAdjacentDifference = difference / (info.height * (info.width - 1));
  const valid = Boolean(metadata.width && metadata.height)
    && opaque / pixels >= 0.05
    && colors.size >= 4
    && !(averageAdjacentDifference > 58 && colors.size > pixels * 0.7);
  return {
    path: entryName,
    width: metadata.width,
    height: metadata.height,
    bytes: bytes.length,
    opaqueRatio: opaque / pixels,
    sampledColors: colors.size,
    averageAdjacentDifference,
    valid,
  };
}

async function main() {
  if (!fs.statSync(apkPath).isFile()) throw new Error(`APK is missing: ${apkPath}`);
  const aapt = findAapt();
  const badgingProcess = readApkBadging(apkPath, aapt);
  const badging = parseBadging(badgingProcess.stdout);
  const metadataMatches = badging.applicationId === releaseIdentity.androidApplicationId
    && badging.versionName === releaseIdentity.versionName
    && badging.versionCode === releaseIdentity.versionCode
    && badging.label === releaseIdentity.title;

  const zip = await JSZip.loadAsync(fs.readFileSync(apkPath), { checkCRC32: false });
  const root = "assets/embedded-cartridge/";
  const requiredEntries = ["manifest.json", "script.json", "checksum.json", "startup-index.json"];
  const missingEntries = requiredEntries.filter((name) => !zip.file(`${root}${name}`));
  if (missingEntries.length > 0) {
    throw new Error(`PACKAGED_RESOURCE_SMOKE_FAILED: APK is missing embedded cartridge entries: ${missingEntries.join(", ")}`);
  }
  const manifest = strictJson(await zip.file(`${root}manifest.json`).async("uint8array"), "manifest.json");
  const script = strictJson(await zip.file(`${root}script.json`).async("uint8array"), "script.json");
  const checksum = strictJson(await zip.file(`${root}checksum.json`).async("uint8array"), "checksum.json");
  const startupIndex = strictJson(await zip.file(`${root}startup-index.json`).async("uint8array"), "startup-index.json");
  const openingAudio = [];
  for (const track of script.opening_audio || []) {
    const asset = (manifest.assets || []).find((item) => item.asset_id === track.asset_id);
    const entry = asset && zip.file(`${root}${asset.path}`);
    const checksumEntry = asset && (checksum.files || []).find((item) => item.path === asset.path);
    const startupEntry = asset && startupIndex.files?.[asset.path];
    const consistent = Boolean(asset && entry && checksumEntry && startupEntry)
      && Number(asset.size_bytes) === Number(checksumEntry.size_bytes)
      && Number(asset.size_bytes) === Number(startupEntry.sizeBytes)
      && String(asset.hash_sha256 || "").toLowerCase() === String(checksumEntry.hash_sha256 || "").toLowerCase()
      && String(asset.hash_sha256 || "").toLowerCase() === String(startupEntry.sha256 || "").toLowerCase();
    openingAudio.push({ assetId: track.asset_id, path: asset?.path, mimeType: asset?.mime_type, consistent });
  }
  const uniqueIconPaths = [...new Set(badging.icons.map((item) => item.path))];
  const icons = [];
  for (const iconPath of uniqueIconPaths) icons.push(await inspectIcon(zip, iconPath));
  const iconValid = icons.length > 0 && icons.every((icon) => icon.valid);
  const audioValid = openingAudio.every((item) => item.consistent);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    apkPath,
    aaptInputPath: badgingProcess.aaptInputPath,
    temporaryInputUsed: badgingProcess.temporaryInputUsed,
    temporaryInputCleanupStatus: "PASS",
    ok: metadataMatches && iconValid && audioValid,
    releaseIdentity,
    badging,
    metadataMatches,
    iconValid,
    icons,
    utf8: {
      ok: true,
      title: manifest.title,
      gameId: manifest.game_id,
    },
    audioValid,
    openingAudio,
  };
  writeJsonAtomic(reportPath, report);
  if (!metadataMatches) throw new Error(`APK_METADATA_MISMATCH: expected ${JSON.stringify(releaseIdentity)}, got ${JSON.stringify(badging)}`);
  if (!iconValid) throw new Error("APK_ICON_INVALID: one or more launcher icons failed visual validation.");
  if (!audioValid) throw new Error("PACKAGED_RESOURCE_SMOKE_FAILED: opening audio references are inconsistent.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (!fs.existsSync(reportPath)) {
    writeJsonAtomic(reportPath, { schemaVersion: 1, generatedAt: new Date().toISOString(), apkPath, ok: false, error: message });
  }
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
