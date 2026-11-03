const fs = require("fs");
const path = require("path");
const { saveProjectContainerSync } = require("./project-container.cjs");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const editorUrl = "http://127.0.0.1:6767/";
const gameCliUrl = "http://127.0.0.1:6868/";
const backendBaseUrl = "http://127.0.0.1:8278";
const backendUrl = `${backendBaseUrl}/api/health`;
const backendStateUrl = `${backendBaseUrl}/api/project/state`;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const runFullRegression = process.argv.includes("--full-regression");
const skipImageProvider = process.argv.includes("--skip-image-provider");
const actionDelayMs = runFullRegression ? 3200 : 1800;
const aiTimeoutMs = 900000;
const viewport = { width: 1920, height: 1080 };
const acceptanceNovelSceneLimit = Math.max(1, Number(process.env.AGENTVN_ACCEPTANCE_NOVEL_SCENE_LIMIT || 4) || 4);
const acceptanceNovelMaxScanChunks = Math.max(1, Number(process.env.AGENTVN_ACCEPTANCE_NOVEL_MAX_SCAN_CHUNKS || 2) || 2);
const runNovelOnly = process.argv.includes("--novel-only");
const novelTargetArg = (process.argv.find((arg) => arg.startsWith("--novel-target=")) || "").split("=")[1] || "";
const novelTargets = novelTargetArg ? [novelTargetArg] : ["gemini", "deepseek"];

const campusBase = runFullRegression ? path.join(root, "test_AgentVN", "full-regression", "campus") : path.join(root, "test_AgentVN", "campus-example");
const campusWork = path.join(campusBase, "_work");
const campusFinal = path.join(campusBase, "final");
const novelBase = runFullRegression ? path.join(root, "test_AgentVN", "full-regression", "novel") : path.join(root, "test_AgentVN", "novel-import");
const novelWork = path.join(novelBase, "_work");
const novelFinal = path.join(novelBase, "final");
const originalNovelPath = "C:\\Users\\1\\Downloads\\\u70df\u82b1\u548c\u4e0d\u5c5e\u4e8e\u4ed6\u7684\u5929\u7a7a.txt";
const novelPath = runFullRegression ? originalNovelPath : path.join(novelBase, "_work", "\u70df\u82b1\u548c\u4e0d\u5c5e\u4e8e\u4ed6\u7684\u5929\u7a7a-\u8282\u9009\u9a8c\u6536.txt");
const acceptanceNovelExcerptRatio = 0.15;
const acceptanceNovelExcerptMaxChars = 5200;
const acceptanceNovelExcerptMinChars = 3600;
const generatedImageRoot = path.join(process.env.USERPROFILE || "C:\\Users\\1", ".codex", "generated_images");
const codexCharacterAssetDir = path.join(root, "test_AgentVN", "_codex-generated-assets", "campus-characters");

const operations = [];
const failures = [];
const fixes = [];
const startedProcesses = [];
const acceptanceState = {
  textModel: "",
  textProviderId: "",
  textModelLabel: "",
  imageModel: "",
  imageProviderId: "",
  novelRuns: [],
  novelExcerpt: undefined,
};

function op(text, why) {
  const line = String(operations.length + 1) + ". " + text + "\uFF08" + why + "\uFF09";
  operations.push(line);
  console.log("[step " + operations.length + "] " + text);
}

function stripAnsi(text) {
  return String(text).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function toWindowsText(text) {
  return `\uFEFF${stripAnsi(text).replace(/\r?\n/g, "\r\n")}`;
}

function writeTextArtifact(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, toWindowsText(text), "utf8");
}

function makeNovelAcceptanceExcerpt() {
  if (!fs.existsSync(originalNovelPath)) throw new Error(`小说源文件不存在：${originalNovelPath}`);
  ensureDir(path.dirname(novelPath));
  const raw = fs.readFileSync(originalNovelPath, "utf8").replace(/^\uFEFF/, "");
  const normalized = raw.replace(/\r\n?/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  const targetChars = Math.max(
    acceptanceNovelExcerptMinChars,
    Math.min(acceptanceNovelExcerptMaxChars, Math.floor(normalized.length * acceptanceNovelExcerptRatio))
  );
  let excerpt = normalized.slice(0, targetChars);
  const boundary = Math.max(
    excerpt.lastIndexOf("\n\n"),
    excerpt.lastIndexOf("。"),
    excerpt.lastIndexOf("！"),
    excerpt.lastIndexOf("？")
  );
  if (boundary > acceptanceNovelExcerptMinChars * 0.75) excerpt = excerpt.slice(0, boundary + 1);
  const header = [
    "【AgentVN 自动化验收节选】",
    `源文件：${originalNovelPath}`,
    `截取策略：原文前 ${(acceptanceNovelExcerptRatio * 100).toFixed(0)}%，上限 ${acceptanceNovelExcerptMaxChars} 字；用于低额度真实导入闭环测试。`,
    "说明：本文件只作为临时测试小说，不替代完整原文导入能力。",
    "",
  ].join("\n");
  fs.writeFileSync(novelPath, `${header}${excerpt}`, "utf8");
  op(
    `生成临时小说测试文件 ${novelPath}`,
    `从原文截取 ${excerpt.length}/${normalized.length} 字，保留真实文本但控制模型调用量`
  );
  return { sourceChars: normalized.length, excerptChars: excerpt.length };
}

function assertReadableChineseArtifacts(filePaths) {
  const mojibakePattern = /\u951B|\u6D93|\u93CD|\u7AD4|\u93B4|\u6428|\u59E3|\u9428|\u5F42|\u89D9|\u7025|\u714E|\u6BBF|\u934F|\u95BF|\u5A11|\u95BA|\u941F|\u940E|\u9411|\u7074|\u6D60/;
  const ansiPattern = /\x1B\[[0-?]*[ -/]*[@-~]/;
  const broken = [];
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, "utf8");
    if (mojibakePattern.test(content) || ansiPattern.test(content)) broken.push(filePath);
  }
  if (broken.length > 0) {
    throw new Error("\u68C0\u6D4B\u5230\u6D4B\u8BD5\u62A5\u544A/\u64CD\u4F5C\u8BB0\u5F55\u7591\u4F3C\u4E71\u7801\uFF1A" + broken.join(", "));
  }
}

function assertInsideRoot(target) {
  const resolved = path.resolve(target);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Refusing to operate outside workspace: ${resolved}`);
  }
  return resolved;
}

function rmSafe(target) {
  const resolved = assertInsideRoot(target);
  fs.rmSync(resolved, { recursive: true, force: true });
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pace(page, reason = "\u8BA9\u5F55\u5C4F\u4FDD\u7559\u64CD\u4F5C\u540E\u7684\u5B8C\u6574\u53D8\u5316") {
  if (page) {
    try {
      await page.waitForTimeout(actionDelayMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`录屏等待失败：页面、浏览器上下文或浏览器进程被关闭。原始错误：${message}`);
    }
  }
  op("\u7B49\u5F85 " + (actionDelayMs / 1000).toFixed(1) + " \u79D2", reason);
}

async function closeContextAndSaveVideo(page, context, targetPath) {
  const video = page.video();
  let savePromise = Promise.resolve();
  if (video) {
    savePromise = video.saveAs(targetPath);
  }
  await page.close().catch(() => {});
  await context.close().catch(() => {});
  await savePromise;
}

function runCommand(name, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      shell: options.shell ?? (process.platform === "win32" && /\.cmd$/i.test(command)),
      windowsHide: true,
      env: { ...process.env, ...(options.env || {}) },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (options.logFile) fs.appendFileSync(options.logFile, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (options.logFile) fs.appendFileSync(options.logFile, chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { name, code, stdout, stderr };
      if (code === 0) resolve(result);
      else reject(new Error(`${name} failed with exit code ${code}\n${stdout}\n${stderr}`));
    });
  });
}

async function isListening(url) {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function loadBackendSharedState() {
  const response = await fetch(backendStateUrl, { method: "GET" });
  if (!response.ok) throw new Error(`读取后端共享状态失败：HTTP ${response.status}`);
  const body = await response.json();
  return body && typeof body === "object" ? body.data : null;
}

async function saveBackendSharedState(payload) {
  const response = await fetch(backendStateUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`保存后端共享状态失败：HTTP ${response.status}`);
  const body = await response.json();
  return body && typeof body === "object" ? body.data : null;
}

async function killPort(port) {
  if (process.platform !== "win32") return;
  const command = [
    `$conns = Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue`,
    "foreach ($c in $conns) {",
    "  if ($c.OwningProcess -and $c.OwningProcess -ne $PID) {",
    "    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue",
    "  }",
    "}",
  ].join("\n");
  await runCommand(`kill-port-${port}`, "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { shell: false }).catch(() => {});
}

async function killDevProcesses() {
  if (process.platform !== "win32") return;
  const command = [
    "$patterns = @(",
    "  'uvicorn app\\.main:app',",
    "  'scripts\\\\start-backend\\.ps1',",
    "  'vite --host 127\\.0\\.0\\.1 --port 6767',",
    "  'vite --host 127\\.0\\.0\\.1 --port 6868'",
    ")",
    "$targets = Get-CimInstance Win32_Process | Where-Object {",
    "  $cmd = $_.CommandLine",
    "  $_.ProcessId -ne $PID -and $cmd -and ($patterns | Where-Object { $cmd -match $_ })",
    "}",
    "foreach ($p in $targets) {",
    "  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue",
    "}",
  ].join("\n");
  await runCommand("kill-agentvn-dev-processes", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { shell: false }).catch(() => {});
}

function startServer(name, cwd, args, logFile) {
  const command = name === "backend" && process.platform === "win32" ? "powershell.exe" : npmCommand;
  const finalArgs = name === "backend" && process.platform === "win32"
    ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", "start-backend.ps1")]
    : args;
  const child = spawn(command, finalArgs, {
    cwd,
    shell: process.platform === "win32" && command === npmCommand,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => fs.appendFileSync(logFile, data));
  child.stderr.on("data", (data) => fs.appendFileSync(logFile, data));
  startedProcesses.push(child);
  return child;
}

async function ensureServers() {
  ensureDir(campusWork);
  await killDevProcesses();
  for (const port of [6767, 6868, 8278]) await killPort(port);
  await sleep(1200);
  startServer("backend", path.join(root, "backend"), [], path.join(campusWork, "backend.log"));
  startServer("editor", path.join(root, "editor"), ["run", "dev"], path.join(campusWork, "editor.log"));
  startServer("gamecli", path.join(root, "GameCli_framework"), ["run", "dev"], path.join(campusWork, "gamecli.log"));
  const targets = [
    ["backend", backendUrl],
    ["editor", editorUrl],
    ["gamecli", gameCliUrl],
  ];
  for (const [name, url] of targets) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (await isListening(url)) {
        op(`启动并确认 ${name} 服务`, `真实验收必须使用本地服务 ${url}`);
        break;
      }
      await sleep(700);
    }
    if (!(await isListening(url))) throw new Error(`${name} did not start at ${url}`);
  }
}

function cleanPreviousData(mode = "all") {
  const targets = mode.startsWith("novel:")
    ? [path.join(novelBase, mode.split(":")[1])]
    : mode === "novel"
    ? [novelBase]
    : [campusBase, novelBase, path.join(root, "test_AgentVN", "best-example")];
  for (const dir of targets) rmSafe(dir);
  ensureDir(campusWork);
  ensureDir(campusFinal);
  ensureDir(novelWork);
  ensureDir(novelFinal);
  const backupDir = path.join(root, "backup-timeline");
  if (fs.existsSync(backupDir)) {
    for (const file of fs.readdirSync(backupDir)) {
      if (/(campus|school|signal|novel|best|rain|locker|project_best|campus_signal|novel_import)/i.test(file)) {
        fs.rmSync(path.join(backupDir, file), { force: true });
      }
    }
  }
  const outputDir = path.join(root, "output", "playwright");
  if (fs.existsSync(outputDir)) {
    for (const item of fs.readdirSync(outputDir, { recursive: true })) {
      const full = path.join(outputDir, item.toString());
      if (fs.existsSync(full) && fs.statSync(full).isFile() && /(campus|novel|best|acceptance|editor-flow|gamecli-flow)/i.test(full)) {
        fs.rmSync(full, { force: true });
      }
    }
  }
  op(
    mode.startsWith("novel:")
      ? `清理 ${mode.split(":")[1]} 小说导入测试目录、旧录屏和旧报告`
      : mode === "novel"
      ? "清理小说导入测试目录、旧录屏和旧报告"
      : "清理上一轮测试目录、旧录屏、旧报告和测试备份",
    "避免最近项目、旧卡带或旧录屏影响本轮判断"
  );
}

function latestGeneratedImages(count) {
  if (!fs.existsSync(generatedImageRoot)) return [];
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(png|jpe?g|webp)$/i.test(entry.name)) files.push(full);
    }
  };
  walk(generatedImageRoot);
  return files
    .map((file) => ({ file, time: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.time - a.time)
    .slice(0, count)
    .map((item) => item.file);
}

function fileDataUrl(filePath, mimeType) {
  const data = fs.readFileSync(filePath);
  return `data:${mimeType};base64,${data.toString("base64")}`;
}

function compressedImageCopy(source, target, maxWidth = 960, quality = 70) {
  const script = [
    "from PIL import Image",
    "import sys",
    "src, dst, maxw, q = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])",
    "img = Image.open(src).convert('RGB')",
    "w, h = img.size",
    "if w > maxw:",
    "    nh = max(1, int(h * (maxw / w)))",
    "    img = img.resize((maxw, nh), Image.Resampling.LANCZOS)",
    "img.save(dst, 'JPEG', quality=q, optimize=True)",
  ].join("\n");
  execFileSync("python", ["-c", script, source, target, String(maxWidth), String(quality)], { cwd: root });
  return target;
}

function makeTransparentCharacterSprite(target, options) {
  const spec = JSON.stringify(options);
  const script = String.raw`
from PIL import Image, ImageDraw
import json, sys, math
out, raw = sys.argv[1], sys.argv[2]
o = json.loads(raw)
w, h = 520, 980
img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
cx = w // 2
skin = tuple(o.get("skin", [246, 210, 184])) + (255,)
hair = tuple(o.get("hair", [40, 45, 70])) + (255,)
jacket = tuple(o.get("jacket", [24, 38, 70])) + (255,)
accent = tuple(o.get("accent", [240, 160, 80])) + (255,)
eyes = tuple(o.get("eyes", [70, 90, 130])) + (255,)
mouth = o.get("mouth", "smile")
pose = o.get("pose", "front")

def ellipse(box, fill, outline=None, width=1):
    d.ellipse(box, fill=fill, outline=outline, width=width)
def poly(points, fill, outline=None):
    d.polygon(points, fill=fill, outline=outline)
def line(points, fill, width=3):
    d.line(points, fill=fill, width=width, joint="curve")

# soft shadow under feet
d.ellipse((cx-125, 910, cx+125, 955), fill=(18, 25, 42, 54))
# legs
line([(cx-64, 575), (cx-82, 890)], fill=(52, 56, 72, 255), width=46)
line([(cx+64, 575), (cx+82, 890)], fill=(52, 56, 72, 255), width=46)
d.rounded_rectangle((cx-132, 878, cx-38, 922), radius=18, fill=(245,245,250,255), outline=(90,100,130,255), width=3)
d.rounded_rectangle((cx+38, 878, cx+132, 922), radius=18, fill=(245,245,250,255), outline=(90,100,130,255), width=3)
# body uniform
poly([(cx-112, 255), (cx+112, 255), (cx+150, 590), (cx-150, 590)], jacket, (80, 104, 150, 255))
d.polygon([(cx-42, 265), (cx, 520), (cx+42, 265)], fill=(250,250,255,255))
d.polygon([(cx-18, 280), (cx, 430), (cx+18, 280)], fill=accent)
d.rectangle((cx-9, 285, cx+9, 505), fill=(36, 52, 94, 255))
# arms
if pose == "point":
    line([(cx-105, 305), (cx-210, 460)], fill=jacket, width=46)
    ellipse((cx-235, 442, cx-196, 482), skin)
    line([(cx+105, 305), (cx+142, 540)], fill=jacket, width=46)
    ellipse((cx+122, 525, cx+166, 570), skin)
elif pose == "book":
    line([(cx-105, 305), (cx-150, 520)], fill=jacket, width=46)
    line([(cx+105, 305), (cx+150, 520)], fill=jacket, width=46)
    d.rounded_rectangle((cx-110, 468, cx+110, 590), radius=12, fill=(242,238,218,255), outline=(130,120,100,255), width=3)
else:
    line([(cx-105, 305), (cx-170, 545)], fill=jacket, width=46)
    line([(cx+105, 305), (cx+170, 545)], fill=jacket, width=46)
    ellipse((cx-190, 528, cx-148, 572), skin)
    ellipse((cx+148, 528, cx+190, 572), skin)
# neck/head
d.rounded_rectangle((cx-36, 205, cx+36, 280), radius=18, fill=skin)
ellipse((cx-96, 85, cx+96, 250), skin, (118, 84, 68, 255), 2)
# hair mass
ellipse((cx-108, 45, cx+108, 176), hair)
for i in range(9):
    x = cx - 95 + i * 24
    d.polygon([(x, 82), (x+34, 72), (x+12, 190)], fill=hair)
# face
ellipse((cx-58, 145, cx-24, 174), (255,255,255,255))
ellipse((cx+24, 145, cx+58, 174), (255,255,255,255))
ellipse((cx-48, 148, cx-29, 171), eyes)
ellipse((cx+29, 148, cx+48, 171), eyes)
d.ellipse((cx-42, 152, cx-35, 160), fill=(255,255,255,240))
d.ellipse((cx+35, 152, cx+42, 160), fill=(255,255,255,240))
if mouth == "serious":
    line([(cx-28, 214), (cx+28, 211)], fill=(120, 52, 58, 255), width=4)
elif mouth == "surprised":
    ellipse((cx-18, 203, cx+18, 231), (118, 55, 65, 255))
else:
    d.arc((cx-34, 196, cx+34, 232), 15, 165, fill=(130, 55, 65, 255), width=4)
# expression props
if o.get("name_tag"):
    d.rounded_rectangle((cx-86, 345, cx+86, 390), radius=14, fill=(255,255,255,230), outline=accent, width=4)
    d.rectangle((cx-70, 358, cx+70, 366), fill=accent)
if o.get("headphones"):
    d.arc((cx-95, 88, cx+95, 195), 190, 350, fill=(38,42,62,255), width=9)
    ellipse((cx-117, 132, cx-82, 188), (35,37,48,255))
    ellipse((cx+82, 132, cx+117, 188), (35,37,48,255))
img.save(out)
`;
  execFileSync("python", ["-c", script, target, spec], { cwd: root });
  return target;
}

function validateTransparentPng(filePath) {
  const script = [
    "from PIL import Image",
    "import sys",
    "img = Image.open(sys.argv[1]).convert('RGBA')",
    "alpha = img.getchannel('A')",
    "bbox = alpha.getbbox()",
    "opaque = sum(1 for v in alpha.getdata() if v > 245)",
    "transparent = sum(1 for v in alpha.getdata() if v < 10)",
    "total = img.width * img.height",
    "corner_ok = all(alpha.getpixel(p) < 10 for p in ((0,0),(img.width-1,0),(0,img.height-1),(img.width-1,img.height-1)))",
    "assert bbox is not None",
    "subject_w = (bbox[2] - bbox[0]) / img.width",
    "subject_h = (bbox[3] - bbox[1]) / img.height",
    "print(f'{img.width}x{img.height} opaque={opaque/total:.3f} transparent={transparent/total:.3f} subject={subject_w:.3f}x{subject_h:.3f}')",
    "assert transparent / total > 0.35",
    "assert opaque / total > 0.12",
    "assert corner_ok",
    "assert subject_h >= 0.62",
    "assert subject_w <= 0.86",
  ].join("\n");
  return execFileSync("python", ["-c", script, filePath], { cwd: root, encoding: "utf8" }).trim();
}

function svgDataUrl(title, a, b) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <circle cx="960" cy="150" r="110" fill="rgba(255,255,255,.16)"/>
  <rect x="80" y="500" width="1120" height="80" rx="16" fill="rgba(0,0,0,.18)"/>
  <text x="110" y="552" font-family="sans-serif" font-size="42" fill="white">${title}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function dataAsset(asset_id, asset_type, filename, data_url, license = "AgentVN 双阶段真实验收生成素材") {
  const mime = data_url.match(/^data:([^;,]+)/)?.[1] || "application/octet-stream";
  return {
    asset_id,
    asset_type,
    metadata: {
      filename,
      mime_type: mime,
      size_bytes: Buffer.byteLength(data_url),
      source: "imported",
      license_note: license,
      data_url,
      blob_url: data_url,
      project_path: `assets/${asset_type}/${asset_id}-${filename.replace(/[\\/:*?"<>|]+/g, "_")}`,
      created_at: new Date().toISOString(),
    },
  };
}

function baseNodeData(kind, label, description) {
  return {
    nodeKind: kind,
    label,
    description,
    memoryMode: "hybrid",
    aiSettings: {
      authorGoal: "保持校园青春、悬疑和温柔成长的语气，输出合法视觉小说结构。",
      generationOutline: "",
      autoExtractMemory: false,
      autoApplyMemory: false,
    },
    previewState: { currentCommandIndex: 0, isPlaying: false },
    editorMeta: { collapsedInspectorSections: [], source: "manual" },
  };
}

function sceneNode(id, x, y, scene) {
  return {
    id,
    type: "sceneNode",
    position: { x, y },
    data: { ...baseNodeData("scene", scene.title, scene.summary), scene },
  };
}

function choiceNode(id, x, y, label, choices) {
  return {
    id,
    type: "choiceNode",
    position: { x, y },
    data: {
      ...baseNodeData("choice", label, "独立选项分支节点，用来把校园故事拆成多条可测试路线。"),
      choice: { type: "choice", choices },
    },
  };
}

function modifierNode(id, x, y, label, key, value) {
  return {
    id,
    type: "modifierNode",
    position: { x, y },
    data: {
      ...baseNodeData("modifier", label, `写入 ${key}=${JSON.stringify(value)}。`),
      stateUpdate: { type: "state_update", key, operation: "set", value },
    },
  };
}

function conditionNode(id, x, y, label, key, operator, value, valueType, trueLabel, falseLabel) {
  return {
    id,
    type: "conditionNode",
    position: { x, y },
    data: {
      ...baseNodeData("condition", label, "使用可视化条件构建器决定后续结局。"),
      condition: {
        expression: `${key} ${operator} ${JSON.stringify(value)}`,
        trueLabel,
        falseLabel,
        mode: "builder",
        key,
        operator,
        value,
        valueType,
      },
    },
  };
}

function animationNode(id, x, y, label) {
  return {
    id,
    type: "animationNode",
    position: { x, y },
    data: {
      ...baseNodeData("animation", label, "进入结局前的演出动画节点。"),
      animation: { type: "animation", animation_id: "anim_notice_flash", target: "screen", params: { duration: 520 }, blocking: true },
    },
  };
}

function endNode(id, x, y, title, description) {
  return {
    id,
    type: "endNode",
    position: { x, y },
    data: {
      ...baseNodeData("end", title, description),
      ending: { ending_id: id.replace(/^ending_/, "ending_"), ending_title: title },
    },
  };
}

function makeCampusProject() {
  const images = latestGeneratedImages(2);
  const assetsDir = path.join(campusFinal, "generated-assets");
  ensureDir(assetsDir);
  const backgroundImage = images[1] || images[0];
  const spriteImage = images[0];
  const bgCompressed = backgroundImage ? compressedImageCopy(backgroundImage, path.join(assetsDir, "campus-rooftop-generated.jpg"), 960, 68) : undefined;
  const spriteCompressed = spriteImage ? compressedImageCopy(spriteImage, path.join(assetsDir, "campus-students-generated.jpg"), 960, 68) : undefined;

  const bgDataUrl = bgCompressed ? fileDataUrl(bgCompressed, "image/jpeg") : svgDataUrl("校园天台 / 放学后", "#f1a85b", "#5574b7");
  if (spriteCompressed) fs.copyFileSync(spriteCompressed, path.join(assetsDir, "campus-students-source-compressed.jpg"));
  const characterSpecs = [
    ["sprite_minami_neutral", "minami-neutral.png", { hair: [38, 45, 72], eyes: [74, 112, 178], jacket: [24, 39, 76], accent: [94, 155, 230], mouth: "serious", pose: "front" }],
    ["sprite_minami_surprised", "minami-surprised.png", { hair: [38, 45, 72], eyes: [74, 112, 178], jacket: [24, 39, 76], accent: [94, 155, 230], mouth: "surprised", pose: "front" }],
    ["sprite_ren_calm", "ren-calm.png", { hair: [42, 36, 48], eyes: [115, 83, 165], jacket: [20, 35, 68], accent: [224, 168, 75], mouth: "smile", pose: "book", name_tag: true }],
    ["sprite_ren_serious", "ren-serious.png", { hair: [42, 36, 48], eyes: [115, 83, 165], jacket: [20, 35, 68], accent: [224, 168, 75], mouth: "serious", pose: "book", name_tag: true }],
    ["sprite_mio_bright", "mio-bright.png", { hair: [152, 88, 46], eyes: [214, 134, 48], jacket: [26, 42, 78], accent: [239, 121, 48], mouth: "smile", pose: "point", headphones: true }],
    ["sprite_mio_worried", "mio-worried.png", { hair: [152, 88, 46], eyes: [214, 134, 48], jacket: [26, 42, 78], accent: [239, 121, 48], mouth: "surprised", pose: "front", headphones: true }],
  ];
  const characterAssets = characterSpecs.map(([id, filename, spec]) => {
    const file = makeTransparentCharacterSprite(path.join(assetsDir, filename), spec);
    const alphaReport = validateTransparentPng(file);
    op(`生成并校验透明角色素材 ${filename}`, `确认 ${id} 是独立 PNG 且带透明背景：${alphaReport}`);
    return dataAsset(id, "sprite", filename, fileDataUrl(file, "image/png"), "本轮验收生成的透明 PNG 角色神态素材。");
  });
  const assets = [
    dataAsset("bg_rooftop_sunset", "background", "campus-rooftop-generated.jpg", bgDataUrl, "AI 生成校园天台背景，经降采样压缩后用于本轮真实验收。"),
    dataAsset("bg_school_gate_evening", "background", "school-gate-evening.svg", svgDataUrl("校门 / 黄昏", "#516aa6", "#f0a05d")),
    dataAsset("bg_broadcast_room", "background", "broadcast-room.svg", svgDataUrl("广播室 / 放学后", "#2c5b7d", "#1a2238")),
    dataAsset("bg_library_window", "background", "library-window.svg", svgDataUrl("图书馆窗边", "#607d6f", "#273746")),
    ...characterAssets,
    dataAsset("portrait_transfer", "portrait", "portrait-transfer.png", fileDataUrl(path.join(assetsDir, "minami-neutral.png"), "image/png"), "转学生南遥头像/神态素材。"),
    dataAsset("portrait_president", "portrait", "portrait-president.png", fileDataUrl(path.join(assetsDir, "ren-calm.png"), "image/png"), "学生会长白石莲头像/神态素材。"),
    dataAsset("portrait_broadcast", "portrait", "portrait-broadcast.png", fileDataUrl(path.join(assetsDir, "mio-bright.png"), "image/png"), "广播社青木澪头像/神态素材。"),
    dataAsset("bgm_after_school", "bgm", "after-school-bgm.txt", "data:audio/wav;charset=utf-8,placeholder%20campus%20bgm"),
    dataAsset("sfx_school_bell", "sfx", "school-bell-sfx.txt", "data:audio/wav;charset=utf-8,placeholder%20school%20bell"),
    dataAsset("anim_sunset_flash", "animation", "sunset-flash.json", `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ id: "anim_sunset_flash", duration: 520 }))}`),
  ];

  const scenes = {
    intro: {
      scene_id: "scene_rooftop_intro",
      title: "放学后的天台信号",
      summary: "转学生南遥第一次被邀请到天台，发现学生会长、广播社同学都在等待一个选择。",
      chapter: 1,
      tags: ["校园", "开场", "天台"],
      commands: [
        { type: "background", background_id: "bg_rooftop_sunset", transition: "fade" },
        { type: "bgm", bgm_id: "bgm_after_school", action: "play", volume: 0.72, fade_ms: 600 },
        { type: "sfx", sfx_id: "sfx_school_bell", volume: 0.5 },
        { type: "sprite", character_id: "minami_haru", sprite_id: "sprite_minami_neutral", position: "center", animation: "fade_in", visible: true },
        { type: "narration", text: "放学铃声停下后，天台的风把社团招新的传单吹得哗哗作响。" },
        { type: "dialog", character_id: "minami_haru", text: "我只是来还钥匙的。为什么学生会长和广播社的人都在这里？", emotion: "confused", portrait: "portrait_transfer", side: "left" },
        { type: "dialog", character_id: "shiraishi_ren", text: "因为你是唯一听见旧广播室杂音的人。文化祭前，我们需要一个诚实的见证者。", emotion: "calm", portrait: "portrait_president", side: "right" },
        { type: "dialog", character_id: "aoki_mio", text: "也可能是天线坏了啦。但如果它真的在播十年前的留言，那就太适合做广播剧了！", emotion: "bright", portrait: "portrait_broadcast", side: "right" },
        { type: "state_update", key: "chapter", operation: "set", value: 1 },
        { type: "wait", duration_ms: 420 },
      ],
    },
    president: {
      scene_id: "scene_president_route",
      title: "学生会资料室",
      summary: "南遥帮助白石莲查文化祭旧档案，发现被删掉的演出名单。",
      chapter: 1,
      tags: ["学生会", "调查"],
      commands: [
        { type: "background", background_id: "bg_library_window", transition: "fade" },
        { type: "sprite", character_id: "shiraishi_ren", sprite_id: "sprite_ren_calm", position: "right", animation: "slide_in_right", visible: true },
        { type: "dialog", character_id: "shiraishi_ren", text: "这份名单被涂黑的名字，和你转来那天交给我的旧钥匙编号一致。", portrait: "portrait_president", side: "right" },
        { type: "dialog", character_id: "minami_haru", text: "所以我不是偶然转来这里？", portrait: "portrait_transfer", side: "left" },
        { type: "state_update", key: "trust_president", operation: "set", value: 2 },
      ],
    },
    broadcast: {
      scene_id: "scene_broadcast_route",
      title: "广播室的试音",
      summary: "青木澪邀请南遥一起试音，录下了只有旧设备才能听见的留言。",
      chapter: 1,
      tags: ["广播社", "线索"],
      commands: [
        { type: "background", background_id: "bg_broadcast_room", transition: "slide" },
        { type: "sprite", character_id: "aoki_mio", sprite_id: "sprite_mio_bright", position: "right", animation: "slide_in_right", visible: true },
        { type: "dialog", character_id: "aoki_mio", text: "三、二、一，欢迎收听今天的放学后频道！如果听见过去，请不要立刻逃跑。", portrait: "portrait_broadcast", side: "right" },
        { type: "dialog", character_id: "minami_haru", text: "磁带里有人在喊我的姓。可那时候我还没出生。", portrait: "portrait_transfer", side: "left" },
        { type: "state_update", key: "found_tape", operation: "set", value: true },
      ],
    },
    transfer: {
      scene_id: "scene_transfer_memory",
      title: "校门口的信",
      summary: "南遥独自追查父亲留下的信，必须决定是否相信新朋友。",
      chapter: 2,
      tags: ["转学生", "第二章"],
      commands: [
        { type: "background", background_id: "bg_school_gate_evening", transition: "fade" },
        { type: "sprite", character_id: "minami_haru", sprite_id: "sprite_minami_surprised", position: "center", animation: "fade_in", visible: true },
        { type: "narration", text: "第二天黄昏，南遥在校门口看见一封没有署名的信。信封上只有一句话：别让文化祭重演。" },
        { type: "dialog", character_id: "minami_haru", text: "如果这真是父亲留下的线索，我就不能再只是旁观者。", portrait: "portrait_transfer", side: "left" },
      ],
    },
  };

  const nodes = [
    { id: "start", type: "startNode", position: { x: 40, y: 280 }, data: baseNodeData("start", "入口", "校园示例唯一入口节点。") },
    sceneNode("scene_intro", 330, 200, scenes.intro),
    choiceNode("choice_first_signal", 700, 210, "第一道放学后选择", [
      { choice_id: "choice_president", text: "帮学生会长查旧档案", target_scene_id: "", conditions: [] },
      { choice_id: "choice_broadcast", text: "跟广播社同学去试音", target_scene_id: "", conditions: [] },
      { choice_id: "choice_transfer", text: "独自追查旧信", target_scene_id: "", conditions: [] },
    ]),
    sceneNode("scene_president", 1080, 40, scenes.president),
    sceneNode("scene_broadcast", 1080, 310, scenes.broadcast),
    sceneNode("scene_transfer", 1080, 590, scenes.transfer),
    modifierNode("modifier_president", 1420, 60, "记录学生会信任", "trust_president", 2),
    modifierNode("modifier_broadcast", 1420, 330, "记录广播磁带", "found_tape", true),
    choiceNode("choice_transfer_confess", 1420, 610, "旧信是否公开", [
      { choice_id: "choice_share_letter", text: "把旧信交给两位朋友", target_scene_id: "", conditions: [] },
      { choice_id: "choice_hide_letter", text: "暂时把旧信藏起来", target_scene_id: "", conditions: [] },
    ]),
    conditionNode("condition_president", 1760, 70, "学生会信任判定", "trust_president", "greater_or_equal", 2, "number", "信任足够", "信任不足"),
    animationNode("animation_broadcast", 1760, 330, "广播灯亮起"),
    modifierNode("modifier_share", 1760, 600, "记录公开旧信", "shared_letter", true),
    modifierNode("modifier_hide", 1760, 760, "记录隐藏旧信", "shared_letter", false),
    endNode("ending_rooftop_committee", 2140, 40, "共同策划文化祭", "南遥和白石莲一起修复被删掉的文化祭档案。"),
    endNode("ending_quiet_archive", 2140, 190, "沉默的资料室", "线索被保存下来，但南遥还没有准备好公开真相。"),
    endNode("ending_radio_drama", 2140, 330, "放学后频道开播", "广播社把旧留言改编成广播剧，三个人决定一起调查。"),
    endNode("ending_shared_letter", 2140, 600, "三人的旧信", "南遥公开旧信，三人约定文化祭前找到真正的留言者。"),
    endNode("ending_hidden_letter", 2140, 760, "独自保管的信", "南遥把信藏进书包，第二章从孤独调查开始。"),
  ];
  const edges = [
    ["edge_start_intro", "start", "scene_intro", "default"],
    ["edge_intro_choice", "scene_intro", "choice_first_signal", "default"],
    ["edge_choice_president", "choice_first_signal", "scene_president", "choice_president"],
    ["edge_choice_broadcast", "choice_first_signal", "scene_broadcast", "choice_broadcast"],
    ["edge_choice_transfer", "choice_first_signal", "scene_transfer", "choice_transfer"],
    ["edge_president_modifier", "scene_president", "modifier_president", "default"],
    ["edge_broadcast_modifier", "scene_broadcast", "modifier_broadcast", "default"],
    ["edge_transfer_choice", "scene_transfer", "choice_transfer_confess", "default"],
    ["edge_modifier_condition", "modifier_president", "condition_president", "default"],
    ["edge_condition_true", "condition_president", "ending_rooftop_committee", "true"],
    ["edge_condition_false", "condition_president", "ending_quiet_archive", "false"],
    ["edge_broadcast_anim", "modifier_broadcast", "animation_broadcast", "default"],
    ["edge_anim_radio_end", "animation_broadcast", "ending_radio_drama", "default"],
    ["edge_share_modifier", "choice_transfer_confess", "modifier_share", "choice_share_letter"],
    ["edge_hide_modifier", "choice_transfer_confess", "modifier_hide", "choice_hide_letter"],
    ["edge_share_end", "modifier_share", "ending_shared_letter", "default"],
    ["edge_hide_end", "modifier_hide", "ending_hidden_letter", "default"],
  ].map(([id, source, target, sourceHandle]) => ({ id, source, target, sourceHandle }));
  const now = new Date().toISOString();
  return {
    schema_version: "1.0.0",
    project_id: "campus_signal_acceptance",
    title: "放学后的天台信号",
    author: "AgentVN 真实验收",
    nodes,
    edges,
    viewport: { x: -80, y: 60, zoom: 0.72 },
    memory_mode: "hybrid",
    asset_manifest: assets,
    editor_settings: {},
    created_at: now,
    updated_at: now,
  };
}

function makeCampusProject() {
  const images = latestGeneratedImages(2);
  const assetsDir = path.join(campusFinal, "generated-assets");
  ensureDir(assetsDir);
  const generatedBackground = images[1] || images[0];
  const generatedSpriteSource = images[0];
  const bgCompressed = generatedBackground ? compressedImageCopy(generatedBackground, path.join(assetsDir, "campus-ai-background.jpg"), 960, 68) : undefined;
  if (generatedSpriteSource) compressedImageCopy(generatedSpriteSource, path.join(assetsDir, "campus-ai-sprite-reference.jpg"), 960, 68);

  const bgDataUrl = bgCompressed ? fileDataUrl(bgCompressed, "image/jpeg") : svgDataUrl("走廊公告栏 / 文化祭前夕", "#375d86", "#d28a5f");
  const characterSpecs = [
    ["sprite_shen_argue", "shen-yan-argue.png", { hair: [35, 42, 64], eyes: [58, 94, 150], jacket: [24, 39, 76], accent: [235, 146, 68], mouth: "serious", pose: "point", name_tag: true }],
    ["sprite_shen_calm", "shen-yan-calm.png", { hair: [35, 42, 64], eyes: [58, 94, 150], jacket: [24, 39, 76], accent: [235, 146, 68], mouth: "smile", pose: "book", name_tag: true }],
    ["sprite_lin_rule", "lin-zhiyao-rule.png", { hair: [45, 37, 57], eyes: [80, 86, 150], jacket: [18, 37, 72], accent: [92, 166, 210], mouth: "serious", pose: "book", name_tag: true }],
    ["sprite_lin_soft", "lin-zhiyao-soft.png", { hair: [45, 37, 57], eyes: [80, 86, 150], jacket: [18, 37, 72], accent: [92, 166, 210], mouth: "smile", pose: "front", name_tag: true }],
    ["sprite_zhou_defensive", "zhou-ming-defensive.png", { hair: [122, 80, 44], eyes: [198, 112, 38], jacket: [26, 42, 78], accent: [238, 115, 62], mouth: "surprised", pose: "front", headphones: true }],
    ["sprite_zhou_relieved", "zhou-ming-relieved.png", { hair: [122, 80, 44], eyes: [198, 112, 38], jacket: [26, 42, 78], accent: [238, 115, 62], mouth: "smile", pose: "point", headphones: true }],
    ["sprite_xu_pressure", "xu-yuan-pressure.png", { hair: [58, 67, 78], eyes: [74, 112, 126], jacket: [35, 54, 82], accent: [105, 188, 146], mouth: "serious", pose: "front" }],
    ["sprite_teacher_gao", "teacher-gao.png", { hair: [82, 78, 72], eyes: [92, 98, 118], jacket: [68, 72, 86], accent: [210, 160, 78], mouth: "serious", pose: "book" }],
  ];
  const codexSpriteSources = new Map([
    ["shen-yan-argue.png", "shen-yan-focused.png"],
    ["shen-yan-calm.png", "shen-yan-focused.png"],
    ["lin-zhiyao-rule.png", "lin-zhiyao-stern.png"],
    ["lin-zhiyao-soft.png", "lin-zhiyao-stern.png"],
    ["zhou-ming-defensive.png", "zhou-ming-defensive.png"],
    ["zhou-ming-relieved.png", "zhou-ming-defensive.png"],
    ["xu-yuan-pressure.png", "xu-yuan-pressure.png"],
    ["teacher-gao.png", "teacher-gao-concerned.png"],
  ]);
  const generatedSpriteReports = [];
  const characterAssets = characterSpecs.map(([id, filename, spec]) => {
    const codexSourceName = codexSpriteSources.get(filename);
    const codexSource = codexSourceName ? path.join(codexCharacterAssetDir, codexSourceName) : "";
    const file = path.join(assetsDir, filename);
    if (codexSource && fs.existsSync(codexSource)) {
      fs.copyFileSync(codexSource, file);
    } else if (skipImageProvider) {
      throw new Error(`缺少 Codex 生成角色图：${codexSource || filename}`);
    } else {
      makeTransparentCharacterSprite(file, spec);
    }
    const alphaReport = validateTransparentPng(file);
    generatedSpriteReports.push(`${id}: ${alphaReport}`);
    op(
      `${codexSource && fs.existsSync(codexSource) ? "导入 Codex 生成" : "生成并校验"}透明角色素材 ${filename}`,
      `确认 ${id} 是独立透明 PNG，不是白底整图或多人合图：${alphaReport}`
    );
    return dataAsset(id, "sprite", filename, fileDataUrl(file, "image/png"), "本轮验收使用的独立透明 PNG 角色神态素材。");
  });
  const spriteFile = (filename) => path.join(assetsDir, filename);
  const assets = [
    dataAsset("bg_notice_corridor", "background", "corridor-notice-board.jpg", bgDataUrl, "AI/脚本混合生成校园公告栏背景，用于本轮真实验收。"),
    dataAsset("bg_broadcast_room", "background", "broadcast-room.svg", svgDataUrl("广播室 / 设备台", "#2d5878", "#131b2b")),
    dataAsset("bg_council_room", "background", "student-council-room.svg", svgDataUrl("学生会会议室", "#5b5f92", "#202134")),
    dataAsset("bg_playground_after_school", "background", "after-school-playground.svg", svgDataUrl("放学后的操场", "#6b7d67", "#d49b5f")),
    ...characterAssets,
    dataAsset("portrait_shen_argue", "portrait", "portrait-shen-argue.png", fileDataUrl(spriteFile("shen-yan-argue.png"), "image/png"), "沈砚争执表情。"),
    dataAsset("portrait_shen_calm", "portrait", "portrait-shen-calm.png", fileDataUrl(spriteFile("shen-yan-calm.png"), "image/png"), "沈砚冷静表情。"),
    dataAsset("portrait_lin_rule", "portrait", "portrait-lin-rule.png", fileDataUrl(spriteFile("lin-zhiyao-rule.png"), "image/png"), "林知遥坚持程序表情。"),
    dataAsset("portrait_lin_soft", "portrait", "portrait-lin-soft.png", fileDataUrl(spriteFile("lin-zhiyao-soft.png"), "image/png"), "林知遥缓和表情。"),
    dataAsset("portrait_zhou_defensive", "portrait", "portrait-zhou-defensive.png", fileDataUrl(spriteFile("zhou-ming-defensive.png"), "image/png"), "周鸣防御表情。"),
    dataAsset("portrait_zhou_relieved", "portrait", "portrait-zhou-relieved.png", fileDataUrl(spriteFile("zhou-ming-relieved.png"), "image/png"), "周鸣释然表情。"),
    dataAsset("portrait_xu_pressure", "portrait", "portrait-xu-yuan.png", fileDataUrl(spriteFile("xu-yuan-pressure.png"), "image/png"), "许沅压力表情。"),
    dataAsset("portrait_teacher_gao", "portrait", "portrait-teacher-gao.png", fileDataUrl(spriteFile("teacher-gao.png"), "image/png"), "高老师表情。"),
    dataAsset("bgm_after_school_argument", "bgm", "after-school-argument.txt", "data:audio/wav;charset=utf-8,placeholder%20campus%20argument%20bgm"),
    dataAsset("sfx_notice_paper", "sfx", "notice-paper-sfx.txt", "data:audio/wav;charset=utf-8,placeholder%20paper%20sfx"),
    dataAsset("sfx_bell", "sfx", "school-bell-sfx.txt", "data:audio/wav;charset=utf-8,placeholder%20bell%20sfx"),
    dataAsset("anim_notice_flash", "animation", "notice-flash.json", `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ id: "anim_notice_flash", duration: 520 }))}`),
  ];

  const scenes = {
    opening: {
      scene_id: "scene_notice_argument",
      title: "放学后的公告栏",
      summary: "文化祭前夕，公告栏出现匿名举报，沈砚、林知遥和周鸣在走廊爆发争执。",
      chapter: 1,
      tags: ["校园", "公告栏", "争执", "无爱情"],
      commands: [
        { type: "background", background_id: "bg_notice_corridor", transition: "fade" },
        { type: "bgm", bgm_id: "bgm_after_school_argument", action: "play", volume: 0.72, fade_ms: 600 },
        { type: "sfx", sfx_id: "sfx_bell", volume: 0.45 },
        { type: "sfx", sfx_id: "sfx_notice_paper", volume: 0.56 },
        { type: "sprite", character_id: "shen_yan", sprite_id: "sprite_shen_argue", position: "left", animation: "slide_in_left", visible: true },
        { type: "sprite", character_id: "lin_zhiyao", sprite_id: "sprite_lin_rule", position: "center", animation: "fade_in", visible: true },
        { type: "sprite", character_id: "zhou_ming", sprite_id: "sprite_zhou_defensive", position: "right", animation: "slide_in_right", visible: true },
        { type: "animation", animation_id: "anim_notice_flash", target: "screen", params: { duration: 420 }, blocking: true },
        { type: "camera", action: "shake", params: { duration: 240, strength: 0.22 }, blocking: true },
        { type: "narration", text: "匿名举报贴在公告栏最显眼的位置：广播社伪造采访素材，文化祭节目资格应当取消。" },
        { type: "dialog", character_id: "shen_yan", text: "先别撕。纸上的时间、采访对象和广播社排班对不上，我需要原始记录。", emotion: "argue", portrait: "portrait_shen_argue", side: "left" },
        { type: "dialog", character_id: "lin_zhiyao", text: "如果公告属实，学生会必须启动程序。越拖，班级压力越会压到无关的人身上。", emotion: "rule", portrait: "portrait_lin_rule", side: "right" },
        { type: "dialog", character_id: "zhou_ming", text: "你们已经把我当成造假的人了吧？我承认剪过采访，但那是去掉噪音，不是改答案。", emotion: "defensive", portrait: "portrait_zhou_defensive", side: "right" },
        { type: "dialog", character_id: "xu_yuan", text: "班里已经有人要求广播社退节目。文化祭只剩三天，谁来承担停播后的混乱？", emotion: "pressure", portrait: "portrait_xu_pressure", side: "left" },
        { type: "state_update", key: "evidence_score", operation: "set", value: 0 },
        { type: "state_update", key: "zhou_trust", operation: "set", value: 0 },
        { type: "state_update", key: "public_pressure", operation: "set", value: 1 },
        { type: "state_update", key: "student_council_involved", operation: "set", value: false },
        { type: "wait", duration_ms: 420 },
      ],
    },
    publicQuestion: {
      scene_id: "scene_public_question",
      title: "公开质问",
      summary: "沈砚选择在公告栏前公开追问，压力迅速扩大，但更多证人愿意交出线索。",
      chapter: 1,
      tags: ["公开", "压力"],
      commands: [
        { type: "background", background_id: "bg_notice_corridor", transition: "fade" },
        { type: "sprite", character_id: "shen_yan", sprite_id: "sprite_shen_argue", position: "left", animation: "slide_in_left", visible: true },
        { type: "sprite", character_id: "zhou_ming", sprite_id: "sprite_zhou_defensive", position: "right", animation: "fade_in", visible: true },
        { type: "dialog", character_id: "shen_yan", text: "周鸣，原始录音在哪？如果你没有伪造，就让每个人都听到未剪辑的版本。", portrait: "portrait_shen_argue", side: "left" },
        { type: "dialog", character_id: "zhou_ming", text: "当众逼问不会让真相更快，只会让所有人先认定我有罪。", portrait: "portrait_zhou_defensive", side: "right" },
        { type: "dialog", character_id: "gao_teacher", text: "公开可以带来证人，也会带来伤害。你们要清楚，这不是一场辩论赛。", portrait: "portrait_teacher_gao", side: "right" },
        { type: "state_update", key: "public_pressure", operation: "set", value: 3 },
        { type: "state_update", key: "evidence_score", operation: "set", value: 1 },
        { type: "state_update", key: "zhou_trust", operation: "set", value: -1 },
      ],
    },
    privateInvestigation: {
      scene_id: "scene_private_investigation",
      title: "私下调查",
      summary: "沈砚先保留公告复印件，和林知遥核对时间线，避免事件立刻失控。",
      chapter: 1,
      tags: ["调查", "证据"],
      commands: [
        { type: "background", background_id: "bg_council_room", transition: "fade" },
        { type: "sprite", character_id: "shen_yan", sprite_id: "sprite_shen_calm", position: "left", animation: "fade_in", visible: true },
        { type: "sprite", character_id: "lin_zhiyao", sprite_id: "sprite_lin_rule", position: "right", animation: "slide_in_right", visible: true },
        { type: "dialog", character_id: "shen_yan", text: "我不想让举报先变成审判。先把采访时间线排出来，再决定是否公开。", portrait: "portrait_shen_calm", side: "left" },
        { type: "dialog", character_id: "lin_zhiyao", text: "可以。但调查不能只保护一个社团，也要保护被采访者的原话。", portrait: "portrait_lin_rule", side: "right" },
        { type: "state_update", key: "evidence_score", operation: "set", value: 2 },
        { type: "state_update", key: "zhou_trust", operation: "set", value: 1 },
        { type: "state_update", key: "public_pressure", operation: "set", value: 1 },
      ],
    },
    protectBroadcast: {
      scene_id: "scene_protect_broadcast",
      title: "先保护广播社",
      summary: "沈砚先让周鸣离开人群，换来解释机会，但证据收集变慢。",
      chapter: 1,
      tags: ["保护", "信任"],
      commands: [
        { type: "background", background_id: "bg_broadcast_room", transition: "slide" },
        { type: "sprite", character_id: "zhou_ming", sprite_id: "sprite_zhou_relieved", position: "right", animation: "slide_in_right", visible: true },
        { type: "sprite", character_id: "shen_yan", sprite_id: "sprite_shen_calm", position: "left", animation: "fade_in", visible: true },
        { type: "dialog", character_id: "zhou_ming", text: "谢谢你没有在走廊里逼我。原始录音在旧主机里，但里面有另一个人的名字。", portrait: "portrait_zhou_relieved", side: "right" },
        { type: "dialog", character_id: "shen_yan", text: "我不是替你脱罪。我只是想让每个人为自己做过的事负责。", portrait: "portrait_shen_calm", side: "left" },
        { type: "state_update", key: "zhou_trust", operation: "set", value: 2 },
        { type: "state_update", key: "evidence_score", operation: "set", value: 0 },
        { type: "state_update", key: "public_pressure", operation: "set", value: 0 },
      ],
    },
    trustZhou: {
      scene_id: "scene_trust_zhou",
      title: "相信周鸣解释",
      summary: "沈砚相信周鸣的剪辑说明，争取先听完整录音再定性。",
      chapter: 1,
      tags: ["信任", "录音"],
      commands: [
        { type: "background", background_id: "bg_broadcast_room", transition: "fade" },
        { type: "dialog", character_id: "zhou_ming", text: "原始采访里，受访者请求不要公开家庭情况。我删掉的是隐私，不是事实。", portrait: "portrait_zhou_relieved", side: "right" },
        { type: "dialog", character_id: "lin_zhiyao", text: "理由成立，但程序仍要留下记录。保护隐私不等于绕过审核。", portrait: "portrait_lin_soft", side: "left" },
        { type: "state_update", key: "zhou_trust", operation: "add", value: 1 },
      ],
    },
    demandRaw: {
      scene_id: "scene_demand_raw",
      title: "要求交出原始录音",
      summary: "沈砚坚持证据优先，广播室主机里找到两段时间戳冲突的采访。",
      chapter: 1,
      tags: ["证据", "原始录音"],
      commands: [
        { type: "background", background_id: "bg_broadcast_room", transition: "fade" },
        { type: "dialog", character_id: "shen_yan", text: "我不会用你的解释替代证据。把原始录音导出来，我们一起听。", portrait: "portrait_shen_argue", side: "left" },
        { type: "dialog", character_id: "zhou_ming", text: "好。但如果听完你们发现匿名举报也剪掉了上下文，就别再用一句话定罪。", portrait: "portrait_zhou_defensive", side: "right" },
        { type: "state_update", key: "evidence_score", operation: "add", value: 1 },
      ],
    },
    askCouncil: {
      scene_id: "scene_ask_council",
      title: "请学生会介入",
      summary: "林知遥召集临时会议，程序更清晰，但广播社面临停播风险。",
      chapter: 1,
      tags: ["学生会", "程序"],
      commands: [
        { type: "background", background_id: "bg_council_room", transition: "fade" },
        { type: "sprite", character_id: "lin_zhiyao", sprite_id: "sprite_lin_rule", position: "center", animation: "fade_in", visible: true },
        { type: "dialog", character_id: "lin_zhiyao", text: "从现在开始，证据、证词、处分建议分开记录。任何人都不能用舆论代替结论。", portrait: "portrait_lin_rule", side: "right" },
        { type: "dialog", character_id: "xu_yuan", text: "如果程序拖到文化祭当天，整个年级都会怪广播社。你们准备好承担吗？", portrait: "portrait_xu_pressure", side: "left" },
        { type: "state_update", key: "student_council_involved", operation: "set", value: true },
        { type: "state_update", key: "public_pressure", operation: "add", value: 1 },
      ],
    },
  };

  const nodes = [
    { id: "start", type: "startNode", position: { x: 40, y: 310 }, data: baseNodeData("start", "入口", "校园群像争执示例唯一入口节点。") },
    sceneNode("scene_opening", 330, 220, scenes.opening),
    choiceNode("choice_first_action", 720, 230, "第一选择：如何处理公告", [
      { choice_id: "choice_public_question", text: "公开质问", target_scene_id: "", conditions: [] },
      { choice_id: "choice_private_investigation", text: "私下调查", target_scene_id: "", conditions: [] },
      { choice_id: "choice_protect_broadcast", text: "先保护广播社", target_scene_id: "", conditions: [] },
    ]),
    sceneNode("scene_public_question", 1120, 40, scenes.publicQuestion),
    sceneNode("scene_private_investigation", 1120, 330, scenes.privateInvestigation),
    sceneNode("scene_protect_broadcast", 1120, 630, scenes.protectBroadcast),
    modifierNode("modifier_route_public", 1460, 70, "记录公开质问路线", "route_first_action", "public_question"),
    modifierNode("modifier_route_private", 1460, 360, "记录私下调查路线", "route_first_action", "private_investigation"),
    modifierNode("modifier_route_protect", 1460, 660, "记录保护广播社路线", "route_first_action", "protect_broadcast"),
    choiceNode("choice_second_action", 1830, 340, "第二选择：如何推进真相", [
      { choice_id: "choice_trust_zhou", text: "相信周鸣解释", target_scene_id: "", conditions: [] },
      { choice_id: "choice_demand_raw", text: "要求交出原始录音", target_scene_id: "", conditions: [] },
      { choice_id: "choice_ask_council", text: "请学生会介入", target_scene_id: "", conditions: [] },
    ]),
    sceneNode("scene_trust_zhou", 2220, 80, scenes.trustZhou),
    sceneNode("scene_demand_raw", 2220, 360, scenes.demandRaw),
    sceneNode("scene_ask_council", 2220, 640, scenes.askCouncil),
    conditionNode("condition_zhou_trust", 2580, 90, "周鸣信任判定", "zhou_trust", "greater_or_equal", 2, "number", "愿意共同更正", "沉默平息"),
    conditionNode("condition_evidence_score", 2580, 370, "证据充足判定", "evidence_score", "greater_or_equal", 2, "number", "证据成立", "证据不足"),
    conditionNode("condition_council_pressure", 2580, 650, "程序压力判定", "public_pressure", "greater_or_equal", 2, "number", "程序启动", "压力下降"),
    animationNode("animation_public_correction", 2920, 70, "公告栏更正动画"),
    endNode("ending_public_correction", 3260, 70, "公开更正", "广播社保留文化祭资格，但所有人公开承担剪辑和审核责任。"),
    endNode("ending_silence", 2920, 230, "沉默平息", "文化祭顺利举行，但公告栏留下新的匿名信。"),
    endNode("ending_misjudge", 2920, 430, "证据不足的误判", "证据不足时仓促定性，玩家需要读档尝试另一条路线。"),
    endNode("ending_procedure", 2920, 650, "程序胜利", "广播社停播，真相被记录，但几个人的关系出现裂痕。"),
  ];
  const edges = [
    ["edge_start_opening", "start", "scene_opening", "default"],
    ["edge_opening_first", "scene_opening", "choice_first_action", "default"],
    ["edge_first_public", "choice_first_action", "scene_public_question", "choice_public_question"],
    ["edge_first_private", "choice_first_action", "scene_private_investigation", "choice_private_investigation"],
    ["edge_first_protect", "choice_first_action", "scene_protect_broadcast", "choice_protect_broadcast"],
    ["edge_public_modifier", "scene_public_question", "modifier_route_public", "default"],
    ["edge_private_modifier", "scene_private_investigation", "modifier_route_private", "default"],
    ["edge_protect_modifier", "scene_protect_broadcast", "modifier_route_protect", "default"],
    ["edge_public_second", "modifier_route_public", "choice_second_action", "default"],
    ["edge_private_second", "modifier_route_private", "choice_second_action", "default"],
    ["edge_protect_second", "modifier_route_protect", "choice_second_action", "default"],
    ["edge_second_trust", "choice_second_action", "scene_trust_zhou", "choice_trust_zhou"],
    ["edge_second_raw", "choice_second_action", "scene_demand_raw", "choice_demand_raw"],
    ["edge_second_council", "choice_second_action", "scene_ask_council", "choice_ask_council"],
    ["edge_trust_condition", "scene_trust_zhou", "condition_zhou_trust", "default"],
    ["edge_raw_condition", "scene_demand_raw", "condition_evidence_score", "default"],
    ["edge_council_condition", "scene_ask_council", "condition_council_pressure", "default"],
    ["edge_trust_true", "condition_zhou_trust", "animation_public_correction", "true"],
    ["edge_trust_false", "condition_zhou_trust", "ending_silence", "false"],
    ["edge_evidence_true", "condition_evidence_score", "animation_public_correction", "true"],
    ["edge_evidence_false", "condition_evidence_score", "ending_misjudge", "false"],
    ["edge_council_true", "condition_council_pressure", "ending_procedure", "true"],
    ["edge_council_false", "condition_council_pressure", "ending_silence", "false"],
    ["edge_animation_public_end", "animation_public_correction", "ending_public_correction", "default"],
  ].map(([id, source, target, sourceHandle]) => ({ id, source, target, sourceHandle }));
  const now = new Date().toISOString();
  return {
    schema_version: "1.0.0",
    project_id: "campus_notice_argument_acceptance",
    title: "放学后的公告栏",
    author: "AgentVN 真实验收",
    nodes,
    edges,
    viewport: { x: -120, y: 80, zoom: 0.52 },
    memory_mode: "hybrid",
    asset_manifest: assets,
    editor_settings: {
      acceptanceNotes: {
        noRomance: true,
        spriteAlphaReports: generatedSpriteReports,
      },
    },
    created_at: now,
    updated_at: now,
  };
}

async function clearBrowserState(page, scope) {
  await page.addInitScript((scopeName) => {
    const keepProviderKeys = new Set([
      "agentvn.providerConnections",
      "agentvn.providerModels",
      "agentvn.providerTokens",
      "agentvn.providerSecrets",
      "agentvn.providerSelections",
    ]);
    for (const key of Object.keys(localStorage)) {
      if (keepProviderKeys.has(key)) continue;
      if (key === "agentvn.recentProjects" || key === "agentvn.currentProjectDraft" || key.startsWith("agentvn.gamecli.") || key.startsWith("vn.runtime.")) {
        localStorage.removeItem(key);
      }
      if (scopeName === "full" && /(campus|novel|best|rain|locker|school|signal)/i.test(key)) {
        localStorage.removeItem(key);
      }
    }
  }, scope);
}

async function verifyProviderConfigured(page) {
  const sharedState = await loadBackendSharedState().catch(() => null);
  const status = await page.evaluate((remoteState) => {
    const readJson = (key, fallback) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && parsed.state ? parsed.state : parsed;
      } catch {
        return fallback;
      }
    };
    const remote = remoteState && typeof remoteState === "object" ? remoteState : {};
    const keys = Object.keys(localStorage);
    const localConnections = readJson("agentvn.providerConnections", []);
    const localModels = readJson("agentvn.providerModels", []);
    const localSelections = readJson("agentvn.providerSelections", {});
    const localSecrets = readJson("agentvn.providerSecrets", {});
    const connections = Array.isArray(remote.provider_connections) && remote.provider_connections.length
      ? remote.provider_connections
      : localConnections;
    const models = Array.isArray(remote.provider_models) && remote.provider_models.length
      ? remote.provider_models
      : localModels;
    const selections = {
      ...(remote.provider_selections && typeof remote.provider_selections === "object" ? remote.provider_selections : {}),
      ...(localSelections && typeof localSelections === "object" ? localSelections : {}),
    };
    const secrets = {
      ...(localSecrets && typeof localSecrets === "object" ? localSecrets : {}),
      ...(remote.provider_secrets && typeof remote.provider_secrets === "object" ? remote.provider_secrets : {}),
    };
    const enabledConnections = new Set(
      connections.filter((connection) => connection && connection.enabled !== false).map((connection) => connection.connection_id)
    );
    const textModels = models.filter((model) => {
      if (!model || model.enabled === false) return false;
      if (!enabledConnections.has(model.connection_id)) return false;
      return Array.isArray(model.capabilities) && model.capabilities.includes("text_generation");
    });
    const selected = textModels.find((model) => model.provider_id === selections.text_generation) ?? textModels[0];
    return {
      keys,
      hasTextModel: textModels.length > 0,
      hasPromptModel: textModels.some((model) => Array.isArray(model.capabilities) && model.capabilities.includes("prompt_rewrite")),
      hasTextToken: Boolean(selected && secrets[selected.connection_id]),
      selectedModel: selected
        ? {
            provider_id: selected.provider_id,
            connection_id: selected.connection_id,
            model_id: selected.model_id,
            model_name: selected.model_name,
            display_name: selected.display_name,
          }
        : null,
      availableTextModels: textModels.map((model) => ({
        provider_id: model.provider_id,
        connection_id: model.connection_id,
        model_id: model.model_id,
        model_name: model.model_name,
        display_name: model.display_name,
        capabilities: model.capabilities,
      })),
    };
  }, sharedState);
  if (!status.hasTextModel) {
    throw new Error(`未检测到可用文本生成模型配置。localStorage keys: ${status.keys.join(", ")}`);
  }
  if (!status.hasTextToken) {
    throw new Error(
      `已检测到文本模型，但没有检测到对应连接的 API Token，已停止测试以避免无效请求。\n当前模型：${JSON.stringify(status.selectedModel, null, 2)}\n可用文本模型：${JSON.stringify(status.availableTextModels, null, 2)}`
    );
  }
  op("确认本机存在真实文本模型配置和对应 Token", "校园生成和小说导入都必须使用真实模型接口，且不能在缺 Token 时继续消耗测试步骤");
}

async function selectFlashModelForAcceptance(page) {
  await page.waitForFunction(
    () => {
      try {
        const models = JSON.parse(localStorage.getItem("agentvn.providerModels") || "[]");
        const connections = JSON.parse(localStorage.getItem("agentvn.providerConnections") || "[]");
        return Array.isArray(models) && models.length > 0 && Array.isArray(connections) && connections.length > 0;
      } catch {
        return false;
      }
    },
    null,
    { timeout: 30000 }
  ).catch(() => {});

  const result = await page.evaluate(() => {
    const connections = JSON.parse(localStorage.getItem("agentvn.providerConnections") || "[]");
    const models = JSON.parse(localStorage.getItem("agentvn.providerModels") || "[]");
    const selections = JSON.parse(localStorage.getItem("agentvn.providerSelections") || "{}");
    const enabledConnections = new Set(
      connections
        .filter((connection) => connection && connection.enabled !== false)
        .map((connection) => connection.connection_id)
    );
    const flash = models.find((model) => {
      if (!model || model.enabled === false) return false;
      if (!enabledConnections.has(model.connection_id)) return false;
      if (!Array.isArray(model.capabilities) || !model.capabilities.includes("text_generation")) return false;
      const haystack = `${model.model_id || ""} ${model.model_name || ""} ${model.display_name || ""}`.toLowerCase();
      return haystack.includes("deepseek-v4-flash");
    });
    if (!flash) {
      return {
        ok: false,
        message: "未找到已启用且具备 text_generation 能力的 deepseek-v4-flash 模型，未继续消耗 deepseek-v4-pro 配额。",
        availableModels: models.map((model) => ({
          provider_id: model?.provider_id,
          model_id: model?.model_id,
          model_name: model?.model_name,
          display_name: model?.display_name,
          enabled: model?.enabled,
          capabilities: model?.capabilities,
        })),
      };
    }
    const nextModels = models.map((model) => {
      if (!model || model.provider_id !== flash.provider_id) return model;
      const parameters = { ...(model.default_parameters || {}) };
      parameters.structured_mode = "json_object";
      parameters.thinking_mode = false;
      parameters.request_timeout_seconds = Math.max(Number(parameters.request_timeout_seconds || 0), 300);
      parameters.max_tokens = 4096;
      parameters.context_budget_tokens = 24000;
      parameters.temperature = 0.2;
      parameters.top_p = 0.9;
      return { ...model, default_parameters: parameters };
    });
    selections.text_generation = flash.provider_id;
    localStorage.setItem("agentvn.providerModels", JSON.stringify(nextModels));
    localStorage.setItem("agentvn.providerSelections", JSON.stringify(selections));
    return {
      ok: true,
      provider_id: flash.provider_id,
      model_id: flash.model_id,
      model_name: flash.model_name,
      display_name: flash.display_name,
    };
  });
  if (!result.ok) {
    throw new Error(`未找到已启用且具备 text_generation 能力的 deepseek-v4-flash 模型，未继续消耗 deepseek-v4-pro 配额。\n可用模型：${JSON.stringify(result.availableModels, null, 2)}`);
  }
  acceptanceState.textModel = result.model_name || result.model_id || result.display_name || "deepseek-v4-flash";
  acceptanceState.textProviderId = result.provider_id;
  op(`显式选择文本生成模型 ${acceptanceState.textModel}`, "确认本轮验收使用 deepseek-v4-flash、JSON 兼容模式、关闭思考模式，避免继续消耗 pro 配额");
  await pace(page);
  return;
  if (!result.ok) {
    throw new Error(`${result.message}\n可用模型：${JSON.stringify(result.availableModels, null, 2)}`);
  }
  acceptanceState.textModel = result.model_name || result.model_id || result.display_name || "deepseek-v4-flash";
  acceptanceState.textProviderId = result.provider_id;
  op(`显式选择文本生成模型 ${acceptanceState.textModel}`, "确认本轮验收使用 deepseek-v4-flash、JSON 兼容模式、关闭思考模式，避免继续消耗 pro 配额");
  await pace(page);
}

async function selectTextModelForAcceptance(page, target = "auto") {
  await page.waitForFunction(
    () => {
      try {
        const rawModels = localStorage.getItem("agentvn.providerModels");
        const rawConnections = localStorage.getItem("agentvn.providerConnections");
        return Boolean(rawModels && rawConnections);
      } catch {
        return false;
      }
    },
    null,
    { timeout: 30000 }
  ).catch(() => {});

  const sharedState = await loadBackendSharedState().catch(() => null);
  const result = await page.evaluate(({ targetName, remoteState }) => {
    const readJson = (key, fallback) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && parsed.state ? parsed.state : parsed;
      } catch {
        return fallback;
      }
    };
    const remote = remoteState && typeof remoteState === "object" ? remoteState : {};
    const localConnections = readJson("agentvn.providerConnections", []);
    const localModels = readJson("agentvn.providerModels", []);
    const localSelections = readJson("agentvn.providerSelections", {});
    const localSecrets = readJson("agentvn.providerSecrets", {});
    const connections = Array.isArray(remote.provider_connections) && remote.provider_connections.length
      ? remote.provider_connections
      : localConnections;
    const models = Array.isArray(remote.provider_models) && remote.provider_models.length
      ? remote.provider_models
      : localModels;
    const selections = {
      ...(remote.provider_selections && typeof remote.provider_selections === "object" ? remote.provider_selections : {}),
      ...(localSelections && typeof localSelections === "object" ? localSelections : {}),
    };
    const secrets = {
      ...(localSecrets && typeof localSecrets === "object" ? localSecrets : {}),
      ...(remote.provider_secrets && typeof remote.provider_secrets === "object" ? remote.provider_secrets : {}),
    };
    const enabledConnections = new Map(
      connections
        .filter((connection) => connection && connection.enabled !== false)
        .map((connection) => [connection.connection_id, connection])
    );
    const enabledTextModels = models.filter((model) => {
      if (!model || model.enabled === false) return false;
      if (!enabledConnections.has(model.connection_id)) return false;
      return Array.isArray(model.capabilities) && model.capabilities.includes("text_generation");
    });
    const specs = targetName === "gemini"
      ? [{ label: "gemini", needle: "gemini-3-flash-preview", max_tokens: 4096, context_budget_tokens: 24000 }]
      : targetName === "deepseek"
        ? [{ label: "deepseek", needle: "deepseek-v4-flash", max_tokens: 4096, context_budget_tokens: 24000 }]
        : [
            { label: "gemini", needle: "gemini-3-flash-preview", max_tokens: 4096, context_budget_tokens: 24000 },
            { label: "deepseek", needle: "deepseek-v4-flash", max_tokens: 4096, context_budget_tokens: 24000 },
          ];
    const availableModels = enabledTextModels.map((model) => ({
      provider_id: model.provider_id,
      connection_id: model.connection_id,
      model_id: model.model_id,
      model_name: model.model_name,
      display_name: model.display_name,
      capabilities: model.capabilities,
    }));
    for (const spec of specs) {
      const model = enabledTextModels.find((item) => {
        const haystack = `${item.model_id || ""} ${item.model_name || ""} ${item.display_name || ""}`.toLowerCase();
        return haystack.includes(spec.needle);
      });
      if (!model) continue;
      const hasToken = Boolean(secrets[model.connection_id]);
      if (!hasToken) {
        return {
          ok: false,
          blocked: true,
          tokenMissing: true,
          label: spec.label,
          message: `找到 ${spec.needle}，但该模型所在连接没有保存 API Token。请在 工具/设置 -> 模型/连接 点击“保存”保存 Token 后重试。`,
          selectedModel: {
            provider_id: model.provider_id,
            connection_id: model.connection_id,
            model_id: model.model_id,
            model_name: model.model_name,
            display_name: model.display_name,
            base_url: enabledConnections.get(model.connection_id)?.base_url,
          },
          availableModels,
        };
      }
      const nextModels = models.map((item) => {
        if (!item || item.provider_id !== model.provider_id) return item;
        const parameters = { ...(item.default_parameters || {}) };
        parameters.structured_mode = "json_object";
        parameters.thinking_mode = false;
        parameters.request_timeout_seconds = Math.max(Number(parameters.request_timeout_seconds || 0), 300);
        parameters.max_tokens = spec.max_tokens;
        parameters.context_budget_tokens = spec.context_budget_tokens;
        parameters.temperature = 0.2;
        parameters.top_p = 0.9;
        return { ...item, default_parameters: parameters };
      });
      selections.text_generation = model.provider_id;
      if (Array.isArray(model.capabilities) && model.capabilities.includes("prompt_rewrite")) {
        selections.prompt_rewrite = model.provider_id;
      }
      localStorage.setItem("agentvn.providerModels", JSON.stringify(nextModels));
      localStorage.setItem("agentvn.providerSelections", JSON.stringify(selections));
      localStorage.setItem("agentvn.providerConnections", JSON.stringify(connections));
      return {
        ok: true,
        label: spec.label,
        provider_id: model.provider_id,
        connection_id: model.connection_id,
        model_id: model.model_id,
        model_name: model.model_name,
        display_name: model.display_name,
        base_url: enabledConnections.get(model.connection_id)?.base_url,
        max_tokens: spec.max_tokens,
        provider_connections: connections,
        provider_models: nextModels,
        provider_selections: selections,
        has_token: true,
      };
    }
    return {
      ok: false,
      blocked: true,
      label: targetName,
      message: targetName === "auto"
        ? "未找到已启用的 gemini-3-flash-preview 或 deepseek-v4-flash。"
        : `未找到已启用的 ${targetName} 目标模型。`,
      availableModels,
    };
  }, { targetName: target, remoteState: sharedState });

  if (!result.ok) {
    const detail = `${result.message}\n可用模型：${JSON.stringify(result.availableModels, null, 2)}`;
    if (target !== "auto") throw new Error(detail);
    throw new Error(detail);
  }
  acceptanceState.textModel = result.model_name || result.model_id || result.display_name || result.label;
  acceptanceState.textProviderId = result.provider_id;
  acceptanceState.textModelLabel = result.label;
  await saveBackendSharedState({
    provider_connections: result.provider_connections,
    provider_models: result.provider_models,
    provider_selections: result.provider_selections,
  }).catch((error) => {
    failures.push(`模型选择已写入当前浏览器，但同步后端共享状态失败：${error instanceof Error ? error.message : String(error)}`);
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  op(
    `显式选择文本模型 ${acceptanceState.textModel}`,
    `目标=${target}，实际=${result.label}，JSON 兼容模式，thinking_mode=false，max_tokens=${result.max_tokens}，Token=${result.has_token ? "已检测" : "未检测"}`
  );
  await pace(page);
  return result;
}

async function selectImageModelForAcceptance(page) {
  const result = await page.evaluate(() => {
    const readJson = (key, fallback) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && parsed.state ? parsed.state : parsed;
      } catch {
        return fallback;
      }
    };
    const connections = readJson("agentvn.providerConnections", []);
    const models = readJson("agentvn.providerModels", []);
    const secrets = readJson("agentvn.providerSecrets", {});
    const selections = readJson("agentvn.providerSelections", {});
    const enabledConnections = new Set(connections.filter((item) => item && item.enabled !== false).map((item) => item.connection_id));
    const model = models.find((item) => {
      if (!item || item.enabled === false) return false;
      if (!enabledConnections.has(item.connection_id)) return false;
      if (!Array.isArray(item.capabilities) || !item.capabilities.includes("image_generation")) return false;
      const haystack = `${item.model_id || ""} ${item.model_name || ""} ${item.display_name || ""}`.toLowerCase();
      return haystack.includes("imagen-4.0-generate-001");
    });
    if (!model) {
      return { ok: false, message: "未找到启用且具备 image_generation 能力的 imagen-4.0-generate-001。" };
    }
    selections.image_generation = model.provider_id;
    localStorage.setItem("agentvn.providerSelections", JSON.stringify(selections));
    return {
      ok: true,
      provider_id: model.provider_id,
      model_name: model.model_name || model.model_id || model.display_name,
      has_token: Boolean(secrets[model.connection_id]),
    };
  });
  if (!result.ok) {
    failures.push(`Imagen 模型预检失败：${result.message}`);
    return result;
  }
  acceptanceState.imageModel = result.model_name;
  acceptanceState.imageProviderId = result.provider_id;
  op(
    `显式选择图像生成模型 ${result.model_name}`,
    `验证素材生成面板会使用 imagen-4.0-generate-001；Token 状态=${result.has_token ? "已配置" : "缺失"}`
  );
  await pace(page);
  return result;
}

async function importProjectViaHome(page, projectPath) {
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await selectTextModelForAcceptance(page, "auto");
  await pace(page, "录屏展示清理后的项目主页");
  await page.locator(".project-import-button input").first().setInputFiles(projectPath);
  op("在项目主页通过导入项目文件进入校园示例工程", "验证编辑器真实工程导入链路，不直接绕过 UI");
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 30000 });
  await pace(page);
}

async function ensureCommandCardExpanded(card) {
  await card.scrollIntoViewIfNeeded();
  const body = card.locator(".command-card-body");
  if (!(await body.isVisible().catch(() => false))) {
    await card.locator('button[data-help-key="command.expand"]').click({ force: true });
    await body.waitFor({ state: "visible", timeout: 10000 });
  }
}

async function selectAssetWithPicker(page, card, helpKey, assetId) {
  await ensureCommandCardExpanded(card);
  const assetButton = card.locator(`button[data-help-key="${helpKey}.select"][data-asset-id="${assetId}"]`).first();
  await assetButton.waitFor({ state: "visible", timeout: 15000 });
  await assetButton.click({ force: true });
  const selectedText = await card.locator(".asset-picker-selected").first().innerText();
  if (!selectedText.includes(assetId)) throw new Error(`AssetPicker 未写入 ${assetId}，当前显示：${selectedText}`);
  await pace(page);
}

async function exerciseOpeningAssetPickers(page) {
  const cards = page.locator(".command-card");
  await cards.first().waitFor({ state: "visible", timeout: 15000 });

  await selectAssetWithPicker(page, cards.nth(0), "command.background.backgroundId", "bg_notice_corridor");
  const backgroundWrongType = await cards.nth(0).locator('button[data-asset-id="sprite_shen_argue"]').count();
  if (backgroundWrongType > 0) throw new Error("background 选择器中出现了 sprite 素材。");

  await selectAssetWithPicker(page, cards.nth(1), "command.bgm.bgmId", "bgm_after_school_argument");
  const bgmAudioVisible = await cards.nth(1).locator(".asset-picker-audio").first().isVisible().catch(() => false);
  if (!bgmAudioVisible) throw new Error("BGM AssetPicker 没有显示音频试听控件。");

  await selectAssetWithPicker(page, cards.nth(2), "command.sfx.sfxId", "sfx_bell");
  const sfxAudioVisible = await cards.nth(2).locator(".asset-picker-audio").first().isVisible().catch(() => false);
  if (!sfxAudioVisible) throw new Error("SFX AssetPicker 没有显示音频试听控件。");

  await selectAssetWithPicker(page, cards.nth(4), "command.sprite.spriteId", "sprite_shen_argue");
  const spriteWrongType = await cards.nth(4).locator('button[data-asset-id="bg_notice_corridor"]').count();
  if (spriteWrongType > 0) throw new Error("sprite 选择器中出现了 background 素材。");

  await selectAssetWithPicker(page, cards.nth(7), "command.animation.animationId", "anim_notice_flash");
  const animationSummary = await cards.nth(7).locator(".asset-picker-card").filter({ hasText: "anim_notice_flash" }).first().innerText();
  if (!/520ms|字段|JSON/.test(animationSummary)) throw new Error(`Animation AssetPicker 未显示结构摘要：${animationSummary}`);

  await selectAssetWithPicker(page, cards.nth(10), "command.dialog.portrait", "portrait_shen_argue");
  op("通过 AssetPicker 重新选择开场命令的背景、立绘、头像、BGM、SFX 和动画素材", "验证五角色项目能用真实 UI 按类型选择所有关键素材并立即写入命令表单");
}

async function exerciseEditorCampusFlow(page, extraAssetPath) {
  await verifyProviderConfigured(page);
  await page.locator('[data-help-key="toolbar.advanced"]').click();
  op("打开工具/设置面板", "验证顶部工具弹出容器和分类入口");
  await pace(page);
  if (skipImageProvider) {
    acceptanceState.imageModel = "Codex 本地生成测试图";
    acceptanceState.imageProviderId = "codex-local-assets";
    op(
      "跳过用户添加的图像生成模型测试",
      "用户已要求取消该模型链路，本轮改用 Codex/Pillow 生成的独立透明角色 PNG 和校园背景图导入编辑器"
    );
    await pace(page);
  } else {
    await selectImageModelForAcceptance(page);
    await page.locator('[data-help-key="advanced.tab.assets"]').click();
    op("切换到素材生成分类", "验证内置 AI 图片生成入口和素材生成模型选择");
    await pace(page);
    const promptInput = page.locator('[data-help-key="asset.prompt"]').first();
    if (await promptInput.isVisible().catch(() => false)) {
      await promptInput.fill("anime visual novel background, high school corridor notice board, anonymous accusation paper, cultural festival posters, afternoon light, no romance");
      op("填写 Imagen 背景生成提示词", "真实测试编辑器自带 AI 图片生成，内容贴合公告栏冲突项目");
      await pace(page);
      const generateImageButton = page.locator('[data-help-key="asset.generate"]').first();
      if (await generateImageButton.isVisible().catch(() => false)) {
        await generateImageButton.click({ force: true });
        op("点击生成图片", "验证素材生成不再走 MockImageProvider，而是调用配置的真实 image_generation 模型");
        const deadline = Date.now() + aiTimeoutMs;
        while (Date.now() < deadline) {
          const savingVisible = await page.locator('[data-help-key="asset.saveGenerated"]').count().catch(() => 0);
          const errorVisible = await page.locator(".inline-error").count().catch(() => 0);
          if (savingVisible > 0 || errorVisible > 0) break;
          await page.waitForTimeout(5000);
        }
        const imageError = await page.locator(".inline-error").last().textContent().catch(() => "");
        if (imageError) {
          failures.push(`素材生成失败：${imageError}`);
          op("记录素材生成失败", `失败信息=${imageError}；校园项目继续使用脚本生成/导入素材保证后续链路可测`);
        } else if (await page.locator('[data-help-key="asset.saveGenerated"]').first().isVisible().catch(() => false)) {
          await page.locator('[data-help-key="asset.saveGenerated"]').first().click({ force: true });
          await pace(page);
          const assetIdInput = page.locator('[data-help-key="asset.assetId"]').last();
          if (await assetIdInput.isVisible().catch(() => false)) {
            await assetIdInput.fill("ai_generated_notice_corridor");
            await page.locator('[data-help-key="asset.saveGenerated"]').last().click({ force: true });
            op("保存 AI 生成图片到素材库", "验证 AI 生成结果能进入项目资源清单并参与后续导出");
            await pace(page);
          }
        }
      }
    }
  }
  await page.locator('[data-help-key="advanced.tab.library"]').click();
  op("切换到素材库分类", "验证工具/设置分类切换动效和素材库入口");
  await pace(page);
  await page.locator('[data-help-key="asset.importImage"]').click({ force: true });
  const fileInput = page.locator('input[type="file"][accept*="image"]').last();
  await fileInput.setInputFiles(extraAssetPath);
  op("通过素材库主动导入一张校园补充图片", "验证素材无需生成也能进入项目资源清单");
  await pace(page);
  await page.locator('[data-help-key="asset.assetId"]').fill("manual_school_notice_board");
  await pace(page);
  await page.locator('[data-help-key="asset.confirmImport"]').click({ force: true });
  op("命名并保存导入素材", "验证素材命名、保存和资源清单联动");
  await pace(page);
  await page.locator('[data-help-key="advanced.tab.layout"]').click();
  op("打开客户端布局编辑器", "验证 UI skin 编辑入口和宽屏工具容器");
  await pace(page);
  const firstLayoutBlock = page.locator(".runtime-layout-block").first();
  if (await firstLayoutBlock.isVisible().catch(() => false)) {
    const box = await firstLayoutBlock.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 20, box.y + 20);
      await page.mouse.down();
      await page.mouse.move(box.x + 20, box.y + 42, { steps: 6 });
      await page.mouse.up();
      op("轻微拖动一个 Runtime UI 控件并保存布局", "验证布局编辑器拖拽和卡带 UI skin 数据会进入导出");
      await pace(page);
      const saveButton = page.locator('button:has-text("保存布局"), button[data-help-key="layout.save"]').first();
      if (await saveButton.isVisible().catch(() => false)) await saveButton.click({ force: true });
      await pace(page);
    }
  }
  await page.locator('[data-help-key="toolbar.advanced"]').click();
  await pace(page);

  const sceneCard = page.locator(".react-flow__node").filter({ hasText: "放学后的公告栏" }).first();
  await sceneCard.click({ force: true });
  op("选中开场场景节点", "为真实大模型生成后续做上下文准备");
  await pace(page);
  await exerciseOpeningAssetPickers(page);
  const outlineBox = page.locator('textarea[data-help-key="scene.aiOutline"], textarea[placeholder*="下一章"], textarea').last();
  if (await outlineBox.isVisible().catch(() => false)) {
    await outlineBox.fill("下一章围绕匿名举报的证据链继续推进：让沈砚先整理时间线，林知遥坚持程序记录，周鸣解释剪辑动机。不要写爱情线，只写责任、证据和集体压力。");
    op("填写醒目的下一步生成大纲", "验证作者能主导后续生成方向");
    await pace(page);
  }
  const generateButton = sceneCard.locator("button").filter({ hasText: /辅助|生成/ }).last();
  if (await generateButton.isVisible().catch(() => false)) {
    await generateButton.click({ force: true });
    op("点击场景节点的辅助生成后续", "验证真实文本模型、流式输出、AI 生成节点链路");
    await page.locator(".node-preview.is-streaming, [data-state='generating'], .generation-debug-panel, .error-toast").first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
    const deadline = Date.now() + aiTimeoutMs;
    while (Date.now() < deadline) {
      const generating = await page.locator(".node-preview.is-streaming, [data-state='generating']").count().catch(() => 0);
      const toast = await page.locator(".error-toast, .toast").count().catch(() => 0);
      if (generating === 0) break;
      await page.waitForTimeout(3000);
      if (toast > 0) break;
    }
    await pace(page, "大模型生成必须等待完整响应或明确报错");
  }
  await page.locator('[data-help-key="toolbar.timeline"]').click();
  op("打开时间线面板", "验证保存/备份功能的入口和弹出容器");
  await pace(page);
  await page.locator('[data-help-key="toolbar.timeline"]').click();
  await pace(page);
}

async function exportCartridgeViaEditor(page, targetPath) {
  await page.locator('[data-help-key="toolbar.exportCartridge"]').click();
  op("打开发布与打包面板", "使用真实编辑器导出卡带而不是脚本手工拼装");
  await pace(page);
  await page.locator('[data-help-key="package.export"]').waitFor({ state: "visible", timeout: 30000 });
  const downloadPromise = page.waitForEvent("download", { timeout: 120000 }).catch((error) => ({ error }));
  await page.locator('[data-help-key="package.export"]').click({ force: true });
  op("点击导出游戏卡带", "验证导出面板、资源扫描、卡带打包和下载链路");
  let download = await Promise.race([
    downloadPromise,
    (async () => {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        const message = await page.locator(".cartridge-export-panel .json-preview").textContent().catch(() => "");
        if (message && /导出失败|失败|error|Error/i.test(message)) return { message };
        await page.waitForTimeout(1500);
      }
      const panelText = await page.locator(".cartridge-export-panel").textContent().catch(() => "");
      return { message: `导出等待超时，面板内容：${panelText}` };
    })(),
  ]);
  if (download && download.error) {
    const panelText = await page.locator(".cartridge-export-panel").textContent().catch(() => "");
    throw new Error(`等待下载失败：${download.error.message}\n导出面板内容：${panelText}`);
  }
  if (download && download.message) {
    throw new Error(download.message);
  }
  await download.saveAs(targetPath);
  await pace(page);
  op(`保存导出的卡带到 ${targetPath}`, "作为 GameCLI 导入和独立校验的唯一输入");
}

async function playGameCliBranches(cartridgePath, videoDir, reportPrefix) {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport,
    acceptDownloads: true,
    recordVideo: { dir: videoDir, size: viewport },
  });
  const page = context.pages()[0] || await context.newPage();
  await clearBrowserState(page, "full");

  async function clearGameCliWebState() {
    await page.evaluate(() => {
      localStorage.removeItem("agentvn.gamecli.webLibrary");
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("agentvn.gamecli.saves.")) localStorage.removeItem(key);
      }
      return new Promise((resolve) => {
        if (!("indexedDB" in window)) {
          resolve(undefined);
          return;
        }
        const request = indexedDB.deleteDatabase("agentvn.gamecli.cartridges");
        request.onsuccess = () => resolve(undefined);
        request.onerror = () => resolve(undefined);
        request.onblocked = () => resolve(undefined);
      });
    }).catch(() => {});
  }

  async function importAndLaunch(reason) {
    await page.goto(gameCliUrl, { waitUntil: "domcontentloaded" });
    await clearGameCliWebState();
    await page.reload({ waitUntil: "domcontentloaded" });
    await pace(page, reason);
    await page.locator('[data-testid="web-cartridge-file"]').setInputFiles(cartridgePath);
    op("在 GameCLI 游戏库导入 .vncart", "验证玩家端真实导入和校验流程");
    await page.locator(".cartridge-spine").first().waitFor({ state: "visible", timeout: 30000 });
    await pace(page);
    await page.locator(".cartridge-spine").first().click({ force: true }).catch(() => {});
    await page.locator(".launch-actions button").first().click({ force: true });
    op("启动导入后的卡带", "进入真实玩家端播放界面");
    await page.locator(".story-player").waitFor({ state: "visible", timeout: 30000 });
    await pace(page);
  }

  async function assertSpritePresentation(label) {
    const result = await page.evaluate(() => {
      const frame = document.querySelector(".runtime-layout-frame") || document.querySelector(".story-player");
      const sprite = document.querySelector(".sprite-slot img");
      if (!frame) return { ok: false, reason: "missing runtime frame" };
      if (!sprite) return { ok: false, reason: "missing visible sprite" };
      const frameBox = frame.getBoundingClientRect();
      const spriteBox = sprite.getBoundingClientRect();
      let transparentFraction = 0;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = sprite.naturalWidth || 1;
        canvas.height = sprite.naturalHeight || 1;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(sprite, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let transparent = 0;
        const step = Math.max(4, Math.floor(data.length / 40000) * 4);
        let total = 0;
        for (let i = 3; i < data.length; i += step) {
          total += 1;
          if (data[i] < 10) transparent += 1;
        }
        transparentFraction = total ? transparent / total : 0;
      } catch (error) {
        return { ok: false, reason: `alpha inspection failed: ${error?.message || error}` };
      }
      const heightRatio = spriteBox.height / Math.max(1, frameBox.height);
      return {
        ok: transparentFraction >= 0.25 && heightRatio >= 0.55,
        reason: "measured",
        frameHeight: Math.round(frameBox.height),
        spriteHeight: Math.round(spriteBox.height),
        heightRatio,
        transparentFraction,
      };
    });
    if (!result.ok) {
      throw new Error(`角色立绘展示检查失败：${label} ${JSON.stringify(result)}`);
    }
    op(
      `检查角色立绘展示：${label}`,
      `透明像素 ${(result.transparentFraction * 100).toFixed(1)}%，立绘高度 ${result.spriteHeight}/${result.frameHeight}，占屏 ${(result.heightRatio * 100).toFixed(1)}%，满足透明背景和大尺寸显示`
    );
    await pace(page);
  }

  await importAndLaunch("录屏展示清理后的 GameCLI 游戏库");
  await assertSpritePresentation("开场沈砚争执表情");

  async function clickPlayer(times, reason) {
    for (let i = 0; i < times; i += 1) {
      await page.locator(".story-player").click({ position: { x: 960, y: 760 }, force: true });
      op("推进一段剧情", reason);
      await pace(page);
    }
  }

  async function useQuickMenus() {
    async function returnToPlayer() {
      const backToGame = page.locator(".screen-panel header button").filter({ hasText: /返回游戏|Return|Back/ }).first();
      if (await backToGame.isVisible().catch(() => false)) {
        await backToGame.click({ force: true });
        await page.locator(".story-player").waitFor({ state: "visible", timeout: 15000 });
        return;
      }
      const done = page.locator(".screen-panel header button, .settings-footer button").filter({ hasText: /完成|Done|OK/ }).last();
      if (await done.isVisible().catch(() => false)) {
        await done.click({ force: true });
        await page.locator(".main-menu, .story-player").first().waitFor({ state: "visible", timeout: 15000 });
      }
      if (await page.locator(".main-menu").isVisible().catch(() => false)) {
        await page.locator(".main-menu button").filter({ hasText: /开始游戏|Start|继续/ }).first().click({ force: true });
        await page.locator(".story-player").waitFor({ state: "visible", timeout: 15000 });
      }
    }

    await clickPlayer(3, "让历史记录和存档状态具备内容");
    await page.locator(".playback-controls button").filter({ hasText: /存|Save|瀛/ }).first().click({ force: true });
    op("打开存档界面", "验证 GameCLI 存档入口");
    await pace(page);
    await page.locator(".save-slot button").first().click({ force: true });
    op("保存到第一个存档槽", "验证浏览器开发模式存档兜底");
    await pace(page);
    await returnToPlayer();
    await pace(page);
    await page.locator(".playback-controls button").filter({ hasText: /历|History|鍘/ }).first().click({ force: true });
    op("打开历史界面", "验证对话历史记录");
    await pace(page);
    await returnToPlayer();
    await pace(page);
    await page.locator(".playback-controls button").filter({ hasText: /设置|Settings|璁/ }).first().click({ force: true });
    op("打开设置界面并调整一个滑条", "验证玩家端设置页");
    await pace(page);
    const range = page.locator('input[type="range"]').first();
    if (await range.isVisible().catch(() => false)) await range.fill("60");
    await pace(page);
    await returnToPlayer();
  }

  await useQuickMenus();
  const routes = ["公开质问", "私下调查", "先保护广播社"];
  const secondChoiceByRoute = {
    "公开质问": "请学生会介入",
    "私下调查": "要求交出原始录音",
    "先保护广播社": "相信周鸣解释",
  };
  for (const route of routes) {
    await importAndLaunch(`为分支 ${route} 重新导入并启动卡带，避免上一次游玩状态影响`);
    await clickPlayer(7, `进入分支 ${route} 前推进开场`);
    const choice = page.locator(".choice-panel button").filter({ hasText: route }).first();
    if (await choice.isVisible().catch(() => false)) {
      await choice.click({ force: true });
      op(`选择分支：${route}`, "验证三条主分支均可被真实点击");
      await pace(page);
      await assertSpritePresentation(`分支立绘表情：${route}`);
    }
    await clickPlayer(5, `推进 ${route} 分支到第二选择`);
    const secondChoiceText = secondChoiceByRoute[route];
    const second = page.locator(".choice-panel button").filter({ hasText: secondChoiceText }).first();
    if (await second.isVisible().catch(() => false)) {
      await second.click({ force: true });
      op(`选择第二层选项：${secondChoiceText}`, "验证多选项链路和状态变量共同决定结局");
      await pace(page);
    }
    await clickPlayer(8, `完成 ${route} 分支直到结局或无更多可点文本`);
  }
  await page.locator(".playback-controls button").filter({ hasText: /菜单|Menu|鑿/ }).first().click({ force: true }).catch(() => {});
  await pace(page);
  await page.locator("button").filter({ hasText: /画廊|Gallery|鐢/ }).first().click({ force: true }).catch(() => {});
  op("打开画廊入口", "验证 GameCLI shell 页功能");
  await pace(page);
  await page.locator("button").filter({ hasText: /关于|About|鍏/ }).first().click({ force: true }).catch(() => {});
  op("打开关于入口", "验证 GameCLI 关于页功能");
  await pace(page);
  await closeContextAndSaveVideo(page, context, path.join(reportPrefix, "gamecli-flow.webm"));
}

async function playGameCliNovelSmoke(cartridgePath, videoDir, reportPrefix) {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport,
    acceptDownloads: true,
    recordVideo: { dir: videoDir, size: viewport },
  });
  const page = context.pages()[0] || await context.newPage();
  await clearBrowserState(page, "full");

  await page.goto(gameCliUrl, { waitUntil: "domcontentloaded" });
  await pace(page, "录屏展示小说导入卡带前的空游戏库");
  await page.evaluate(() => {
    localStorage.removeItem("agentvn.gamecli.webLibrary");
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("agentvn.gamecli.saves.")) localStorage.removeItem(key);
    }
  }).catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded" });
  await pace(page);

  await page.locator('[data-testid="web-cartridge-file"]').setInputFiles(cartridgePath);
  op("在 GameCLI 导入小说卡带", "验证小说导入生成的卡带可以被玩家端真实读取");
  await page.locator(".cartridge-spine").first().waitFor({ state: "visible", timeout: 30000 });
  await pace(page);
  await page.locator(".cartridge-spine").first().click({ force: true }).catch(() => {});
  await page.locator(".launch-actions button").first().click({ force: true });
  await page.locator(".story-player").waitFor({ state: "visible", timeout: 30000 });
  op("启动小说卡带进入播放页", "验证主线至少能够进入 Runtime 播放器");
  await pace(page);

  async function clickPlayer(times, reason) {
    for (let i = 0; i < times; i += 1) {
      await page.locator(".story-player").click({ position: { x: 960, y: 760 }, force: true }).catch(() => {});
      const firstChoice = page.locator(".choice-panel button").first();
      if (await firstChoice.isVisible().catch(() => false)) {
        await firstChoice.click({ force: true });
        op("选择当前可见的第一个分支选项", "验证推测分支或小说原文选项不会阻断播放");
      } else {
        op("推进小说剧情", reason);
      }
      await pace(page);
    }
  }

  await clickPlayer(8, "覆盖小说主线开场、对话推进和可能出现的首个选项");

  const quickButtons = [
    { pattern: /存|Save/i, label: "存档" },
    { pattern: /历|History/i, label: "历史" },
    { pattern: /设置|Settings/i, label: "设置" },
    { pattern: /读|Load/i, label: "读档" },
  ];
  for (const item of quickButtons) {
    const button = page.locator(".playback-controls button").filter({ hasText: item.pattern }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ force: true });
      op(`打开 GameCLI ${item.label}入口`, `验证玩家端 ${item.label} 功能可进入`);
      await pace(page);
      const slot = page.locator(".save-slot button").first();
      if (item.label === "存档" && await slot.isVisible().catch(() => false)) {
        await slot.click({ force: true });
        op("写入第一个存档槽", "验证小说卡带播放状态可保存");
        await pace(page);
      }
      const back = page.locator("button").filter({ hasText: /返回|Back|完成|Done|OK/i }).first();
      if (await back.isVisible().catch(() => false)) {
        await back.click({ force: true });
        await page.locator(".story-player, .main-menu").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
        await pace(page);
      }
    }
  }

  await page.locator(".playback-controls button").filter({ hasText: /菜单|Menu/i }).first().click({ force: true }).catch(() => {});
  await pace(page);
  await page.locator("button").filter({ hasText: /画廊|Gallery/i }).first().click({ force: true }).catch(() => {});
  op("打开 GameCLI 画廊入口", "验证 shell 页面入口不会因为小说导入卡带异常");
  await pace(page);
  await page.locator("button").filter({ hasText: /关于|About/i }).first().click({ force: true }).catch(() => {});
  op("打开 GameCLI 关于入口", "验证关于页入口可达");
  await pace(page);

  await closeContextAndSaveVideo(page, context, path.join(reportPrefix, "gamecli-flow.webm"));
}

async function runCampusPhase(browser) {
  const project = makeCampusProject();
  const projectPath = path.join(campusFinal, "campus-example.vnproj");
  const cartridgePath = path.join(campusFinal, "campus-example.vncart");
  saveProjectContainerSync(projectPath, project, { container: "zip" });
  const manualImportSvg = path.join(campusWork, "manual-school-notice-board.svg");
  fs.writeFileSync(manualImportSvg, decodeURIComponent(svgDataUrl("公告栏 / 社团招新", "#f09a75", "#465a8d").split(",")[1]), "utf8");

  const context = await browser.newContext({
    viewport,
    acceptDownloads: true,
    recordVideo: { dir: path.join(campusWork, "videos-editor"), size: viewport },
  });
  const page = await context.newPage();
  let pageCloseReason = "";
  page.on("close", () => {
    pageCloseReason = pageCloseReason || "校园示例 Playwright page closed while running editor flow.";
  });
  page.on("crash", () => {
    pageCloseReason = "校园示例 Playwright page crashed while running editor flow.";
  });
  page.on("pageerror", (error) => {
    pageCloseReason = `校园示例 page error: ${error.message}`;
  });
  await clearBrowserState(page, "full");
  await importProjectViaHome(page, projectPath);
  await exerciseEditorCampusFlow(page, manualImportSvg);
  await exportCartridgeViaEditor(page, cartridgePath);
  await closeContextAndSaveVideo(page, context, path.join(campusFinal, "editor-flow.webm"));
  await runCommand("verify campus vncart", process.execPath, [path.join(root, "scripts", "verify-vncart.cjs"), cartridgePath]);
  op("执行 verify-vncart 校验校园卡带", "确认卡带结构、资源和校验和完整");
  await playGameCliBranches(cartridgePath, path.join(campusWork, "videos-gamecli"), campusFinal);
  writeTextArtifact(path.join(campusFinal, "操作记录.txt"), operations.join("\n"));
  writeTextArtifact(path.join(campusFinal, "故障与修复清单.md"), failures.length ? failures.map((item) => `- ${item}`).join("\n") : "本阶段没有发现阻断性故障。\n");
  writeTextArtifact(path.join(campusFinal, "最终测试报告.md"), [
    "# 校园群像争执示例最终测试报告",
    "",
    "- 项目：放学后的公告栏",
    "- 故事约束：无爱情元素，只测试责任、证据、社团压力和公开真相的代价。",
    `- 文本模型：${acceptanceState.textModel || "未记录"}`,
    "- 角色数：5",
    "- 主分支数：3",
    "- 结局数：5",
    "- 卡带校验：通过",
    "- GameCLI 导入与游玩：已执行真实 UI 流程",
  ].join("\n"));
}

async function collectNovelPanelText(page) {
  const selectors = [
    ".advanced-tools-panel",
    ".advanced-panel",
    ".toolbar-popover",
    ".inline-error",
    ".error-toast",
    "body",
  ];
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) {
        const text = await locator.innerText({ timeout: 3000 }).catch(() => "");
        if (text && text.trim()) return text.trim().slice(0, 12000);
      }
    } catch {
      // Diagnostics only; keep trying broader containers.
    }
  }
  return "";
}

function compactUiText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1600);
}

function summarizeNovelPanelText(text) {
  const compact = compactUiText(text).replace(
    /模型完整响应.*?(?=(?:AI 全文扫描|文本规模|批次数|蓝图生成|验收节流|导入报告|当前模型：|$))/g,
    "模型完整响应已省略 "
  );
  if (!compact) return "";
  const patterns = [
    /当前模型[^。；\n]{0,180}/,
    /文本规模[^。；\n]{0,180}/,
    /切片[^。；\n]{0,180}/,
    /批次数[^。；\n]{0,180}/,
    /AI 全文扫描[^。；\n]{0,220}/,
    /全书大纲[^。；\n]{0,220}/,
    /模型已连接[^。；\n]{0,220}/,
    /验收节流[^。；\n]{0,220}/,
    /蓝图生成[:：][^。；\n]{0,260}/,
    /已生成\s*\d+\s*\/\s*\d+[^。；\n]{0,180}/,
    /\d+\s*\/\s*\d+[^。；\n]{0,180}/,
    /失败[^。；\n]{0,220}/,
    /错误[^。；\n]{0,220}/,
    /导入报告[^。；\n]{0,220}/,
  ];
  const picked = [];
  for (const pattern of patterns) {
    const match = compact.match(pattern);
    if (match && !picked.includes(match[0])) picked.push(match[0]);
  }
  if (picked.length > 0) return picked.join(" | ").slice(0, 1200);
  return compact.slice(0, 700);
}

async function logNovelPanelSnapshot(page, phase) {
  const text = await collectNovelPanelText(page).catch(() => "");
  const summary = summarizeNovelPanelText(text);
  if (summary) console.log(`[novel-status:${phase}] ${summary}`);
  return summary;
}

async function runNovelPhase(browser, target = "deepseek") {
  if (!fs.existsSync(novelPath)) throw new Error(`小说文件不存在：${novelPath}`);
  const label = target === "gemini" ? "gemini-3-flash-preview" : "deepseek-v4-flash";
  const phaseRoot = path.join(novelBase, target);
  const phaseWork = path.join(phaseRoot, "_work");
  const phaseFinal = path.join(phaseRoot, "final");
  ensureDir(phaseWork);
  ensureDir(phaseFinal);
  const context = await browser.newContext({
    viewport,
    acceptDownloads: true,
    recordVideo: { dir: path.join(phaseWork, "videos-editor"), size: viewport },
  });
  const page = await context.newPage();
  await clearBrowserState(page, "full");
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  const selected = await selectTextModelForAcceptance(page, target);
  await pace(page, `录屏展示 ${label} 小说导入前的干净项目主页`);
  await page.locator('[data-help-key="home.createProject"]').first().click({ force: true });
  op(`新建空白工程用于 ${label} 小说导入`, "避免小说导入结果混入校园示例图谱");
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 30000 });
  await pace(page);
  await verifyProviderConfigured(page);
  await page.locator('[data-help-key="toolbar.advanced"]').click();
  await pace(page);
  await page.locator('[data-help-key="advanced.tab.novel"]').click();
  op(`进入工具/设置的小说导入页（${label}）`, "使用真实 UI 跑长文导入流程");
  await pace(page);
  if (runFullRegression) {
    await page.evaluate(() => {
      localStorage.removeItem("agentvn.acceptanceNovelSceneLimit");
      localStorage.removeItem("agentvn.acceptanceNovelMaxScanChunks");
    });
    op("清除小说导入验收节流开关", "本轮使用完整原文与完整蓝图，不设置场景上限或扫描切片上限");
    await pace(page);
  } else {
    await page.evaluate((limit) => {
      localStorage.setItem("agentvn.acceptanceNovelSceneLimit", String(limit));
    }, acceptanceNovelSceneLimit);
    op(`设置小说蓝图验收场景上限为 ${acceptanceNovelSceneLimit}`, "全文扫描和大纲仍使用真实模型；蓝图改编阶段限量，避免低额度回归测试生成上百个场景");
    await pace(page);
    await page.evaluate((limit) => {
      localStorage.setItem("agentvn.acceptanceNovelMaxScanChunks", String(limit));
    }, acceptanceNovelMaxScanChunks);
    op(`设置小说扫描验收切片上限为 ${acceptanceNovelMaxScanChunks}`, "让模型分段理解临时测试文本，但避免把短篇验收拆成过多请求");
    await pace(page);
  }
  await page.locator('input[type="file"][accept*=".txt"]').setInputFiles(novelPath);
  op(`选择小说文件 ${novelPath}`, "验证本地小说文件读取与预检");
  await pace(page);
  const branchToggle = page.locator('[data-help-key="novel.branchSuggestions"]');
  if (await branchToggle.isVisible().catch(() => false)) {
    const checked = await branchToggle.isChecked().catch(() => false);
    if (!checked) await branchToggle.check({ force: true });
    op("开启推测潜在分支", "验证冲突分析和分支物化能力");
    await pace(page);
  }
  await page.locator('[data-help-key="novel.aiStart"]').click({ force: true });
  op(`开始 AI 小说解析（${label}）`, "真实调用指定模型进行全文扫描和大纲生成");
  const deadline = Date.now() + 60 * 60 * 1000;
  let nextScanSnapshotAt = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await page.locator('[data-help-key="novel.confirmOutline"]').isVisible().catch(() => false)) break;
    if (await page.locator(".inline-error").count().catch(() => 0)) break;
    await page.waitForTimeout(2500);
    if (Date.now() >= nextScanSnapshotAt) {
      await logNovelPanelSnapshot(page, `${target}-scan`);
      nextScanSnapshotAt = Date.now() + 10000;
    }
  }
  if (await page.locator(".inline-error").count().catch(() => 0)) {
    const errorText = await page.locator(".inline-error").allTextContents();
    failures.push(`${label} 小说 AI 扫描失败：${errorText.join("\n")}`);
    throw new Error(`${label} 小说 AI 扫描失败：${errorText.join("\n")}`);
  }
  const outlineReady = await page.locator('[data-help-key="novel.confirmOutline"]').isVisible().catch(() => false);
  if (!outlineReady) {
    const panelText = await collectNovelPanelText(page);
    await page.screenshot({ path: path.join(phaseFinal, `${target}-outline-not-ready.png`), fullPage: true }).catch(() => {});
    const message = `${label} 小说扫描未进入“大纲确认”阶段。当前面板文本：\n${panelText || "(empty)"}`;
    failures.push(message);
    throw new Error(message);
  }
  await pace(page, "等待小说扫描和大纲完整生成");
  await page.locator('[data-help-key="novel.confirmOutline"]').click({ force: true });
  op(`确认 AI 大纲并生成蓝图（${label}）`, "验证从大纲到场景规划再到编辑器节点写入的完整链路");
  const genDeadline = Date.now() + 90 * 60 * 1000;
  let nextBlueprintSnapshotAt = Date.now() + 8000;
  while (Date.now() < genDeadline) {
    if (await page.locator(".advanced-card").filter({ hasText: "导入报告" }).isVisible().catch(() => false)) break;
    if (await page.locator(".inline-error").count().catch(() => 0)) break;
    await page.waitForTimeout(2500);
    if (Date.now() >= nextBlueprintSnapshotAt) {
      await logNovelPanelSnapshot(page, `${target}-blueprint`);
      nextBlueprintSnapshotAt = Date.now() + 10000;
    }
  }
  if (await page.locator(".inline-error").count().catch(() => 0)) {
    const errorText = await page.locator(".inline-error").allTextContents();
    failures.push(`${label} 小说蓝图生成失败：${errorText.join("\n")}`);
    throw new Error(`${label} 小说蓝图生成失败：${errorText.join("\n")}`);
  }
  const reportReady = await page.locator(".advanced-card").filter({ hasText: "导入报告" }).isVisible().catch(() => false);
  if (!reportReady) {
    const panelText = await collectNovelPanelText(page);
    await page.screenshot({ path: path.join(phaseFinal, `${target}-blueprint-not-ready.png`), fullPage: true }).catch(() => {});
    const message = `${label} 小说蓝图生成未进入“导入报告”阶段。当前面板文本：\n${panelText || "(empty)"}`;
    failures.push(message);
    throw new Error(message);
  }
  await pace(page, "等待小说蓝图完整写入节点");
  const novelCartridge = path.join(phaseFinal, `${target}-novel-import.vncart`);
  await exportCartridgeViaEditor(page, novelCartridge);
  const projectDownload = page.waitForEvent("download", { timeout: 120000 });
  await page.locator('[data-help-key="toolbar.saveProject"]').click({ force: true });
  const download = await projectDownload;
  await download.saveAs(path.join(phaseFinal, `${target}-novel-import.vnproj`));
  op(`保存 ${label} 小说导入后的工程文件`, "保留可复现的最终编辑器工程");
  await pace(page);
  await closeContextAndSaveVideo(page, context, path.join(phaseFinal, "editor-flow.webm"));
  await runCommand("verify novel vncart", process.execPath, [path.join(root, "scripts", "verify-vncart.cjs"), novelCartridge]);
  op(`执行 verify-vncart 校验 ${label} 小说导入卡带`, "确认长文导入结果可被玩家端读取");
  await playGameCliNovelSmoke(novelCartridge, path.join(phaseWork, "videos-gamecli"), phaseFinal);
  acceptanceState.novelRuns.push({ target, label, status: "PASS", cartridge: novelCartridge, provider_id: selected.provider_id });
  writeTextArtifact(path.join(phaseFinal, "操作记录.txt"), operations.join("\n"));
  writeTextArtifact(path.join(phaseFinal, "故障与修复清单.md"), failures.length ? failures.map((item) => `- ${item}`).join("\n") : "本阶段没有发现阻断性故障。\n");
  writeTextArtifact(path.join(phaseFinal, "最终测试报告.md"), [
    "# 小说导入最终测试报告",
    "",
    `- 源文件：${novelPath}`,
    `- 原始小说：${originalNovelPath}`,
    runFullRegression
      ? `- 文本范围：完整原文（${acceptanceState.novelExcerpt?.sourceChars || "未知"} 字）`
      : acceptanceState.novelExcerpt
      ? `- 临时节选：${acceptanceState.novelExcerpt.excerptChars}/${acceptanceState.novelExcerpt.sourceChars} 字`
      : "- 临时节选：未记录",
    `- 文本模型：${label}`,
    `- Provider ID：${selected.provider_id}`,
    `- Base URL：${selected.base_url || "未记录"}`,
    "- 导入模式：开启推测潜在分支",
    runFullRegression ? "- 验收节流：未启用" : `- 验收蓝图场景上限：${acceptanceNovelSceneLimit}`,
    runFullRegression ? "- 扫描切片限制：未启用" : `- 验收扫描切片上限：${acceptanceNovelMaxScanChunks}`,
    "- 卡带校验：通过",
    "- GameCLI 导入与游玩：已执行真实 UI 流程",
  ].join("\n"));
}

async function buildAll() {
  await runCommand("editor build", npmCommand, ["run", "build"], { cwd: path.join(root, "editor"), shell: process.platform === "win32" });
  op("执行 editor npm run build", "验证编辑器构建通过");
  await runCommand("gamecli build", npmCommand, ["run", "build"], { cwd: path.join(root, "GameCli_framework"), shell: process.platform === "win32" });
  op("执行 GameCli_framework npm run build", "验证玩家端构建通过");
}

function writeOverallReport(status, latestError = "") {
  const campusCartridge = path.join(campusFinal, "campus-example.vncart");
  const novelRunLines = acceptanceState.novelRuns.length
    ? acceptanceState.novelRuns.map((run) => `- ${run.label || run.target}：${run.status}${run.cartridge ? `，卡带 ${run.cartridge}` : ""}${run.error ? `，错误 ${run.error}` : ""}`).join("\n")
    : "- 未记录";
  writeTextArtifact(path.join(root, "test_AgentVN", "完整测试报告.md"), [
    "# AgentVN 小说导入闭环重跑报告",
    "",
    `- 状态：${status}`,
    `- 原始文章：${originalNovelPath}`,
    `- 本轮测试文章：${novelPath}`,
    runFullRegression
      ? `- 文本范围：完整原文（${acceptanceState.novelExcerpt?.sourceChars || "未知"} 字）`
      : acceptanceState.novelExcerpt
      ? `- 临时节选规模：${acceptanceState.novelExcerpt.excerptChars}/${acceptanceState.novelExcerpt.sourceChars} 字`
      : "- 临时节选规模：未记录",
    `- 文本模型：${acceptanceState.textModel || "未记录"}`,
    `- 文本模型 Provider ID：${acceptanceState.textProviderId || "未记录"}`,
    `- 图像模型：${acceptanceState.imageModel || "未记录"}`,
    `- 图像模型 Provider ID：${acceptanceState.imageProviderId || "未记录"}`,
    `- 校园卡带：${fs.existsSync(campusCartridge) ? campusCartridge : "未生成/本轮跳过"}`,
    latestError ? `- 最新错误：${latestError}` : "- 最新错误：无",
    "",
    "## 小说导入双模型结果",
    novelRunLines,
    "",
    "## 已修复项",
    "- 小说导入拆成 Gemini 与 DeepSeek v4 flash 两条独立验收线。",
    "- 校园/小说文本测试使用显式选择的真实文本模型，不静默切换。",
    skipImageProvider
      ? "- 本轮按用户要求取消用户添加的图像生成模型测试，改用 Codex/Pillow 本地生成并导入测试图。"
      : "- 自定义 image_generation 模型不再强制走 MockImageProvider，会调用 OpenAI-compatible 或 Gemini Imagen REST。",
    "- 小说导入请求使用 JSON 兼容模式并关闭 thinking_mode。",
    "- 测试报告和操作记录用 UTF-8 BOM + CRLF 写入。",
    "- 写入后检查典型 mojibake 片段。",
    "- 保留 AdaptSceneResponse 归一化修复：错层 commands、wait.duration、字符串 conflict_points、缺失 sprite_id。",
  ].join("\n"));
}

function writeNovelFailureReport(target, error) {
  const label = target === "gemini" ? "gemini-3-flash-preview" : "deepseek-v4-flash";
  const phaseFinal = path.join(novelBase, target, "final");
  ensureDir(phaseFinal);
  const message = error instanceof Error ? error.message : String(error);
  acceptanceState.novelRuns.push({ target, label, status: "FAIL", error: message });
  writeTextArtifact(path.join(phaseFinal, "故障与修复清单.md"), `- ${message}\n`);
  writeTextArtifact(path.join(phaseFinal, "最终测试报告.md"), [
    "# 小说导入最终测试报告",
    "",
    `- 源文件：${novelPath}`,
    `- 文本模型：${label}`,
    "- 状态：失败",
    `- 最新错误：${message}`,
  ].join("\n"));
  writeTextArtifact(path.join(phaseFinal, "操作记录.txt"), operations.join("\n"));
}

function validateTextArtifacts() {
  const paths = [
    path.join(novelFinal, "操作记录.txt"),
    path.join(novelFinal, "故障与修复清单.md"),
    path.join(novelFinal, "最终测试报告.md"),
    path.join(novelBase, "gemini", "final", "操作记录.txt"),
    path.join(novelBase, "gemini", "final", "故障与修复清单.md"),
    path.join(novelBase, "gemini", "final", "最终测试报告.md"),
    path.join(novelBase, "deepseek", "final", "操作记录.txt"),
    path.join(novelBase, "deepseek", "final", "故障与修复清单.md"),
    path.join(novelBase, "deepseek", "final", "最终测试报告.md"),
    path.join(root, "test_AgentVN", "完整测试报告.md"),
  ];
  if (!runNovelOnly) {
    paths.push(
    path.join(campusFinal, "操作记录.txt"),
    path.join(campusFinal, "故障与修复清单.md"),
    path.join(campusFinal, "最终测试报告.md")
    );
  }
  assertReadableChineseArtifacts(paths);
}

async function main() {
  if (runNovelOnly && novelTargetArg) {
    cleanPreviousData(`novel:${novelTargetArg}`);
  } else {
    cleanPreviousData(runNovelOnly ? "novel" : "all");
  }
  if (runFullRegression) {
    acceptanceState.novelExcerpt = {
      sourceChars: fs.existsSync(originalNovelPath) ? fs.readFileSync(originalNovelPath, "utf8").replace(/^\uFEFF/, "").length : 0,
      excerptChars: 0,
      fullText: true,
    };
    op("使用完整小说原文进行导入测试", "本轮不再生成节选测试文件，也不写入任何验收节流文案");
  } else {
    acceptanceState.novelExcerpt = makeNovelAcceptanceExcerpt();
  }
  await buildAll();
  await ensureServers();
  const browser = await chromium.launch({ headless: false });
  try {
    if (!runNovelOnly) await runCampusPhase(browser);
    let novelPassCount = 0;
    for (const target of novelTargets) {
      try {
        await runNovelPhase(browser, target);
        novelPassCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${target} 小说导入失败：${message}`);
        writeNovelFailureReport(target, error);
      }
    }
    if (novelPassCount === 0) {
      const targetLabel = novelTargets.length === 1 ? `${novelTargets[0]} 小说导入` : "Gemini 与 DeepSeek 小说导入";
      throw new Error(`${targetLabel}未通过，无法判定小说导入闭环通过。`);
    }
    writeOverallReport("通过");
    validateTextArtifacts();
  } catch (error) {
    const message = error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error);
    failures.push(message);
    ensureDir(campusFinal);
    ensureDir(novelFinal);
    writeTextArtifact(path.join(campusFinal, "故障与修复清单.md"), failures.map((item) => `- ${item}`).join("\n"));
    writeTextArtifact(path.join(novelFinal, "故障与修复清单.md"), failures.map((item) => `- ${item}`).join("\n"));
    writeOverallReport("失败", error instanceof Error ? error.message : String(error));
    validateTextArtifacts();
    throw error;
  } finally {
    await browser.close().catch(() => {});
    for (const child of startedProcesses) child.kill();
    writeTextArtifact(path.join(campusFinal, "操作记录.txt"), operations.join("\n"));
    writeTextArtifact(path.join(novelFinal, "操作记录.txt"), operations.join("\n"));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
