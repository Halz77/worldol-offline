import fs from 'node:fs';

export const recordedExpansion=JSON.parse(fs.readFileSync(new URL('../data/recorded-expansion-20260922.json',import.meta.url),'utf8'));
export const recordedExpansionRevision=recordedExpansion.revision;
const keys={items:r=>r.id,missions:r=>r.id,monsters:r=>r.id,ai:r=>r.id,skills:r=>r.id+':'+r.level,groups:r=>r.groupId,areas:r=>r.id,mapList:r=>r.id};
const sources=(a=[],b=[])=>[...new Map([...a,...b].map(s=>[[s.capture,s.seq,s.origin,s.mapId,s.npcId,s.sha256].join(':'),s])).values()];

export function applyRecordedExpansion(official){
  for(const [table,key] of Object.entries(keys)){
    const index=new Map(official[table].map(r=>[key(r),r]));
    for(const captured of recordedExpansion[table]){
      const existing=index.get(key(captured));
      if(existing){
        // Equipped/bound/enhanced item instances are evidence, not replacements
        // for the game's canonical item templates or the player's current gear.
        if(table==='items')continue;
        const a=existing.monsterWireBase64||existing.wireBase64,b=captured.wireBase64;
        if(a&&b&&a!==b)throw Error('Conflicting recorded '+table+' '+key(captured));
        if(!existing.localChallenge&&['missions','groups'].includes(table))existing.sources=sources(existing.sources,captured.sources);
      }else{
        const row=structuredClone(captured);official[table].push(row);index.set(key(row),row);
        if(table==='missions')row.deferredRewardItems=(row.rewardItems||[]).filter(i=>!official.items.some(known=>known.id===i.id));
      }
    }
  }
  for(const captured of recordedExpansion.maps){
    const existing=official.maps.find(m=>m.id===captured.id);
    if(!existing){official.maps.push(structuredClone(captured));continue;}
    for(const npc of captured.npcs){
      const old=existing.npcs.find(n=>n.id===npc.id);
      if(!old)existing.npcs.push(structuredClone(npc));
      else if(!old.localChallenge)old.sources=sources(old.sources,npc.sources);
    }
  }
  // The recorded MJ scene relies on a special execution script to reveal this
  // girl. Express its captured quest transition as native visibility conditions
  // so both the client and local service keep the same story state after login.
  const girl=official.maps.find(m=>m.id===952)?.npcs.find(n=>n.id===60);
  if(girl){
    const wire=Buffer.from(girl.wireBase64,'base64');
    if(wire.subarray(-6).toString('hex')!=='0000000b0601')throw Error('MJ quest NPC visibility wire changed');
    girl.missionData=[2821,7,2822,1];wire.writeUInt16BE(2821,wire.length-6);wire[wire.length-4]=7;
    girl.wireBase64=wire.toString('base64');
    girl.localVisibilityReason='Show recorded mission 2821 target until mission 2822 is submitted';
  }
  return official;
}

export function applyRecordedExpansionEvents(recorded){
  for(const table of ['questEvents','battleEvents']){
    const seen=new Set(recorded[table].map(e=>e.capture+':'+e.seq));
    for(const event of recordedExpansion[table])if(!seen.has(event.capture+':'+event.seq)){recorded[table].push(structuredClone(event));seen.add(event.capture+':'+event.seq);}
  }
  for(const capture of recordedExpansion.captures)if(!recorded.captures.some(c=>c.id===capture.id))recorded.captures.push({id:capture.id,endedAt:capture.audit.cutoffAt,gaps:capture.audit.captureGaps.length,networkFailures:capture.audit.networkFailures.length});
  recorded.revision+='+'+recordedExpansionRevision;
  return recorded;
}

export function applyRecordedExpansionDaily(data){
  // Partial official quest chains remain playable from their recorded NPCs.
  // Do not award a whole activity's points for a guessed final step.
  for(const task of data.tasks)if(!task.linkage&&task.pending==='目标地图尚未采集'&&recordedExpansion.maps.some(m=>m.id===task.mapId))task.pending='场景已恢复，完整任务链或活动结算规则待定';
  return data;
}
