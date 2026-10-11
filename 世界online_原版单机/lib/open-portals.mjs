import {Reader} from './codec.mjs';

export const openPortalsRevision='all-recorded-portals-open-20260922-v1';

// The recording retains seasonal closed flags and quest-gated travel menus.
// Project only portal visibility and travel conditions into the local world;
// leave ordinary NPC phases, quest progress, battle and shop conditions alone.
export function openPortal(npc){
 if(!npc.wireBase64||!npc.jumpMapID?.length)return npc;
 const body=Buffer.from(npc.wireBase64,'base64'),r=new Reader(body);
 r.take(14);r.utf();r.utf();r.utf();
 const statusOffset=r.pos,status=r.byte()&255;
 if(status!==npc.status)throw Error('Portal status mismatch: '+npc.mapId+':'+npc.id);
 body[statusOffset]=status|3;
 r.take(5); // direction, position and interaction range
 if(status&8){body.fill(0,r.pos,r.pos+6);r.take(6);}
 if(npc.npcType===5){
  const count=r.byte()&255;
  if(count!==npc.jumpMapID.length)throw Error('Portal menu mismatch: '+npc.mapId+':'+npc.id);
  for(let i=0;i<count;i++){
   r.utf();const target=r.short(),x=r.byte()&255,y=r.byte()&255;
   if(target!==npc.jumpMapID[i]||x!==npc.jumpMapGx[i]||y!==npc.jumpMapGy[i])throw Error('Portal destination mismatch: '+npc.mapId+':'+npc.id);
   body.fill(0,r.pos,r.pos+3);r.take(3);
  }
 }else if(![3,8].includes(npc.npcType))throw Error('Unsupported portal type '+npc.npcType);
 return {...npc,status:status|3,...(npc.missionData?{missionData:[0,0,0,0]}:{}),
  ...(npc.jumpMapReqMissionID?{jumpMapReqMissionID:npc.jumpMapReqMissionID.map(()=>0),jumpMapReqMissionState:npc.jumpMapReqMissionState.map(()=>0)}:{}),
  wireBase64:body.toString('base64'),localPortalOpen:true};
}

export function applyOpenPortals(official){
 for(const map of official.maps)map.npcs=map.npcs.map(openPortal);
 return official;
}
