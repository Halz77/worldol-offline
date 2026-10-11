import fs from 'node:fs';
export const homeFeatureData=JSON.parse(fs.readFileSync(new URL('../data/home-features-v1.json',import.meta.url),'utf8'));
export const homeFeatureCatalogs=JSON.parse(fs.readFileSync(new URL('../data/home-feature-catalogs.json',import.meta.url),'utf8'));
export const homeFeatureRevision=homeFeatureData.revision;
export const towerFloors=new Map(homeFeatureData.tower.flatMap(t=>t.levels.map(f=>[f.id,{...f,mode:t.mode}])));
export const towerPreviews=new Map(homeFeatureData.previews.map(p=>[p.id,p]));

export function vipBenefits(p){
 const level=Math.max(0,Math.min(9,Number(p.vipLevel2)||0));
 // Only the VIP1 companion was captured. Higher ranks retain these verified
 // base benefits; no higher-rank multipliers are extrapolated.
 return {level,permanent:level>0,knownRank:1,missionMultiplier:level?1.1:1,recoveryPercent:level?5:0,vitality:level?100:0,higherRankPending:level>1};
}
export function vipMissionExperience(p,base){
 if(!Number.isSafeInteger(base)||base<0)throw Error('无效任务经验。');
 return Math.min(2147483647,Math.floor(base*(vipBenefits(p).level?11:10)/10));
}
export const vipPending='待补：VIP2–9精灵成长数值、后续经验升级表、答题、私人仓库、熔炉次数，以及未录制的礼包内容。';
