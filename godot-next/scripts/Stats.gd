extends RefCounted
## 属性规则的过渡占位：先读 20 个基准角色的数值快照，供面板显示与以后人工核对。
## 真正的 GDScript 属性公式要按 analysis/modules/0056.js 的 getPowerValue 口径重写，
## 那部分不属于「素材可掌控」的范畴，放到规则迁移阶段做。

const GameData = preload("res://scripts/GameData.gd")


static func cases() -> Array:
	return GameData.baseline().get("cases", [])


static func case_count() -> int:
	return cases().size()


static func case_name(index: int) -> String:
	var all = cases()
	if index < 0 or index >= all.size():
		return ""
	return str(all[index].get("name", ""))


## mode = "rating"（38 项战力评分）或 "battle"（60 项战斗面板）
static func stats_of(index: int, mode: String = "rating") -> Dictionary:
	var all = cases()
	if index < 0 or index >= all.size():
		return {}
	var bucket = all[index].get(mode, {})
	return bucket.get("stats", {}) if bucket is Dictionary else {}
