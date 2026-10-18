/**
 * 日常副本扩展：给「已有任务、但战斗编队没采集到」的副本补上能打的编队。
 *
 * ## 背景
 * 官方任务表里这些副本的**任务定义是齐的**（1051 光之试炼、1053 暗之试炼、1605 虚空幻境、
 * 3972 十殿阎罗、1940 凋羽台之争、3103 沙漠奇美拉、2564 追捕逃犯、2453 千年魔牛、
 * 2769 精英沙漠炎帝），但它们的编队号（11918 / 11921 / 30210 / 30170…）在我们这份
 * official-v305 里**不存在** —— 表现就是任务上挂着「剧情战斗数据尚未采集」。
 *
 * `missionBlockers()` 的判定是 `missionBattleId(q)` 的组必须 `battleSupported()`，
 * 也就是「组存在 + 组里每只怪都在官方怪物表里」。所以只要把组和怪补上，任务立刻能打，
 * 不需要改任务系统。
 *
 * ## 怎么补
 * 不凭空造数值：**每一层都从已采集的怪物/编队克隆**，只换 id 和名字，并打上
 * `localReconstruction` 与 `sources`（写明参考的是谁）。这样以后官方数据补齐了，
 * 一眼能看出哪些是本地推算的。
 *
 * ## 没做的
 * 跨服合作（9100）的五关连战参考编队 3315 / 2320 在我们这份数据里同样缺，
 * 强行造会偏离原版太多 —— 留着「数据尚未采集」的提示，等有参考再补。
 * （BOSS 挑战赛棋盘 1305 已经单独补完了，见 lib/boss-tournament-data.mjs ——
 * 它是棋盘玩法，不是「补一个编队」能解决的，所以不在这份表里。）
 */

const MONSTER_KINGS=['秦广王','楚江王','宋帝王','五官王','阎罗王','卞城王','泰山王','都市王','平等王','转轮王'];

/** 每个副本的修复规格（供测试与日志用）。 */
export const DUNGEON_CHALLENGE_SPECS=[
 {mission:1051,name:'光之试炼',phase:'submit',groups:[11918]},
 {mission:1053,name:'暗之试炼',phase:'submit',groups:[11921]},
 {mission:1605,name:'虚空幻境',phase:'submit',groups:[30210]},
 {mission:3972,name:'十殿阎罗',phase:'accept',groups:[11706,30001,30002,30003,30004,30005,30006,30007,30008,30009]},
 {mission:1940,name:'凋羽台之争',phase:'accept',groups:[11733]},
 {mission:3103,name:'沙漠奇美拉',phase:'accept',groups:[30020]},
 {mission:2564,name:'追捕逃犯',phase:'accept',groups:[30021]},
 {mission:2453,name:'千年魔牛',phase:'accept',groups:[30022]},
 {mission:2769,name:'精英沙漠炎帝',phase:'submit',groups:[30023]},
];

/**
 * 这些副本**没有**在这里补编队，原因各不相同（不是"漏了"）：
 *   · 9100 跨服合作在抓包里本来就是单场（acceptBattleID=20369，能打）；
 *     社区版把它扩成了五关连战，但参考编队 3315 / 2320 我们这份数据里没有。
 */
export const DUNGEON_CHALLENGE_SKIPPED=[
 {mission:9100,name:'跨服副本·单机合作',reason:'扩展五关连战需要参考编队 3315/2320，未采集；抓包自带的 20369 单场仍可打'},
];

function int16(value){const b=Buffer.alloc(2);b.writeInt16BE(Number(value)||0);return b;}
function int32(value){const b=Buffer.alloc(4);b.writeInt32BE(Number(value)||0);return b;}

/** 按官方编队格式拼 wire：short(组) byte(类型) short(下一组) byte(flag) int(系数) + 怪物槽 + [NPC 槽]。 */
export function battleGroupWire(groupId,monsters,npcs,flag,coefficient){
 const parts=[];
 const w=(...bufs)=>parts.push(...bufs);
 w(int16(groupId),Buffer.from([0]),int16(0),Buffer.from([flag]),int32(coefficient));
 for(const id of monsters)w(int16(id));
 if(flag&2)for(let i=0;i<4;i++)w(int16(npcs[i]||0));
 return Buffer.concat(parts).toString('base64');
}

/**
 * 克隆一只怪物：保留参考怪的全部属性，只换 id 与名字，并重写 wireBase64 里的 id/name。
 * AI 记录也一并克隆（塔怪没有 AI，但副本怪有）。
 * （导出给 lib/boss-tournament-data.mjs 复用 —— 同一套「本地推算 + 留参考 id」的规矩。）
 */
export function cloneMonster(data,referenceId,id,name,sources){
 if(data.monsters.some(row=>row.id===id))return data.monsters.find(row=>row.id===id);
 const source=data.monsters.find(row=>row.id===referenceId);
 if(!source)throw Error(`副本缺少参考怪物：${referenceId}`);
 const row={...structuredClone(source),id,name:name||source.name,sources,localReconstruction:true,referenceMonsterId:source.id};
 delete row.questCreditMonsterId;
 // 怪物 wire 的头两个字段就是 id(int32, 大端) 与 name(3 字节长度 + UTF-16**BE**)，
 // 改完接回剩余字节即可。⚠️ 'utf16le' 是小端，必须逐字 writeUInt16BE，否则名字会乱码。
 const raw=Buffer.from(source.wireBase64,'base64');
 let pos=4;
 const nameLength=raw.readUIntBE(pos,3);pos+=3+nameLength*2;
 const tail=raw.subarray(pos);
 const head=Buffer.alloc(4);head.writeInt32BE(id);
 const chars=[...String(row.name)];
 const encoded=Buffer.alloc(chars.length*2);
 chars.forEach((ch,index)=>encoded.writeUInt16BE(ch.charCodeAt(0),index*2));
 const lengthPrefix=Buffer.from([(chars.length>>16)&255,(chars.length>>8)&255,chars.length&255]);
 row.wireBase64=Buffer.concat([head,lengthPrefix,encoded,tail]).toString('base64');
 data.monsters.push(row);
 const ai=data.ai.find(a=>a.id===referenceId);
 if(ai){
  const copy={...structuredClone(ai),id,sources,localReconstruction:true};
  const bytes=Buffer.from(ai.wireBase64,'base64');
  bytes.writeUInt16BE(id,0);
  copy.wireBase64=bytes.toString('base64');
  data.ai.push(copy);
 }
 return row;
}

/** 补一个编队（已存在就跳过，保证幂等）。英雄挑战赛的编队也走这里（lib/solar-challenge.mjs）。 */
export function addGroup(data,sources,{groupId,monsters,npcs=[],coefficient=0,extra={},slotCount=0}){
 if(data.groups.some(row=>row.groupId===groupId))return data.groups.find(row=>row.groupId===groupId);
 // 槽位总数：默认按怪物数推（>10 → 20 槽），也可由调用方指定。
 // 太阳神殿棋盘那批编队社区版**一律 20 槽 + flag 3**（team-dungeon-data.mjs 的 groupWire
 // 里写死 byte(3) 并补到 20），不随怪物多少变化 —— 见 applySolarChallenges。
 const total=slotCount>0?slotCount:(monsters.length>10?20:10);
 const wide=total>10?1:0;
 const flag=wide|(npcs.length?2:0);
 const slots=[...monsters,...new Array(Math.max(0,total-monsters.length)).fill(0)];
 const row={groupId,type:0,nextBattleGroupID:0,flag,coefficient,monsters:slots,npcs,
  wireBase64:battleGroupWire(groupId,slots,npcs,flag,coefficient),sources,localReconstruction:true,...extra};
 data.groups.push(row);
 return row;
}

/**
 * 把副本编队补进官方数据（在 official-data.ensure() 建索引之前调用一次）。
 * @returns {{groups:number[],monsters:number[],skipped:object[]}}
 */
export function applyDungeonChallengeRepairs(data){
 const source=(mission,extra={})=>[{origin:'local-dungeon-challenge-repair',missionId:mission,...extra}];
 const mission=(id)=>data.missions.find(q=>q.id===id);
 const createdGroups=[],createdMonsters=[];

 // ① 光之试炼：2530 克隆出「光之守护者正义」2531，组 [2529,2530,2531]
 if(!data.monsters.some(m=>m.id===2531)){
  cloneMonster(data,2530,2531,'光之守护者正义',source(1051,{referenceMonsterId:2530}));
  createdMonsters.push(2531);
 }
 addGroup(data,source(1051),{groupId:11918,monsters:[2529,2530,2531]});
 createdGroups.push(11918);

 // ② 暗之试炼：2533 克隆出「暗之守护者黑暗」2534，组 [2532,2533,2534]
 if(!data.monsters.some(m=>m.id===2534)){
  cloneMonster(data,2533,2534,'暗之守护者黑暗',source(1053,{referenceMonsterId:2533}));
  createdMonsters.push(2534);
 }
 addGroup(data,source(1053),{groupId:11921,monsters:[2532,2533,2534]});
 createdGroups.push(11921);

 // ③ 虚空幻境：照 2501 编队，把牛头酋长换成牛种女祭司
 const voidGuard=data.groups.find(g=>g.groupId===2501);
 if(voidGuard&&data.monsters.some(m=>m.id===2504)){
  addGroup(data,source(1605,{referenceGroupId:2501,referenceMonsterId:2504}),
   {groupId:30210,monsters:voidGuard.monsters.map(id=>id===2501?2504:id),coefficient:voidGuard.coefficient||0});
  createdGroups.push(30210);
 }

 // ④ 十殿阎罗：十个组各一只王；后八只从楚江王 3018 克隆
 const kings=[11706,30001,30002,30003,30004,30005,30006,30007,30008,30009];
 for(let i=0;i<kings.length;i++){
  const id=3017+i;
  if(i>1&&!data.monsters.some(m=>m.id===id)){
   cloneMonster(data,3018,id,MONSTER_KINGS[i],source(3972,{referenceMonsterId:3018}));
   createdMonsters.push(id);
  }
  addGroup(data,source(3972),{groupId:kings[i],monsters:[0,0,id,0,0,0,0,0,0,0]});
  createdGroups.push(kings[i]);
 }

 // ⑤ 凋羽台：先打蓬蒙分身 3298，续战真身 3297。
 // 任务 1940 的完成条件要的是**真身**击杀，而原录制把「连续战斗」的两段录成了
 // 互不相连的两个编队（11733 只有分身、11734 才是真身+4 只炎兽之王，两边 next 都是 0），
 // 于是玩家打完分身就被判定完成，条件永远差真身那一条。
 // 这里把编队内容换成「分身 + 真身同场」，一次战斗打完 —— 比接续战更稳，
 // 也不会依赖客户端对 nextBattleGroupID 的续战处理。
 addGroup(data,source(1940),{groupId:11733,monsters:[0,0,3298,0,0,3297,0,0,0,0],slotCount:10});
 createdGroups.push(11733);

 // ⑥ 沙漠奇美拉：任务的目标怪 1821 本身没采集到，用已采集的同名奇美拉 486 克隆出 1821。
 //    必须克隆目标怪本体（而不是直接把组换成 486），否则任务的「击败 1821」永远不计数。
 if(!data.monsters.some(m=>m.id===1821)){
  cloneMonster(data,486,1821,'奇美拉',source(3103,{referenceMonsterId:486}));
  createdMonsters.push(1821);
 }
 addGroup(data,source(3103,{referenceMonsterId:486}),{groupId:30020,monsters:[0,0,1821,0,0,0,0,0,0,0]});
 createdGroups.push(30020);

 // ⑦ 追捕逃犯：目标怪 1859 同样没采集，用黑魔导师 514 克隆出 1859。
 if(!data.monsters.some(m=>m.id===1859)){
  cloneMonster(data,514,1859,'恶魔导师（高级）',source(2564,{referenceMonsterId:514}));
  createdMonsters.push(1859);
 }
 addGroup(data,source(2564,{referenceMonsterId:514}),{groupId:30021,monsters:[0,0,1859,0,0,0,0,0,0,0]});
 createdGroups.push(30021);

 // ⑧ 千年魔牛
 addGroup(data,source(2453),{groupId:30022,monsters:[0,0,3239,0,0,0,0,0,0,0]});
 createdGroups.push(30022);

 // ⑨ 精英沙漠炎帝：照已采集的 11611 编队（含 NPC 槽与系数）
 const desertEmperor=data.groups.find(g=>g.groupId===11611);
 if(desertEmperor){
  addGroup(data,source(2769,{referenceGroupId:11611}),
   {groupId:30023,monsters:[...desertEmperor.monsters],npcs:[...(desertEmperor.npcs||[])],
    coefficient:desertEmperor.coefficient||0});
  createdGroups.push(30023);
 }

 // 给没有 battleID 的任务挂上编队（有的话保持原样，不覆盖抓包值）。
 for(const spec of DUNGEON_CHALLENGE_SPECS){
  const q=mission(spec.mission);
  if(!q)continue;
  const key=spec.phase==='submit'?'submitBattleID':'acceptBattleID';
  if(!(Number(q[key])>0))q[key]=spec.groups[0];
 }
 return {groups:createdGroups,monsters:createdMonsters,skipped:DUNGEON_CHALLENGE_SKIPPED};
}
