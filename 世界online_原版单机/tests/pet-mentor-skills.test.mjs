import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {Writer,Reader} from '../lib/codec.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {petMentorSkills,learnPetMentorSkill} from '../lib/pet-mentors.mjs';
import {activePet} from '../lib/pet-state.mjs';
import {openContainer,equipPet} from '../lib/pet-state.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {initializeNewbie} from '../lib/progression.mjs';

// 出战宠物 + 宠物导师（商店 2000–3999）的最小存档，协议走真实的 handleRestoration。
function harness(){
 const p={id:71,name:'宠物导师验收',sex:1,race:0,job:1,level:1};initializeNewbie(p);p.level=90;normalizeRole(p);
 p.inventory.push({itemId:30100,slot:31,quantity:1});openContainer(p,31,1);equipPet(p,p.inventory.find(i=>i.pet).slot,1);
 const sent=[],context={role:p},env={store:{save(){}},send(type,w){sent.push({type,bytes:w.done()});},log(){}};
 const call=(type,body)=>{assert.equal(handleRestoration(type,new Reader(body.done()),context,env),true);return new Reader(sent.findLast(s=>s.type===type).bytes);};
 return {p,pet:()=>activePet(p),call,list:shop=>petMentorSkills(activePet(p),shop)};
}

test('a pet mentor listing offers the next level with the cap the client shows as max level',()=>{
 const h=harness(),reply=h.call(14001,new Writer().short(2001));
 assert.equal(reply.short(),2001);
 const list=h.list(2001);assert.ok(list.length>0);
 for(const s of list)assert.ok(s.levels.at(-1).level>=s.level);
});

test('one learning request takes a pet mentor skill straight to its cap',()=>{
 const h=harness();h.call(14001,new Writer().short(2001));
 const offer=h.list(2001)[0],top=offer.levels.at(-1).level;
 const reply=h.call(14002,new Writer().short(2001).int(offer.id).byte(top).bool(false));
 assert.equal(reply.byte(),0);assert.equal(reply.int(),offer.id);
 assert.equal(h.pet().skills.find(s=>s.id===offer.id).level,top);
 // 最高级之后没有下一级，客户端据此知道这个技能已经学满。
 for(let n=0;n<4;n++)reply.int();
 assert.equal(reply.byte(),0);
});

test('pet mentor learning still works one level at a time',()=>{
 const h=harness();h.call(14001,new Writer().short(2001));
 const offer=h.list(2001)[0],top=offer.levels.at(-1).level;
 for(let level=1;level<=top;level++){
  const reply=h.call(14002,new Writer().short(2001).int(offer.id).byte(level).bool(false));
  assert.equal(reply.byte(),0);assert.equal(h.pet().skills.find(s=>s.id===offer.id).level,level);
 }
});

test('an out-of-range pet learning request is refused and leaves the pet untouched',()=>{
 const h=harness();h.call(14001,new Writer().short(2001));
 const offer=h.list(2001)[0],top=offer.levels.at(-1).level;
 const before=JSON.stringify(h.pet().skills);
 const reply=h.call(14002,new Writer().short(2001).int(offer.id).byte(top+1).bool(false));
 assert.equal(reply.byte(),-1);assert.equal(reply.string(),'该等级已学会或已达到上限。');
 assert.equal(JSON.stringify(h.pet().skills),before);
 assert.throws(()=>learnPetMentorSkill(h.pet(),2001,offer.id,0),/已学会或已达到上限/);
 assert.equal(JSON.stringify(h.pet().skills),before);
});

// 客户端那一侧：导师列表里的按钮（888）和学习确认面板（911）。
// 这里只验证「点一次就把目标等级发到最高级」，面板外观与按钮数量一律不动。
function clientFixture(shop=2001){
 const sent=[],alerts=[],modals=[];
 const pet={skills:[],getSkillLevelByID(id){return this.skills.find(s=>s.id===id)?.level||0;}};
 class Skill{constructor(id,level,name){this.id=id;this.level=level;this.name=name;}
  getClone(){const copy=new Skill(this.id,this.level,this.name);return copy;}}
 const World={myPlayer:{skills:[],getPet:()=>pet,getSkillLevelByID:()=>0},shopID:shop,openShopSkill(){}};
 const UI={alertMessage:s=>alerts.push(s),showModal:(name,view,args)=>modals.push({name,view,args})};
 const types={ModName:{Shop:'shop'},ShopViewType:{ShopSkillLearn:'learn'},ProxyType:{Shop:'shopProxy'}};
 const constants={SKILL_TYPE_PET:1,SKILL_TYPE_PLAYER:0,SKILL_TYPE_OTHER:2,
  getTypeBySkillShopID:id=>id>=2000&&id<4000?constants.SKILL_TYPE_PET:id>=1&&id<2000?constants.SKILL_TYPE_PLAYER:constants.SKILL_TYPE_OTHER};
 class LearnMdr{
  async onConfirm(){
   const args=this._showArgs??{};if(!args.target||!args.skill)return this.closeView();
   const learned=await modules[57].default.doLearnSkill(args.target,args.skill);
   if(learned)args.skill=learned;
   this.updateView();
  }
  updateView(){this.rendered=(this.rendered||0)+1;}
  closeView(){this.closed=true;}
 }
 class SkillItem{tapBtnOperating(){modals.push({name:'native',args:{skill:this.data?.skill}});}}
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{id,children:[],value:'',textContent:''});return elements.get(id);};
 const document={getElementById:element,createElement:()=>({value:'',textContent:''})};
 const modules={5:{default:World},1:{default:UI},0:types,4:{default:constants},3:{default:{_moduleMap:{}}},
  10:{default:{}},11:{default:{alloc:(owner,fn,args=[])=>fn.bind(owner,...args)}},12:{ModelConst:{LEVEL:1}},14:{default:{parseHtml:t=>t}},15:{default:{}},
  18:{default:{createBrowseSkillShop:()=>({})}},43:{default:{Service:{onProto(){},sendProto(){}}}},54:{default:{ins:{isFight:false}}},
  74:{default:class{static fromBytes(){return {};}}},887:{ShopSkillMdr:class{}},888:{ListShopSkillItem:SkillItem},890:{default:class{}},
  911:{ShopSkillLearnMdr:LearnMdr},
  57:{default:{doLearnSkill:async(target,skill)=>{sent.push({target,level:skill.level,id:skill.id});
   const learned=target.skills.find(s=>s.id===skill.id);
   if(learned)learned.level=skill.level;else target.skills.push({id:skill.id,level:skill.level});}}}};
 const window={};
 vm.runInNewContext(fs.readFileSync(new URL('../web/career-skills.js',import.meta.url),'utf8'),{window,document,setTimeout});
 window.installCareerTeachers(id=>{if(!modules[id])throw Error('Unexpected native module '+id);return modules[id];});
 const open=(skill,maxLevel)=>{const item=new SkillItem();item.data={skill,maxLevel};item.tapBtnOperating();return modals.at(-1);};
 const confirm=async panel=>{await panel.onConfirm();return panel;};
 return {pet,Skill,World,UI,alerts,modals,sent,open,confirm,LearnMdr,document};
}

test('one tap on a pet mentor skill sends the cap as the target level, without adding any button',()=>{
 const f=clientFixture(),skill=new f.Skill(6079,1,'血雾');
 const modal=f.open(skill,10);
 assert.deepEqual({name:modal.name,view:modal.view},{name:'shop',view:'learn'});
 assert.equal(modal.args.target,f.pet);assert.equal(modal.args.maxLevel,10);
 assert.equal(f.modals.length,1);   // 只开原来那个确认面板，没有多出别的入口
});

test('confirming that panel learns every level at once and closes without the max-level warning',async()=>{
 const f=clientFixture(),skill=new f.Skill(6079,1,'血雾'),modal=f.open(skill,10);
 const panel=new f.LearnMdr();panel._showArgs=modal.args;
 await f.confirm(panel);
 assert.equal(f.pet.getSkillLevelByID(6079),10);
 // 服务端一次请求就把 1–10 级过完，客户端不该一级一级点。
 assert.deepEqual(f.sent,[{target:f.pet,level:10,id:6079}]);
 assert.equal(panel.rendered,undefined);   // updateView 被挡住，不会弹「已达最高级」
 assert.equal(panel.closed,true);
 assert.deepEqual(f.alerts,['血雾 已学到 10 级。']);
});

test('a maxed skill keeps the original refusal, and player shops also learn to the cap in one tap',async()=>{
 const f=clientFixture(),maxed=new f.Skill(6079,10,'血雾');
 f.pet.skills.push({id:6079,level:10});
 f.open(maxed,10);
 assert.deepEqual(f.alerts,['当前技能所可学习该技能已达最高级。欲学习更高技能可进入他人国家后找到技能所查看。']);
 assert.equal(f.modals.length,0);
 // 人物技能商店（<2000）与宠物同一规则：点一次就把目标等级发到最高级，不再一级一级点。
 const player=clientFixture(1301),skill=new player.Skill(406,1,'巨人之力');
 const modal=player.open(skill,22);
 assert.equal(modal.name,'shop');
 assert.equal(modal.args.target,player.World.myPlayer);
 assert.equal(modal.args.maxLevel,22);
 const panel=new player.LearnMdr();panel._showArgs=modal.args;
 await player.confirm(panel);
 assert.deepEqual(player.sent,[{target:player.World.myPlayer,level:22,id:406}]);
 assert.equal(panel.rendered,undefined);   // updateView 被挡住，不会弹「已达最高级」
 assert.equal(panel.closed,true);
 assert.deepEqual(player.alerts,['巨人之力 已学到 22 级。']);
});
