import type { ChecksumFileEntry, ChecksumManifest } from "./types";
import { CHECKSUM_VERSION } from "./constants";

function ensureCrypto(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("校验能力不可用（Web Crypto API）：当前运行环境不支持 SHA-256 校验。原因：浏览器或容器缺少 Web Crypto API。影响：无法确认卡带文件是否完整。解决方案：请使用 AgentVN 桌面版或更新浏览器环境后重试。");
  }
  return globalThis.crypto.subtle;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256ArrayBuffer(buffer: ArrayBuffer): Promise<string> {
  return toHex(await ensureCrypto().digest("SHA-256", buffer));
}

export async function sha256String(value: string): Promise<string> {
  return sha256ArrayBuffer(new TextEncoder().encode(value).buffer);
}

async function toArrayBuffer(data: Blob | ArrayBuffer | Uint8Array | string): Promise<ArrayBuffer> {
  if (data instanceof Blob) return data.arrayBuffer();
  if (data instanceof Uint8Array) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy.buffer;
  }
  if (typeof data === "string") return new TextEncoder().encode(data).buffer;
  return data;
}

export async function createChecksumManifest(files: Array<{ path: string; data: Blob | ArrayBuffer | Uint8Array | string }>): Promise<ChecksumManifest> {
  const entries: ChecksumFileEntry[] = [];
  for (const file of files) {
    const buffer = await toArrayBuffer(file.data);
    entries.push({
      path: file.path,
      size_bytes: buffer.byteLength,
      hash_sha256: await sha256ArrayBuffer(buffer)
    });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    checksum_version: CHECKSUM_VERSION,
    algorithm: "sha256",
    generated_at: new Date().toISOString(),
    files: entries
  };
}

export async function verifyChecksumManifest(checksum: ChecksumManifest, files: Map<string, ArrayBuffer>): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];
  for (const entry of checksum.files) {
    const data = files.get(entry.path);
    if (!data) {
      errors.push(`校验清单引用了缺失文件（checksum.files.path）：${entry.path}。原因：checksum.json 记录了这个文件，但卡带包里没有找到。影响：GameCLI 无法确认卡带完整性。解决方案：请从编辑器重新导出 .vncart，不要手动删除卡带内部文件。`);
      continue;
    }
    if (data.byteLength !== entry.size_bytes) {
      errors.push(`文件大小校验失败（size_bytes）：${entry.path} 记录为 ${entry.size_bytes} 字节，实际为 ${data.byteLength} 字节。原因：文件可能被替换、截断或手工修改。影响：卡带素材或剧本可能不是导出时的原始内容。解决方案：请重新导出卡带，或确认没有外部工具改写该文件。`);
    }
    const hash = await sha256ArrayBuffer(data);
    if (hash !== entry.hash_sha256) {
      errors.push(`文件哈希校验失败（hash_sha256）：${entry.path} 的 SHA-256 与 checksum.json 记录不一致。原因：文件内容发生变化或卡带损坏。影响：GameCLI 会拒绝加载不可信的卡带内容。解决方案：请重新从编辑器导出 .vncart；如果来自他人，请让对方重新发送完整文件。`);
    }
  }
  return { ok: errors.length === 0, errors };
}
