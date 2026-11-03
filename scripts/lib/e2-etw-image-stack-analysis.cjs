const fs = require("node:fs");
const path = require("node:path");
const { iterateXmlEvents, selectStackXmlFile } = require("./e2-etw-stack-analysis.cjs");
const { xmlTimestampDeltaMs } = require("./e2-etw-cswitch.cjs");

const IMAGE_EVENT_GUID = "2cb15d1d-5fc1-11d2-abe1-00a0c911f518";

function readData(event, name) {
  return event.match(new RegExp(`<Data Name="${name}">([^<]*)<\\/Data>`, "i"))?.[1]?.trim() ?? null;
}

function parseImageModuleEvent(event, time) {
  if (!event.includes(`{${IMAGE_EVENT_GUID}}`)) return null;
  const processId = Number(readData(event, "ProcessId"));
  const baseText = readData(event, "ImageBase");
  const sizeText = readData(event, "ImageSize");
  const fileName = readData(event, "FileName");
  if (!Number.isSafeInteger(processId) || !baseText || !sizeText || !fileName) return null;

  let base;
  let size;
  try {
    base = BigInt(baseText);
    size = BigInt(sizeText);
  } catch {
    return null;
  }
  if (base < 0n || size <= 0n) return null;

  return {
    time,
    processId,
    opcode: event.match(/<RenderingInfo\b[^>]*>[\s\S]*?<Opcode>([^<]+)<\/Opcode>/)?.[1] ?? null,
    base,
    size,
    fileName,
  };
}

function mapAddressToImageModule(modules, address) {
  const value = typeof address === "bigint" ? address : BigInt(address);
  const matches = modules
    .filter((module) => value >= module.base && value < module.base + module.size)
    .sort((a, b) => b.time - a.time);
  return matches[0] ?? null;
}

function imageModuleTimeline(events, sampleTime) {
  const active = new Map();
  for (const event of events) {
    if (event.time > sampleTime) break;
    const key = `${event.base}:${event.fileName}`;
    if (event.opcode === "DCStart" || event.opcode === "Load" || event.opcode === "KernelBase") {
      active.set(key, event);
    } else if (event.opcode === "UnLoad") {
      active.delete(key);
    }
  }
  return [...active.values()];
}

async function analyze(rootArg, stackAnalysisPathArg, outputPathArg) {
  const root = path.resolve(rootArg);
  const stackAnalysisPath = path.resolve(stackAnalysisPathArg);
  const stackAnalysis = JSON.parse(fs.readFileSync(stackAnalysisPath, "utf8"));
  const stackXmlPath = selectStackXmlFile(root);
  const xmlAnchor = stackAnalysis.clock?.xmlAnchor;
  const epochAnchorMs = stackAnalysis.clock?.epochAnchorMs;
  const processId = stackAnalysis.gpu?.pid;
  const threadId = stackAnalysis.gpu?.tid;
  if (!xmlAnchor || !Number.isFinite(epochAnchorMs) || !processId || !threadId) {
    throw new Error("Stack analysis lacks a verified target thread and XML/epoch clock anchor");
  }

  const samples = (stackAnalysis.windows ?? [])
    .flatMap((window) => window.stackWalks?.samples ?? [])
    .filter((sample) => sample.switch?.oldThreadId === threadId && sample.switch.oldThreadState === 5);
  if (samples.length === 0) throw new Error("No target-thread state-5 switch-out stacks are available");

  const imageEvents = [];
  for await (const event of iterateXmlEvents(fs.createReadStream(stackXmlPath))) {
    if (!event.includes(`{${IMAGE_EVENT_GUID}}`)) continue;
    const timestamp = event.match(/<TimeCreated SystemTime="([^"]+)"/)?.[1];
    if (!timestamp) continue;
    const time = epochAnchorMs + xmlTimestampDeltaMs(timestamp, xmlAnchor);
    const image = parseImageModuleEvent(event, time);
    if (image?.processId === processId) imageEvents.push(image);
  }
  imageEvents.sort((a, b) => a.time - b.time);

  const mappedSamples = samples.map((sample) => {
    const modules = imageModuleTimeline(imageEvents, sample.timeEpochMs);
    const frames = sample.frames.map((address) => {
      const module = mapAddressToImageModule(modules, address);
      return { address, module: module?.fileName ?? null, imageBase: module?.base.toString(16) ?? null };
    });
    return {
      timeEpochMs: sample.timeEpochMs,
      deltaFromSwitchMs: sample.deltaFromSwitchMs,
      waitReasonRaw: sample.switch.oldThreadWaitReason,
      frames,
    };
  });
  const uniqueModules = [...new Set(mappedSamples.flatMap((sample) => (
    sample.frames.map((frame) => frame.module).filter(Boolean)
  )))].sort();
  const outputPath = outputPathArg
    ? path.resolve(outputPathArg)
    : path.join(root, "image-stack-analysis.json");
  fs.writeFileSync(outputPath, `${JSON.stringify({
    kind: "e2-etw-image-stack-mapping-diagnostic-not-acceptance",
    root,
    stackAnalysisPath,
    stackXmlPath,
    gpu: stackAnalysis.gpu,
    imageEventCountForTargetProcess: imageEvents.length,
    targetStateFiveSwitchOutStackCount: mappedSamples.length,
    mappedFrameCount: mappedSamples.reduce(
      (count, sample) => count + sample.frames.filter((frame) => frame.module).length,
      0,
    ),
    uniqueModules,
    samples: mappedSamples,
    limitations: [
      "Image rundown maps addresses to modules but does not resolve function names.",
      "A mapped stack and raw wait reason do not prove the waited-on object or causal GPU mechanism.",
      "Only image records for the target process observed at or before each stack timestamp are used.",
    ],
  }, null, 2)}\n`, { flag: "wx" });

  return { outputPath, imageEventCount: imageEvents.length, mappedSamples, uniqueModules };
}

module.exports = { analyze, imageModuleTimeline, mapAddressToImageModule, parseImageModuleEvent };

if (require.main === module) {
  const [, , root, stackAnalysisPath, outputPath] = process.argv;
  if (!root || !stackAnalysisPath || process.argv.length > 5) {
    throw new Error("Usage: node scripts/e2-etw-image-stack-analysis.cjs <capture-root> <stack-analysis.json> [new output.json]");
  }
  analyze(root, stackAnalysisPath, outputPath)
    .then((result) => {
      process.stdout.write(`${JSON.stringify({
        outputPath: result.outputPath,
        targetImageEventCount: result.imageEventCount,
        targetStateFiveSwitchOutStackCount: result.mappedSamples.length,
        uniqueModules: result.uniqueModules,
      }, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
