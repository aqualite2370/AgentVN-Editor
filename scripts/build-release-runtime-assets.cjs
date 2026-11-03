const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const embeddedDir = args[0] ? path.resolve(args[0]) : "";

function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const profile = option("--profile", "balanced");
const explicitReportPath = option("--report", "");
const verbose = args.includes("--verbose");
const supportedProfiles = new Set(["balanced", "lossless", "off"]);

if (!embeddedDir || !supportedProfiles.has(profile)) {
  throw new Error(
    "Usage: node scripts/build-release-runtime-assets.cjs <embedded-dir> " +
    "[--profile balanced|lossless|off] [--report <path>]",
  );
}

const manifestPath = path.join(embeddedDir, "manifest.json");
const scriptPath = path.join(embeddedDir, "script.json");
const galleryPath = path.join(embeddedDir, "gallery.json");
const checksumPath = path.join(embeddedDir, "checksum.json");

function readJson(filePath, required = true) {
  if (!fs.existsSync(filePath)) {
    if (!required) return undefined;
    throw new Error(`Release resource input is missing ${path.relative(embeddedDir, filePath)}.`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function safeRelativePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[a-z]:/i.test(value)
  ) {
    throw new Error(`Unsafe release resource path: ${value}`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Unsafe release resource path: ${value}`);
  }
  return normalized;
}

function absoluteResourcePath(relativePath) {
  const safe = safeRelativePath(relativePath);
  const target = path.resolve(embeddedDir, ...safe.split("/"));
  if (target !== embeddedDir && !target.startsWith(`${embeddedDir}${path.sep}`)) {
    throw new Error(`Release resource escaped package root: ${relativePath}`);
  }
  return target;
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function syncManifestAssetMetadata(manifest) {
  for (const asset of manifest.assets ?? []) {
    if (!asset || typeof asset.path !== "string") continue;
    const relativePath = safeRelativePath(asset.path);
    const filePath = absoluteResourcePath(relativePath);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Release resource is missing for manifest asset ${asset.asset_id || relativePath}: ${relativePath}`);
    }
    const stat = fs.statSync(filePath);
    asset.size_bytes = stat.size;
    asset.hash_sha256 = sha256File(filePath);
    if (!asset.mime_type) asset.mime_type = mimeForPath(relativePath);
    asset.filename = path.posix.basename(relativePath);
  }
}

function removeFileIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function mimeForPath(relativePath) {
  switch (path.posix.extname(relativePath).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".svg": return "image/svg+xml";
    case ".wav": return "audio/wav";
    case ".mp3": return "audio/mpeg";
    case ".ogg": return "audio/ogg";
    case ".flac": return "audio/flac";
    case ".m4a": return "audio/mp4";
    case ".mp4": return "video/mp4";
    case ".webm": return "video/webm";
    case ".ttf": return "font/ttf";
    case ".otf": return "font/otf";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    case ".json": return "application/json";
    default: return "application/octet-stream";
  }
}

function bundledModuleAvailable(moduleName) {
  const candidates = [
    path.join(repoRoot, "GameCli_framework", "node_modules", moduleName),
    path.join(repoRoot, "editor", "node_modules", moduleName),
    path.join(repoRoot, "node_modules", moduleName),
    moduleName,
  ];
  for (const candidate of candidates) {
    try {
      require.resolve(candidate);
      return true;
    } catch {
      // Try the next bundled location.
    }
  }
  return false;
}

function runWorker(program, argumentsList) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, argumentsList, {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const maxBytes = 2 * 1024 * 1024;
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= maxBytes) stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= maxBytes) stderr.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const result = {
        status: code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0) resolve(result);
      else reject(new Error(
        [
          `worker exited with ${code ?? signal ?? "unknown status"}`,
          result.stderr.trim(),
          result.stdout.trim(),
        ].filter(Boolean).join(": "),
      ));
    });
  });
}

function runNodeWorker(argumentsList) {
  return runWorker(process.execPath, argumentsList);
}

async function resolvePillowCommand() {
  const candidates = [
    process.env.AGENTVN_PYTHON_PATH
      ? { program: process.env.AGENTVN_PYTHON_PATH, prefix: [] }
      : undefined,
    { program: "python", prefix: [] },
    { program: "py", prefix: ["-3"] },
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const result = await runWorker(candidate.program, [
        ...candidate.prefix,
        "-c",
        "import PIL; from PIL import features; assert features.check('webp'); print(PIL.__version__)",
      ]);
      return {
        ...candidate,
        version: result.stdout.trim(),
      };
    } catch {
      // Try the next Python command.
    }
  }
  return undefined;
}

function collectStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, output));
  }
  return output;
}

function rewriteStrings(value, replacements) {
  if (typeof value === "string") {
    let next = value;
    for (const [from, to] of replacements) next = next.split(from).join(to);
    return next;
  }
  if (Array.isArray(value)) return value.map((item) => rewriteStrings(item, replacements));
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) value[key] = rewriteStrings(value[key], replacements);
  }
  return value;
}

function referencedAssets(value, assetById, assetByPath) {
  const ids = new Set();
  for (const candidate of collectStrings(value)) {
    const normalized = candidate.startsWith("asset:") ? candidate.slice("asset:".length) : candidate;
    if (assetById.has(normalized)) ids.add(normalized);
    const byPath = assetByPath.get(candidate);
    if (byPath) ids.add(byPath.asset_id);
  }
  return [...ids];
}

function sceneSuccessors(scene) {
  const successors = [];
  const add = (value) => {
    if (typeof value === "string" && value && !successors.includes(value)) successors.push(value);
  };
  add(scene.next_scene_id);
  for (const command of scene.commands ?? []) {
    if (command.type === "choice") {
      for (const choice of command.choices ?? []) add(choice.target_scene_id);
    } else if (command.type === "jump") {
      add(command.target_scene_id);
    } else if (command.type === "conditional_jump") {
      add(command.target_scene_id);
      add(command.else_target_scene_id);
    }
  }
  return successors;
}

async function optimizeImages(manifest, mutableDocuments, report) {
  if (profile === "off") return [];
  const useSharp = bundledModuleAvailable("sharp");
  if (!useSharp) {
    report.warnings.push(
      "The isolated sharp worker is unavailable; image optimization was skipped and original images were kept.",
    );
    return [];
  }

  report.tools.sharp = "available";
  const replacements = [];
  const replacedSourcePaths = [];
  const occupiedPaths = new Set((manifest.assets ?? []).map((asset) => asset.path));
  const jobs = [];
  const records = new Map();
  for (const asset of manifest.assets ?? []) {
    const extension = path.posix.extname(asset.path ?? "").toLowerCase();
    if (![".png", ".jpg", ".jpeg"].includes(extension)) continue;
    const sourcePath = absoluteResourcePath(asset.path);
    if (!fs.existsSync(sourcePath)) {
      report.warnings.push(`Image optimization skipped missing asset: ${asset.path}`);
      continue;
    }
    const sourceBytes = fs.statSync(sourcePath).size;
    let outputRelative = safeRelativePath(
      `${asset.path.slice(0, -extension.length)}.webp`,
    );
    if (
      (occupiedPaths.has(outputRelative) && outputRelative !== asset.path) ||
      fs.existsSync(absoluteResourcePath(outputRelative))
    ) {
      const base = asset.path.slice(0, -extension.length);
      let suffix = 1;
      do {
        outputRelative = safeRelativePath(`${base}.release${suffix === 1 ? "" : `-${suffix}`}.webp`);
        suffix += 1;
      } while (
        occupiedPaths.has(outputRelative) ||
        fs.existsSync(absoluteResourcePath(outputRelative))
      );
    }
    const outputPath = absoluteResourcePath(outputRelative);
    const exactVisual = profile === "lossless" ||
      ["ui", "sprite", "portrait", "animation"].includes(asset.asset_type);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    occupiedPaths.add(outputRelative);
    jobs.push({
      assetId: asset.asset_id,
      sourcePath,
      outputPath,
      mode: exactVisual ? "lossless" : "quality",
    });
    records.set(asset.asset_id, {
      asset,
      sourcePath,
      sourceBytes,
      outputRelative,
      outputPath,
      exactVisual,
    });
  }

  if (jobs.length === 0) return [];
  const jobsPath = path.join(embeddedDir, `.agentvn-image-jobs-${process.pid}.json`);
  const resultsPath = path.join(embeddedDir, `.agentvn-image-results-${process.pid}.json`);
  writeJsonAtomic(jobsPath, jobs);
  let workerError;
  try {
    await runNodeWorker([
      path.join(repoRoot, "scripts", "optimize-release-images-batch.cjs"),
      jobsPath,
      resultsPath,
    ]);
  } catch (error) {
    workerError = error;
    report.warnings.push(
      `Image optimization worker stopped early; unfinished images kept their originals: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const workerResults = fs.existsSync(resultsPath) ? readJson(resultsPath, false) ?? [] : [];
  const resultByAsset = new Map(workerResults.map((result) => [result.assetId, result]));
  for (const job of jobs) {
    const record = records.get(job.assetId);
    const result = resultByAsset.get(job.assetId);
    if (!record) continue;
    if (!result?.ok || !fs.existsSync(record.outputPath)) {
      removeFileIfExists(record.outputPath);
      if (!workerError || result?.error) {
        report.warnings.push(
          `Image optimization failed for ${job.assetId}: ${result?.error ?? "worker produced no result"}`,
        );
      }
      if (verbose) console.log(`[release-opt] image:failed ${job.assetId}`);
      continue;
    }
    if (result.sharpVersion) report.tools.sharp = result.sharpVersion;
    if (result.imageBackend) report.tools.pillow = result.imageBackend;
    const resultBytes = Number(result.sizeBytes || fs.statSync(record.outputPath).size);
    if (resultBytes > record.sourceBytes * 0.92) {
      removeFileIfExists(record.outputPath);
      report.assets.push({
        assetId: job.assetId,
        kind: "image",
        status: "kept-original",
        originalBytes: record.sourceBytes,
        resultBytes,
        reason: "saving-below-8-percent",
      });
      if (verbose) console.log(`[release-opt] image:kept ${job.assetId} ${record.sourceBytes} -> ${resultBytes}`);
      continue;
    }
    replacements.push([record.asset.path, record.outputRelative]);
    replacedSourcePaths.push(record.sourcePath);
    occupiedPaths.delete(record.asset.path);
    record.asset.path = record.outputRelative;
    record.asset.filename = path.posix.basename(record.outputRelative);
    record.asset.mime_type = "image/webp";
    record.asset.size_bytes = resultBytes;
    record.asset.hash_sha256 = sha256File(record.outputPath);
    report.assets.push({
      assetId: job.assetId,
      kind: "image",
      status: "optimized",
      mode: record.exactVisual ? "lossless-webp" : "quality-90-webp",
      originalBytes: record.sourceBytes,
      resultBytes,
    });
    if (verbose) console.log(`[release-opt] image:optimized ${job.assetId} ${record.sourceBytes} -> ${resultBytes}`);
  }
  removeFileIfExists(jobsPath);
  removeFileIfExists(resultsPath);
  if (replacements.length > 0) {
    mutableDocuments.forEach((document) => rewriteStrings(document, replacements));
    for (const sourcePath of replacedSourcePaths) removeFileIfExists(sourcePath);
  }
  return replacements;
}

async function optimizeFonts(manifest, mutableDocuments, report) {
  if (profile === "off") return [];
  if (!bundledModuleAvailable("subset-font")) {
    report.warnings.push("subset-font is not bundled; font subsetting was skipped and original fonts were kept.");
    return [];
  }
  report.tools.subsetFont = "2.5.0";
  const text = `${collectStrings(mutableDocuments).join("")}
ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789
，。！？；：“”‘’（）《》【】—…·+-=*/\\_`;
  const replacements = [];
  const textPath = path.join(embeddedDir, `.agentvn-font-text-${process.pid}.txt`);
  fs.writeFileSync(textPath, text, "utf8");
  try {
    for (const asset of manifest.assets ?? []) {
      if (asset.asset_type !== "font") continue;
      const extension = path.posix.extname(asset.path ?? "").toLowerCase();
      if (![".ttf", ".otf"].includes(extension)) continue;
      const sourcePath = absoluteResourcePath(asset.path);
      if (!fs.existsSync(sourcePath)) continue;
      const sourceBytes = fs.statSync(sourcePath).size;
      const outputRelative = safeRelativePath(`${asset.path.slice(0, -extension.length)}.woff2`);
      const outputPath = absoluteResourcePath(outputRelative);
      const temporaryPath = `${outputPath}.tmp-${process.pid}`;
      try {
        if (verbose) console.log(`[release-opt] font:start ${asset.asset_id} ${asset.path}`);
        const conversion = await runNodeWorker([
          path.join(repoRoot, "scripts", "subset-release-font.cjs"),
          sourcePath,
          temporaryPath,
          textPath,
        ]);
        if (!fs.existsSync(temporaryPath)) throw new Error("font worker produced no output file");
        const workerResult = JSON.parse(conversion.stdout.trim());
        const resultBytes = Number(workerResult.sizeBytes || fs.statSync(temporaryPath).size);
      if (resultBytes > sourceBytes * 0.92) {
        removeFileIfExists(temporaryPath);
        report.assets.push({
          assetId: asset.asset_id,
          kind: "font",
          status: "kept-original",
          originalBytes: sourceBytes,
          resultBytes,
          reason: "saving-below-8-percent",
        });
        continue;
      }
      fs.renameSync(temporaryPath, outputPath);
      if (outputPath !== sourcePath) removeFileIfExists(sourcePath);
      replacements.push([asset.path, outputRelative]);
      asset.path = outputRelative;
      asset.filename = path.posix.basename(outputRelative);
      asset.mime_type = "font/woff2";
      asset.size_bytes = resultBytes;
      asset.hash_sha256 = sha256File(outputPath);
      report.assets.push({
        assetId: asset.asset_id,
        kind: "font",
        status: "optimized",
        mode: "subset-woff2",
        originalBytes: sourceBytes,
        resultBytes,
      });
        if (verbose) console.log(`[release-opt] font:optimized ${asset.asset_id} ${sourceBytes} -> ${resultBytes}`);
      } catch (error) {
        removeFileIfExists(temporaryPath);
        report.warnings.push(
          `Font subsetting failed for ${asset.asset_id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (verbose) console.log(`[release-opt] font:failed ${asset.asset_id}`);
      }
    }
  } finally {
    removeFileIfExists(textPath);
  }
  if (replacements.length > 0) {
    mutableDocuments.forEach((document) => rewriteStrings(document, replacements));
  }
  return replacements;
}

function rebuildChecksum(checksum, manifest, script, gallery, uiSkin, uiPath) {
  const previous = new Map(
    (checksum.files ?? [])
      .filter((entry) => typeof entry.path === "string" && !entry.path.endsWith("/"))
      .map((entry) => [entry.path, entry]),
  );
  const declaredPaths = new Set([
    "manifest.json",
    "script.json",
    "checksum.json",
    ...(gallery ? ["gallery.json"] : []),
    ...(uiSkin ? [uiPath] : []),
    ...(manifest.assets ?? []).map((asset) => asset.path),
    ...(uiSkin?.assets ?? []).map((asset) => asset.path),
  ]);
  declaredPaths.delete("checksum.json");
  const files = [];
  for (const relativePath of [...declaredPaths].sort()) {
    const safe = safeRelativePath(relativePath);
    const filePath = absoluteResourcePath(safe);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
    const prior = previous.get(safe);
    const sizeBytes = fs.statSync(filePath).size;
    const metadataChanged = ["manifest.json", "script.json", "gallery.json", uiPath].includes(safe);
    files.push({
      path: safe,
      size_bytes: sizeBytes,
      hash_sha256: !metadataChanged && prior?.size_bytes === sizeBytes && prior?.hash_sha256
        ? prior.hash_sha256
        : sha256File(filePath),
    });
  }
  return {
    ...checksum,
    checksum_version: checksum.checksum_version ?? "1.0.0",
    algorithm: "sha256",
    files,
  };
}

function buildStartupIndex(manifest, script, checksum, uiSkin, checksumText) {
  const assetById = new Map((manifest.assets ?? []).map((asset) => [asset.asset_id, asset]));
  for (const asset of uiSkin?.assets ?? []) {
    if (!assetById.has(asset.asset_id)) assetById.set(asset.asset_id, asset);
  }
  const assetByPath = new Map([...assetById.values()].map((asset) => [asset.path, asset]));
  const uiTitle = uiSkin?.screens?.find((screen) => screen.screen_id === "title");
  const uiPlayer = uiSkin?.screens?.find((screen) => screen.screen_id === "player");
  const titleAssets = referencedAssets({
    cover: manifest.cover,
    shell: manifest.shell,
    loadingAnimation: script.loading_animation,
    title: uiTitle,
  }, assetById, assetByPath);
  const playerAssets = referencedAssets(uiPlayer, assetById, assetByPath);
  const characterById = new Map((script.characters ?? []).map((character) => [character.character_id, character]));
  const sceneAssets = {};
  const nextScenes = {};
  for (const scene of script.scenes ?? []) {
    const characters = new Set();
    for (const command of scene.commands ?? []) {
      if (typeof command.character_id === "string") characters.add(command.character_id);
    }
    const characterStyles = [...characters].map((id) => characterById.get(id)).filter(Boolean);
    sceneAssets[scene.scene_id] = [...new Set([
      ...playerAssets,
      ...referencedAssets({ scene, characterStyles }, assetById, assetByPath),
    ])];
    nextScenes[scene.scene_id] = sceneSuccessors(scene);
  }
  const entrySceneAssets = sceneAssets[script.entry_scene_id] ?? [];
  const checksumByPath = new Map((checksum.files ?? []).map((entry) => [entry.path, entry]));
  const files = {};
  for (const asset of assetById.values()) {
    const relativePath = safeRelativePath(asset.path);
    const checksumEntry = checksumByPath.get(relativePath);
    const filePath = absoluteResourcePath(relativePath);
    if (!fs.existsSync(filePath)) continue;
    files[relativePath] = {
      assetId: asset.asset_id,
      mimeType: asset.mime_type || mimeForPath(relativePath),
      sizeBytes: checksumEntry?.size_bytes ?? fs.statSync(filePath).size,
      sha256: checksumEntry?.hash_sha256 ?? sha256File(filePath),
    };
  }
  return {
    schemaVersion: "1.0",
    contentId: sha256Buffer(Buffer.from(checksumText, "utf8")),
    files,
    titleAssets,
    entrySceneAssets,
    sceneAssets,
    nextScenes,
    legacyPreloadHints: (manifest.assets ?? [])
      .filter((asset) => asset.preload)
      .map((asset) => asset.asset_id),
  };
}

async function main() {
  const manifest = readJson(manifestPath);
  const script = readJson(scriptPath);
  const gallery = readJson(galleryPath, false);
  let checksum = readJson(checksumPath);
  const uiPath = safeRelativePath(manifest.ui_skin?.path ?? "ui/layout.json");
  const uiFilePath = absoluteResourcePath(uiPath);
  const uiSkin = readJson(uiFilePath, false);
  const mutableDocuments = [manifest, script, gallery, uiSkin].filter(Boolean);
  const originalBytes = (checksum.files ?? []).reduce(
    (total, entry) => total + Number(entry.size_bytes || 0),
    0,
  );
  const report = {
    schemaVersion: "1.0",
    profile,
    generatedAt: new Date().toISOString(),
    tools: {},
    originalBytes,
    resultBytes: originalBytes,
    savedBytes: 0,
    assets: [],
    warnings: [],
  };

  await optimizeImages(manifest, mutableDocuments, report);
  await optimizeFonts(manifest, mutableDocuments, report);
  // Project imports may legitimately omit hashes (older .vnproj files did).
  // Hydrate the manifest from the final bytes before rebuilding checksum and
  // startup-index so all three metadata surfaces agree exactly.
  syncManifestAssetMetadata(manifest);
  writeJsonAtomic(manifestPath, manifest);
  writeJsonAtomic(scriptPath, script);
  if (gallery) writeJsonAtomic(galleryPath, gallery);
  if (uiSkin) writeJsonAtomic(uiFilePath, uiSkin);

  checksum = rebuildChecksum(checksum, manifest, script, gallery, uiSkin, uiPath);
  writeJsonAtomic(checksumPath, checksum);
  const checksumText = fs.readFileSync(checksumPath, "utf8");
  const startupIndex = buildStartupIndex(manifest, script, checksum, uiSkin, checksumText);
  writeJsonAtomic(path.join(embeddedDir, "startup-index.json"), startupIndex);

  report.resultBytes = (checksum.files ?? []).reduce(
    (total, entry) => total + Number(entry.size_bytes || 0),
    0,
  );
  report.savedBytes = Math.max(0, report.originalBytes - report.resultBytes);
  const reportPath = explicitReportPath
    ? path.resolve(explicitReportPath)
    : path.join(embeddedDir, "release-optimization-report.json");
  writeJsonAtomic(reportPath, report);
  console.log(JSON.stringify({
    ok: true,
    profile,
    contentId: startupIndex.contentId,
    files: Object.keys(startupIndex.files).length,
    titleAssets: startupIndex.titleAssets.length,
    entrySceneAssets: startupIndex.entrySceneAssets.length,
    savedBytes: report.savedBytes,
    warnings: report.warnings,
    reportPath,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
