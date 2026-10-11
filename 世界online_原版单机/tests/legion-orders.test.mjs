import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {decoders} from '../tools/capture-decoders.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root);
const C=d.constants,M=d.module(12).constants,battleConstants={};
vm.runInNewContext(fs.readFileSync(new URL('../analysis/modules/0061.js',import.meta.url),'utf8'))({},battleConstants,()=>({GuideSpriteId:{}}));
const BC=battleConstants.default;
const types={TYPE_PLAYER:3,TYPE_PET:4,TYPE_LEGION:10,TYPE_BUDDY:11};
class Bytes{
 constructor(){this.data=[];this.position=0;}
 writeByte(n){this.data.push(n&255);}
 writeShort(n){this.writeByte(n>>8);this.writeByte(n);}
 readByte(){const n=this.data[this.position++];return n>127?n-256:n;}
 readShort(){return (this.readByte()<<8)|(this.readByte()&255);}
}

function fixture(){
 const Skill={isValidSkillWeapon:()=>true};
 Skill.isCanUse=d.native(57,'isCanUse',{e:Skill,h:{ModelConst:M},g:{MODEL_TYPE:types},d:{default:C}});
 const skills=[{id:101,type:C.SKILL_TYPE_ACTIVE,useMP:10},{id:202,type:C.SKILL_TYPE_ACTIVE,useMP:20},{id:303,type:C.SKILL_TYPE_AUTO,useMP:3}].map(s=>({...s,area:C.SKILL_AREA_ENEMY_SINGLE,isEnoughHP:()=>true}));
 class Legion{
  getType(){return this.type;}get(k){return k===M.MP?this.mp:0;}
  getSkillByID(id){return this.skillList.find(s=>s.id===id);}
  getAutoSkillCount(){return this.autoSkillID.length;}getPet(){return null;}
  cloneLegion(){return Object.assign(new Legion(),this);}
 }
 const actor=(id,position,type=types.TYPE_LEGION)=>Object.assign(new Legion(),{id,position,type,hp:100,mp:100,skillList:skills,autoSkillID_Initiative:101,autoSkillID:[],...(type===types.TYPE_LEGION?{_offlineLegionActorId:id}:{})});
 const leader=actor(1001,25,types.TYPE_PLAYER),helpers=[23,27,29,21].map((pos,i)=>actor(1002+i,pos));
 const actors=[leader,...helpers],actions=[];
 class Monster{}
 const engineScope={y:{default:BC},l:{MODEL_TYPE:types},_:{default:Monster},T:{Tool:{debug(){}}}};
 class Battle{
  constructor(){this.playerList=Array(BC.MAX_POS);for(const a of actors)this.playerList[a.position]=a;this.playerPlanData=Array(BC.MAX_POS);this.round=0;}
  getType(){return BC.LOCAL;}getPlayerByPos(pos){return this.playerList[pos];}searchAICursor(){return 5;}
  sortModelListBySpeed(){const alive=actors.filter(a=>a.hp>0);return {size:()=>alive.length,elementAt:i=>alive[i]};}
  cleanGuardData(){}cleanAniControlList(){}doRoundBuffer(){}doRoundHpMp(){}
  doEndRoundCheckBuffer(){}updateRoundEndTime(){}updateBattleResult(){}
  doUseSkillById(a,id,target){const s=a.getSkillByID(id);if(!s||!Skill.isCanUse(a,s,null))return false;a.mp-=s.useMP;actions.push({round:this.round,actor:a.id,kind:'skill',id,target});return true;}
  doAttack(a,target){actions.push({round:this.round,actor:a.id,kind:'attack',target});}
  doUseItem(a,slot,target){actions.push({round:this.round,actor:a.id,kind:'item',slot,target});}
  doEscape(a){actions.push({round:this.round,actor:a.id,kind:'escape'});}
 }
 for(const method of ['setPlan','getPlanData','clearAllPlan','logicRound','doPlayerPlan','doAutoSkill','getAutoSkillIDByRound'])Battle.prototype[method]=d.native(251,method,engineScope);
 const battle=new Battle(),modules={
  0:{ModName:{},ProxyType:{}},1:{default:{}},3:{default:{getProxy:()=>({})}},4:{default:C},5:{default:{myPlayer:leader}},
  10:{GameText:{LEGION_DESC1:''}},12:{ModelConst:M},54:{default:{ins:{battle}}},57:{default:Skill},61:{default:BC},
  221:{default:class{onLegionActorlistMsg(){}onLegionChangeMsg(){}}},228:{MonsterGroup:{getLocalBattlePlayerList(){}}},
  251:{default:Battle},256:{default:Legion},75:{default:{getPetOwnerPos:()=>-1}},1464:{default:class{onInit(){}}}
 };
 const window={};vm.runInNewContext(fs.readFileSync(new URL('../web/legion.js',import.meta.url),'utf8'),{window,document:{getElementById:()=>({})}});window.installOfflineLegion(id=>modules[id]);
 const orderScope={c:{default:BC},r:{default:Skill},A:{MODEL_TYPE:types},S:{GuideModel:{ins:{isForbidBattle:false}}},egret:{ByteArray:Bytes}};
 // Use the original skill-selection encoder, order submission and round engine.
 function order(a,kind,target=7,skillId=202){
  const controller={battle,allOrderPlayer:[a],planVector:[],getCursor:()=>target,getOrderPlayer:()=>a,getSelectSkill:()=>a.getSkillByID(skillId),getSelectItem:()=>({slotPos:34}),removeBagUseItem(){},doPlanData(){}};
  for(const method of ['getBattlePlanData','addPlan','doOrderAction','isUseSkillInitiative'])controller[method]=d.native(376,method,orderScope);
  if(kind===BC.PLAN_NONE)controller.addPlan(a.position,controller.getBattlePlanData(kind,a.position));
  else controller.doOrderAction(({[BC.PLAN_ATTACK]:BC.ORDER_ATTACK,[BC.PLAN_USE_SKILL]:BC.ORDER_SKILL,[BC.PLAN_USE_ITEM]:BC.ORDER_ITEM,[BC.PLAN_ESCAPE]:BC.ORDER_ESCAPE})[kind]);
  return battle.getPlanData(a.position);
 }
 return {battle,leader,helpers,actions,order};
}

test('native manual skill and selected target survive legion dispatch, after the separate automatic skill phase',()=>{
 const {battle,leader,helpers,actions,order}=fixture(),helper=helpers[0];helper.autoSkillID=[303];
 order(leader,BC.PLAN_ATTACK,9);const selected=order(helper,BC.PLAN_USE_SKILL,7,202);
 battle.logicRound();
 assert.equal(battle.getPlanData(helper.position),selected,'legion dispatch replaced the manually submitted plan');
 assert.deepEqual(actions.filter(a=>a.actor===helper.id),[
  {round:0,actor:helper.id,kind:'skill',id:303,target:5},
  {round:0,actor:helper.id,kind:'skill',id:202,target:7}
 ]);
 assert.equal(helper.mp,77);assert.ok(actions.some(a=>a.actor===leader.id&&a.kind==='attack'&&a.target===9));
 assert.equal(actions.filter(a=>a.kind==='skill'&&a.id===101).length,3);
});

test('native attack, item, escape and explicit no-action orders are not replaced by legion defaults',()=>{
 const {battle,helpers,actions,order}=fixture();
 const selected=helpers.map((a,i)=>order(a,[BC.PLAN_ATTACK,BC.PLAN_USE_ITEM,BC.PLAN_ESCAPE,BC.PLAN_NONE][i],6+i));
 battle.logicRound();for(let i=0;i<helpers.length;i++)assert.equal(battle.getPlanData(helpers[i].position),selected[i]);
 assert.deepEqual(actions,[
  {round:0,actor:1002,kind:'attack',target:6},
  {round:0,actor:1003,kind:'item',slot:34,target:7},
  {round:0,actor:1004,kind:'escape'}
 ]);
});

test('legion defaults fill only missing plans and manual choices can change each round',()=>{
 const {battle,helpers,actions,order}=fixture();helpers[1].mp=0;helpers[3].hp=0;
 battle.logicRound();
 assert.deepEqual(actions,[{round:0,actor:1002,kind:'skill',id:101,target:5},{round:0,actor:1003,kind:'attack',target:5},{round:0,actor:1004,kind:'skill',id:101,target:5}]);
 battle.clearAllPlan();order(helpers[0],BC.PLAN_USE_SKILL,8,202);order(helpers[1],BC.PLAN_USE_SKILL,9,202);battle.logicRound();
 assert.ok(actions.some(a=>a.round===1&&a.actor===1002&&a.id===202&&a.target===8));
 assert.ok(!actions.some(a=>a.round===1&&a.actor===1003),'unusable manual skill must not be replaced with a different order');
 battle.clearAllPlan();order(helpers[0],BC.PLAN_ATTACK,6);battle.logicRound();
 assert.ok(actions.some(a=>a.round===2&&a.actor===1002&&a.kind==='attack'&&a.target===6));
 battle.clearAllPlan();battle.logicRound();assert.ok(actions.some(a=>a.round===3&&a.actor===1002&&a.id===101));
});
