const fs = require("fs");
const path = require("path");
const { loadProjectContainer } = require("./project-container.cjs");

const root = path.resolve(__dirname, "..");
const projectImport = fs.readFileSync(path.join(root, "editor/src/utils/projectImport.ts"), "utf8");
const projectBundle = fs.readFileSync(path.join(root, "editor/src/utils/projectBundle.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "editor/src/app/App.tsx"), "utf8");
const backendClient = fs.readFileSync(path.join(root, "editor/src/api/backendClient.ts"), "utf8");
const desktopHost = fs.readFileSync(path.join(root, "editor/src-tauri/src/main.rs"), "utf8");
const projectRoutes = fs.readFileSync(path.join(root, "backend/app/api/routes_project.py"), "utf8");
const projectStateService = fs.readFileSync(path.join(root, "backend/app/services/project_state_service.py"), "utf8");
const projectContainer = fs.readFileSync(path.join(root, "backend/app/services/project_container.py"), "utf8");

async function main() {
  const projectDir = path.join(root, "output", "angle-owl-night-king-assets");
  const projectFile = fs.existsSync(projectDir)
    ? fs.readdirSync(projectDir).find((name) => name.endsWith(".vnproj"))
    : undefined;
  let fixture;
  if (projectFile) fixture = await loadProjectContainer(path.join(projectDir, projectFile));

  for (const token of ["isProjectZipBytes", "readProjectJsonFromBundle"]) {
    if (!projectImport.includes(token)) throw new Error(`Frontend project import is missing ZIP compatibility: ${token}`);
  }
  for (const token of ["project.json", "format.json", "streamFiles: true", "writeNativeProjectBundle"]) {
    if (!projectBundle.includes(token)) throw new Error(`Project bundle writer is missing: ${token}`);
  }
  for (const token of ["backendClient.importProjectFile(file)", "backendClient.importProjectTicket(ticket)"]) {
    if (!app.includes(token)) throw new Error(`App import routing is missing: ${token}`);
  }
  for (const token of ["/api/project/projects/import", "/api/project/projects/import-ticket", "body: file"]) {
    if (!backendClient.includes(token)) throw new Error(`Backend client import is missing: ${token}`);
  }
  if (!projectRoutes.includes("PROJECT_IMPORT_MAX_BYTES: int | None = None")) {
    throw new Error("ZIP project imports must not have a fixed 4 GiB application limit.");
  }
  for (const token of ["load_project_container", "staging_dir", "PROJECT_ASSET_HASH_MISMATCH"]) {
    if (!projectStateService.includes(token)) throw new Error(`Backend ZIP importer is missing: ${token}`);
  }
  for (const token of ["PROJECT_CONTAINER_INVALID", "PROJECT_ZIP_PATH_UNSAFE", "PROJECT_ASSET_MISSING"]) {
    if (!projectContainer.includes(token)) throw new Error(`Python container loader is missing: ${token}`);
  }
  for (const token of ["write_project_bundle", "large_file(true)", "select_project_import_file", "begin_project_bundle_asset_upload"]) {
    if (!desktopHost.includes(token)) throw new Error(`Desktop ZIP support is missing: ${token}`);
  }

  console.log(JSON.stringify({
    fixture: projectFile ?? null,
    fixtureContainer: fixture?.container ?? null,
    fixedZipImportLimit: null,
    legacyJsonCompatibility: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
