import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Reader,decoders} from './capture-decoders.mjs';
import {readLevelReward,skipNpcSigns} from './capture-public-blocks.mjs';
import {readPetDetail,readPetLevelReward} from './capture-pet-blocks.mjs';
import {itemSlots} from '../lib/official-data.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),capture=path.resolve(process.argv[2]),name=path.basename(capture),d=decoders(root);
const publicScenes=JSON.parse(fs.readFileSync(path.join(capture,'analysis/scene-packets.json'),'utf8'));
const born=publicScenes.find(s=>s.archetype?.level===1),inventory=new Map(born.inventoryDefinitions.map(i=>[i.slot,{...i,id:i.itemId}]));
const definitions=new Map(),chests=[],petItems=[],petSnapshots=[],petRewards=[],operations=[];
const rows=fs.readdirSync(path.join(capture,'events')).filter(n=>/^\d+\.ndjson$/.test(n)).sort().flatMap(n=>fs.readFileSync(path.join(capture,'events',n),'utf8').trim().split('\n').map(JSON.parse));
let pending,activeEgg=0,latestGroup=0,latestMission=0;
function instance(r){
 const quantity=r.getShort();r.take(13);const slot=r.getShort(),status=r.getByte();if(status&1)r.getInt();
 const start=r.pos,item=new d.Item();d.Item.fromBytesAtts2(item,r);
 if(item.type===32){const value={id:24,quantity,slot,eggId:activeEgg};petItems.push({eggId:activeEgg,type:item.type,bagIcon:item.bagIcon,grade:item.grade,autoBinding:item.autoBinding,icon:item.icon,reqLv:item.reqLv,headIcon:item.petHeadIcon,lifeMs:item.petAgeTime});return value;}
 const raw=r.b.subarray(start,r.pos),cleanReader=new Reader(raw);cleanReader.getByte();
 if(cleanReader.getBoolean()){cleanReader.getBoolean();cleanReader.take((cleanReader.getByte()&255)*9);const illusion=cleanReader.getInt();cleanReader.getLong();if(illusion)d.Item.fromBytesAtts2(new d.Item(),cleanReader);}
 const wire=Buffer.concat([Buffer.from([item.type,0]),raw.subarray(cleanReader.pos)]),cleanItem=new d.Item(),check=new Reader(wire);d.Item.fromBytesAtts2(cleanItem,check);check.finish();
 const {illusion,...definition}=cleanItem;definition.definitionBase64=wire.toString('base64');definition.sources=[{capture:name,origin:'chest-reward'}];definitions.set(item.id,definition);
 return {id:item.id,quantity,slot};
}
function addItems(r){const rewards=[];for(let n=r.getByte();n>0;n--){const mode=r.getByte(),quantity=r.getByte();if(mode===1){const slot=r.getInt(),item=instance(r);if(slot!==item.slot)throw Error('Slot mismatch');inventory.set(slot,item);rewards.push({id:item.id,quantity,...(item.eggId?{eggId:item.eggId}:{})});}else if(mode===2){const id=r.getInt(),slot=r.getInt(),old=inventory.get(slot);if(!old||old.id!==id)throw Error('Stack not found');old.quantity+=quantity;rewards.push({id,quantity});}else throw Error('Unknown reward mode');}return rewards;}
function remove(slot,quantity){const old=inventory.get(slot);if(!old||old.quantity<quantity)throw Error('Consumed slot is missing '+slot);old.quantity-=quantity;if(!old.quantity)inventory.delete(slot);}
for(const event of rows){
 if(event.seq<=born.seq||!/^Network.webSocketFrame(Sent|Received)$/.test(event.method))continue;
 const b=fs.readFileSync(path.join(capture,event.params.response.payload.file)),type=b.readUInt16BE(2),r=new Reader(b.subarray(4)),sent=event.method.endsWith('Sent');
 if(sent){if(type===12001){pending={seq:event.seq,wait:r.getByte(),action:r.getByte(),slot:r.getShort(),quantity:r.getInt()};pending.item=structuredClone(inventory.get(pending.slot));if(pending.action===1)pending.dest=r.getByte();}if(type===12501)latestGroup=r.getShort();if(type===14503){r.getShort();latestMission=r.getShort();}continue;}
 if(type===14503){if(r.getByte()<0)continue;skipNpcSigns(r);r.getBoolean();r.take(2+16);readLevelReward(r);if(r.getBoolean())petRewards.push({seq:event.seq,eggId:activeEgg,missionId:latestMission,...readPetLevelReward(r,d)});for(let n=r.getByte();n>0;n--){r.getInt();const slot=r.getInt(),qty=r.getByte();remove(slot,qty);}addItems(r);r.getBoolean();if(r.getBoolean())throw Error('Country reward');r.finish();}
 if(type===12502){const result=r.getByte();if(result===2){r.getInt();readLevelReward(r);r.getBoolean();if(r.getBoolean())petRewards.push({seq:event.seq,eggId:activeEgg,groupId:latestGroup,...readPetLevelReward(r,d)});}}
 if(type===12003){if(r.getByte()<0)continue;r.take(6);const flags=r.getInt();if(flags!==16)throw Error('Unexpected bag-refresh flags');inventory.clear();for(let n=r.getShort();n>0;n--){const item=instance(r);inventory.set(item.slot,item);}r.finish();}
 if(type===12001){
  const wait=r.getByte();if(wait<0)continue;if(!pending)throw Error('Unpaired bag reply');
  if(wait===4||wait===1){if(!pending.item)throw Error('Unknown opening input at '+event.seq);const inputId=pending.item.id;if(wait===1)activeEgg=inputId;remove(pending.slot,pending.quantity);const extra=r.getByte();if(extra){const slot=r.getShort();r.getInt();remove(slot,extra);}const rewards=addItems(r);r.finish();chests.push({seq:event.seq,inputId,wait,quantity:pending.quantity,rewards});}
  else if(wait===9||wait===2){const input=pending.item;if(!input)throw Error('Unknown equip input '+event.seq);const item=definitions.get(input.id)||JSON.parse(fs.readFileSync(path.join(root,'data/official-v305.json'),'utf8')).items.find(i=>i.id===input.id);const slots=input.id===24?[1]:itemSlots(item.type);const dest=pending.dest>=0?pending.dest:slots.find(s=>!inventory.has(s))??slots[0];const old=inventory.get(dest);inventory.delete(pending.slot);if(old)inventory.set(pending.slot,{...old,slot:pending.slot});inventory.set(dest,{...input,slot:dest});
   if(wait===2){const pet=readPetDetail(r,d);r.finish();petSnapshots.push({seq:event.seq,eggId:activeEgg,...pet});}
  }
  operations.push({seq:event.seq,wait,inputId:pending.item?.id});
 }
 if(type===17602){r.getShort();const pet=readPetDetail(r,d);r.finish();petSnapshots.push({seq:event.seq,eggId:activeEgg,...pet});}
}
const output={schema:1,capture:name,chests,petItems,petSnapshots,petRewards,items:[...definitions.values()],operations};
fs.writeFileSync(path.join(root,'analysis/pet-chest-capture.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({chests,petItems,snapshots:petSnapshots.map(p=>({seq:p.seq,egg:p.eggId,level:p.level,hp:p.hp,expMax:p.expMax,stats:p.baseStats,skills:p.skills.map(s=>s.id)})),petRewards:petRewards.length,items:output.items.length},null,2));
