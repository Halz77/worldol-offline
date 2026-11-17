extends SceneTree
## 阶段 2 编译产物验收（确定性）：
##   godot --headless --path godot-next --script res://tools/verify-data-compile.gd

const GameData = preload("res://scripts/GameData.gd")

var failures := 0


func ck(label: String, ok: bool, detail: String = "") -> void:
	if ok:
		print("[data] ok - ", label, (" · " + detail) if detail != "" else "")
	else:
		failures += 1
		printerr("[data] FAIL - ", label, " ", detail)


func _init() -> void:
	var gd := GameData.new()
	var ix := gd.compiled_index()
	ck("分片索引可读且版本为 1", int(ix.get("version", -1)) == 1)
	ck("10 个数据域", gd.domains().size() == 10, str(gd.domains().size()))
	ck("道具 2505 / 技能 695 / 怪物 404 / 宠物 504",
		gd.count("items") == 2505 and gd.count("skills") == 695
		and gd.count("monsters") == 404 and gd.count("petProfiles") == 504,
		"%d/%d/%d/%d" % [gd.count("items"), gd.count("skills"),
			gd.count("monsters"), gd.count("petProfiles")])

	var item: Array = gd.get_entry("items", 28003)
	ck("道具按 id 懒加载", item.size() == 1 and str(item[0].get("name", "")) == "雌雄双股剑【真】")
	var skill: Array = gd.get_entry("skills", 550)
	ck("技能按 id 懒加载", not skill.is_empty() and int(skill[0].get("id", -1)) == 550)
	var monster: Array = gd.get_entry("monsters", 409)
	ck("怪物按 id 懒加载", not monster.is_empty() and str(monster[0].get("name", "")) == "野狼")
	var pet: Array = gd.get_entry("petProfiles", 0)
	ck("宠物按数组下标懒加载", not pet.is_empty() and not str(pet[0].get("name", "")).is_empty(),
		str(pet[0].get("name", "")) if not pet.is_empty() else "空")
	ck("不存在 id 返回空数组且不报错", gd.get_entry("items", 99999999).is_empty())

	var hits: Array = gd.search("items", "玫瑰剑")
	ck("索引搜索按名字命中且不打开分片", hits.size() > 0 and hits.has(20353),
		str(hits.slice(0, 5)))
	ck("名字反查", gd.name_of("items", 28003) == "雌雄双股剑【真】")
	ck("悬空覆盖被记录（skills/1379）", gd.dangling_overrides().has("skills/1379"))

	var cached := gd.cache_size()
	gd.get_entry("items", 28003)
	ck("重复查询命中缓存，不重复读盘", gd.cache_size() == cached, str(cached))

	ck("工程内没有原始 144MB 大文件",
		not FileAccess.file_exists("res://data/official-v305.json")
		and not FileAccess.file_exists("res://data/content-library.json"))

	var t0 := Time.get_ticks_usec()
	for i in range(100):
		gd.get_entry("items", 28003 + i)
	var us := Time.get_ticks_usec() - t0
	ck("100 次查询耗时 < 500ms", us < 500000, str(us) + " 微秒")

	gd.clear_cache()
	ck("缓存可清空", gd.cache_size() == 0)

	if failures == 0:
		print("[data] 全部通过")
	else:
		printerr("[data] 失败 ", failures, " 项")
	quit(0 if failures == 0 else 1)
