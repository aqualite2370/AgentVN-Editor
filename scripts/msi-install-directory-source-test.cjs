"use strict";
// Compile a tiny, never-installed MSI around the actual configured fragment,
// then execute the native search/type-51 actions. Not a release-install proof.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/MSI-Location-Repair-20261021-01";
const name = process.argv[2]; assert.match(name || "", /^source-(red|green)-\d{2}$/);
assert(process.argv[3] === undefined || process.argv[3] === "--no-memory");
const noMemory = process.argv[3] === "--no-memory";
const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "REAL_NATIVE_ACTIONS_TINY_SOURCE_FIXTURE_NOT_INSTALLED_EDITOR", noMemory, commands: [], fragments: [], cases: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const xml = value => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function command(exe, args, label, allowed = [0]) {
  const result = spawnSync(exe, args, { cwd: out, windowsHide: true, encoding: "utf8",
    timeout: 120000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, TEMP: out, TMP: out } });
  const log = path.join(out, `${report.commands.length + 1}.log`);
  fs.writeFileSync(log, `${result.stdout || ""}\n${result.stderr || ""}`, { flag: "wx" });
  report.commands.push({ command: [exe, ...args], label, exitCode: result.status, log, error: String(result.error || "") });
  save(); assert(allowed.includes(result.status), log); return result.status;
}
try {
  const configFile = path.join(root, "editor/src-tauri/tauri.conf.json"), config = read(configFile);
  const wix = config.bundle.windows.wix;
  report.configuration = { path: configFile, sha256: sha(configFile) };
  report.fragments = (wix.fragmentPaths || []).map(f => {
    const file = path.resolve(root, "editor/src-tauri", f);
    assert(file.startsWith(path.join(root, "editor/src-tauri") + path.sep));
    const copy = path.join(out, path.basename(file)); fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
    return { path: file, copy, sha256: sha(file) };
  });
  const marker = path.join(out, "not-installed.txt");
  const registryKey = noMemory ? "Software\\agentvn\\AgentVN MSI Directory Probe Missing\\" + crypto.randomUUID()
    : "Software\\agentvn\\AgentVN Editor";
  report.rememberedRegistryKey = registryKey;
  fs.writeFileSync(marker, "Native directory probe. Never install this fixture.", { flag: "wx" });
  const main = path.join(out, "probe.wxs");
  fs.writeFileSync(main, `<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
 <Product Id="*" Name="AgentVN MSI directory native probe" Manufacturer="agentvn"
  Version="1.0.0" Language="1033" UpgradeCode="{134A7A63-142F-4ED9-AF24-8D46A64CB99A}">
  <Package InstallerVersion="450" Compressed="yes" InstallScope="perMachine" />
  <MediaTemplate EmbedCab="yes" />
  <Property Id="INSTALLDIR">
   <RegistrySearch Id="PrevInstallDirNoName" Root="HKCU" Key="${xml(registryKey)}" Type="raw" Win64="yes" />
   <RegistrySearch Id="PrevInstallDirWithName" Root="HKCU" Key="${xml(registryKey)}" Name="InstallDir" Type="raw" Win64="yes" />
  </Property>
  <CustomAction Id="UnusedFixtureProperty" Property="PROBE_UNUSED" Value="1" />
  <InstallUISequence><AppSearch Sequence="50" /></InstallUISequence>
  <InstallExecuteSequence><AppSearch Sequence="50" /></InstallExecuteSequence>
  <Directory Id="TARGETDIR" Name="SourceDir"><Directory Id="ProgramFiles64Folder">
   <Directory Id="INSTALLDIR" Name="AgentVN native probe">
    <Component Id="ProbeMarker" Guid="*" Win64="yes"><File Id="ProbeMarkerFile" Source="${xml(marker)}" KeyPath="yes" /></Component>
   </Directory>
  </Directory></Directory>
  <Feature Id="ProbeFeature" Level="1"><ComponentRef Id="ProbeMarker" />
   ${(wix.componentGroupRefs || []).map(id => `<ComponentGroupRef Id="${xml(id)}" />`).join("\n")}
  </Feature>
 </Product>
</Wix>`, { flag: "wx" });
  const tools = "C:/Users/1/AppData/Local/tauri/WixTools314";
  command(path.join(tools, "candle.exe"), ["-nologo", "-arch", "x64", "-out", out + path.sep,
    main, ...report.fragments.map(f => f.copy)], "Compile actual configured source policy");
  const msi = path.join(out, "probe.msi");
  command(path.join(tools, "light.exe"), ["-nologo", "-out", msi,
    path.join(out, "probe.wixobj"), ...report.fragments.map(f => path.join(out, path.basename(f.copy, ".wxs") + ".wixobj"))],
    "Link and validate tiny MSI");
  command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/msi-install-directory-probe.ps1"), "-Package", msi,
    "-Output", path.join(out, "native-actions.json"), "-RememberedKey", registryKey], "Native UI/execute/handoff search", [0, 1]);
  const probe = read(path.join(out, "native-actions.json")); report.native = {
    path: path.join(out, "native-actions.json"), sha256: sha(path.join(out, "native-actions.json")),
  };
  report.cases = probe.cases;
  assert.equal(probe.cases.length, 9); assert.equal(probe.status, "PASS", "Explicit and browse-selected directories must survive AppSearch");
  assert(probe.cases.every(c => c.status === "PASS"));
  assert(report.fragments.length > 0 && wix.componentGroupRefs.length > 0, "Configured fragment must be included");
  assert(probe.tables.Properties.find(p => p.Property === "SecureCustomProperties").Value
    .split(";").includes("AGENTVN_REQUESTED_INSTALLDIR"));
  for (const f of report.fragments) assert.equal(sha(f.path), f.sha256);
  assert.equal(sha(configFile), report.configuration.sha256);
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
report.finishedAt = new Date().toISOString(); save();
console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
  failedCases: report.cases.filter(c => c.status !== "PASS").length, out, error: report.error }));
