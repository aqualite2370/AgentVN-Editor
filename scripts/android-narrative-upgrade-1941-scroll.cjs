"use strict";
// Continue the same real APK pair after a retained QA failure. Scroll via ADB,
// never by assigning scrollTop, invoking DOM clicks or changing preferences.
const fs = require("node:fs"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const parent = require.resolve("./android-narrative-upgrade-1941.cjs");
function replaceOne(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, "Preserved QA seam");
  return source.replace(before, after);
}
function adapter() {
  let source = fs.readFileSync(parent, "utf8");
  const before = '    await tap(control, "old enable high contrast");';
  const scroll = `    r.controlScroll = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const geometry = await c.client().evaluate(\`(() => {
        const e=document.querySelector('input[aria-label="High contrast text"]');
        if(!e) return null;
        const b=e.getBoundingClientRect();
        let p=e.parentElement;
        while(p && !(p.scrollHeight>p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY)))
          p=p.parentElement;
        if(!p) return {visible:false,missingScroller:true};
        const s=p.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;
        return {visible:y>=s.top && y<s.bottom && document.elementFromPoint(x,y)===e,
          top:p.scrollTop,height:p.scrollHeight,client:p.clientHeight,
          x:s.x+s.width*.5,start:s.y+s.height*.78,end:s.y+s.height*.22,
          width:innerWidth,viewportHeight:innerHeight};
      })()\`);
      assert(geometry && !geometry.missingScroller);
      if (geometry.visible) break;
      assert(attempt<3,"High contrast must become reachable through bounded real scrolling");
      const x=Math.round(geometry.x*r.physical.width/geometry.width);
      const y1=Math.round(geometry.start*r.physical.height/geometry.viewportHeight);
      const y2=Math.round(geometry.end*r.physical.height/geometry.viewportHeight);
      cmd(["shell","input","swipe",String(x),String(y1),String(x),String(y2),"360"]);
      await state(\`(() => {const e=document.querySelector(".settings-content");
        return Boolean(e && e.scrollTop>\${geometry.top});})()\`);
      r.controlScroll.push({attempt:attempt+1,before:geometry,input:{x,y1,y2,duration:360}});
      c.save();
    }
${before}`;
  const injection = "\n  source = one(source, " + JSON.stringify(before) + ", " + JSON.stringify(scroll) + ");\n";
  const seam = "  const worker = new Module(file, module); worker.filename = file; worker.paths = module.paths;\n" +
    "  Object.assign(worker, { currentPair: pair";
  source = replaceOne(source, '  s = one(s, "n + 6", "n + 7");',
    '  s = one(s, "n + 6", "n + 7");\n' +
    '  s = one(s, ' + JSON.stringify(seam) + ", " + JSON.stringify(injection + seam) + ");\n" +
    '  s = one(s, \'return ["android-narrative-upgrade-1940.cjs",\', ' +
    '\'return ["android-narrative-upgrade-1941.cjs", "android-narrative-upgrade-1940.cjs",\');');
  source = replaceOne(source, 'module.exports = { run: (...a) => adapter().run(...a) };',
    "module.exports = { adapter, run: (...a) => adapter().run(...a) };");
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  new vm.Script(Module.wrap(source)); worker._compile(source, __filename);
  return worker.exports.adapter();
}
module.exports = { run: (...args) => adapter().run(...args) };
if (require.main === module) Promise.resolve().then(() => {
  const [action, arg, number] = process.argv.slice(2), tool = adapter();
  if (action === "self-test") return tool.selfTest();
  if (action === "prepare") return tool.prepare(arg);
  if (action === "audit") return tool.audit(arg, number);
  assert.equal(action, "launch"); return tool.launch(arg);
}).then(result => { if (result) console.log(JSON.stringify(result)); })
  .catch(error => { console.error(error); process.exitCode = 1; });
