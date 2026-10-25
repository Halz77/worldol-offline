import {Writer} from './codec.mjs';
import {restored,equipment,skills,ITEM_SHOP,SKILL_SHOP,IGNORE_REQUIREMENT_ITEM_ID,availableSkills,buyItem,equip,unequip,learn,clampVitals,activeSkills,reconcileSkillSettings,jobBooks,changeJob} from './restoration.mjs';
import {skillPacket,skillChanges,skillUpdate,skillList,bagPacket,shopItem,itemPacket} from './restoration-packets.mjs';
import {OFFICIAL_SHOP,officialItems} from './official-data.mjs';
import {playerDetail} from './world.mjs';
import {activePet,petAttributes} from './pet-state.mjs';
import {petMentorSkills,learnPetMentorSkill} from './pet-mentors.mjs';
import {useMedicine,discardItem,sellItem,sellItems,bindItem,consumeItem,expandBag,changeSex,BAG_EXPAND_ITEM_ID,CHANGE_SEX_ITEM_ID} from './bag-actions.mjs';
import {automaticSkillSlots} from './automatic-skills.mjs';
import {healthUpdate} from './game-packets.mjs';
import {lightAllHandbook} from './handbook.mjs';
import {handbookPowerPacket} from './official-service.mjs';
import {HANDBOOK_LIGHT_ALL_ITEM_ID} from './local-items.mjs';
import {careers} from './career-skills.mjs';
import {supplyShopById} from './supply-shops.mjs';
import {applyLootDelivery} from './loot.mjs';
import {recordActivity} from './daily-activity.mjs';
import {notifyDaily} from './daily-service.mjs';
import {nativeCommerce} from './native-commerce-data.mjs';
import {selectablePetEggs,soldPetItem,petSkillLevels} from './pet-catalog.mjs';
import {localEnchantments} from './enchantment-data.mjs';
import {spiritRules,spiritRunes,isSpiritBox} from './spirit-seal-data.mjs';
import {appearanceShops,appearanceByItemId,applyAppearance} from './local-fashion.mjs';
import {towerShopList,towerShopBuy} from './tower-shop.mjs';
import {isFormationBook,learnFormationFromBook,setActiveFormation,forgetFormation,formationListPacket,formationLearnPacket} from './formation-data.mjs';
// 美容院的「更换发型 / 更换脸型 / 全新发型」在原版里也是普通道具商店（51 / 52 / 55），
// 但卖的不是装备，而是**买下即生效**的造型道具：客户端读到购买回包的状态位 2 就调用
// updateHair / updateFace 改写自己的外观位域（icon1 的发型 7..10 位 / 脸型 13..16 位），
// 道具不进背包。这三个商店的商品清单从来没有采集到——shopID 51/52/55 只出现在 NPC
// 定义里，12004 的采集记录只有 VIP 商店那一份——所以按「世界OL_源码」下的发型/脸型
// 贴图本地还原一套（见 lib/local-fashion.mjs，编号落在原版的 40100+ / 40200+ 号段）。
export const APPEARANCE_SHOPS=new Map(appearanceShops.map(s=>[s.id,s.name]));
export function shopItems(id){
 const appearance=appearanceShops.find(s=>s.id===id);
 if(appearance)return appearance.items.map(itemId=>{const item=equipment.get(itemId);if(!item)throw Error('美容院造型道具资料未就绪：'+itemId);return item;});
 const recorded=nativeCommerce.vipShops.find(s=>s.id===id);
 if(recorded){
    const ids=[...new Set([...spiritRules.boxIds,...localEnchantments.map(e=>e.id),787,40002,781,1200,...recorded.items.map(x=>x.id)])];
  return ids.map(itemId=>{const item=equipment.get(itemId);if(!item)throw Error('VIP商品资料未就绪：'+itemId);return item;}).filter(e=>soldPetItem(e)&&!spiritRunes.has(e.id));
 }
 if([2000,2002,2003,2004].includes(id))return [...spiritRules.boxIds.map(id=>equipment.get(id)),...localEnchantments.map(e=>equipment.get(e.id))];
 if(id===917)return selectablePetEggs().map(egg=>equipment.get(egg.id));
 if(id===ITEM_SHOP)return restored.equipment.filter(e=>e.id!==IGNORE_REQUIREMENT_ITEM_ID);
 if(id===OFFICIAL_SHOP)return [...officialItems.keys()].map(id=>equipment.get(id)).filter(e=>soldPetItem(e)&&!spiritRunes.has(e.id)&&!isSpiritBox(e.id));
 return supplyShopById.get(id)?.items.map(id=>equipment.get(id));
}
const operations=new Set([12001,12003,12004,12005,12006,12020,12021,12036,12037,14001,14002,14003,14004,14005,14006,14009,14010,14012,14013,14015]);
export function handleRestoration(type,r,context,{store,send,log}){
 if(!operations.has(type)||!context.role)return false;
 const p=context.role;let shop;
 try{
  if(context.battle)throw Error('请先结束战斗再管理装备和技能。');
  if(type===12004){shop=r.short();const list=shopItems(shop);if(!list)throw Error('这个商店尚未接入。可到新月繁华之都（20,18）的装备与补给商人处查看。');const w=new Writer().byte(0).short(list.length);list.forEach((e,i)=>shopItem(w,e,i));send(type,w);return true;}
  if(type===12005){
   shop=r.short();const id=r.int(),quantity=r.byte()&255,country=r.bool(),e=shopItems(shop)?.find(e=>e.id===id);
   if(country||!e)throw Error('无效商品或本地商店。');
   // 造型道具走原版的「购买即使用」：回状态位 2，客户端会立刻 updateHair/updateFace
   // 并 refreshWorldSprite，道具不落背包。服务端必须同步改 icon1 并存盘，否则重登
   // 或刷新角色列表时造型会退回去。
   const appearance=appearanceByItemId.get(id);
   if(appearance){
    if(quantity!==1)throw Error('造型道具请逐个更换。');
    const price=Math.max(0,e.localPrice||0);
    if((p.coins||0)<price)throw Error('铜币不足。');
    const previous={icon1:p.icon1,coins:p.coins};
    p.icon1=applyAppearance(p.icon1,appearance);p.coins-=price;
    try{store.save();}catch(error){Object.assign(p,previous);throw error;}
    send(type,new Writer().byte(2).int(p.gold||0).int(p.silver||0).int(p.coins).short(-1).short(-1));
    log('appearance-changed',{role:p.id,shop,id,kind:appearance.kind,style:appearance.style,color:appearance.color,icon1:p.icon1});
    return true;
   }
   if((e.stackNum||1)<=1&&quantity!==1)throw Error('装备请逐件领取。');
   const previous={inventory:p.inventory,coins:p.coins};
   buyItem(p,id,quantity);try{store.save();}catch(error){Object.assign(p,previous);throw error;}
   send(type,new Writer().byte(0).int(id).short(shop).byte(quantity).int(p.gold||0).int(p.silver||0).int(p.coins).short(-1).short(-1));if(e.type===41)for(const item of p.inventory.filter(i=>i.itemId===id&&i.slot>=30))send(17603,itemPacket(new Writer().short(item.slot),item));log('item-bought',{role:p.id,shop,id,quantity});return true;
  }
  // 阵法（第 92 版）：14012 学书、14013 遗忘、14015 切换默认。客户端主包本来就有
  // 这三条协议与属性面板，回包结构见 lib/formation-data.mjs 的 formationSkillBlock。
  // 14012 的回包 = byte(formationType) + formationSkill（客户端回调拿首字节替换列表）；
  // 14013/14015 = byte(0) + 列表块。
  if(type===14012){
   const bookSlot=r.short(),bookId=r.int();
   const item=p.inventory.find(i=>i.slot===bookSlot),def=item?equipment.get(item.itemId):null;
   if(!item||!def||!isFormationBook(def)||item.itemId!==bookId||!Number.isInteger(item.quantity)||item.quantity<1)throw Error('请选择背包中的阵法书。');
   const before=structuredClone(p);
   try{
    const f=learnFormationFromBook(p,def);
    item.quantity--;
    if(!item.quantity)p.inventory=p.inventory.filter(i=>i!==item);
    clampVitals(p);
    store.save();
    send(type,formationLearnPacket(p,f));
    log('formation-learned',{role:p.id,form:f.id,book:item.itemId});
   }catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);throw error;}
   return true;
  }
  if(type===14015){
   const skillId=r.byte()&255,before=structuredClone(p);
   try{setActiveFormation(p,skillId);clampVitals(p);store.save();}
   catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);throw error;}
   send(type,new Writer().byte(0).raw(formationListPacket(p).done()));
   log('formation-default-changed',{role:p.id,skillId});
   return true;
  }
  if(type===14013){
   const skillId=r.byte()&255,before=structuredClone(p);
   try{forgetFormation(p,skillId);clampVitals(p);store.save();}
   catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);throw error;}
   send(type,new Writer().byte(0).raw(formationListPacket(p).done()));
   log('formation-forgotten',{role:p.id,skillId});
   return true;
  }
  if(type===12001){
   const waitType=r.byte(),action=r.byte(),slot=r.short(),quantity=r.int();
   if(action===1){const dest=r.byte();r.bool();r.byte();if(waitType!==9||quantity!==1)throw Error('无效穿戴请求。');const before=activeSkills(p);equip(p,slot,dest);store.save();send(type,skillChanges(new Writer().byte(9).byte(0),p,before));}
   else if(action===2){r.bool();r.byte();if(waitType!==17||quantity!==1)throw Error('无效卸下请求。');const before=activeSkills(p);unequip(p,slot);store.save();send(type,skillChanges(new Writer().byte(17),p,before));}
   else if(action===3){
    r.bool();r.byte();
    // 转职书用原版的 BAG_CHANGE_JOB(18) 等待类型；成功后要回 PlayerDetail + 技能列表，
    // 客户端会据此刷新角色面板（含新职业）并替换整个技能栏。
    const instance=p.inventory.find(i=>i.slot===slot),itemId=instance?.itemId,job=jobBooks.get(itemId);
    if(itemId===HANDBOOK_LIGHT_ALL_ITEM_ID){
     // 第 77 版「点亮所有图鉴」：无 power 的 type 28 消耗品 → 客户端按 BAG_NO_WAIT(0)
     // 发请求，并且**不等回包**（客户端自己对 BAG_NO_WAIT 分支就是 sendProto + 本地扣一件）。
     // 所以这里只认 itemId + 等待类型，扣掉一件、把图鉴全部点亮、重算加成并推送 32109。
     if(waitType!==0)throw Error('无效的道具使用请求。');
     if(!(quantity>0))throw Error('无效的道具数量。');
     const before=structuredClone(p);
     try{
      consumeItem(p,slot,quantity);      // 扣件失败会抛错，poke 到存档之前就中断
      lightAllHandbook(p);
      store.save();
     }catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);throw error;}
     send(32109,handbookPowerPacket(p));
     send(10509,new Writer().byte(2).string('所有图鉴已点亮，图鉴加成立刻生效。'));
     log('handbook-lit-all',{role:p.id,itemId,used:quantity});
    }
    else if(itemId===BAG_EXPAND_ITEM_ID||itemId===CHANGE_SEX_ITEM_ID){
     // 第 73 版：288 背包扩展（wait=BAG_WAIT 20）与 42000 变性卷轴（wait=BAG_ALERT_SEX 21）。
     // 客户端按道具自报等待类型（isAddBagSizeItem / isChangeSexItem），这里按 itemId 认领，
     // 同时要求等待类型对得上 —— 对不上就不是这两件道具的正常请求。
     const expected=itemId===BAG_EXPAND_ITEM_ID?20:21;
     if(waitType!==expected)throw Error('无效的道具使用请求。');
     const before=structuredClone(p);let reply,bagAfter=null;
     try{
      if(itemId===BAG_EXPAND_ITEM_ID){const {after}=expandBag(p,slot,quantity);bagAfter=after;store.save();reply=new Writer().byte(20);}
      else{const {sex,icons}=changeSex(p,slot,quantity);store.save();
       // BAG_ALERT_SEX：客户端读 long(icon1) long(icon2) long(icon3) byte(sex) string(提示语)，
       // 自己 setIcon*/setSex/refreshPlayerAllSprite —— 服务端给的就是最终外观。
       reply=new Writer().byte(21).long(icons.icon1).long(icons.icon2).long(icons.icon3).byte(sex).string('变性成功，性别与外形已重置。');}
     }catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);throw error;}
     send(type,reply);
     // 客户端的 BAG_WAIT 分支对 288 只弹一句「背包容量已增加」，**不读回包里的容量**，
     // 所以必须另推 12058 CG_BAG_SIZE（int=新容量）→ onBagSizeChanged 才会刷新
     // myPlayer.BagSize 并发 BAG_ITEM_UPDATE 重画背包格子。少这一步就是「提示了但格子没多」。
     if(bagAfter!==null){send(12058,new Writer().int(bagAfter));log('bag-expanded',{role:p.id,itemId,used:quantity,before:before.bagLimit??24,after:bagAfter});}
     else log('sex-changed',{role:p.id,itemId,sex:p.sex,icon1:p.icon1,was:before.sex});
    }
    else if(job===undefined){
     if(waitType!==0)throw Error('这种道具的使用规则尚未恢复。');
     useMedicine(p,slot,quantity);store.save();send(17601,healthUpdate(p));
    }else{
     if(waitType!==18)throw Error('无效的转职请求。');
     if(quantity!==1)throw Error('转职书请逐本使用。');
     const before=structuredClone(p);let itemId;
     try{changeJob(p,job);itemId=consumeItem(p,slot,1).itemId;store.save();}
     catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);throw error;}
     send(type,skillList(playerDetail(new Writer().byte(18),p),p));
     // 选角界面的职业文字取自角色列表（icon1 的位域），changeJob 已经把 job 和位域一起改掉了，
     // 回到选角界面时客户端会自己重新取一次列表，因此这里不再主动推送 10001：
     // 推的时候角色列表视图往往是隐藏的（_view 已被回收），反而会让客户端在解析通知时抛出异常。
     log('job-changed',{role:p.id,itemId,job:p.job});
    }
   }
   else if(action===4){
    const id=r.int();r.bool();r.byte();if(waitType!==20)throw Error('无效丢弃请求。');
    const previous=p.inventory;discardItem(p,slot,id,quantity);
    try{store.save();}catch(error){p.inventory=previous;throw error;}
    send(type,new Writer().byte(20));
   }
   else if(action===7){r.bool();r.byte();if(waitType!==7||quantity!==1)throw Error('无效绑定请求。');bindItem(p,slot);store.save();send(type,new Writer().byte(7));if(slot<30)send(14011,skillUpdate(new Writer(),p));}
   else throw Error('这项道具操作尚未恢复。');
   log('equipment-changed',{role:p.id,action,slot,inventory:p.inventory});return true;
  }
  if(type===12003){
   const before=structuredClone(p);let delivery;
   try{p.inventory.filter(x=>x.slot>=30).sort((a,b)=>a.itemId-b.itemId||a.slot-b.slot).forEach((x,i)=>x.slot=30+i);delivery=applyLootDelivery(p);store.save();}
   catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);throw error;}
   send(type,bagPacket(new Writer().byte(0).int(p.mapId).byte(p.x).byte(p.y).int(16),p));
   if(delivery.added.length||delivery.pending.length)send(10509,new Writer().byte(2).string(delivery.pending.length?'尚有掉落待领取，请继续腾出背包空间后整理。':'待领取的战斗掉落已全部放入背包。'));
   return true;
  }
  if(type===12006){
   r.short();const id=r.int(),slot=r.short(),quantity=r.byte()&255,before=structuredClone(p);
   try{sellItem(p,slot,id,quantity);recordActivity(p,22);store.save();}
   catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);throw error;}
   send(type,new Writer().byte(0).int(p.coins));notifyDaily(p,send);return true;
  }
  // No items are automatically marked as junk. The native bag selection is
  // submitted separately by 12037 and remains the authority for what to sell.
  // 永泽塔「兑换商店」——客户端原生支持（SHOP_TOWER_ID=23722），货币是勇气勋章 p.towerPoint。
  if(type===12020){send(type,towerShopList(new Writer(),p));return true;}
  if(type===12021){
   const shopId=r.short(),itemId=r.int(),quantity=r.byte()&255,before=structuredClone(p);
   let result;
   try{result=towerShopBuy(p,shopId,itemId,quantity);if(!result.ok)throw Error(result.message);store.save();}
   catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);throw error;}
   send(type,new Writer().byte(0).int(itemId).short(result.slot).byte(result.n).int(p.towerPoint||0).short(result.row.maxBuy).short(result.row.allCount));
   log('tower-shop-buy',{role:p.id,itemId,quantity:result.n,point:result.row.point,left:p.towerPoint||0});
   return true;
  }
  if(type===12036){send(type,new Writer().short(0));return true;}
  if(type===12037){
   const count=r.short();if(count<1||count>300)throw Error('请选择要出售的背包道具。');
   const items=Array.from({length:count},()=>({id:r.int(),slot:r.short(),quantity:r.short()}));
   if(r.pos!==r.b.length)throw Error('出售列表格式有误，请重新选择道具。');
   const before=structuredClone(p);let total;
   try{total=sellItems(p,items);recordActivity(p,22);store.save();}
   catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);throw error;}
   const w=new Writer().short(items.length);for(const item of items)w.int(item.id).short(item.quantity).short(item.slot);
   send(type,w.int(p.gold||0).int(p.silver||0).int(p.coins).int(total));notifyDaily(p,send);
   log('items-sold',{role:p.id,items,total,coins:p.coins});return true;
  }
  if(type===14001){
   shop=r.short();const petShop=shop>=2000&&shop<4000,pet=petShop?activePet(p):null,list=petShop?petMentorSkills(pet,shop):availableSkills(p,shop);if(!list.length)throw Error('这个导师尚未接入。');
   if(petShop)context.petMentor={shop,uid:pet.uid};
   if(list.length>127)throw Error('导师列表超出原版协议范围。');
   const w=new Writer().short(shop).byte(list.length).byte(careers.maxLearned);for(const s of list)skillPacket(w,s,true).byte(s.levels.at(-1).level);send(type,w);return true;
  }
  if(type===14002){
   shop=r.short();const id=r.int(),level=r.byte(),country=r.bool();if(country)throw Error('本地不开放国家技能商店。');
   if(shop>=2000&&shop<4000){
    const pet=activePet(p);if(!pet||context.petMentor?.shop!==shop||context.petMentor.uid!==pet.uid)throw Error('出战宠物已变化，请重新打开导师。');
    const before=structuredClone(pet);let learned;
    try{learned=learnPetMentorSkill(pet,shop,id,level);const max=petAttributes(p,pet);pet.hp=Math.min(pet.hp,max.hp);pet.mp=Math.min(pet.mp,max.mp);store.save();}catch(error){for(const k of Object.keys(pet))if(!(k in before))delete pet[k];Object.assign(pet,before);throw error;}
    const w=new Writer().byte(0).int(id).int(pet.sp||0).int(p.gold||0).int(p.silver||0).int(p.coins),next=learned.levels.find(s=>s.level===level+1);
    w.byte(next?1:0);if(next)skillPacket(w,{...learned,...next},true);skillPacket(w.bool(true),learned).byte(0);send(type,w);log('pet-mentor-learned',{role:p.id,pet:pet.uid,id,level});return true;
   }
    const before=structuredClone(p);let s;
    try{
     for(let nextLevel=(p.skills[id]||0)+1;nextLevel<=level;nextLevel++)s=learn(p,shop,id,nextLevel);
     if(!s)throw Error('该技能已达到目标等级。');
     store.save();
    }catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);throw error;}
   const w=new Writer().byte(0).int(id).int(p.skillPoints||0).int(p.gold||0).int(p.silver||0).int(p.coins),next=s.levels.find(x=>x.level===level+1);
   w.byte(next?1:0);if(next)skillPacket(w,{...s,...next},true);
   const effective=activeSkills(p).find(s=>s.id===id);skillPacket(w.bool(true),effective).byte(effective.addLevel||0);send(type,w);log('skill-learned',{role:p.id,id,name:s.name,level});return true;
  }
  if([14004,14005,14009,14010].includes(type)){
   const target=r.byte(),id=r.int(),subject=target===0?p:target===1?activePet(p):null,s=target===0?activeSkills(p).find(s=>s.id===id):subject?.skills.find(s=>s.id===id);
   if(!subject||!s)throw Error('没有这个已学习或装备附带的技能。');
   const primary=target===0?'initiativeSkillId':'initiativeSkill',automatic=target===0?'autoSkillIds':'autoSkills';
   const previousPrimary=subject[primary],previousAutomatic=subject[automatic];
   try{
    if(type===14009){if(s.type!==3)throw Error('请选择主动技能。');subject[primary]=id;}
    if(type===14010)subject[primary]=-1;
    if(type===14004||type===14005){
     if(s.type!==2)throw Error('请选择自动技能。');
     const slots=automaticSkillSlots(subject[automatic],target===0?activeSkills(p):subject.skills);
     if(type===14004&&!slots.includes(id)){const slot=slots.indexOf(0);if(slot<0)slots.push(id);else slots[slot]=id;}
     subject[automatic]=type===14005?slots.filter(x=>x!==id).concat(slots.includes(id)?[0]:[]):slots;
    }
    store.save();
   }catch(error){subject[primary]=previousPrimary;subject[automatic]=previousAutomatic;throw error;}
   const w=new Writer().byte(0);
   if(type===14004||type===14005){w.byte(subject[automatic].length);for(const skillId of subject[automatic])w.short(skillId);}
   send(type,w);return true;
  }
  if(type===14003||type===14006){
    const id=r.int();
    const target=r.byte();

    // target:
    // 0 = 人物技能
    // 1 = 出战宠物技能
    if(target!==0 && target!==1)
        throw Error('无效的技能目标。');

    const pet=target===1 ? activePet(p) : null;

    if(target===0){
        // 人物技能
        if(!p.skills[id] || !skills.has(id))
            throw Error('没有这个角色技能。');
    }else{
        // 宠物技能
        if(!pet)
            throw Error('没有出战宠物。');

        const petSkill=pet.skills?.find(s=>s.id===id);

        if(!petSkill)
            throw Error('没有这个宠物技能。');
    }

    // 14006 = CG_SKILL_DELETE_BY_LEVEL，「放弃一级」：把技能降一级，降到底就当作完整遗忘。
    // 客户端的解析与 14003 共用同一段代码（doDropSkillOneLevel 的 case 3）：
    //   byte 状态（负数 = 错误串）/ int 技能号 / int sp / int 金 / int 银 / int 铜 /
    //   bool 技能还在不在；还在就再跟一份技能定义 + 一个 byte 的 addLevel。
    // 所以回包必须和下面 14003 的两个分支同构，只把那个 bool 换成「降级后的技能」。
    if(type===14006){
        const before=structuredClone(p);
        let kept;
        try{
            if(target===0){
                // ===== 人物技能：降一级 =====
                const next=p.skills[id]-1;
                // 等级的权威判定与 learned(p) 同一套：先看导入存档自带的等级定义，再看技能表。
                const definition=next>=1?(p.importedSkillDefinitions?.[`${id}:${next}`]||skills.get(id)?.levels.find(level=>level.level===next)):null;
                if(next>=1&&!definition)
                    throw Error('这个技能上一级的资料尚未恢复，无法降级。');
                if(next>=1)p.skills[id]=next;else delete p.skills[id];
                reconcileSkillSettings(p);clampVitals(p);
            }else{
                // ===== 宠物技能：降一级 =====
                const index=pet.skills.findIndex(s=>s.id===id),current=pet.skills[index],next=current.level-1;
                const definition=next>=1?petSkillLevels.get(`${id}:${next}`):null;
                if(next>=1&&!definition)
                    throw Error('这个宠物技能上一级的资料尚未恢复，无法降级。');
                if(next>=1){
                    // 数值换成上一级的定义，但「这个技能是怎么来的」逐字沿用原来的标记
                    // （kind / isLearnByBook / learnedFromMentor）：pet-state 的成长里程碑按
                    // 这三个标记决定技能跟着记录一起长、还是被里程碑表换掉，降一级不该把
                    // 「天生技能」变成「后天学的」，否则 97 级养成的表现会跟着变。
                    const level=structuredClone(definition);
                    if(current.kind===undefined)delete level.kind;else level.kind=current.kind;
                    level.isLearnByBook=!!current.isLearnByBook;
                    if(current.learnedFromMentor)level.learnedFromMentor=true;else delete level.learnedFromMentor;
                    level.addLevel=current.addLevel||0;
                    pet.skills[index]=level;
                }else{
                    pet.skills.splice(index,1);
                    // 降到底就等于遗忘：自动技能栏与主动技能设置一并清掉（同 14003）。
                    if(Array.isArray(pet.autoSkills))pet.autoSkills=pet.autoSkills.filter(skillId=>skillId!==id);
                    if(pet.initiativeSkill===id)pet.initiativeSkill=-1;
                }
            }
            store.save();
        }catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);throw error;}

        const w=new Writer().byte(0).int(id);
        if(target===0){
            kept=activeSkills(p).find(s=>s.id===id)||null;
            w.int(p.skillPoints||0);
        }else{
            kept=pet.skills.find(s=>s.id===id)||null;
            w.int(pet.sp||0);
        }
        w.int(p.gold||0).int(p.silver||0).int(p.coins).bool(!!kept);
        if(kept)skillPacket(w,kept).byte(kept.addLevel||0);
        send(type,w);
        // 人物技能降级后技能面板里的等级要跟着变；宠物技能走自己的宠物包，这里不推 14011。
        if(target===0&&kept)send(14011,skillUpdate(new Writer(),p));
        if(target===0)log('skill-level-forgotten',{role:p.id,target:'player',id,level:kept?kept.level:0});
        else log('skill-level-forgotten',{role:p.id,target:'pet',pet:pet.uid,id,level:kept?kept.level:0});
        return true;
    }

    if(target===0){
        // ===== 人物技能 =====
        delete p.skills[id];

        reconcileSkillSettings(p);
        clampVitals(p);

        store.save();

        const w=new Writer()
            .byte(0)
            .int(id)
            .int(p.skillPoints||0)
            .int(p.gold||0)
            .int(p.silver||0)
            .int(p.coins)
            .bool(false);

        send(type,w);

        if(activeSkills(p).some(s=>s.id===id))
            send(14011,skillUpdate(new Writer(),p));

        log('skill-forgotten',{
            role:p.id,
            target:'player',
            id
        });

    }else{
        // ===== 宠物技能 =====
        const index=pet.skills.findIndex(s=>s.id===id);

        if(index<0)
            throw Error('没有这个宠物技能。');

        pet.skills.splice(index,1);

        // 如果被遗忘的技能正好是自动技能，
        // 一起从自动技能栏删除。
        if(Array.isArray(pet.autoSkills))
            pet.autoSkills=pet.autoSkills.filter(skillId=>skillId!==id);

        // 如果是主动技能，也清掉主动技能设置。
        if(pet.initiativeSkill===id)
            pet.initiativeSkill=-1;

        store.save();

        const w=new Writer()
            .byte(0)
            .int(id)
            .int(pet.sp||0)
            .int(p.gold||0)
            .int(p.silver||0)
            .int(p.coins)
            .bool(false);

        send(type,w);

        log('skill-forgotten',{
            role:p.id,
            target:'pet',
            pet:pet.uid,
            id
        });
    }

    return true;
}
 }catch(error){const w=new Writer();if(type===14001)w.short(shop||0);if(type===12036||type===12037)w.short(-1);else w.byte(-1);send(type,w.string(error.message));log('restoration-rejected',{role:p.id,type,error:error.message});}
 return true;
}
