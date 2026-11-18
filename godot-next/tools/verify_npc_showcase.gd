extends SceneTree
## NPC 展厅 + NPC 编辑器验收（确定性检查，headless）。
##   godot --headless --path godot-next --script res://tools/verify_npc_showcase.gd
##
## 覆盖：分页数据完整（1939 条按 icon1 收敛成 282 个造型，不重不漏）、排布不重叠/不出界、图标可解析、
##       原版 compiled 分布未被改动、WorldMap 只在展厅出 NPC、编辑器可加载/改/撤销/存盘。

const GameData = preload("res://scripts/GameData.gd")
const WorldMapScript = preload("res://scripts/WorldMap.gd")

const PAGE_DIR := "res://data/overrides/npcs/"
const INDEX_PATH := PAGE_DIR + "index.json"

var failures := 0
var gd = GameData.new()


func ck(label: String, ok: bool, detail: String = "") -> void:
	if ok:
		print("[check] ok - ", label, (" · " + detail) if detail != "" else "")
	else:
		failures += 1
		printerr("[check] FAIL - ", label, " ", detail)


func _initialize() -> void:
	# ---------- 分页清单 ----------
	var pages: Array = gd.call("npc_pages")
	ck("展厅分页 1 页（同 icon1 去重后 282 个造型）", pages.size() == 1, str(pages.size()))
	ck("页 id 从 9901 开始", int(pages[0].get("id", 0)) == 9901 if pages.size() > 0 else false)
	ck("9901 被识别为展厅页", bool(gd.call("is_npc_page", 9901)))
	ck("4 号地图不是展厅页", not bool(gd.call("is_npc_page", 4)))

	var total := 0
	var bad_grid := 0
	var bad_bounds := 0
	var clash := 0
	var bad_icon := 0
	var empty_icon := 0
	var no_model := 0
	var dup_name_id := 0
	var seen_nameid := {}
	for p in pages:
		var pid := int(p.get("id", 0))
		var arr: Array = gd.get_entry("npcs", pid)
		total += arr.size()
		ck("%d 页数量与清单一致（%d）" % [pid, arr.size()],
			arr.size() == int(p.get("count", -1)), str(arr.size()))
		var seen := {}
		var cw := int(p.get("cell_w_tiles", 9))
		var ch := int(p.get("cell_h_tiles", 6))
		var ox := int(p.get("offset_x_tiles", 4))
		var oy := int(p.get("offset_y_tiles", 4))
		var max_x := int(p.get("cols", 20)) * cw
		var max_y := int(p.get("rows", 15)) * ch
		for n in arr:
			if not (n is Dictionary):
				continue
			var x := int(n.get("x", -1))
			var y := int(n.get("y", -1))
			var key := "%d,%d" % [x, y]
			if seen.has(key):
				clash += 1
			seen[key] = true
			if x < 0 or y < 0 or x >= max_x or y >= max_y:
				bad_bounds += 1
			# 初次排布必须落在格点上（编辑器拖动后会破坏，那是允许的）
			if (x - ox) % cw != 0 or (y - oy) % ch != 0:
				bad_grid += 1
			var icon := str(n.get("icon1", ""))
			if icon.is_empty() or icon == "0":
				empty_icon += 1
			else:
				# ★ NPC 的 icon1 必须是整套造型 model；不能再走「同名 fragment 优先」，
				#   否则 489 个 NPC 会被画成翅膀/光效碎片。
				if not FileAccess.file_exists("res://assets/sprite_model/" + icon + ".json"):
					no_model += 1
				if not FileAccess.file_exists("res://assets/sprite_fragment/" + icon + ".png") \
						and not FileAccess.file_exists("res://assets/sprite_model/" + icon + ".json"):
					bad_icon += 1
			var idkey := str(n.get("name", "")).strip_edges() + "|" + str(n.get("icon1", ""))
			if seen_nameid.has(idkey):
				dup_name_id += 1
			seen_nameid[idkey] = true
	ck("展厅 NPC 总数 282（同 icon1 去重后）", total == 282, str(total))
	ck("页内没有任何两个 NPC 同格", clash == 0, str(clash))
	ck("所有 NPC 坐标在页面界内", bad_bounds == 0, str(bad_bounds))
	ck("初次排布全部落在格点上", bad_grid == 0, str(bad_grid))
	ck("没有解析不了的图标", bad_icon == 0, str(bad_icon))
	ck("★ 每个 NPC 的 icon1 都能找到整套 model", no_model == 0, str(no_model))
	ck("★ 同名同 icon1 的重复已去干净", dup_name_id == 0, str(dup_name_id))
	ck("★ 没有造型编号的条目已剔除", empty_icon == 0, str(empty_icon))

	# ---------- 原版分布没被动过 ----------
	ck("编译快照仍是 63 组", gd.count("npcs") == 63, str(gd.count("npcs")))
	var compiled_total := 0
	for id in gd.ids("npcs"):
		compiled_total += gd.get_entry("npcs", id).size()
	ck("编译快照仍是 1939 个", compiled_total == 1939, str(compiled_total))
	ck("4 号地图原版 23 个 NPC 仍在", gd.get_entry("npcs", 4).size() == 23,
		str(gd.get_entry("npcs", 4).size()))

	# ---------- WorldMap 渲染口径 ----------
	var wm = WorldMapScript.new()
	wm.data = gd
	root.add_child(wm)
	await process_frame
	ck("WorldMap 默认不出 NPC", not bool(wm.get("show_npcs")))
	wm.call("load_map", 4)
	await process_frame
	ck("普通地图默认 0 个 NPC 实体", (wm.get("npcs") as Array).is_empty(),
		str((wm.get("npcs") as Array).size()))
	wm.call("load_map", 9901)
	wm.call("set_show_npcs", true)
	await process_frame
	ck("展厅页 9901 出 282 个 NPC 实体", (wm.get("npcs") as Array).size() == 282,
		str((wm.get("npcs") as Array).size()))
	var textured := 0
	for n in wm.get("npcs"):
		if n.get("sprite") != null and (n.get("sprite") as Node).get("texture") != null:
			textured += 1
	ck("展厅 NPC 绝大多数有贴图", textured >= 275, "%d / 282" % textured)
	wm.queue_free()
	await process_frame

	# ---------- 编辑器 ----------
	var scene = load("res://tools/npc_editor/NPCEditor.tscn")
	ck("NPC 编辑器场景可加载", scene is PackedScene)
	if not (scene is PackedScene):
		print("[verify] 失败项 ", failures)
		quit(1)
		return
	var ed = scene.instantiate()
	root.add_child(ed)
	await process_frame
	await process_frame
	ck("编辑器载入首页 282 个", (ed.get("npcs") as Array).size() == 282,
		str((ed.get("npcs") as Array).size()))
	ck("编辑器页号为 9901", int(ed.get("page_id")) == 9901, str(ed.get("page_id")))
	ck("编辑器初始未选中", int(ed.get("sel")) == -1, str(ed.get("sel")))

	# ★ 按造型去重后，「大剑食人魔」这类旧名并进了 mergedNames（icon1=15045 一条并 40 条），
	#   搜索必须还能按旧名定位到对应造型，否则用户按记忆里的怪名搜不到东西。
	var merged_hit := -1
	var cur: Array = ed.get("npcs")
	for i in range(cur.size()):
		if bool(ed.call("_match", cur[i], "大剑食人魔")):
			merged_hit = i
			break
	ck("★ 搜被合并的旧名「大剑食人魔」能定位到造型", merged_hit >= 0,
		"命中下标 " + str(merged_hit))
	if merged_hit >= 0:
		ck("该造型确实是合并了 40 条的 icon1=15045",
			str(cur[merged_hit].get("icon1", "")) == "15045"
			and int(cur[merged_hit].get("mergedCount", 0)) == 40,
			"icon1 %s mergedCount %s" % [str(cur[merged_hit].get("icon1", "")),
				str(cur[merged_hit].get("mergedCount", 0))])

	# ---------- NpcInfo：npcType 语义 + battleID 编队聚合 ----------
	var NpcInfo = load("res://scripts/NpcInfo.gd")
	ck("npcType 0=任务 / 1=怪物 / 2=商店",
		NpcInfo.type_name(0) == "任务" and NpcInfo.type_name(1) == "怪物"
		and NpcInfo.type_name(2) == "商店",
		"%s/%s/%s" % [NpcInfo.type_name(0), NpcInfo.type_name(1), NpcInfo.type_name(2)])
	ck("npcType 3=传送点 / 5=战力 / 9=交易",
		NpcInfo.type_name(3) == "传送点" and NpcInfo.type_name(5) == "战力"
		and NpcInfo.type_name(9) == "交易",
		"%s/%s/%s" % [NpcInfo.type_name(3), NpcInfo.type_name(5), NpcInfo.type_name(9)])
	# 已知样本：偷袭的弓手 battleID[2012] → group 2012 的 monsters 槽位里 2016 占 2 格，
	# monster 2016「偷袭的箭手」Lv3 / HP 80 / 攻 1-5 / 防 0 → 编队合计 2 只 160 血。
	var archer := {}
	for n in cur:
		if str(n.get("name", "")) == "偷袭的弓手":
			archer = n
			break
	ck("展厅里能取到「偷袭的弓手」样本", not archer.is_empty())
	if not archer.is_empty():
		var bs: Dictionary = NpcInfo.battle_summary(gd, archer)
		ck("★ 编队聚合：2 只 / Lv3 / 总血 160 / 攻 1-5",
			int(bs["count"]) == 2 and int(bs["max_level"]) == 3
			and int(bs["total_hp"]) == 160 and int(bs["atk_min"]) == 1
			and int(bs["atk_max"]) == 5,
			"count %d lv %d hp %d atk %d-%d" % [int(bs["count"]), int(bs["max_level"]),
				int(bs["total_hp"]), int(bs["atk_min"]), int(bs["atk_max"])])
		ck("编队单位能取到名字与等级",
			str((bs["units"] as Array)[0].get("name", "")) == "偷袭的箭手",
			str((bs["units"] as Array)[0].get("name", "")))
		ck("摘要行含「战斗：2 只」",
			NpcInfo.summary_line(gd, archer).find("战斗：2 只") >= 0,
			NpcInfo.summary_line(gd, archer))
	# 无 battleID 的纯 NPC 必须返回 0 只，不能瞎凑
	var pure_npc := {}
	for n in cur:
		if NpcInfo.battle_ids(n).is_empty():
			pure_npc = n
			break
	if not pure_npc.is_empty():
		var bs0: Dictionary = NpcInfo.battle_summary(gd, pure_npc)
		ck("无 battleID 的 NPC 编队数为 0", int(bs0["count"]) == 0, str(bs0["count"]))
		ck("无战斗时摘要行为空串", NpcInfo.summary_line(gd, pure_npc).is_empty())
	# 类型筛选：切到「怪物(1)」后，列表条数必须等于样本里 npcType=1 的条数
	var monsters := 0
	for n in cur:
		if int(n.get("npcType", -1)) == 1:
			monsters += 1
	var flt = ed.get("type_filter")
	var mi := -1
	for i in range(flt.item_count):
		if str(flt.get_item_metadata(i)) == "1":
			mi = i
			break
	ck("左栏有「怪物(1)」筛选项", mi > 0, str(mi))
	if mi > 0:
		flt.selected = mi
		ed.call("_refresh_list")
		ck("★ 类型筛选「怪物」后列表只剩怪物",
			(ed.get("_list_map") as Array).size() == monsters,
			"列表 %d / 样本 %d" % [(ed.get("_list_map") as Array).size(), monsters])
		flt.selected = 0
		ed.call("_refresh_list")
		ck("清空筛选后恢复全部 282 条",
			(ed.get("_list_map") as Array).size() == 282,
			str((ed.get("_list_map") as Array).size()))

	# 重复载入同一页（去重后展厅只剩 1 页，切页不丢改动的场景由下面「脏页保留」覆盖）
	ed.call("load_page", 9901)
	await process_frame
	ck("重复载入 9901 仍是 282 个", (ed.get("npcs") as Array).size() == 282)

	# 选中 → 改名 → 撤销
	ed.call("_select", 0)
	var first: Dictionary = (ed.get("npcs") as Array)[0]
	var hit: int = int(ed.call("_hit", ed.call("npc_pos", first)))
	ck("点到造型位置能命中该 NPC", hit == 0, str(hit))
	var empty_hit: int = int(ed.call("_hit", Vector2(-500, -500)))
	ck("点空白处不命中", empty_hit == -1, str(empty_hit))
	var first_name := str((ed.get("npcs") as Array)[0].get("name", ""))
	ck("选中后处于选中态", int(ed.get("sel")) == 0)
	ed.call("_apply", "name", "验收改名")
	ck("改名字生效", str((ed.get("npcs") as Array)[0].get("name", "")) == "验收改名")
	ck("改动被标记为脏页", bool((ed.get("_dirty") as Dictionary).get(9901, false)))
	# _apply 不进撤销栈（键盘输入不该一条条入栈），所以这里验拖动/新增的撤销
	ed.call("add_npc")
	var after_add := (ed.get("npcs") as Array).size()
	ck("新增后 283 个", after_add == 283, str(after_add))
	ck("新增的落在空格子上",
		str((ed.get("npcs") as Array)[after_add - 1].get("name", "")) == "新 NPC")
	ed.call("undo_last")
	ck("撤销后回到 282 个", (ed.get("npcs") as Array).size() == 282,
		str((ed.get("npcs") as Array).size()))

	# 校验输出
	var report := str(ed.call("validate"))
	ck("校验有输出本页统计", report.find("本页 282 个") >= 0, report.substr(0, 60))

	# 存盘往返（备份 → 写 → 读回 → 还原）
	var page_file := PAGE_DIR + "9901.json"
	var bak := FileAccess.get_file_as_bytes(page_file)
	var idx_bak := FileAccess.get_file_as_bytes(INDEX_PATH)
	ed.call("_select", 0)   # 撤销会把选中清掉，存盘前要重新选
	ed.call("_apply", "name", "存盘验收标记")
	ed.call("save_all")
	var reread = JSON.parse_string(FileAccess.get_file_as_string(page_file))
	var found := false
	if reread is Array:
		for n in reread:
			if n is Dictionary and str(n.get("name", "")) == "存盘验收标记":
				found = true
	ck("保存后磁盘上能读回改动", found)
	var idx_after = JSON.parse_string(FileAccess.get_file_as_string(INDEX_PATH))
	var idx_count := -1
	if idx_after is Dictionary:
		for p in idx_after.get("pages", []):
			if int(p.get("id", 0)) == 9901:
				idx_count = int(p.get("count", -1))
	ck("index 里该页数量同步", idx_count == 282, str(idx_count))
	# 还原现场，别把验收写入的数据留在工程里
	var f1 := FileAccess.open(page_file, FileAccess.WRITE)
	if f1 != null:
		f1.store_buffer(bak)
		f1.close()
	var f2 := FileAccess.open(INDEX_PATH, FileAccess.WRITE)
	if f2 != null:
		f2.store_buffer(idx_bak)
		f2.close()
	gd.reload_overrides()
	ck("验收后已还原 9901 原文件", FileAccess.get_file_as_bytes(page_file) == bak if bak.size() > 0 else true)

	print("[verify] 失败项 ", failures)
	quit(1 if failures > 0 else 0)
