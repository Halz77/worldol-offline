(() => {
 'use strict';
 window.installNativeVip=req=>{
  const World=req(5).default,UI=req(1).default,Names=req(0),Events=req(2),Notifier=req(3).default,
   Message=req(22).Message,Network=req(35).default,Html=req(14).default,MC=req(12).ModelConst;
  const Vip=req(500).default.prototype,Bag=req(263).BagEquipmentMdr.prototype,Proxy=req(506).default.prototype;
  const pending='已接入VIP1基础权益：任务经验1.1倍、战后回复最大生命和法力5%、每日活跃度+100。VIP2–9精灵成长、后续经验表、答题、私人仓库与熔炉次数待补。';
  let busy=false;
  function open(){
   if(!World.myPlayer?.id)return;
   document.getElementById('offline-panel').classList.remove('open');
   for(const id of ['equipment-dialog','composition-dialog']){const d=document.getElementById(id);if(d.open)d.close();}
   UI.showWin(Names.ModName.Bag,Names.BagViewType.BagUserView,World.myPlayer.bag.getItem(17));
  }
  async function setLevel(){
   if(busy)return;busy=true;
   try{
    const p=World.myPlayer,input=await UI.showInputAsync('单机VIP等级',`当前VIP ${p.getVipLevel2()}。输入0–9；沿用单机免费设置，保存后立即生效。`,null,1,70,null,pending,'0-9');
    if(input==null)return;
    if(!/^[0-9]$/.test(String(input).trim()))throw Error('请输入0–9的整数。');
    if(World.myPlayer!==p)throw Error('角色已切换，请重新打开VIP页面。');
    const m=new Message(90003);m.putByte(Number(input));const r=await Network.sendProtoAsync(m);
    if(!r)throw Error('没有收到VIP设置结果，请重新打开查看。');if(r.getByte()<0)throw Error(r.getString());
    const state=JSON.parse(r.getString());r.getBoolean();
    if(state.role!==p.id)throw Error('角色已切换，请重新打开VIP页面。');
    p.setVipLevel(state.vipLevel);p.setVipLevel2(state.vipLevel);p.itemSetData=[...state.setAttributes];
    state.vipLevel?p.setStatusBit(MC.STATUS_VIP):p.clearStatusBit(MC.STATUS_VIP);
    p.updateAndRefreshIcon();p.checkHPMP();UI.updateWorldPlayerInfoUI();
    Notifier.sendNt(Events.BagEvent.BAG_EQUIPMENT_UPDATE);
    Notifier.sendNt(Events.UserVip.USERVIP_GET_LEVEL,p.bag.getItem(17));
    req(15).Tips.show(`VIP ${state.vipLevel} 已保存，装备与套装条件已更新。`);
   }catch(error){UI.alertMessage(error.message);}finally{busy=false;}
  }
  // Restore the native window without enabling the client's payment switch.
  Vip.onShow=function(){this.upDataView();};
  const update=Vip.upDataView,description=Vip.getDescStr,info=Vip.getOpenVipByCallback;
  Vip.upDataView=function(){
   const value=update.call(this),level=World.myPlayer.getVipLevel2();
   this._view.currentState='startDown';this._view.proBar.visible=level<=1;
   this._view.btnActi.label='免费设置等级';this._view.btnUpLevel.label='VIP福利与升级';
   this._view.vipDesc.textFlow=Html.parseHtml(`当前 VIP ${level} · ${level?'单机永久有效':'未开通'}\n${pending}`);
   return value;
  };
  Vip.getDescStr=function(level){return `VIP ${level} 原版权益说明（未接入的项目待定）\n`+description.call(this,level)+'\n';};
  Vip.getOpenVipByCallback=function(){const value=info.call(this);this._view.proBar.visible=World.myPlayer.getVipLevel2()<=1;return value;};
  Vip.onBtnActi=setLevel;Vip.onbtnUpLevel=()=>window.offlineHomeFeatures.open('welfare');
  const itemTap=Vip.onBtnItemIcon;Vip.onBtnItemIcon=function(index){if(index===1||index===2)return window.offlineHomeFeatures.open('welfare');return itemTap.call(this,index);};
  Vip.onBtnInfo=function(){UI.alertMessage(this._proxy.openvipdata?.strInfo||pending,'VIP状态与权益');};
  Proxy.doOpenVIP=setLevel;Proxy.doOpenVIPLevelUp=Vip.onbtnUpLevel;
  Proxy.doOpenVIPLevelUpCallback2=async()=>{Vip.onbtnUpLevel();return false;};
  const tap=Bag.tapEquipItem;
  Bag.tapEquipItem=function(slot,...args){return slot===17&&this._playerVo===World.myPlayer?open():tap.call(this,slot,...args);};
  const updateEquipment=Bag.updateEquipmentItem;
  Bag.updateEquipmentItem=function(...args){
   const result=updateEquipment.apply(this,args),slot=this._view.com_17;
   if(slot&&this._playerVo===World.myPlayer){
    // The recorded VIP spirit (41000) uses bag icon 39. Draw that original
    // entry icon without creating an equipped item or adding its stats twice.
    if(!slot.nativeVipIcon){const icon=new eui.Image(req(29).default.getIcon('39'));icon.width=icon.height=64;icon.horizontalCenter=0;icon.verticalCenter=0;icon.touchEnabled=false;slot.addChild(icon);slot.nativeVipIcon=icon;}
    slot.visible=true;slot.nativeVipIcon.visible=!this._playerVo.bag.getItem(17);slot.labTitle.text='';
   }else if(slot?.nativeVipIcon)slot.nativeVipIcon.visible=false;
   return result;
  };
  document.getElementById('vip-open').onclick=open;document.getElementById('workshop-vip').onclick=open;
  return {open};
 };
})();
