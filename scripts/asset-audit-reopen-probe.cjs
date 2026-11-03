"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {chromium}=require("../editor/node_modules/playwright");
const {startEditorAcceptance}=require("./lib/editor-ui-acceptance.cjs");
const input=path.resolve(process.argv[2]),out=`F:/AgentVN/QA/Asset-Audit-20261021-01/reopen-${process.argv[3]}`;
assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
// The harness expects JSON for its isolation preflight; import the actual ZIP through UI below.
const JSZip=require("../editor/node_modules/jszip");
let env,browser,page;
(async()=>{
 const zip=await JSZip.loadAsync(fs.readFileSync(input)),project=await zip.file("project.json").async("string");
 const fixturePath=path.join(out,"isolation-identity.vnproj");fs.writeFileSync(fixturePath,project,{flag:"wx"});
 process.env.AGENTVN_TEST_PROJECT=fixturePath;process.env.AGENTVN_WORKSPACE_OUTPUT=path.join(out,"services");
 env=await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT,{isolateBackendWorkingDirectory:true});
 browser=await chromium.launch({args:["--use-angle=d3d11"]});
 page=await browser.newPage({viewport:{width:1920,height:1080}});
 await page.goto(env.url);
 await page.waitForFunction(()=>[...document.querySelectorAll(".project-import-button input")].some(e=>!e.disabled));
 await page.locator(".project-import-button input").first().setInputFiles(input);
 await page.waitForFunction(()=>document.querySelector(".editor-toolbar")&&!document.querySelector(".project-entry-loading-overlay"));
 await page.locator('.react-flow__node[data-id="scene"]').click();
 await page.locator(".inspector-asset-audit header").waitFor();
 const result=await page.evaluate(async()=>{
  const {useEditorStore}=await import("/src/store/editorStore.ts");
  const {useProjectStore}=await import("/src/store/projectStore.ts");
  return {header:document.querySelector(".inspector-asset-audit header").textContent,
   rows:[...document.querySelectorAll(".inspector-asset-audit article")].map(e=>e.textContent),
   nodes:useEditorStore.getState().nodes,assets:useProjectStore.getState().assetManifest};
 });
 fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
})().catch(async e=>{
 console.error(e);process.exitCode=1;
 if(page){fs.writeFileSync(path.join(out,"failure.json"),JSON.stringify({error:String(e.stack),text:await page.locator("body").innerText()},null,2));
 await page.screenshot({path:path.join(out,"failure.png")});}
})
.finally(async()=>{await browser?.close();await env?.stop();});
