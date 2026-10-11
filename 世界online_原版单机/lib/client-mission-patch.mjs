export const clientMissionRevision='npc-mission-refresh-v4';

// Quest replies update NPC signs, but v305 keeps the old canAccept snapshot.
// Invalidate loaded mission data before notifying the UI so the next NPC
// interaction obtains current eligibility, including chains without next IDs.
export function patchNpcMissionRefresh(source){
  const from='null!=l&&l.setSign(s)',to='null!=l&&(l.setSign(s),l.setTabStatus(!1,C.ModelConst.NPC_MISSION_LOAD))';
  if(source.split(from).length!==2)throw Error('v305 NPC mission refresh patch mismatch');
  return source.replace(from,to);
}

// v305 hides every completed quest before considering its UNLIMITED flag.
// Only change NPC availability/menu filtering. Keep the completion bits intact
// for prerequisites, NPC phases, and the character's saved quest history.
export function patchNpcRepeatableMissions(source){
  const rules=[
    [/!d\["default"\]\.isMissionFinish\(t,\s*a\.id\)/g,match=>`(a.isUnLimitSubmit()||${match})`],
    [/1\s*!=\s*d\["default"\]\.isMissionFinish\(e,\s*v\.getId\(\)\)/g,match=>`(v.isUnLimitSubmit()||${match})`]
  ];
  for(const [pattern,replace] of rules){
    if([...source.matchAll(pattern)].length!==1)throw Error('v305 NPC mission patch mismatch: '+pattern);
    source=source.replace(pattern,replace);
  }
  return source;
}

// The official client routes IDs 10000+ to its online battle protocol even
// when the recorded group and actors are already loaded. Offline PvE uses the
// existing local battle engine and the same server-side proximity/quest checks.
export function patchOfflineStoryBattles(source){
  const pattern=/1\s*==\s*f\["default"\]\.isNetBattleID\(t\)\s*&&\s*\(s\s*=\s*!0\)/g;
  if([...source.matchAll(pattern)].length!==1)throw Error('v305 story battle routing patch mismatch');
  return source.replace(pattern,'1==f["default"].isNetBattleID(t)&&null==e.getMonsterGroup(t)&&(s=!0)');
}

// Keep the full captured activity catalog visible in offline play. The native
// list otherwise hides five of eight daily dungeons behind their final quest,
// and hides the Participate button below a recommended level. Quest acceptance
// still uses the real prerequisite checks; no completion flags are changed.
export function patchDailyCatalogVisibility(source){
  const rules=[
    ['if(o.type==s&&t==s){if(r-10>o.proposalLevel||r+5<o.proposalLevel)return;if(o.status==e.STATUS_TYPE_2)return;if(r<o.openLevel&&o.openLevel>0||-1!=o.missionId&&!o.missionIdFinish)return}else{if(t!=o.type)return;if(r<o.openLevel&&o.openLevel>0||-1!=o.missionId&&!o.missionIdFinish)return}', 'if(t!=o.type)return;'],
    ['e.btnType.visible&&(this.btnTypeBg.visible=e.btnType.visible=!t)', 'void 0']
  ];
  for(const [from,to] of rules){
    if(source.split(from).length!==2)throw Error('v305 daily catalog patch mismatch: '+from);
    source=source.replace(from,to);
  }
  return source;
}
