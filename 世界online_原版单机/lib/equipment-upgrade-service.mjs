import {Writer} from './codec.mjs';
import {equipment} from './restoration.mjs';
import {itemPacket} from './restoration-packets.mjs';
import {starValue,upgradeRules,itemWithAffixes} from './item-affixes.mjs';
import {upgradeTarget,identificationTarget,fingerprint,identificationList,planIdentification,planAcceptIdentification,planStar,starPreview,planAdvancedStar,advancedStarPreview,planGem,gemReplaceQuote,planGemReplace} from './equipment-upgrades.mjs';
import {pushPetEquipmentChanges} from './pet-equipment-service.mjs';
import {recordActivity} from './daily-activity.mjs';
import {notifyDaily} from './daily-service.mjs';

const complete=r=>{if(r.pos!==r.b.length)throw Error('装备操作请求长度不正确。');};
function commit(role,next,store){
  const previous={...role};for(const key of Object.keys(role))delete role[key];Object.assign(role,next);
  try{store.save();}catch(error){for(const key of Object.keys(role))delete role[key];Object.assign(role,previous);throw error;}
}
export function starPreviewPacket(preview){
  const e=preview.item,bound=!!(e.autoBinding||preview.candidate.bound),w=new Writer().byte(0).bool(true).int(1).int(preview.available).byte(e.star).byte(preview.successRate).byte(0);
  for(const key of ['def_str','def_agi','def_mag'])w.short(e[key]||0);
  for(const field of ['power1','power2','power3','bindPower1','bindPower2'])w.short(starValue(e[field.replace('Power','PowerValue').replace(/^power/,'powerValue')],e.ascensionStar,e.star,bound,e[field]));
  const weapon=e.atkMin!==undefined;w.bool(weapon);if(weapon)w.short(e.atkMin).short(e.atkMax);
  for(const n of [4,5,6,7])w.short(starValue(e['powerValue'+n],e.upgradeAscensionStar,e.upgradeStar,bound,e['power'+n]));
  return w.byte(e.upgradeAscensionStar||0).byte(preview.upgrade?preview.currentStar:(e.upgradeStar||0));
}
export function handleEquipmentUpgrades(type,r,context,{store,send,log,draw}){
  if(!context.role||![12001,12041,12015,11506,11528,11507,11508].includes(type))return false;
  if(type===12001&&![5,6].includes(r.b[r.pos]))return false;
  const role=context.role;
  try{
    if(context.battle)throw Error('请先结束战斗再鉴定、强化或镶嵌装备。');
    // 宝石替换：11507 报价（返回要消耗的背包槽位与数量），11508 确认（真正扣宝石并回写装备）。
    //
    // 注意 11507 的应答格式：客户端把它列在 sendProtoAsync 的 resultMsg 里
    // （analysis/modules/0035.js），该路径会先调用 Handler.processMessage 读走**第一个字节**当状态：
    //   负数 → alertMessageGuide(后面那段文案) 并让这次 sendProtoAsync 直接返回空；
    //   >=0  → 才把剩下的字节交给调用方。
    // 所以报价回包必须是「状态字节 + 条数 + 各槽位」；少这个状态字节的话，客户端会把它当成状态、
    // 再把真正的条数后面的第一个字节（槽位高字节，通常是 0）当成条数，于是消耗清单是空的，
    // 确认时发出去的是 0 条材料，界面上就表现为「点了确定没有任何反应」。
    // 同类先例：12019 CG_BAG_REPAIR 也是这样先写 byte(0) 再写铜币。
    if(type===11507){
      const slot=r.short(),id=r.int(),gemSlot=r.short();complete(r);
      const quote=gemReplaceQuote(role,slot,id,gemSlot);
      if(quote.missing>0)throw Error(`替换需要 ${quote.need} 颗「${quote.definition.name}」，背包里只有 ${quote.need-quote.missing} 颗。`);
      context.gemReplace={slot,id,gemSlot};
      const w=new Writer().byte(0).byte(quote.rows.length);for(const row of quote.rows)w.short(row.slot).byte(row.quantity);
      send(type,w);log('equipment-gem-replace-quote',{role:role.id,slot,id,gemSlot,need:quote.need,rows:quote.rows.length});return true;
    }
    if(type===11508){
      const slot=r.short(),id=r.int(),count=r.byte()&255,rows=[];
      for(let n=0;n<count;n++)rows.push({slot:r.short(),quantity:r.byte()&255});
      const confirm=r.bool();complete(r);
      if(!confirm)throw Error('已取消宝石替换。');
      const plan=context.gemReplace;
      if(!plan||plan.slot!==slot||plan.id!==id)throw Error('请重新打开宝石替换界面。');
      const {next,item,gem,attachment,consumed,replaced}=planGemReplace(role,slot,id,plan.gemSlot,rows);
      commit(role,next,store);delete context.gemReplace;
      send(type,itemPacket(new Writer().byte(0),item));
      log('equipment-gem-replaced',{role:role.id,slot,id,gemSlot:plan.gemSlot,gem:gem.itemId,count:attachment.count,power:attachment.power,value:attachment.value,from:replaced,consumed});return true;
    }
    if(type===12041){
      const scroll=r.int(),upgrade=r.bool();complete(r);const list=identificationList(role,scroll,upgrade);
      if(!upgradeRules.advanced.starScrolls.includes(scroll))context.identifyScroll=scroll;const w=new Writer().byte(0).short(list.length);for(const slot of list)w.short(slot);send(type,w);return true;
    }
    if(type===12015){
      const mode=r.byte(),slot=r.short(),id=r.int(),accept=r.bool(),upgrade=r.bool();complete(r);
      const before=structuredClone(role),petEquipment=!!role.pendingIdentification?.uid;
      const {next}=planAcceptIdentification(role,mode,slot,id,accept,upgrade);commit(role,next,store);if(petEquipment)pushPetEquipmentChanges(before,role,send);send(type,new Writer().byte(0));log('equipment-identification-confirmed',{role:role.id,slot,id,accept});return true;
    }
    if(type===11506||type===11528){
      const upgrade=type===11528,key=upgrade?'advancedStarPreview':'starPreview';
      const slot=r.short(),id=r.int(),mode=r.byte();complete(r);
      if(mode===1||mode===3){const preview=(upgrade?advancedStarPreview:starPreview)(role,slot,id,mode);if(mode===1)context[key]={slot,id,fingerprint:preview.fingerprint};send(type,starPreviewPacket(preview));return true;}
      if(mode!==2)throw Error('无效强化操作。');
      const {instance}=upgradeTarget(role,slot,id),preview=context[key];
      if(!preview||preview.slot!==slot||preview.id!==id||preview.fingerprint!==fingerprint(instance))throw Error('装备已变化，请重新打开强化预览。');
      const {next,item,consumed,success}=(upgrade?planAdvancedStar:planStar)(role,slot,id,draw),w=new Writer().byte(0).byte(1).short(consumed.slot).byte(1).bool(success);
      if(success){if(upgrade){const e=itemWithAffixes(equipment.get(item.itemId)||item.recordedDefinition,item);for(const n of [4,5,6,7])w.short(e['power'+n]||0).short(e['powerValue'+n]||0);w.byte(e.upgradeAscensionStar||0).byte(e.upgradeStar||0);}else itemPacket(w,item);}
      if(success)recordActivity(next,5);commit(role,next,store);delete context[key];send(type,w);if(success)notifyDaily(role,send);log('equipment-star',{role:role.id,slot,id,upgrade,star:upgrade?item.upgradeStar:item.star,success,consumed});return true;
    }
    const wait=r.byte(),action=r.byte(),slot=r.short(),quantity=r.int(),gemSlot=action===6?r.short():undefined,upgrade=r.bool(),itemType=r.byte(),uid=itemType===41?r.long().toString():undefined;complete(r);
    const {instance,template}=action===5?identificationTarget(role,slot,undefined,uid):upgradeTarget(role,slot);
    if(quantity!==1||(upgrade&&action!==5)||itemType!==template.type||wait!==action)throw Error('无效装备操作，请重新打开装备详情。');
    if(action===5){
      const ids=upgrade?upgradeRules.advanced.identifyScrolls:upgradeRules.identify.scrolls,scroll=ids.includes(context.identifyScroll)?context.identifyScroll:undefined;
      const {next,candidate,consumed}=planIdentification(role,slot,scroll,draw,uid,upgrade),w=itemPacket(new Writer().byte(5).byte(1).byte(1).short(consumed.slot).int(consumed.itemId),{...candidate,slot}).bool(false);
      // A new advanced candidate carries its powers in the item definition.
      // Native v305 then reads separate old/new extension flags.
      if(upgrade)w.bool(false);
      recordActivity(next,25);commit(role,next,store);context.identifyScroll=undefined;send(type,w);notifyDaily(role,send);log('equipment-identified',{role:role.id,slot,id:instance.itemId,consumed});return true;
    }
    if(action===6){
      const {next,attachment:a,consumed,success,restarted}=planGem(role,slot,gemSlot,draw),w=new Writer().byte(6).bool(success).byte(a.count).short(a.power).short(a.value).byte(1).short(consumed.slot).int(consumed.itemId);
      commit(role,next,store);send(type,w);log('equipment-gem',{role:role.id,slot,id:instance.itemId,attachment:a,success,restarted,consumed});return true;
    }
    throw Error('未识别的装备操作。');
  }catch(error){
    // 11507 在客户端的 resultMsg 里，负数状态会由框架自己弹文案并把这次请求作废，
    // 所以和各协议一样回 byte(-1)+说明即可，不需要特殊处理。
    send(type,new Writer().byte(-1).string(error.message));
    log('equipment-upgrade-rejected',{role:role.id,type,error:error.message});
  }
  return true;
}
