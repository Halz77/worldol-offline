/**
 * 14006 = CG_SKILL_DELETE_BY_LEVEL，「放弃一级」的守卫用例。
 *
 * 客户端侧这条协议和 14003 共用同一段解析（doDropSkillOneLevel 的 case 3）：
 *   byte 状态 / int 技能号 / int sp / int 金 / int 银 / int 铜 / bool 技能还在不在；
 *   还在就再跟一份技能定义 + 一个 byte 的 addLevel。
 * 所以这里逐个字段对拍字节，而不是只看状态码 —— 少写一个 byte 客户端就会把
 * 后面的数据当垃圾读，界面上表现为技能没变或直接报错。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Writer,Reader} from '../lib/codec.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {initializeNewbie} from '../lib/progression.mjs';
import {openContainer,equipPet} from '../lib/pet-state.mjs';
import {skills,activeSkills} from '../lib/restoration.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {petSkillLevels} from '../lib/pet-catalog.mjs';

function harness(save=()=>{}){
 const p={id:81,name:'逐级遗忘验收',sex:1,race:0,job:1,level:1};initializeNewbie(p);p.level=40;normalizeRole(p);
 p.inventory.push({itemId:30100,slot:31,quantity:1});openContainer(p,31,1);
 const carried=p.inventory.find(i=>i.pet);equipPet(p,carried.slot,1);
 const sent=[],context={role:p},env={store:{save},send(type,w){sent.push({type,bytes:w.done()});},log(type,row){sent.push({type:'log',name:type,row});}};
 return {p,pet:carried.pet,sent,context,
  /** 发一个包，断言请求体被完整读完（错误分支只读了前缀，不用这个）。 */
  reply(type,body){
   const r=new Reader(body.done());assert.equal(handleRestoration(type,r,context,env),true);
   assert.equal(r.pos,r.b.length,'请求体应被完整读取');
   return sent.findLast(s=>s.type===type).bytes;
  },
  /** 发一个预期被拒的包，返回错误串。 */
  deny(type,body){
   const r=new Reader(body.done());assert.equal(handleRestoration(type,r,context,env),true);
   const out=new Reader(sent.findLast(s=>s.type===type).bytes);
   assert.equal(out.byte(),-1,'应该被拒绝');
   return out.string();
  }};
}
const notes=h=>h.sent.filter(s=>s.type===14011);
/** 和 handler 同构的期望回包：状态 / 技能号 / sp / 三种货币 / bool / 技能定义 / addLevel。 */
function expectedReply(id,sp,money,definition){
 const w=new Writer().byte(0).int(id).int(sp).int(money[0]).int(money[1]).int(money[2]).bool(!!definition);
 if(definition)w.raw(Buffer.from(definition.wireBase64,'base64')).byte(definition.addLevel||0);
 return w.done();
}
const purse=p=>[p.gold||0,p.silver||0,p.coins||0];

test('14006 让宠物技能逐级降级，每级回包与客户端解析逐字节对齐',()=>{
 const h=harness(),pet=h.pet;
 // 拿一个目录里最高 9 级的技能，按「后天学会」的方式装在宠物身上（导师/技能书都是这个标记）。
 const source=petSkillLevels.get('6079:9');
 pet.skills.push({...structuredClone(source),kind:'mentor',isLearnByBook:false,addLevel:0});
 for(let level=9;level>1;level--){
  const reply=h.reply(14006,new Writer().int(6079).byte(1));
  const next=petSkillLevels.get(`6079:${level-1}`);
  assert.deepEqual(reply,expectedReply(6079,pet.sp||0,purse(h.p),{...next,addLevel:0}),`降到 ${level-1} 级`);
  // 数值换成上一级，但「怎么来的」标记逐字保留。
  assert.deepEqual(pet.skills.find(s=>s.id===6079),{...structuredClone(next),kind:'mentor',isLearnByBook:false,addLevel:0});
  assert.equal(pet.skills.find(s=>s.id===6079).level,level-1);
 }
 assert.equal(notes(h).length,0,'宠物技能降级不推人物技能栏 14011');
 // 降到底 = 遗忘：技能消失，回包里的 bool 变 false、不再跟技能定义。
 pet.autoSkills=[6079];pet.initiativeSkill=6079;
 const last=h.reply(14006,new Writer().int(6079).byte(1));
 assert.deepEqual(last,expectedReply(6079,pet.sp||0,purse(h.p),null));
 assert.equal(pet.skills.some(s=>s.id===6079),false);
 assert.deepEqual(pet.autoSkills,[]);assert.equal(pet.initiativeSkill,-1);
});

test('14006 保留技能归属标记：天生技能降级后仍然是天生技能',()=>{
 const h=harness(),pet=h.pet;
 // 成长里程碑（pet-state.gainPet / levelPetTo）按 isLearnByBook / learnedFromMentor /
 // kind==='mentor' 判断技能是「玩家教的」还是「随记录长的」。降一级不该改这个归属。
 const innate=pet.skills.find(s=>s.kind==='innate'&&s.level>1);
 assert.ok(innate,'孵出来的宠物应当带有可降级的天生技能');
 h.reply(14006,new Writer().int(innate.id).byte(1));
 const after=pet.skills.find(s=>s.id===innate.id);
 assert.equal(after.kind,'innate');assert.equal(after.isLearnByBook,false);
 assert.equal(after.level,innate.level-1);
 assert.equal(after.learnedFromMentor,undefined);
 let saves=0;const grown=harness(()=>{saves++;});
 const bookSkill={...structuredClone(petSkillLevels.get('6079:9')),kind:'mentor',isLearnByBook:true};
 grown.pet.skills.push(bookSkill);
 grown.reply(14006,new Writer().int(6079).byte(1));
 assert.equal(grown.pet.skills.find(s=>s.id===6079).isLearnByBook,true,'技能书学的还是技能书学的');
 assert.equal(saves,1);
});

test('14006 让角色技能降一级，降到底删除并推 14011 刷新技能栏',()=>{
 const h=harness(),p=h.p;
 const entry=[...skills.values()].find(s=>s.native&&s.levels.length>=3&&s.levels.every((l,i)=>l.level===i+1));
 assert.ok(entry,'需要一条等级连续的技能资料');
 p.skills[entry.id]=3;
 const notesBefore=notes(h).length;
 const reply=h.reply(14006,new Writer().int(entry.id).byte(0));
 const effective=activeSkills(p).find(s=>s.id===entry.id);
 assert.deepEqual(reply,expectedReply(entry.id,p.skillPoints||0,purse(p),effective));
 assert.equal(p.skills[entry.id],2);
 assert.equal(notes(h).length,notesBefore+1,'人物技能降级要刷新技能栏');
 for(const level of [1,0]){
  h.reply(14006,new Writer().int(entry.id).byte(0));
  if(level)assert.equal(p.skills[entry.id],level);else assert.equal(entry.id in p.skills,false);
 }
 // 1→0 时技能已经没了，没有东西可刷新，所以只多推一次 14011（同 14003 的完整遗忘）。
 assert.equal(notes(h).length,notesBefore+2);
});

test('14006 的拒绝路径：无效目标、没有宠物/技能、资料缺失、战斗中、存盘失败都不改状态',()=>{
 const h=harness(),pet=h.pet;
 assert.equal(h.deny(14006,new Writer().int(6079).byte(2)),'无效的技能目标。');
 assert.equal(h.deny(14006,new Writer().int(6079).byte(1)),'没有这个宠物技能。');
 // 没有出战宠物
 const solo=harness();solo.p.inventory.find(i=>i.pet).slot=35;
 assert.equal(solo.deny(14006,new Writer().int(6079).byte(1)),'没有出战宠物。');
 // 上一级资料缺失（把等级顶到目录之外，模拟残缺存档）
 const broken=harness();broken.pet.skills[0].level=99;const brokenBefore=JSON.stringify(broken.p);
 assert.match(broken.deny(14006,new Writer().int(broken.pet.skills[0].id).byte(1)),/上一级的资料尚未恢复/);
 assert.equal(JSON.stringify(broken.p),brokenBefore);
 // 战斗中
 const busy=harness();busy.context.battle={};const busyBefore=JSON.stringify(busy.p);
 assert.equal(busy.deny(14006,new Writer().int(busy.pet.skills[0].id).byte(1)),'请先结束战斗再管理装备和技能。');
 assert.equal(JSON.stringify(busy.p),busyBefore);
 // 存盘失败回滚
 const failing=harness(()=>{throw Error('disk failure');});
 const skill=failing.pet.skills.find(s=>s.level>1),before=JSON.stringify(failing.p);
 assert.equal(failing.deny(14006,new Writer().int(skill.id).byte(1)),'disk failure');
 assert.equal(JSON.stringify(failing.p),before);
});

test('14006 与 14003 的回包同构：把 14003 完整遗忘的字节换成 14006 降级仍能被同一段代码读出来',()=>{
 // 客户端 doDropSkillCb（14003）与 doDropSkillOneLevel（14006）读的是同一串字段，
 // 唯一的差别是最后一个 bool —— 14003 恒为 false，14006 在技能还在时给 true 再跟技能定义。
 const h=harness(),pet=h.pet;
 const source=petSkillLevels.get('6079:9');
 pet.skills.push({...structuredClone(source),kind:'mentor',isLearnByBook:false});
 const downgrade=new Reader(h.reply(14006,new Writer().int(6079).byte(1)));
 assert.equal(downgrade.byte(),0);assert.equal(downgrade.int(),6079);assert.equal(downgrade.int(),pet.sp||0);
 downgrade.int();downgrade.int();downgrade.int();
 assert.equal(downgrade.bool(),true);
 const skill=petSkillLevels.get('6079:8'),wire=Buffer.from(skill.wireBase64,'base64');
 const start=downgrade.pos;downgrade.take(wire.length);
 assert.deepEqual(downgrade.b.subarray(start,downgrade.pos),wire);
 assert.equal(downgrade.byte(),0);assert.equal(downgrade.pos,downgrade.b.length);
 const forget=new Reader(h.reply(14003,new Writer().int(6079).byte(1)));
 assert.equal(forget.byte(),0);assert.equal(forget.int(),6079);assert.equal(forget.int(),pet.sp||0);
 forget.int();forget.int();forget.int();assert.equal(forget.bool(),false);
 assert.equal(forget.pos,forget.b.length);
});
