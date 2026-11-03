const fs = require("fs");
const { loadProjectContainer, saveProjectContainer } = require("./project-container.cjs");

async function main() {
  const [filePath, projectPath, mode = "preserve"] = process.argv.slice(2);
  if (!filePath || !projectPath) throw new Error("Expected target .vnproj and temporary project JSON paths.");
  const loaded = mode === "zip"
    ? { container: "zip", project: {}, zip: undefined }
    : mode === "json"
      ? { container: "json", project: {} }
      : await loadProjectContainer(filePath);
  loaded.project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  await saveProjectContainer(filePath, loaded);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
