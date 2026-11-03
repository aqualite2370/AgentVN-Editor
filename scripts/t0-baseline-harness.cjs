#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { loadProjectContainerSync, isSafeProjectPath } = require("./project-container.cjs");

const SOURCE_FILE_NAME = "project_msiz08p7_0_89ebc8a8cb__1786898326185__project.vnproj";
const EXPECTED_SOURCE_BYTES = 1_580_089;
const EXPECTED_SOURCE_SHA256 = "e1c43983ae8b7488c080c55889727d38915602596d873180e6062fff5a3df250";
const EXPECTED_ASSET_INVENTORY_SHA256 = "c258d296fa0e5a2164496ff70b008541f6b953c4cd168c7d866da9d6ec3157a4";

function resolveT0Paths(root = path.resolve(__dirname, "..")) {
  const outputRoot = path.join(root, "output", "hidden-growth");
  const isolationRoot = path.join(outputRoot, "t0-fixture");
  return {
    root,
    sourceFixture: path.join(root, "data", "backup-timeline", SOURCE_FILE_NAME),
    isolationRoot,
    copyPath: path.join(isolationRoot, "hidden-growth.vnproj"),
    baselineManifest: path.join(outputRoot, "fixture-manifest.json"),
    failureReport: path.join(outputRoot, "failure-report.json"),
  };
}

const T0_PATHS = resolveT0Paths();

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function assetPath(root, metadata) {
  const candidates = [
    metadata?.filePath,
    metadata?.backend_asset_path
      ? path.join(root, "data", "backend", "project_assets", metadata.backend_asset_path)
      : undefined,
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0] || "";
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeFailureReport(paths, error, baseline) {
  writeJson(paths.failureReport, {
    status: error ? "FAIL" : "PASS",
    scope: "T0",
    fixture: paths.sourceFixture,
    message: error ? String(error?.message || error) : null,
    stack: error?.stack || null,
    baseline: baseline
      ? {
        sourceSha256: baseline.source.sha256,
        sourceBytes: baseline.source.bytes,
        projectId: baseline.project.project_id,
        title: baseline.project.title,
        nodeCount: baseline.project.nodeCount,
        edgeCount: baseline.project.edgeCount,
        assetCount: baseline.project.assetCount,
      }
      : null,
  });
}

function collectHiddenGrowthBaseline(root = path.resolve(__dirname, "..")) {
  const paths = resolveT0Paths(root);
  let baseline;
  try {
    if (!fs.existsSync(paths.sourceFixture)) {
      throw new Error(`hidden-growth fixture missing: ${paths.sourceFixture}`);
    }
    const sourceBytes = fs.readFileSync(paths.sourceFixture);
    const sourceSha256 = sha256(sourceBytes);
    if (sourceBytes.length !== EXPECTED_SOURCE_BYTES) {
      throw new Error(`hidden-growth fixture size changed: expected ${EXPECTED_SOURCE_BYTES}, got ${sourceBytes.length}`);
    }
    if (sourceSha256 !== EXPECTED_SOURCE_SHA256) {
      throw new Error(`hidden-growth fixture changed: expected ${EXPECTED_SOURCE_SHA256}, got ${sourceSha256}`);
    }

    const project = loadProjectContainerSync(paths.sourceFixture).project;
    const nodes = Array.isArray(project.nodes) ? project.nodes : [];
    const edges = Array.isArray(project.edges) ? project.edges : [];
    const assets = Array.isArray(project.asset_manifest) ? project.asset_manifest : [];
    const seenAssetIds = new Set();
    const inventory = [];
    const typeCounts = {};
    let missing = 0;
    let hashMismatches = 0;
    let unsafePaths = 0;

    for (const asset of assets) {
      const assetId = asset?.asset_id;
      if (!assetId || seenAssetIds.has(assetId)) throw new Error(`duplicate or empty asset_id: ${assetId || "<empty>"}`);
      seenAssetIds.add(assetId);
      const metadata = asset?.metadata || {};
      const type = asset?.asset_type || "unknown";
      typeCounts[type] = (typeCounts[type] || 0) + 1;
      const projectPath = metadata.project_path;
      if (!isSafeProjectPath(projectPath) || !projectPath.startsWith("assets/")) unsafePaths += 1;
      const filePath = assetPath(root, metadata);
      if (!filePath || !fs.existsSync(filePath)) {
        missing += 1;
      } else {
        const bytes = fs.readFileSync(filePath);
        if (Number.isFinite(metadata.size_bytes) && bytes.length !== metadata.size_bytes) hashMismatches += 1;
        if (metadata.hash_sha256 && sha256(bytes) !== metadata.hash_sha256) hashMismatches += 1;
      }
      inventory.push({
        asset_id: assetId,
        asset_type: type,
        project_path: projectPath,
        size_bytes: metadata.size_bytes,
        hash_sha256: metadata.hash_sha256,
      });
    }
    inventory.sort((a, b) => a.asset_id.localeCompare(b.asset_id));
    const inventorySha256 = sha256(JSON.stringify(inventory));
    baseline = {
      source: { path: paths.sourceFixture, bytes: sourceBytes.length, sha256: sourceSha256 },
      project: {
        project_id: project.project_id,
        title: project.title,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        sceneNodeCount: nodes.filter((node) => node.type === "sceneNode").length,
        choiceNodeCount: nodes.filter((node) => node.type === "choiceNode").length,
        assetCount: assets.length,
      },
      assets: {
        missing,
        hashMismatches,
        unsafePaths,
        typeCounts,
        inventorySha256,
      },
      sourceMutated: false,
    };

    writeJson(paths.baselineManifest, {
      scope: "T0",
      fixture: baseline.source,
      project: baseline.project,
      assets: baseline.assets,
      copyPath: paths.copyPath,
    });
    writeFailureReport(paths, null, baseline);
    return baseline;
  } catch (error) {
    writeFailureReport(paths, error, baseline);
    throw error;
  }
}

function copyFixtureToIsolation(root = path.resolve(__dirname, "..")) {
  const paths = resolveT0Paths(root);
  if (!fs.existsSync(paths.sourceFixture)) throw new Error(`hidden-growth fixture missing: ${paths.sourceFixture}`);
  fs.mkdirSync(paths.isolationRoot, { recursive: true });
  const sourceBytes = fs.readFileSync(paths.sourceFixture);
  if (fs.existsSync(paths.copyPath)) {
    const existingBytes = fs.readFileSync(paths.copyPath);
    if (existingBytes.equals(sourceBytes)) {
      return {
        directory: paths.isolationRoot,
        sourcePath: paths.sourceFixture,
        copyPath: paths.copyPath,
      };
    }
  }
  const temporary = path.join(
    paths.isolationRoot,
    `.hidden-growth-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  fs.writeFileSync(temporary, sourceBytes);
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        fs.renameSync(temporary, paths.copyPath);
        break;
      } catch (error) {
        if (error?.code !== "EBUSY" && error?.code !== "EPERM") throw error;
        if (fs.existsSync(paths.copyPath) && fs.readFileSync(paths.copyPath).equals(sourceBytes)) break;
        if (attempt === 7) throw error;
        const waitUntil = Date.now() + 50 * (attempt + 1);
        while (Date.now() < waitUntil) {}
      }
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return {
    directory: paths.isolationRoot,
    sourcePath: paths.sourceFixture,
    copyPath: paths.copyPath,
  };
}

async function stopProcessTree(childOrPid) {
  const pid = typeof childOrPid === "number" ? childOrPid : childOrPid?.pid;
  if (!pid || pid === process.pid) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      // The process may already have exited; cleanup is idempotent.
    }
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try { process.kill(pid, "SIGTERM"); } catch {}
    }
  }
  await waitForExit(pid);
}

function processExists(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !processExists(pid);
}

async function waitForPortFree(port, host = "127.0.0.1", timeoutMs = 5000) {
  if (!Number.isInteger(port) || port <= 0) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const free = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(true);
      });
    });
    if (free) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`port still occupied after cleanup: ${host}:${port}`);
}

async function waitForPortBusy(port, host = "127.0.0.1", timeoutMs = 5000) {
  if (!Number.isInteger(port) || port <= 0) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const busy = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (busy) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`port did not become ready: ${host}:${port}`);
}

function attachBrowserDiagnostics(page) {
  const diagnostics = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    httpErrors: [],
  };
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    diagnostics.pageErrors.push(String(error?.stack || error?.message || error));
  });
  page.on("requestfailed", (request) => {
    diagnostics.failedRequests.push({
      url: request.url(),
      errorText: request.failure()?.errorText || "request failed",
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      diagnostics.httpErrors.push({ url: response.url(), status: response.status() });
    }
  });
  return diagnostics;
}

module.exports = {
  EXPECTED_ASSET_INVENTORY_SHA256,
  EXPECTED_SOURCE_BYTES,
  EXPECTED_SOURCE_SHA256,
  T0_PATHS,
  collectHiddenGrowthBaseline,
  copyFixtureToIsolation,
  resolveT0Paths,
  stopProcessTree,
  attachBrowserDiagnostics,
  waitForPortBusy,
  waitForPortFree,
};
