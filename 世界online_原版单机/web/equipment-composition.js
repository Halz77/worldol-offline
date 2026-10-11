(() => {
 'use strict';
 window.installEquipmentSetPowers=(req,definitions)=>{
  const World=req(5).default,Player=req(56).default,original=Player.prototype.getBagEquipPowerValue,cache=new WeakMap(),levels=new Map();
  Player.prototype.getBagEquipPowerValue=function(...args){
   if(this===World.myPlayer){
    const level=Math.min(9,Math.max(0,Number(this.getVipLevel2())||0)),previous=cache.get(this);
    if(!previous||previous.level!==level||previous.rows!==this.itemSetData){
     if(!levels.has(level))levels.set(level,[...definitions.values()].flatMap(s=>s.bonuses.filter(b=>level>=b.vipLevel).flatMap(b=>[(s.id<<4)|b.pieces,b.power,b.value])));
     // This table stays in memory. Native code checks the current equipped
     // piece counts; the byte-sized network packet only carries active rows.
     this.itemSetData=levels.get(level);cache.set(this,{level,rows:this.itemSetData});
    }
   }
   return original.apply(this,args);
  };
 };
 window.installEquipmentComposition=req=>{
  const World=req(5).default,Item=req(32).default,UI=req(1).default,Message=req(22).Message,Network=req(35).default,events=req(2),Notifier=req(3).default;
  const data=window.worldolCompositionData,definitions=new Map(data.sets.map(s=>[s.id,s]));
  window.installEquipmentSetPowers(req,definitions);
  const byId=id=>document.getElementById(id),dialog=byId('composition-dialog'),mode=byId('composition-mode'),target=byId('composition-target'),choice=byId('composition-choice'),value=byId('composition-value'),status=byId('composition-status'),submit=byId('composition-apply');
  let state=null,busy=false,requestVersion=0;
  const desc=(power,value)=>req(4).default.getPowerDesc(power,value);
  const option=(select,value,text)=>{const o=document.createElement('option');o.value=value;o.textContent=text;select.append(o);};
  function sync(snapshot){
   state=snapshot;const p=World.myPlayer;if(p?.id!==state.role)throw Error('角色已切换，请重新打开装备合成。');
   p.setVipLevel(state.vipLevel);p.setVipLevel2(state.vipLevel);p.itemSetData=[...state.setAttributes];
  }
  async function request(type,body){const m=new Message(type);body?.(m);const r=await Network.sendProtoAsync(m);if(!r)throw Error('本地服务没有返回结果。');if(r.getByte()<0)throw Error(r.getString());return r;}
  const selected=()=>state?.items.find(i=>i.slot===Number(target.value));
  const options=item=>mode.value==='attribute'?(item?.ranges||[]).flatMap(r=>r.options.map(o=>({...o,field:r.field}))):item?.skills||[];
  function renderChoice(){
   const item=selected(),opts=options(item);choice.replaceChildren();
   opts.forEach((o,i)=>option(choice,String(i),mode.value==='attribute'?`${desc(o.power,o.min)} ～ ${desc(o.power,o.max)}`:`${o.name} · ${o.level}级`));
   byId('composition-value-row').hidden=mode.value!=='attribute';
   byId('composition-current').textContent=item?(mode.value==='skill'?`当前技能：${item.currentSkill?item.currentSkill.name+' '+item.currentSkill.level+'级':'未合成'}。附带技能穿戴后生效，无需绑定。`:`当前合成属性：${item.ranges.map(r=>item.affixes[r.field]?desc(item.affixes[r.field].power,item.affixes[r.field].value):'未合成').join('、')}`):'当前背包和身上没有可合成此项的装备。';
   renderValue();
  }
  function renderValue(){const o=options(selected())[Number(choice.value)];if(mode.value==='attribute'&&o){value.min=o.min;value.max=o.max;const current=selected()?.affixes[o.field];value.value=current?.power===o.power?current.value:o.max;byId('composition-range').textContent=`可选范围 ${o.min}–${o.max}`;}submit.disabled=busy||(!o&&mode.value!=='vip');}
  function render(){
   const vip=mode.value==='vip',old=target.value;byId('composition-equipment-fields').hidden=vip;byId('composition-vip-fields').hidden=!vip;
   submit.textContent=vip?'免费设置VIP等级':'免费合成并保存';
   if(!state){submit.disabled=true;return;}
   if(vip){
    const levels=byId('composition-vip-level');levels.replaceChildren();for(let n=0;n<=state.vipMax;n++)option(levels,String(n),n?`VIP ${n}`:'未开通');levels.value=String(state.vipLevel||state.vipMax);
    byId('composition-vip-current').textContent=`当前 VIP ${state.vipLevel}，本地设置永久有效。`;
    const list=byId('composition-vip-bonuses');list.replaceChildren();
    for(const set of state.sets){const li=document.createElement('li'),names=[];const bag=World.myPlayer.bag;for(let slot=0;slot<30;slot++){const i=bag.getItem(slot);if(i?.getItemSetID()===set.id)names.push(i.name);}
     li.textContent=`${[...new Set(names)].join('、')}：${set.known?set.bonuses.map(b=>`${b.active?'已生效':'未激活'} · ${b.pieces}件${b.vipLevel?' / VIP '+b.vipLevel:''} · ${desc(b.power,b.value)}`).join('；'):'套装/VIP属性资料尚未采集'}`;list.append(li);
    }
    byId('composition-vip-note').textContent=`已恢复${state.knownSets}组录制中的套装属性。缺少数值的装备会标为资料尚未采集。`;submit.disabled=busy;return;
   }
   target.replaceChildren();for(const item of state.items.filter(i=>mode.value==='attribute'?i.ranges.length:i.skills.length))option(target,String(item.slot),`${item.slot<30?'已穿戴':'背包'} · ${item.name}${item.star?' · '+item.star+'星':''}`);
   if([...target.options].some(o=>o.value===old))target.value=old;renderChoice();
  }
  async function refresh(){const version=++requestVersion;try{const r=await request(90001);if(version!==requestVersion)return;sync(JSON.parse(r.getString()));render();}catch(e){status.textContent=e.message||String(e);submit.disabled=true;}}
  function open(kind='attribute'){
   if(!World.myPlayer?.id)return;byId('offline-panel').classList.remove('open');if(byId('equipment-dialog').open)byId('equipment-dialog').close();
   mode.value=kind;status.textContent='';state=null;render();if(!dialog.open)dialog.showModal();void refresh();
  }
  byId('composition-open').onclick=()=>open();byId('vip-open').onclick=()=>open('vip');byId('composition-close').onclick=()=>dialog.close();
  byId('workshop-composition').onclick=()=>open();byId('workshop-vip').onclick=()=>open('vip');
  mode.onchange=()=>{status.textContent='';render();};target.onchange=renderChoice;choice.onchange=renderValue;
  submit.onclick=async()=>{
   if(busy)return;const item=selected(),o=options(item)[Number(choice.value)],vip=mode.value==='vip';
   if(!vip&&(!item||!o))return;
   const payload=vip?null:{mode:mode.value,slot:item.slot,itemId:item.itemId,fingerprint:item.fingerprint,...(mode.value==='attribute'?{field:o.field,power:o.power,value:Number(value.value)}:{skillId:o.id,level:o.level})};
   if(!vip&&mode.value==='attribute'&&(!Number.isInteger(payload.value)||payload.value<o.min||payload.value>o.max)){status.textContent=`请输入${o.min}–${o.max}范围内的整数。`;return;}
   busy=true;submit.disabled=true;status.textContent='正在保存…';
   try{
    const r=await request(vip?90003:90002,m=>vip?m.putByte(Number(byId('composition-vip-level').value)):m.putString(JSON.stringify(payload)));
    sync(JSON.parse(r.getString()));
    const player=World.myPlayer;if(r.getBoolean()){const parsed=Item.fromBytes(r),old=player.bag.getItem(parsed.slotPos);if(old)Object.assign(old,parsed);player.bag.setItem(old||parsed,parsed.slotPos);}
    player.updateAndRefreshIcon();player.checkHPMP();UI.updateWorldPlayerInfoUI();Notifier.sendNt(events.BagEvent.BAG_EQUIPMENT_UPDATE);
    status.textContent=vip?`VIP ${state.vipLevel} 已保存，符合条件的装备属性已生效。`:'合成已保存，未消耗材料或货币。';
   }catch(e){status.textContent=e.message||String(e);}
   finally{busy=false;render();}
  };
  const expired=World.isVipOverDue;World.isVipOverDue=function(p){return p===World.myPlayer&&p?.getVipLevel2()>0?false:expired.call(this,p);};
  const getSuit=World.getSuit;World.getSuit=function(id){const set=definitions.get(id);if(!set)return getSuit.call(this,id);const p=World.myPlayer,count=p?.bag?.getEquipItemSetNum(id)||0,level=p?.getVipLevel2()||0;return set.bonuses.flatMap(b=>[b.pieces,b.power,b.value,b.vipLevel,count>=b.pieces&&level>=b.vipLevel?1:0]);};
  const setDesc=Item.prototype.getItemSetDesc;Item.prototype.getItemSetDesc=function(p){return this.getItemSetID()>0&&!definitions.has(this.getItemSetID())?'\n套装/VIP属性资料尚未采集。':setDesc.call(this,p);};
  const BagProxy=req(506).default;BagProxy.prototype.doOpenVIP=()=>open('vip');BagProxy.prototype.doOpenVIPLevelUp=()=>open('vip');
  const BagView=req(263).BagEquipmentMdr,show=BagView.prototype.onShow,tap=BagView.prototype.tapEquipItem;
  BagView.prototype.onShow=function(...args){const result=show.apply(this,args);if(this._playerVo===World.myPlayer)this._view.com_17.visible=true;return result;};
  BagView.prototype.tapEquipItem=function(slot,...args){return slot===17&&this._playerVo===World.myPlayer?open('vip'):tap.call(this,slot,...args);};
  return {open};
 };
})();
