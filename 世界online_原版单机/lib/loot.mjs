import fs from 'node:fs';
import {officialGroups,officialMonsters,officialMaps} from './official-data.mjs';
import {equipment,bagCapacity,firstFree} from './restoration.mjs';

export const dropCatalog=JSON.parse(fs.readFileSync(new URL('../data/drop-catalog.json',import.meta.url),'utf8'));
// Later verified captures can supply item definitions missing from this audit.
for(const task of dropCatalog.tasks)for(const row of [...task.rewardItems,...task.selectItems,...task.requirements])row.available=equipment.has(row.id);
dropCatalog.summary.missingRewardIds=dropCatalog.summary.missingRewardIds.filter(id=>!equipment.has(id));
export const dropRevision=dropCatalog.revision;
export const dropRateMultiplier=dropCatalog.policy.rateMultiplier??1;
const groupRules=new Map(dropCatalog.groups.map(g=>[g.key,g]));
const gearCache=new Map();
export function gearPool(level,tier){
 level=Math.min(97,level);const key=`${level}:${tier}`;
 if(!gearCache.has(key)){
  const eligible=dropCatalog.gear.filter(i=>i.level<=level&&i.grade<=dropCatalog.policy.rates[tier].maxGrade);
  const recent=eligible.filter(i=>i.level>=level-dropCatalog.policy.gearLookback);
  const nearest=Math.max(0,...eligible.map(i=>i.level));
  gearCache.set(key,(recent.length?recent:eligible.filter(i=>i.level===nearest)).map(i=>i.id));
 }
 return gearCache.get(key);
}
export function ruleForBattle(battle){
 if(!battle.official)return null;
 const known=groupRules.get(`${battle.mapId}:${battle.group}`);if(known)return known;
 const group=officialGroups.get(battle.group),monsters=group?.monsters.filter(Boolean).map(id=>officialMonsters.get(id)).filter(Boolean);
 if(!monsters?.length)return null;
 return {groupId:battle.group,mapId:battle.mapId,map:officialMaps.get(battle.mapId)?.name,name:[...new Set(monsters.map(m=>m.name))].join(' / '),level:Math.max(...monsters.map(m=>m.level)),tier:monsters.some(m=>m.monstertype>=2)?'boss':monsters.some(m=>m.monstertype===1)?'elite':'normal',equipment:[],materials:[],extras:[],taskDrops:[]};
}
function combined(rows){const merged=new Map();for(const r of rows){if(!equipment.has(r.id)||!Number.isSafeInteger(r.quantity)||r.quantity<=0)throw Error('掉落队列中的道具或数量无效。');const quantity=(merged.get(r.id)||0)+r.quantity;if(!Number.isSafeInteger(quantity))throw Error('掉落数量超出范围。');merged.set(r.id,quantity);}return [...merged].map(([id,quantity])=>({id,quantity}));}
export function rollBattleLoot(p,battle,random=Math.random){
 const rule=ruleForBattle(battle);if(!rule)return [];
 const out=[],rates=dropCatalog.policy.rates[rule.tier];
 const pick=pool=>pool[Math.min(pool.length-1,Math.floor(random()*pool.length))];
 const maybe=(pool,chance)=>{if(pool.length&&random()<chance*dropRateMultiplier)out.push({id:pick(pool),quantity:1});};
 maybe(rule.equipment.length?rule.equipment:gearPool(rule.level,rule.tier),rates.equipment);
 const materialPool=dropCatalog.policy.materialPools.find(b=>rule.level>=b.min&&rule.level<=b.max)?.ids||dropCatalog.policy.materialPools.at(-1).ids;
 maybe(rule.materials.length?rule.materials:materialPool,rates.material);
 maybe(rule.extras,rates.extra);
 for(const drop of rule.taskDrops){
  const required=Math.max(0,...drop.missions.filter(m=>p.quests.active[m.missionId]).map(m=>m.required));
  if(!required)continue;
  const owned=p.inventory.filter(i=>i.slot>=30&&i.itemId===drop.id).reduce((n,i)=>n+(i.quantity||1),0)
   +(p.pendingLoot||[]).filter(i=>i.id===drop.id).reduce((n,i)=>n+i.quantity,0)
   +out.filter(i=>i.id===drop.id).reduce((n,i)=>n+i.quantity,0);
  if(required>owned)out.push({id:drop.id,quantity:Math.min(required-owned,drop.quantity)});
 }
 return combined(out);
}
// Planning never mutates the owner. Anything that cannot fit remains in the save;
// a later native bag refresh/sort delivers it, including after relaunch.
export function planLootDelivery(p,rewards=[]){
 const copy={...p,inventory:structuredClone(p.inventory)},added=[],pending=[];
 for(const row of combined([...(p.pendingLoot||[]),...rewards])){
  const item=equipment.get(row.id),limit=Math.min(99,Math.max(1,item.stackNum||1));let left=row.quantity;
  for(const i of copy.inventory.filter(i=>i.slot>=30&&i.slot<30+bagCapacity(p)&&i.itemId===row.id&&!i.pet)){
   if(!left||added.length>=127)break;
   const quantity=Math.min(left,Math.max(0,limit-(i.quantity||1)));if(!quantity)continue;
   i.quantity=(i.quantity||1)+quantity;left-=quantity;added.push({mode:2,quantity,instance:{...i}});
  }
  while(left&&added.length<127){const slot=firstFree(copy);if(slot===undefined)break;const quantity=Math.min(left,limit),instance={itemId:row.id,slot,quantity};copy.inventory.push(instance);added.push({mode:1,quantity,instance:{...instance}});left-=quantity;}
  if(left)pending.push({id:row.id,quantity:left});
 }
 return {inventory:copy.inventory,pending,added};
}
export function applyLootDelivery(p,rewards=[]){
 const plan=planLootDelivery(p,rewards),existing=new Map(p.inventory.map(i=>[`${i.slot}:${i.itemId}`,i]));
 // Existing equipment and pet objects can still be referenced by the current
 // battle. Only quantities change during delivery; retain those live objects.
 p.inventory=plan.inventory.map(i=>{const live=existing.get(`${i.slot}:${i.itemId}`);if(!live)return i;live.quantity=i.quantity;return live;});
 plan.inventory=p.inventory;if(plan.pending.length)p.pendingLoot=plan.pending;else delete p.pendingLoot;return plan;
}
export function dropDirectory(){return {revision:dropRevision,summary:dropCatalog.summary,policy:dropCatalog.policy,bands:dropCatalog.bands,sources:dropCatalog.web.sources,groups:dropCatalog.groups.map(g=>({...g,equipment:(g.equipment.length?g.equipment:gearPool(g.level,g.tier)).map(id=>({id,name:equipment.get(id).name,level:equipment.get(id).level})),materials:(g.materials.length?g.materials:(dropCatalog.policy.materialPools.find(b=>g.level>=b.min&&g.level<=b.max)||dropCatalog.policy.materialPools.at(-1)).ids).map(id=>({id,name:equipment.get(id).name})),extras:g.extras.map(id=>({id,name:equipment.get(id).name})),taskDrops:g.taskDrops.map(({evidence,...d})=>d)}))};}
