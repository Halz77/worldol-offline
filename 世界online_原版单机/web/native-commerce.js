(() => {
 'use strict';
 window.installNativeCommerce=req=>{
  const UI=req(1).default,World=req(5).default,Facade=req(3).default,Names=req(0),Events=req(2),Network=req(35).default,Message=req(22).Message;
  const proxy=()=>Facade.getProxy(Names.ModName.Charge,Names.ProxyType.Charge),activity=()=>Facade.getProxy(Names.ModName.Activity,Names.ProxyType.Activity);
  let busy=false;
  async function claim(kind,id='',quiet=false){
   if(busy||!World.myPlayer?.id)return;busy=true;const role=World.myPlayer.id;
   try{const m=new Message(90020);m.putString(JSON.stringify({role,action:'commerce',kind,id}));const r=await Network.sendProtoAsync(m);if(!r)throw Error('本地服务未响应。');if(r.getByte()<0)throw Error(r.getString());const state=JSON.parse(r.getString());if(state.role!==World.myPlayer?.id)return;
    proxy().doChargeisMultiple();if(kind!=='first-rewards'){proxy().doCreatePayInfoList();activity().sendGetDailyRecharge();activity().sendEveryGift();if(kind==='achievement')proxy().doPayAchieveList();if(!quiet)req(15).Tips.show('单机奖励已领取并保存');}return state;
   }catch(error){if(!quiet)UI.alertMessage(error.message);}finally{busy=false;}
  }
  const act=req(45).default.getInstance,types=req(38).ActType;
  const getTypeRed=act.getTypeRed.bind(act),getActivityData=act.getActivityData.bind(act);
  const enabled=new Set([types.FIRST_CHARGE,types.DAILY_FIRST_CHARGE,types.ACTIVITY_EVERY_GIFT]);
  act.getTypeRed=function(ids){return ids?.some(id=>enabled.has(id))?{...getTypeRed(ids),isShow:true}:getTypeRed(ids);};
  act.getActivityData=function(type){return enabled.has(type)?{...getActivityData(type),closeTime:{toNumber:()=>0}}:getActivityData(type);};
  UI.createChargeUI=async(index=0,subParams)=>{await claim('first-rewards','',true);UI.showWin(Names.ModName.Charge,Names.ChargeType.ChargeMain,{subIdx:index,subParams});};
  req(692).default.prototype.doCardPutMsg=function(id,_amount,protocol){return claim(protocol===17102?'daily':protocol===17015?'gift':'normal',String(id));};
  const Charge=req(709).default.prototype,update=Charge.updateView;
  Charge.updateView=function(...args){const result=update.apply(this,args);this._view.desc.text+='\n单机免费领取，奖励自动保存。';return result;};
  Charge.update=function(){this._view.time.text='首充黄金1.5倍：单机永久开启';};
  const Achieve=req(716).default.prototype,showAchieve=Achieve.onClickRender;
  Achieve.onClickRender=function(...args){return this.data?.isCanGet?claim('achievement',String(this.data.id)):showAchieve.apply(this,args);};
  req(719).ActivityEveryGiftMdr.prototype.listItem=function(event){const item=event.body;if(!item?.isCanBuy)return;UI.showRewardAsk(item.items,'领取礼包',req(11).default.alloc(this,()=>claim('gift',item.defineId)),'单机免费领取本期礼包，奖励自动保存。');};
  window.offlineNativeCommerce={open:UI.createChargeUI,claim};
 };
})();
