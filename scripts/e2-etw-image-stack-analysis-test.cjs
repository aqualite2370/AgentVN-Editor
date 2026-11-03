const assert = require("node:assert/strict");
const { mapAddressToImageModule, parseImageModuleEvent } = require("./lib/e2-etw-image-stack-analysis.cjs");

const imageEvent = `<Event xmlns="urn:etw">
  <System><Opcode>3</Opcode><TimeCreated SystemTime="2026-10-10T00:00:00.000000000Z" /></System>
  <EventData>
    <Data Name="ImageBase">0x7FF600000000</Data>
    <Data Name="ImageSize">0x2000</Data>
    <Data Name="ProcessId">46688</Data>
    <Data Name="FileName">C:\\fixture\\chrome.dll</Data>
  </EventData>
  <RenderingInfo><Opcode>DCStart</Opcode><EventName>Image</EventName></RenderingInfo>
  <ExtendedTracingInfo><EventGuid>{2cb15d1d-5fc1-11d2-abe1-00a0c911f518}</EventGuid></ExtendedTracingInfo>
</Event>`;

const parsed = parseImageModuleEvent(imageEvent, 12.5);
assert.deepEqual(parsed, {
  time: 12.5,
  processId: 46688,
  opcode: "DCStart",
  base: 0x7ff600000000n,
  size: 0x2000n,
  fileName: "C:\\fixture\\chrome.dll",
});
assert.equal(
  mapAddressToImageModule([parsed], "0x7FF600001000")?.fileName,
  "C:\\fixture\\chrome.dll",
  "an address inside an image's mapped range should resolve to that image",
);
assert.equal(
  mapAddressToImageModule([parsed], "0x7FF600002000"),
  null,
  "the image end address is exclusive",
);
assert.equal(parseImageModuleEvent("<Event />", 0), null, "unrelated events must be ignored");

console.log("PASS E2 ETW image rundown parsing and stack-address mapping contract");
