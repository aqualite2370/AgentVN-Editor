"use strict";
const assert=require("node:assert/strict");
function ownedProcessTree(rows,rootPid,expectedCreated){
  const roots=rows.filter(p=>p.ProcessId===rootPid&&(!expectedCreated||p.Created===expectedCreated));
  if(!roots.length)return[];
  assert.equal(roots.length,1,"A process snapshot must identify one exact root");
  const created=p=>{assert(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/.test(p.Created),"Exact UTC creation identity required");return p.Created;};
  const owned=new Map([[rootPid,roots[0]]]);created(roots[0]);
  let changed=true;
  while(changed){
    changed=false;
    for(const p of rows){
      if(owned.has(p.ProcessId))continue;
      const parent=owned.get(p.ParentProcessId);
      // Windows retains the creator PID, not a live parent handle. An older
      // orphan can name a PID that is now a completely different new process.
      if(parent&&created(p)>=created(parent)){owned.set(p.ProcessId,p);changed=true;}
    }
  }
  return[...owned.values()];
}
module.exports={ownedProcessTree};
