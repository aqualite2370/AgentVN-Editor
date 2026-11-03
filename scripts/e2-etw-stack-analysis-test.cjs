const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const {
  iterateXmlEvents,
  parseCSwitchEvent,
  parseStackWalkEvent,
  associateStackWalksToSwitches,
  selectStackXmlFile,
} = require("./lib/e2-etw-stack-analysis.cjs");

const processId = 47260;
const threadId = 48212;
const payload = Buffer.alloc(24);
payload.writeUInt32LE(1234, 0);
payload.writeUInt32LE(threadId, 4);
payload.writeUInt8(12, 12);
payload.writeUInt8(1, 13);
payload.writeUInt8(5, 14);

const cswitchXml = `<Event xmlns="urn:etw">
  <System><Version>5</Version><Opcode>36</Opcode><TimeCreated SystemTime="2026-10-10T00:00:00.000000000Z" /></System>
  <BinaryEventData>${payload.toString("hex")}</BinaryEventData>
  <ExtendedTracingInfo><EventGuid>{3d6fa8d1-fe05-11d0-9dda-00c04fd7ba7c}</EventGuid></ExtendedTracingInfo>
</Event>`;
const stackXml = `<Event xmlns="urn:etw">
  <System><Opcode>32</Opcode><TimeCreated SystemTime="2026-10-10T00:00:00.001000000Z" /></System>
  <EventData>
    <Data Name="StackProcess">0xB89C</Data><Data Name="StackThread">48212</Data>
    <Data Name="Stack1">0xFFFF000000000001</Data><Data Name="Stack2">0x7FF8000000000002</Data>
  </EventData>
  <RenderingInfo><EventName>StackWalk</EventName></RenderingInfo>
</Event>`;

async function main() {
  const captureRoot = "capture-root";
  assert.equal(
    selectStackXmlFile(captureRoot, (file) => file.endsWith("events-less-restricted.xml")
      || file.endsWith("events-best-effort.xml")),
    require("node:path").join(captureRoot, "events-less-restricted.xml"),
    "less-restricted tracerpt XML must be preferred when available",
  );
  assert.equal(
    selectStackXmlFile(captureRoot, (file) => file.endsWith("events-best-effort.xml")),
    require("node:path").join(captureRoot, "events-best-effort.xml"),
    "the existing export remains a compatible fallback",
  );
  assert.throws(
    () => selectStackXmlFile(captureRoot, () => false),
    /no supported XML export/,
    "missing stack XML must fail clearly",
  );

  const events = [];
  for await (const event of iterateXmlEvents(Readable.from([
    `<Events>\n${cswitchXml}\n${stackXml}\n</Events>`,
  ]))) {
    events.push(event);
  }
  assert.equal(events.length, 2, "XML event blocks should stream independently");

  const cswitch = parseCSwitchEvent(events[0], 10);
  assert.deepEqual(cswitch, {
    time: 10,
    newThreadId: 1234,
    oldThreadId: threadId,
    oldThreadPriority: 0,
    newThreadPriority: 0,
    oldThreadWaitReason: 12,
    oldThreadWaitMode: 1,
    oldThreadState: 5,
    payloadLength: 24,
    version: 5,
  });

  const stack = parseStackWalkEvent(events[1], 10.001);
  assert.deepEqual(stack, {
    time: 10.001,
    processId,
    threadId,
    eventTimeStamp: null,
    frames: ["0xFFFF000000000001", "0x7FF8000000000002"],
  });
  assert.deepEqual(
    associateStackWalksToSwitches([stack], [cswitch], threadId, 0.01),
    [{ ...stack, switch: cswitch, deltaMs: 0.001 }],
  );
  assert.deepEqual(associateStackWalksToSwitches([stack], [cswitch], threadId, 0.0001), [
    { ...stack, switch: null, deltaMs: null },
  ]);
  console.log("PASS E2 streaming ETW stack parsing and CSwitch association contract");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
