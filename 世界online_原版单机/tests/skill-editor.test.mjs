// 技能编辑器（技能编辑器.html）与技能效果覆盖层的验收。
//
// 这里守三件事：
//   1. 编辑器是**离线单文件**：不依赖本地服务、不引用外部资源，双击能开。
//   2. 编辑器里那份 wire 编码器与服务端 lib/character-import-codec.mjs 的 skillBytes()
//      **逐字节一致** —— 不然编辑器预览的字节数是骗人的，改完打包也可能对不上。
//   3. 覆盖层支持「逐级不同值」，并且能作用到装备自带技能 / 叠加等级（不只是人物技能）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {skillBytes} from '../lib/character-import-codec.mjs';
import {buildLabels} from '../tools/build-skill-editor-data.mjs';
import {applyOverrideToDefinition,applyOverrideToDefinitions,hasSkillOverride,compileOverrideRule,applyRuleToLevels,applyRuleToDefinitions,OVERRIDABLE_FIELDS,dropStaleEffectLines} from '../lib/local-skill-overrides.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const EDITOR=path.join(root,'技能编辑器.html');
const hasEditor=fs.existsSync(EDITOR);
const skip={skip:hasEditor?false:'没有 技能编辑器.html，跳过'};

function editorHtml(){return fs.readFileSync(EDITOR,'utf8');}

/** 从 HTML 里取 CODEC 区段，放进沙箱执行，拿到浏览器版编码器。 */
function browserCodec(){
 const hit=editorHtml().match(/\/\/<<<CODEC-START>>>([\s\S]*?)\/\/<<<CODEC-END>>>/);
 assert.ok(hit,'技能编辑器.html 里必须有 CODEC 标记区段');
 const sandbox={btoa};
 vm.createContext(sandbox);
 vm.runInContext(hit[1],sandbox);
 assert.equal(typeof sandbox.skillBytesBrowser,'function','要导出 skillBytesBrowser');
 return sandbox;
}

test('技能编辑器是离线单文件：没有外链资源、没有本地服务依赖',skip,()=>{
 const html=editorHtml();
 assert.ok(html.startsWith('<!DOCTYPE html>'),'要是完整 HTML');
 for(const bad of ['http://','https://','//cdn','<link','src="http','fetch(']){
  assert.ok(!html.includes(bad),'离线可用，不能出现 '+bad);
 }
 assert.ok(html.includes('<script id="game-labels" type="application/json">'),'要内嵌游戏标签表');
 assert.ok(html.includes('showDirectoryPicker'),'支持直接写入 data/ 目录');
 // 内嵌标签表必须是合法 JSON
 const labels=JSON.parse(html.match(/<script id="game-labels"[^>]*>([\s\S]*?)<\/script>/)[1]);
 assert.ok(Object.keys(labels.powers).length>150,'效果编号表要够全，实际 '+Object.keys(labels.powers).length);
 assert.ok(labels.buffers.length>=30,'状态名表要够全，实际 '+labels.buffers.length);
 assert.ok(labels.powers['61'].n==='劈砍防御力','61 号效果名为劈砍防御力');
 assert.equal(labels.buffers[1],'中毒','1 号状态名为中毒');
 // 技能参数的四张下拉表（编辑器里一律显示中文，不显示写入值）
 assert.equal(labels.skillTypes[3],'主动','3 号技能类型是主动');
 assert.equal(labels.skillWeapons[0],'无限制','0 号武器限制是无限制');
 assert.equal(labels.skillWeapons[18],'空手','18 号武器限制是空手');
 assert.equal(labels.skillWeapons[29],'扇','29 号武器限制是扇');
 assert.equal(labels.skillAtkTypes[2],'近身穿刺','2 号攻击方式是近身穿刺');
 assert.equal(labels.skillAtkTypes[6],'祝福','6 号攻击方式是祝福');
 assert.equal(labels.skillAreas[10],'敌单体','10 号作用范围是敌单体');
 assert.equal(labels.skillAreas[30],'自身','30 号作用范围是自身');
 assert.ok(labels.skillAreas.length>=33,'作用范围文案表要够全');
 assert.equal(labels.skillPositions[0],'原地','0 号站位是原地');
 assert.equal(labels.skillPositions[1],'目标身前','1 号站位是目标身前');
 // 怪物自带技能（内嵌清单 + 等级定义）
 const monsters=labels.monsters||{};
 assert.ok(Object.keys(monsters).length>=200,'内嵌的怪物技能太少，实际 '+Object.keys(monsters).length);
 const reverse=monsters['550'];
 assert.ok(reverse&&reverse.name==='反魔力场','550 应当是怪物技能「反魔力场」');
 assert.equal(reverse.type,3,'反魔力场是主动技能');
 assert.ok(reverse.levels[0].power1>0&&reverse.levels[0].statusBit1>=0,'带完整等级定义，可直接编辑');
 assert.ok(monsters['6137'],'6137 应当是怪物技能');
 assert.ok(reverse.levels[0].skillAtkType!==undefined,'怪物技能定义要带主动参数');
 // 界面上不能再出现「编号 + 名称」这种混排
 const main=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 assert.ok(!main.includes('id+" · "+info.n'),'效果下拉不要带编号前缀');
 assert.ok(!main.includes('i+" · "+name'),'状态下拉不要带编号前缀');
 assert.ok(main.includes('MONSTER_SKILLS'),'编辑器要读内嵌的怪物技能清单');
 assert.ok(main.includes('"monster"'),'要有 monster 来源标记');
});

test('编辑器主脚本语法正确',skip,()=>{
 const html=editorHtml();
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 assert.ok(scripts.length===1,'应当只有一段主脚本');
 assert.doesNotThrow(()=>new vm.Script(scripts[0]),'主脚本必须能编译通过');
});

test('内嵌的效果/参数文案表与当前游戏数据一致',skip,()=>{
 const hasGame=fs.existsSync(path.join(root,'client','js','ff'))
  &&fs.existsSync(path.join(root,'analysis','modules','0004.js'));
 if(!hasGame)return;   // client/ 与 analysis/ 不入库，缺失就跳过
 const labels=buildLabels();
 const embedded=JSON.parse(editorHtml().match(/<script id="game-labels"[^>]*>([\s\S]*?)<\/script>/)[1]);
 for(const key of ['powers','buffers','skillTypes','skillWeapons','skillAtkTypes','skillAreas','skillPositions','monsters']){
  assert.deepEqual(embedded[key],labels[key],
   `内嵌的 ${key} 与游戏数据不一致 —— 跑 node tools/build-skill-editor-data.mjs 重新生成`);
 }
});

test('内嵌的效果名全部是中文：压缩包里 return"..."（无空格）的分支也要取到官方文案',skip,()=>{
 const labels=JSON.parse(editorHtml().match(/<script id="game-labels"[^>]*>([\s\S]*?)<\/script>/)[1]);
 const english=Object.entries(labels.powers).filter(([,v])=>!/[\u4e00-\u9fa5]/.test(String(v.n||'')));
 assert.deepEqual(english,[],'这些效果名还是英文常量，请在 tools/build-skill-editor-data.mjs 的 MANUAL_FIX 里补中文：'
  +english.map(([id,v])=>id+'='+v.n).join(', '));
 // 曾经因为只匹配 `return `（带空格）而退回英文的几条
 assert.equal(labels.powers['79'].n,'清除目标状态');
 assert.equal(labels.powers['82'].n,'技能附带命中');
 assert.equal(labels.powers['97'].n,'复活并回复体力及法力');
 assert.equal(labels.powers['97'].p,true,'97 号是百分比');
 assert.ok(String(labels.powers['79'].note||'').includes('状态编号'),'79 号数值填的是状态编号，编辑器要提示');
});

test('技能列表按类型与职业筛选',skip,()=>{
 const html=editorHtml();
 assert.ok(html.includes('id="filter-type"'),'要有「类型」筛选下拉');
 assert.ok(html.includes('id="filter-profession"'),'要有「职业」筛选下拉');
 const main=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 assert.ok(main.includes('function skillTypeIds'),'类型筛选要按逐级 type 判定（同一技能可能逐级不同）');
 assert.ok(main.includes('state.filterProfession==="__none"'),'职业筛选要能单独看「未标职业」的装备/怪物技能');
});

test('怪物技能：覆盖会重算 monsterWireBase64（战斗包发的是它）',()=>{
 // 怪物技能的战斗包用的是 monsterWireBase64（official-packets.mapBattleData），
 // 它本是 wireBase64 的副本；只重算 wireBase64 的话怪物放的还是旧效果。
 const monster={id:550,level:1,name:'反魔力场',type:3,info:'',skillWeapon:0,
  power1:78,powerValue1:50,power2:0,powerValue2:0,power3:0,powerValue3:0,
  skillAtkType:6,area:20,round:1,atk_time:0,useMP:2000,useHP:0,anime1:1,anime2:1225,anime3:0,position:0,
  statusBit1:15,statusBit2:0,statusBit3:0};
 const wire=skillBytes(monster).toString('base64');
 const withMonster={...monster,wireBase64:wire,monsterWireBase64:wire};
 const rule=compileOverrideRule({levels:'all',set:{powerValue1:500,round:3}},'550');
 const [out]=applyRuleToLevels([withMonster],rule);
 assert.equal(out.powerValue1,500);
 assert.equal(out.round,3);
 const expected=skillBytes(out).toString('base64');
 assert.equal(out.wireBase64,expected,'wireBase64 要重算');
 assert.equal(out.monsterWireBase64,expected,'monsterWireBase64 必须一起重算，否则怪物放的还是旧效果');
 assert.notEqual(out.monsterWireBase64,wire);
 assert.equal(withMonster.monsterWireBase64,wire,'原始数据不能被就地修改');
});

test('怪物技能：official.skills 在服务端启动时被套用覆盖',()=>{
 const src=fs.readFileSync(path.join(root,'lib','official-data.mjs'),'utf8');
 const ensure=src.slice(src.indexOf('function ensure()'),src.indexOf('built={'));
 assert.ok(ensure.includes('applyOverrideToDefinition(skill.id,skill)'),
  'official-data 的 ensure() 里要对 official.skills 套覆盖 —— 怪物 AI 的技能定义就在这张表里');
 assert.ok(src.includes("from './local-skill-overrides.mjs'"),'要 import 覆盖层');
 // 战斗包确实发 monsterWireBase64||wireBase64
 const packets=fs.readFileSync(path.join(root,'lib','official-packets.mjs'),'utf8');
 assert.ok(packets.includes("s.monsterWireBase64||s.wireBase64"),'战斗包用的是 monsterWireBase64');
});

test('编辑器内嵌的 wire 编码器与服务端 skillBytes 逐字节一致',skip,()=>{
 const codec=browserCodec();
 const career=JSON.parse(fs.readFileSync(path.join(root,'data','career-skills.json'),'utf8'));
 let cases=0;
 for(const skill of career.skills.slice(0,60)){
  const picks=[skill.levels[0],skill.levels[skill.levels.length-1]].filter(Boolean);
  for(const level of picks){
   if(level.id!==skill.id)continue;
   const expected=skillBytes(level).toString('base64');
   const actual=codec.bytesToBase64(codec.skillBytesBrowser(level,false));
   assert.equal(actual,expected,`技能 ${skill.id} 等级 ${level.level} 的 wire 不一致`);
   cases++;
  }
 }
 assert.ok(cases>=80,'对拍样本太少（'+cases+'），说明数据没读到');
});

test('编辑器编码器对「装备技能定义」同样一致',skip,()=>{
 const codec=browserCodec();
 const file=path.join(root,'data','equipment-skill-levels.json');
 if(!fs.existsSync(file))return;
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 let cases=0;
 for(const skill of data.skills.slice(0,60)){
  for(const level of skill.levels){
   const expected=skillBytes(level).toString('base64');
   assert.equal(codec.bytesToBase64(codec.skillBytesBrowser(level,false)),expected,
     `装备技能 ${skill.id} 等级 ${level.level} 的 wire 不一致`);
   cases++;
  }
 }
 assert.ok(cases>0,'装备技能对拍样本为空');
});

const sample=(level,powers={})=>{
 const base={id:90001,level,name:'测试技',type:3,skillWeapon:0,info:'',skillAtkType:2,area:10,round:4,
  atk_time:1,useMP:10,useHP:0,anime1:0,anime2:0,anime3:0,position:1,
  power1:61,powerValue1:-100,statusBit1:0,power2:62,powerValue2:-100,statusBit2:0,power3:0,powerValue3:0,statusBit3:0,
  ...powers};
 base.wireBase64=skillBytes(base).toString('base64');
 return base;
};

test('覆盖层：set 按 levels 限定范围，未命中等级保持原样且不换对象',()=>{
 const levels=[sample(1),sample(2),sample(3)];
 const before=levels.map(l=>l.wireBase64);
 const rule=compileOverrideRule({levels:[2,3],set:{round:9}},'90001');
 const out=applyRuleToLevels(levels,rule);
 assert.equal(out[0],levels[0],'范围外的等级必须原样返回（引用都不变）');
 assert.equal(out[1].round,9);assert.equal(out[2].round,9);
 assert.equal(out[1].level,2,'等级自身字段不能被覆盖搞丢');
 assert.notEqual(out[1].wireBase64,before[1],'改了字段必须重算 wireBase64');
 assert.equal(levels[1].round,4,'不能污染原定义');
});

test('覆盖层：perLevel 逐级给不同值，且可与 set 叠加（perLevel 优先）',()=>{
 const levels=[sample(1),sample(2),sample(3)];
 const rule=compileOverrideRule({levels:'all',set:{useMP:99},perLevel:{'1':{useMP:1,round:5},'3':{round:7}}},'90001');
 const out=applyRuleToLevels(levels,rule);
 assert.equal(out[0].useMP,1);assert.equal(out[0].round,5);
 assert.equal(out[1].useMP,99);assert.equal(out[1].round,4,'perLevel 没列到的字段仍吃 set，没列到的等级保持原值');
 assert.equal(out[2].useMP,99);assert.equal(out[2].round,7);
});

test('覆盖层：powers 与 wireBase64 跟着 power/statusBit 一起重算',()=>{
 const level=sample(1);
 const rule=compileOverrideRule({levels:'all',set:{statusBit1:0,statusBit2:0,power1:0,powerValue1:0}},'437');
 const [out]=applyRuleToLevels([level],rule);
 assert.deepEqual(out.powers,[[62,-100]],'powers 要按 power1..3 重新拼');
 const decoded=skillBytes(out).toString('base64');
 assert.equal(out.wireBase64,decoded);
 assert.notEqual(out.wireBase64,level.wireBase64);
});

test('覆盖层：非法字段 / 非法等级被拒绝（编辑器写错也能当场发现）',()=>{
 assert.throws(()=>compileOverrideRule({levels:'all',set:{nope:1}},'x'),/不可覆盖字段/);
 assert.throws(()=>compileOverrideRule({levels:[0],set:{round:1}},'x'),/非法等级/);
 assert.throws(()=>compileOverrideRule({levels:'some',set:{round:1}},'x'),/levels 必须是/);
 assert.throws(()=>compileOverrideRule({levels:'all',perLevel:{'abc':{round:1}}},'x'),/必须是等级数字/);
 assert.throws(()=>compileOverrideRule({levels:'all'},'x'),/既没有 set 也没有 perLevel/);
 for(const field of ['round','area','power1','powerValue2','statusBit3','useMP','type','skillAtkType']){
  assert.ok(OVERRIDABLE_FIELDS.includes(field),field+' 应当可覆盖');
 }
});

test('覆盖层：data 里的 437 规则让飘雪穿云掌的削防不再挂在减益状态上',()=>{
 if(!hasSkillOverride(437))return;   // 本地没配这条规则就跳过
 const career=JSON.parse(fs.readFileSync(path.join(root,'data','career-skills.json'),'utf8'));
 const skill=career.skills.find(s=>s.id===437);
 assert.ok(skill,'career-skills.json 里应当有 437');
 const original=skill.levels[0];
 assert.equal(original.statusBit1,1,'原版把削劈砍防御押在中毒标签上');
 const [fixed]=applyRuleToLevels([original],compileOverrideRule({levels:'all',set:{statusBit1:0,statusBit2:0,statusBit3:0}},'437'));
 assert.equal(fixed.statusBit1,0);assert.equal(fixed.statusBit2,0);
 assert.deepEqual(fixed.powers.map(p=>p[0]),original.powers.map(p=>p[0]),'削防的效果编号不能被改动');
 assert.notEqual(fixed.wireBase64,original.wireBase64,'状态变了，wire 必须重算');
});

test('覆盖层：改效果字段时自动清掉说明里的过期效果行（客户端会把 info 接在效果行后面）',()=>{
 const info='单机重建（含社区资料与推算）\n劈砍防御力-100\n穿刺防御力-100';
 const [out]=applyRuleToLevels([sample(1,{info})],compileOverrideRule({levels:'all',set:{powerValue1:-999}},'90001'));
 assert.equal(out.powers[0][1],-999,'效果确实改了');
 assert.equal(out.info,'单机重建（含社区资料与推算）',
  '旧效果行必须清掉，否则游戏里「按新 power 渲染的效果行」和「旧说明」会同时显示，看着像没生效');
 assert.equal(sample(1,{info}).info,info,'不能污染原定义');
});

test('覆盖层：只改参数（round/useMP/skillWeapon）时不动说明文字',()=>{
 const info='单机重建（含社区资料与推算）\n劈砍防御力-100';
 for(const set of [{round:9},{useMP:99},{skillWeapon:18},{area:10}]){
  const [out]=applyRuleToLevels([sample(1,{info})],compileOverrideRule({levels:'all',set},'90001'));
  assert.equal(out.info,info,'没改效果就不该动说明：'+JSON.stringify(set));
 }
});

test('覆盖层：用户显式覆盖 info 时以用户的为准，不再自动清理',()=>{
 const info='单机重建（含社区资料与推算）\n劈砍防御力-100';
 const [out]=applyRuleToLevels([sample(1,{info})],compileOverrideRule({levels:'all',set:{powerValue1:-1,info:'我自己写的说明'}},'90001'));
 assert.equal(out.info,'我自己写的说明');
});

test('覆盖层：手写说明 / 装备技能说明（不是效果快照）原样保留',()=>{
 const notes=['目标封技后，无法施放劈砍、穿刺技能。自动变为普通攻击','21、22级时，将获得1点免伤护盾'];
 for(const info of notes){
  const [out]=applyRuleToLevels([sample(1,{info})],compileOverrideRule({levels:'all',set:{powerValue1:-5}},'90001'));
  assert.equal(out.info,info,'不是构建工具生成的结构就不该动：'+info);
 }
});

test('覆盖层：带「尚待实战校准」提示行的说明，清理后保留标题与提示',()=>{
 const tail='部分特殊效果沿用已录定义或仅供查阅，尚待实战校准。';
 const info='单机重建（含社区资料与推算）\n无视目标+100点物理防御\n'+tail;
 const [out]=applyRuleToLevels([sample(1,{info})],compileOverrideRule({levels:'all',set:{power1:87}},'90001'));
 assert.equal(out.info,'单机重建（含社区资料与推算）\n'+tail);
 assert.equal(dropStaleEffectLines(''),'','空说明保持空');
 assert.equal(dropStaleEffectLines(null),null);
});

test('真数据：129 无畏冲锋改过效果后，说明里不再残留旧效果行',()=>{
 const career=JSON.parse(fs.readFileSync(path.join(root,'data','career-skills.json'),'utf8'));
 const level=career.skills.find(s=>s.id===129).levels.find(l=>l.level===2);
 assert.equal(String(level.info).split('\n')[0],'单机重建（含社区资料与推算）',
  '构建工具写的 info 必须还是「标题 + 效果行」结构，清理规则才成立');
 assert.ok(/无视目标|目标反击值/.test(level.info),'原版 lv2 说明里确实写着旧效果');
 const rules=JSON.parse(fs.readFileSync(path.join(root,'data','local-skill-overrides.json'),'utf8')).skills;
 if(!rules['129'])return;
 const [out]=applyRuleToLevels([level],compileOverrideRule(rules['129'],'129'));
 assert.ok(!/无视目标|目标反击值|目标伤害减免值/.test(out.info),
  '本地改过 129 之后，旧效果说明必须被清掉，否则游戏里还是显示旧效果');
 assert.deepEqual(out.powers.map(p=>p[0]),[168,85,71],'效果编号按覆盖走');
});

test('lib 里不得用 existsSync 探测 data/ 下的文件（APK 的 VFS 查不到，会静默失效）',()=>{
 // APK 里 node:fs 是 VFS shim（安卓打包/standalone/shims/fs.mjs）：existsSync 只查
 // 「已预载」的内存表，而 data/ 下的资料是运行时按需同步 XHR 取的
 // （standalone-files.json 只预载 6 个文件，不含 data/）→ 拿它做门控恒为 false。
 // 第 57 版就因此让技能覆盖层在 APK 里一直静默失效：改了技能，游戏里一点反应都没有，
 // 而在源项目里跑 Node 用的是真 fs，测不出来。
 // 正确写法：try{fs.readFileSync(...)}catch(error){if(error.code==='ENOENT')…}。
 // 白名单：store.mjs（存档在可写层，existsSync 语义正确）、http-routes.mjs（PC 预览的静态服务）。
 const allowed=new Set(['store.mjs','http-routes.mjs']);
 const offenders=[];
 for(const name of fs.readdirSync(path.join(root,'lib'))){
  if(!name.endsWith('.mjs')||allowed.has(name))continue;
  const src=fs.readFileSync(path.join(root,'lib',name),'utf8');
  if(/\bexistsSync\s*\(/.test(src))offenders.push(name);
 }
 assert.deepEqual(offenders,[],'这些文件用了 existsSync 探测文件（APK 里恒 false）：'+offenders.join(', '));
});

test('造型图标数据：缺文件时安静返回 null，正常时能读到图集',async()=>{
 const m=await import('../lib/fashion-icons.mjs');
 assert.equal(m.fashionIconData(path.join(root,'no-such-dir')),null,'目录不存在时应当返回 null 而不是抛错');
 const data=m.fashionIconData(root);
 assert.ok(data&&data.atlas&&data.sheetTable&&data.sheet,'应当读到 data/fashion-icons.json');
});

test('覆盖层：同一套规则也作用到装备自带技能 / 叠加等级池（activeSkills 的第二处套用）',()=>{
 // 装备提供的技能定义（native，带 wireBase64）与人物技能共用技能 id，
 // 因此同一条规则必须在「等级 → 定义」的集合上也生效。
 const gear=sample(11,{power1:171,powerValue1:100,statusBit1:0,power2:0,powerValue2:0,power3:0,powerValue3:0});
 const definitions=new Map([[11,gear],[22,{...gear,level:22}]]);
 const rule=compileOverrideRule({levels:'all',set:{powerValue1:400,statusBit1:1}},'111');
 assert.equal(applyRuleToDefinitions(definitions,rule),true);
 assert.equal(definitions.get(11).powerValue1,400);
 assert.equal(definitions.get(22).powerValue1,400,'叠加出来的高等级同样被覆盖');
 assert.equal(definitions.get(11).statusBit1,1);
 assert.notEqual(definitions.get(11).wireBase64,gear.wireBase64,'wire 要重算');
 assert.equal(gear.powerValue1,100,'原始定义不能被就地修改');
 // 没配规则的技能一律不动
 const clean=new Map([[11,{...gear}]]);
 assert.equal(applyRuleToDefinitions(clean,compileOverrideRule({levels:[99],set:{round:1}},'x')),false);
});

test('覆盖层：restoration 的 activeSkills 真的接了装备技能这一处套用',()=>{
 const src=fs.readFileSync(path.join(root,'lib','restoration.mjs'),'utf8');
 const body=src.slice(src.indexOf('export function activeSkills'),src.indexOf('export function reconcileSkillSettings'));
 assert.ok(body.includes('applyOverrideToDefinitions(id,definitions)'),
  'activeSkills 里必须对装备/叠加等级池套用技能覆盖，否则改装备技能不生效');
 assert.ok(src.includes('applyOverrideToDefinition(Number(id),imported)'),
  'learned() 里导入的技能定义也要吃覆盖，否则导入角色看不到改动');
});

