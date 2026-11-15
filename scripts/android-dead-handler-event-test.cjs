"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { collectDeadHandlerEvents: collect } = require("./lib/android-dead-handler-event.cjs");
const methods = [
  "android.os.MessageQueue.enqueueMessage", "android.os.Handler.enqueueMessage",
  "android.os.Handler.sendMessageAtTime",
  "android.view.Choreographer$FrameDisplayEventReceiver.onVsync",
  "android.view.DisplayEventReceiver.dispatchVsync", "android.os.MessageQueue.nativePollOnce",
  "android.os.MessageQueue.next", "android.os.Looper.loopOnce",
  "android.os.Looper.loop", "android.os.HandlerThread.run",
];
const message = "Handler (android.view.Choreographer$FrameHandler) {cb1af48} sending message to a Handler on a dead thread";
const line = (body, { pid = 2441, tid = 2620, severity = "W", ms = "295" } = {}) =>
  `11-15 17:31:52.${ms} ${pid} ${tid} ${severity} MessageQueue: ${body}`;
const bodies = [message, "java.lang.IllegalStateException: " + message,
  ...methods.map(method => "\tat " + method + "(Source.java:1)")];
const fixture = bodies.map(body => line(body));
test("one warning plus throwable and ten frames remains one evidence event", () => {
  const groups = collect(fixture.join("\n"), [2441]);
  assert.equal(groups.length, 1); assert(groups[0].complete);
  assert.equal(groups[0].members.length, 12);
  assert.deepEqual(groups[0].members.map(row => row.line), fixture);
});
test("unrelated interleaved logs do not break a same-thread stack", () => {
  const rows = fixture.flatMap(row => [row, line("foreign", { pid: 9999 })]);
  assert(collect(rows.join("\n"), [2441])[0].complete);
});
test("foreign process or thread frames cannot complete a warning", () => {
  for (const identity of [{ pid: 9999 }, { tid: 2621 }]) {
    const rows = [...fixture]; rows[4] = line(bodies[4], identity);
    assert.equal(collect(rows.join("\n"), [2441])[0].complete, false);
  }
  assert.deepEqual(collect(fixture.join("\n"), [9999]), []);
});
test("missing terminal frame and permuted call frames remain incomplete", () => {
  assert.equal(collect(fixture.slice(0, -1).join("\n"), [2441])[0].complete, false);
  const rows = [...fixture]; [rows[3], rows[4]] = [rows[4], rows[3]];
  assert.equal(collect(rows.join("\n"), [2441])[0].complete, false);
});
test("a different throwable identity cannot attach to the warning", () => {
  const rows = [...fixture]; rows[1] = rows[1].replace("{cb1af48}", "{deadbeef}");
  assert.equal(collect(rows.join("\n"), [2441])[0].complete, false);
});
test("severity changes and distant frames are never silently absorbed", () => {
  for (const changed of [
    line(bodies[3], { severity: "E" }), line(bodies[3], { ms: "500" }),
  ]) {
    const rows = [...fixture]; rows[3] = changed;
    assert.equal(collect(rows.join("\n"), [2441])[0].complete, false);
  }
  assert.throws(() => collect("", [2441], 5000), /INVALID_HANDLER_EVENT_WINDOW/);
});
test("two consecutive warnings keep separate identities and original line numbers", () => {
  const second = bodies.map(body => line(body.replaceAll("cb1af48", "abc123"), { ms: "350" }));
  const groups = collect([...fixture, ...second].join("\n"), [2441]);
  assert.equal(groups.length, 2); assert(groups.every(group => group.complete));
  assert.deepEqual(groups.map(group => group.members[0].lineNumber), [1, 13]);
});
