import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  clearRuntimeLayoutWorkspaceDraft,
  readRuntimeLayoutWorkspaceDraft,
  writeRuntimeLayoutWorkspaceDraft,
} from "../editor/src/utils/runtimeLayoutWorkspaceDraft.mjs";

const clone = value => structuredClone(value);
const source = await readFile(new URL("../editor/src/components/advanced/RuntimeLayoutDesigner.tsx", import.meta.url), "utf8");
const firstDraft = { source: "<script>invalid()</script>" };
const otherProjectDraft = { source: "<slot name=\"content\"></slot>" };

writeRuntimeLayoutWorkspaceDraft("project-a", "renpy", firstDraft, clone);
writeRuntimeLayoutWorkspaceDraft("project-b", "renpy", otherProjectDraft, clone);

assert.deepEqual(readRuntimeLayoutWorkspaceDraft("project-a", "renpy", clone), firstDraft,
  "remount restores the unsaved draft for its project and layout");
assert.deepEqual(readRuntimeLayoutWorkspaceDraft("project-b", "renpy", clone), otherProjectDraft,
  "another project retains its own draft");
assert.equal(readRuntimeLayoutWorkspaceDraft("project-a", "agentvn", clone), undefined,
  "layout types do not share draft state");

const mutatedCopy = readRuntimeLayoutWorkspaceDraft("project-a", "renpy", clone);
mutatedCopy.source = "mutated copy";
assert.deepEqual(readRuntimeLayoutWorkspaceDraft("project-a", "renpy", clone), firstDraft,
  "restored values cannot mutate the cache without a commit");

clearRuntimeLayoutWorkspaceDraft("project-a", "renpy");
assert.equal(readRuntimeLayoutWorkspaceDraft("project-a", "renpy", clone), undefined,
  "successful save or explicit discard can clear only the matching draft");
assert.deepEqual(readRuntimeLayoutWorkspaceDraft("project-b", "renpy", clone), otherProjectDraft,
  "clearing a project draft leaves other projects untouched");

assert.match(source, /readRuntimeLayoutWorkspaceDraft\(projectId,\s*layoutType/);
assert.match(source, /writeRuntimeLayoutWorkspaceDraft\(projectId,\s*layoutType/);
assert.match(source, /clearRuntimeLayoutWorkspaceDraft\(projectId,\s*layoutType/);
assert.match(source, /const cachedDraft = readRuntimeLayoutWorkspaceDraft\(projectId,\s*layoutType,\s*cloneSkin\)/);

console.log("Runtime layout workspace draft recovery and workspace ownership: 9 assertions passed.");
