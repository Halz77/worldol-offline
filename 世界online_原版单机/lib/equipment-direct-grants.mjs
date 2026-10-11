import {equipment} from './restoration.mjs';
import {itemSlots} from './official-data.mjs';
import {itemWithAffixes,gemAttachment} from './item-affixes.mjs';

export function planStrengthLoadout(role){
 const next=structuredClone(role),items=[];
 for(const item of next.inventory||[]){
  if(item.pet||item.slot<0||item.slot>=30)continue;
  const template=equipment.get(item.itemId);
  if(!template?.native||!itemSlots(template.type).includes(item.slot))throw Error(`穿戴位置 ${item.slot} 不是已恢复的人物装备。`);
  const previous=structuredClone(item);
  item.enchantment={itemId:8590};
  item.socketCapacity=30;
  item.gems=[{grant:'strength4',quantity:30}];
  item.gemBroken=false;
  const actual=itemWithAffixes(template,item),gem=gemAttachment(actual,item);
  if(actual.enchantPower1!==1||actual.enchantPowerValue1!==50||actual.enchantPower2!==168||actual.enchantPowerValue2!==100||gem.count!==30||gem.power!==1||gem.value!==120)throw Error('直装附魔和宝石核验不通过。');
  items.push({slot:item.slot,id:item.itemId,name:template.name,previous,enchantment:{level:actual.enchantLevel,strength:50,ignoreBack:100},gems:{count:30,strengthEach:4,totalStrength:120}});
 }
 if(!items.length)throw Error('角色没有穿戴人物装备。');
 if(items.some(i=>i.slot===next.pendingIdentification?.slot))delete next.pendingIdentification;
 return {next,items,summary:{equipment:items.length,gems:items.length*30,enchantStrength:items.length*50,gemStrength:items.length*120,ignoreBack:items.length*100}};
}
