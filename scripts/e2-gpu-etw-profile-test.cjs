const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const profilePath = path.join(__dirname, "e2-gpu-targeted.wprp");
assert.ok(fs.existsSync(profilePath), "targeted WPR profile must exist");
const stackProfilePath = path.join(__dirname, "e2-gpu-targeted-stack.wprp");
assert.ok(fs.existsSync(stackProfilePath), "stack-enabled targeted WPR profile must exist");

const xml = fs.readFileSync(profilePath, "utf8");
assert.match(xml, /<WindowsPerformanceRecorder\b[^>]*Version="1\.0"/);
const profile = xml.match(/<Profile\b[^>]*Id="E2Gpu\.Verbose\.File"[^>]*LoggingMode="File"[^>]*DetailLevel="Verbose"[^>]*>([\s\S]*?)<\/Profile>/)?.[1];
assert.ok(profile, "the file-mode verbose profile must exist");
const profileCollectors = profile.match(/<Collectors\b[^>]*>([\s\S]*?)<\/Collectors>/)?.[1];
assert.ok(profileCollectors, "collector references must be nested in the profile Collectors element");
assert.match(profileCollectors, /<SystemCollectorId\s+Value="SystemCollector"\s*>\s*<SystemProviderId\s+Value="SystemProvider"\s*\/>\s*<\/SystemCollectorId>/);
assert.match(profileCollectors, /<EventCollectorId\s+Value="EventCollector"\s*>\s*<EventProviders>\s*<EventProviderId\s+Value="WPR_Event_Collector_802ec45a-1e99-4b83-9920-87c98277ba9d"\s*\/>\s*<\/EventProviders>\s*<\/EventCollectorId>/);

const systemProvider = xml.match(/<Profiles>\s*<SystemCollector\b[\s\S]*?<\/SystemCollector>\s*<EventCollector\b[\s\S]*?<\/EventCollector>\s*<SystemProvider\b[^>]*Id="SystemProvider"[^>]*>([\s\S]*?)<\/SystemProvider>/)?.[1];
assert.ok(systemProvider, "system provider configuration must be present");
for (const keyword of ["ProcessThread", "CSwitch", "ReadyThread"]) {
  assert.match(systemProvider, new RegExp(`<Keyword\\s+Value="${keyword}"\\s*\\/>`));
}
assert.equal((systemProvider.match(/<Keyword\b/g) ?? []).length, 3, "system events must stay narrowly scoped");
assert.doesNotMatch(systemProvider, /<Stacks\b/, "stack walking is intentionally disabled");

const providers = [...xml.matchAll(/<EventProvider\b[^>]*>([\s\S]*?)<\/EventProvider>/g)];
assert.equal(providers.length, 1, "only the DxgKrnl event provider should be enabled");
assert.match(providers[0][0], /Id="WPR_Event_Collector_802ec45a-1e99-4b83-9920-87c98277ba9d"/i);
assert.match(providers[0][0], /Name="802ec45a-1e99-4b83-9920-87c98277ba9d"/i);
assert.match(providers[0][0], /NonPagedMemory="true"/i);
assert.match(providers[0][0], /Strict="true"/i);
assert.match(providers[0][0], /<Keyword\s+Value="0x08008005"\s*\/>/i);
assert.doesNotMatch(providers[0][1], /<Stacks\b/, "event-provider stack walking is intentionally disabled");
assert.doesNotMatch(providers[0][0], /\bStack="true"/i, "provider-level stack walking must also stay disabled");
assert.match(xml, /<EventCollectorId\s+Value="EventCollector">[\s\S]*?<EventProviderId\s+Value="WPR_Event_Collector_802ec45a-1e99-4b83-9920-87c98277ba9d"/);

const collectors = [...xml.matchAll(/<(SystemCollector|EventCollector)\b[^>]*>([\s\S]*?)<\/\1>/g)];
assert.equal(collectors.length, 2, "system and event collectors must both have bounded buffers");
for (const [, kind, body] of collectors) {
  assert.match(body, /<BufferSize\s+Value="256"\s*\/>/, `${kind} must use the reviewed buffer size`);
  assert.match(body, /<Buffers\s+Value="256"\s*\/>/, `${kind} must use a bounded buffer count`);
}

const parsed = spawnSync("wpr.exe", ["-profiles", profilePath], { encoding: "utf8", windowsHide: true });
assert.equal(parsed.status, 0, `WPR must accept the profile: ${parsed.error?.message ?? parsed.stderr ?? parsed.stdout}`);
assert.match(parsed.stdout, /\bE2Gpu\b/, "WPR must enumerate the requested profile name");

const stackXml = fs.readFileSync(stackProfilePath, "utf8");
assert.match(stackXml, /<WindowsPerformanceRecorder\b[^>]*Version="1\.0"/);
const stackProfile = stackXml.match(/<Profile\b[^>]*Id="E2GpuStack\.Verbose\.File"[^>]*Name="E2GpuStack"[^>]*LoggingMode="File"[^>]*DetailLevel="Verbose"[^>]*>([\s\S]*?)<\/Profile>/)?.[1];
assert.ok(stackProfile, "the file-mode stack-enabled profile must exist");
const stackSystemProvider = stackXml.match(/<SystemProvider\b[^>]*Id="SystemProvider"[^>]*>([\s\S]*?)<\/SystemProvider>/)?.[1];
assert.ok(stackSystemProvider, "stack-enabled system provider configuration must exist");
for (const keyword of ["ProcessThread", "CSwitch", "ReadyThread", "Loader"]) {
  assert.match(stackSystemProvider, new RegExp(`<Keyword\\s+Value="${keyword}"\\s*\\/>`));
}
assert.match(stackSystemProvider, /<Stacks>\s*<Stack\s+Value="CSwitch"\s*\/>\s*<\/Stacks>/,
  "only context-switch stacks should be collected");
assert.doesNotMatch(stackSystemProvider, /<Stack\s+Value="ReadyThread"/,
  "ready-thread stack collection is intentionally disabled");
const stackProviders = [...stackXml.matchAll(/<EventProvider\b[^>]*>([\s\S]*?)<\/EventProvider>/g)];
assert.equal(stackProviders.length, 1, "the stack profile must retain a single DxgKrnl provider");
assert.match(stackProviders[0][0], /Id="WPR_Event_Collector_802ec45a-1e99-4b83-9920-87c98277ba9d"/i);
assert.match(stackProviders[0][0], /Name="802ec45a-1e99-4b83-9920-87c98277ba9d"/i);
assert.match(stackProviders[0][0], /NonPagedMemory="true"/i);
assert.match(stackProviders[0][0], /Strict="true"/i);
assert.match(stackProviders[0][0], /<Keyword\s+Value="0x08008005"\s*\/>/i);
assert.doesNotMatch(stackProviders[0][0], /\bStack="true"/i,
  "high-volume DxgKrnl events must not each collect a stack");
assert.doesNotMatch(stackProviders[0][1], /<Stacks\b/,
  "only system context-switch stacks should be collected");
assert.match(stackXml, /<EventCollectorId\s+Value="EventCollector">[\s\S]*?<EventProviderId\s+Value="WPR_Event_Collector_802ec45a-1e99-4b83-9920-87c98277ba9d"/);
const stackParsed = spawnSync("wpr.exe", ["-profiles", stackProfilePath], { encoding: "utf8", windowsHide: true });
assert.equal(stackParsed.status, 0,
  `WPR must accept the stack profile: ${stackParsed.error?.message ?? stackParsed.stderr ?? stackParsed.stdout}`);
assert.match(stackParsed.stdout, /\bE2GpuStack\b/, "WPR must enumerate the stack profile name");

console.log("PASS targeted E2 WPR profile scope, stack and buffer contracts");
