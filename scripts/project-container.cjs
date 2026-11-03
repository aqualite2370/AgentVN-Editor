const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const os = require("os");
const childProcess = require("child_process");
const crypto = require("crypto");

let JSZip;
try {
  JSZip = require(path.join(__dirname, "..", "editor", "node_modules", "jszip"));
} catch {
  JSZip = require("jszip");
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function isZipBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 4).equals(ZIP_MAGIC);
}

function decodeUtf8(buffer, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
  } catch (error) {
    const wrapped = new Error(`PROJECT_CONTAINER_INVALID: invalid UTF-8 in ${label}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

function isSafeProjectPath(value) {
  if (typeof value !== "string" || !value || value.includes("\0")) return false;
  const normalized = value.replace(/\\/g, "/");
  return !normalized.startsWith("/") && !/^[A-Za-z]:/.test(normalized) && !normalized.split("/").includes("..");
}

function readZipEntrySync(filePath, requestedName) {
  const eocdSignature = 0x06054b50;
  const zip64LocatorSignature = 0x07064b50;
  const zip64EocdSignature = 0x06064b50;
  const fd = fs.openSync(filePath, "r");
  const fileSize = fs.fstatSync(fd).size;
  const tailLength = Math.min(fileSize, 65557 + 20);
  const tail = Buffer.alloc(tailLength);
  fs.readSync(fd, tail, 0, tailLength, fileSize - tailLength);
  let eocd = -1;
  for (let offset = Math.max(0, tail.length - 65557); offset <= tail.length - 22; offset += 1) {
    if (tail.readUInt32LE(offset) === eocdSignature) eocd = offset;
  }
  if (eocd < 0) {
    fs.closeSync(fd);
    throw new Error("PROJECT_CONTAINER_INVALID: ZIP end record missing");
  }
  try {
    let entryCount = tail.readUInt16LE(eocd + 10);
    let cursor = tail.readUInt32LE(eocd + 16);
    if (entryCount === 0xffff || cursor === 0xffffffff) {
      const locatorOffset = eocd - 20;
      if (locatorOffset < 0 || tail.readUInt32LE(locatorOffset) !== zip64LocatorSignature) {
        throw new Error("PROJECT_CONTAINER_INVALID: ZIP64 locator missing");
      }
      const zip64Offset = Number(tail.readBigUInt64LE(locatorOffset + 8));
      const zip64Header = Buffer.alloc(56);
      fs.readSync(fd, zip64Header, 0, zip64Header.length, zip64Offset);
      if (zip64Header.readUInt32LE(0) !== zip64EocdSignature) {
        throw new Error("PROJECT_CONTAINER_INVALID: ZIP64 end record invalid");
      }
      entryCount = Number(zip64Header.readBigUInt64LE(32));
      cursor = Number(zip64Header.readBigUInt64LE(48));
    }
    for (let index = 0; index < entryCount; index += 1) {
      const header = Buffer.alloc(46);
      fs.readSync(fd, header, 0, header.length, cursor);
      if (header.readUInt32LE(0) !== 0x02014b50) throw new Error("PROJECT_CONTAINER_INVALID: ZIP directory entry invalid");
      const method = header.readUInt16LE(10);
      let compressedSize = header.readUInt32LE(20);
      const fileNameLength = header.readUInt16LE(28);
      const extraLength = header.readUInt16LE(30);
      const commentLength = header.readUInt16LE(32);
      let localOffset = header.readUInt32LE(42);
      const variable = Buffer.alloc(fileNameLength + extraLength);
      fs.readSync(fd, variable, 0, variable.length, cursor + 46);
      const name = decodeUtf8(variable.subarray(0, fileNameLength), "ZIP entry name");
      if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
        const extra = variable.subarray(fileNameLength);
        let extraCursor = 0;
        while (extraCursor + 4 <= extra.length) {
          const id = extra.readUInt16LE(extraCursor);
          const size = extra.readUInt16LE(extraCursor + 2);
          if (id === 0x0001) {
            let valueCursor = extraCursor + 4;
            if (header.readUInt32LE(24) === 0xffffffff) valueCursor += 8;
            if (compressedSize === 0xffffffff) {
              compressedSize = Number(extra.readBigUInt64LE(valueCursor));
              valueCursor += 8;
            }
            if (localOffset === 0xffffffff) localOffset = Number(extra.readBigUInt64LE(valueCursor));
            break;
          }
          extraCursor += 4 + size;
        }
      }
      if (name === requestedName) {
        const localHeader = Buffer.alloc(30);
        fs.readSync(fd, localHeader, 0, localHeader.length, localOffset);
        if (localHeader.readUInt32LE(0) !== 0x04034b50) throw new Error("PROJECT_CONTAINER_INVALID: ZIP local entry invalid");
        const localNameLength = localHeader.readUInt16LE(26);
        const localExtraLength = localHeader.readUInt16LE(28);
        const start = localOffset + 30 + localNameLength + localExtraLength;
        const compressed = Buffer.alloc(compressedSize);
        fs.readSync(fd, compressed, 0, compressedSize, start);
        if (method === 0) return compressed;
        if (method === 8) return zlib.inflateRawSync(compressed);
        throw new Error(`PROJECT_CONTAINER_INVALID: unsupported ZIP compression ${method}`);
      }
      cursor += 46 + fileNameLength + extraLength + commentLength;
    }
    throw new Error(`PROJECT_CONTAINER_INVALID: missing ${requestedName}`);
  } finally {
    fs.closeSync(fd);
  }
}

function loadProjectContainerSync(filePath) {
  const fd = fs.openSync(filePath, "r");
  const prefix = Buffer.alloc(4);
  fs.readSync(fd, prefix, 0, 4, 0);
  fs.closeSync(fd);
  if (!isZipBuffer(prefix)) {
    try {
      return { container: "json", project: JSON.parse(decodeUtf8(fs.readFileSync(filePath), filePath)) };
    } catch (error) {
      if (String(error?.message || "").startsWith("PROJECT_CONTAINER_INVALID")) throw error;
      const wrapped = new Error(`PROJECT_CONTAINER_INVALID: ${filePath}`);
      wrapped.cause = error;
      throw wrapped;
    }
  }
  return {
    container: "zip",
    project: JSON.parse(decodeUtf8(readZipEntrySync(filePath, "project.json"), "project.json")),
  };
}

async function loadProjectContainer(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (!isZipBuffer(bytes)) {
    try {
      return { container: "json", project: JSON.parse(decodeUtf8(bytes, filePath)) };
    } catch (error) {
      const wrapped = new Error(`PROJECT_CONTAINER_INVALID: ${filePath}`);
      wrapped.cause = error;
      throw wrapped;
    }
  }
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const projectEntry = zip.file("project.json");
  if (!projectEntry) throw new Error(`PROJECT_CONTAINER_INVALID: ${filePath} missing project.json`);
  const project = JSON.parse(decodeUtf8(await projectEntry.async("nodebuffer"), "project.json"));
  const assets = Array.isArray(project.asset_manifest) ? project.asset_manifest : [];
  for (const asset of assets) {
    const projectPath = asset?.metadata?.project_path;
    if (!isSafeProjectPath(projectPath) || !projectPath.startsWith("assets/")) {
      throw new Error(`PROJECT_ZIP_PATH_UNSAFE: ${projectPath || "<empty>"}`);
    }
    if (!zip.file(projectPath)) throw new Error(`PROJECT_ASSET_MISSING: ${projectPath}`);
  }
  return { container: "zip", project, zip };
}

async function saveProjectContainer(filePath, loadedOrProject) {
  const loaded = loadedOrProject?.project
    ? loadedOrProject
    : { container: "json", project: loadedOrProject };
  if (loaded.container === "zip") {
    const zip = loaded.zip
      || (fs.existsSync(filePath)
        ? await JSZip.loadAsync(fs.readFileSync(filePath), { checkCRC32: true })
        : new JSZip());
    const assets = Array.isArray(loaded.project.asset_manifest) ? loaded.project.asset_manifest : [];
    const integrity = [];
    const seen = new Set();
    for (const asset of assets) {
      const metadata = asset?.metadata;
      const projectPath = metadata?.project_path;
      if (!isSafeProjectPath(projectPath) || !projectPath.startsWith("assets/") || seen.has(projectPath)) {
        throw new Error(`PROJECT_ZIP_PATH_UNSAFE: ${projectPath || "<empty>"}`);
      }
      seen.add(projectPath);
      let bytes;
      if (typeof metadata.data_url === "string" && metadata.data_url.startsWith("data:")) {
        const comma = metadata.data_url.indexOf(",");
        if (comma < 0) throw new Error(`PROJECT_ASSET_MISSING: ${projectPath}`);
        const header = metadata.data_url.slice(0, comma);
        const body = metadata.data_url.slice(comma + 1);
        bytes = header.includes(";base64") ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body), "utf8");
        zip.file(projectPath, bytes, { binary: true, compression: "STORE", createFolders: true });
      } else if (typeof metadata.filePath === "string" && fs.existsSync(metadata.filePath)) {
        bytes = fs.readFileSync(metadata.filePath);
        zip.file(projectPath, bytes, { binary: true, compression: "STORE", createFolders: true });
      } else {
        const entry = zip.file(projectPath);
        if (!entry) throw new Error(`PROJECT_ASSET_MISSING: ${projectPath}`);
        bytes = await entry.async("nodebuffer");
      }
      const hashSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      metadata.path = projectPath;
      metadata.size_bytes = bytes.length;
      metadata.hash_sha256 = hashSha256;
      delete metadata.data_url;
      delete metadata.blob_url;
      delete metadata.filePath;
      delete metadata.url;
      delete metadata.backend_asset_path;
      integrity.push({ path: projectPath, sizeBytes: bytes.length, hashSha256 });
    }
    const projectText = `${JSON.stringify(loaded.project, null, 2)}\n`;
    zip.file("project.json", projectText, { compression: "DEFLATE" });
    const formatEntry = zip.file("format.json");
    const format = formatEntry
      ? JSON.parse(await formatEntry.async("string"))
      : { format: "agentvn-vnproj-zip", version: 1 };
    format.updatedAt = new Date().toISOString();
    format.assetCount = assets.length;
    format.totalAssetBytes = integrity.reduce((total, item) => total + item.sizeBytes, 0);
    format.projectHashSha256 = crypto.createHash("sha256").update(projectText).digest("hex");
    format.assets = integrity;
    zip.file("format.json", `${JSON.stringify(format, null, 2)}\n`, { compression: "DEFLATE" });
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", streamFiles: true });
    const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, bytes);
    try {
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      fs.renameSync(temporary, filePath);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    return;
  }
  fs.writeFileSync(filePath, `${JSON.stringify(loaded.project, null, 2)}\n`, "utf8");
}

function saveProjectContainerSync(filePath, project, options = {}) {
  const temporary = path.join(os.tmpdir(), `agentvn-project-save-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(temporary, JSON.stringify(project), "utf8");
  try {
    childProcess.execFileSync(process.execPath, [
      path.join(__dirname, "project-container-save-worker.cjs"),
      filePath,
      temporary,
      options.container || (fs.existsSync(filePath) ? "preserve" : "zip"),
    ], { stdio: options.silent ? "pipe" : "inherit" });
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

module.exports = {
  ZIP_MAGIC,
  isZipBuffer,
  isSafeProjectPath,
  readZipEntrySync,
  loadProjectContainerSync,
  loadProjectContainer,
  saveProjectContainer,
  saveProjectContainerSync,
};
