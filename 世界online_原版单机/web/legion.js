(() => {
 'use strict';
 window.installOfflineLegion=req=>{
  const revision='legion-five-party-full-recovery-20260924-v4';
  const World=req(5).default,Names=req(0),Notify=req(3).default,UI=req(1).default,
   Group=req(228).MonsterGroup,Battle=req(251).default,Skill=req(57).default,
   Legion=req(256).default,LegionProxy=req(221).default,MC=req(12).ModelConst,
   BC=req(61).default,Rules=req(4).default;
  const proxy=()=>Notify.getProxy(Names.ModName.Legion,Names.ProxyType.Legion);
   // 修复军团宠物“自身主人”目标解析
    const BattleTool=req(75).default,
    nativePetOwnerPos=BattleTool.getPetOwnerPos;

    BattleTool.getPetOwnerPos=function(pet){
    if(pet?.ownerVo&&Number.isInteger(pet.ownerVo.position))
     return pet.ownerVo.position;
    return nativePetOwnerPos.call(this,pet);
    };

  const members=()=>World.myPlayer?.legionList||[];
  const nativeClone=Legion.prototype.cloneLegion;
  Legion.prototype.cloneLegion=function(){
   const clone=nativeClone.call(this);
   const fields='autoSkillID_Initiative hpMax mpMax name sex race job vipLevel vipLevel2 status level2 speed atkMin atkMax atk_time atk_str atk_agi atk_magic def_str def_agi def_magic dodge hitrate hitMagic critical forceHit wil tough block brkArmor magic_penetration insight def_field back magic_back life_absorption mana_absorption heal_recovery mana_recovery recovery keepout_atk_time ignore_back ignore_magic_back ignore_block ignore_insight ignore_wil ignore_touch ignoreCritical criticalDmg atk_str_range atk_str_nearby atk_agi_range atk_agi_nearby def_str_range def_str_nearby def_agi_range def_agi_nearby argo exp_up expExpireTime';
   for(const key of fields.split(' '))if(key in this)clone[key]=this[key];
   clone.fightPowerList=this.fightPowerList?.map(row=>[...row]);
   clone.itemSetData=[...(this.itemSetData||[])];
   if(this._obj)clone._obj={...this._obj};
   clone.autoSkillID=[...(this.autoSkillID||[])];
   clone._offlineLegionActorId=this.id;
   // A fresh full pet record is delivered after every battle. The pet's own
   // native skill/attribute implementation is retained during this fight.
   clone.pet=this.getPet();
   return clone;
  };
  function refreshModels(){
   const data=proxy().playLegionDataMap;
   for(const vo of members()){
    const model=data[vo.id];if(!model?.bag)continue;
    model._offlineLegionActorId=model.id;model.updateIcon();
    for(const key of ['icon1','icon2','icon3'])vo[key]=model[key];
   }
  }
  const parseActors=LegionProxy.prototype.onLegionActorlistMsg;
  LegionProxy.prototype.onLegionActorlistMsg=function(...args){const result=parseActors.apply(this,args);refreshModels();return result;};
  const changeMembers=LegionProxy.prototype.onLegionChangeMsg;
  LegionProxy.prototype.onLegionChangeMsg=function(...args){const result=changeMembers.apply(this,args);refreshModels();return result;};
  const LegionMain=req(1464).default,initWindow=LegionMain.prototype.onInit;
  LegionMain.prototype.onInit=function(...args){
   const result=initWindow.apply(this,args),heads=this._view.listHead,scroller=heads.parent;
   // The recorded skin reserves room for three portraits. Fit all four in the
   // same header so the last slot remains visible and tappable without scrolling.
   scroller.scaleX=scroller.scaleY=.73;scroller.width=620;scroller.height=215;scroller.y=153;
   heads.layout.gap=15;
   return result;
  };
  const list=Group.getLocalBattlePlayerList;
  Group.getLocalBattlePlayerList=function(player,group){
   const fighters=list.call(this,player,group);if(!fighters||player!==World.myPlayer||!members().length)return fighters;
   const data=proxy().playLegionDataMap,positions=[23,27,29,21,31,33].filter(pos=>pos<BC.MAX_POS);
   for(const vo of members()){
    const source=data[vo.id];
    if(!source?.bag)throw Error('军团成员资料尚未载入，请重新打开军团面板。');
    const position=positions.find(pos=>!fighters[pos]&&!fighters[pos-1]);
    if(position===undefined)throw Error('战场没有空闲的军团站位。');
    const actor=source.cloneLegion();actor.position=position;actor.ownerid=player.id;fighters[position]=actor;
    const pet=actor.getPet();
    if(pet&&pet.hp>0){pet.ownerVo=actor;pet.position=position-1;pet._offlineLegionPetOwner=actor.id;fighters[pet.position]=pet;}
   }
   return fighters;
  };
  const enterBattle=World.toBattle;let preparing=false;
  if(typeof enterBattle==='function')World.toBattle=async function(...args){
   if(!members().length||req(54).default.ins.isFight)return enterBattle.apply(this,args);
   if(preparing)return false;
   preparing=true;const player=World.myPlayer;
   try{
    const response=await req(35).default.sendProtoAsync(new (req(22).Message)(90017));
    if(!response)throw Error('军团资料刷新失败，请重试。');
    const state=JSON.parse(response.getString());
    if(World.myPlayer!==player||state.role!==player.id)return false;
    if(!state.ready)throw Error('请先结束上一场战斗。');
    return await enterBattle.apply(this,args);
   }catch(error){UI.alertMessage(error.message);return false;}
   finally{preparing=false;}
  };
  function plan(values){return {position:0,readByte(){return values[this.position++];},readShort(){return (values[this.position++]<<8)|values[this.position++];}};}
  const logic=Battle.prototype.logicRound;
  const petAI=Battle.prototype.doPetAI;
  if(petAI)Battle.prototype.doPetAI=function(pet,...args){
   // An explicit pet order (including wait or a skill with insufficient mana)
   // must not fall through into a different AI action after doPlayerPlan.
   if(pet?._offlineLegionPetOwner&&this.getPlanData(pet.position)!=null)return false;
   return petAI.call(this,pet,...args);
  };
  Battle.prototype.logicRound=function(...args){
   for(const actor of this.playerList||[]){
    if(!actor?._offlineLegionActorId||actor.hp<=0)continue;
    // Native controls already submit manual and auto-fight orders for members.
    // Supply a fallback only when no order exists, preserving its chosen target.
    if(this.getPlanData(actor.position)!=null)continue;
    const skill=actor.getSkillByID(actor.autoSkillID_Initiative),active=skill?.type===Rules.SKILL_TYPE_ACTIVE&&Skill.isCanUse(actor,skill,null),
     target=this.searchAICursor(actor,active?skill.area:Rules.SKILL_AREA_ENEMY_SINGLE);
    this.setPlan(actor.position,active?plan([BC.PLAN_USE_SKILL,target,skill.id>>8,skill.id&255]):plan([BC.PLAN_ATTACK,target]));
   }
   return logic.apply(this,args);
  };
  // Army actions are calculated by the preserved engine. Persist the resulting
  // member and pet vitals alongside the existing local battle session token.
  function battleResult(){
   const battle=req(54).default.ins.battle;
   return (battle?.playerList||[]).filter(a=>a?._offlineLegionActorId).map(a=>{
    const pet=(battle.playerList||[]).find(p=>p?._offlineLegionPetOwner===a.id);
    return {id:a.id,hp:a.hp,mp:a.mp,...(pet?{petHP:pet.hp,petMP:pet.mp}:{})};
   });
  }
  const statKeys='STR CON AGI ILT WIS HPMAX MPMAX SPEED ATK_TYPE LEFT_WEAPON_TYPE RIGHT_WEAPON_TYPE LEFT_ATK_MIN RIGHT_ATK_MIN ATK_MIN LEFT_ATK_MAX RIGHT_ATK_MAX ATK_MAX LEFT_ATK_TIME RIGHT_ATK_TIME ATK_TIME ATK_STR ATK_AGI ATK_MAGIC ATK_STR_NEARBY ATK_STR_RANGE ATK_AGI_NEARBY ATK_AGI_RANGE DEF_STR DEF_STR_RANGE DEF_STR_NEARBY DEF_AGI_RANGE DEF_AGI_NEARBY DEF_AGI DEF_MAGIC DODGE HIT_RATE HIT_MAGIC CRITICAL FORCE_HIT EXP_UP WIL TOUGH BLOCK BRK_ARMOR MAGIC_PENETRATION INSIGHT DEF_FIELD BACK MAGIC_BACK LIFE_ABSORPTION MANA_ABSORPTION HEAL_RECOVERY MANA_RECOVERY IGNORE_BACK IGNORE_MAGIC_BACK IGNORE_BLOCK IGNORE_INSIGHT IGNORE_WIL IGNORE_TOUCH IGNORE_CRITICAL KEEPOUT_ATK_TIME CRITICAL_DAMAGE RECOVERY ARGO BACK_MAX'.split(' ');
  const powerIds=[...new Set(Object.entries(Rules).filter(([key,value])=>key.startsWith('POWER_')&&Number.isInteger(value)&&value>0).map(([,value])=>value))].sort((a,b)=>a-b);
  function auditRole(p){
   if(!p?.bag)return null;
   const powers=method=>powerIds.map(id=>[id,method(id)]).filter(([,value])=>value!==0);
   return {id:p.id,vip:p.getVipLevel2(),stats:Object.fromEntries(statKeys.map(key=>[key,p.get(MC[key])])),equipmentPowers:powers(id=>p.getBagEquipPowerValue(id)),passivePowers:powers(id=>p.getSkillPowerValue(Rules.SKILL_TYPE_PASSIVE,id)),featurePowers:powers(id=>p.getPower(id)),autoSkills:[...(p.autoSkillID||[])],initiativeSkill:p.autoSkillID_Initiative,skills:p.skillList.map(s=>Object.fromEntries(Object.entries(s).filter(([,v])=>['number','string','boolean'].includes(typeof v)))).sort((a,b)=>a.id-b.id)};
  }
  function audit(){return {current:auditRole(World.myPlayer),members:members().map(vo=>{const model=proxy().playLegionDataMap[vo.id];return {id:vo.id,loaded:auditRole(model),battle:model?.bag?auditRole(model.cloneLegion()):null};})};}
  function open(){
   document.getElementById('offline-panel').classList.remove('open');
   UI.showWin(Names.ModName.Legion,Names.LegionViewType.LegionMain);
  }
  document.getElementById('legion-open').onclick=open;
  // Keep the native help and add only the local save behavior and missing rule.
  const info=req(10).GameText;
  info.LEGION_DESC1+='\n单机军团：无等级限制，每套可编入同一存档中的4个助战角色，与当前角色组成5人小队。点击角色上阵，点击栏位下阵，点击出战切换军团。手动战斗可逐个选择成员的技能和目标；自动战斗按各自设置出手。装备、天赋、神器和技能按各自角色计算。每场战斗结束后，全队人物和各自出战宠物的生命、法力自动回满，倒下也会恢复，无需VIP。\n只有一个角色时，请返回角色列表，在同一存档内创建其他角色。\n待定：原版助战经验分配比例；当前助战不获得经验、掉落或任务奖励。';
  return {revision,battleResult,audit,snapshot(){return {revision,members:members().map(v=>({id:v.id,index:v.legionId,loaded:!!proxy().playLegionDataMap[v.id]?.bag})),battleActors:battleResult()};}};
 };
})();
