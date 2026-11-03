const readline = require("node:readline");
const path = require("node:path");
const { decodeCSwitchPayload } = require("./e2-etw-cswitch.cjs");

const THREAD_EVENT_GUID = "3d6fa8d1-fe05-11d0-9dda-00c04fd7ba7c";
const STACK_XML_CANDIDATES = ["events-less-restricted.xml", "events-best-effort.xml"];

function selectStackXmlFile(root, exists = require("node:fs").existsSync) {
  for (const filename of STACK_XML_CANDIDATES) {
    const candidate = path.join(root, filename);
    if (exists(candidate)) return candidate;
  }
  throw new Error(`Capture root has no supported XML export: ${root}`);
}

async function* iterateXmlEvents(readable) {
  const lines = readline.createInterface({ input: readable, crlfDelay: Infinity });
  let event = "";
  for await (const line of lines) {
    if (line.startsWith("<Event ")) {
      event = `${line}\n`;
      continue;
    }
    if (!event) continue;
    event += `${line}\n`;
    if (line.trim() === "</Event>") {
      yield event;
      event = "";
    }
  }
}

function parseCSwitchEvent(event, time) {
  if (!event.includes(`<EventGuid>{${THREAD_EVENT_GUID}}</EventGuid>`)
      || !/<Opcode>36<\/Opcode>/.test(event)) return null;
  const version = Number(event.match(/<Version>(\d+)<\/Version>/)?.[1]);
  const payload = event.match(/<BinaryEventData>([a-f\d]+)<\/BinaryEventData>/i)?.[1];
  return { time, ...decodeCSwitchPayload(payload, version) };
}

function parseStackWalkEvent(event, time, expected = null) {
  if (!/<EventName\b[^>]*>StackWalk<\/EventName>/.test(event)) return null;
  const value = (name) => event.match(new RegExp(`<Data Name="${name}">([^<]*)<\\/Data>`, "i"))?.[1]?.trim();
  const processValue = value("StackProcess");
  const threadValue = value("StackThread");
  if (!processValue || !threadValue) return null;
  const processId = Number.parseInt(processValue, 0);
  const threadId = Number.parseInt(threadValue, 0);
  if (!Number.isFinite(processId) || !Number.isFinite(threadId)) return null;
  if (expected && (processId !== expected.processId || threadId !== expected.threadId)) return null;
  const frames = [...event.matchAll(/<Data Name="Stack(\d+)">([^<]*)<\/Data>/gi)]
    .map((match) => ({ index: Number(match[1]), address: match[2].trim() }))
    .filter((frame) => frame.address.length > 0)
    .sort((a, b) => a.index - b.index)
    .map((frame) => frame.address);
  const counter = value("EventTimeStamp");
  return {
    time,
    processId,
    threadId,
    eventTimeStamp: counter && /^\d+$/.test(counter) ? counter : null,
    frames,
  };
}

function associateStackWalksToSwitches(stackWalks, switches, threadId, toleranceMs = 0.01) {
  const relevant = switches.filter((event) => (
    event.newThreadId === threadId || event.oldThreadId === threadId
  )).sort((a, b) => a.time - b.time);
  return stackWalks.map((stack) => {
    let nearest = null;
    let distance = Infinity;
    for (const event of relevant) {
      const candidate = Math.abs(stack.time - event.time);
      if (candidate < distance) {
        nearest = event;
        distance = candidate;
      }
      if (event.time > stack.time && candidate > distance) break;
    }
    if (!nearest || distance > toleranceMs) {
      return { ...stack, switch: null, deltaMs: null };
    }
    return {
      ...stack,
      switch: nearest,
      deltaMs: Number((stack.time - nearest.time).toFixed(9)),
    };
  });
}

module.exports = {
  iterateXmlEvents,
  parseCSwitchEvent,
  parseStackWalkEvent,
  associateStackWalksToSwitches,
  selectStackXmlFile,
};
