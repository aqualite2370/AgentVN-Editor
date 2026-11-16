"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), ts = require("../editor/node_modules/typescript");
const root = path.resolve(__dirname, ".."), file = path.join(root, "editor/src/utils/autoArrangeGraph.ts");
const sandbox = { exports: {}, require };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, sandbox, { filename: file });
const { computeAutoArrangeLayout: arrange } = sandbox.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const node = (id, kind, x, y, width, height) => ({ id, type: kind + "Node", position: { x, y },
  ...(width ? { measured: { width, height } } : {}),
  data: { nodeKind: kind, label: id, scene: kind === "scene" ? {
    scene_id: id, commands: [{ type: "narration", text: id + " content" }],
  } : undefined } });
const report = { status: "RUNNING", cases: [], source: file };
const checks = [
  ...[200,260,300,600].map(width => ({ name: "measured-width-" + width,
    nodes: [node("start","start",40,200,width,72),node("scene","scene",540,350,width,209)],
    edges: [{ id:"e", source:"start", target:"scene" }] })),
  { name:"unmeasured", nodes:[node("start","start",40,200),node("scene","scene",540,350)],
    edges:[{id:"e",source:"start",target:"scene"}] },
  { name:"negative-fractional-origin", nodes:[node("start","start",-75.25,200,260,72),
    node("scene","scene",540,350,260,209)], edges:[{id:"e",source:"start",target:"scene"}] },
  { name:"branch-and-disconnected", nodes:[node("start","start",40,200,260,72),
    ...Array.from({length:15},(_,i)=>node("s"+i,"scene",i*400,450,260+(i%3)*40,209))],
    edges:Array.from({length:5},(_,i)=>({id:"e"+i,source:"start",target:"s"+i,sourceHandle:"choice-"+i})) },
  { name:"empty", nodes:[],edges:[] },
];
for (const test of checks) {
  const row = { name:test.name, status:"RUNNING" }; report.cases.push(row);
  try {
    const before = plain(test), first = arrange(test.nodes,test.edges);
    assert.deepEqual(plain(test),before,"Layout computation must not mutate content/connections");
    let nodes = test.nodes.map(n=>({...n,position:first.positions[n.id]}));
    for(let count=0;count<5;count++){
      const next = arrange(nodes,test.edges);
      assert.equal(next.movedCount,0,"Repeated arrange must not drift or create another graph operation");
      assert.deepEqual(plain(next.positions),plain(first.positions),"Stable dimensions yield identical positions");
      nodes=nodes.map(n=>({...n,position:next.positions[n.id]}));
    }
    row.positions=plain(first.positions);row.repeatCount=5;row.status="PASS";
  } catch(error) { row.status="FAILED";row.error=error.stack; }
}
report.status=report.cases.every(c=>c.status==="PASS")?"PASS":"FAILED";
if(process.argv[2])fs.writeFileSync(path.resolve(process.argv[2]),JSON.stringify(report,null,2),{flag:"wx"});
console.log(JSON.stringify(report,null,2));
if(report.status!=="PASS")process.exitCode=1;
