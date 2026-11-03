const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const helper = path.join(root, "scripts", "android-release-signing.ps1");
const build = path.join(root, "scripts", "build-runtime-standalone-android.ps1");
const signingDir = path.join(process.env.USERPROFILE || process.env.HOME || root, ".agentvn", "signing");

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

assert(fs.existsSync(helper), "Android signing helper is missing", helper);
const helperText = fs.readFileSync(helper, "utf8");
const buildText = fs.readFileSync(build, "utf8");
assert(/AGENTVN_ANDROID_KEYSTORE_PASSWORD/.test(helperText), "signing helper must support protected password injection");
assert(/ConvertFrom-SecureString|Credential|DPAPI/i.test(helperText), "signing helper must protect generated password at rest");
assert(/Get-Content[\s\S]*-Raw\)\.Trim\(\)/.test(helperText), "signing helper must trim the DPAPI file line ending before parsing");
assert(/keytool/.test(helperText) && /apksigner/.test(helperText), "signing helper must generate and verify with Android tools");
assert(/android-release-signing\.ps1/.test(buildText), "Android build must invoke the signing helper");
assert(/"-Action",\s*"ensure"/.test(buildText), "Android build must initialize signing material before signing");
assert(/signingTempRoot/.test(buildText), "Android signing intermediates must use the diagnostics drive");
assert(/android_apk_signed/.test(buildText), "Android build must publish signed APK artifacts only");
assert(/& \$tool @arguments/.test(helperText), "Android signing tools must receive a correctly quoted PowerShell argument array");
assert(!/Android release APK is unsigned/.test(buildText), "Android build must fail closed instead of accepting unsigned APKs");

fs.mkdirSync(signingDir, { recursive: true });
const report = {
  ok: true,
  helper,
  build,
  signingDir,
  secretsOutsideRepository: !path.resolve(signingDir).startsWith(root),
  checkedAt: new Date().toISOString(),
};
assert(report.secretsOutsideRepository, "signing directory must be outside the repository", report);
console.log(`Android signing contract: PASS\n${JSON.stringify(report, null, 2)}`);
