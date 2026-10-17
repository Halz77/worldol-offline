/**
 * 玛雅旧任务进度归档 —— 3220—3226、1823。
 *
 * ## 为什么需要
 * 8700—8709 十环「太阳神地下宫殿」是 2026-09-26 的录制包补出来的（lib/maya-palace-story.mjs），
 * 在那之前这条链在原版里的走法是 3219（巨石神兵）→ 3220 → …… → 1823 → 1824（蒂卡尔的自白）。
 * 我们这份 official-v305 里 **3220—3226 / 1823 一条都没采集到**，本地又把 1824 的接取前置
 * 改成了 8709、838 地图里蒂卡尔的可见性前置改成了 3219（lib/maya-continuation.mjs）。
 * 于是从正式服导出的存档里，这些**没有定义**的旧任务会一直挂在 `quests.active` 里：
 * 任务栏看不到（missionsPacket 会过滤掉没有定义的任务），但『已接任务数』这类判定还数着它们。
 *
 * ## 做法
 * 命中就把它们整块挪进 `p.mayaRetiredProgress` 留档，再从 active 里删掉 ——
 * 与 lib/captured81-progress.mjs 同一个套路：**归档而不是静默删除**。
 * 只动带 `official` 标记的记录（本地自编任务用不着这些号；万一真用了，也不能误伤）。
 *
 * 归档条目的 revision 沿用对方的名字（`restore-20260926-palace-v1`），便于两份存档对照。
 */
export const mayaRetiredRevision='restore-20260926-palace-v1';

/** 已被 8700—8709 十环取代、不再注册的旧任务号。 */
const RETIRED_IDS=[3220,3221,3222,3223,3224,3225,3226,1823];

export function migrateMayaProgress(p){
 const active=p?.quests?.active;
 if(!active)return false;
 if(p.mayaRetiredProgress?.some(entry=>entry.revision===mayaRetiredRevision))return false;
 const retired=Object.fromEntries(RETIRED_IDS.filter(id=>active[id]?.official).map(id=>[id,structuredClone(active[id])]));
 if(!Object.keys(retired).length)return false;
 (p.mayaRetiredProgress??=[]).push({revision:mayaRetiredRevision,at:new Date().toISOString(),active:retired});
 for(const id of Object.keys(retired))delete active[id];
 return true;
}
