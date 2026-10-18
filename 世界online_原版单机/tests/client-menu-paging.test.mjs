import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// 个人城市模板里的飞行驿站补完 60 条航线后一共 65 项菜单。原版 power-NPC 菜单
// （UI.createMissionUI → MissionDialogMdr）把整份选项**一次**铺进对话窗，选项一多
// 就溢出窗口：后面的选项既点不到也滚不动（玩家反馈的就是这一条）。
// web/offline.js 因此在 createMissionUI 上做了分页：页首/页尾补「上一页/下一页」，
// 点它们由 MissionDialogMdr.executeChoice 的钩子先关掉再重开同一个对话窗（下一页）。
// 这个用例把原版这两个模块换成可观测的壳，验证：
//   · 只有超长 power-NPC 菜单才分页，别的菜单（短菜单、任务列表）原样放行；
//   · 每页的选项仍是原版数组里那一条（jumpMapID 的下标不因切页而位移）；
//   · 从第一页一路点「下一页」能把 65 条航线一条不差、不重不漏地走完；
//   · 普通选项仍然交给原版 executeChoice。
function installOffline(){
 const calls=[],nativeChoices=[];
 class Player{get(){return 0;}updateIcon(){}}
 class MissionDialogMdr{
   onShow(){return 'native-on-show';}
   onHide(){return 'native-on-hide';}
   executeHide(){this.hidden=!0;}
   executeChoice(index){nativeChoices.push(index);return 'native-choice';}
 }
 const modules={
  0:{ModName:{Scene:'Scene',Raiders:'Raiders'},ProxyType:{Scene:'Scene'},RaidersViewType:{BookGroupMain:'BookGroupMain'}},
  1:{default:{EVENT_ALL_MENU_CSS:-1,SUB_MISSION_NPC_MENU:1,alertMessage(){},createChiselSealUI(){},
   createMissionUI(title,textInfo,choiceMenuList,choiceObjList,selectList,subType,uiObj){
    const args={title,textInfo,choiceMenuList,choiceObjList,selectList,subType,uiObj};calls.push(args);return args;}}},
  2:{SkillEvent:{DO_SET_AUTO_SKILL:1}},
  3:{default:{sendNt(){},getProxy:()=>({})}},
  5:{default:{orgMapID:19,myPlayer:null}},
  8:{Tool:{getIconByData:()=>''}},
  10:{GameText:{TI_ERROR:'error',getText:key=>String(key)}},
  12:{ModelConst:{}},
  18:{default:{processDataBlockFlagMsg(){},processDataPlayerDetail(){},processMissionReward(){}}},
  22:{Message:class{}},
  35:{default:{sendProtoAsync:()=>Promise.resolve()}},
  38:{ActType:{DAILY_GAME:1,ACTIVITY_VITALIY:2}},
  42:{default:class{}},
  45:{default:{getInstance:{getTypeRed:()=>({})}}},
  54:{default:{ins:{isFight:false,battle:null}}},
  56:{default:Player},
  57:{default:{}},61:{default:{}},
  67:{ShopItem:{openItemShop(){}}},
  132:{default:{getRes:()=>null}},
  197:{default:{Instance:{doEnterWorldMap(){}}}},
  360:{default:class{}},
  737:{MissionDialogMdr},
  1001:{default:class{}},
  1150:{default:class{}},
 };
 const element={classList:{add(){},remove(){},toggle(){}},textContent:''};
 const window={addEventListener(){},installRecordedContent(){},installCareerTeachers:()=>({snapshot:()=>({})}),
  installEquipmentComposition:()=>({open(){}}),installCombatRating:()=>({snapshot:()=>null}),
  __worldReq:id=>{if(!modules[id])throw Error('Unexpected module '+id);return modules[id];}};
 window.installCharacterFeatures=()=>({snapshot:()=>null});window.installNativeVip=()=>{};window.installHomeFeatures=()=>{};
 window.installNativeFeatures=()=>{};window.installNativeCommerce=()=>{};window.installOfflineRoleSlots=()=>{};
 window.installDailyTaskReset=()=>{};window.installNativePetShop=()=>{};
 window.installOfflineViewport=()=>({revision:'offline-viewport-test'});window.installOfflineSystemSettings=()=>{};
 window.installEquipmentWorkshop=()=>{};window.installPetEquipment=()=>{};window.installSpiritSeals=()=>({});
 window.installPetIllusion=()=>({revision:'pet-illusion-test'});
 window.installOfflineLegion=()=>({revision:'legion-manual-orders-20260923-v2',snapshot:()=>null,battleResult:()=>[]});
 vm.runInNewContext(fs.readFileSync(new URL('../web/pet-snapshot-vitals.js',import.meta.url),'utf8'),{window});
 vm.runInNewContext(fs.readFileSync(new URL('../web/offline.js',import.meta.url),'utf8'),
  {window,document:{getElementById:()=>element},gg:{},gs:{},go:{},fetch:async()=>({json:async()=>({itemIds:[]})}),
   setInterval(){},URLSearchParams,location:{search:'',port:'8779',origin:'http://127.0.0.1:8779'},eui:{Scroller:class{}}});
 window.offlineInstall();
 const npc={id:9,name:'飞行驿站'},player={};
 return {calls,nativeChoices,MissionDialogMdr,
  // 与客户端 addPowerNPCChoice 一致：传送项 = [CHOICE_TYPE_POWERNPC, POWER_NPC_JUMPMAP, 原版下标]。
  menu:count=>({labels:Array.from({length:count},(_,i)=>[`【主城】前往城市${i}`]),actions:Array.from({length:count},(_,i)=>[2,0,i])}),
  show:(labels,actions,subType=1)=>modules[1].default.createMissionUI('飞行驿站','打招呼',labels,actions,null,subType,{player,npc}),
  click:(page,index)=>{const dialog={_showArgs:page,executeHide(){this.hidden=!0;}};MissionDialogMdr.prototype.executeChoice.call(dialog,index);return {page:calls[calls.length-1],closed:dialog.hidden===true};}};
}
const isNav=entry=>/^([◀] 上一页|下一页 ▶)/.test(entry[0]);
const nextIndexOf=page=>page.choiceMenuList.findIndex(entry=>entry[0].startsWith('下一页 ▶'));

test('short and non-NPC menus keep their native one-shot layout',()=>{
 const env=installOffline();
 for(const [count,subType,id,reason] of [[5,1,9,'5 项航线菜单'],[20,1,9,'不足两屏的菜单'],[65,5,9,'任务列表'],[17,1,126,'补给商人菜单']]){
  env.calls.length=0;
  const {labels,actions}=env.menu(count);
  if(id!==9)labels.length=count;
  env.show(labels,actions,subType);
  assert.equal(env.calls.length,1,reason+'不该分页');
  assert.deepEqual(env.calls[0].choiceMenuList,labels,reason+'的选项要原样传下去');
  assert.deepEqual(env.calls[0].choiceObjList,actions);
 }
});

test('long menus page through the native dialog with unchanged choice indices',()=>{
 const env=installOffline();
 const {labels,actions}=env.menu(65);
 let page=env.show(labels,actions),seen=[];
 for(let guard=0;guard<25;guard++){
  assert.ok(page.choiceMenuList.length<=10,'一页最多 8 条选项 + 2 条翻页');
  const next=nextIndexOf(page);
  page.choiceMenuList.forEach((entry,index)=>{
   if(isNav(entry))return;
   const [kind,sub,source]=page.choiceObjList[index];
   assert.equal(kind,2);assert.equal(sub,0);
   assert.equal(entry[0],labels[source][0],`第 ${index} 项必须还是原版第 ${source} 项`);
   seen.push(source);
  });
  if(next<0)break;
  const step=env.click(page,next);
  assert.ok(step.closed,'翻页要先关掉当前对话窗（与点普通选项同一套收尾）');
  assert.ok(step.page,'点「下一页」要重新出一页');
  page=step.page;
 }
 assert.equal(seen.length,65,'65 条航线要一条不差地都能点到');
 assert.equal(new Set(seen).size,65,'不能重复摆出同一条航线');
 assert.deepEqual([...seen].sort((a,b)=>a-b),labels.map((_,index)=>index));
 assert.ok(page.choiceMenuList[0][0].startsWith('◀ 上一页'),'最后一页要能退回上一页');
 assert.equal(nextIndexOf(page),-1,'最后一页不该再有「下一页」');
});

test('the page hooks stay out of the way for ordinary choices and native closes',()=>{
 const env=installOffline();
 const {labels,actions}=env.menu(40);
 const page=env.show(labels,actions);
 const dialog={_showArgs:page,executeHide(){this.hidden=!0;}};
 assert.equal(env.MissionDialogMdr.prototype.executeChoice.call(dialog,0),'native-choice');
 assert.deepEqual(env.nativeChoices,[0],'普通选项必须原样交给原版 executeChoice');
 assert.equal(dialog.hidden,undefined,'普通选项不该触发翻页那套先关再开');
});
