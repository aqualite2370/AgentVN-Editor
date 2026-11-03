const fs = require("fs");
const path = require("path");
const source = fs.readFileSync(path.join(path.resolve(__dirname, ".."), "GameCli_framework/src/engine/desktopSaveManager.ts"), "utf8");
for (const token of ["const compact", "preview_image", "preview_version", "localStorage.setItem(key, JSON.stringify(compact))"]) {
  if (!source.includes(token)) throw new Error(`Web 存档降级缺少 ${token}`);
}
console.log("web save fallback contract: PASS");
