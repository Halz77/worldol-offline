import fs from 'node:fs';

export const yunruoTemple=JSON.parse(fs.readFileSync(new URL('../data/yunruo-temple-v1.json',import.meta.url),'utf8'));
export const yunruoTempleRevision=yunruoTemple.revision;

export function applyYunruoTemple(official){
  for(const table of ['monsters','groups','ai','missions'])for(const source of yunruoTemple[table]){
    const key=table==='groups'?'groupId':'id',existing=official[table].find(row=>row[key]===source[key]);
    if(existing){if(existing.wireBase64!==source.wireBase64)throw Error('Conflicting Yunruo '+table+' '+source[key]);continue;}
    const record=structuredClone(source);
    if(table==='missions')record.deferredRewardItems=(record.rewardItems||[]).filter(item=>!official.items.some(known=>known.id===item.id));
    official[table].push(record);
  }
  for(const source of yunruoTemple.skills){
    const existing=official.skills.find(s=>s.id===source.id&&s.level===source.level);
    if(!existing)official.skills.push(structuredClone(source));
    else if((existing.monsterWireBase64||existing.wireBase64)!==source.wireBase64)throw Error('Conflicting Yunruo skill '+source.id+':'+source.level);
  }
  if(official.maps.some(m=>m.id===yunruoTemple.map.id))throw Error('Yunruo map already supplied');
  official.maps.push(structuredClone(yunruoTemple.map));
  return official;
}

export function applyYunruoDaily(data){
  for(const task of data.tasks)if(task.mapId===411&&task.name==='云若寺'){
    if(task.progressSum!==yunruoTemple.chain.length)throw Error('Yunruo activity progress differs from captured chain');
    task.linkage={terminal:yunruoTemple.chain.at(-1),missionIds:[...yunruoTemple.chain],evidence:'recorded-quest-chain-local-completion',capture:yunruoTemple.capture.id};
    task.pending=null;
  }
  return data;
}

// The capture supplies a reward identity, not its item definition or box contents.
// Preserve the entitlement in the same save transaction as quest completion.
export function deferYunruoRewards(p,q){
  for(const item of q.deferredRewardItems||[]){
    p.pendingMissionRewards??=[];
    const prior=p.pendingMissionRewards.find(r=>r.missionId===q.id&&r.itemId===item.id);
    if(prior)prior.quantity+=item.quantity;
    else p.pendingMissionRewards.push({missionId:q.id,itemId:item.id,name:item.name,quantity:item.quantity,bagIcon:item.bagIcon,grade:item.grade,reason:'missing-item-definition'});
  }
}
