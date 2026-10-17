/**
 * 无限试炼 —— 数据部分（三只 BOSS 与试炼编队）。
 *
 * 单独一个文件是为了躲开循环依赖：注册必须发生在 official-data.ensure() 建索引**之前**
 * （officialGroups 是那时建的 Map，运行时再 push 到 official.groups 不会进 Map，
 * 于是 12501 查不到组、世界数据也带不出这一组）。所以注册函数只接收 data 参数，
 * 不反过来 import official-data —— 逻辑部分放 lib/trial-challenge.mjs。
 *
 * ## BOSS 从哪来
 * 社区版的三只是用他们自己的「自定义怪物编辑器」造的（id 20001/20002/20003），
 * 本工程没有那批数据。这里按同样的**时段轮换**规则（劈砍 0–12 / 穿刺 12–18 / 魔法 18–24）
 * 用已采集的怪物克隆：模板 1735 大年兽（lv120、三维满值的活动 BOSS）。
 *   · 生命统一调到 300 万（原 1000 万在单机版里打不出伤害比例）；
 *   · 只留一种主打伤害，另外两种降到 25% —— 三只强度同档、威胁类型不同。
 * 数值改动全部记在 sources 里，一眼能看出是本地配的。
 */
import {monsterWireBytes} from './monster-balance.mjs';
import {addGroup,battleGroupWire} from './dungeon-challenge-data.mjs';

export const TRIAL_GROUP_ID=24000;
export const TRIAL_SLOT_COUNT=3;
export const TRIAL_BUY_GOLD=30;
export const TRIAL_DAILY_BUY=10;
export const TRIAL_DAILY_CHALLENGE=3;
export const TRIAL_TEMPLATE_ID=1735; // 大年兽
export const TRIAL_BOSS_HP=3_000_000;
/** id 顺序照社区版：20001 劈砍 / 20002 魔法 / 20003 穿刺。 */
export const TRIAL_BOSSES=[
 {id:20001,name:'试炼·劈砍BOSS',fromHour:0,toHour:12,main:'atk_str'},
 {id:20002,name:'试炼·魔法BOSS',fromHour:18,toHour:24,main:'atk_magic'},
 {id:20003,name:'试炼·穿刺BOSS',fromHour:12,toHour:18,main:'atk_agi'},
];
const TRIAL_SLOTS=10;
export const trialBossAt=(now=Date.now())=>{
 const hour=new Date(now).getHours();
 return TRIAL_BOSSES.find(b=>hour>=b.fromHour&&hour<b.toHour)||TRIAL_BOSSES[0];
};
/** BOSS 居中（与塔层编队同一套摆法）。 */
export const trialSlots=bossId=>{
 const slots=new Array(TRIAL_SLOTS).fill(0);
 slots[Math.floor(TRIAL_SLOTS/2)]=bossId;
 return slots;
};
function cloneBoss(template,boss){
 const row={...structuredClone(template),id:boss.id,name:boss.name,hpMax:TRIAL_BOSS_HP,
  sources:[{origin:'local-trial-boss',referenceMonsterId:template.id,kind:boss.main}],localReconstruction:true};
 for(const key of ['atk_str','atk_agi','atk_magic'])if(key!==boss.main)row[key]=Math.trunc((row[key]||0)*0.25);
 row.wireBase64=monsterWireBytes(row);
 return row;
}
/**
 * 幂等注册：三只 BOSS + 编队 24000（在 ensure() 里调用一次）。
 * @returns {{ready:boolean,monsters:number,groups:number}}
 */
export function registerTrialChallenge(data){
 const template=data.monsters?.find(m=>m.id===TRIAL_TEMPLATE_ID);
 if(!template)return {ready:false,monsters:0,groups:0};
 let added=0;
 for(const boss of TRIAL_BOSSES){
  if(data.monsters.some(m=>m.id===boss.id))continue;
  data.monsters.push(cloneBoss(template,boss));
  added++;
 }
 // 注册时写进当前时段那只；之后由 syncTrialGroup 跟着时段换。
 const slots=trialSlots(trialBossAt().id);
 const before=data.groups.length;
 addGroup(data,[{origin:'local-trial-challenge',groupId:TRIAL_GROUP_ID}],
  {groupId:TRIAL_GROUP_ID,monsters:slots,npcs:[],extra:{localTrial:true}});
 return {ready:true,monsters:added,groups:data.groups.length>before?1:0};
}
/** 编队里的 BOSS 跟着时段换（改完要重建 officialGroups，见调用方）。 */
export function syncTrialGroup(data,bossId){
 const row=data.groups.find(g=>g.groupId===TRIAL_GROUP_ID);
 if(!row)return false;
 const slots=trialSlots(bossId);
 if(row.monsters?.length===TRIAL_SLOTS&&row.monsters[Math.floor(TRIAL_SLOTS/2)]===bossId)return false;
 row.monsters=slots;
 row.wireBase64=battleGroupWire(TRIAL_GROUP_ID,slots,[],0,0);
 return true;
}
export const isTrialGroup=groupId=>Number(groupId)===TRIAL_GROUP_ID;
