const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "editor/src/app/App.tsx"), "utf8");
const projectStateService = fs.readFileSync(
  path.join(root, "backend/app/services/project_state_service.py"),
  "utf8",
);

for (const token of [
  "deleteProjectInFlightRef",
  'operation: "delete-project"',
  "window.localStorage.removeItem(currentDraftKey)",
  "fallbackRecords: nextRecentProjects",
]) {
  if (!app.includes(token)) {
    throw new Error(`Project deletion flow is missing frontend resilience token: ${token}`);
  }
}

const deleteRequestIndex = app.indexOf("await backendClient.deleteProject(record.project_id)");
const deleteTryIndex = app.lastIndexOf("try {", deleteRequestIndex);
const deleteCatchIndex = app.indexOf("catch (error)", deleteRequestIndex);
if (deleteRequestIndex < 0 || deleteTryIndex < 0 || deleteCatchIndex < deleteRequestIndex) {
  throw new Error("Project deletion request is not guarded by local error handling");
}

for (const token of [
  "remaining_recent_projects",
  "current_project_id == project_id",
  "self._write_value(PROJECT_GRAPH_KEY, _default_project_graph())",
  "self._write_value(PROJECT_METADATA_KEY, {})",
]) {
  if (!projectStateService.includes(token)) {
    throw new Error(`Project deletion flow is missing backend cleanup token: ${token}`);
  }
}

console.log("Project delete frontend/backend connection contract passed.");
