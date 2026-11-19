extends SceneTree
## 资产闸门：确认「地图/角色/道具引用到的素材」是否都存在，缺了就在构建期失败。
##
## 和 verify_* 的区别：verify_* 验的是「逻辑对不对」，这个闸门验的是「素材齐不齐」。
## 为什么需要它：缺图在运行时是**静默跳过**的（少一块地面、少一个图标，不报错），
## 只能靠人眼发现。把这个检查放进提交流程，缺东西会当场红。
##
## 判定口径：
##   - 已知缺口（原版客户端本身就没有这些文件）登记在 data/asset_allowlist.json，
##     只告警不失败；数量变化会在输出里显示，避免缺口悄悄变大。
##   - **不在 allowlist 里的新缺口 → 退出码 1**，并打印「哪张图 / 哪个名字 / 影响几处」。
##   - tile 层额外检查「图块库是否过期」：切片图在、但 tileAtlas 索引里没有这个名字
##     说明改了素材没重跑 tools/build_map_tileset.gd。
##
## 用法：
##   Godot --headless --path godot-next --script res://tools/verify_assets.gd
##   Godot --headless --path godot-next --script res://tools/verify_assets.gd -- --update-allowlist
## 产物：_out/asset_report.json（全量明细，可供后续工具消费）

const MAP_DIR := "res://assets/map/"
const ATLAS_DIR := "res://assets/map_merged/"
const SLICE_DIR := "res://assets/map_slice/"
const FRAG_DIR := "res://assets/sprite_fragment/"
const MODEL_DIR := "res://assets/sprite_model/"
const UI_DIR := "res://assets/ui/"
const NPC_DIR := "res://data/compiled/npcs/"
const ITEM_DIR := "res://data/compiled/items/"
const FRAMES_INDEX := "res://data/compiled/mapFrames.json"
const TILE_INDEX := "res://data/compiled/tileAtlas.json"
const ICON_INDEX := "res://data/compiled/itemIcons.json"
const ALLOWLIST := "res://data/asset_allowlist.json"
const REPORT := "res://_out/asset_report.json"

var _frames_index: Dictionary = {}
var _tile_index: Dictionary = {}
var _icon_index: Dictionary = {}

var _tiles_missing: Dictionary = {}    # 名字 → {maps: {}, count}
var _tiles_stale: Dictionary = {}      # 名字 → {maps: {}, count}  切片在但图块库没有
var _objs_missing: Dictionary = {}
var _frag_missing: Dictionary = {}     # 图号 → {models: {}, count}
var _item_icon_missing: Array = []     # 道具 id
var _item_art_missing: Array = []      # 道具 icon 指向的部件/模型不存在
var _npc_icon_missing: Dictionary = {} # icon1 → {npcs: {}, count}
var _ui_atlas_missing: Array = []
var _maps_scanned := 0
var _items_scanned := 0
var _icons_ok := 0


func _initialize() -> void:
	var update := OS.get_cmdline_user_args().has("--update-allowlist")
	_frames_index = _read_json(FRAMES_INDEX)
	_tile_index = _read_index_sources(TILE_INDEX)
	_icon_index = _read_index_icons(ICON_INDEX)

	_scan_maps()
	_scan_models()
	_scan_items()
	_scan_npcs()
	_scan_ui()

	var current := {
		"tiles": _names_of(_tiles_missing),
		"objects": _names_of(_objs_missing),
		"fragments": _names_of(_frag_missing),
		"npc_icons": _names_of(_npc_icon_missing),
		"ui": _ui_atlas_missing.duplicate(),
		"item_icons": _item_icon_missing.map(func(v): return str(v)),
	}
	if update:
		_write_allowlist(current)
		print("[assets] 已写入 " + ALLOWLIST + "（基线：地块 %d / 物件 %d / 部件 %d）" % [
			current["tiles"].size(), current["objects"].size(), current["fragments"].size()])
		quit(0)
		return

	var allow := _read_allowlist()
	var blocking := {
		"tiles": _new_gaps(current["tiles"], allow.get("tiles", [])),
		"objects": _new_gaps(current["objects"], allow.get("objects", [])),
		"fragments": _new_gaps(current["fragments"], allow.get("fragments", [])),
		"npc_icons": _new_gaps(current["npc_icons"], allow.get("npc_icons", [])),
		"ui": _new_gaps(current["ui"], allow.get("ui", [])),
		"item_icons": _new_gaps(current["item_icons"], allow.get("item_icons", [])),
		"tiles_stale": _names_of(_tiles_stale),
	}
	var blocking_total := 0
	for k in blocking.keys():
		blocking_total += (blocking[k] as Array).size()

	_report(current, allow, blocking)
	_print_summary(current, allow, blocking)
	if blocking_total == 0:
		print("[assets] 通过：没有新增缺口")
		quit(0)
	else:
		printerr("[assets] 失败：%d 项（新增缺口 / 图块库过期，见上）" % blocking_total)
		quit(1)


# ---------------------------------------------------------------- 扫描

func _scan_maps() -> void:
	var dir := DirAccess.open(MAP_DIR)
	if dir == null:
		return
	var files: Array = []
	for f in dir.get_files():
		if f.ends_with(".json"):
			files.append(f)
	files.sort()
	for f in files:
		var map_id := int(f.trim_suffix(".json"))
		var j := _read_json(MAP_DIR + f)
		if j.is_empty():
			continue
		_maps_scanned += 1
		var atlas: Dictionary = {}
		var atlas_path := ATLAS_DIR + str(map_id) + ".json"
		if FileAccess.file_exists(atlas_path):
			var aj := _read_json(atlas_path)
			if aj.get("frames") is Dictionary:
				atlas = aj["frames"]
		# ---- tile 定义 ----
		for d in j.get("tiles", []):
			if not (d is Array) or d.size() < 4:
				continue
			var nm := str(d[0])
			if _has_slice(nm):
				# 切片在，但图块库没有这个名字 → 改了素材没重跑生成器
				if not _tile_index.is_empty() and not _tile_index.has(nm):
					_bump(_tiles_stale, nm, map_id)
				continue
			if atlas.has(nm) or _frames_index.has(nm):
				continue
			_bump(_tiles_missing, nm, map_id)
		# ---- 物件层（只查 kind=2 的贴图物件；kind 3/4 是模型 NPC）----
		for layer in j.get("layers", []):
			if not (layer is Dictionary):
				continue
			var arr = layer.get("obj", null)
			if not (arr is Array):
				continue
			for obj in arr:
				if not (obj is Array) or obj.size() < 6:
					continue
				if int(obj[0]) != 2:
					continue
				var nm := str(obj[1])
				if _has_slice(nm) or atlas.has(nm) or _frames_index.has(nm):
					continue
				_bump(_objs_missing, nm, map_id)


func _scan_models() -> void:
	var dir := DirAccess.open(MODEL_DIR)
	if dir == null:
		return
	var files: Array = []
	for f in dir.get_files():
		if f.ends_with(".json"):
			files.append(f)
	files.sort()
	for f in files:
		var model_id := int(f.trim_suffix(".json"))
		var j := _read_json(MODEL_DIR + f)
		for frag in j.get("files", []):
			var id := int(frag)
			if id <= 0:
				continue
			if FileAccess.file_exists(FRAG_DIR + str(id) + ".png"):
				continue
			_bump(_frag_missing, str(id), model_id)


func _scan_items() -> void:
	var dir := DirAccess.open(ITEM_DIR)
	if dir == null:
		return
	var files: Array = []
	for f in dir.get_files():
		if f.ends_with(".json"):
			files.append(f)
	files.sort()
	for f in files:
		var page = _read_json_array(ITEM_DIR + f)
		for it in page:
			if not (it is Dictionary):
				continue
			_items_scanned += 1
			var bag := int(it.get("bagIcon", -1))
			if bag >= 0 and not _icon_index.is_empty() and not _icon_index.has(str(bag)):
				_item_icon_missing.append(int(it.get("id", 0)))
			# 外观部件号：既不是碎片也不是模型，说明这件装备穿上会没外观
			var art := int(it.get("icon", 0))
			if art > 0:
				var has_frag := FileAccess.file_exists(FRAG_DIR + str(art) + ".png")
				var has_model := FileAccess.file_exists(MODEL_DIR + str(art) + ".json")
				if not (has_frag or has_model):
					_item_art_missing.append(int(it.get("id", 0)))


func _scan_npcs() -> void:
	var dir := DirAccess.open(NPC_DIR)
	if dir == null:
		return
	for f in dir.get_files():
		if not f.ends_with(".json"):
			continue
		var page = _read_json_array(NPC_DIR + f)
		for n in page:
			if not (n is Dictionary):
				continue
			var icon := str(n.get("icon1", "")).strip_edges()
			if icon.is_empty() or icon == "0":
				continue
			if FileAccess.file_exists(MODEL_DIR + icon + ".json"):
				continue
			if FileAccess.file_exists(FRAG_DIR + icon + ".png"):
				continue
			_bump(_npc_icon_missing, icon, str(n.get("npcId", f)))


func _scan_ui() -> void:
	# 索引里出现的每个图集都必须有 PNG，否则图标全是空白
	var atlases: Dictionary = {}
	for k in _icon_index.keys():
		var e = _icon_index[k]
		if e is Dictionary:
			atlases[str(e.get("atlas", ""))] = true
	for name in atlases.keys():
		if name.is_empty() or not FileAccess.file_exists(UI_DIR + name + ".png"):
			_ui_atlas_missing.append(name)
	# 真去造一遍纹理：PNG 在、但编号查不到或矩形越界，同样会显示成空白
	var ItemIcons = load("res://scripts/ItemIcons.gd")
	var bad := 0
	for k in _icon_index.keys():
		if ItemIcons.texture(int(k)) == null:
			bad += 1
			if _ui_atlas_missing.size() < 20:
				_ui_atlas_missing.append("icon:" + str(k))
	_icons_ok = int(_icon_index.size()) - bad


# ---------------------------------------------------------------- 工具

func _has_slice(name: String) -> bool:
	return FileAccess.file_exists(SLICE_DIR + name + ".png")


func _bump(target: Dictionary, name: String, owner) -> void:
	if not target.has(name):
		target[name] = {"owners": {}, "count": 0}
	target[name]["owners"][str(owner)] = true
	target[name]["count"] = int(target[name]["count"]) + 1


func _names_of(d: Dictionary) -> Array:
	var out: Array = d.keys()
	out.sort()
	return out


func _new_gaps(current: Array, allowed) -> Array:
	var allow_set := {}
	for a in allowed:
		allow_set[str(a)] = true
	var out: Array = []
	for c in current:
		if not allow_set.has(str(c)):
			out.append(str(c))
	return out


func _read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(path))
	return parsed if parsed is Dictionary else {}


func _read_json_array(path: String) -> Array:
	if not FileAccess.file_exists(path):
		return []
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(path))
	return parsed if parsed is Array else []


func _read_index_sources(path: String) -> Dictionary:
	var j := _read_json(path)
	return j.get("sources", {}) if j.get("sources") is Dictionary else {}


func _read_index_icons(path: String) -> Dictionary:
	var j := _read_json(path)
	return j.get("icons", {}) if j.get("icons") is Dictionary else {}


func _read_allowlist() -> Dictionary:
	return _read_json(ALLOWLIST)


func _write_allowlist(current: Dictionary) -> void:
	var payload := {
		"note": "已知缺口基线：原版客户端本身就没有这些文件，不视为回归。新增缺口会让 verify_assets 失败，确认后可用 --update-allowlist 更新基线。",
		"tiles": current["tiles"],
		"objects": current["objects"],
		"fragments": current["fragments"],
		"npc_icons": current["npc_icons"],
		"ui": current["ui"],
		"item_icons": current["item_icons"],
	}
	var f := FileAccess.open(ALLOWLIST, FileAccess.WRITE)
	if f == null:
		printerr("[assets] 写不了 " + ALLOWLIST)
		return
	f.store_string(JSON.stringify(payload, "\t"))
	f.close()


func _detail(d: Dictionary) -> Array:
	var out: Array = []
	var names := d.keys()
	names.sort()
	for n in names:
		var owners: Array = (d[n]["owners"] as Dictionary).keys()
		owners.sort()
		out.append({"name": n, "count": int(d[n]["count"]),
			"owners": owners.slice(0, 12), "owner_count": owners.size()})
	return out


func _report(current: Dictionary, allow: Dictionary, blocking: Dictionary) -> void:
	var out := {
		"generated": Time.get_datetime_string_from_system(),
		"maps_scanned": _maps_scanned,
		"items_scanned": _items_scanned,
		"current": {
			"tiles": _detail(_tiles_missing),
			"objects": _detail(_objs_missing),
			"fragments": _detail(_frag_missing),
			"npc_icons": _detail(_npc_icon_missing),
			"tiles_stale": _detail(_tiles_stale),
			"ui": _ui_atlas_missing,
			"item_icons": _item_icon_missing,
			"item_art": _item_art_missing,
		},
		"blocking": blocking,
	}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://_out"))
	var f := FileAccess.open(REPORT, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(out, "\t"))
		f.close()


func _print_summary(current: Dictionary, allow: Dictionary, blocking: Dictionary) -> void:
	print("[assets] 扫描：地图 %d 张 · 道具 %d 件 · UI 图标 %d 个（可生成纹理 %d 个）" % [
		_maps_scanned, _items_scanned, _icon_index.size(), _icons_ok])
	print("[assets] 地块缺图 %d 个名（基线 %d）· 物件缺图 %d 个名（基线 %d）· 部件缺图 %d 个号（基线 %d）" % [
		current["tiles"].size(), (allow.get("tiles", []) as Array).size(),
		current["objects"].size(), (allow.get("objects", []) as Array).size(),
		current["fragments"].size(), (allow.get("fragments", []) as Array).size()])
	if not _tiles_stale.is_empty():
		printerr("[assets] 图块库过期：%s（切片图存在但没进 TileSet，重跑 tools/build_map_tileset.gd）"
			% str(_names_of(_tiles_stale)))
	if not _item_art_missing.is_empty():
		print("[assets] 提示：%d 件道具的 icon 号既不是碎片也不是模型（穿上会没外观）" % _item_art_missing.size())
	for k in ["tiles", "objects", "fragments", "npc_icons", "ui", "item_icons"]:
		var gaps: Array = blocking.get(k, [])
		if gaps.is_empty():
			continue
		printerr("[assets] 新增缺口 %s：%s" % [k, str(gaps.slice(0, 20))])
	# 明细：新缺口具体影响到哪张图
	for k in ["tiles", "objects"]:
		var src: Dictionary = _tiles_missing if k == "tiles" else _objs_missing
		for name in blocking.get(k, []):
			if src.has(name):
				var owners: Array = (src[name]["owners"] as Dictionary).keys()
				owners.sort()
				printerr("    %s %s ← 地图 %s（共 %d 处）" % [
					k, name, str(owners.slice(0, 6)), int(src[name]["count"])])
