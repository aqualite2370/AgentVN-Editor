"use strict";
// Harmless reproduction of Rust's PowerShell argument transport; never enumerates or kills processes.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {spawnSync}=require("node:child_process"),crypto=require("node:crypto");
const root=path.resolve(__dirname,".."),out=path.resolve(process.argv[2]||"");
assert(out.startsWith("F:\\AgentVN\\QA\\Native-Dev-Preview-20261020-01\\")&&!fs.existsSync(out));
fs.mkdirSync(out);
const source=path.join(root,"editor/src-tauri/src/main.rs"),text=fs.readFileSync(source,"utf8");
const block=text.slice(text.indexOf("fn kill_gamecli_preview_by_cartridge("),text.indexOf("fn close_gamecli_preview_process("));
assert(block.includes('.args(["-NoProfile", "-Command", script])'));
assert(block.includes(".arg(cartridge_path.to_string_lossy().to_string())"));
const script=block.match(/let script = r#"([\s\S]*?)"#;/)[1];
const prefix=script.slice(0,script.indexOf("Get-CimInstance")).trim();
assert.equal(prefix,"$needle = $args[0]");
const harmless=prefix+'\n[Console]::WriteLine("QA_ARGS="+$args.Count+";NEEDLE="+$needle)\n';
assert(!/Stop-Process|Get-CimInstance/.test(harmless));
const result=spawnSync("powershell.exe",["-NoProfile","-Command",harmless,out],
  {windowsHide:true,encoding:"utf8",timeout:15000});
const report={status:"RUNNING",at:new Date().toISOString(),expected:"REPRODUCE_ARGUMENT_NOT_BOUND",
  scope:"Harmless same argument transport and exact source prefix; no process enumeration/termination",
  source:{path:source,sha256:crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex")},
  arguments:["-NoProfile","-Command",harmless,out],exitCode:result.status,stdout:result.stdout,stderr:result.stderr,
  productChanged:false,processStopCalled:false};
try{
  assert.match(result.stdout,/QA_ARGS=0;NEEDLE=/);
  assert.match(result.stderr,/CommandNotFoundException/);
  assert.notEqual(result.status,0);
  report.status="DEFECT_REPRODUCED";console.log("DEFECT_REPRODUCED: path executes as command, needle is empty; no Stop-Process called");
}catch(e){report.status="FAILED";report.error=String(e.stack||e);process.exitCode=1;}
fs.copyFileSync(__filename,path.join(out,"executed-test.cjs"),fs.constants.COPYFILE_EXCL);
fs.writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2),{flag:"wx"});
