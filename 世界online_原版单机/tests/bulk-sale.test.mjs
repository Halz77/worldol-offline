import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Writer,Reader} from '../lib/codec.mjs';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {SaveStore} from '../lib/store.mjs';
const d=decoders(fileURLToPath(new URL('..',import.meta.url)));
class Message extends Writer{constructor(type){super();this.type=type;}putShort(n){this.short(n);}putInt(n){this.int(n);}}
function role(){const p=normalizeRole({id:1001,name:'批量出售测试',level:97,job:1,race:0,sex:1,mapId:19,bagLimit:300,coins:1000,gold:13,silver:17});p.inventory=[{itemId:22,slot:30,quantity:99},{itemId:40007,slot:128,quantity:99},{itemId:2056,slot:329,quantity:1},{itemId:40067,slot:31,quantity:44}];return p;}
function request(items){let sent;d.native(890,'doSellItem',{A:{default:{myPlayer:{bag:{}}}},a:{Message},S:{default:{CG_AUTO_SELL:12037}},n:{default:{Service:{sendProto(m){sent=m;}}}}})({size:()=>items.length,elementAt:i=>({id:items[i].itemId,slotPos:items[i].slot,quantity:items[i].quantity})});return sent;}
function harness(p,save=()=>{}){const context={role:p},sent=[];return {context,sent,call(w,type=12037){assert.equal(handleRestoration(type,new Reader(w.done()),context,{store:{save},send(type,w){sent.push({type,bytes:w.done()});},log(){}}),true);return sent.findLast(s=>s.type===type).bytes;}};}
function nativeReply(bytes,before){
 const p={bag:{getBagItemBySlotPos(slot){const item=before.inventory.find(i=>i.slot===slot);assert.ok(item);return {getNameInfo:()=>String(item.itemId)};},removeBagItemByPos(slot,quantity){const i=before.inventory.find(i=>i.slot===slot);i.quantity-=quantity;before.inventory=before.inventory.filter(i=>i.quantity>0);}}},r=new NativeReader(bytes),notices=[];
 d.native(890,'onGetAutoSell',{A:{default:{myPlayer:p}},T:{default:{alertMessage(s){throw Error(s);},showModal(...args){notices.push(args);}}},f:{Tool:{manageStringList:(template,values)=>values}},d:{GameText2:{STR_AUTO_SELL_ALERT_INFO:''}},l:{ModName:{Shop:1},ShopViewType:{ShopAutoSellResult:2}},s:{ShopEvent:{SHOP_SELL_SUCCESS:3}}}).call({sendNt(n){assert.equal(n,3);}},{body:r});r.finish();return {p,notices};
}
test('native batch sale removes exactly the selected stacks, credits the displayed total and persists once',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-bulk-sale-'));
 try{
  const p=role(),before=structuredClone(p),store=new SaveStore(dir);store.data.characters.push(p);store.save();let saves=0;
  const h=harness(p,()=>{saves++;store.save();}),items=p.inventory.slice(0,3),w=request(items);assert.equal(w.type,12037);
  const reply=h.call(w),decoded=nativeReply(reply,before);assert.equal(saves,1);assert.equal(p.coins,12190);assert.deepEqual(p.inventory,[{itemId:40067,slot:31,quantity:44}]);
  assert.deepEqual(before.inventory,p.inventory);assert.deepEqual([decoded.p.money1,decoded.p.money2,decoded.p.money3],[13,17,12190]);assert.equal(decoded.notices[0][2].str[1],'11190 ');
  assert.equal(p.dailyActivity.progress[22],1);assert.deepEqual(new SaveStore(dir).data.characters[0],p);
  const saved=structuredClone(p),r=new Reader(h.call(w));assert.equal(r.short(),-1);assert.ok(r.string());assert.deepEqual(p,saved);assert.equal(saves,1);
 }finally{const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-bulk-sale-'));fs.rmSync(exact,{recursive:true});}
});
test('partial sales and bag pets use native displayed prices without altering other slots or pet equipment',()=>{
 const p=role();p.inventory.push({itemId:24,slot:40,quantity:1,pet:{name:'出售宠物',equipment:[]}});
 const h=harness(p),before=structuredClone(p),reply=h.call(request([{itemId:22,slot:30,quantity:9},{itemId:24,slot:40,quantity:1}]));nativeReply(reply,before);
 assert.equal(p.coins,1090);assert.equal(p.inventory[0].quantity,90);assert.equal(p.inventory.some(i=>i.slot===40),false);assert.deepEqual(before.inventory,p.inventory);
});
test('invalid selections, duplicate slots, overflow, battle and disk failures are atomic',()=>{
 for(const kind of ['empty','duplicate','missing','wrong-id','equipped','pet-equipment','zero','negative','excess','overflow','battle','truncated','extra','save']){
  const p=role(),items=[{...p.inventory[0],quantity:3},{...p.inventory[1]}];
  if(kind==='empty')items.length=0;if(kind==='duplicate')items[1]={...items[0]};if(kind==='missing')items[1].slot=328;if(kind==='wrong-id')items[1].itemId=22;
  if(kind==='equipped'){p.inventory[1].slot=8;items[1].slot=8;}
  if(kind==='pet-equipment'){p.inventory[1]={itemId:24,slot:128,quantity:1,pet:{equipment:[{itemId:123,slot:0}]}};items[1]={...p.inventory[1]};}
  if(kind==='zero')items[1].quantity=0;if(kind==='negative')items[1].quantity=-1;if(kind==='excess')items[1].quantity=100;if(kind==='overflow')p.coins=2147483640;
  let w=request(items);if(kind==='truncated')w=new Writer().raw(w.done().subarray(0,-1));if(kind==='extra')w.byte(0);
  let saves=0;const h=harness(p,()=>{saves++;if(kind==='save')throw Error('disk full');});if(kind==='battle')h.context.battle={};
  const before=structuredClone(p),r=new Reader(h.call(w));assert.equal(r.short(),-1,kind);assert.ok(r.string());assert.deepEqual(p,before,kind);assert.equal(saves,kind==='save'?1:0);assert.equal(h.sent.length,1);
 }
});
test('opening native sale view does not preselect valuable goods or leave an unsupported request',()=>{
 const p=role(),before=structuredClone(p),h=harness(p),r=new NativeReader(h.call(new Writer(),12036));
 d.native(890,'onGetAutoSellList',{A:{default:{myPlayer:{bag:{}}}}})({body:r});r.finish();assert.deepEqual(p,before);
});
