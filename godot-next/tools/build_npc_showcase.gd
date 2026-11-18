extends SceneTree
## 把散在各张地图上的 NPC 集中排进「展厅」分页地图（只生成数据，不改编译快照）。
##   godot --headless --path godot-next --script res://tools/build_npc_showcase.gd
## 已经生成过就跳过；要重新排布：WORLDOL_NPC_REBUILD=1 再跑（会覆盖展厅里的手工改动）。
##
## 产物：
##   data/overrides/npcs/index.json     页清单 + 排布参数
##   data/overrides/npcs/<页id>.json     该页 NPC 数组（结构同 data/compiled/npcs/<mapId>.json）
##   data/overrides/maps.json            追加展厅页的地图元数据（合成网格，无 tile/图集）
##
## 为什么写 override 而不是改 data/compiled：编译快照不可再生（编译脚本不在工程里），
## 改了就回不去；override 删掉即回到原版分布，也方便 diff。

const GameData = preload("res://scripts/GameData.gd")

const OUT_DIR := "res://data/overrides/npcs/"
const OUT_INDEX := OUT_DIR + "index.json"
const MAPS_OVERRIDE := "res://data/overrides/maps.json"

const TILE := 24        # 和工程其它地图一致
const COLS := 20        # 每页横向放几个
const ROWS := 15        # 每页纵向放几个
# 格子尺寸：NPC 的 icon1 是整套造型 model（0.45 缩放后 81×90），
# 5×5 格 = 120×120 足够放下且留出名字位置。
# （第一版按「部件图」估成 96×120，后来改成 216×144；确认 icon1 是 model 后收回 120。）
const CELL_W := 5       # 横向 5 格 = 120px
const CELL_H := 5       # 纵向 5 格 = 120px
# 落点：x 让 81px 宽的造型居中（5c+2 → 像素 120c+60，正好是格心），
# y 让脚底（pos+13.5）落在格内（5r+3 → 像素 120r+84，脚底 97.5 < 120）。
const OFFSET_X := 2
const OFFSET_Y := 3
const PAGE_BASE := 9901 # 展厅页 id 段，避开真实地图（真实最大 964）

var _gd = GameData.new()
var _dropped := 0
var _raw_total := 0


func _initialize() -> void:
	if not OS.has_environment("WORLDOL_NPC_REBUILD") and FileAccess.file_exists(OUT_INDEX):
		print("[showcase] 已存在 ", OUT_INDEX, "，跳过（重排请设 WORLDOL_NPC_REBUILD=1）")
		quit(0)
		return

	var entries: Array = _collect()
	if entries.is_empty():
		printerr("[showcase] 没有读到任何 NPC，检查 data/compiled/npcs")
		quit(1)
		return

	var per_page := COLS * ROWS
	var page_count := int(ceil(float(entries.size()) / float(per_page)))
	var map_w := COLS * CELL_W * TILE
	var map_h := ROWS * CELL_H * TILE

	if not DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(OUT_DIR)):
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUT_DIR))

	var pages_meta: Array = []
	var maps_override: Dictionary = _read_dict(MAPS_OVERRIDE)

	for p in range(page_count):
		var page_id := PAGE_BASE + p
		var slice: Array = []
		for i in range(p * per_page, mini(entries.size(), (p + 1) * per_page)):
			var e: Dictionary = entries[i]
			var local := i - p * per_page
			var col := local % COLS
			var row := int(local / COLS) % ROWS
			e["x"] = col * CELL_W + OFFSET_X
			e["y"] = row * CELL_H + OFFSET_Y
			e["showcasePage"] = page_id
			e["showcaseSlot"] = local
			slice.append(e)

		var page_name := "NPC 展厅 %d/%d" % [p + 1, page_count]
		var file := OUT_DIR + str(page_id) + ".json"
		_write_json(file, slice)
		pages_meta.append({
			"id": page_id, "name": page_name, "count": slice.size(),
			"w": map_w, "h": map_h, "cols": COLS, "rows": ROWS,
			"cell_w_tiles": CELL_W, "cell_h_tiles": CELL_H,
			"offset_x_tiles": OFFSET_X, "offset_y_tiles": OFFSET_Y,
			"first": p * per_page, "last": p * per_page + slice.size() - 1,
		})
		maps_override[str(page_id)] = {
			"id": page_id, "name": page_name,
			"w": map_w, "h": map_h, "tile_w": TILE, "tile_h": TILE,
			"tiles": 0, "objects": 0, "npc_count": slice.size(),
			"spawn": [2, 2],
			# 没有视觉 JSON / 图集 / 背景：WorldMap 走合成网格兜底，正好当展厅地面
			"has_config": false, "has_atlas": false, "has_bg": false,
		}
		print("[showcase] 写入 %s（%d 个）" % [file, slice.size()])

	# 页数变少时（去重/改容量）清掉多余的旧页，否则地图列表里会留下空展厅
	var stale: Array = []
	for key in maps_override.keys():
		var kid := int(key)
		if kid >= PAGE_BASE and kid >= PAGE_BASE + page_count:
			stale.append(str(kid))
	for key in stale:
		var skey: String = str(key)
		maps_override.erase(skey)
		var p: String = OUT_DIR + skey + ".json"
		if FileAccess.file_exists(p):
			DirAccess.remove_absolute(ProjectSettings.globalize_path(p))
	if not stale.is_empty():
		print("[showcase] 清掉多余旧页 ", str(stale))

	var index := {
		"version": 2,
		"generated": Time.get_datetime_string_from_system(),
		"total": entries.size(),
		"deduped": true,
		"dedup_rule": "name+icon1",
		"dropped_duplicates": _dropped,
		"compiled_total": _raw_total,
		"per_page": per_page,
		"page_count": page_count,
		"tile": TILE, "cols": COLS, "rows": ROWS,
		"cell_w_tiles": CELL_W, "cell_h_tiles": CELL_H,
		"offset_x_tiles": OFFSET_X, "offset_y_tiles": OFFSET_Y,
		"w": map_w, "h": map_h,
		"pages": pages_meta,
	}
	_write_json(OUT_INDEX, index)
	_write_json(MAPS_OVERRIDE, maps_override)
	print("[showcase] 完成：%d 个 NPC → %d 页（%d..%d），每页最多 %d 个"
		% [entries.size(), page_count, PAGE_BASE, PAGE_BASE + page_count - 1, per_page])
	quit(0)


## 按「原地图 id → 原顺序」收集，同一个城镇的 NPC 在展厅里也挨着，方便对照。
## ★ 去重键 = icon1（外观造型编号）本身。展厅是素材库，同一套美术只留一个模板：
##   原版会把同一个怪摆到多张地图甚至同一张图的多个格子（922 图有 8 个「大剑食人魔」，
##   npcId 2..9 不同但造型都是 15045），也会让不同名字共用一套造型（414 = 月狼宗
##   剑手/刀手/族人，318 = 暴力女/中级护送/轩姐）。用户 2026-11-18 明确：同造型即使
##   名字不同也可删，所以这里只按 icon1 分组，1939 → 268 个造型。
## 同组保留「信息最全」的那条（有名字/台词/任务组/商店优先），并把被合并掉的名字
## 记进 mergedNames，方便以后查「这个造型原本还叫过什么」。
func _collect() -> Array:
	var groups := {}
	var order: Array = []
	var dropped := 0
	var raw := 0
	var ids: Array = _gd.ids("npcs")
	ids.sort()
	for id in ids:
		var arr: Array = _gd.get_entry("npcs", id)
		for i in range(arr.size()):
			var src = arr[i]
			if not (src is Dictionary):
				continue
			raw += 1
			var e: Dictionary = (src as Dictionary).duplicate(true)
			e["sourceMapId"] = int(id)
			e["sourceIndex"] = i
			var dup_key := str(e.get("icon1", "")).strip_edges()
			if dup_key.is_empty() or dup_key == "0":
				dropped += 1   # 没有造型编号 → 展厅里画不出来，直接丢（原版这类是空壳）
				continue
			if groups.has(dup_key):
				(groups[dup_key] as Array).append(e)
				dropped += 1
			else:
				groups[dup_key] = [e]
				order.append(dup_key)
	var out: Array = []
	for k in order:
		var g: Array = groups[k]
		var best: Dictionary = g[0]
		var best_score := _info_score(best)
		for j in range(1, g.size()):
			var sc := _info_score(g[j])
			if sc > best_score:
				best = g[j]
				best_score = sc
		if g.size() > 1:
			best["mergedCount"] = g.size()
			var maps: Array = []
			var names: Array = []
			for x in g:
				var d := x as Dictionary
				var m := int(d.get("sourceMapId", 0))
				if not maps.has(m):
					maps.append(m)
				var nm := str(d.get("name", "")).strip_edges()
				if not nm.is_empty() and nm != str(best.get("name", "")) and not names.has(nm):
					names.append(nm)
			best["mergedFromMaps"] = maps
			if not names.is_empty():
				best["mergedNames"] = names.slice(0, 20)
		# 原版有 30 多个怪 name 是空串，列表里显示成 "   #4008" 没法辨认，
		# 这里补个占位名（只是展厅 override 的展示名，不影响 data/compiled）。
		if str(best.get("name", "")).strip_edges().is_empty():
			best["name"] = "未命名-%s" % str(best.get("icon1", ""))
			best["placeholderName"] = true
		out.append(best)
	_dropped = dropped
	_raw_total = raw
	print("[showcase] 收集 %d 条（来自 %d 张地图），按「同 icon1 造型」合并掉 %d 条 → %d 个造型"
		% [raw, ids.size(), dropped, out.size()])
	return out


## 同组里挑「信息最全」的那条留下：有名字、有台词、有任务组、有商店的优先。
func _info_score(n: Dictionary) -> int:
	var s := 0
	if not str(n.get("name", "")).strip_edges().is_empty():
		s += 3
	if not str(n.get("talkDetail", "")).strip_edges().is_empty():
		s += 3
	if int(n.get("missionGroupID", 0)) > 0:
		s += 2
	if int(n.get("businessIcon", 0)) > 0:
		s += 2
	if int(n.get("npcType", 0)) != 0:
		s += 1
	if not str(n.get("welcome", "")).strip_edges().is_empty():
		s += 1
	return s


func _read_dict(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var text := FileAccess.get_file_as_string(path)
	if text.strip_edges().is_empty():
		return {}
	var v = JSON.parse_string(text)
	return v if v is Dictionary else {}


func _write_json(path: String, value) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		printerr("[showcase] 写不了 ", path, "：", FileAccess.get_open_error())
		return
	f.store_string(JSON.stringify(value, "  "))
	f.close()
