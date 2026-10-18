import {Writer} from './codec.mjs';
import {equipment,attributes} from './restoration.mjs';
import {openContainer,equipPet,unequipPet,activePet,gainPet,petAttributes,petTemplates,chestTemplates,rejuvenatePet} from './pet-state.mjs';
import {petDetail,petReward} from './pet-packets.mjs';
import {addedItems,itemPacket} from './restoration-packets.mjs';
import {levelReward,healthUpdate} from './game-packets.mjs';
import {gain} from './content.mjs';
import {PLAYER_LEVEL_CAP} from './player-experience.mjs';
import {recordActivity} from './daily-activity.mjs';
import {notifyDaily} from './daily-service.mjs';
import {handlePetSkillBooks} from './pet-skill-books.mjs';
import {handlePetSealing} from './pet-sealing.mjs';
import {LEGENDARY_EGG_ID,selectablePetEggsById} from './pet-catalog.mjs';
import {isSpiritBox} from './spirit-seal-data.mjs';
import {MAX_LEVEL_PLAYER_SCROLL_ITEM_ID,MAX_LEVEL_PET_SCROLL_ITEM_ID} from './local-items.mjs';
// MOD(currency-item)：货币兑换道具的面额。客户端的物品定义里 powerValue1 是 16 位短整型
// （上限 32767），1000000 这类面额写进 wire 会被截断，所以真实面额在这里按 power1 定死，
// 不再读被截断的 powerValue1。黄金/金叶 10000 本来就在范围内，列出来只是为了统一。
const EXCHANGE_AMOUNTS={301:10000,302:10000,303:1000000};
// MOD(max-level-scroll)：两张「一键满级」卷也不读 powerValue1 —— 人物 1→97 累计需要 30608
// 经验（32767 勉强够），宠物 1→97 累计需要 3,503,120 经验（远超 16 位上限）。所以给一个
// 「无论如何都够」的经验值，由 gain/gainPet 内部按经验表逐级升到各自的等级上限。
const MAX_LEVEL_SCROLL_EXP=2147483647;
export function handlePetItems(type,r,context,{store,send,log,random}){
 if(handlePetSealing(type,r,context,{store,send,log,random}))return true;
 if(handlePetSkillBooks(type,r,context,{store,send,log}))return true;
 const p=context.role;if(!p)return false;const start=r.pos;
 if(type===15502){try{const slot=r.short(),item=p.inventory.find(i=>i.slot===slot&&i.pet);if(!item)throw Error('这个位置没有宠物。');send(type,petDetail(new Writer().byte(0),item.pet));}catch(e){send(type,new Writer().byte(-1).string(e.message));}return true;}
 if(type!==12001)return false;
 const wait=r.byte(),action=r.byte(),slot=r.short(),quantity=r.int();
 // MOD(currency-item)：货币兑换道具（黄金/金叶/铜币，物品 power1 301/302/303）。
 // 客户端对这类道具发出的 wait 不在下面的白名单里，所以必须放在白名单校验之前，
 // 否则会提前 return 给别的处理器。兑换逻辑与本包其余货币改动一致：
 // 先做一次结构化快照，失败就整体回滚，成功后写存档并回 11004 刷新货币条。
 if([3,8].includes(action)&&slot>=30){
  const curSource=p.inventory.find(i=>i.slot===slot),curDef=equipment.get(curSource?.itemId);
  const curKey=curDef?{301:'gold',302:'silver',303:'coins'}[curDef.power1]:null;
  if(curKey){
   try{
    if(context.battle)throw Error('请先结束战斗。');
    if(!curSource||!Number.isInteger(quantity)||quantity<1||quantity>99||quantity>curSource.quantity)throw Error('道具数量已变化，请刷新背包。');
    const amount=(EXCHANGE_AMOUNTS[curDef.power1]??curDef.powerValue1??0)*quantity;
    if(!Number.isSafeInteger(amount)||amount<=0)throw Error('兑换数值超出有效范围。');
    const before=structuredClone(p);
    try{
     const value=(p[curKey]||0)+amount;
     if(!Number.isSafeInteger(value)||value>2147483647)throw Error('货币已达当前存档上限。');
     p[curKey]=value;
     curSource.quantity-=quantity;if(!curSource.quantity)p.inventory=p.inventory.filter(i=>i!==curSource);
     store.save();
    }catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);throw error;}
    send(type,new Writer().byte(wait).byte(0).byte(0));
    send(11004,new Writer().byte(1).short({gold:11,silver:12,coins:13}[curKey]).int(amount).short(13).int(0));
    log('currency-item',{role:p.id,itemId:curDef.id,currency:curKey,amount});
   }catch(e){send(type,new Writer().byte(-1).string(e.message));}
   return true;
  }
 }
 if(![1,2,3,4,11,12,14].includes(wait)){r.pos=start;return false;}
 try{
  if(context.battle)throw Error('请先结束战斗。');
  const source=p.inventory.find(i=>i.slot===slot),definition=equipment.get(source?.itemId);
  if(!source||!Number.isInteger(source.quantity)||!Number.isInteger(quantity)||quantity<1||quantity>99||quantity>source.quantity)throw Error('道具数量已变化，请刷新背包。');
  const experienceUse=[3,8].includes(action)&&[11,12].includes(wait);
  // 宝箱/宠物蛋(行动3，等待类型1/4)也允许一次开多个：openContainer 会先算容量，
  // 放不下就整批拒绝并报出「最多能开几个」。经验卷(11/12)本来就是多份使用。
  const containerUse=action===3&&[1,4].includes(wait);
  if(!experienceUse&&!containerUse&&quantity!==1)throw Error('这种道具请逐个使用。');
  if(action===3&&[1,4].includes(wait)){
    if((wait===1&&!petTemplates.has(source.itemId)&&source.itemId!==LEGENDARY_EGG_ID&&!selectablePetEggsById.has(source.itemId))||(wait===4&&!chestTemplates.has(source.itemId)&&!isSpiritBox(source.itemId)))throw Error('道具类型不匹配。');
   const before=structuredClone(p);let result;
   try{result=openContainer(p,slot,quantity,random);if(wait===4)recordActivity(p,21);store.save();}
   catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);throw error;}
   send(type,addedItems(new Writer().byte(wait).byte(0),result.added));if(wait===4)notifyDaily(p,send);
  }
  else if(action===1&&wait===2){const dest=r.byte();const pet=equipPet(p,slot,dest);store.save();send(type,petDetail(new Writer().byte(2),pet));}
  else if(action===2&&wait===3){if(slot!==1)throw Error('宠物未出战。');unequipPet(p);store.save();send(type,new Writer().byte(3).short(0));}
  else if(action===3&&wait===14){
   // 第 73 版：宠物返老还童石（40005）—— 客户端把它归到 BAG_PET_AGE(14)。
   // 包体在 quantity 之后多一个 short(petSlot)（createPlayerBagMessage 对 isPetCanUseItem()
   // 的道具会 putShort(o)），之后才是通用的 bool + byte(item.type)，一并读掉别留在包里。
   const petSlot=r.short();r.bool();r.byte();
   const before=structuredClone(p);let pet;
   try{pet=rejuvenatePet(p,slot,petSlot);store.save();}
   catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);throw error;}
   // BAG_PET_AGE 分支读 long(剩余毫秒)：客户端自己加 serverTime 换成 ageTime，再提示
   // 「宠物寿命已重置」，并把 petItem.petAgeTime 一起更新 —— 所以回的是**剩余**时间。
   send(type,new Writer().byte(14).long(Math.max(0,pet.expiresAt-Date.now())));
   log('pet-rejuvenated',{role:p.id,stone:slot,petSlot,expiresAt:pet.expiresAt});
  }
  else if(experienceUse){
   if(slot<30||definition?.type!==28||definition.power1!==(wait===11?119:118))throw Error('无效经验卷。');
   // MOD：宠物经验卷不再要求宠物出战 —— 优先出战宠物，否则取背包里第一只宠物
   // （等级上限仍是人物等级）。原来的写法只认 activePet，休息中的宠物吃不到卷。
   const expPetItem=wait===12?(p.inventory.find(i=>i.slot===1&&i.pet)||p.inventory.find(i=>i.pet)):null;
   const expPet=expPetItem?expPetItem.pet:null;
   if(wait===12&&!expPet)throw Error('背包里没有可以使用经验卷的宠物。');
   if(wait===12&&expPet.level>=Math.min(97,p.level))throw Error('宠物已达人物等级上限，不能再使用宠物经验卷。');
   if(wait===11&&p.level>=PLAYER_LEVEL_CAP)throw Error('人物已达97级，不能再使用人物经验卷。');
   if(p.level<(definition.reqLv||0))throw Error('人物等级不足，不能使用这张经验卷。');
   if((p.vipLevel2||0)<(definition.vipLevelReq||0))throw Error('VIP等级不足，不能使用这张经验卷。');
   const amount=(definition.id===MAX_LEVEL_PLAYER_SCROLL_ITEM_ID||definition.id===MAX_LEVEL_PET_SCROLL_ITEM_ID)?MAX_LEVEL_SCROLL_EXP:definition.powerValue1*quantity;
   if(!Number.isSafeInteger(amount)||amount<=0||amount>2147483647)throw Error('经验卷数值超出有效范围。');
   const response=new Writer().byte(wait);
   const before=structuredClone(p);
   try{
    source.quantity-=quantity;if(!source.quantity)p.inventory=p.inventory.filter(i=>i!==source);
    if(wait===11){const reward=gain(p,amount,0);levelReward(response,p,reward);}
    else {const reward=gainPet(p,amount,expPet);petReward(response,reward);itemPacket(response,expPetItem);}
    store.save();
   }catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);throw error;}
   send(type,response);send(17601,healthUpdate(p));
  }else throw Error('未支持的宠物或宝箱操作。');
  log('pet-bag-action',{role:p.id,wait,action,slot,quantity});return true;
 }catch(e){send(type,new Writer().byte(-1).string(e.message));log('pet-bag-rejected',{role:p.id,wait,action,slot,quantity,error:e.message});return true;}
}
