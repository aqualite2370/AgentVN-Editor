"use strict";
// Presentation seam regression: the production helper runs inside a real
// browser. The only live source is a generated silent canvas/video fixture.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "output/playwright/renpy-crossfade-snapshot",
  new Date().toISOString().replace(/[:.]/g, "-"));
const report = {status: "RUNNING", scope: "production-presentation-helper-real-browser", cases: []};
(async () => {
  fs.mkdirSync(output, {recursive: true});
  let server,browser;
  try {
    server = await startOwnedViteServer({root:path.join(root,"GameCli_framework"),
      configFile:path.join(root,"GameCli_framework/vite.config.cjs"),port:0,
      logFile:path.join(output,"server.log")});
    browser = await chromium.launch();
    for (const [width,height] of [[1920,1080],[2560,1440],[3840,2160]])
      for (const dpr of [1,2]) {
        const page = await browser.newPage({viewport:{width,height},deviceScaleFactor:dpr});
        await page.goto(server.url);
        const value = await page.evaluate(async () => {
          const { captureRuntimePage } = await import("/src/app/runtimePageCrossfade.ts");
          const container = document.createElement("div");
          container.style.cssText="position:fixed;inset:0;z-index:2147483000";
          const surface = document.createElement("div");
          surface.className="runtime-screen-transition-layer runtime-screen-transition-current";
          surface.style.cssText="position:absolute;inset:0";
          const canvas = document.createElement("canvas");
          canvas.width=32; canvas.height=16;
          canvas.getContext("2d").fillStyle="#16c87a";
          canvas.getContext("2d").fillRect(0,0,32,16);
          const video = document.createElement("video");
          video.autoplay=true; video.muted=true; video.width=32; video.height=16;
          const stream=canvas.captureStream(30);
          video.srcObject=stream;
          surface.append(canvas,video);container.append(surface);document.body.append(container);
          let first,second;
          try {
            await video.play();
            await new Promise((resolve,reject)=>{
              const timeout=setTimeout(()=>reject(Error("生成视频帧超时")),5000);
              video.requestVideoFrameCallback(()=>{clearTimeout(timeout);resolve();});
              // A captureStream emits new frames when its canvas is drawn;
              // do not wait forever for a silent, unchanged source fixture.
              canvas.getContext("2d").fillRect(0,0,32,16);
              stream.getVideoTracks()[0].requestFrame?.();
            });
            first=captureRuntimePage(surface);
            surface.append(first);
            // Model title/menu frame interruption: previous snapshot is already
            // a descendant of the full-frame surface being captured.
            second=captureRuntimePage(surface,first);
            const media = [...second.querySelectorAll("video,audio")].map(node=>({
              tag:node.tagName,autoplay:node.autoplay,src:node.getAttribute("src")}));
            const canvasPixels = [...first.querySelectorAll("canvas")].map(node=>
              [...node.getContext("2d").getImageData(0,0,1,1).data]);
            const copiedPriorLayers = second.querySelectorAll("div[aria-hidden='true']").length;
            const secondCanvases=second.querySelectorAll("canvas").length;
            return {media,canvasPixels,copiedPriorLayers,secondCanvases,
              inert:second.inert,hidden:second.getAttribute("aria-hidden"),
              functionalOwners:second.querySelectorAll(".runtime-screen-transition-current,.runtime-screen-transition-layer").length};
          } finally {
            first?.remove();second?.remove();video.pause();
            stream.getTracks().forEach(track=>track.stop());container.remove();
          }
        });
        report.cases.push({width,height,dpr,value,status:"CHECKING"});
        assert.equal(value.media.length,0,"快照不得创建视频/音频播放实例");
        assert.equal(value.canvasPixels.length,2,"应保存画布及背景视频的静态帧");
        for (const pixel of value.canvasPixels) assert.deepEqual(pixel,[22,200,122,255],
          "快照必须保留源画面字节，不能复制空白canvas");
        assert.equal(value.secondCanvases,4,"跨框架中断只能保留当前画面与前次快照各一份");
        assert.equal(value.functionalOwners,0);
        assert(value.inert && value.hidden==="true");
        report.cases.at(-1).status="PASS";
        await page.close();
      }
    assert.equal(report.cases.length,6);
    report.status="PASS";
  } catch(error) {
    report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;
  } finally {
    await browser?.close();await server?.stop();
    fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
    console.log(`Evidence: ${output}`);console.log(report.status,report.error??"");
  }
})().catch(error=>{console.error(error);process.exitCode=1});
