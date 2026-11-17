extends RefCounted
## 中文标签表。改名字直接编辑本文件，Godot 编辑器里可见可改。
##
## 动画名依据 analysis/modules/0055.js 的 ANIMATION_BATTLE_* 常量（4~15）；
## 标注「推断」的地图段 0 / 2 与战斗段 16 没有可用常量，按 anis 用途推测，
## 属于检索标签，不写回任何原版数据。
## 属性名按 20 角色基线快照的键逐条翻译，共 59 个键。

const ANIMATION_LABELS = {
	0: "地图 · 站立 / 待机（推断）",
	2: "地图 · 行走（推断）",
	4: "战斗 · 站立",
	5: "战斗 · 攻击起手",
	6: "战斗 · 攻击移动",
	7: "战斗 · 攻击动作",
	8: "战斗 · 攻击收招",
	9: "战斗 · 使用 / 施法",
	10: "战斗 · 投掷",
	11: "战斗 · 防御",
	12: "战斗 · 受击",
	13: "战斗 · 技能",
	14: "战斗 · 防御起手",
	15: "战斗 · 枪械攻击",
	16: "战斗 · 动作 16（源码无常量）"
}

const STAT_LABELS = {
	"HPMAX": "最大生命",
	"MPMAX": "最大魔法",
	"SPEED": "出手速度",
	"ATK_TYPE": "攻击类型",
	"ATK_MIN": "最小攻击",
	"ATK_MAX": "最大攻击",
	"ATK_TIME": "攻击间隔",
	"ATK_STR": "力量攻击",
	"ATK_AGI": "敏捷攻击",
	"ATK_MAGIC": "魔法攻击",
	"LEFT_WEAPON_TYPE": "左手武器类型",
	"RIGHT_WEAPON_TYPE": "右手武器类型",
	"LEFT_ATK_MIN": "左手最小攻击",
	"LEFT_ATK_MAX": "左手最大攻击",
	"RIGHT_ATK_MIN": "右手最小攻击",
	"RIGHT_ATK_MAX": "右手最大攻击",
	"LEFT_ATK_TIME": "左手攻击间隔",
	"RIGHT_ATK_TIME": "右手攻击间隔",
	"ATK_STR_NEARBY": "近战力量攻击",
	"ATK_STR_RANGE": "远程力量攻击",
	"ATK_AGI_NEARBY": "近战敏捷攻击",
	"ATK_AGI_RANGE": "远程敏捷攻击",
	"DEF_STR": "力量防御",
	"DEF_AGI": "敏捷防御",
	"DEF_MAGIC": "魔法防御",
	"DEF_STR_NEARBY": "近战力量防御",
	"DEF_STR_RANGE": "远程力量防御",
	"DEF_AGI_NEARBY": "近战敏捷防御",
	"DEF_AGI_RANGE": "远程敏捷防御",
	"DEF_FIELD": "领域防御",
	"DODGE": "躲闪",
	"HIT_RATE": "命中",
	"HIT_MAGIC": "魔法命中",
	"CRITICAL": "暴击",
	"CRITICAL_DAMAGE": "暴击伤害",
	"FORCE_HIT": "强制命中",
	"WIL": "意志",
	"TOUGH": "坚韧",
	"BLOCK": "格挡",
	"BRK_ARMOR": "破甲",
	"INSIGHT": "洞察",
	"BACK": "背击",
	"MAGIC_BACK": "魔法背击",
	"LIFE_ABSORPTION": "生命吸收",
	"MANA_ABSORPTION": "魔法吸收",
	"MAGIC_PENETRATION": "魔法穿透",
	"HEAL_RECOVERY": "治疗回复",
	"MANA_RECOVERY": "魔法回复",
	"RECOVERY": "回复",
	"IGNORE_BACK": "无视背击",
	"IGNORE_MAGIC_BACK": "无视魔法背击",
	"IGNORE_BLOCK": "无视格挡",
	"IGNORE_INSIGHT": "无视洞察",
	"IGNORE_WIL": "无视意志",
	"IGNORE_TOUCH": "无视接触",
	"IGNORE_CRITICAL": "无视暴击",
	"KEEPOUT_ATK_TIME": "攻击间隔压制",
	"LEVEL": "等级",
	"LEVEL2": "等级（战斗）"
}

static func animation(id: int) -> String:
	return str(ANIMATION_LABELS.get(id, "动画 %d（源码无常量）" % id))


static func stat(key: String) -> String:
	return str(STAT_LABELS.get(key, key + "（未译）"))


## JSON.parse_string 把整数解析成 float，面板统一显示成整数，避免 "2327.0"。
static func number(v) -> String:
	if v is String:
		return v
	var f := float(v)
	var i := roundi(f)
	if abs(f - float(i)) < 0.0001:
		return str(i)
	return "%.2f" % f
