const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const tauriConfig = read("editor/src-tauri/tauri.conf.json");
const hooks = read("editor/src-tauri/installer-hooks.nsh");
const host = read("editor/src-tauri/src/main.rs");
const backendClient = read("editor/src/api/backendClient.ts");
const app = read("editor/src/app/App.tsx");

assert(/"installerHooks"\s*:\s*"installer-hooks\.nsh"/.test(tauriConfig), "NSIS installer hooks are not configured");
assert(/!macro\s+NSIS_HOOK_PREINSTALL/.test(hooks), "installer hooks omit NSIS_HOOK_PREINSTALL");
assert(/taskkill\.exe/i.test(hooks), "installer hook does not use taskkill.exe");
assert(/creator-backend\.exe/i.test(hooks), "installer hook does not close creator-backend.exe");
assert(/AgentVN Editor\.exe/i.test(hooks), "installer hook does not close the previous Editor executable");

assert(/fn backend_supports_project_container_protocol/.test(host), "desktop host does not probe the ZIP project protocol capability");
assert(/backend_is_compatible/.test(host), "desktop host does not require a compatible backend before reusing port 8278");
assert(/project_container_protocol/.test(host) && /version\s*>=\s*2/.test(host), "desktop host must reject a backend without ZIP project protocol v2");
assert(/8279\.\.=8299/.test(host) && /backend-base-url=/.test(host), "desktop host must fall back from an unkillable incompatible backend");
assert(/terminate_stale_packaged_backend/.test(host), "desktop host does not clear an incompatible packaged backend");
assert(/taskkill\.exe/.test(host) && /creator-backend\.exe/.test(host), "desktop host cannot terminate a stale packaged backend");

assert(/importProjectTicket[\s\S]*后端请求失败\\s\+\(404\|405\)/.test(backendClient), "ticket import does not classify missing/old backend routes");
assert(/后端版本不匹配/.test(app), "project import does not explain backend version mismatch");

console.log("installer/backend upgrade contract: PASS");
