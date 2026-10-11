import {lazyBox,lazyJson} from './lazy-data.mjs';

/**
 * 家园 / 永泽塔资料（835 KB + 目录）。
 *
 * 只在「家园」与「永泽塔预览」面板用得到，以前跟着 import 图在启动期解析
 * （架构评审 P1-1）。现在三张表都惰性：`homeFeatureData` 走代理，
 * 两张 Map 走惰性构造，revision 改成函数（只有 /api/status 与家园快照要它）。
 */
export const homeFeatureData=lazyJson(new URL('../data/home-features-v1.json',import.meta.url),'homeFeatureData');
export const homeFeatureCatalogs=lazyJson(new URL('../data/home-feature-catalogs.json',import.meta.url),'homeFeatureCatalogs');
export const homeFeatureRevision=()=>homeFeatureData.revision;
export const towerFloors=lazyBox(()=>new Map(homeFeatureData.tower.flatMap(t=>t.levels.map(f=>[f.id,{...f,mode:t.mode}]))),'towerFloors');
export const towerPreviews=lazyBox(()=>new Map(homeFeatureData.previews.map(p=>[p.id,p])),'towerPreviews');

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
