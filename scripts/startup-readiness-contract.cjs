const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const rust = fs.readFileSync(path.join(root, "editor/src-tauri/src/main.rs"), "utf8");
const config = JSON.parse(fs.readFileSync(path.join(root, "editor/src-tauri/tauri.conf.json"), "utf8"));
if (!rust.includes("fn frontend_http_ready(port: u16)")) throw new Error("缺少前端 HTTP 就绪检查");
if (!rust.includes("wait_for_frontend_http(6767, 60)")) throw new Error("启动流程未使用前端 HTTP 就绪屏障");
if (!rust.includes("window.hide()") || !rust.includes("window.show()")) throw new Error("启动窗口未隐藏/就绪后显示");
if (config.app.windows[0].visible !== false) throw new Error("主窗口必须默认隐藏，避免显示 WebView 超时页");
const webviewProfileSetup = rust.indexOf("configure_dev_webview_data_directory();");
const tauriBuilderSetup = rust.indexOf("tauri::Builder::default()");
if (webviewProfileSetup < 0 || webviewProfileSetup > tauriBuilderSetup) {
  throw new Error("Dev WebView2 数据目录必须在创建 Tauri 窗口前隔离，避免与安装版配置目录冲突");
}
console.log("startup readiness contract: PASS");
