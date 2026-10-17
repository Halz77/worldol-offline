/**
 * 中秋月宫 —— 最终 BOSS「凋羽台之争」守卫（任务 1940 / 编队 11733）。
 *
 * ## 症状
 * 玩家把中秋副本打到最后，打赢「凋羽台之争」却交不了任务，链死在这里。
 *
 * ## 根因：录制数据里「连续战斗」的两段没录到一起
 * 原版任务描述写得很清楚：「【连续战斗，请小心蓬蒙分身哦！】」
 * ——设计上是先打分身、再续战真身。但录制结果里：
 * - 11733 = 只有一只**分身** 3298（100 级800 万血），nextBattleGroupID = 0
 * - 11734 = **真身** 3297 + 4 只炎兽之王（120 级 1000 万血），同样没被链上
 * - 任务 1940 挂的是 11733，而完成条件要点**真身 3297** 的击杀数
 *
 * 玩家只打了分身就被判定「完成」，条件却永远差真身那一条。
 * 社区版（字体注入版 1.26.1017）用的是同一份录制包，同样没串，属于原版数据缺陷。
 *
 * ## 修法
 * 主要修复在 lib/dungeon-challenge-data.mjs ⑤ —— 造 11733 时直接把真身 3297
 * 放进同一编队（分身 + 真身同场），一次战斗打完，不依赖客户端的续战处理。
 *
 * 本模块是**兜底守卫**：万一官方数据将来补齐了真身编队、或者编队是从别处登记进来的，
 * 这里检查「1940 的条件怪在不在它触发的战斗里」，不在就抛错并就地补上，
 * 而不是让玩家在游戏里发现打赢了却交不了任务。
 */
export const MID_AUTUMN_SHADOW_BOSS=3298;
export const MID_AUTUMN_TRUE_BOSS=3297;
export const MID_AUTUMN_FINAL_GROUP=11733;
export const MID_AUTUMN_QUEST=1940;

export function fixMidAutumnFinalBoss(o){
 const quest=o.missions.find(q=>q.id===MID_AUTUMN_QUEST);
 if(!quest)return o;
 const need=new Set((quest.submitCondition||[]).filter(c=>c.type===2).map(c=>c.monsterId));
 if(!need.has(MID_AUTUMN_TRUE_BOSS))return o;
 const group=o.groups.find(g=>g.groupId===MID_AUTUMN_FINAL_GROUP);
 if(!group)throw Error('中秋最终战编队缺失：'+MID_AUTUMN_FINAL_GROUP);
 // 编队里已经有条件要的怪 → 没问题（官方数据补齐后会走这里）。
 if([...need].every(id=>group.monsters.includes(id)))return o;
 if(!o.monsters.some(m=>m.id===MID_AUTUMN_TRUE_BOSS))throw Error('真身缺失：'+MID_AUTUMN_TRUE_BOSS);
 // 空槽位里塞进真身；分身留在原位（任务提示「小心分身」仍然成立）。
 const slot=group.monsters.findIndex(id=>id===0);
 if(slot<0)throw Error('编队 '+MID_AUTUMN_FINAL_GROUP+' 没有空槽位可放真身');
 group.monsters[slot]=MID_AUTUMN_TRUE_BOSS;
 group.localTrueBossFix=true;
 group.localTrueBossReason='1940 requires killing '+MID_AUTUMN_TRUE_BOSS+' but the formation only had the shadow';
 // wire 里的槽位也要跟着改，否则客户端看到的还是分身。
 const bytes=Buffer.from(group.wireBase64,'base64');
 const flag=bytes[6],slotCount=(flag&1)?20:10;
 const offset=8+slot*2;
 if(bytes.length<offset+2)throw Error('编队 wire 长度不足，无法改写槽位');
 bytes.writeInt16BE(MID_AUTUMN_TRUE_BOSS,offset);
 group.wireBase64=bytes.toString('base64');
 return o;
}