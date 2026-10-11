import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
import {Reader,Writer} from '../lib/codec.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {handleRecorded} from '../lib/recorded-service.mjs';
import {recordedFinishedPets} from '../lib/recorded-content.mjs';
import {normalizeRole} from '../lib/content.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
function harness(){
 const d=decoders(root),alerts=[],notifications=[],tips=[],previews=[],modals=[],requests=[];
 const p=normalizeRole({id:1001,name:'原版宠物分类验收',level:97,race:0,job:1,mapId:303});p.inventory=[];p.bagLimit=90;
 let failure=false,saves=0;
 const server=(type,body)=>{let reply;const env={store:{save(){if(failure)throw Error('disk full');saves++;}},send(t,w){if(t===type)reply=w.done();},log(){}};assert.ok(handleRecorded(type,new Reader(body),{role:p},env)||handleRestoration(type,new Reader(body),{role:p},env));return reply;};
 class Message extends NativeReader{
  constructor(type,bytes=Buffer.alloc(0)){super(bytes);this.type=type;this.writer=new Writer();}
  putInt(v){this.writer.int(v);}
  getLong(){const v=super.getLong();v.toString=v.toJSON;return v;}
 }
 const Item=d.Item;Item.prototype.isTimeItem=()=>false;
 Item.fromBytesAtts1=d.native(32,'fromBytesAtts1',{e:Item});
 Item.fromBytes=d.native(32,'fromBytes',{e:Item});
 class Shop extends Item{getMoneyType(){return 0;}}
 Shop.fromBytesShopItem=d.native(67,'fromBytesShopItem',{t:Shop,S:{default:Item}});
 Shop.prototype.getShopItemIsInTime=d.native(67,'getShopItemIsInTime',{a:{default:{timer:{serverTime:0}}}});
 Shop.doItemShopBuyMsg=()=> 'ordinary-item-buy';
 const bag=new Map(),player={id:1001,bag:{setItem(item,slot){bag.set(slot,item);}}},world={shopID:2000,myPlayer:player};
 const modules={
  0:{ModName:{Shop:'shop'},ShopViewType:{ShopNewBuyAlert:'buy-alert'}},
  1:{default:{alertMessage:m=>alerts.push(m),checkPet:(...a)=>previews.push(a),showModal:(...a)=>modals.push(a)}},
  2:{BagEvent:{BAG_EQUIPMENT_UPDATE:'bag-update'},ShopEvent:{SHOP_BUY_SUCCESS:'shop-buy'}},
  3:{default:{sendNt:(...a)=>notifications.push(a)}},4:{default:d.constants,ShopItemType:{ordinary:1,equipment:2,pet:3}},5:{default:world},
  6:{default:function Base(){}},7:{default:function Renderer(){}},9:{Layer:{}},15:{Tips:{show:m=>tips.push(m)}},
  22:{Message},32:{default:Item},35:{default:{async sendProtoAsync(message){requests.push(message.type);return new Message(message.type,server(message.type,message.writer.done()));}}},
  42:{default:{async doSeeRaidersPet(id){const r=new NativeReader(server(15514,new Writer().int(id).done()));assert.equal(r.getByte(),0);return {sampleId:id,bytes:r.b.subarray(r.pos)};}}},
  67:{ShopItem:Shop},93:{default:class {}},
 };
 const scope={window:{},console,__extends:(child,parent)=>{child.prototype=Object.create(parent.prototype);child.prototype.constructor=child;Object.setPrototypeOf(child,parent);}};
 const req=id=>modules[id]||{};
 for(const id of[205,206,916]){modules[id]={};vm.runInNewContext('('+fs.readFileSync(new URL(`../analysis/modules/${String(id).padStart(4,'0')}.js`,import.meta.url),'utf8')+')',scope)({},modules[id],req);}
 vm.runInNewContext(fs.readFileSync(new URL('../web/native-pet-shop.js',import.meta.url),'utf8'),scope);scope.window.installNativePetShop(req);
 const list=(shop=2000)=>{const r=new Message(12004,server(12004,new Writer().short(shop).done()));assert.equal(r.getByte(),0);const n=r.getShort(),items=Array.from({length:n},()=>Shop.fromBytesShopItem(r,shop));r.finish();return items;};
 return {p,server,list,Shop,bag,player,world,alerts,notifications,tips,previews,modals,requests,modules,failSave(){failure=true;},saved:()=>saves};
}
test('all VIP shop replies place the finished pets in the actual native pet category, with separate template identities',()=>{
 const h=harness();
 for(const shopId of[2000,2002,2003,2004]){
  const all=h.list(shopId),pets=all.filter(i=>i.typeForShop===3);assert.equal(pets.length,recordedFinishedPets.size);
  assert.equal(new Set(pets.map(i=>i.id)).size,pets.length);
  for(const item of pets){const source=recordedFinishedPets.get(item.offlinePetSampleId);assert.ok(source);assert.equal(item.id,source.id);assert.equal(item.name,source.name);assert.equal(item.reqLv,97);assert.equal(item.stackNum,1);assert.equal(item.money1+item.money2+item.money3,0);assert.equal(item.maxBuy,-1);}
  const mdr=Object.assign(Object.create(h.modules[205].ShopBuyItemNewMdr.prototype),{_proxy:{data:{ShopItemList:{arr:all}}},_view:{listItemType:{selectedIndex:2}},_dataItemList:{}});
  mdr.updateView();assert.deepEqual(Array.from(mdr._dataItemList.source),pets);
  for(const index of[0,1]){mdr._view.listItemType.selectedIndex=index;mdr.updateView();assert.ok(mdr._dataItemList.source.every(item=>item.typeForShop!==3));}
 }
 assert.ok(h.list(901).every(i=>i.offlinePetSampleId===undefined));
});
test('native pet row and buy modal purchase the corresponding real pet, while help opens its native detail window',async()=>{
 const h=harness(),item=h.list().find(i=>i.offlinePetSampleId!==undefined);
 const row=Object.assign(Object.create(h.modules[206].ListShopNewItem.prototype),{data:item});row.tapSelf();assert.equal(h.modals[0][2].shopItem,item);
 await row.tapHelp();assert.equal(h.previews[0][2],4);assert.equal(h.previews[0][3].sampleId,item.id);
 const popup=Object.assign(Object.create(h.modules[916].default.prototype),{_showArgs:{shopItem:item},_view:{groupStackNum:{}},hideView(){this.hidden=true;}});
 popup.onConfirm();await new Promise(resolve=>setImmediate(resolve));assert.ok(popup.hidden);assert.equal(h.requests[0],90004);assert.equal(h.p.inventory.length,1);
 const owned=h.p.inventory[0];assert.equal(owned.pet.templateId,item.id);assert.deepEqual(owned.pet.skills,recordedFinishedPets.get(item.id).skills);assert.ok(BigInt(owned.pet.uid)>0n);assert.equal(h.bag.get(owned.slot).petId.toString(),owned.pet.uid);assert.equal(h.saved(),1);assert.ok(h.notifications.some(n=>n[0]==='shop-buy'));assert.equal(h.alerts.length,0);
 assert.equal(await h.Shop.doItemShopBuyMsg(h.player,{id:787},1),'ordinary-item-buy');
});
test('native pet purchase prevents double clicks and leaves the client bag empty on save or capacity failure',async()=>{
 const h=harness(),item=h.list().find(i=>i.offlinePetSampleId!==undefined);
 const first=h.Shop.doItemShopBuyMsg(h.player,item,1),second=h.Shop.doItemShopBuyMsg(h.player,item,1);assert.equal(await second,false);assert.equal(await first,true);assert.equal(h.p.inventory.length,1);
 for(const mode of['disk','full','level']){const f=harness(),offer=f.list().find(i=>i.offlinePetSampleId!==undefined);if(mode==='disk')f.failSave();if(mode==='full'){f.p.bagLimit=1;f.p.inventory=[{itemId:787,slot:30,quantity:1}];}if(mode==='level')f.p.level=1;const before=structuredClone(f.p);assert.equal(await f.Shop.doItemShopBuyMsg(f.player,offer,1),false);assert.deepEqual(f.p,before);assert.equal(f.bag.size,0);assert.equal(f.alerts.length,1);}
});
