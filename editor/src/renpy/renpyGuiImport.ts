import JSZip, { type JSZipObject } from "jszip";
import {
  parseRenpyGUIParameters,
  type RenpyGUIImportIssue,
  type RenpyGUI,
} from "../../../shared/cartridge/renpyGui";

export const RENPY_GUI_IMPORT_LIMITS = {
  entries: 4096,
  totalUncompressedBytes: 128 * 1024 * 1024,
  fileBytes: 24 * 1024 * 1024,
  guiSourceBytes: 2 * 1024 * 1024,
  compressionRatio: 200,
} as const;

export type RenpyGuiAssetKind = "image" | "font";
export type RenpyGuiScanIssueCode =
  | "invalid_archive"
  | "unsafe_path"
  | "symbolic_link"
  | "archive_limit"
  | "missing_gui"
  | "ambiguous_gui"
  | "unsupported_script"
  | "unsupported_file"
  | "invalid_encoding"
  | "invalid_asset"
  | RenpyGUIImportIssue["code"];

export interface RenpyGuiScanIssue {
  code: RenpyGuiScanIssueCode;
  path?: string;
  line?: number;
  parameter?: string;
  message: string;
}

export interface RenpyGuiAssetCandidate {
  path: string;
  name: string;
  kind: RenpyGuiAssetKind;
  mimeType: string;
  sizeBytes: number;
  bytes: Uint8Array;
}

export interface RenpyGuiArchiveScan {
  parameters: { values: RenpyGUI; issues: RenpyGUIImportIssue[] };
  assets: RenpyGuiAssetCandidate[];
  issues: RenpyGuiScanIssue[];
  complete: boolean;
}

const supportedAssets: Readonly<Record<string, { kind: RenpyGuiAssetKind; mimeType: string }>> = {
  ".png": { kind: "image", mimeType: "image/png" },
  ".jpg": { kind: "image", mimeType: "image/jpeg" },
  ".jpeg": { kind: "image", mimeType: "image/jpeg" },
  ".webp": { kind: "image", mimeType: "image/webp" },
  ".ttf": { kind: "font", mimeType: "font/ttf" },
  ".otf": { kind: "font", mimeType: "font/otf" },
  ".woff2": { kind: "font", mimeType: "font/woff2" },
};

interface EntrySizes {
  compressed: number;
  uncompressed: number;
}

function zipEntrySizes(entry: JSZipObject): EntrySizes | undefined {
  const data = entry as JSZipObject & {
    _data?: { compressedSize?: number; uncompressedSize?: number };
  };
  const compressed = data._data?.compressedSize;
  const uncompressed = data._data?.uncompressedSize;
  if (!Number.isFinite(compressed) || !Number.isFinite(uncompressed)) return undefined;
  return { compressed: Number(compressed), uncompressed: Number(uncompressed) };
}

function zipEntryIsSymlink(entry: JSZipObject): boolean {
  const mode = entry.unixPermissions;
  const numeric = typeof mode === "number"
    ? mode
    : typeof mode === "string"
      ? Number.parseInt(mode, 8)
      : 0;
  return Number.isFinite(numeric) && (numeric & 0o170000) === 0o120000;
}

function safeArchivePath(entry: JSZipObject): boolean {
  const name = entry.name;
  const originalName = (entry as JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
  const parts = name.replace(/\\/g, "/").split("/");
  return (!originalName || originalName === name)
    && Boolean(name)
    && !name.includes("\0")
    && !name.includes("\\")
    && !name.startsWith("/")
    && !/^[A-Za-z]:/.test(name)
    && !parts.some((part) => part === "." || part === "..");
}

function issue(code: RenpyGuiScanIssueCode, message: string, path?: string): RenpyGuiScanIssue {
  return { code, message, ...(path ? { path } : {}) };
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] << 24)) >>> 0;
}

function inspectCentralDirectory(bytes: Uint8Array): RenpyGuiScanIssue[] {
  const issues: RenpyGuiScanIssue[] = [];
  const minEocd = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= minEocd; offset -= 1) {
    if (u32(bytes, offset) !== 0x06054b50) continue;
    const commentLength = u16(bytes, offset + 20);
    if (offset + 22 + commentLength === bytes.length) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return [issue("invalid_archive", "ZIP 结束目录缺失或损坏。")];
  const disk = u16(bytes, eocd + 4);
  const centralDisk = u16(bytes, eocd + 6);
  const diskEntries = u16(bytes, eocd + 8);
  const entryCount = u16(bytes, eocd + 10);
  const centralSize = u32(bytes, eocd + 12);
  const centralOffset = u32(bytes, eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount
    || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff
    || centralOffset + centralSize > eocd) {
    return [issue("invalid_archive", "不支持分卷或 ZIP64 压缩包，或 central directory 边界无效。")];
  }
  if (entryCount > RENPY_GUI_IMPORT_LIMITS.entries) {
    return [issue("archive_limit", `压缩包文件数超过 ${RENPY_GUI_IMPORT_LIMITS.entries} 个。`)];
  }
  const seen = new Set<string>();
  let totalUncompressed = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > centralOffset + centralSize || u32(bytes, cursor) !== 0x02014b50) {
      issues.push(issue("invalid_archive", "central directory 条目结构损坏。"));
      return issues;
    }
    const madeBy = u16(bytes, cursor + 4);
    const flags = u16(bytes, cursor + 8);
    const compressedSize = u32(bytes, cursor + 20);
    const uncompressedSize = u32(bytes, cursor + 24);
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const commentLength = u16(bytes, cursor + 32);
    const diskStart = u16(bytes, cursor + 34);
    const externalAttributes = u32(bytes, cursor + 38);
    const recordEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > centralOffset + centralSize || diskStart !== 0
      || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      issues.push(issue("invalid_archive", "central directory 条目长度或 ZIP64 字段无效。"));
      return issues;
    }
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    let name: string;
    try {
      if ((flags & 0x0800) !== 0) {
        name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
      } else {
        if (nameBytes.some((value) => value > 0x7f)) {
          issues.push(issue("invalid_encoding", "ZIP 文件名未声明 UTF-8，非 ASCII 路径不能安全核验。"));
          cursor = recordEnd;
          continue;
        }
        name = String.fromCharCode(...nameBytes);
      }
    } catch {
      issues.push(issue("invalid_encoding", "ZIP 中包含无效 UTF-8 文件名。"));
      cursor = recordEnd;
      continue;
    }
    const pathParts = name.replace(/\\/g, "/").split("/");
    if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/")
      || /^[A-Za-z]:/.test(name) || pathParts.some((part) => part === "." || part === "..")) {
      issues.push(issue("unsafe_path", "压缩包包含不安全路径，已拒绝整个导入。", name));
    }
    const foldedPath = name.replace(/\/+$/, "").toLocaleLowerCase("en-US");
    if (seen.has(foldedPath)) {
      issues.push(issue("unsafe_path", "压缩包包含 Windows 不区分大小写的重名路径。", name));
    }
    seen.add(foldedPath);
    const creatorOs = madeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    if (creatorOs === 3 && (unixMode & 0o170000) === 0o120000) {
      issues.push(issue("symbolic_link", "压缩包包含符号链接，已拒绝整个导入。", name));
    }
    totalUncompressed += uncompressedSize;
    if (uncompressedSize > RENPY_GUI_IMPORT_LIMITS.fileBytes
      || totalUncompressed > RENPY_GUI_IMPORT_LIMITS.totalUncompressedBytes
      || (uncompressedSize > 0 && uncompressedSize / Math.max(1, compressedSize)
        > RENPY_GUI_IMPORT_LIMITS.compressionRatio)) {
      issues.push(issue("archive_limit", "压缩条目超过单文件、总解压大小或压缩比限制。", name));
    }
    cursor = recordEnd;
  }
  if (cursor !== centralOffset + centralSize) {
    issues.push(issue("invalid_archive", "central directory 末尾与目录声明长度不一致。"));
  }
  return issues;
}

function findGuiFiles(zip: JSZip): string[] {
  return Object.keys(zip.files).filter((name) => {
    const normalized = name.replace(/\\/g, "/").toLowerCase();
    return !zip.files[name].dir && (normalized === "gui.rpy" || normalized.endsWith("/gui.rpy"));
  });
}

export async function scanRenpyGuiArchive(bytes: Uint8Array): Promise<RenpyGuiArchiveScan> {
  const issues: RenpyGuiScanIssue[] = [];
  const assets: RenpyGuiAssetCandidate[] = [];
  const empty = { parameters: { values: {} as RenpyGUI, issues: [] as RenpyGUIImportIssue[] }, assets, issues, complete: false };
  if (!(bytes instanceof Uint8Array) || bytes.length < 4
    || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    issues.push(issue("invalid_archive", "所选文件不是可读取的 ZIP 压缩包。"));
    return empty;
  }
  const centralIssues = inspectCentralDirectory(bytes);
  if (centralIssues.length) return { ...empty, issues: centralIssues };

  let zip: JSZip;
  try {
    // CRC validation inflates every entry during load. Validate declared sizes
    // first, then inflate only whitelisted entries below the configured limits.
    zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false });
  } catch (error) {
    issues.push(issue("invalid_archive", `ZIP 无法安全读取：${error instanceof Error ? error.message : String(error)}`));
    return empty;
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > RENPY_GUI_IMPORT_LIMITS.entries) {
    issues.push(issue("archive_limit", `压缩包文件数超过 ${RENPY_GUI_IMPORT_LIMITS.entries} 个。`));
    return { ...empty, issues };
  }

  const seenPaths = new Set<string>();
  let totalUncompressed = 0;
  for (const entry of entries) {
    if (!safeArchivePath(entry)) {
      issues.push(issue("unsafe_path", "压缩包包含不安全路径，已拒绝整个导入。", entry.name));
      continue;
    }
    if (zipEntryIsSymlink(entry)) {
      issues.push(issue("symbolic_link", "压缩包包含符号链接，已拒绝整个导入。", entry.name));
      continue;
    }
    const normalizedPath = entry.name.replace(/\/+$/, "");
    const foldedPath = normalizedPath.toLocaleLowerCase("en-US");
    if (seenPaths.has(foldedPath)) {
      issues.push(issue("unsafe_path", "压缩包包含 Windows 不区分大小写的重名路径。", entry.name));
      continue;
    }
    seenPaths.add(foldedPath);
    const sizes = zipEntrySizes(entry);
    if (!sizes || sizes.uncompressed < 0 || sizes.compressed < 0) {
      issues.push(issue("invalid_archive", "无法核验压缩条目的大小。", entry.name));
      continue;
    }
    totalUncompressed += sizes.uncompressed;
    if (sizes.uncompressed > RENPY_GUI_IMPORT_LIMITS.fileBytes
      || totalUncompressed > RENPY_GUI_IMPORT_LIMITS.totalUncompressedBytes
      || (sizes.uncompressed > 0
        && sizes.uncompressed / Math.max(1, sizes.compressed) > RENPY_GUI_IMPORT_LIMITS.compressionRatio)) {
      issues.push(issue("archive_limit", "压缩条目超过单文件、总解压大小或压缩比限制。", entry.name));
    }
  }
  if (issues.some(({ code }) => code === "unsafe_path" || code === "symbolic_link"
    || code === "archive_limit" || code === "invalid_archive")) {
    return { ...empty, issues };
  }

  const guiFiles = findGuiFiles(zip);
  if (guiFiles.length === 0) {
    issues.push(issue("missing_gui", "未找到 gui.rpy，不能导入静态 GUI 参数。"));
  } else if (guiFiles.length > 1) {
    issues.push(issue("ambiguous_gui", "找到多个 gui.rpy；请整理压缩包，只保留一个需要导入的模板文件。"));
  }

  const guiPath = guiFiles.length === 1 ? guiFiles[0] : undefined;
  let parameters: RenpyGuiArchiveScan["parameters"] = { values: {}, issues: [] };
  if (guiPath) {
    const guiEntry = zip.files[guiPath];
    const sizes = zipEntrySizes(guiEntry);
    if (!sizes || sizes.uncompressed > RENPY_GUI_IMPORT_LIMITS.guiSourceBytes) {
      issues.push(issue("archive_limit", "gui.rpy 超过可解析文件大小限制。", guiPath));
    } else {
      try {
        const guiBytes = await guiEntry.async("uint8array");
        const guiSource = new TextDecoder("utf-8", { fatal: true }).decode(guiBytes);
        const parsed = parseRenpyGUIParameters(guiSource);
        parameters = { values: parsed.values, issues: parsed.issues };
        issues.push(...parsed.issues.map((entry) => ({
          code: entry.code,
          path: guiPath,
          line: entry.line,
          parameter: entry.parameter,
          message: entry.message,
        })));
      } catch {
        issues.push(issue("invalid_encoding", "gui.rpy 不是严格 UTF-8，无法安全解析。", guiPath));
      }
    }
  }

  for (const entry of entries) {
    if (entry.name === guiPath) continue;
    const extension = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
    if (extension === ".rpy" || extension === ".rpym") {
      issues.push(issue("unsupported_script", "脚本和屏幕定义不执行也不导入；仅静态读取 gui.rpy 白名单参数。", entry.name));
      continue;
    }
    const supported = supportedAssets[extension];
    if (!supported) {
      issues.push(issue("unsupported_file", "此文件类型不在 GUI 图片/字体导入白名单内，未导入。", entry.name));
      continue;
    }
    const data = await entry.async("uint8array");
    if (!hasExpectedSignature(extension, data)) {
      issues.push(issue("invalid_asset", "文件内容签名与扩展名不匹配，未加入导入候选。", entry.name));
      continue;
    }
    assets.push({
      path: entry.name,
      name: entry.name.slice(entry.name.lastIndexOf("/") + 1),
      kind: supported.kind,
      mimeType: supported.mimeType,
      sizeBytes: data.byteLength,
      bytes: data,
    });
  }
  return { parameters, assets, issues, complete: issues.length === 0 };
}

export function hasExpectedSignature(extension: string, bytes: Uint8Array): boolean {
  const startsWith = (...expected: number[]) => expected.every((value, index) => bytes[index] === value);
  if (extension === ".png") return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (extension === ".jpg" || extension === ".jpeg") return startsWith(0xff, 0xd8, 0xff);
  if (extension === ".webp") {
    return bytes.length >= 12 && startsWith(0x52, 0x49, 0x46, 0x46)
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  if (extension === ".ttf") {
    return startsWith(0, 1, 0, 0) || startsWith(0x74, 0x72, 0x75, 0x65)
      || startsWith(0x74, 0x79, 0x70, 0x31);
  }
  if (extension === ".otf") return startsWith(0x4f, 0x54, 0x54, 0x4f);
  if (extension === ".woff2") return startsWith(0x77, 0x4f, 0x46, 0x32);
  return false;
}
