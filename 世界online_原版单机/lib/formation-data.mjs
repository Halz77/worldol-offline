import {Writer} from './codec.mjs';

/**
 * 阵法（引擎自带的 CG_FORMATION_* 玩法）。
 *
 * 客户端主包 v305 本来就有完整的阵法协议与属性面板：
 *   · 14012 学阵法书、14013 遗忘、14014 服务端推送当前阵法、14015 切换默认；
 *   · 世界数据 DATA_FORMATION（1<<20）下发已学列表与当前阵法；
 *   · Player.getBaseValue()/getPowerValue() 会在每个属性上叠加 formationSkill。
 *
 * 本地缺的只是服务端数据与协议。APK 5.0 把 16 本玖级阵法书放在商店里，
 * 这里沿用同一套编号与数值（62009 起，每个阵型间隔 9），但补上世界数据下发，
 * 避免每次登录只能靠 14014 推送、列表却是空的。
 */

export const FORMATION_BOOK_POWER=182;
export const FORMATION_LEVEL=9;
export const FORMATION_PUSH_TYPE=14014;
export const FORMATION_SHOP=922;

/** 引擎原始 power 键 → 客户端属性面板使用的百分比键。 */
export function clientFormationPower(power){
 return power===3?4:power===7?8:power;
}

/** 16 个阵型。数值与 APK 5.0 的 FORMATION_DATA_9 一致。 */
export const FORMATIONS=[
 {id:1,name:'天覆阵',teamcount:2,power1:28,value1:22,power2:29,value2:16,power3:27,value3:11},
 {id:2,name:'地载阵',teamcount:2,power1:31,value1:22,power2:33,value2:16,power3:12,value3:13},
 {id:3,name:'风扬阵',teamcount:2,power1:23,value1:24,power2:25,value2:16,power3:24,value3:11},
 {id:4,name:'云垂阵',teamcount:3,power1:30,value1:22,power2:48,value2:17,power3:45,value3:11},
 {id:5,name:'龙飞阵',teamcount:3,power1:27,value1:21,power2:28,value2:17,power3:39,value3:11},
 {id:6,name:'虎翼阵',teamcount:3,power1:12,value1:24,power2:31,value2:17,power3:35,value3:12},
 {id:7,name:'鸟翔阵',teamcount:4,power1:23,value1:22,power2:25,value2:18,power3:6,value3:13},
 {id:8,name:'蛇蟠阵',teamcount:4,power1:43,value1:22,power2:44,value2:16,power3:47,value3:13},
 {id:9,name:'一字长蛇阵',teamcount:2,power1:46,value1:21,power2:28,value2:16,power3:23,value3:11},
 {id:10,name:'二龙出水阵',teamcount:2,power1:45,value1:22,power2:30,value2:17,power3:26,value3:11},
 {id:11,name:'天地三才阵',teamcount:3,power1:2,value1:19,power2:7,value2:15,power3:3,value3:11},
 {id:12,name:'四门兜底阵',teamcount:3,power1:37,value1:22,power2:41,value2:16,power3:31,value3:12},
 {id:13,name:'五虎群羊阵',teamcount:4,power1:28,value1:23,power2:24,value2:16,power3:27,value3:10},
 {id:14,name:'六丁六甲阵',teamcount:4,power1:40,value1:22,power2:33,value2:17,power3:48,value3:12},
 {id:15,name:'七星北斗阵',teamcount:5,power1:38,value1:21,power2:39,value2:16,power3:26,value3:11},
 {id:16,name:'八门金锁阵',teamcount:5,power1:35,value1:21,power2:36,value2:16,power3:40,value3:12},
];

export const FORMATION_POWER_NAMES={
 2:'力量',3:'体质',6:'敏捷',7:'智力',12:'生命上限',23:'出手速度',24:'物理命中',25:'闪避',
 26:'魔法命中',27:'致命点',28:'劈砍攻击力',29:'穿刺攻击力',30:'魔法攻击力',31:'劈砍防御力',
 33:'魔法防御力',35:'伤害减免',36:'反弹',37:'格挡',38:'洞察',39:'破甲',40:'法力护盾',
 41:'反击',43:'生命吸收',44:'法力吸收',45:'魔法穿透',46:'强制命中',47:'自动恢复生命',
 48:'自动恢复法力',
};

/** 阵法书的说明文字。与 APK 5.0 的 FORMATION_BOOKS_9 逐字一致。 */
const BOOK_EFFECTS=[
 '劈砍攻击力+22%、穿刺攻击力+16%、致命点+11%',
 '劈砍防御力+22%、魔法防御力+16%、生命上限+13%',
 '出手速度+24%、闪避+16%、物理命中+11%',
 '魔法攻击力+22%、法力回复+17%、魔法破甲+11%',
 '致命点+21%、劈砍攻击力+17%、破甲+11%',
 '生命上限+24%、劈砍防御力+17%、伤害减免+12%',
 '出手速度+22%、闪避+18%、敏捷+13%',
 '生命吸收+22%、法力吸收+16%、自动恢复生命+13%',
 '强袭+21%、劈砍攻击力+16%、出手速度+11%',
 '魔法破甲+22%、魔法攻击力+17%、法术物理命中+11%',
 '力量+19%、智力+15%、体质+11%',
 '格挡+22%、反击+16%、劈砍防御力+12%',
 '劈砍攻击力+23%、物理命中+16%、致命点+10%',
 '法力护盾+22%、魔法防御力+17%、法力回复+12%',
 '洞察+21%、破甲+16%、法术物理命中+11%',
 '伤害减免+21%、反弹+16%、法力护盾+12%',
];

const formationById=new Map(FORMATIONS.map(f=>[f.id,f]));

export function formationInfo(id){return formationById.get(Number(id))||null;}
export function formationLevel(role,id){return Number(role?.formations?.[Number(id)]||0);}
export function isFormationBook(def){return def?.type===31&&def?.power1===FORMATION_BOOK_POWER;}
export function activeFormationId(role){
 const id=Number(role?.activeFormationId||0);
 return id>0&&formationLevel(role,id)>0?id:null;
}
export function activeFormation(role){const id=activeFormationId(role);return id?formationInfo(id):null;}

/** 引擎原始 power 对（3/7 仍是基础属性键）。 */
export function formationPowers(role){
 const f=activeFormation(role);if(!f)return [];
 return [[f.power1,f.value1],[f.power2,f.value2],[f.power3,f.value3]].filter(([power,value])=>power>0&&value>0);
}

/** 属性面板口径的 power 对：体质/智力转成百分比键，和 formationSkillBlock 的下发一致。 */
export function clientFormationPowers(role){
 return formationPowers(role).map(([power,value])=>[clientFormationPower(power),value]);
}

/**
 * 给 nativePlayer 用的 formationSkill 桩。客户端 0056 的 getBaseValue / getPowerValue
 * 都只调用 formationSkill.getPowerValue(power)，这里按同一口径求和即可。
 */
export function formationSkill(role){
 const pairs=clientFormationPowers(role);
 if(!pairs.length)return null;
 return {getPowerValue(power){let n=0;for(const [id,value] of pairs)if(id===power)n+=value;return n;}};
}

export function formationMessage(role){
 const f=activeFormation(role);if(!f)return '';
 return '已激活【'+f.name+'·玖级】：'+[[f.power1,f.value1],[f.power2,f.value2],[f.power3,f.value3]]
  .filter(([,value])=>value>0)
  .map(([power,value])=>(FORMATION_POWER_NAMES[power]||('属性'+power))+' +'+value+'%')
  .join('、');
}

function bookDefinition(item){
 return new Writer().byte(item.type).bool(item.handBookItem||false).int(item.id).string(item.name)
  .int(item.bagIcon).string(item.info).byte(item.grade||0).byte(item.autoBinding||0)
  .byte(item.stackNum).bool(item.decomCHest||false).byte(item.reqLv||0).short(item.ownTime||0)
  .int(item.durMax||0).int(item.price||0).byte(item.round||0).byte(item.area||0)
  .short(item.power1).short(item.powerValue1).short(item.power2||0).short(item.powerValue2)
  .byte(item.vipLevelReq||0).bool(item.needShowRate||false).done().toString('base64');
}

function makeBook(f,index){
 const item={
  id:62009+index*9,formationId:f.id,level:FORMATION_LEVEL,type:31,
  name:f.name+'法书·玖级',
  info:f.name+'法书·玖级。使用可习得'+f.name+'9级：'+BOOK_EFFECTS[index]+'，上阵'+f.teamcount+'人。阵法书可用于激活或升级对应阵型。',
  price:0,reqLv:50,grade:3,bagIcon:29,stackNum:99,power1:FORMATION_BOOK_POWER,
  powerValue1:f.id,powerValue2:FORMATION_LEVEL,autoBinding:1,ownTime:0,durMax:0,
  handBookItem:false,decomCHest:false,round:0,area:0,vipLevelReq:0,needShowRate:false,power2:0,
 };
 item.definitionBase64=bookDefinition(item);
 return item;
}

/** 16 本玖级阵法书。编号 62009、62018 … 62144（每个阵型间隔 9）。 */
export const FORMATION_BOOKS=FORMATIONS.map(makeBook);
const bookById=new Map(FORMATION_BOOKS.map(book=>[book.id,book]));
export function formationBook(id){return bookById.get(Number(id))||null;}

/** 挂在 official-data.ensure() 建索引之前；与 APK 一样直接补进 official.items。 */
export function applyFormationBooks(official){
 for(const book of FORMATION_BOOKS){
  if(official.items.some(item=>item.id===book.id))throw Error('Local formation book ID collision: '+book.id);
  official.items.push({...book});
 }
}

export function learnFormationFromBook(role,def){
 if(!isFormationBook(def))throw Error('请选择背包中的阵法书。');
 const id=Number(def.powerValue1),f=formationInfo(id);
 if(!f)throw Error('未知阵法书。');
 if(Number(role.level||1)<Number(def.reqLv||0))throw Error('等级不足，无法学习这本阵法书。');
 const level=Math.max(1,Math.min(99,Number(def.powerValue2||FORMATION_LEVEL)));
 role.formations={...(role.formations||{})};
 role.formations[id]=Math.max(formationLevel(role,id),level);
 role.activeFormationId=id;
 return f;
}

export function setActiveFormation(role,id){
 const formId=Number(id||0);
 if(!formId){role.activeFormationId=null;return null;}
 if(!formationLevel(role,formId))throw Error('尚未学习该阵法。');
 role.activeFormationId=formId;
 return formationInfo(formId);
}

export function forgetFormation(role,id){
 const formId=Number(id||0);
 if(!formationLevel(role,formId))throw Error('尚未学习该阵法。');
 const wasActive=Number(role.activeFormationId||0)===formId;
 role.formations={...(role.formations||{})};
 delete role.formations[formId];
 // 必须先记下「遗忘前是不是当前阵」：删掉等级后再调 activeFormationId() 会因为
 // 未学习而返回 null，条件永远不成立，activeFormationId 会留下一个脏值。
 if(wasActive)role.activeFormationId=null;
 return true;
}

/**
 * 单条 formationSkill 的 wire 结构（客户端 fromByteFormationSkill 读的就是它）。
 *
 * 第三个字节是 `skillId`，客户端的「设为默认」和「遗忘」都直接把它回传给
 * 14015/14013（`i.skillId`）。APK 5.0 这里写 0，导致 UI 点任何阵型都发 0（=清空）、
 * 点遗忘也发 0；本地写阵型 id，切换/遗忘才能按列表里的那一项工作。
 */
export function formationSkillBlock(w,role,f,isDefault=false){
 const level=Math.max(1,formationLevel(role,f.id)||FORMATION_LEVEL);
 w.byte(f.id).int(f.id).byte(f.id).byte(level).string(f.name).byte(0)
  .short(clientFormationPower(f.power1)).short(f.value1)
  .short(clientFormationPower(f.power2)).short(f.value2)
  .short(clientFormationPower(f.power3)).short(f.value3)
  .byte(f.teamcount).bool(isDefault);
 return w;
}

export function formationListBlock(w,role){
 const learned=Object.keys(role?.formations||{}).map(Number)
  .filter(id=>formationInfo(id)&&formationLevel(role,id)>0)
  .sort((a,b)=>a-b);
 w.byte(learned.length);
 for(const id of learned)formationSkillBlock(w,role,formationInfo(id),activeFormationId(role)===id);
 return w;
}

export function formationListPacket(role){return formationListBlock(new Writer(),role);}

/**
 * 世界数据 DATA_FORMATION 的完整块：列表 + bool(有当前阵) + 当前 formationSkill。
 *
 * 客户端 processDataWorld 的读法是 `doGetFormation(t)` → `getBoolean()` →
 * 有当前阵时再 `fromByteFormationSkill(t)`；只发列表会让客户端把下一位当 bool 读，
 * 登录后当前阵型（以及它的属性）就是空的。
 */
export function formationWorldBlock(w,role){
 formationListBlock(w,role);
 const f=activeFormation(role);
 w.bool(!!f);
 if(f)formationSkillBlock(w,role,f,true);
 return w;
}
export function formationWorldPacket(role){return formationWorldBlock(new Writer(),role);}

/**
 * 14012 学书回包：`byte(formationType)` + formationSkill。
 *
 * 注意不能把这个字节写成 0：客户端 doUseFormationBookItemCb 把它当 formationtype
 * 去替换列表里的同号阵型（`l==p.formationtyep`），写 0 会让重复使用的书
 * 在列表里追加一条重复项。首字节因此用阵型 id；负值仍然是错误。
 */
export function formationLearnPacket(role,f){
 return formationSkillBlock(new Writer().byte(f.id),role,f,activeFormationId(role)===f.id);
}

/** 14014：bool(hasActive) + 当前 formationSkill。 */
export function formationPushPacket(role){
 const f=activeFormation(role),w=new Writer();
 if(f){w.bool(true);formationSkillBlock(w,role,f,true);}else w.bool(false);
 return w;
}

/**
 * 每次协议处理完后同步 14014。
 *
 * 客户端的 14012/14013/14015 回调只会改 `formationList`，**不会**改
 * `myPlayer.formationSkill`；面板属性和战斗都读后者，所以服务端必须补推 14014。
 * 这里不做「第一次只记基线」的优化：登录时世界数据已经下发同一份状态，重复推一次
 * 是无害的；反而漏推会让「登录后第一件事就是学书/切阵」的角色属性不刷新。
 */
export function syncFormation(context,send){
 if(!context.role){delete context.lastFormationId;return;}
 const id=activeFormationId(context.role);
 if(context.lastFormationId===id)return;
 send(FORMATION_PUSH_TYPE,formationPushPacket(context.role));
 context.lastFormationId=id;
}
