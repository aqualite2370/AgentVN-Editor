"use strict";

// QA-only preload. The installed runner stays byte-identical. Every case must
// stop before tool discovery/building; any subprocess/network/write escape is
// a test failure, not a mocked successful build.
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const childProcess = require("node:child_process");
const net = require("node:net");
const assert = require("node:assert/strict");
const root = path.resolve(process.env.AGENTVN_OFFLINE_CASE_ROOT || "");
const audit = path.resolve(process.env.AGENTVN_OFFLINE_GUARD_AUDIT || "");
assert(process.env.AGENTVN_OFFLINE_CASE_ROOT && fs.statSync(root).isDirectory());
const inside = candidate => {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};
assert(inside(audit) && path.dirname(audit) === root && !fs.existsSync(audit));
const append = fs.appendFileSync.bind(fs);
function record(value) {
  append(audit, JSON.stringify({ at: new Date().toISOString(), ...value }) + "\n", "utf8");
}
function deny(operation, target) {
  record({ event: "BLOCKED", operation, target: String(target ?? "") });
  throw new Error(`OFFLINE_QA_SIDE_EFFECT_BLOCKED: ${operation}`);
}
function writable(value, operation) {
  if (value instanceof URL) value = fileURLToPath(value);
  if (Buffer.isBuffer(value)) value = value.toString();
  if (typeof value !== "string") return deny(operation, value);
  const candidate = path.resolve(value);
  if (!inside(candidate)) return deny(operation, candidate);
  // Refuse traversing a link even if its lexical path is inside this case.
  for (let current = candidate; inside(current); current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) return deny(operation, current);
    if (current === root) break;
  }
}
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  childProcess[name] = (...args) => deny(`child_process.${name}`, args[0]);
}
net.Socket.prototype.connect = function (...args) { return deny("network.connect", args[0]); };
for (const name of ["writeFile", "appendFile", "mkdir", "rm", "rmdir", "unlink", "truncate",
  "chmod", "chown", "utimes", "createWriteStream"]) {
  for (const suffix of name === "createWriteStream" ? [""] : ["", "Sync"]) {
    const key = name + suffix;
    if (typeof fs[key] !== "function") continue;
    const original = fs[key].bind(fs);
    fs[key] = (target, ...args) => { writable(target, `fs.${key}`); return original(target, ...args); };
  }
  if (typeof fs.promises[name] === "function") {
    const original = fs.promises[name].bind(fs.promises);
    fs.promises[name] = async (target, ...args) => { writable(target, `fs.promises.${name}`); return original(target, ...args); };
  }
}
for (const name of ["rename", "copyFile", "link", "symlink"]) {
  for (const suffix of ["", "Sync"]) {
    const key = name + suffix;
    const original = fs[key].bind(fs);
    fs[key] = (source, destination, ...args) => {
      if (name === "rename") writable(source, `fs.${key}.source`);
      writable(destination, `fs.${key}.destination`);
      if (name === "link" || name === "symlink") return deny(`fs.${key}`, destination);
      return original(source, destination, ...args);
    };
  }
}
for (const key of ["open", "openSync"]) {
  const original = fs[key].bind(fs);
  fs[key] = (target, flags, ...args) => {
    if (flags !== "r" && flags !== "rs" && flags !== fs.constants.O_RDONLY) writable(target, `fs.${key}`);
    return original(target, flags, ...args);
  };
}
record({ event: "READY", root, pid: process.pid, subprocessesAllowed: false, networkAllowed: false });
