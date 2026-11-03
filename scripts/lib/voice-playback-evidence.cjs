"use strict";
const assert=require("node:assert/strict");
// Audit the immutable observations; never fill missing fields in original data.
function validateVoiceCommandOwnership(cell,fixture){
  const q=cell.audio;assert(q&&q.calls.length===12);
  const first=q.calls[0],snapshot=cell.checks[0]?.detail;
  assert.equal(first.id,1);assert.equal(first.settlement,"resolved");
  assert.equal(snapshot.state.command,0);assert.equal(snapshot.state.scene,"voice_restore");
  assert.equal(snapshot.state.mode,"dialog");
  assert(snapshot.state.text.includes(fixture.voice.dialogs[0].text));
  assert.equal(snapshot.count,1);assert.equal(snapshot.bytes.sha256,fixture.voice.sha256);
  const preMount=first.command===undefined&&first.scene===undefined;
  if(!preMount){assert.equal(first.command,"0");assert.equal(first.scene,"voice_restore")}
  // At start, RuntimeAudio can commit before the animated playing DOM exists.
  // The runner asserts zero plays on title, then uses the real Start button.
  // Link that single playback to the first committed command snapshot and the
  // fetched WAV bytes. Every later invocation retains strict DOM attribution.
  assert.deepEqual(q.calls.slice(1).map(c=>Number(c.command)),[1,1,2,3,4,4,5,6,7,7,8]);
  assert(q.calls.slice(1).every(c=>c.scene==="voice_restore"));
  assert(q.calls.every(c=>c.source===first.source&&c.settlement==="resolved"));
  assert(q.calls.every((c,i)=>c.id===i+1));
  return {initialAssociation:preMount?"REAL_START_ACTION_AND_FIRST_COMMITTED_SNAPSHOT":"CALL_SITE_DOM",
    initialCallSiteDomAvailable:!preMount,strictLaterDomCalls:11,sourceSha256:snapshot.bytes.sha256};
}
module.exports={validateVoiceCommandOwnership};
