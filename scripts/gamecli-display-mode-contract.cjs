const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  }
}

const settingsScreen = read('GameCli_framework/src/components/shell/SettingsScreen.tsx');
const displayMode = read('GameCli_framework/src/engine/displayMode.ts');
const settingsStore = read('GameCli_framework/src/store/settingsStore.ts');
const settingsTypes = read('GameCli_framework/src/types/settings.ts');
const app = read('GameCli_framework/src/app/App.tsx');
const tauriConfig = JSON.parse(read('GameCli_framework/src-tauri/tauri.conf.json'));
const rustMain = read('GameCli_framework/src-tauri/src/lib.rs');
const permissions = read('GameCli_framework/src-tauri/capabilities/default.json');
const playerWindow = tauriConfig.app.windows.find((window) => window.title === 'AgentVN Player');

assert(settingsScreen.includes('默认使用全屏窗口模式'), 'settings display tab should explain default fullscreen-window mode');
assert(!settingsScreen.includes('settings.fullscreen'), 'settings screen should not bind any fullscreen setting');
assert(!settingsScreen.includes('applyFullscreen'), 'settings screen should not call runtime fullscreen switching');
assert(!settingsScreen.includes('全屏独占模式'), 'settings screen should not expose exclusive fullscreen wording');

assert(!settingsTypes.includes('fullscreen:'), 'RuntimeSettings should not contain fullscreen');
assert(!settingsStore.includes('fullscreen:'), 'settings defaults/migration should not persist fullscreen');
assert(!app.includes('applyFullscreen'), 'app should not apply fullscreen dynamically');
assert(!app.includes('fullscreenchange'), 'app should not listen for browser fullscreen changes');
assert(!app.includes('settings.fullscreen'), 'app should not read fullscreen setting');
assert(!app.includes('event.key === "f"'), 'app should not keep F fullscreen shortcut');

assert(!displayMode.includes('setFullscreen'), 'display mode module should not call Tauri setFullscreen');
assert(!displayMode.includes('setResizable'), 'display mode module should not resize-lock at runtime');
assert(!displayMode.includes('maximize()'), 'display mode module should not maximize at runtime');
assert(!displayMode.includes('requestFullscreen'), 'display mode module should not request browser fullscreen');
assert(!displayMode.includes('set_display_mode_target'), 'display mode module should not invoke native correction target');
assert(displayMode.includes('setRuntimeWindowTitle'), 'display mode module should only keep title updates');

assert(!rustMain.includes('DisplayModeTargetState'), 'Rust player should not keep display target state');
assert(!rustMain.includes('set_display_mode_target'), 'Rust player should not expose display target command');
assert(!rustMain.includes('on_window_event'), 'Rust player should not correct window state from window events');
assert(!rustMain.includes('WindowEvent::Moved'), 'Rust player should not react to moved events');
assert(!rustMain.includes('set_fullscreen'), 'Rust player should not force fullscreen at runtime');
assert(!rustMain.includes('maximize()'), 'Rust player should not force maximize at runtime');

assert(playerWindow, 'tauri config should contain AgentVN Player window');
assert(playerWindow.fullscreen === true, 'player should start in native fullscreen so the Windows taskbar cannot reserve a bottom strip');
assert(playerWindow.maximized === false, 'player should not use work-area maximization because it leaves the Windows taskbar visible');
assert(playerWindow.decorations === false, 'player should start borderless');
assert(playerWindow.resizable === false, 'player should not be manually resizable');
assert(playerWindow.maximizable === false, 'player should not expose maximize controls');
assert(playerWindow.minimizable === false, 'player should not expose minimize controls');

assert(!permissions.includes('allow-set-fullscreen'), 'permissions should not allow frontend fullscreen changes');
assert(!permissions.includes('allow-maximize'), 'permissions should not allow frontend maximize changes');
assert(!permissions.includes('allow-set-resizable'), 'permissions should not allow frontend resize changes');

if (!process.exitCode) console.log('gamecli display mode contract OK');
