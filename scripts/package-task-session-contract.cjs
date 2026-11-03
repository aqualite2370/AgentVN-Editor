const assert = require("node:assert/strict");
const path = require("node:path");
const esbuild = require(path.join(__dirname, "..", "editor", "node_modules", "esbuild"));

const modulePath = path.join(__dirname, "..", "editor", "src", "packaging", "packageTaskSession.ts");
const bundled = esbuild.buildSync({
  entryPoints: [modulePath],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
}).outputFiles[0].text;

const moduleObject = { exports: {} };
new Function("module", "exports", "require", bundled)(moduleObject, moduleObject.exports, require);

const {
  createPackageTaskSession,
  getPackageTaskSession,
  resetPackageTaskSessions,
} = moduleObject.exports;

assert.equal(typeof createPackageTaskSession, "function", "session factory must be public");
assert.equal(typeof getPackageTaskSession, "function", "session lookup must be public");

const initialDraft = {
  mode: "standalone_package",
  targetPlatform: "windows",
  workspaceStage: "settings",
  packageOutputDir: "D:\\release",
  consoleOpen: true,
};

resetPackageTaskSessions();
const first = createPackageTaskSession("project-a", initialDraft);
const firstSnapshots = [];
const unsubscribe = first.subscribe((state) => firstSnapshots.push(state));

assert.equal(first.getState().projectId, "project-a");
assert.equal(first.beginTask({
  kind: "environment",
  platform: "windows",
  operation: "install",
  runId: "run-a",
}), true);
first.update((state) => ({
  ...state,
  environmentOperationDialog: {
    platform: "windows",
    operation: "install",
    phase: "installing",
    message: "正在补齐 Windows 构建环境…",
    percent: 42,
    startedAt: 100,
  },
  consoleEntries: [{ id: "log-1", time: 100, level: "info", source: "windows-env", message: "开始安装" }],
}));

unsubscribe();
assert.equal(first.getState().task?.status, "running", "unsubscribing must not cancel the task");

const reopened = getPackageTaskSession("project-a", initialDraft);
assert.equal(reopened, first, "same project must reuse the same session");
assert.equal(reopened.getState().task?.runId, "run-a");
assert.equal(reopened.getState().environmentOperationDialog.percent, 42);
assert.equal(reopened.getState().consoleEntries[0].message, "开始安装");
assert.equal(reopened.beginTask({
  kind: "environment",
  platform: "windows",
  operation: "install",
  runId: "run-a-duplicate",
}), false, "a running task must not start twice");

const resumedSnapshots = [];
const resumedUnsubscribe = reopened.subscribe((state) => resumedSnapshots.push(state));
reopened.completeTask({ status: "completed" });
assert.equal(reopened.getState().task?.status, "completed");
assert.equal(resumedSnapshots.at(-1).task.status, "completed");
resumedUnsubscribe();

const otherProject = getPackageTaskSession("project-b", initialDraft);
assert.notEqual(otherProject, reopened, "different projects must not share task state");
assert.equal(otherProject.getState().task, undefined);

assert.ok(firstSnapshots.length >= 2, "subscribers must receive session updates");

const buildSession = getPackageTaskSession("project-c", initialDraft);
assert.equal(buildSession.beginTask({
  kind: "export",
  platform: "windows",
  runId: "build-c",
}), true);
buildSession.update((state) => ({
  ...state,
  exportProgress: {
    stage: "构建 Windows 独立软件包",
    detail: "后端正在编译…",
    percent: 61,
    startedAt: 200,
    updatedAt: 260,
  },
}));
const buildReopened = getPackageTaskSession("project-c", initialDraft);
assert.equal(buildReopened.getState().task?.runId, "build-c");
assert.equal(buildReopened.getState().exportProgress.percent, 61);
buildReopened.completeTask({ status: "completed", runId: "build-c" });
assert.equal(buildReopened.getState().task?.status, "completed");

console.log("package task session contract: PASS");
