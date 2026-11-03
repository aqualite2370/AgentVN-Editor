const fs=require('fs');const path=require('path');
const {saveProjectContainerSync}=require('./project-container.cjs');
const now=new Date().toISOString();
const aiSettings={authorGoal:'循环/跳转示例',generationOutline:'',autoExtractMemory:false,autoApplyMemory:false};
const meta={collapsedInspectorSections:[],source:'manual'};
const base=(nodeKind,label,description)=>({nodeKind,label,description,memoryMode:'hybrid',aiSettings:{...aiSettings},previewState:{currentCommandIndex:0,isPlaying:false},editorMeta:{...meta}});
const scene=(id,x,y,title,summary,commands,tags=[])=>({id:`node_${id}`,type:'sceneNode',position:{x,y},data:{...base('scene',title,summary),scene:{scene_id:id,title,summary,commands,tags,chapter:1}}});
const nodes=[
 {id:'start',type:'startNode',position:{x:40,y:260},data:{...base('start','入口','循环示例入口'),loadingAnimation:{kind:'default'}}},
 scene('scene_intro',320,220,'循环示例入口','选择战斗循环或搜寻循环。',[{type:'narration',text:'这是 AgentVN 循环节点与直接跳转事件示例。'},{type:'choice',choices:[{choice_id:'battle',choice_display_name:'战斗胜利循环',text:'进入战斗循环（胜利演示）',target_scene_id:'scene_battle_start',conditions:[]},{choice_id:'battle_lose',choice_display_name:'战斗失败循环',text:'进入战斗循环（失败演示）',target_scene_id:'scene_battle_start_hard',conditions:[]},{choice_id:'search',choice_display_name:'搜寻物品',text:'进入搜寻物品循环',target_scene_id:'scene_search_start',conditions:[]}]}],['example','loop']),
 scene('scene_battle_start',680,60,'战斗开始','初始化战斗变量：玩家有足够 HP，可击败敌人。',[{type:'state_update',key:'enemy_hp',operation:'set',value:3,value_type:'number'},{type:'state_update',key:'hero_hp',operation:'set',value:4,value_type:'number'},{type:'jump',target_scene_id:'loop_loop_battle'}],['battle']),
 scene('scene_battle_start_hard',680,260,'危险战斗开始','初始化战斗变量：玩家 HP 较低，会进入失败分支。',[{type:'state_update',key:'enemy_hp',operation:'set',value:3,value_type:'number'},{type:'state_update',key:'hero_hp',operation:'set',value:1,value_type:'number'},{type:'jump',target_scene_id:'loop_loop_battle'}],['battle']),
 {id:'loop_battle',type:'loopNode',position:{x:1020,y:60},data:{...base('loop','战斗回合循环','每轮造成伤害并判断是否继续。'),loop:{variableKey:'turn',initialValue:0,step:1,continueCondition:{key:'enemy_hp',operator:'greater_than',value:0},loopLabel:'敌人未倒下',exitLabel:'战斗结束'}}},
 scene('scene_battle_round',1360,20,'战斗回合','玩家攻击，敌人反击。',[{type:'narration',text:'你挥剑攻击，敌人也发起反击。'},{type:'state_update',key:'enemy_hp',operation:'subtract',value:1,value_type:'number'},{type:'state_update',key:'hero_hp',operation:'subtract',value:1,value_type:'number'},{type:'conditional_jump',condition:{key:'hero_hp',operator:'less_or_equal',value:0},target_scene_id:'scene_battle_lose',else_target_scene_id:'loop_loop_battle'}],['battle']),
 scene('scene_battle_win',1360,220,'战斗胜利','敌人 HP 归零，跳出循环。',[{type:'narration',text:'敌人倒下了，你赢得战斗。'}],['battle','ending']),
 scene('scene_battle_lose',1360,420,'战斗失败','主角 HP 归零。',[{type:'narration',text:'你体力耗尽，只能暂时撤退。'}],['battle','ending']),
 scene('scene_search_start',680,520,'搜寻开始','初始化搜寻变量。',[{type:'state_update',key:'search_count',operation:'set',value:0,value_type:'number'},{type:'state_update',key:'found_key',operation:'set',value:false,value_type:'boolean'},{type:'jump',target_scene_id:'loop_loop_search'}],['search']),
 {id:'loop_search',type:'loopNode',position:{x:1020,y:520},data:{...base('loop','搜寻次数循环','最多搜索三次，找到钥匙后退出。'),loop:{variableKey:'search_count',initialValue:0,step:1,continueCondition:{key:'found_key',operator:'falsy'},loopLabel:'继续搜寻',exitLabel:'找到物品'}}},
 scene('scene_search_room',1360,520,'调查房间','根据搜索次数找到钥匙或继续。',[{type:'narration',text:'你翻找抽屉、书架和地毯边缘。'},{type:'conditional_jump',condition:{key:'search_count',operator:'greater_or_equal',value:3},target_scene_id:'scene_found_key',else_target_scene_id:'loop_loop_search'}],['search']),
 scene('scene_found_key',1680,520,'找到钥匙','搜寻循环结束。',[{type:'state_update',key:'found_key',operation:'set',value:true,value_type:'boolean'},{type:'narration',text:'第三次搜索时，你在地毯下找到了铜钥匙。'}],['search','ending'])
];
const edges=[
 {id:'edge_start_intro',source:'start',target:'node_scene_intro',sourceHandle:'default'},
{id:'edge_intro_battle',source:'node_scene_intro',target:'node_scene_battle_start',sourceHandle:'battle'},
 {id:'edge_intro_battle_lose',source:'node_scene_intro',target:'node_scene_battle_start_hard',sourceHandle:'battle_lose'},
{id:'edge_intro_search',source:'node_scene_intro',target:'node_scene_search_start',sourceHandle:'search'},
{id:'edge_battle_start_loop',source:'node_scene_battle_start',target:'loop_battle',sourceHandle:'default'},
 {id:'edge_battle_start_hard_loop',source:'node_scene_battle_start_hard',target:'loop_battle',sourceHandle:'default'},
{id:'edge_loop_battle_round',source:'loop_battle',target:'node_scene_battle_round',sourceHandle:'loop'},
 {id:'edge_loop_battle_win',source:'loop_battle',target:'node_scene_battle_win',sourceHandle:'exit'},
 {id:'edge_search_start_loop',source:'node_scene_search_start',target:'loop_search',sourceHandle:'default'},
 {id:'edge_loop_search_room',source:'loop_search',target:'node_scene_search_room',sourceHandle:'loop'},
 {id:'edge_loop_search_found',source:'loop_search',target:'node_scene_found_key',sourceHandle:'exit'}
];
const project={schema_version:'1.0.0',project_id:'loop_jump_example',title:'循环与跳转示例：战斗和搜寻',author:'AgentVN',nodes,edges,viewport:{x:0,y:0,zoom:0.75},memory_mode:'hybrid',asset_manifest:[],editor_settings:{},created_at:now,updated_at:now};
const out=path.join(__dirname,'..','data','examples');fs.mkdirSync(out,{recursive:true});saveProjectContainerSync(path.join(out,'loop-jump-example.vnproj'),project,{container:'zip'});
console.log(path.join(out,'loop-jump-example.vnproj'));
