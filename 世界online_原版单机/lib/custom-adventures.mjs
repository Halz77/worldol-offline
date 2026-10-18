/**
 * 单机自定义冒险（移植自社区版 `custom-adventures.mjs` 的**城市部分**）。
 *
 * ## 移植范围
 * 社区版这个模块很杂（八一副本、太阳神中段、城市日常、沙漠补桥…）。本工程只取其
 * 「个人城市」那一半 —— 也就是我们这边确实缺、且不依赖对方自有框架的部分：
 *
 * 1. **缺定义的加工材料**：原版「初级木材/石材/铁矿加工任务」（3027/3028/3029）要交
 *    1010 一级碎木 + **1011 二级碎木**、1021 一级碎石 + **1022 二级碎石**、
 *    1031 一级碎矿 + **1032 二级碎矿**，产物又是 1000 木材 / 1001 石材 / **1002 铁矿** ——
 *    而 1011 / 1022 / 1032 / 1002 在录制里**没有道具定义**（任务引用得到、背包里放不进）。
 *    这里按同类材料的定义字节补出来：只换编号 / 名称 / 图标 / 说明，价格、堆叠、品级
 *    全部沿用参考道具（写法与 `lib/local-gems.mjs` 一致 —— 先原样重写一遍逐字节比对，
 *    对不上就抛错，绝不半信半疑地写出新定义）。
 * 2. **城市日常（8801—8808）**：本工程的城市只有「升级任务」和「加工任务」，没有任何
 *    产出繁荣度 / 军力的日常；社区版补的这 8 条正好补上这个空档 —— 花铜币建设/训练、
 *    花 4000 铜币买齐一次加工原料、每天贡献 5 木材 / 6 石材 / 5 铁矿。编号 8801–8808
 *    是对方定的（玛雅的 8700–8709 已经用过 8700 段，8800 段在这份数据里空着）。
 * 3. **两处等级条件适配**：3068—3071 / 3074 / 3075 的「127 级」门槛改成人物上限 97 级
 *    （这两条链的副本内容本来就是 127 级年代的，本工程人物上限 97）；3052 / 3072 / 3073
 *    则**删掉**引擎不认识、也不该由客户端检查的条件 —— 与社区版同一处、同一处理。
 *
 * 城市场景：本工程永远进 1000（10510 固定 `teleport(1000)`），所以每条任务都同时登记
 * `1000:对应 NPC` 与 `3090:对应 NPC` 两个来源（`cityTarget` 按名字映射，
 * 见 `lib/city-state.mjs`）。
 *
 * ⚠️ 不移植的部分（刻意）：对方「首次激活直接 10 级城市」的文案与规则（本工程
 * `unlockCity` 给的是 1 级城市）、金库 24 小时产出、以及他们自有的副本 runs 框架。
 */
import {Writer,Reader} from './codec.mjs';

export const customAdventureRevision='city-adventures-20261018-v1';

/** 个人城市的虚拟地图号（录制的城市任务都挂在这一张上）。 */
export const CITY_MISSION_MAP=2800;
/** 本工程的两个城市场景（1000 = 初始场景，3090 = 录制里的高档西式模板）。 */
export const CITY_SCENES=[1000,3090];
/** 引擎能判定、且客户端能显示的城市任务条件类型（`lib/official-rules.mjs` missionBlockers 同一张表）。 */
export const CITY_CONDITION_TYPES=[0,1,2,5,7,8,9,10,11,12,27,29,30,31,32];
/** 人物上限：录制里 127 级的城市门槛在单机里收到这里。 */
export const CITY_LEVEL_CAP=97;

/** 缺定义的城市加工材料：只换编号/名称/图标/说明，其余沿用参考道具。 */
export const CITY_MATERIALS=[
 {id:1002,reference:1001,name:'铁矿',bagIcon:33},
 {id:1011,reference:1010,name:'二级碎木',bagIcon:30},
 {id:1022,reference:1021,name:'二级碎石',bagIcon:31},
 {id:1032,reference:1031,name:'二级碎矿',bagIcon:33},
];
const MATERIAL_INFO='【单机补写】城市生产需要的加工材料；名称与编号来自原版加工任务，价格、堆叠与品级沿用同类材料。';

/**
 * 城市日常（8801—8808）。
 * - `cost`：type 5 铜币条件（申请时扣）；
 * - `cityProsperity` / `cityArmy`：交付后加到城市上（见 `lib/city-state.mjs` applyCityMission）；
 * - `supply`：原料采购任务 —— 奖励直接取原加工任务（3027/3028/3029）要的那几种材料；
 * - `contribute`：建设贡献任务 —— 交付原加工任务产出的成品（5 木材 / 6 石材 / 5 铁矿）。
 */
export const CITY_DAILY_QUESTS=[
 {id:8801,name:'城市建设（单机日常）',scene:{1000:2,3090:2},desc:'每日投入 1000 铜币整修街道，获得 200 繁荣度。',cityProsperity:200,cost:1000},
 {id:8802,name:'守卫训练（单机日常）',scene:{1000:3,3090:3},desc:'每日投入 500 铜币训练守卫，获得 300 军力。',cityArmy:300,cost:500},
 {id:8803,name:'木材原料采购（单机日常）',scene:{1000:12,3090:13},desc:'每日花 4000 铜币买齐「初级木材加工任务」需要的全部原料；加工仍按原任务奖励。',cost:4000,supply:3027},
 {id:8804,name:'石材原料采购（单机日常）',scene:{1000:12,3090:13},desc:'每日花 4000 铜币买齐「初级石材加工任务」需要的全部原料；加工仍按原任务奖励。',cost:4000,supply:3028},
 {id:8805,name:'铁矿原料采购（单机日常）',scene:{1000:12,3090:13},desc:'每日花 4000 铜币买齐「初级铁矿加工任务」需要的全部原料；加工仍按原任务奖励。',cost:4000,supply:3029},
 {id:8806,name:'木材建设贡献（单机日常）',scene:{1000:2,3090:2},desc:'每日交付 5 份木材，获得 200 繁荣度；材料实际扣除。',cityProsperity:200,contribute:3027},
 {id:8807,name:'石材建设贡献（单机日常）',scene:{1000:2,3090:2},desc:'每日交付 6 份石材，获得 200 繁荣度；材料实际扣除。',cityProsperity:200,contribute:3028},
 {id:8808,name:'铁矿建设贡献（单机日常）',scene:{1000:2,3090:2},desc:'每日交付 5 份铁矿，获得 200 繁荣度；材料实际扣除。',cityProsperity:200,contribute:3029},
];

/** 把 127 级门槛收到人物上限的六条城市任务（社区版同一处）。 */
export const CITY_LEVEL_ADAPTATIONS=[3068,3069,3070,3071,3074,3075];
/** 直接删掉「超上限 / 引擎不认识」条件的城市任务（社区版同一处）。 */
export const CITY_CONDITION_DROPS=[3052,3072,3073];

const condition=(type,raw,values={})=>({type,not:0,rawHex:raw.done().toString('hex'),...values});

/**
 * 按参考道具的定义字节重建一条材料定义。
 * 先按同一顺序把**原值**写回去，必须逐字节等于原定义 —— 否则说明本地理解的字段顺序不对，
 * 宁可抛错（这与 `lib/local-gems.mjs` 的守卫同一思路）。
 */
function rebuildItemDefinition(base,{id,name,bagIcon,info}){
 const raw=Buffer.from(base.definitionBase64,'base64'),r=new Reader(raw);
 const type=r.byte(),handBookItem=r.bool(),baseId=r.int(),baseName=r.string(),baseBagIcon=r.int(),baseInfo=r.string();
 const tail=r.b.subarray(r.pos);
 const roundTrip=new Writer().byte(type).bool(handBookItem).int(baseId).string(baseName).int(baseBagIcon).string(baseInfo).raw(tail).done();
 if(!roundTrip.equals(raw))throw Error(`道具 ${base.id}「${base.name}」的定义字节与本地写出顺序不一致，城市材料已停止生成。`);
 return new Writer().byte(type).bool(handBookItem).int(id).string(name).int(bagIcon).string(info).raw(tail).done();
}

/** ① 缺定义的城市加工材料。 */
export function applyCityMaterials(official){
 const added=[];
 for(const spec of CITY_MATERIALS){
  if(official.items.some(item=>item.id===spec.id))continue;
  const base=official.items.find(item=>item.id===spec.reference);
  if(!base)throw Error(`城市材料 ${spec.id}「${spec.name}」缺少参考道具 ${spec.reference}`);
  const bytes=rebuildItemDefinition(base,{...spec,info:MATERIAL_INFO});
  official.items.push({
   ...structuredClone(base),id:spec.id,name:spec.name,bagIcon:spec.bagIcon,info:MATERIAL_INFO,
   definitionBase64:bytes.toString('base64'),localReconstruction:true,
   sources:[{origin:'local-city-material',mapId:1000,npcId:12,referenceItemId:spec.reference}],
   estimatedFrom:{itemId:spec.reference,method:'同一类材料的定义字节，只换编号 / 名称 / 图标 / 说明'},
  });
  added.push(spec.id);
 }
 return added;
}

/** ② 城市日常 8801—8808。 */
export function applyCityDailies(official){
 const added=[];
 for(const def of CITY_DAILY_QUESTS){
  if(official.missions.some(q=>q.id===def.id))continue;
  const scenes=Object.entries(def.scene).map(([mapId,npcId])=>({mapId:Number(mapId),npcId}));
  const [origin]=scenes;
  const prosperity=def.cityProsperity||0,army=def.cityArmy||0;
  const submit=[];
  if(def.cost)submit.push(condition(5,new Writer().int(def.cost)));
  const quest={
   id:def.id,name:def.name,level:0,
   simpleDesc:def.contribute?'交付指定材料后回来交付':'与任务人物对话',
   desc:'【单机补写】'+def.desc,
   // 512 = 国家奖励不结算（客户端看不到，见 official-rules.missionClientSetting）。
   setting:(prosperity||army?512:0)|1026,
   mapId:CITY_MISSION_MAP,npcId:origin.npcId,radarMapID:0,
   dialogNotStartNotReady:'在个人城市里与任务 NPC 对话即可接取。',
   dialogStartNotFinish:def.contribute?'材料还没交齐，请凑齐后再来。':'准备好后交付任务。',
   dialogStartFinish:'【单机补写】'+def.desc,
   exp:def.supply?0:500,money2:0,money3:0,honor:0,
   countryLand:0,countryProsperity:0,countryPeople:0,countryWood:0,countryStone:0,countryIron:0,
   cityProsperity:prosperity,cityArmy:army,promoteProsperity:0,
   rewardItems:[],selectItems:[],
   acceptCondition:[condition(31,new Writer())],
   submitCondition:submit,
   type:7,series:'个人城市（单机扩展）',
   acceptMapId:origin.mapId,acceptNpcId:origin.npcId,
   canAccept:1,_isHelp:false,
   acceptJumpMapID:0,submitJumpMapID:0,acceptBattleID:0,submitBattleID:0,submitNextMissionID:0,
   localReconstruction:true,
   sources:scenes.map(scene=>({origin:'local-city-daily',mapId:scene.mapId,npcId:scene.npcId})),
  };
  if(def.supply){
   const processing=official.missions.find(q=>q.id===def.supply);
   if(!processing)throw Error(`城市日常 ${def.id} 缺少原加工任务 ${def.supply}`);
   const raw=(processing.submitCondition||[]).filter(c=>c.type===7&&!c.not);
   if(!raw.length)throw Error(`原加工任务 ${def.supply} 没有材料条件，城市日常 ${def.id} 取不到奖励。`);
   quest.rewardItems=raw.map(c=>{
    const item=official.items.find(i=>i.id===c.itemId);
    if(!item)throw Error(`城市日常 ${def.id} 需要的材料 ${c.itemId} 没有定义。`);
    return {id:item.id,name:item.name,bagIcon:item.bagIcon,grade:item.grade,quantity:c.required};
   });
  }
  if(def.contribute){
   const processing=official.missions.find(q=>q.id===def.contribute);
   if(!processing)throw Error(`城市日常 ${def.id} 缺少原加工任务 ${def.contribute}`);
   const reward=(processing.rewardItems||[]).find(i=>official.items.some(x=>x.id===i.id));
   const item=reward&&official.items.find(x=>x.id===reward.id);
   if(!item)throw Error(`原加工任务 ${def.contribute} 没有产物，城市日常 ${def.id} 取不到交付目标。`);
   const amount=reward.quantity||1;
   quest.submitCondition=[condition(7,new Writer().int(item.id).utf(item.name).byte(amount),{itemId:item.id,name:item.name,required:amount})];
  }
  official.missions.push(quest);
  added.push({id:quest.id,name:quest.name,scene:scenes.map(s=>`${s.mapId}:${s.npcId}`).join(' / ')});
 }
 return added;
}

/** ③ 两处等级条件适配（3068—3071/3074/3075 收到 97 级；3052/3072/3073 删掉超限条件）。 */
export function applyCityConditionAdaptations(official){
 const changed=[];
 for(const id of CITY_LEVEL_ADAPTATIONS){
  const quest=official.missions.find(q=>q.id===id);
  if(!quest)continue;
  const caps=quest.acceptCondition.filter(c=>c.type===1&&!c.not&&c.minimum>CITY_LEVEL_CAP);
  for(const c of caps){c.minimum=CITY_LEVEL_CAP;c.rawHex=new Writer().byte(CITY_LEVEL_CAP).done().toString('hex');}
  if(!caps.length)continue;
  quest.desc+='\n【单机适配】原 '+caps.length+' 处超高等级门槛已调整为人物上限 '+CITY_LEVEL_CAP+' 级；副本内容仍要求实际完成列出的任务。';
  quest.cityLevelAdaptation=true;
  changed.push({id,name:quest.name,adapted:caps.length});
 }
 for(const id of CITY_CONDITION_DROPS){
  const quest=official.missions.find(q=>q.id===id);
  if(!quest)continue;
  for(const kind of ['acceptCondition','submitCondition']){
   const list=quest[kind]||[];
   const kept=list.filter(c=>CITY_CONDITION_TYPES.includes(c.type)&&!(c.type===1&&c.minimum>CITY_LEVEL_CAP));
   if(kept.length!==list.length){quest[kind]=kept;changed.push({id,name:quest.name,dropped:list.length-kept.length,kind});}
  }
 }
 return changed;
}

/** 挂到 `official-data.ensure()` 的建索引之前（新道具/新任务要进索引）。 */
export function applyCustomAdventures(official){
 return {materials:applyCityMaterials(official),dailies:applyCityDailies(official),conditions:applyCityConditionAdaptations(official)};
}
