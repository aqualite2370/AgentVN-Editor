"use strict";
const fs=require("node:fs"),assert=require("node:assert/strict");
const {sha256}=require("./installed-acceptance.cjs");
const {readInstalledViewport}=require("./current-native-capture.cjs");

// Playwright-created contexts own their emulation on Playwright's CDP session.
// Capture through that session; a second raw CDP session does not own its DPR.
async function captureBrowserViewport(page,_cdp,file,expected){
  const before=await readInstalledViewport(page,expected);
  const bytes=await page.screenshot({fullPage:false,scale:"device",animations:"allow",caret:"initial"});
  const after=await readInstalledViewport(page,expected);
  assert.deepEqual(after,before,"Capture changed actual viewport/DPR/media");
  const png={width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  assert.equal(png.width,expected.width*expected.dpr,"PNG device width mismatch");
  assert.equal(png.height,expected.height*expected.dpr,"PNG device height mismatch");
  fs.writeFileSync(file,bytes,{flag:"wx"});
  return {path:file,sha256:sha256(bytes),before,after,png,
    method:"PLAYWRIGHT_OWNED_SESSION_DEVICE_SCALE",dprTailTolerance:1e-6};
}
module.exports={captureBrowserViewport};
