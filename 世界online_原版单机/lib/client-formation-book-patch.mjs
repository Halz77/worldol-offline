/**
 * 阵法书走原生的 14012（CG_FORMATION_LEARN），不要落到人物技能书 14007。
 *
 * ## 客户端原逻辑
 * 背包「使用」按 type 分支，判断顺序是：
 *   i.type===ITEM_TYPE_SKILL_BOOK ? doUseLearnSkillItem(...)
 *   : power1===POWER_FORMATION_BOOK ? doUseFormationBookItem(...)
 * 阵法书的定义是 type=31（和人物技能书同一个类型），所以先命中第一条，发 14007。
 * 14007 的回包是「技能」结构，不是 formationSkill；客户端会把阵法的字节当技能
 * 塞进 skillList，既不更新 formationList，也不会点亮当前阵法。
 *
 * ## 修法
 * 让 type31 分支排除 power1===182（POWER_FORMATION_BOOK），这样后面的阵法分支
 * 就能正常接到 14012。只改这一个条件，不改协议、不改数据。
 */
export const formationBookRevision='formation-book-use-v1';

const FROM='i.type==y["default"].ITEM_TYPE_SKILL_BOOK?(E["default"].doUseLearnSkillItem';
const TO='i.type==y["default"].ITEM_TYPE_SKILL_BOOK&&y["default"].POWER_FORMATION_BOOK!=i.power1?(E["default"].doUseLearnSkillItem';

export function patchFormationBooks(source){
 const hits=source.split(FROM).length-1;
 if(hits===1)return source.replace(FROM,TO);
 if(hits===0&&source.includes(TO))return source; // 已打过：幂等
 throw Error('v305 formation book patch mismatch: '+hits);
}
