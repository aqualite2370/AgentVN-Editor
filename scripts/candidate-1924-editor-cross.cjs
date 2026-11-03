"use strict";
// Adapt the already verified native host/protection workflow. All behavior
// changes below are explicit 1.7.1 UI/JSON-save/migration differences.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),vm=require("node:vm");
const {createRequire}=require("node:module");
const base=path.join(__dirname,"candidate-1924-editor-upgrade.cjs");
let source=fs.readFileSync(base,"utf8");
function one(before,after){
  assert.equal(source.split(before).length-1,1,"Cross-generation adaptation drift: "+before.slice(0,90));
  source=source.replace(before,after);
}
one("Editor-Upgrade-1924-20261025-05","Editor-Cross-1924-20261025-03");
one("scripts/candidate-1924-editor-upgrade-session.ps1","scripts/candidate-1924-editor-cross-session.ps1");
one("REAL_NSIS_1_9_22_TO_1_9_24_DEFAULT_PATHS_ON_DEVELOPMENT_HOST","REAL_NSIS_1_7_1_TO_1_9_24_NATIVE_CONSENT_ON_DEVELOPMENT_HOST");
one('"Not a 1.7.1/1.9.8 cross-generation upgrade"','"Not an additional recent-version upgrade or full display matrix"');
// Preserve all explicitly authored legacy fields; additions introduced by the
// current serializer are allowed, but no prior value, identity or edge may change.
one('async function closeNormally(label){',`function retainedFields(actual,expected,at="project"){
  if(Array.isArray(expected)){
    assert(Array.isArray(actual),at);assert.equal(actual.length,expected.length,at);
    expected.forEach((v,i)=>retainedFields(actual[i],v,at+"["+i+"]"));return;
  }
  if(expected&&typeof expected==="object"){
    assert(actual&&typeof actual==="object",at);
    for(const [key,value] of Object.entries(expected))retainedFields(actual[key],value,at+"."+key);
    return;
  }
  assert.deepEqual(actual,expected,at);
}
async function closeNormally(label){`);
one('  report.launches.push(current);remember();',`  report.launches.push(current);remember();
  if(label==="new"){
    const source=path.join(install,"data/backend/vn_engine.db");
    assert(fs.existsSync(source),"Real old install-local DB required");
    const request={status:"WAITING",kind:"NATIVE_MIGRATION_CONSENT",pid:child.pid,
      created:current.created,source,sourceSha256:sha(source),requestedAt:new Date().toISOString(),
      completion:path.join(out,"native-migration-completed.json")};
    fs.writeFileSync(path.join(out,"computer-use-migration-request.json"),JSON.stringify(request,null,2),{flag:"wx"});
    console.log("COMPUTER_USE_MIGRATION",JSON.stringify(request));
    await until(()=>fs.existsSync(request.completion),"real native migration consent receipt",600000);
    const consent=read(request.completion);
    assert.equal(consent.pid,child.pid);assert.equal(consent.method,"Computer Use native Yes");
    const decision="C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/database-migration-decision.json";
    await until(()=>fs.existsSync(decision),"actual native decision file",30000);
    const value=read(decision);assert.equal(value.approved,true);
    assert(value.sources.some(p=>path.resolve(p)===path.resolve(source)));
    assert.equal(sha(source),request.sourceSha256);
    fs.copyFileSync(decision,path.join(out,"actual-native-migration-decision.json"),fs.constants.COPYFILE_EXCL);
    report.migration={request,consent,decision:value};save();
  }`);
one('async function saveProject(label){',`async function saveProject(label){
  if(current.version==="1.7.1"){
    const pending=page.waitForEvent("download");
    await page.getByRole("button",{name:"保存工程",exact:true}).click();
    const download=await pending;assert.equal(await download.failure(),null);
    const retained=path.join(out,label+".vnproj");await download.saveAs(retained);
    const project=JSON.parse(fs.readFileSync(retained,"utf8"));
    assert.equal(project.title,"Editor跨代1924临时工程");
    report.legacyDownload={path:retained,sha256:sha(retained),format:"actual 1.7.1 JSON download"};save();
    return snapshot();
  }`);
one('await launch("old","1.9.22");','await launch("old","1.7.1");');
one('await page.getByRole("button",{name:"选项",exact:true}).click();await A.settleEditor(page);',
    'await page.getByRole("button",{name:"工具 / 设置",exact:true}).click();await A.settleEditor(page);');
one('.fill("Editor升级1924临时工程")','.fill("Editor跨代1924临时工程")');
one(`await page.getByRole("textbox",{name:"项目作者",exact:true}).fill("隔离真实升级验收");
      await page.getByRole("button",{name:"编辑",exact:true}).click();await A.settleEditor(page);`,
    `await page.getByRole("textbox",{name:"项目作者",exact:true}).fill("隔离真实升级验收");
      await page.getByRole("button",{name:"工具 / 设置",exact:true}).click();await A.settleEditor(page);
      await page.getByRole("textbox",{name:/^场景摘要(?: 场景摘要)?$/}).fill("真实旧版1.7.1跨代保留正文与场景");`);
one(`    await step("old-native-Windows-check-and-cache-reuse",async()=>{
      oldCache=await checkEnvironment("old-first");const repeated=await checkEnvironment("old-repeat",true);
      assert.equal(repeated.result.cacheHit,true);assert.equal(repeated.cache,oldCache.cache);
      await closeNormally("old");return {first:oldCache,repeated};
    });`, `    await step("old-install-local-database-after-attributed-stop-NOT-normal-close",async()=>{
      const prior="F:/AgentVN/QA/Editor-Cross-1924-20261025-02/old-close-completed.json";
      const observed=read(prior);assert.equal(observed.status,"FAILED");
      report.oldNativeClose={status:"FAILED",prior,sha256:sha(prior),normalClose:false};
      await forceCleanup();
      const database=path.join(install,"data/backend/vn_engine.db");assert(fs.existsSync(database));
      const retained=path.join(out,"old-install-local.db");
      fs.copyFileSync(database,retained,fs.constants.COPYFILE_EXCL);
      report.legacyDatabase={path:database,backup:retained,sha256:sha(database)};
      assert.equal(sha(retained),report.legacyDatabase.sha256);save();
      return report.legacyDatabase;
    });`);
one(`      const fresh=await checkEnvironment("new-first");assert.notEqual(fresh.result.cacheHit,true);
      assert.notEqual(fresh.cache,oldCache.cache);
      const repeated=await checkEnvironment("new-repeat",true);assert.equal(repeated.result.cacheHit,true);assert.equal(repeated.cache,fresh.cache);
      await page.getByRole("button",{name:"关闭发布与打包",exact:true}).click();`,
    `      const summary=page.getByRole("textbox",{name:/^场景摘要(?: 场景摘要)?$/});
      await page.locator('.react-flow__node[data-id="node_scene_opening"]').getByText("开场",{exact:true}).click();
      await summary.fill("实际跨代后新保存1.9.24");
      baseline.graph.nodes.find(n=>n.id==="node_scene_opening").data.scene.summary="实际跨代后新保存1.9.24";
      const fresh={migration:report.migration},repeated={notRun:"Cache already separately accepted"};`);
one('const cached=await checkEnvironment("new-restart");assert.equal(cached.result.cacheHit,true);',
    'const cached={migrationDecisionUnchanged:sha(path.join(out,"actual-native-migration-decision.json"))};\n      assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/database-migration-decision.json"),cached.migrationDecisionUnchanged);');
source=source.replaceAll('assert.deepEqual(comparable(await snapshot()),comparable(baseline));',
    'retainedFields(comparable(await snapshot()),comparable(baseline));');
one('assert.deepEqual(comparable(saved),comparable(baseline));','retainedFields(comparable(saved),comparable(baseline));');
one('await shot("new-preserved");await closeNormally("new");',
    'await shot("new-preserved");await closeNormally("new");\n      fs.copyFileSync("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db",path.join(out,"new-shared.db"),fs.constants.COPYFILE_EXCL);');
one('await closeNormally("restart");return cached;',
    'await shot("restart-preserved");await closeNormally("restart");return cached;');
one('    command("Prepare");prepared=true;save();',
    '    command("Prepare");prepared=true;save();\n    fs.copyFileSync(__filename,path.join(out,"cross-driver.cjs"),fs.constants.COPYFILE_EXCL);');
one('  console.log("PASS: project preservation oracle, exact PS boundaries; no product launch");',
    `  const before={id:"a",nodes:[{id:"n",data:{text:"保留",value:0}}],edges:[]};
  retainedFields({...before,newDefault:true},before);
  for(const mutate of [p=>p.id="b",p=>p.nodes[0].data.text="丢失",
    p=>delete p.nodes[0].data.value,p=>p.nodes.push({id:"extra"}),p=>p.edges.push({id:"e"})]){
    const changed=structuredClone(before);mutate(changed);
    assert.throws(()=>retainedFields(changed,before));
  }
  console.log("PASS: legacy data preservation including five rejected changes, native PS boundaries; no product launch");`);
const filename=path.join(__dirname,"candidate-1924-editor-cross-derived.cjs");
const compiled=new vm.Script("(function(require,module,exports,__filename,__dirname){"+source+"\n})",{filename});
compiled.runInThisContext()(createRequire(filename),module,module.exports,__filename,__dirname);
