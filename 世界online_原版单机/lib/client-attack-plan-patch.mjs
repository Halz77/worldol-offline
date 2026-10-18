/**
 * MOD(attack-plan)：战斗伤害按**逐手的武伤与攻次**算，与参考实现「幻想世界OL」一致。
 *
 * ## 需求（用户第 2 项）
 * 「法师伤害计算跟他们一样加上『武商（武伤）』和『攻次』判定」。
 * 官方术语见 data/references/world-online-221f8cf/vocationalSkills.json 的技能描述：
 * 「该技能的**武伤、攻次**等属性对当前武器不生效」→
 *   · 武伤 = 武器伤害（ModelConst.LEFT_ATK_MIN/MAX、RIGHT_ATK_MIN/MAX）
 *   · 攻次 = 攻击次数（ModelConst.LEFT_ATK_TIME、RIGHT_ATK_TIME）
 *
 * ## 原版（v305）怎么算的
 * `Battle.calDamage`（模块 0005 的 Battle 类）一次判定就是一串「平均交替左右手」：
 *
 *   this.totalHitTime = ATK_TIME + skill.atk_time，夹在 MIN_HIT_TIME..MAX_HIT_TIME
 *   var left = LEFT_ATK_TIME, right = RIGHT_ATK_TIME, p = left>0 && right>0
 *   left<=0 && right>0 → isLeftHand=!1
 *   for (每次攻击) { calcDirectDamage(); if (p) isLeftHand = !isLeftHand }
 *
 * 而伤害表里的武器伤害项（`BATTLE_RAND_ATC`）**永远取 ATK_MIN..ATK_MAX**，
 * 而 `ModelConst.ATK_MIN` 是 `max(LEFT_ATK_MIN, RIGHT_ATK_MIN)`（见模块 0056 的 get）：
 *
 *   case ATK_MIN: var T=this.get(LEFT_ATK_MIN), E=this.get(RIGHT_ATK_MIN); i=T, E>i && (i=E)
 *
 * → 两条副作用：
 *   ① **武伤**：每次攻击都用「较好的那只手」的武器伤害，另一只手的高攻武器白拿；
 *   ② **攻次**：左右手各打几次只按 50/50 交替，不看两只武器各自的攻次（EQP_HIT_TIME）。
 * 单体武器（左手有、右手空）时两条都看不出来，所以原版一直没暴露；
 * 而我们第 4x 版的 `client-weapon-slot-patch.mjs` 已经解除了「两把武器不能同时装」
 * 的限制 → 双持在本工程是常规玩法，这两条立刻变成玩家看得见的差异。
 *
 * ## 对方（3.0）的做法：attack plan
 * 在 Battle 类上新增 `buildAttackPlan(actor, skill)`，按**手**算出一份「每次攻击用哪只手」的
 * 计划数组（每项 {left, min, max, type}），`calDamage` 的循环改成逐次把当前手挂到
 * `this._currentAttackHand`（try/finally 还原），于是：
 *   · `calc(BATTLE_RAND_ATC)` 改成「有当前手就用当前手的 min..max」→ **逐次武伤**；
 *   · `calc(BATTLE_AP_MAGIC)` 的武伤门槛也从 `getEquipWeaponType()` 改成当前手的武器类型
 *     （否则双持「法系武器 + 物理武器」时，物理那只手也会按法系武器判武伤）；
 *     同时把「谁有资格判武伤」从 `TYPE_PLAYER` 扩到 军团 / 离线佣兵 actor。
 * 计划的长度仍是 `ATK_TIME + skill.atk_time`（夹在 1..99），所以**总攻次不变**，
 * 变的只是左右手的分配：先按 `LEFT_ATK_TIME`/`RIGHT_ATK_TIME` 各排各的，
 * 多出来的（技能加的攻次）再从左手开始交替 —— 左 3 右 1 就是 L,R,L,L，
 * 原版是 L,R,L,R（平均交替）。
 *
 * ## 本补丁搬了什么 / 没搬什么
 * 搬：`buildAttackPlan` + 逐手循环 + `BATTLE_RAND_ATC` 逐手 + `BATTLE_AP_MAGIC` 逐手。
 * 不搬（与本次需求无关，先留着，需要时再单独评估）：
 *   · 他们把 `delDamageEffect` 重写成「按真实掉血算吸血/仇恨/反击/1 血复活顺序」；
 *     这里保留原版 `delDamageEffect` + `1==t.isDead()` 的收尾（所以循环里不用他们的
 *     `u.targetReachedZero`）。
 *   · 他们把 plan 缓存在 `this._attackPlan`（外层按 actor+skill 装一次、finally 还原）。
 *     plan 只由 (actor, skill) 决定、而本函数是「每个目标调一次」，这里直接现算，
 *     不动那个上千行的外层函数；`_currentAttackHand` 这个跨函数契约保持一致。
 *
 * ## 兼容性检查（搬之前逐条核过）
 *   · `_currentAttackHand` 在 `calc(BATTLE_RAND_ATC,...)` 里用得安全：全包只有 3 处调用
 *     （BATTLE_AP_STR / AP_AGI / AP_MAGIC），都是「攻击方在前」，与计划的 actor 同一个；
 *     循环外没人设 `_currentAttackHand`，取不到时自动退回原版 `ATK_MIN..ATK_MAX`。
 *   · `isLeftHand` 全包只写不读（构造 1 处 + calDamage 4 处），所以逐手赋值不会影响别处。
 *   · 空手/拳套/武器耐久为 0 时 `getEquipWeaponType()` 返回 `BACK_ERROR_NULL_HAND`(-401)，
 *     照搬对方的处理：left=right=0 → 走「单手持 ATK_MIN..ATK_MAX」那条，与原版一致。
 *   · 怪物 / 宠物 `type` 不在（PLAYER|LEGION|MERCENARY&&离线佣兵）里 → 不逐手，
 *     单项计划 min/max 就是 ATK_MIN/ATK_MAX，与改动前等价。
 */
export const attackPlanRevision='weapon-hands-v1';

/** 计划长度上限（与客户端 ModelConst.MAX_HIT_TIME 一致，测试用）。 */
export const ATTACK_PLAN_MAX_HIT_TIME=99;
/** 计划长度下限（与客户端 ModelConst.MIN_HIT_TIME 一致，测试用）。 */
export const ATTACK_PLAN_MIN_HIT_TIME=1;

/**
 * 注入到主包里的 `buildAttackPlan` 本体（原样拼进 `e.prototype.xxx` 逗号链）。
 *
 * 逐字对应对方的实现，只把局部变量名写成可读的（这段代码会进 4.5MB 的产物里，
 * 变量名不能与模块级依赖 `f`/`l`/`c`/`y`/`v`/`E` 撞名，否则会把 import 覆盖掉）。
 */
export const ATTACK_PLAN_METHOD=
 'e.prototype.buildAttackPlan=function(actor,skill){'
 +'var total=Math.max(f.ModelConst.MIN_HIT_TIME,Math.min(f.ModelConst.MAX_HIT_TIME,actor.get(f.ModelConst.ATK_TIME)+(skill?skill.atk_time:0))),'
 +'type=typeof actor.getType==="function"?actor.getType():actor.type,'
 +'wielding=null!=actor.bag&&(type==l.MODEL_TYPE.TYPE_PLAYER||type==l.MODEL_TYPE.TYPE_LEGION||type==l.MODEL_TYPE.TYPE_MERCENARY&&!0===actor._offlinePlayerMercenaryActor),'
 +'left=wielding?actor.get(f.ModelConst.LEFT_ATK_TIME):0,'
 +'right=wielding?actor.get(f.ModelConst.RIGHT_ATK_TIME):0,'
 +'plan=[];'
 +'function hand(isLeft){'
 +'var min=actor.get(isLeft?f.ModelConst.LEFT_ATK_MIN:f.ModelConst.RIGHT_ATK_MIN),'
 +'max=actor.get(isLeft?f.ModelConst.LEFT_ATK_MAX:f.ModelConst.RIGHT_ATK_MAX);'
 +'return{left:isLeft,min:Math.max(0,min),max:Math.max(0,min,max),type:actor.get(isLeft?f.ModelConst.LEFT_WEAPON_TYPE:f.ModelConst.RIGHT_WEAPON_TYPE)};'
 +'}'
 +'if(wielding){'
 +'if(actor.getEquipWeaponType()==c["default"].BACK_ERROR_NULL_HAND)left=right=0;'
 +'else{'
 +'if(actor.get(f.ModelConst.LEFT_WEAPON_TYPE)<=0)left=0;'
 +'if(actor.get(f.ModelConst.RIGHT_WEAPON_TYPE)<=0)right=0;'
 +'}'
 +'}'
 +'if(left<=0&&right<=0){'
 +'var singleMin=actor.get(f.ModelConst.ATK_MIN),singleMax=actor.get(f.ModelConst.ATK_MAX),'
 +'single={left:!0,min:Math.max(0,singleMin),max:Math.max(0,singleMin,singleMax),type:typeof actor.getEquipWeaponType==="function"?actor.getEquipWeaponType():-1};'
 +'while(plan.length<total)plan.push(single);'
 +'return plan;'
 +'}'
 +'var leftHand=left>0?hand(!0):null,rightHand=right>0?hand(!1):null,remainLeft=left,remainRight=right;'
 +'while(plan.length<total&&(remainLeft>0||remainRight>0)){'
 +'if(remainLeft>0&&plan.length<total){plan.push(leftHand);remainLeft--}'
 +'if(remainRight>0&&plan.length<total){plan.push(rightHand);remainRight--}'
 +'}'
 +'for(var extra=0;plan.length<total;extra++)plan.push(leftHand&&rightHand?(extra%2?rightHand:leftHand):(leftHand||rightHand));'
 +'return plan;'
 +'}';

/** 幂等判据：注入过的产物里一定有这个方法名。 */
const MARKER='e.prototype.buildAttackPlan=function(actor,skill){';

function replaceOnce(source,from,to,label){
 if(source.split(from).length!==2)throw Error('v305 attack plan patch mismatch: '+label);
 return source.replace(from,to);
}

// ① 先在 calDamage 之前挂上 buildAttackPlan（同一个逗号链，注意用逗号不是分号）。
const FROM_METHOD=',e.prototype.calDamage=function(e,t,i,o,r){';
const TO_METHOD=','+ATTACK_PLAN_METHOD+',e.prototype.calDamage=function(e,t,i,o,r){';

// ② calDamage 开头：总攻次改由计划长度决定，并把当前手挂进 this._currentAttackHand。
const FROM_TOTAL='this.isLeftHand=!0,this.block=0,this.totalHitTime=e.get(f.ModelConst.ATK_TIME),null!=i&&(this.totalHitTime+=i.atk_time),'
 +'this.totalHitTime=T.Tool.sumValue(this.totalHitTime,0,f.ModelConst.MIN_HIT_TIME,f.ModelConst.MAX_HIT_TIME),'
 +'1==c["default"].isPhysicalAtkType(s)&&(this.block=this.calc(y["default"].BATTLE_BLOCK,t,e,i));'
 +'var _=e.get(f.ModelConst.LEFT_ATK_TIME),d=e.get(f.ModelConst.RIGHT_ATK_TIME),p=_>0&&d>0;0>=_&&d>0&&(this.isLeftHand=!1);';
const TO_TOTAL='this.block=0;var plan=this.buildAttackPlan(e,i);this.totalHitTime=plan.length,'
 +'1==c["default"].isPhysicalAtkType(s)&&(this.block=this.calc(y["default"].BATTLE_BLOCK,t,e,i));'
 +'var previousHand=this._currentAttackHand;';

// ③ 循环里逐次换手（原版的「p 为真就翻转」换成「用计划里那一手」）。
const FROM_LOOP='for(var g=!1,S=new v["default"],I=new v["default"],m=0;m<this.totalHitTime;m++){var u=this.calcDirectDamage(e,t,i,r);if(1==p&&(this.isLeftHand=!this.isLeftHand),';
const TO_LOOP='try{for(var g=!1,S=new v["default"],I=new v["default"],m=0;m<this.totalHitTime;m++){'
 +'this._currentAttackHand=plan[m],this.isLeftHand=this._currentAttackHand.left;'
 +'var u=this.calcDirectDamage(e,t,i,r);if(';

// ④ 循环收尾：finally 把 this._currentAttackHand 还原（嵌套调用时不能留下脏值）。
const FROM_TAIL='this.delDamageEffect(u,e,t,i,S,I),1==t.isDead()){this.checkDie1Hp(t,null);break}}var A=y["default"].MAX_SHOW_HIT_2;';
const TO_TAIL='this.delDamageEffect(u,e,t,i,S,I),1==t.isDead()){this.checkDie1Hp(t,null);break}}}finally{this._currentAttackHand=previousHand}var A=y["default"].MAX_SHOW_HIT_2;';

// ⑤ 武伤项：有当前手就用当前手的武器伤害区间。
const FROM_RAND='case y["default"].BATTLE_RAND_ATC:return this.randRange(t.get(f.ModelConst.ATK_MIN),t.get(f.ModelConst.ATK_MAX));';
const TO_RAND='case y["default"].BATTLE_RAND_ATC:if(this._currentAttackHand)return this.randRange(this._currentAttackHand.min,this._currentAttackHand.max);'
 +'return this.randRange(t.get(f.ModelConst.ATK_MIN),t.get(f.ModelConst.ATK_MAX));';

// ⑥ 魔法攻击点的武伤门槛：按当前手的武器类型判，并把有资格的 actor 扩到军团/离线佣兵。
const FROM_MAGIC='if(t.type==l.MODEL_TYPE.TYPE_PLAYER&&null!=t.bag){var B=t.getEquipWeaponType();';
const TO_MAGIC='if((t.type==l.MODEL_TYPE.TYPE_PLAYER||t.type==l.MODEL_TYPE.TYPE_LEGION||t.type==l.MODEL_TYPE.TYPE_MERCENARY&&!0===t._offlinePlayerMercenaryActor)&&null!=t.bag){'
 +'var B=this._currentAttackHand?this._currentAttackHand.type:t.getEquipWeaponType();';

export function patchAttackPlan(source){
 if(source.includes(MARKER))return source;   // 已打过：幂等（standalone 靠这条跳过重打）
 source=replaceOnce(source,FROM_METHOD,TO_METHOD,'buildAttackPlan 挂载点');
 source=replaceOnce(source,FROM_TOTAL,TO_TOTAL,'calDamage 总攻次');
 source=replaceOnce(source,FROM_LOOP,TO_LOOP,'calDamage 逐手循环');
 source=replaceOnce(source,FROM_TAIL,TO_TAIL,'calDamage 循环收尾');
 source=replaceOnce(source,FROM_RAND,TO_RAND,'BATTLE_RAND_ATC 逐手武伤');
 source=replaceOnce(source,FROM_MAGIC,TO_MAGIC,'BATTLE_AP_MAGIC 逐手武伤门槛');
 return source;
}
