import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// 宠物幻化面板的「客户端行为」回归测试。
//
// 这里跑的是真正的 web/pet-illusion.js（在 VM 里 + 假 eui/egret/文档），盯住两条曾经踩过的坑：
//   ① 按钮点击原来是 source.onEgret 注册的，而 PetInfoMdr.doHide 会把 __egretHandler 里的监听
//      全部摘掉；视图又是复用的（Owner.showView 走 __mdrIns 缓存）—— 于是关一次界面，
//      幻化按钮就再也点不动了。现在改成直接挂在按钮上，本测试模拟一次 hide→show 后必须还能点。
//   ② 提交成功后 finally 里的 render() 会把状态文案重置成候选数量，看起来像「点了没反应」。
//   ③ 幻化后必须重新拉一次宠物详情（原生 doPetSeeMsg 有缓存，不会自己去拉）并让界面重画。

const SOURCE=fs.readFileSync(new URL('../web/pet-illusion.js',import.meta.url),'utf8');

class FakeNode{
 constructor(tag){this.tagName=tag;this.children=[];this.listeners=[];this.dataset={};this.attrs={};this.textContent='';this.value='';this.open=false;this.disabled=false;}
 append(...kids){for(const kid of kids)this.children.push(kid);}
 appendChild(kid){return this.addChild(kid);}
 addChild(kid){this.children.push(kid);return kid;}
 replaceChildren(...kids){this.children=kids.slice();}
 setAttribute(key,value){this.attrs[key]=value;}
 getChildAt(i){return this.children[i];}
 addEventListener(type,listener,thisObject){this.listeners.push({type,listener,thisObject});}
 removeEventListener(type,listener,thisObject){this.listeners=this.listeners.filter(item=>!(item.type===type&&item.listener===listener&&item.thisObject===thisObject));}
 showModal(){this.open=true;}
 close(){this.open=false;}
 getChildByPath(){return null;}
}

function makeButtonClass(){
 class Button extends FakeNode{
  constructor(){super('Button');this.width=80;this.height=30;}
 }
 return Button;
}

// 主包 Mdr 那套：onEgret 会把监听登记进 __egretHandler，doHide 再逐个摘掉。
function makePetInfoMdr(eui){
 const PetInfoMdr=function(){
  this.__egretHandler=[];
  this.updates=0;
  // 原生 PetInfoMdr.onBagEquipemntUpdate / updateView 都是拿 _proxy.data.getSelectedPet() 取的宠物。
  // petItem 就是这只宠物在背包里的那个道具对象（SelfPetsLsit 里是同一个引用），
  // 宠物列表与背包格子读的是它的 icon / petHeadIcon。
  this.pet={petItem:{slotPos:30,icon:7,petHeadIcon:8},icon1:1,PetHeadIcon:2,modelForPet:3};
  this._proxy={data:{getSelectedPet:()=>this.pet}};
  const view=new FakeNode('view');
  view.groupPetO=new FakeNode('group');
  view.groupPetO.layout={verticalGap:15};
  view.groupPetO.height=120;
  for(let i=0;i<8;i++)view.groupPetO.addChild(new eui.Button());
  this._view=view;
 };
 PetInfoMdr.prototype.onShow=function(){};
 PetInfoMdr.prototype.addListeners=function(){};
 PetInfoMdr.prototype.onEgret=function(target,type,listener,thisObject){
  this.__egretHandler.push({target,type,listener,thisObject});
  target.addEventListener(type,listener,thisObject);
 };
 PetInfoMdr.prototype.doHide=function(){
  this._view&&this._view.parent&&(this._view.parent.children=this._view.parent.children.filter(child=>child!==this._view));
  while(this.__egretHandler.length){
   const handler=this.__egretHandler.pop();
   handler.target.removeEventListener(handler.type,handler.listener,handler.thisObject);
  }
 };
 PetInfoMdr.prototype.updateView=function(){this.updates++;};
 return PetInfoMdr;
}

function harness(source=SOURCE){
 const eui={Button:makeButtonClass()};
 const egret={TouchEvent:{TOUCH_TAP:'touchTap'}};
 const document={body:new FakeNode('body'),createElement:tag=>new FakeNode(tag)};
 const window={};
 const PetInfoMdr=makePetInfoMdr(eui);
 // 宠物模块里的另一个页面：宠物列表页（靠自己的 initView() 组装列表，皮肤上有 listPets）
 const listPage={_view:{listPets:{}},initView(){this.rebuilds=(this.rebuilds||0)+1;}};

 const calls=[];
 const alerts=[];
 const decoded=[];
 const sent=[];
 const notifies=[];
 let worldRefreshes=0;
 const listPayload={
  slot:30,name:'六耳猕猴',current:null,
  candidates:[{key:'a:4',name:'六耳猕猴',grade:4,icon:1111,headIcon:22,model:33},
              {key:'b:4',name:'金翼大鹏',grade:4,icon:2222,headIcon:44,model:55}],
 };
 const applyPayload={ok:true,slot:30,current:{key:'a:4',name:'六耳猕猴'}};
 const fail=new Set();
 // 按协议类型给出固定的「状态字节 + 文案」应答
 const replyFor=type=>{
  if(fail.has(type))return {byte:-1,text:'服务未响应'};
  if(type===90023)return {byte:0,text:JSON.stringify(listPayload)};
  if(type===90024)return {byte:0,text:JSON.stringify(applyPayload)};
  return {byte:0,text:null};            // 15502 宠物详情：字节由 fromBytesDetail 消费
 };
 const modules={
  288:{PetInfoMdr},
  5:{default:{myPlayer:{id:7,refreshWorldSprite(){worldRefreshes++;}}}},
  1:{default:{alertMessage:message=>alerts.push(message)}},
  // 事件常量模块（主包 module 2 同时导出 BagEvent / MainEvent / PetEvent）
  2:{BagEvent:{BAG_ITEM_UPDATE:'bag_item_update',BAG_EQUIPMENT_UPDATE:'bag_equipment_update'},
     MainEvent:{ON_PET_ATTR_UPDATE:'ON_PET_ATTR_UPDATE',ON_PLAYER_ATTR_UPDATE:'on_player_attr_update'}},
  3:{default:{sendNt(type,value){notifies.push({type,value});}}},
  22:{Message:class{constructor(type){this.type=type;}putString(){return this;}putShort(){return this;}}},
  35:{default:{sendProtoAsync:async message=>{
   calls.push(message.type);
   const reply=replyFor(message.type);
   let at=0;
   return {getByte(){return at++===0?reply.byte:0;},getString(){return reply.text;}};
  }}},
  // icon1 在真机上是从 wire 读出来的 Long，这里用 toNumber() 模拟
  42:{default:{fromBytesDetail:(reader,vo)=>{decoded.push(vo);reader.getByte();vo.icon1={toNumber:()=>1111};vo.PetHeadIcon=22;vo.modelForPet=33;return 0;}}},
 };
 const req=id=>modules[id];
 vm.runInNewContext(source,{window,document,eui,egret,Promise,JSON,Number,Error,Object,String,Array,console});
 const api=window.installPetIllusion(req);
 assert.equal(api.revision,'pet-illusion-v3');
 const mdr=new PetInfoMdr();
 mdr._view.__mdr__=mdr;
 mdr._view.parent=new FakeNode('parent');
 mdr._view.parent.appendChild(mdr._view);
 // 同一个 Pet 模块的实例表（主包 Owner.__mdrIns），列表页和自己都在里面
 mdr._owner={__mdrIns:{PetInfoMdr:mdr,PetListMdr:listPage}};
 // 出战宠物：主包 myPlayer.pet 就是场景里那只宠物对象的 vo（setPet 时 sendNt(ON_PET_ADD, e)）
 const world=modules[5].default.myPlayer;
 world.pet=mdr.pet;
 const button=()=>mdr._view.groupPetO.children.find(child=>child.name==='btnPetIllusion');
 const tap=node=>{
  for(const item of [...node.listeners])if(item.type===egret.TouchEvent.TOUCH_TAP)item.listener({target:node});
 };
 return {api,eui,egret,document,window,mdr,button,tap,calls,alerts,decoded,sent,notifies,listPayload,fail,listPage,world,
  worldRefreshes:()=>worldRefreshes};
}

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('幻化按钮在「关闭界面再打开」之后依然能点（doHide 不再摘掉监听）',async()=>{
 const h=harness();
 h.mdr.addListeners();h.mdr.onShow();
 const button=h.button();
 assert.ok(button,'按钮组里应该多出一个幻化按钮');
 assert.equal(button.label,'幻化');
 assert.equal(button.skinName,'CancelBtnSkin');
 // 监听必须直接挂在按钮上，不能进 Mdr 的 __egretHandler（那份名单会被 doHide 清空）。
 assert.equal(h.mdr.__egretHandler.length,0,'幻化按钮的监听不能登记进 __egretHandler');
 assert.equal(button.listeners.filter(item=>item.type===h.egret.TouchEvent.TOUCH_TAP).length,1);

 // 关一次界面：doHide 会摘掉 __egretHandler 里的全部监听
 h.mdr.doHide();
 assert.equal(button.listeners.length,1,'直接挂在按钮上的监听不该被 doHide 摘掉');

 // 再打开（视图复用，不会重建）
 h.mdr.addListeners();h.mdr.onShow();
 assert.equal(h.button(),button,'视图复用时按钮是同一个对象');
 assert.equal(button.listeners.filter(item=>item.type===h.egret.TouchEvent.TOUCH_TAP).length,1,'重复显示不能把监听挂两遍');
 assert.equal(button.height,30,'按钮尺寸跟同组一致');

 // 这一下点击必须真的打开面板并拉到候选列表
 h.tap(button);
 await tick();
 assert.deepEqual(h.calls,[90023],'点击幻化应该发一次候选列表请求');
 assert.equal(h.document.body.children[0].open,true,'面板要弹出来');
 const rows=h.document.body.children[0].children.find(child=>child.className==='pet-illusion-list').children;
 assert.equal(rows.length,2,'候选列表要渲染出来');
});

test('幻化成功后状态文案保留，并且会重拉宠物详情 + 让界面重画',async()=>{
 const h=harness();
 h.mdr.addListeners();h.mdr.onShow();
 h.tap(h.button());
 await tick();
 const dialog=h.document.body.children[0];
 const listNode=dialog.children.find(child=>child.className==='pet-illusion-list');
 const statusNode=dialog.children.find(child=>child.className==='pet-illusion-status');
 listNode.children[0].onclick();
 await tick();
 await tick();
 // ① 反馈文案不能被 finally 里的 render() 覆盖成候选数量
 assert.equal(statusNode.textContent,'已幻化成「六耳猕猴」。');
 // ② 幻化后必须主动重拉宠物详情（原生 doPetSeeMsg 有缓存不会自己拉）
 assert.ok(h.calls.includes(15502),'必须重新请求宠物详情');
 assert.equal(h.decoded.length,1,'官方解析器要把新外观写回本地宠物对象');
 // ③ 重拉之后界面重画一次
 assert.ok(h.mdr.updates>=1,'宠物界面要重新绘制');
});

test('幻化后背包宠物道具、宠物列表、场景贴图都要跟着更新',async()=>{
 const h=harness();
 h.mdr.addListeners();h.mdr.onShow();
 h.tap(h.button());
 await tick();
 const dialog=h.document.body.children[0];
 const listNode=dialog.children.find(child=>child.className==='pet-illusion-list');
 listNode.children[0].onclick();
 await tick();
 await tick();
 // 宠物列表（PetListMdr → PetItem）与背包格子读的是 petItem.icon / petItem.petHeadIcon，
 // 不是宠物对象上的 icon1；幻化后必须把新外观写回那个道具对象。
 assert.equal(h.mdr.pet.petItem.icon,1111,'宠物列表用的 petItem.icon 要更新');
 assert.equal(h.mdr.pet.petItem.petHeadIcon,22,'宠物头像用的 petItem.petHeadIcon 要更新');
 // 通知：背包/宠物格重画 + 宠物头像组件
 assert.deepEqual(h.notifies.map(item=>item.type),['bag_item_update','ON_PET_ATTR_UPDATE']);
 // 场景里的随行宠物贴图：靠玩家 refreshWorldSprite 连带重建（光发 ON_PET_ADD 不够）
 assert.equal(h.worldRefreshes(),1,'要触发一次玩家/随行宠物的贴图重建');
 // 宠物列表页要就地重建一次（它只在 onShow 时重建，幻化时它并没有被重新显示）
 assert.equal(h.listPage.rebuilds,1,'宠物列表页要重新组装一次');
 // 解析器必须写进「场景里那只宠物对象」本身（myPlayer.pet），否则随行宠物贴图不会变
 assert.equal(h.decoded[0],h.world.pet,'要把新外观写回出战宠物同一个对象');
 assert.equal(h.mdr.pet.petItem.icon,1111);
});

test('重拉宠物详情失败时不写坏背包道具，幻化本身照常成功',async()=>{
 const h=harness();
 h.fail.add(15502);                       // 详情请求返回错误状态字节
 h.mdr.addListeners();h.mdr.onShow();
 h.tap(h.button());
 await tick();
 const dialog=h.document.body.children[0];
 const listNode=dialog.children.find(child=>child.className==='pet-illusion-list');
 const statusNode=dialog.children.find(child=>child.className==='pet-illusion-status');
 listNode.children[0].onclick();
 await tick();
 await tick();
 // 解析没成功就不能往背包道具上写「外观」，免得把旧的当成新的写进去
 assert.equal(h.mdr.pet.petItem.icon,7,'详情拉取失败时不能动 petItem.icon');
 assert.equal(h.mdr.pet.petItem.petHeadIcon,8,'详情拉取失败时不能动 petItem.petHeadIcon');
 // 但幻化本身（服务端已经保存）照样要给成功提示
 assert.equal(statusNode.textContent,'已幻化成「六耳猕猴」。');
 assert.equal(h.decoded.length,0,'解析器不该在失败应答上被调用');
});

test('面板打开后不会因为原始 onEgret 清空而失去点击能力（连续两轮幻化）',async()=>{
 const h=harness();
 h.mdr.addListeners();h.mdr.onShow();
 h.tap(h.button());
 await tick();
 const dialog=h.document.body.children[0];
 const listNode=dialog.children.find(child=>child.className==='pet-illusion-list');
 listNode.children[0].onclick();
 await tick();await tick();
 // 关掉面板 + 关掉宠物界面
 dialog.close();
 h.mdr.doHide();
 h.mdr.addListeners();h.mdr.onShow();
 dialog.close();
 h.tap(h.button());
 await tick();
 assert.deepEqual(h.calls,[90023,90024,15502,90023],'第二轮点击依然要能发出候选列表请求');
 assert.equal(dialog.open,true);
});

test('回归：换回 onEgret 注册就会被 doHide 摘掉（证明上面那条测试确实盯住了根因）',async()=>{
 const legacy=SOURCE.replace(
  'button.addEventListener(egret.TouchEvent.TOUCH_TAP,view.__petIllusionTap,view);',
  'source.onEgret(button,egret.TouchEvent.TOUCH_TAP,view.__petIllusionTap,source);');
 assert.notEqual(legacy,SOURCE,'替换锚点必须还在，否则这条回归测试就失去意义了');
 const h=harness(legacy);
 h.mdr.addListeners();h.mdr.onShow();
 const button=h.button();
 // 旧写法把监听登记进了 __egretHandler
 assert.equal(h.mdr.__egretHandler.length,1);
 h.mdr.doHide();
 assert.equal(button.listeners.length,0,'doHide 会把 onEgret 注册的监听摘干净 —— 这就是原来「点不动」的原因');
 h.mdr.addListeners();h.mdr.onShow();
 h.tap(button);
 await tick();
 assert.deepEqual(h.calls,[],'旧写法下第二次点击发不出任何请求');
 assert.deepEqual(h.alerts,[],'按钮彻底哑掉：连「请先选择一只自己的宠物」这类提示都不会出现');
 assert.equal(h.document.body.children[0].open,false,'面板也不会被重新打开');
});
