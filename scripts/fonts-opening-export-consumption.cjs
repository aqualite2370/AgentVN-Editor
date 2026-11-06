"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { api, root, resourceFixture, inputFor, sha } = require("./layout-resources-source-test.cjs");
const JSZip = require("../editor/node_modules/jszip");
const output = process.argv[2]; assert(output && !fs.existsSync(output)); fs.mkdirSync(output,{recursive:true});
const report={status:"RUNNING",scope:"ACTUAL_EDITOR_PACKER_ZIP_BYTES_NOT_INSTALLED_OR_DEVICE",cases:[],modelRequests:0};
const save=()=>fs.writeFileSync(path.join(output,"report.json"),JSON.stringify(report,null,2));
(async()=>{
  const a=api(),fontId="unifont_explicit_author_choice";
  const bytes=fs.readFileSync(path.join(root,"GameCli_framework/node_modules/harfbuzzjs/test/fonts/noto/NotoSans-Regular.ttf"));
  for(const layout of ["agentvn","renpy"]) for(const kind of ["image_sequence","video"]){
    const row={layout,kind,status:"RUNNING"};report.cases.push(row);save();
    try{
      const {project}=resourceFixture(),input=inputFor(project,layout,true);
      const font={asset_id:fontId,asset_type:"font",metadata:{filename:"qa.ttf",project_path:"assets/font/qa.ttf",
        mime_type:"font/ttf",data_url:`data:font/ttf;base64,${bytes.toString("base64")}`,hash_sha256:sha(bytes),size_bytes:bytes.length}};
      const media=kind==="video"?Buffer.from("QA media packaging bytes; decode not claimed"):
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="teal"/></svg>');
      const mediaId="qa_opening",ref={asset_id:mediaId,asset_type:kind==="video"?"video":"ui",metadata:{
        filename:kind==="video"?"qa.webm":"qa.svg",project_path:kind==="video"?"assets/video/qa.webm":"assets/ui/qa.svg",
        mime_type:kind==="video"?"video/webm":"image/svg+xml",data_url:`data:application/octet-stream;base64,${media.toString("base64")}`,
        hash_sha256:sha(media),size_bytes:media.length}};
      for(const asset of [font,ref]){input.projectAssetRefs.push(asset);input.projectAssets.push(a.assetRefToManifestItem(asset));}
      input.uiSkin.tokens.fontAssetId=fontId;
      input.script.scenes[0].commands.push({type:"narration",text:"字体测试",font_asset_id:fontId});
      const presentation={mode:"centered",fit:"cover",width_percent:64,height_percent:72};
      input.script.loading_animation=kind==="video"?{kind,video_asset_id:mediaId,presentation}:
        {kind,image_asset_ids:[mediaId],frame_duration_ms:1000,presentation};
      const original=structuredClone(input),result=await a.exportEditorCartridge(input);
      assert.deepEqual(result.errors,[]); assert.deepEqual(result.assetReport.missingAssets,[]);
      const buffer=Buffer.from(await result.blob.arrayBuffer());
      const zip=await JSZip.loadAsync(buffer),manifest=JSON.parse(await zip.file("manifest.json").async("string"));
      const script=JSON.parse(await zip.file("script.json").async("string"));
      assert.equal(manifest.runtime_version,"0.29.0");assert.deepEqual(script.loading_animation.presentation,presentation);
      for(const [id,expected] of [[fontId,bytes],[mediaId,media]]){
        const asset=manifest.assets.find(asset=>asset.asset_id===id);assert(asset);
        const packed=await zip.file(asset.path).async("nodebuffer");assert.equal(sha(packed),sha(expected));
      }
      const ui=JSON.parse(await zip.file(manifest.ui_skin.path).async("string"));assert.equal(ui.tokens.fontAssetId,fontId);
      assert(script.scenes.some(scene=>scene.commands.some(command=>command.font_asset_id===fontId)));
      assert.deepEqual(input,original);
      const file=path.join(output,`${layout}-${kind}.vncart`);fs.writeFileSync(file,buffer,{flag:"wx"});
      row.artifact={path:file,sha256:sha(buffer),bytes:buffer.length};row.fontSha256=sha(bytes);
      row.runtimeVersion=manifest.runtime_version;row.presentation=presentation;row.status="PASS";
    }catch(error){row.status="FAILED";row.error=String(error.stack||error);}save();
  }
  assert.equal(report.cases.length,4);assert(report.cases.every(row=>row.status==="PASS"));report.status="PASS";
})().catch(error=>{report.status="FAILED";report.error=String(error.stack||error);process.exitCode=1;})
.finally(()=>{report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,cases:report.cases.map(c=>[c.layout,c.kind,c.status]),output}));});
