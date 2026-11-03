const fs = require("node:fs");
const path = require("node:path");
const ts = require(path.join(__dirname, "..", "editor", "node_modules", "typescript"));

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function sourceFiles(relativeRoot, extensions) {
  const absoluteRoot = path.join(root, relativeRoot);
  const result = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", "dist", "target", "gen", "__pycache__"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (extensions.some((extension) => entry.name.endsWith(extension))) result.push(absolute);
    }
  };
  visit(absoluteRoot);
  return result;
}

function lineNumber(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function handledFrontendFailure(text) {
  return /\breport[A-Za-z0-9_]*Error\s*\(|console\.(?:warn|error)\s*\(|\bthrow\b|error-log-ignore:/.test(text);
}

function auditFrontendCatchBlocks() {
  const failures = [];
  for (const absolute of [
    ...sourceFiles("editor/src", [".ts", ".tsx"]),
    ...sourceFiles("GameCli_framework/src", [".ts", ".tsx"]),
  ]) {
    if (absolute.endsWith(".d.ts") || absolute.endsWith(".samples.ts")) continue;
    const source = fs.readFileSync(absolute, "utf8");
    const sourceFile = ts.createSourceFile(
      absolute,
      source,
      ts.ScriptTarget.Latest,
      true,
      absolute.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node) => {
      if (ts.isCatchClause(node)) {
        const text = node.block.getFullText(sourceFile);
        if (!handledFrontendFailure(text)) {
          failures.push(`${path.relative(root, absolute)}:${lineNumber(sourceFile, node)}`);
        }
      }
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "catch"
      ) {
        const handler = node.arguments[0];
        const text = handler?.getFullText(sourceFile) ?? "";
        if (!handledFrontendFailure(text)) {
          failures.push(`${path.relative(root, absolute)}:${lineNumber(sourceFile, node)}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  assert(
    failures.length === 0,
    `发现没有记录、继续抛出或声明正常回退的前端异常分支：\n${failures.join("\n")}`,
  );
}

function auditBackendExceptBlocks() {
  const failures = [];
  for (const absolute of sourceFiles("backend/app", [".py"])) {
    const lines = fs.readFileSync(absolute, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^(\s*)except(?:\s|:)/);
      if (!match) continue;
      const indent = match[1].length;
      const block = [lines[index]];
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const line = lines[cursor];
        if (!line.trim()) {
          block.push(line);
          continue;
        }
        const nextIndent = line.match(/^(\s*)/)?.[1].length ?? 0;
        if (nextIndent <= indent) break;
        block.push(line);
      }
      const text = block.join("\n");
      if (!/logger\.(?:warning|error|exception|critical)\s*\(|log_exception\s*\(|\braise\b|error-log-ignore:/.test(text)) {
        failures.push(`${path.relative(root, absolute)}:${index + 1}`);
      }
    }
  }
  assert(
    failures.length === 0,
    `发现没有记录、继续抛出或声明正常回退的后端异常分支：\n${failures.join("\n")}`,
  );
}

const editorHost = read("editor/src-tauri/src/main.rs");
const playerHost = read("GameCli_framework/src-tauri/src/lib.rs");
const frontendLogger = read("shared/logging/frontendErrorLogger.ts");
const editorMain = read("editor/src/main.tsx");
const playerMain = read("GameCli_framework/src/main.tsx");
const backendMain = read("backend/app/main.py");
const backendLogging = read("backend/app/core/error_logging.py");
const novelRoutes = read("backend/app/api/routes_novel_import.py");
const novelWebSocket = read("backend/app/api/routes_novel_ws.py");
const novelService = read("backend/app/services/novel_process_service.py");
const novelClient = read("editor/src/novel-import/adaptationClient.ts");
const backendClient = read("editor/src/api/backendClient.ts");
const playerAudio = read("GameCli_framework/src/components/player/RuntimeAudio.tsx");
const playerVideo = read("GameCli_framework/src/components/player/CutsceneVideoOverlay.tsx");
const packageScript = read("scripts/build-editor-windows.ps1");

assert(/exe_parent_dir\(\)\.join\("error_log"\)/.test(editorHost), "编辑器错误目录不是安装程序旁的 error_log");
assert(/editor-desktop\.log/.test(editorHost), "编辑器桌面日志未接入");
assert(/editor-frontend\.log/.test(editorHost) && /append_frontend_error/.test(editorHost), "编辑器前端日志命令未接入");
assert(/player_error_log_dir/.test(playerHost) && /parent\.join\("error_log"\)/.test(playerHost), "播放器 Windows 错误目录不是程序旁的 error_log");
assert(/app_data_dir\(\)[\s\S]*?join\("error_log"\)/.test(playerHost), "播放器 Android 错误目录未使用应用私有目录");
assert(/player-desktop\.log/.test(playerHost) && /player-frontend\.log/.test(playerHost), "播放器双层日志未接入");
assert(/MAX_ERROR_LOG_BYTES[\s\S]*?10 \* 1024 \* 1024/.test(editorHost), "编辑器连续日志未限制为 10MB");
assert(/MAX_ERROR_LOG_BYTES[\s\S]*?10 \* 1024 \* 1024/.test(playerHost), "播放器连续日志未限制为 10MB");
assert(/ERROR_LOG_BACKUP_COUNT:\s*usize\s*=\s*10/.test(editorHost), "编辑器日志未保留十份轮换文件");
assert(/ERROR_LOG_BACKUP_COUNT:\s*usize\s*=\s*10/.test(playerHost), "播放器日志未保留十份轮换文件");
assert(/ERROR_LOG_RECENT/.test(editorHost) && /should_write_error_log/.test(editorHost), "编辑器桌面日志未做一秒重复抑制");
assert(/ERROR_LOG_RECENT/.test(playerHost) && /should_write_error_log/.test(playerHost), "播放器桌面日志未做一秒重复抑制");
assert(/redact_url_query_values/.test(editorHost) && /redact_url_query_values/.test(playerHost), "桌面宿主未遮住网址参数");
assert(/addEventListener\("error"/.test(frontendLogger), "页面全局错误未捕获");
assert(/unhandledrejection/.test(frontendLogger), "未处理异步错误未捕获");
assert(/console\.error =/.test(frontendLogger) && /console\.warn =/.test(frontendLogger), "控制台错误未捕获");
assert(/window\.fetch =/.test(frontendLogger) && /!response\.ok/.test(frontendLogger), "网络错误未捕获");
assert(/MAX_LOG_BYTES\s*=\s*8 \* 1024/.test(frontendLogger), "前端单条日志未限制为 8KB");
assert(/OMITTED_CONTENT_KEYS/.test(frontendLogger), "小说正文和工程主体没有从连续日志中排除");
assert(/\[\?\&\]\[\^=/.test(frontendLogger), "前端日志未统一遮住网址参数");
assert(/installGlobalErrorLogging\("editor"/.test(editorMain), "编辑器未安装全局错误记录");
assert(/installGlobalErrorLogging\("player"/.test(playerMain), "播放器未安装全局错误记录");
assert(/configure_error_logging\(\)/.test(backendMain), "后端文件日志未初始化");
assert(/response\.status_code >= 400/.test(backendMain), "后端错误响应未记录");
assert(/RequestValidationError/.test(backendMain) && /StarletteHTTPException/.test(backendMain), "后端接口错误正文未记录");
assert(/RotatingFileHandler/.test(backendLogging) && /backend\.log/.test(backendLogging), "后端轮换日志未配置");
assert(/_DeduplicatingFilter/.test(backendLogging), "后端日志未做一秒重复抑制");
assert(/except OSError/.test(backendLogging), "后端日志目录不可写时仍可能覆盖原错误");
assert(/小说导入流式接口失败/.test(novelRoutes) && /log_exception/.test(novelRoutes), "小说导入流式错误未记录");
assert(/小说长连接处理失败/.test(novelWebSocket) && /log_exception/.test(novelWebSocket), "小说长连接错误未记录");
assert(/小说处理子任务失败/.test(novelService), "小说后台子任务错误未记录");
assert(/editor\.novel-import-api/.test(novelClient), "小说导入前端接口错误未记录");
assert(/editor\.backend-api/.test(backendClient) && /editor\.backend-stream/.test(backendClient), "通用后端接口错误未记录");
assert(/player\.audio/.test(playerAudio), "播放器音频错误未记录");
assert(/player\.video/.test(playerVideo), "播放器视频错误未记录");
assert(/Remove-Item[\s\S]*?\$BundleWorkspace[\s\S]*?Copy-DirectoryFiltered/.test(packageScript), "编辑器打包前没有重建播放器工作区");
assert(/Assert-PlayerExecutableLogContract/.test(packageScript), "编辑器打包前没有检查播放器产物的日志路径");
assert(/BundledPlayerHost[\s\S]*?Assert-PlayerLogContractText/.test(packageScript), "发行工作区没有检查播放器源码日志路径");
assert(/Contains\("player\.log"\)/.test(packageScript), "发行检查没有拒绝旧 player.log 路径");

auditFrontendCatchBlocks();
auditBackendExceptBlocks();

console.log("error-log coverage contract: PASS");
