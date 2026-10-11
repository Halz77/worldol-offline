import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {simple} from 'acorn-walk';
import {decoders,Reader} from '../tools/capture-decoders.mjs';
import {officialMissions} from '../lib/official-data.mjs';
import {officialMissionPacket} from '../lib/official-packets.mjs';
import {missionBits} from '../lib/game-packets.mjs';
import {patchNpcRepeatableMissions,patchOfflineStoryBattles,patchDailyCatalogVisibility,patchNpcMissionRefresh} from '../lib/client-mission-patch.mjs';
import {dailyData,taskSnapshot} from '../lib/daily-activity.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root);
const raw=process.env.WORLDOL_RESOURCES||(fs.existsSync(path.join(root,'client/v/gd/305.json'))?path.join(root,'client'):path.resolve(root,'../H5客户端_v305_20260920/files/resgood'));
const original=fs.readFileSync(path.join(raw,'js/ff/fff570bb4753f056432680e781d827dc.js'),'utf8');
const fixed=patchNpcMissionRefresh(patchDailyCatalogVisibility(patchOfflineStoryBattles(patchNpcRepeatableMissions(original))));
function methods(source){
  let modules=[];const result={dailyConstants:{}};
  simple(parse(source,{ecmaVersion:'latest'}),{ArrayExpression(n){if(n.elements.length>modules.length&&n.elements.every(e=>e?.type==='FunctionExpression'))modules=n.elements;}});
  for(const id of [5,18,74,98,754])simple(modules[id],{AssignmentExpression(n){if(n.left.type!=='MemberExpression')return;const name=n.left.property.name;if(['doMissionNpc','getAcceptMis','toBattle','getList','dataChanged','setState','processMissionNPCStatus'].includes(name)&&n.right.type==='FunctionExpression')result[name]=source.slice(n.right.start,n.right.end);if(id===98&&/^[A-Z][A-Z_0-9]+$/.test(name)&&n.right.type==='Literal')result.dailyConstants[name]=n.right.value;}});
  return result;
}
const oldMethods=methods(original),newMethods=methods(fixed);
test('native quest status replies invalidate NPC eligibility cached before a predecessor was completed',()=>{
  function receive(code){
    const flag=d.module(12).constants.NPC_MISSION_LOAD,notifications=[];
    const npc={loaded:true,sign:1,setSign(value){this.sign=value;},setTabStatus(value,mask){assert.equal(mask,flag);this.loaded=value;}};
    const scope={r:{default:{getNpcByID:id=>id===16?npc:null}},C:{ModelConst:{NPC_MISSION_LOAD:flag}},P:{SceneEvent:{ON_NPC_SIGN_UPDATE:'sign'}},o:{default:{sendNt(name,ids){notifications.push({name,ids:Array.from(ids),loaded:npc.loaded});}}}};
    const packet=new Reader(Buffer.from([2,16,3,99,0]));
    new vm.Script('('+code+')').runInNewContext(scope)(packet);packet.finish();
    return {npc,notifications};
  }
  assert.equal(receive(oldMethods.processMissionNPCStatus).npc.loaded,true);
  const repaired=receive(newMethods.processMissionNPCStatus);
  assert.equal(repaired.npc.loaded,false);assert.equal(repaired.npc.sign,3);
  assert.deepEqual(repaired.notifications,[{name:'sign',ids:[16,99],loaded:false}]);
});
function dailyList(code,player,type){
  class Daily{}
  Object.assign(Daily,oldMethods.dailyConstants);
  const packet=taskSnapshot(player);
  const scope={e:Daily,o:{default:{ins:{getData:()=>packet}}},n:{default:{myPlayer:player}},pb:{EUserProtocol:{S2C_TASK_INFO:22106}}};
  return Array.from(new vm.Script('('+code+')').runInNewContext(scope)(type));
}

test('native daily list reproduces the three visible dungeons and restores all eight without completing prerequisites',()=>{
  const player={level:97,quests:{active:{},completed:[]}},before=JSON.stringify(player);
  assert.deepEqual(dailyList(oldMethods.getList,player,5).map(r=>r.r_name),['月牙山','封印墓地','夜语森林']);
  const expected=dailyData.tasks.filter(t=>t.type===5).map(t=>t.id).sort((a,b)=>a-b);
  assert.equal(expected.length,8);
  for(const level of [1,25,97]){
    const p={...player,level};
    const rows=dailyList(newMethods.getList,p,5);
    assert.deepEqual(rows.map(r=>r.r_id).sort((a,b)=>a-b),expected);
    assert.equal(rows.find(r=>r.r_id===39).r_missionIdFinish,false);
    for(const type of new Set(dailyData.tasks.map(t=>t.type)))assert.equal(dailyList(newMethods.getList,p,type).length,dailyData.tasks.filter(t=>t.type===type).length);
  }
  assert.equal(JSON.stringify(player),before);
});

test('native daily cards keep Participate below recommended levels and preserve completed states',()=>{
  const player={level:1,quests:{active:{},completed:[]}},row=dailyList(newMethods.getList,player,5).find(r=>r.r_id===41);
  function render(code,status=0){
    const view={data:{...row,r_type:status},setState:new vm.Script('('+newMethods.setState+')').runInNewContext()};
    for(const name of ['group','recoBg','recoLab','icon','missName','recoLevel','numPro','lab_left','desc','stateDesc','btnType','btnTypeBg','value','btnHelp','schPro'])view[name]={};
    view.state={setType(){}};
    const scope={n:{default:oldMethods.dailyConstants},p:{default:{myPlayer:player}},d:{default:{getUiTaskBg:x=>x}},u:{default:{parseHtml:x=>x}},_:{default:{makeColorString:x=>x}},l:{default:{STATUS_IMG_NUM_2:2}}};
    new vm.Script('('+code+')').runInNewContext(scope).call(view);return view;
  }
  assert.equal(render(oldMethods.dataChanged).btnType.visible,false);
  const open=render(newMethods.dataChanged);assert.equal(open.btnType.visible,true);assert.equal(open.btnTypeBg.visible,true);assert.match(open.recoLevel.textFlow,/25级/);
  const completed=render(newMethods.dataChanged,2);assert.equal(completed.btnType.visible,false);assert.equal(completed.state.visible,true);
});

const status={CAN_SUBMIT:0,NOT_CAN_SUBMIT:1,CAN_ACCEPT:2,NOT_CAN_ACCEPT:3,FINISH:4};
const Mission=d.Mission;
for(const name of ['isUnLimitSubmit','getId','getMissionStatus','isCanAccept'])Mission.prototype[name]=d.native(64,name,{t:Mission,w:status,b:{TASK_TYPE_MAIN:6}});
Mission.isMissionFinish=d.native(64,'isMissionFinish');
const Condition=d.module(231).constants;
const checkCondition=d.native(231,'checkCondition',{e:Condition,_:{default:Mission}});

function ui(methods,id=3038,completed=[3038,3039,3040,3041,3042]){
  const p={level:97,mapId:263,quests:{active:{},completed}};
  const nativePlayer={missionList:[],missionStatus:missionBits(p),getMissionById:()=>null,getLevel:()=>97,getMissionCntInfo:()=>null};
  const q=Mission.fromBytes(new Reader(officialMissionPacket(officialMissions.get(id),p,10).done()));
  for(const c of q.acceptCondition||[]){const bytes=new Reader(Buffer.from(c.rawHex,'hex'));Object.defineProperty(bytes,'position',{get(){return this.pos;},set(v){this.pos=v;}});c.isConditionOfSatisfy=player=>checkCondition.call(c,player,bytes);}
  const npc={npcType:d.Npc.NPC_MISSION,missions:[q],id:10,name:'微笑的大南瓜'},calls=[];
  const Npc={...d.module(74).constants,handlerMissionNPCAction(npc,choice){calls.push({kind:'mission',id:choice[1].id});}};
  const scope={t:Npc,n:{default:{myPlayer:nativePlayer,getCurMapID:()=>263}},d:{default:Mission,MissionConst:status,MissionType:{TASK_TYPE_MAIN:6}},r:{GameText:{getText:()=> '离开'}},f:{MainPlayerAi:{ins:{open:false}}},_:{default:{createMissionUI(name,detail,choices){calls.push({kind:'menu',choices:Array.from(choices,c=>c[0])});}}}};
  const run=name=>new vm.Script('('+methods[name]+')').runInNewContext(scope);
  return {q,nativePlayer,calls,open:()=>run('doMissionNpc')(nativePlayer,npc),available:()=>run('getAcceptMis')([q])};
}

test('actual native NPC menu reproduces the hidden completed pumpkin and repaired bundle opens it without clearing history',()=>{
  const broken=ui(oldMethods);broken.open();assert.deepEqual(broken.calls,[{kind:'menu',choices:['离开']}]);assert.equal(broken.available(),null);
  const fixed=ui(newMethods),history=Buffer.from(fixed.nativePlayer.missionStatus);
  for(let n=0;n<2;n++){fixed.open();assert.equal(fixed.available(),fixed.q);assert.equal(fixed.calls.at(-1).id,3038);}
  assert.equal(Mission.isMissionFinish(fixed.nativePlayer,3038),true);assert.deepEqual(fixed.nativePlayer.missionStatus,history);
});

test('completed one-time missions remain hidden in the native NPC menu',()=>{
  const once=ui(newMethods,3039);assert.equal(once.q.isUnLimitSubmit(),false);once.open();assert.deepEqual(once.calls,[{kind:'menu',choices:['离开']}]);assert.equal(once.available(),null);assert.equal(Mission.isMissionFinish(once.nativePlayer,3039),true);
});

test('completed Halloween boss remains available through the actual native NPC menu',()=>{
 const boss=ui(newMethods,3042);assert.equal(boss.q.isUnLimitSubmit(),true);boss.open();assert.equal(boss.calls.at(-1).id,3042);assert.equal(boss.available(),boss.q);assert.equal(Mission.isMissionFinish(boss.nativePlayer,3042),true);
});

test('native NPC menu checks restored prerequisites before offering the boss',()=>{
 const locked=ui(newMethods,3042,[3038,3039]);assert.equal(locked.q.isCanAccept(locked.nativePlayer),false);assert.equal(locked.available(),null);
 const open=ui(newMethods,3042,[3038,3039,3040,3041]);assert.equal(open.q.isCanAccept(open.nativePlayer),true);assert.equal(open.available(),open.q);
});
test('native NPC menu exposes Captive after Assassins without requiring or completing missing quest 1678',()=>{
 const locked=ui(newMethods,1679,[1676]);assert.equal(locked.q.isCanAccept(locked.nativePlayer),false);assert.equal(locked.available(),null);
 const open=ui(newMethods,1679,[1676,1677]),history=Buffer.from(open.nativePlayer.missionStatus);
 assert.equal(open.q.isCanAccept(open.nativePlayer),true);assert.equal(open.available(),open.q);open.open();assert.equal(open.calls.at(-1).id,1679);
 assert.equal(Mission.isMissionFinish(open.nativePlayer,1678),false);assert.deepEqual(open.nativePlayer.missionStatus,history);
 const before=ui(newMethods,1677,[1676]);assert.equal(before.q.submitNextMissionID,1679);
 const after=ui(newMethods,1680,[1676,1677]);assert.equal(after.q.isCanAccept(after.nativePlayer),false);
});

test('the native boss entry routes recorded online-ID groups through the local battle protocol',()=>{
  function request(code,id,loaded=true){
    const group={groupId:id},player={x:1,y:2,isLeader:()=>false,checkIsHasLegionTem:()=>false};
    const world={myPlayer:player,isEscortStatus:()=>false,getMonsterGroup:()=>loaded?group:null,getBattleByGroupID:()=>loaded?{getMonsterGroup:()=>group}:null};
    const scope={e:world,S:{default:{ins:{isFight:false}}},n:{default:{timer:{serverTime:0}}},f:{default:{isNetBattleID:d.native(4,'isNetBattleID',{e:d.constants})}},o:{default:{getProxy:()=>({mtRequest(){},createMoveMessage(){}})}},a:{ModName:{},ProxyType:{}},pb:{BuddyCMD:{}},h:{default:{createEnterLocalBattle:id=>({type:12501,id}),createEnterRemoteBattle:id=>({type:12503,id})}},Y:{default:{sendProtoAsync:m=>m}},
      // Execute the actual generated case-0/case-2 routing until its first await.
      __awaiter(self,args,P,fn){return fn.call(self);},__generator(self,step){const state={label:0};let op=step.call(self,state);while(op[0]===3){state.label=op[1];op=step.call(self,state);}return op;}};
    const result=new vm.Script('('+code+')').runInNewContext(scope).call(world,id);
    assert.equal(result[0],4);return result[1];
  }
  assert.deepEqual(request(oldMethods.toBattle,10007),{type:12503,id:10007});
  assert.deepEqual(request(newMethods.toBattle,10007),{type:12501,id:10007});
  assert.deepEqual(request(newMethods.toBattle,213),{type:12501,id:213});
  assert.deepEqual(request(newMethods.toBattle,10007,false),{type:12503,id:10007});
});
