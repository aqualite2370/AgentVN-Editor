"use strict";
const assert = require("node:assert/strict");
// Read-only function-call breakpoints. Tauri's IPC properties are intentionally
// non-writable/non-configurable; never replace them or substitute native IO.
async function observeAndroidExit(client) {
  let pauses = 0;
  const unexpectedPause = () => { pauses++; void client.send("Debugger.resume").catch(() => {}); };
  client.on("Debugger.paused", unexpectedPause);
  const breakpoints = [];
  await client.send("Debugger.enable");
  await client.send("Runtime.evaluate", { expression:
    "window.__qaAndroidExitTrace={calls:[],replies:[],invocations:[]};" });
  for (const [name, collection, fields] of [
    ["invoke", "invocations", "command:arguments[0]"],
    ["postMessage", "calls", "command:arguments[0].cmd,callback:arguments[0].callback,error:arguments[0].error"],
    ["runCallback", "replies", "id:arguments[0]"],
  ]) {
    const value = await client.send("Runtime.evaluate", {
      expression: `window.__TAURI_INTERNALS__.${name}`, returnByValue: false });
    assert.equal(value.result.type, "function");
    const result = await client.send("Debugger.setBreakpointOnFunctionCall", {
      objectId: value.result.objectId,
      condition: `(window.__qaAndroidExitTrace.${collection}.push({at:performance.now(),${fields}}),false)`,
    });
    breakpoints.push(result.breakpointId);
  }
  return {
    async snapshot() {
      const r = await client.send("Runtime.evaluate", { returnByValue: true, expression: `({
        trace:window.__qaAndroidExitTrace,at:performance.now(),
        descriptors:Object.fromEntries(['invoke','postMessage','runCallback'].map(k=>{
          const d=Object.getOwnPropertyDescriptor(window.__TAURI_INTERNALS__,k);
          return[k,{writable:d.writable,configurable:d.configurable}]})),
        resources:performance.getEntriesByType('resource').filter(e=>e.initiatorType==='script')
          .map(e=>({name:e.name,duration:e.duration,responseEnd:e.responseEnd})),
        text:document.body.innerText})` });
      assert(!r.exceptionDetails, JSON.stringify(r.exceptionDetails));
      return { ...r.result.value, pauses, observation: "CDP_FUNCTION_CALL_BREAKPOINTS_NO_FUNCTION_REPLACEMENT" };
    },
    async stop() {
      for (const breakpointId of breakpoints) await client.send("Debugger.removeBreakpoint", { breakpointId });
      await client.send("Debugger.disable");
      client.off("Debugger.paused", unexpectedPause);
      await client.send("Runtime.evaluate", { expression: "delete window.__qaAndroidExitTrace" });
      return { removedBreakpoints: breakpoints.length, pauses };
    },
  };
}
module.exports = { observeAndroidExit };
