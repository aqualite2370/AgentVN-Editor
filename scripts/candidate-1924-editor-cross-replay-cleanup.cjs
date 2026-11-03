"use strict";
// Remove only the unintended source backup created by replay-01. Keep the
// original DB and the failed replay evidence, and retain the backup bytes in F.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {sha256}=require("./lib/installed-acceptance.cjs");
const {rows}=require("./lib/current-native-editor-session.cjs");
const root="F:/AgentVN/QA/Editor-Cross-1924-20261025-continuation-01";
const hash=f=>sha256(fs.readFileSync(f));
const record=JSON.parse(fs.readFileSync(root+"/data/backend/database-migration-record.json","utf8"));
const source="C:\\Users\\1\\AppData\\Local\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Roaming\\com.agentvn.editor\\backend\\vn_engine.db";
const backup=source+".agentvn-backup-2026-10-25T061511.888526-0000";
assert.deepEqual(record.sources,[source]);assert(record.backups.includes(backup));
assert.equal(hash(source),record.fingerprints[source]);assert.equal(hash(backup),hash(source));
assert(!rows().some(p=>/^(agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
const target=path.join(root,"unintended-source-backup.db");
fs.copyFileSync(backup,target,fs.constants.COPYFILE_EXCL);assert.equal(hash(target),record.fingerprints[source]);
fs.unlinkSync(backup);assert(!fs.existsSync(backup));assert.equal(hash(source),record.fingerprints[source]);
const result={status:"PASS",at:new Date().toISOString(),source,sourceUnchanged:true,removed:backup,
  retained:target,sha256:hash(target),bytes:fs.statSync(target).size,deletedUserFiles:0,
  limitation:"replay-01 copied an approved migration decision and thereby discovered the original default DB; replay failed and is not acceptance"};
fs.writeFileSync(root+"/source-backup-cleanup-01.json",JSON.stringify(result,null,2),{flag:"wx"});
console.log(JSON.stringify(result));
