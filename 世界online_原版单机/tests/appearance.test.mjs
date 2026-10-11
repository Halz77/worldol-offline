import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {decoders} from '../tools/capture-decoders.mjs';
import {equipment} from '../lib/restoration.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root);
test('native equipment appearance survives world reloads, and shop hairstyle/face swaps stay live',()=>{
 const MC={...d.module(12).constants};
 const source=fs.readFileSync(new URL('../analysis/modules/0012.js',import.meta.url),'utf8');
 for(const m of source.matchAll(/e\.(LEN_\w+)\s*=\s*e\.BIT_(\d+)/g))MC[m[1]]=2**Number(m[2])-1;
 const update=d.native(56,'updateIcon',{_:{ModelConst:MC},s:{default:d.module(33).constants},a:{Tool:{getBitNum:n=>Math.floor(Math.log2(n))+1}},d:{ModelVo:{setHandAndFeet:i=>i}}});
 let refreshed=0;
 class Player{get(){return 1;}clearMemberHideStatus(){}refreshWorldSprite(){refreshed++;}}
 const long=n=>({low:Number(BigInt.asIntN(32,BigInt(n))),high:Number(BigInt.asIntN(32,BigInt(n)>>32n)),isZero(){return !this.low&&!this.high;}});
 Player.setIconValue=d.native(56,'setIconValue');
 Player.prototype.updateIconByFashion=d.native(56,'updateIconByFashion',{t:Player,_:{ModelConst:MC},s:{default:d.module(33).constants}});
 Player.prototype.updateIcon=update;
 Player.prototype.updateAndRefreshIcon=d.native(56,'updateAndRefreshIcon');
 // 美容院的造型道具走原版 updateHair / updateFace。offline.js 会给这两个方法包一层，
 // 所以在 offlineInstall() 之前先把原版实现装上。
 const swapScope={a:{Tool:{getBitNum:n=>Math.floor(Math.log2(n))+1}},_:{ModelConst:MC}};
 Player.prototype.updateHair=d.native(56,'updateHair',swapScope);
 Player.prototype.updateFace=d.native(56,'updateFace',swapScope);
 const p=new Player(),world={myPlayer:p},handler={processMissionReward(){},processDataPlayerDetail(){
  p.icon1={low:2240393,high:0};p.icon2={low:0,high:0};p.icon3={low:0,high:0};
 },processDataBlockFlagMsg(items){
  // Native full-world packets read base actor icons before replacing its bag.
  this.processDataPlayerDetail(null,p);
  p.bag={getItem:slot=>{const instance=items.find(i=>i.slot===slot);if(!instance)return null;const item={...equipment.get(instance.itemId),getWeaponFlashType:()=>0,isTimeItem:()=>false};for(const key of ['fashIcon1','fashIcon2','fashIcon3'])if(item[key])item[key]=long(item[key]);return item;}};
 }};
 class Book{tapItemSelect(){}tapItemSelect2(){}}
 class Country{getPreLevel(){return 0;}}
 class Notice{}
 class Pet extends Player{}
 const modules={5:{default:world},8:{Tool:{getIconByData:()=>''}},12:{ModelConst:MC},18:{default:handler},22:{Message:class{}},56:{default:Player},132:{default:{getRes:()=>null}},360:{default:Notice},1001:{default:Country},1150:{default:Book}};
 modules[42]={default:Pet};
 // offline.js 还会装一堆本地功能，它们各自 req 一些游戏模块。这个用例只关心外观，
 // 所以只给这些模块留最小可用的壳：顶层会读到的属性得存在，方法留空实现。
 modules[0]={ModName:{Scene:'Scene',Raiders:'Raiders'},ProxyType:{Scene:'Scene'},RaidersViewType:{BookGroupMain:'BookGroupMain'}};
 modules[1]={default:{EVENT_ALL_MENU_CSS:-1,alertMessage(){},createChiselSealUI(){}}};
 modules[2]={SkillEvent:{DO_SET_AUTO_SKILL:1}};
 modules[3]={default:{sendNt(){},getProxy:()=>({})}};
 modules[10]={GameText:{TI_ERROR:'error',getText:key=>String(key)}};
 modules[35]={default:{sendProtoAsync:()=>Promise.resolve()}};
 modules[38]={ActType:{DAILY_GAME:1,ACTIVITY_VITALIY:2}};
 modules[45]={default:{getInstance:{getTypeRed:()=>({})}}};
 modules[54]={default:{ins:{isFight:false,battle:null}}};
 modules[57]={default:{}};modules[61]={default:{}};
 modules[67]={ShopItem:{openItemShop(){}}};
 modules[197]={default:{Instance:{doEnterWorldMap(){}}}};
 modules[737]={MissionDialogMdr:function(){}};
 const element={classList:{add(){},remove(){},toggle(){}}};
 const window={addEventListener(){},installRecordedContent(){},installCareerTeachers:()=>({snapshot:()=>({})}),installEquipmentComposition:()=>({open(){}}),installCombatRating:()=>({snapshot:()=>null}),__worldReq:id=>{if(!modules[id])throw Error('Unexpected module '+id);return modules[id];}};
 window.installCharacterFeatures=()=>({snapshot:()=>null});window.installNativeVip=()=>{};window.installHomeFeatures=()=>{};window.installNativeFeatures=()=>{};window.installNativeCommerce=()=>{};
 window.installOfflineRoleSlots=()=>{};window.installDailyTaskReset=()=>{};window.installNativePetShop=()=>{};
 // offline.js 还装了一堆本地补丁；这个用例只关心外观，所以给它们空的实现。
 window.installOfflineViewport=()=>({revision:'offline-viewport-test'});window.installOfflineSystemSettings=()=>{};
 window.installEquipmentWorkshop=()=>{};window.installPetEquipment=()=>{};window.installSpiritSeals=()=>({});
 window.installPetIllusion=()=>({revision:'pet-illusion-test'});
 window.installOfflineLegion=()=>({revision:'legion-manual-orders-20260923-v2',snapshot:()=>null,battleResult:()=>[]});
 vm.runInNewContext(fs.readFileSync(new URL('../web/pet-snapshot-vitals.js',import.meta.url),'utf8'),{window});
 vm.runInNewContext(fs.readFileSync(new URL('../web/offline.js',import.meta.url),'utf8'),{window,document:{getElementById:()=>element},gg:{},gs:{},go:{},fetch:async()=>({json:async()=>({itemIds:[]})}),setInterval(){},URLSearchParams,location:{search:'',port:'8779',origin:'http://127.0.0.1:8779'}});
 window.offlineInstall();
 assert.match(element.textContent,/军团手动指令已载入：legion-manual-orders-20260923-v2/);
 const both=[{itemId:20300,slot:8},{itemId:20303,slot:10}];
 handler.processDataBlockFlagMsg(both);
 const weapons=()=>[(p.icon2.low>>>MC.OFFSET_LWEAPON_STYLE)&MC.LEN_LWEAPON_STYLE,(p.icon2.low>>>MC.OFFSET_RWEAPON_STYLE)&MC.LEN_RWEAPON_STYLE];
 assert.deepEqual(weapons(),[1,3]);assert.equal(refreshed,1);
 handler.processDataBlockFlagMsg(both);assert.deepEqual(weapons(),[1,3]);assert.equal(refreshed,2);
 handler.processDataBlockFlagMsg(both.slice(0,1));assert.deepEqual(weapons(),[1,0]);
 handler.processDataBlockFlagMsg([]);assert.deepEqual(weapons(),[0,0]);
 const hair=()=>((p.icon1.low>>>MC.OFFSET_HAIR_STYLE)&MC.LEN_HAIR_STYLE)+(((p.icon1.high>>>MC.OFFSET_HAIR_ADD)&MC.LEN_HAIR_ADD)<<4);
 const baseHair=hair(),wear=[...both,{itemId:15209,slot:3}];
 assert.match(equipment.get(15209).info,/光头/);
 handler.processDataBlockFlagMsg(wear);assert.equal(hair(),16);assert.deepEqual(weapons(),[1,3]);assert.equal((p.icon3.low>>>30)&1,1);
 p.updateAndRefreshIcon();assert.equal(hair(),16);
 wear.pop();p.updateAndRefreshIcon();assert.equal(hair(),baseHair);assert.equal((p.icon3.low>>>30)&1,0);assert.deepEqual(weapons(),[1,3]);

 // 美容院的造型道具：客户端购买与「商店列表点选预览」（ModelTool.getCompareSprite）都走
 // updateHair / updateFace 改写 icon1，紧接着 updateIcon() 重建整套外观。
 // offline.js 那层基准（baseFaces）如果不跟着换，updateIcon 会把刚写进去的造型还原，
 // 表现就是「脱掉时装后点选发型/脸型，角色预览一动不动」。
 const face=()=>(p.icon1.low>>>MC.OFFSET_FACE_STYLE)&MC.LEN_FACE_STYLE;
 const faceBase=face();
 p.updateHair({icon:2}); // 客户端读商品的 icon：男性发型碎片 2 = 样式 1·颜色 1
 p.updateIcon();
 assert.equal(hair(),1,'updateHair 写进去的发型被 updateIcon 还原了，商店预览会一动不动');
 assert.equal(face(),faceBase,'只换发型时不能动脸型');
 p.updateHair({icon:23}); // 样式 3·颜色 2
 p.updateIcon();
 assert.equal(hair(),3,'第二次预览也要能换到新款式');
 p.updateFace({icon:1009}); // 脸型样式 2
 p.updateIcon();
 assert.equal(face(),2,'updateFace 写进去的脸型被 updateIcon 还原了');
 assert.equal(hair(),3,'只换脸型时不能动发型');
});
