extends RefCounted
## NPC 战斗信息聚合（纯函数，不改任何数据）。
##
## 链路：NPC.battleID → groups/<battleID>.json（编队，monsters 是 10 个槽位）
##       → monsters/<monsterId>.json（实际作战单位，50+ 战斗字段）
##
## 用途：展厅编辑器里选中一个怪就能看到「几只 / 几级 / 多少血 / 攻防」，
## 铺图配难度时不用再翻数据文件。未来的战斗系统也应复用这里的解析，
## 避免两处各写一套 bit 语义。

## npcType 常量（0074.js:930-943 的 t.NPC_* 定义，原版语义）
const TYPE_NAMES := {
	0: "任务",
	1: "怪物",
	2: "商店",
	3: "传送点",
	4: "告示牌",
	5: "战力",
	6: "礼品",
	7: "教师",
	8: "区域传送",
	9: "交易",
	10: "帮会",
	11: "建筑",
	12: "宠物恢复",
}


static func type_name(t: int) -> String:
	return str(TYPE_NAMES.get(t, "未知(%d)" % t))


## battleID 字段可能是数组（同一 NPC 多个战场编队）也可能缺省。
static func battle_ids(npc: Dictionary) -> Array:
	var out: Array = []
	var raw = npc.get("battleID", [])
	if raw is Array:
		for x in raw:
			var v := int(x)
			if v > 0:
				out.append(v)
	else:
		var v2 := int(raw)
		if v2 > 0:
			out.append(v2)
	return out


## 聚合编队数值，返回：
## {count, max_level, total_hp, atk_min, atk_max, def_max, units:[{id,name,level,hp,atk_min,atk_max,def}]}
## count 是「编队里实际站位数量」（同一种怪占 2 格就算 2 只，和原版战斗一致）。
static func battle_summary(gd, npc: Dictionary) -> Dictionary:
	var units: Array = []
	var seen_groups: Array = []
	for bid in battle_ids(npc):
		var key := int(bid)
		if seen_groups.has(key):
			continue
		seen_groups.append(key)
		var garr: Array = gd.get_entry("groups", key)
		if garr.is_empty() or not (garr[0] is Dictionary):
			continue
		var slots: Array = (garr[0] as Dictionary).get("monsters", [])
		for s in slots:
			var mid := int(s)
			if mid <= 0:
				continue
			var marr: Array = gd.get_entry("monsters", mid)
			if marr.is_empty() or not (marr[0] is Dictionary):
				continue
			var m: Dictionary = marr[0]
			units.append({
				"id": mid,
				"name": str(m.get("name", "")),
				"level": int(m.get("level", 0)),
				"hp": int(m.get("hpMax", 0)),
				"atk_min": int(m.get("atkMin", 0)),
				"atk_max": int(m.get("atkMax", 0)),
				"def": int(m.get("def_str", 0)),
			})
	var res := {
		"count": units.size(), "units": units,
		"max_level": 0, "total_hp": 0, "atk_min": 0, "atk_max": 0, "def_max": 0,
	}
	if units.is_empty():
		return res
	var amin := 1 << 30
	var amax := 0
	var dmax := 0
	var lv := 0
	var hp := 0
	for u in units:
		amin = mini(amin, int(u["atk_min"]))
		amax = maxi(amax, int(u["atk_max"]))
		dmax = maxi(dmax, int(u["def"]))
		lv = maxi(lv, int(u["level"]))
		hp += int(u["hp"])
	res["atk_min"] = amin
	res["atk_max"] = amax
	res["def_max"] = dmax
	res["max_level"] = lv
	res["total_hp"] = hp
	return res


## 给界面用的一行摘要（没有战斗数据时返回空串）。
static func summary_line(gd, npc: Dictionary) -> String:
	var s := battle_summary(gd, npc)
	var n := int(s["count"])
	if n <= 0:
		return ""
	var line := "战斗：%d 只 · 最高 Lv %d · 总血 %d · 攻 %d-%d · 防 %d" % [
		n, int(s["max_level"]), int(s["total_hp"]),
		int(s["atk_min"]), int(s["atk_max"]), int(s["def_max"])]
	var names: Array = []
	for u in (s["units"] as Array):
		var one := "%s(Lv%d)" % [str(u["name"]), int(u["level"])]
		if not names.has(one):
			names.append(one)
	line += "\n单位：" + ", ".join(names.slice(0, 4))
	if names.size() > 4:
		line += " 等 %d 种" % names.size()
	return line
