import {equipment,attributes,clampVitals,bagCapacity} from './restoration.mjs';
import {activePet,petAttributes} from './pet-state.mjs';
import {itemSlots} from './official-data.mjs';

function selection(p,slot,quantity,allowPet=false){
 const item=p.inventory.find(i=>i.slot===slot),definition=allowPet&&item?.pet?{id:24,name:item.pet.name,native:true,price:0}:equipment.get(item?.itemId)||item?.recordedDefinition;
 if(!item||!definition||!Number.isInteger(quantity)||quantity<1||quantity>(item.quantity||1))throw Error('道具或数量已变化，请整理背包后重试。');
 return {item,definition};
}
function remove(p,item,quantity){item.quantity=(item.quantity||1)-quantity;if(!item.quantity)p.inventory=p.inventory.filter(i=>i!==item);}
// 消耗整组道具里的一份（转职书这类没有药品效果、由专门规则处理的消耗品用）。
export function consumeItem(p,slot,quantity){
 const {item}=selection(p,slot,quantity);
 remove(p,item,quantity);return item;
}
export function useMedicine(p,slot,quantity){
 const {item,definition:e}=selection(p,slot,quantity),effects=e.powers.filter(([id])=>id>=49&&id<=52);
 if(slot<30||e.type!==28||!effects.length||effects.length!==e.powers.length)throw Error('这种道具的使用规则尚未恢复。');
 if(p.level<e.level)throw Error('等级未达到使用要求。');
 // 单机放开数量限制：一次用 quantity 个，效果按份数叠加。因为每次都是
 // min(上限, 当前+增量)，连用 N 次与原来逐个点 N 次完全等价（超出的部分同样浪费）。
 const max=attributes(p),pet=activePet(p),petMax=pet?petAttributes(p,pet):null;
 for(let n=0;n<quantity;n++)for(const [id,value] of effects){
  const key=id<=50?'hp':'mp';
  p[key]=Math.min(max[key],p[key]+Math.trunc(value*(id%2===0?max[key]/100:1)));
  if(pet)pet[key]=Math.min(petMax[key],pet[key]+Math.trunc(value*(id%2===0?petMax[key]/100:1)));
 }
 remove(p,item,quantity);return e;
}
export function discardItem(p,slot,id,quantity){
 // Native pet release shares the discard packet; pet instances have ID 24
 // and carry their own definition instead of an equipment catalog entry.
 const {item}=selection(p,slot,quantity,true);
 if(item.pet&&slot<30)throw Error('出战宠物不能放生，请先让宠物休息。');
 if(slot<30||item.itemId!==id||quantity!==1)throw Error('请在背包中选择要丢弃的整组道具。');
 if(item.pet?.equipment?.length)throw Error('请先卸下宠物装备再放生宠物。');
 // Remove the whole stack without mutating it so a failed save can restore it.
 p.inventory=p.inventory.filter(i=>i!==item);return item;
}
export function sellItem(p,slot,id,quantity){
 const {item,definition:e}=selection(p,slot,quantity,true);
 if(slot<30||item.itemId!==id)throw Error('请先卸下装备再出售。');
 if(item.pet?.equipment?.length)throw Error('请先卸下宠物装备再出售宠物。');
//  const price=e.native?e.price:Math.floor(e.localPrice/2);
 const price=e.native?Number.isSafeInteger(e.price)?e.price:Math.floor(Number(e.localPrice||0)/2)
  : Math.floor(Number(e.localPrice||0)/2);

 if(!Number.isSafeInteger(price)||price<0)throw Error('这件道具没有可确认的出售价格。');
 const coins=p.coins+price*quantity;if(!Number.isSafeInteger(coins)||coins>2147483647)throw Error('铜币余额已达到上限。');
 remove(p,item,quantity);p.coins=coins;return e;
}
export function sellItems(p,items){
 if(!items.length||items.length>bagCapacity(p))throw Error('请选择要出售的背包道具。');
 const next={...p,inventory:structuredClone(p.inventory)},slots=new Set();
 for(const {slot,id,quantity} of items){
  if(!Number.isInteger(slot)||slot<30||slot>=30+bagCapacity(p)||slots.has(slot))throw Error('出售列表已变化，请重新选择道具。');
  slots.add(slot);sellItem(next,slot,id,quantity);
 }
 const total=next.coins-p.coins;p.inventory=next.inventory;p.coins=next.coins;return total;
}
export function bindItem(p,slot){
 const {item,definition:e}=selection(p,slot,1);
 if(!e.native||!itemSlots(e.type).length)throw Error('这件道具不能绑定。');
 item.bound=true;clampVitals(p);return e;
}
