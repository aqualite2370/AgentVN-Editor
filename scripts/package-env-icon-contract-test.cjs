const fs=require('fs');const path=require('path');
const root=path.resolve(__dirname,'..');
function assert(c,m){if(!c) throw new Error(m)}
function read(p){return fs.readFileSync(path.join(root,p),'utf8')}
const setup=read('scripts/setup-android-build-env.ps1');
const win=read('scripts/build-runtime-standalone-windows.cjs');
const android=read('scripts/build-runtime-standalone-android.ps1');
const tauri=read('editor/src-tauri/src/main.rs');
assert(/TUNA|npmmirror|rsproxy|USTC|mirror/i.test(setup), 'China mirror hints are present in Android setup');
assert(/stage|progress|下载|镜像|Progress/i.test(setup), 'setup script records progress stages');
assert(/node/.test(setup) && /cargo/.test(setup) && /rustup/.test(setup), 'setup detects node/cargo/rustup');
assert(/\[switch\]\$ProbeOnly/.test(setup), 'Android helper retains an explicit elevated symlink probe mode');
assert(!/-Verb RunAs/.test(setup), 'Android environment detection and import never open a UAC prompt');
assert(
  /DEFERRED_TO_BUILD/.test(setup)
    && /ANDROID_BUILD_ELEVATION_REQUIRED/.test(setup)
    && /windows_symlink_capability[\s\S]+PASS/.test(setup),
  'a non-elevated symlink permission requirement is deferred to the real Android build',
);
assert(
  /launch_elevated_android_helper/.test(tauri)
    && /run_elevated_android_build_request/.test(tauri)
    && /Elevated helper is checking symbolic-link capability/.test(tauri),
  'the actual Android build performs the authoritative elevated symlink probe',
);
assert(!/whoami\.exe\s+\/priv/.test(setup) && !/whoami\.exe\s+\/priv/.test(android), 'symlink reports never capture localized whoami output');
assert(/symbolicLinkPrivilegePresent/.test(setup) && /symbolicLinkPrivilegeEnabled/.test(setup), 'Android repair reports structured symlink privilege state');
assert(/symbolicLinkPrivilegePresent/.test(android) && /symbolicLinkPrivilegeEnabled/.test(android), 'Android build runner reports structured symlink privilege state');
assert(/\[switch\]\$UseCachedPass/.test(setup) && /PassCachePath/.test(setup), 'Android environment helper supports a durable PASS cache');
assert(/UseCachedPass/.test(android) && /environment-cache\\android-pass\.json/.test(android), 'Android package builds reuse the shared PASS cache');
assert(/cached_environment_result/.test(tauri) && /force_recheck/.test(tauri), 'Tauri can reuse environment PASS results while preserving forced rechecks');
const loggedCommand = android.slice(
  android.indexOf('function Invoke-LoggedCommand'),
  android.indexOf('function Ensure-AndroidCargoTargetDirs'),
);
assert(!/\$process\s*=\s*Start-Process/.test(loggedCommand), 'Android command runner does not use PowerShell 5.1 Start-Process');
assert(/System\.Diagnostics\.ProcessStartInfo/.test(loggedCommand), 'Android command runner uses the .NET process API');
assert(/\$process\.WaitForExit\(\)/.test(loggedCommand), 'Android command runner waits only on the direct process handle');
assert(/\[System\.IO\.Path\]::GetExtension\(\$FilePath\).+\.cmd.+\.bat/s.test(loggedCommand), 'Android command runner detects Windows command scripts');
assert(
  /\$env:ComSpec.+cmd\.exe/s.test(loggedCommand)
    && /\/d \/v:off \/s \/c/.test(loggedCommand),
  'Android command scripts run through cmd.exe with delayed expansion disabled and a readable exit code',
);
assert(
  /AGENTVN_COMMAND_SCRIPT/.test(loggedCommand)
    && /\$processArgumentString\s*=\s*"\/d \/v:off \/s \/c/.test(loggedCommand),
  'Android command scripts preserve nested quoting and literal percent signs through an environment path',
);
assert(/StandardOutputEncoding\s*=\s*\$utf8/.test(loggedCommand) && /StandardErrorEncoding\s*=\s*\$utf8/.test(loggedCommand), 'Android command output is decoded explicitly as UTF-8');
assert(/ReadToEndAsync\(\)/.test(loggedCommand), 'Android command output is drained asynchronously before waiting');
assert(/resolveNpmCli/.test(win) && /npm run tauri/.test(win) && /CARGO_BUILD_JOBS/.test(win), 'windows direct packaging resolves npm and invokes the Rust/Tauri toolchain');
assert(/applyRuntimeIcon/.test(win) && /IconPath/.test(win) && /icon\.ico/.test(win), 'windows icon path is applied');
assert(/Set-RuntimePackageIcon/.test(android) && /IconPath/.test(android) && /Sync-AndroidLauncherIcons/.test(android), 'android icon path is applied');
assert(/mipmap-mdpi/.test(android) && /mipmap-xxxhdpi/.test(android) && /ic_launcher_round\.png/.test(android), 'android launcher mipmap densities are generated');
assert(/Backup-AndroidLauncherIcons/.test(android) && /Restore-AndroidLauncherIcons/.test(android), 'android launcher icons are restored after build');
assert(/PACKAGE_BUILD_LOG_EVENT|emit_package_build_log/.test(tauri), 'tauri emits package progress logs');
assert(/run_android_env_tool_blocking\([^)]*run_id/s.test(tauri) && /emit_new_log_file_lines\([^)]*&live_log_path/s.test(tauri), 'android environment repair streams live stage logs');
const androidEnvRunner = tauri.slice(
  tauri.indexOf('fn run_android_env_tool_blocking'),
  tauri.indexOf('fn run_windows_env_tool_blocking'),
);
assert(!/\.arg\("-Json"\)/.test(androidEnvRunner), 'Android environment runner reads structured JSON only from ReportPath and cannot deadlock on stdout pipe backpressure');
console.log('PASS package env/icon contract');
