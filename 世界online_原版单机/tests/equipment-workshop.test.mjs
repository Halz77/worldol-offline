import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {starLimit} from '../lib/equipment-policy.mjs';
// 浏览器里那条 window.worldolEquipmentRules 是 server.mjs / globals.mjs 拼出来的，
// 这里照抄同一份，免得测试里的规则和真正下发的不一致。
import {upgradeRules,upgradeIdentifyItemIds} from '../lib/item-affixes.mjs';
const browserRules={...upgradeRules,advanced:{...upgradeRules.advanced,identifyItemIds:upgradeIdentifyItemIds()}};

function fixture(){
  // 最小 DOM：equipment-workshop 只用到追加选项、读写 value/textContent/disabled
  // 和几个弹窗方法，够驱动刷新与一键强化即可。
  const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{id,options:[],children:[],value:'',textContent:'',disabled:false,
    classList:{remove(){},add(){}},replaceChildren(){this.options=[];this.children=[];this.value='';},
    // 单选下拉的首项会被自动选中，刷新后才能读到当前装备，否则 select.value 一直是空。
    append(node){this.children.push(node);this.options.push(node);if(!this.options.some(o=>String(o.value)===String(this.value)))this.value=String(node.value);},
    showModal(){this.open=true;},close(){this.open=false;}});return elements.get(id);},calls=[];
  const document={getElementById:element,createElement:()=>({value:'',textContent:''})};
  class Item{isAttackBroken(){return !!this.broken;}isCanUse(){return false;}getItemClass(){return 99;}}
  Item.CAN_USE_WORLD=1;Item.ITEM_CLASS_USE_ITEM=5;Item.COMPARE_IDENTIFY=2;Item.getEquipCompareDesc=(a,b)=>`${b.powerValue1}->${a.powerValue1}`;
  class Proxy{async sendIdentifyAskMsg(){}sendNt(event){calls.push(event);}}
  let reply;const Handler={createIdentifyAsk:()=>({}),getReceiveMsg:()=>reply};
  const World={doWorldUseItemAction(){calls.push('medicine');},doWorldAttachItemMenu(){},ITEM_STAR_TYPE1:1,ITEM_STAR_TYPE2:2,
    doItemStarMenu(){return '';},doItemUpgradeStarMenu(){return '';}};
  const action={updatePlayerEquipPopMenu:item=>({itemClass:item.getItemClass(),canUse:item.isCanUse(1),type:item.type})};
  // 事件常量取自 a.ModName 那一族的真实值（12001/12002/12004），一键到满靠 type 区分普通与进阶。
  const modals=[];
  // 镶嵌是 12005，和强化那三条取自同一个 UI 常量表。
  const UI={alertMessage:s=>calls.push(s),updateIdentifyMessageUI:()=>calls.push('result'),
    EVENT_COMMON_STAR:12001,EVENT_UPGRADE_STAR:12002,EVENT_UPGRADE_IDENTIFY:12004,EVENT_ATTACH_TYPE_ATTCH:12005,
    showModal:(name,view,args)=>modals.push({name,view,args})};
  // 485/483 是装备详情里的「强化」选择面板与结果面板，两个面板都靠 prototype 方法接入。
  class Collection{constructor(source){this.source=source;}}
  class UpStarMdr{initView(){const source=[{type:UI.EVENT_COMMON_STAR,name:'强化升星'}];if(this._showArgs.item.isUpgradeItem)source.push({type:UI.EVENT_UPGRADE_STAR,name:'进阶强化'});this._listBtnData=new Collection(source);}
    onTapList(event){modals.push({name:'native',args:{type:event.item.type,item:this._showArgs.item}});}
    hideView(){}}
  class UpStarInfoMdr{onShow(){this._view.textDes.text='';this._canUp=true;return this.initView();}
    async initView(){return World.doItemStarMenu(this._showArgs.item,World.ITEM_STAR_TYPE1);}}
  // 462 是装备详情里的「镶嵌」面板：左边选宝石，右边一列按钮，镶完一颗就重建一次列表。
  class AttachMdr{
    initView(){
      const item=this._showArgs?.attachItem;if(!item||!this._showArgs?.player)return this.hideVeiw();
      this._gemItem=null;this._gemList=this._showArgs.player.bag.getAttachGemItemList(item)||[];
      this._listBtnData=new Collection([{type:UI.EVENT_ATTACH_TYPE_ATTCH,name:'镶嵌'}]);
    }
    updateView(){
      const item=this._showArgs?.attachItem;if(!item)return this.hideVeiw();
      this._gemList=this._showArgs.player.bag.getAttachGemItemList(item)||[];
      // 原生在这句之后会提示「已经没有符合条件的宝石了」并关掉面板。
      if(!this._gemList.length)return this.hideVeiw();
      this._listBtnData=new Collection([{type:UI.EVENT_ATTACH_TYPE_ATTCH,name:'镶嵌'}]);
    }
    updateTapItem(gem){this._gemItem=gem;}
    tapItem(event){this.updateTapItem(event.item);}
    onTapList(event){modals.push({name:'native-gem',args:{type:event.item.type,item:this._showArgs.attachItem}});}
    hideVeiw(){this.hidden=true;}
  }
  const modules={5:{default:World},1:{default:UI},32:{default:Item},18:{default:Handler},0:{ModName:{Bag:'bag'},BagViewType:{ItemUpStarInfo:'star-info'}},
    2:{BagEvent:{BAG_EQUIPMENT_UPDATE:'update'}},63:{UIAction:action},506:{default:Proxy},
    473:{BagItemIdentifyMdr:class{initView(){}}},485:{BagItemUpStarMdr:UpStarMdr},483:{BagItemUpStarInfoMdr:UpStarInfoMdr},
    462:{BagItemAttachMdr:AttachMdr}};
  const window={worldolStarLimit:starLimit,worldolEquipmentRules:browserRules};
  vm.runInNewContext(fs.readFileSync(new URL('../web/equipment-workshop.js',import.meta.url),'utf8'),{window,document,setTimeout});
  window.installEquipmentWorkshop(id=>{if(!modules[id])throw Error('Unexpected native module '+id);return modules[id];});
  return {Item,Proxy,action,calls,document,World,UI,element,modules,modals,reply:value=>reply=value};
}

// 把服务端那套「每次都要先预览、点一次烧一张卷轴、50% 加成」搬到内存里，
// 用来验证一键强化的循环边界，而不是真的连一条 WebSocket。
function starBench(startStar,scrolls,successEvery=2){
  const f=fixture(),scroll={id:40021,slotPos:30,quantity:scrolls};
  const item={id:2056,slotPos:1,type:13,reqLv:75,ascensionStar:10,star:startStar,isAttackBroken:()=>false};
  f.World.myPlayer={id:7,bag:{bagEnd:30,getItem:slot=>slot===1?item:undefined,getBagItemBySlotPos:slot=>slot===30&&scroll.quantity>0?scroll:undefined}};
  let attempts=0;
  f.World.doItemStarMenu=async(target,mode)=>{
    const limit=starLimit(item);
    if(item.star>=limit||!(scroll.quantity>0)){f.UI.alertMessage('拒绝');return '';}
    if(mode===f.World.ITEM_STAR_TYPE1)return '预览';
    attempts++;scroll.quantity-=1;if(attempts%successEvery===1)item.star+=1;
    return '';
  };
  const kind=f.document.getElementById('equipment-operation'),proceed=f.document.getElementById('equipment-continue');
  const repaint=()=>kind.onchange(),run=async()=>{await proceed.onclick();};
  return {f,item,scroll,kind,proceed,repaint,run,limit:starLimit(item),status:f.document.getElementById('equipment-status'),alerts:()=>f.calls.filter(s=>typeof s==='string'&&s.startsWith('当前 '))};
}
const openBench=b=>{b.f.document.getElementById('equipment-open').onclick();b.kind.value='quick-star';b.repaint();};

test('quick strengthening quotes the missing stars and the biggest possible cost before doing anything',()=>{
  const b=starBench(10,5);openBench(b);
  assert.equal(b.limit,18);
  assert.match(b.status.textContent,/装备强化卷 5 张 · 距离满星还差 8 星/);
  assert.equal(b.proceed.textContent,'一键强化到 18 星（最多消耗 5 张卷轴）');
  assert.equal(b.scroll.quantity,5);
});

test('one click strengthens to the item star cap and reports every success and failure',async()=>{
  const b=starBench(0,200);openBench(b);await b.run();
  assert.equal(b.item.star,18);
  assert.equal(b.scroll.quantity,200-35);   // 每两次成功一次：18 次成功 + 17 次失败
  assert.match(b.alerts().at(-1),/当前 18\/18 星。成功 18 次，失败 17 次，共用 装备强化卷 35 张。/);
  assert.equal(b.proceed.textContent,'已是满星');
});

test('quick strengthening stops when the scrolls run out instead of spending what is left',async()=>{
  const b=starBench(0,3);openBench(b);await b.run();
  assert.equal(b.item.star,2);
  assert.equal(b.scroll.quantity,0);
  assert.match(b.alerts().at(-1),/当前 2\/18 星。成功 2 次，失败 1 次，共用 装备强化卷 3 张。\n装备强化卷用完了。/);
});

test('a rejected strengthening stops after one answer instead of looping on the same refusal',async()=>{
  const b=starBench(0,200);b.f.World.doItemStarMenu=async()=>{b.f.UI.alertMessage('请先装备绑定再强化');return '';};openBench(b);await b.run();
  // 服务端已经把原因告诉玩家了，这里只补一句“什么都没发生”，不能反复重试同一句拒绝。
  assert.equal(b.item.star,0);assert.equal(b.scroll.quantity,200);
  assert.match(b.alerts().at(-1),/当前 0\/18 星。没有成功升星，失败 0 次，共用 装备强化卷 0 张。\n取不到强化信息/);
  assert.equal(b.f.calls.filter(s=>s==='请先装备绑定再强化').length,1);
});

test('direct scroll and gem Use menus preserve the true item class and type outside menu construction',()=>{
  const f=fixture();for(const [id,type]of [[40021,33],[414,30]]){
    const item=Object.assign(new f.Item(),{id,type});const menu=f.action.updatePlayerEquipPopMenu(item);
    assert.equal(menu.itemClass,5);assert.equal(menu.canUse,true);assert.equal(menu.type,type);assert.equal(item.getItemClass(),99);assert.equal(item.type,type);
  }
  assert.equal(f.action.updatePlayerEquipPopMenu(Object.assign(new f.Item(),{id:500,type:28})).canUse,false);
});

// 装备详情里的原生路径：选择面板 → 结果面板，全程不经过装备工坊那个对话框。
// 服务端那套「先预览再执行、一次烧一张卷轴」的规则沿用 starBench 的写法。
function nativeBench(startStar,scrolls,{successEvery=2,upgrade=false}={}){
  const f=fixture(),limit=upgrade?browserRules.advanced.max:18;
  const stock=(upgrade?browserRules.advanced.starScrolls:[browserRules.star.scroll]).map((id,i)=>({id,slotPos:30+i,quantity:scrolls}));
  const item={id:2056,slotPos:1,type:13,reqLv:75,ascensionStar:10,star:startStar,
    isUpgradeItem:upgrade,upgradeAscensionStar:upgrade?1:0,upgradeStar:upgrade?startStar:0,isAttackBroken:()=>false};
  f.World.myPlayer={id:7,bag:{bagEnd:29+stock.length,getItem:slot=>slot===1?item:undefined,
    getBagItemBySlotPos:slot=>stock.find(entry=>entry.slotPos===slot&&entry.quantity>0)}};
  const remaining=()=>stock.reduce((n,entry)=>n+entry.quantity,0),at=()=>upgrade?item.upgradeStar:item.star;
  let attempts=0;
  const operate=async(target,mode)=>{
    if(at()>=limit||!remaining()){f.UI.alertMessage('拒绝');return '';}
    if(mode===f.World.ITEM_STAR_TYPE1)return '预览';
    attempts++;const entry=stock.find(entry=>entry.quantity>0);entry.quantity-=1;
    if(attempts%successEvery===1){if(upgrade)item.upgradeStar+=1;else item.star+=1;}
    return '';
  };
  if(upgrade)f.World.doItemUpgradeStarMenu=operate;else f.World.doItemStarMenu=operate;
  const UpStar=f.modules[485].BagItemUpStarMdr,Info=f.modules[483].BagItemUpStarInfoMdr;
  const choice=()=>{const panel=new UpStar();panel._showArgs={player:f.World.myPlayer,item};panel._view={listBtn:{selectedIndex:-1}};panel.initView();return panel;};
  const enterQuick=panel=>{
    panel.onTapList({item:panel._listBtnData.source.find(entry=>entry.quick&&entry.type===(upgrade?12002:12001))});
    const info=new Info();info._showArgs=f.modals.at(-1).args;info._view={textDes:{text:''}};return info;
  };
  return {f,item,limit,remaining,at,choice,enterQuick,alerts:()=>f.calls.filter(s=>typeof s==='string'&&s.startsWith('当前 '))};
}

test('the equipment detail strength menu lists a one-click entry for each kind of strengthening',()=>{
  // 列表是 vm 那一侧的 realm 造出来的数组，直接 deepStrictEqual 会因为原型不同而失败。
  const names=panel=>[...panel._listBtnData.source].map(entry=>entry.name).join('|');
  assert.equal(names(nativeBench(0,200).choice()),'强化升星|一键强化升星');
  // 进阶强化只对已经进阶鉴定过的装备开放，所以它的入口也跟着原生那条一起出现。
  const advanced=nativeBench(0,200,{upgrade:true}).choice();
  assert.equal(names(advanced),'强化升星|进阶强化|一键强化升星|一键进阶强化');
  assert.deepEqual([...advanced._listBtnData.source].filter(entry=>entry.quick).map(entry=>entry.type),[12001,12002]);
});

test('one tap in the equipment detail menu strengthens straight to the cap without the workshop',async()=>{
  const b=nativeBench(0,200);await b.enterQuick(b.choice()).onShow();
  assert.equal(b.at(),18);
  assert.equal(b.remaining(),165);   // 每两次成一次：18 次成功 + 17 次失败 = 35 张
  assert.match(b.alerts().at(-1),/当前 18\/18 星。成功 18 次，失败 17 次，共用 装备强化卷 35 张。/);
});

test('one tap drives advanced strengthening to its own cap and spends advanced scrolls',async()=>{
  const b=nativeBench(0,200,{upgrade:true});await b.enterQuick(b.choice()).onShow();
  assert.equal(b.at(),20);
  assert.match(b.alerts().at(-1),/当前 20\/20 星。成功 20 次，失败 19 次，共用 进阶强化卷轴 39 张。/);
});

test('one tap stops honestly when the scrolls run out',async()=>{
  const b=nativeBench(0,3);await b.enterQuick(b.choice()).onShow();
  assert.equal(b.at(),2);assert.equal(b.remaining(),0);
  assert.match(b.alerts().at(-1),/当前 2\/18 星。成功 2 次，失败 1 次，共用 装备强化卷 3 张。\n装备强化卷用完了。/);
});

test('a refresh of the same panel does not quietly spend another batch of scrolls',async()=>{
  const b=nativeBench(0,200),info=b.enterQuick(b.choice());
  await info.onShow();
  const spent=b.remaining();
  // 面板是复用的：再刷一次（比如按了一下原版那个一次一星的按钮）不该自己又跑一轮。
  await info.initView();
  assert.equal(b.remaining(),spent);
  assert.equal(b.alerts().length,1);
  assert.equal(info._canUp,true);   // 一键跑完要把按钮还给玩家
});

// 镶嵌面板那一侧：左边是背包里的宝石，右边是一列按钮。这里照服务端的镶嵌规则
// 写一个同步返回的内存版本，用来验证一键镶嵌的循环边界，不连真实的 WebSocket。
function gemBench(capacity,gems,{successEvery=2,reject=false,guaranteed=30}={}){
  const f=fixture(),stock=gems.map((entry,index)=>{const spec=typeof entry==='number'?{quantity:entry}:entry;
    return {id:500+index,slotPos:30+index,type:30,quantity:spec.quantity,power1:spec.power1||1,powerValue1:spec.powerValue1||5,name:`宝石${index+1}`};});
  const item={id:2056,slotPos:1,type:13,attachCount:capacity,attachDone:0,broken:false,
    isAttackBroken(){return this.broken;},setAttackBroken(value){this.broken=value;}};
  f.World.myPlayer={id:7,bag:{bagEnd:29+stock.length,
    // 与 Bag.getAttachGemItemList 同一套过滤：不破碎且已经镶过时，只留属性相同的宝石。
    getAttachGemItemList(){return stock.filter(g=>g.quantity>0&&(item.broken||!item.attachDone||g.power1===item.attachPower));},
    getItem:slot=>slot===1?item:undefined,
    getBagItemBySlotPos:slot=>stock.find(g=>g.slotPos===slot&&g.quantity>0),
    removeBagItemByPos(slot,count){const g=stock.find(x=>x.slotPos===slot);if(g)g.quantity-=count;}}};
  let attempts=0;
  f.World.doWorldAttachItemAction=async(player,target,gem,output)=>{
    if(reject)return false;
    if((target.attachDone||0)>=target.attachCount)return false;
    attempts++;
    const entry=stock.find(g=>g.slotPos===gem.slotPos&&g.quantity>0);if(!entry)return false;
    entry.quantity-=1;
    // 破碎后重新开始：先清掉旧宝石，再按本次成败决定第一颗是否成功。
    if(target.isAttackBroken()){target.attachDone=0;target.attachValue=0;}
    // 与 planGem 同一条规则：已镶嵌数没到保底就必成，之后才看成功率。
    const success=(target.attachDone||0)<guaranteed||attempts%successEvery===1;target.setAttackBroken(!success);
    if(success){target.attachDone=(target.attachDone||0)+1;target.attachPower=gem.power1;target.attachValue=(target.attachValue||0)+(gem.powerValue1||5);}
    output?.append?.('镶嵌结果');
    return success;
  };
  const Attach=f.modules[462].BagItemAttachMdr,panel=new Attach();
  panel._showArgs={player:f.World.myPlayer,attachItem:item};
  panel._view={listBtn:{selectedIndex:-1},textDes:{text:''},textDes1:{text:''}};
  panel.initView();
  // 原生点按钮是同步返回的，一键在后台跑；这里等它在 _gemRunning 上收尾。
  const run=async()=>{
    panel.onTapList({item:panel._listBtnData.source.find(entry=>entry.quickGem)});
    for(let tick=0;tick<2000&&panel._gemRunning;tick++)await new Promise(r=>setTimeout(r,0));
    assert.equal(panel._gemRunning,false);
  };
  const remaining=()=>stock.reduce((n,g)=>n+g.quantity,0);
  return {f,item,stock,panel,run,remaining,alerts:()=>f.calls.filter(s=>typeof s==='string'&&s.startsWith('当前 ')),
    progress:()=>panel._view.textDes.text,names:()=>[...panel._listBtnData.source].map(entry=>entry.name).join('|')};
}

test('the gem panel keeps a one-click entry through every refresh',()=>{
  const b=gemBench(4,[20]);
  assert.equal(b.names(),'镶嵌|一键镶嵌到满');
  b.panel.updateView();
  assert.equal(b.names(),'镶嵌|一键镶嵌到满');
});

test('one tap inlays gems up to the item socket cap and reports the stones spent',async()=>{
  const b=gemBench(4,[200]);await b.run();
  assert.equal(b.item.attachDone,4);
  assert.equal(b.remaining(),200-4);   // 保底之内一颗一颗成，镶满 4 孔就停
  assert.equal(b.item.broken,false);
  assert.match(b.alerts().at(-1),/当前 4\/4 颗宝石。成功 4 次，失败 0 次，共用宝石 4 颗。/);
  assert.match(b.progress(),/镶嵌中 4\/4 颗 · 成功 4 次，失败 0 次 · 已用宝石 4 颗/);
});

test('one tap inlays the strongest gem on hand, so a freshly added +4 stack is not shadowed by the old +3 pile',async()=>{
  const b=gemBench(3,[{quantity:200,powerValue1:3},{quantity:6,powerValue1:4}]);await b.run();
  assert.equal(b.item.attachDone,3);
  assert.equal(b.item.attachValue,12);            // 三颗都用了 +4 那一档
  assert.equal(b.stock[1].quantity,3);
  assert.equal(b.stock[0].quantity,200,'+3 那堆一点没碰');
});

test('one tap stops honestly when the bag runs out of gems',async()=>{
  const b=gemBench(6,[3]);await b.run();
  assert.equal(b.item.attachDone,3);
  assert.equal(b.remaining(),0);
  assert.match(b.alerts().at(-1),/当前 3\/6 颗宝石。成功 3 次，失败 0 次，共用宝石 3 颗。\n背包里没有可以继续镶嵌的宝石了。/);
});

test('a broken inlay restarts from the first socket and is counted in the summary',async()=>{
  // 保底调成 1 颗：第 2 颗开始才会失败破碎，用来验证破碎后一键继续把孔镶满。
  const b=gemBench(2,[50],{guaranteed:1,successEvery:3});await b.run();
  assert.equal(b.item.attachDone,2);
  assert.equal(b.item.broken,false);
  assert.equal(b.remaining(),50-4);
  assert.match(b.alerts().at(-1),/当前 2\/2 颗宝石。成功 3 次，失败 1 次，共用宝石 4 颗。\n镶嵌破碎并重新开始 1 次/);
});

test('a gemless run and a refused inlay each answer once instead of looping',async()=>{
  const empty=gemBench(0,[20]);await empty.run();
  assert.deepEqual(empty.alerts(),[]);
  assert.equal(empty.f.calls.at(-1),'这件装备没有可以镶嵌的宝石孔。');
  const refused=gemBench(4,[20],{reject:true});await refused.run();
  assert.equal(refused.item.attachDone,0);assert.equal(refused.remaining(),20);
  assert.match(refused.alerts().at(-1),/当前 0\/4 颗宝石。没有成功镶嵌，失败 0 次，共用宝石 0 颗。\n这次镶嵌被拒绝/);
});

test('one tap never pops a result dialog per stone, only the final summary',async()=>{
  const b=gemBench(4,[200]);await b.run();
  assert.equal(b.f.calls.filter(s=>typeof s==='string'&&s.startsWith('当前 ')).length,1);
});

test('gem UI shows guaranteed and random rates and explains clearing retained attributes before restart',()=>{
 const {Item}=fixture(),item=Object.assign(new Item(),{attachDone:29});assert.match(item.getAttachRateDesc(),/100%/);
 item.attachDone=30;assert.match(item.getAttachRateDesc(),/50%/);item.broken=true;assert.match(item.getAttachRateDesc(),/第1颗.*100%/);assert.match(item.getAttackTwoSureInfo(),/清除这些宝石及其属性/);
});

test('a rejected identification cannot change client inventory, and accepted results update references used by repeat identification',async()=>{
  const f=fixture(),proxy=new f.Proxy(),item={id:2056,slotPos:30,powerValue1:83},candidate={...item,powerValue1:99},bag=[];
  const player={bag:{setItem(i,slot){bag.push({i,slot});}}};
  f.reply({getByte:()=>-1,getString:()=>'鉴定结果已失效'});await proxy.createIdentifyAsk(1,item,player,candidate,false);
  assert.equal(item.powerValue1,83);assert.equal(bag.length,0);assert.deepEqual(f.calls,['鉴定结果已失效']);
  f.reply({getByte:()=>0});await proxy.createIdentifyAsk(1,item,player,candidate,false);
  assert.equal(item.powerValue1,99);assert.equal(bag[0].i,item);assert.equal(bag[0].slot,30);assert.ok(f.calls.includes('result'));
});
