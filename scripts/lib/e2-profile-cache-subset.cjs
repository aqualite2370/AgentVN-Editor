"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

function assertNoLinks(target) {
  const absolute = path.resolve(target);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink())
      throw new Error(`Cache subset path contains a link: ${cursor}`);
  }
}

function assertDedicatedProfile(outputRoot, target) {
  if (!path.isAbsolute(outputRoot) || !path.isAbsolute(target))
    throw new Error("Cache subset requires absolute paths.");
  if (path.basename(outputRoot).toLowerCase() !== "playwright"
    || path.basename(path.dirname(outputRoot)).toLowerCase() !== "output")
    throw new Error("Cache subset requires an output/playwright root.");
  const relative = path.relative(outputRoot, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
    || !/^e2-persistent-profile-[a-z0-9-]+$/i.test(relative.split(path.sep)[0]))
    throw new Error("Cache subset only accepts dedicated diagnostic profiles under output/playwright.");
  assertNoLinks(target);
}

function inventoryProfile(directory) {
  assertNoLinks(directory);
  const inventory = [];
  let totalBytes = 0;
  const visit = (current, depth) => {
    if (depth > 20) throw new Error("Profile inventory exceeded maximum directory depth.");
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      const stat = fs.lstatSync(entryPath);
      if (stat.isSymbolicLink()) throw new Error(`Profile contains a link: ${entryPath}`);
      if (stat.isDirectory()) visit(entryPath, depth + 1);
      else if (stat.isFile()) {
        totalBytes += stat.size;
        if (totalBytes > 256 * 1024 * 1024 || inventory.length >= 20_000)
          throw new Error("Diagnostic profile inventory exceeded safety limit.");
        inventory.push({
          relativePath: path.relative(directory, entryPath).split(path.sep).join("/"),
          bytes: stat.size,
          sha256: createHash("sha256").update(fs.readFileSync(entryPath)).digest("hex"),
        });
      } else throw new Error(`Profile contains an unsupported entry: ${entryPath}`);
    }
  };
  visit(directory, 0);
  return inventory.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en"));
}

// Creates a new diagnostic artifact. Never removes anything from the source,
// edits a user profile, or changes browser switches/presentation.
function cloneProfileForCacheSubset({ outputRoot, source, destination, omit }) {
  if (!["none", "GrShaderCache"].includes(omit))
    throw new Error('Cache subset must omit exactly "none" or "GrShaderCache".');
  for (const target of [source, destination]) assertDedicatedProfile(outputRoot, target);
  const destinationFromSource = path.relative(source, destination);
  if (!destinationFromSource || (!path.isAbsolute(destinationFromSource)
    && destinationFromSource !== ".." && !destinationFromSource.startsWith(`..${path.sep}`)))
    throw new Error("Cache subset destination must not be inside source.");
  if (fs.existsSync(destination)) throw new Error("Cache subset destination already exists.");
  if (!fs.existsSync(path.join(source, "Local State")))
    throw new Error("Source diagnostic profile is missing Local State.");
  const before = inventoryProfile(source);
  const shaderFiles = before.filter(file => file.relativePath.startsWith("GrShaderCache/"));
  if (!shaderFiles.length) throw new Error("Source profile has no root GrShaderCache files.");
  const omittedFiles = omit === "GrShaderCache" ? shaderFiles : [];
  const retained = before.filter(file => !omittedFiles.includes(file));
  fs.mkdirSync(destination, { recursive: true });
  for (const file of retained) {
    const output = path.join(destination, ...file.relativePath.split("/"));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(path.join(source, ...file.relativePath.split("/")), output, fs.constants.COPYFILE_EXCL);
  }
  const sourceAfter = inventoryProfile(source);
  const copied = inventoryProfile(destination);
  const sourceUnchanged = JSON.stringify(before) === JSON.stringify(sourceAfter);
  const retainedBytesIdentical = JSON.stringify(retained) === JSON.stringify(copied);
  if (!sourceUnchanged || !retainedBytesIdentical)
    throw new Error("Cache subset cloning changed source or retained bytes.");
  return {
    kind: "profile-cache-subset-attribution-not-acceptance",
    performanceAcceptance: false,
    source, destination, omit,
    sourceUnchanged, retainedBytesIdentical,
    sourceFileCount: before.length,
    retainedFileCount: retained.length,
    retainedBytes: retained.reduce((sum, file) => sum + file.bytes, 0),
    omittedFiles,
    sourceManifestSha256: createHash("sha256").update(JSON.stringify(before)).digest("hex"),
    retainedManifestSha256: createHash("sha256").update(JSON.stringify(retained)).digest("hex"),
    sourceFiles: before,
    retainedFiles: retained,
  };
}

module.exports = { cloneProfileForCacheSubset, inventoryProfile };
