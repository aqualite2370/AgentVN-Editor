const fs=require('fs');const path=require('path');
const root=path.resolve(__dirname,'..');
function assert(c,m){if(!c) throw new Error(m)}
function read(p){return fs.readFileSync(path.join(root,p),'utf8')}
const files={
 commands: read('editor/src/types/commands.ts'),
 runtimeCommands: read('GameCli_framework/src/types/commands.ts'),
 nodes: read('editor/src/types/nodes.ts'),
 exportScript: read('editor/src/utils/exportScript.ts'),
 story: read('GameCli_framework/src/engine/StoryEngine.ts'),
 vars: read('GameCli_framework/src/engine/runtimeVariables.ts'),
 nodeFactory: read('editor/src/utils/nodeFactory.ts'),
 palette: read('editor/src/components/editor/NodePalette.tsx'),
 loopNode: read('editor/src/components/nodes/LoopNode.tsx'),
 commandTools: read('editor/src/utils/commandTools.ts'),
 inspector: read('editor/src/components/editor/InspectorPanel.tsx'),
};
assert(files.commands.includes('export interface JumpCommand'), 'editor command type exposes JumpCommand');
assert(files.runtimeCommands.includes('export interface JumpCommand'), 'runtime command type exposes JumpCommand');
assert(files.nodes.includes('| "loop"') && files.nodes.includes('export interface LoopData'), 'loop node data is typed');
assert(files.nodeFactory.includes('createLoopNode') && files.palette.includes('kind: "loop"') && files.loopNode.includes('Handle id="loop"'), 'loop node is creatable and rendered');
assert(files.nodeFactory.includes('operator: "less_or_equal", value: 3') && files.loopNode.includes('每次回到这里：') && files.loopNode.includes('loop-node-exit-labels'), 'loop defaults and node card explain three-pass behavior');
assert(files.exportScript.includes('function loopCommands') && files.exportScript.includes('operation: "set_if_unset"') && files.exportScript.includes('sourceHandle === trueHandle'), 'loop exports to state updates and branch handles');
assert(files.commandTools.includes('"jump"') && files.story.includes('case "jump"'), 'jump command is exposed and executed');
assert(files.vars.includes('case "set_if_unset"'), 'loop initialization is idempotent');
assert(files.inspector.includes('activeNode.data.nodeKind === "loop"') && files.inspector.includes('重复 3 次（推荐）') && files.inspector.includes('让一段剧情重复执行') && files.inspector.includes('copyVariant="beginner-loop"'), 'beginner-friendly guided loop inspector is present');
console.log('PASS loop/jump contract');
