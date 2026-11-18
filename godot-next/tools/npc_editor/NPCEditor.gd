extends Node2D
## NPC 编辑器（第一版）
##   godot --path godot-next res://tools/npc_editor/NPCEditor.tscn
##
## 数据流：只读 data/overrides/npcs/<页id>.json（由 tools/build_npc_showcase.gd 生成），
## 编辑只改内存副本，Ctrl+S 才写盘（先备份到 _out/npc_backups/）。
## data/compiled/ 一个字节都不碰；NPC 交互逻辑不在本工具范围内。
##
## 操作：左键点选 / 拖动移动 · 中键平移 · 滚轮缩放 · F 适配 · Del 删除
##       Ctrl+Z 撤销 · Ctrl+S 保存 · Ctrl+F 搜索框

const GameData = preload("res://scripts/GameData.gd")
const SpriteComposer = preload("res://scripts/SpriteComposer.gd")
const NpcInfo = preload("res://scripts/NpcInfo.gd")

const PAGE_DIR := "res://data/overrides/npcs/"
const INDEX_PATH := PAGE_DIR + "index.json"
const BACKUP_DIR := "res://_out/npc_backups/"
const UNDO_LIMIT := 40
const PANEL_L := 348
const PANEL_R := 336
## model 造型在 NPC 场景里的缩放（WorldMap._draw_npc_sprite 用的就是 0.45）
const MODEL_SCALE := 0.45

@onready var world_map: Node2D = $MapRoot
@onready var overlay: Node2D = $Overlay
@onready var camera: Camera2D = $Camera2D
@onready var ui: CanvasLayer = $UI

var data = GameData.new()

var pages: Array = []
var page_id: int = 0
var npcs: Array = []            # 当前页（指向 _loaded[page_id]，原地改）
var sel: int = -1
var hover_index: int = -1
var show_names: bool = true
var show_cells: bool = true

var _loaded: Dictionary = {}    # page_id -> Array（每页一份内存副本，切页不丢改动）
var _dirty: Dictionary = {}     # page_id -> bool
var _undo: Array = []
var _syncing: bool = false
var _tex_cache: Dictionary = {}
var _list_map: Array = []

var _dragging: bool = false
var _drag_moved: bool = false
var _drag_off: Vector2 = Vector2.ZERO
var _panning: bool = false
var _pending_undo: bool = false
var _ui_ready: bool = false

# ---- UI 引用 ----
var page_option: OptionButton
var search_edit: LineEdit
var global_check: CheckBox
var type_filter: OptionButton
var name_check: CheckBox
var cell_check: CheckBox
var npc_list: ItemList
var info_label: Label
var status_label: Label
var name_edit: LineEdit
var icon_edit: LineEdit
var icon_label: Label
var preview_rect: TextureRect
var type_spin: SpinBox
var mission_spin: SpinBox
var business_spin: SpinBox
var dir_spin: SpinBox
var x_spin: SpinBox
var y_spin: SpinBox
var talk_edit: TextEdit
var welcome_edit: LineEdit
var src_label: Label
var battle_label: Label
var validate_dialog: AcceptDialog


func _ready() -> void:
	pages = data.npc_pages()
	world_map.data = data
	world_map.show_npcs = false
	world_map.show_names = false
	overlay.editor = self
	_build_ui()
	_ui_ready = true
	if pages.is_empty():
		_set_status("没有展厅数据：先跑 tools/build_npc_showcase.gd")
		return
	_populate_pages()
	load_page(int(pages[0].get("id", 0)))
	var want := OS.get_environment("WORLDOL_NPC_PAGE")
	if not want.is_empty():
		load_page(int(want))
	# 排查/截图用：WORLDOL_NPC_SELECT=<名字片段> 启动后自动选中第一个命中的条目，
	# 直接看右栏的战斗数值与合并来源。只选中，不改数据。
	var want_sel := OS.get_environment("WORLDOL_NPC_SELECT")
	if not want_sel.is_empty():
		for i in range(npcs.size()):
			if str(npcs[i].get("name", "")).find(want_sel) >= 0:
				_select(i, true)
				break
	_maybe_capture()


# ---------------------------------------------------------------- 视图工具

func view_zoom() -> float:
	return camera.zoom.x if camera != null else 1.0


func tile_size() -> Vector2:
	return Vector2(
		maxi(1, int(world_map.get("_tile_w"))),
		maxi(1, int(world_map.get("_tile_h"))))


func cell_size() -> Vector2:
	var p := _page_meta(page_id)
	var t := tile_size()
	return Vector2(
		float(int(p.get("cell_w_tiles", 9))) * t.x,
		float(int(p.get("cell_h_tiles", 6))) * t.y)


func npc_pos(n) -> Vector2:
	var t := tile_size()
	return Vector2((int(n.get("x", 0)) + 0.5) * t.x, (int(n.get("y", 0)) + 0.5) * t.y)


## 和 WorldMap._draw_npc_sprite 完全一致的矩形：
##   部件图 → position = pos + (-w/2, -h+8)，1:1 画
##   model  → centered=false + offset(-CANVAS_W/2, -ANCHOR_Y) + scale 0.45
func npc_rect(n) -> Rect2:
	var pos := npc_pos(n)
	var icon := str(n.get("icon1", ""))
	if bool(world_map.call("npc_is_fragment", icon)):
		var tex = npc_texture(n)
		if tex != null:
			var w := float(tex.get_width())
			var h := float(tex.get_height())
			return Rect2(pos + Vector2(-w * 0.5, -h + 8.0), Vector2(w, h))
	var size := Vector2(SpriteComposer.CANVAS_W, SpriteComposer.CANVAS_H) * MODEL_SCALE
	var origin := pos + Vector2(-SpriteComposer.CANVAS_W * 0.5, -SpriteComposer.ANCHOR_Y) * MODEL_SCALE
	return Rect2(origin, size)


func npc_texture(n) -> Texture2D:
	var icon := str(n.get("icon1", ""))
	if _tex_cache.has(icon):
		return _tex_cache[icon]
	var tex: Texture2D = world_map.call("npc_texture_for", icon)
	_tex_cache[icon] = tex
	return tex


func cell_rects() -> Array:
	var cs := cell_size()
	var p := _page_meta(page_id)
	var cols := int(p.get("cols", 20))
	var rows := int(p.get("rows", 15))
	var out: Array = []
	for r in range(rows):
		for c in range(cols):
			out.append(Rect2(c * cs.x, r * cs.y, cs.x, cs.y))
	return out


func _page_meta(id: int) -> Dictionary:
	for p in pages:
		if int(p.get("id", -1)) == id:
			return p
	return {}


# ---------------------------------------------------------------- 载入 / 刷新

func load_page(id: int, reset_sel: bool = true) -> void:
	if id <= 0:
		return
	page_id = id
	if not _loaded.has(id):
		_loaded[id] = data.get_entry("npcs", id).duplicate(true)
	npcs = _loaded[id]
	if reset_sel:
		sel = -1
		hover_index = -1
	world_map.call("load_map", id)
	world_map.call("set_show_npcs", false)
	world_map.call("set_show_names", false)
	_refresh_list()
	_sync_fields()
	_refresh_info()
	overlay.queue_redraw()
	focus_default()


## 默认视角：能看清造型即可（约 5 列 × 3 行），不要一上来就把 4320×2160 整图缩成一片雾。
## 想看全貌按 F（fit_view）。
func focus_default() -> void:
	var cs := cell_size()
	var vp := get_viewport_rect().size
	var usable := Vector2(maxf(200.0, vp.x - PANEL_L - PANEL_R), maxf(200.0, vp.y - 90.0))
	var z: float = minf(usable.x / (cs.x * 5.0), usable.y / (cs.y * 3.0))
	z = clampf(z, 0.1, 2.0)
	camera.zoom = Vector2(z, z)
	if not npcs.is_empty():
		camera.position = npc_pos(npcs[0]) + Vector2(cs.x * 2.0, cs.y)
	else:
		camera.position = cs * 2.0


func fit_view() -> void:
	var size: Vector2 = world_map.call("map_size")
	if size.x <= 0.0 or size.y <= 0.0:
		return
	var vp := get_viewport_rect().size
	var usable := Vector2(maxf(200.0, vp.x - PANEL_L - PANEL_R), maxf(200.0, vp.y - 90.0))
	var z: float = minf(usable.x / size.x, usable.y / size.y)
	camera.zoom = Vector2(z, z)
	camera.position = size * 0.5


func _refresh_info() -> void:
	var total := 0
	for p in pages:
		total += int(p.get("count", 0))
	var mark := " *" if _dirty.get(page_id, false) else ""
	info_label.text = "%s%s · 本页 %d 个 · 全部 %d 个 / %d 页" % [
		str(_page_meta(page_id).get("name", "")), mark, npcs.size(), total, pages.size()]


func _refresh_list() -> void:
	if npc_list == null:
		return
	_list_map = []
	npc_list.clear()
	var kw := search_edit.text.strip_edges().to_lower()
	var global := global_check != null and global_check.button_pressed and not kw.is_empty()
	if global:
		var hits := 0
		for p in pages:
			var pid := int(p.get("id", 0))
			var arr: Array = _loaded[pid] if _loaded.has(pid) else data.get_entry("npcs", pid)
			for i in range(arr.size()):
				if _match(arr[i], kw) and _pass_filter(arr[i]):
					npc_list.add_item("%d · %s%s" % [pid, str(arr[i].get("name", "")),
						_merge_suffix(arr[i])])
					_list_map.append({"page": pid, "index": i})
					hits += 1
					if hits >= 300:
						break
			if hits >= 300:
				break
	else:
		for i in range(npcs.size()):
			if _match(npcs[i], kw) and _pass_filter(npcs[i]):
				npc_list.add_item("%s   #%s%s" % [str(npcs[i].get("name", "")),
					str(npcs[i].get("icon1", "")), _merge_suffix(npcs[i])])
				_list_map.append({"page": page_id, "index": i})
	if sel >= 0 and sel < npcs.size() and not global:
		var row := -1
		for k in range(_list_map.size()):
			if int(_list_map[k].get("index", -1)) == sel and int(_list_map[k].get("page", -1)) == page_id:
				row = k
				break
		if row >= 0:
			npc_list.select(row)
			npc_list.ensure_current_is_visible()


func _match(n, kw: String) -> bool:
	if kw.is_empty():
		return true
	if not (n is Dictionary):
		return false
	return str(n.get("name", "")).to_lower().find(kw) >= 0 \
		or str(n.get("icon1", "")).find(kw) >= 0 \
		or str(n.get("sourceMapId", "")).find(kw) >= 0 \
		or str(n.get("npcId", "")).find(kw) >= 0 \
		or _match_merged(n, kw)


## 展厅按 icon1 去重后，很多原版名字被并进 mergedNames（如 15045 那条并掉了
## 「大剑食人魔」「绿魔」「食人魔」…）。搜这些旧名字也要能定位到对应造型，
## 否则用户按记忆里的怪名根本搜不到。
func _match_merged(n: Dictionary, kw: String) -> bool:
	for nm in (n.get("mergedNames", []) as Array):
		if str(nm).to_lower().find(kw) >= 0:
			return true
	return false


## 列表项后缀：这一条合并了 N 条同造型 NPC 时显示「+N-1」，
## 让用户一眼看出「我改的是这一套造型的全部使用者」。
func _merge_suffix(n: Dictionary) -> String:
	var mc := int(n.get("mergedCount", 0))
	return "" if mc <= 1 else "   +%d" % (mc - 1)


## 左栏类型筛选（和搜索是「与」关系）。
func _pass_filter(n: Dictionary) -> bool:
	if type_filter == null or type_filter.selected <= 0:
		return true
	var mode := str(type_filter.get_item_metadata(type_filter.selected))
	if mode == "all":
		return true
	if mode == "battle":
		return not NpcInfo.battle_ids(n).is_empty()
	if mode == "nobattle":
		return NpcInfo.battle_ids(n).is_empty()
	return str(int(n.get("npcType", -1))) == mode


# ---------------------------------------------------------------- 选择 / 字段

func _select(idx: int, focus: bool = false) -> void:
	sel = idx
	_sync_fields()
	_refresh_list()
	if focus:
		_focus_selected()
	overlay.queue_redraw()


func _focus_selected() -> void:
	if sel < 0 or sel >= npcs.size():
		return
	var pos := npc_pos(npcs[sel])
	camera.position = pos
	world_map.queue_redraw()


func _sync_fields() -> void:
	if not _ui_ready:
		return
	var has := sel >= 0 and sel < npcs.size()
	for w in [name_edit, icon_edit, type_spin, mission_spin, business_spin,
			dir_spin, x_spin, y_spin, talk_edit, welcome_edit]:
		if w != null:
			w.editable = has if (w is LineEdit or w is TextEdit) else true
			w.mouse_filter = Control.MOUSE_FILTER_STOP if has else Control.MOUSE_FILTER_IGNORE
	if not has:
		_syncing = true
		name_edit.text = ""
		icon_edit.text = ""
		talk_edit.text = ""
		welcome_edit.text = ""
		icon_label.text = "（未选中）"
		preview_rect.texture = null
		src_label.text = ""
		battle_label.text = ""
		_syncing = false
		return
	var n: Dictionary = npcs[sel]
	_syncing = true
	name_edit.text = str(n.get("name", ""))
	icon_edit.text = str(n.get("icon1", ""))
	type_spin.value = int(n.get("npcType", 0))
	mission_spin.value = int(n.get("missionGroupID", 0))
	business_spin.value = int(n.get("businessIcon", 0))
	dir_spin.value = int(n.get("direction", 0))
	x_spin.value = int(n.get("x", 0))
	y_spin.value = int(n.get("y", 0))
	talk_edit.text = str(n.get("talkDetail", ""))
	welcome_edit.text = str(n.get("welcome", ""))
	src_label.text = "来源：地图 %d 第 %d 条 · npcId %d" % [
		int(n.get("sourceMapId", 0)), int(n.get("sourceIndex", 0)), int(n.get("npcId", 0))]
	# 展厅按 icon1 去重后，一个造型可能合并了原版几十条同名/异名 NPC。
	# 这里把「合并了几条、原来还叫过什么」显示出来，方便判断这个造型该扮演谁。
	var mc := int(n.get("mergedCount", 0))
	if mc > 1:
		# maps 里的数字经 JSON 解析是 float，直接 str() 会显示成 4.0 / 7.0，先转 int。
		var ml: Array = n.get("mergedFromMaps", [])
		var ms: Array = []
		for mv in ml:
			ms.append(str(int(mv)))
		var line := "\n合并 %d 条（造型同源，来自地图 %s）" % [mc, ", ".join(ms)]
		var mn: Array = n.get("mergedNames", [])
		if not mn.is_empty():
			line += "\n原名：%s" % ", ".join(mn.slice(0, 8))
			if mn.size() > 8:
				line += " 等 %d 个" % mn.size()
		src_label.text += line
	# 战斗数据：类型用原版 npcType 语义，编队数值从 battleID → group → monster 聚合。
	var nt := int(n.get("npcType", 0))
	var bl := NpcInfo.summary_line(data, n)
	if bl.is_empty():
		battle_label.text = "类型：%s(%d) · 无战斗编队" % [NpcInfo.type_name(nt), nt]
	else:
		battle_label.text = "类型：%s(%d)\n%s" % [NpcInfo.type_name(nt), nt, bl]
	_syncing = false
	_update_preview()


func _update_preview() -> void:
	var icon := icon_edit.text.strip_edges()
	var tex: Texture2D = world_map.call("npc_texture_for", icon)
	preview_rect.texture = tex
	if icon.is_empty() or icon == "0":
		icon_label.text = "图标：空（画红色叉）"
	elif bool(world_map.call("npc_uses_model", icon)):
		icon_label.text = "图标：整套造型 model %s" % icon
	elif bool(world_map.call("npc_is_fragment", icon)):
		icon_label.text = "图标：部件图 %s（兜底，非 NPC 常态）" % icon
	else:
		icon_label.text = "图标：%s 不存在" % icon


func _apply(key: String, value) -> void:
	if _syncing or sel < 0 or sel >= npcs.size():
		return
	npcs[sel][key] = value
	_dirty[page_id] = true
	_refresh_info()
	if key == "name":
		_refresh_list()   # 列表跟着名字走，否则改完还得点一下才刷新
	if key == "npcType" and battle_label != null:
		var nt := int(value)
		var bl := NpcInfo.summary_line(data, npcs[sel])
		battle_label.text = ("类型：%s(%d) · 无战斗编队" % [NpcInfo.type_name(nt), nt]) \
			if bl.is_empty() else ("类型：%s(%d)\n%s" % [NpcInfo.type_name(nt), nt, bl])
	overlay.queue_redraw()


# ---------------------------------------------------------------- 编辑操作

func _push_undo(label: String) -> void:
	_undo.append({"page": page_id, "npcs": npcs.duplicate(true), "label": label})
	if _undo.size() > UNDO_LIMIT:
		_undo.pop_front()


func undo_last() -> void:
	if _undo.is_empty():
		_set_status("没有可撤销的操作")
		return
	var e: Dictionary = _undo.pop_back()
	var pid := int(e.get("page", page_id))
	_loaded[pid] = e.get("npcs", [])
	_dirty[pid] = true
	if pid != page_id:
		load_page(pid)
	npcs = _loaded[pid]
	sel = -1
	_refresh_list()
	_sync_fields()
	_refresh_info()
	overlay.queue_redraw()
	_set_status("已撤销：%s" % str(e.get("label", "")))


func add_npc() -> void:
	var cell := _free_cell()
	_push_undo("新增 NPC")
	var n := {
		"name": "新 NPC", "icon1": "", "npcType": 0, "missionGroupID": 0,
		"businessIcon": 0, "direction": 0, "talkDetail": "", "welcome": "",
		"x": cell.x, "y": cell.y, "mapId": 0, "npcId": 0, "sign": 0, "status": 3,
		"rangeX": 0, "rangeY": 0, "sourceMapId": 0, "sourceIndex": -1,
		"showcasePage": page_id, "showcaseSlot": -1,
	}
	npcs.append(n)
	_dirty[page_id] = true
	sel = npcs.size() - 1
	_refresh_list()
	_sync_fields()
	_refresh_info()
	_focus_selected()
	overlay.queue_redraw()
	_set_status("已新增（记得调图标）")


func duplicate_npc() -> void:
	if sel < 0 or sel >= npcs.size():
		return
	_push_undo("复制 NPC")
	var copy: Dictionary = npcs[sel].duplicate(true)
	var cell := _free_cell()
	copy["x"] = cell.x
	copy["y"] = cell.y
	copy["sourceIndex"] = -1
	copy["name"] = str(copy.get("name", "")) + " 副本"
	npcs.append(copy)
	_dirty[page_id] = true
	sel = npcs.size() - 1
	_refresh_list()
	_sync_fields()
	_refresh_info()
	_focus_selected()
	overlay.queue_redraw()
	_set_status("已复制")


func delete_selected() -> void:
	if sel < 0 or sel >= npcs.size():
		return
	_push_undo("删除 NPC")
	var nm := str(npcs[sel].get("name", ""))
	npcs.remove_at(sel)
	_dirty[page_id] = true
	sel = -1
	_refresh_list()
	_sync_fields()
	_refresh_info()
	overlay.queue_redraw()
	_set_status("已删除：%s" % nm)


func _free_cell() -> Vector2i:
	var used := {}
	for n in npcs:
		used["%d,%d" % [int(n.get("x", -1)), int(n.get("y", -1))]] = true
	var p := _page_meta(page_id)
	var cols := int(p.get("cols", 20))
	var rows := int(p.get("rows", 15))
	var cw := int(p.get("cell_w_tiles", 9))
	var ch := int(p.get("cell_h_tiles", 6))
	var ox := int(p.get("offset_x_tiles", 4))
	var oy := int(p.get("offset_y_tiles", 4))
	for r in range(rows):
		for c in range(cols):
			var gx := c * cw + ox
			var gy := r * ch + oy
			if not used.has("%d,%d" % [gx, gy]):
				return Vector2i(gx, gy)
	return Vector2i(ox, oy)


# ---------------------------------------------------------------- 校验 / 保存

func validate() -> String:
	var lines: Array = []
	var seen := {}
	var bad_icon := 0
	var empty_name := 0
	var oob := 0
	var clash := 0
	for n in npcs:
		var nm := str(n.get("name", "")).strip_edges()
		if nm.is_empty():
			empty_name += 1
		var icon := str(n.get("icon1", ""))
		if not icon.is_empty() and icon != "0" \
				and not bool(world_map.call("npc_uses_model", icon)) \
				and not bool(world_map.call("npc_is_fragment", icon)):
			bad_icon += 1
			if lines.size() < 12:
				lines.append("图标不存在：%s（%s）" % [icon, nm])
		var key := "%d,%d" % [int(n.get("x", 0)), int(n.get("y", 0))]
		if seen.has(key):
			clash += 1
			if lines.size() < 12:
				lines.append("坐标重叠：%s 与 %s" % [nm, seen[key]])
		seen[key] = nm
		var p := _page_meta(page_id)
		var maxc := int(p.get("cols", 20)) * int(p.get("cell_w_tiles", 4)) - 1
		var maxr := int(p.get("rows", 15)) * int(p.get("cell_h_tiles", 5)) - 1
		if int(n.get("x", 0)) < 0 or int(n.get("x", 0)) > maxc \
				or int(n.get("y", 0)) < 0 or int(n.get("y", 0)) > maxr:
			oob += 1
	var head := "本页 %d 个 · 空名字 %d · 图标缺失 %d · 越界 %d · 坐标重叠 %d" % [
		npcs.size(), empty_name, bad_icon, oob, clash]
	return head if lines.is_empty() else head + "\n" + "\n".join(lines)


func save_all() -> void:
	var written: Array = []
	for pid in _dirty.keys():
		if not _dirty[pid]:
			continue
		var arr: Array = _loaded.get(pid, [])
		var path := PAGE_DIR + str(pid) + ".json"
		if FileAccess.file_exists(path):
			if not DirAccess.dir_exists_absolute(ProjectSettings.globalize_path(BACKUP_DIR)):
				DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(BACKUP_DIR))
			var bak := BACKUP_DIR + str(pid) + ".json.bak"
			var src := FileAccess.get_file_as_string(path)
			var bf := FileAccess.open(bak, FileAccess.WRITE)
			if bf != null:
				bf.store_string(src)
				bf.close()
		var f := FileAccess.open(path, FileAccess.WRITE)
		if f == null:
			_set_status("写不了 %s（%d）" % [path, FileAccess.get_open_error()])
			return
		f.store_string(JSON.stringify(arr, "  "))
		f.close()
		_dirty[pid] = false
		written.append(pid)
	# 页清单里的 count 跟着改（新增/删除后要对）
	var idx := _read_index()
	if not idx.is_empty():
		var ps: Array = idx.get("pages", [])
		for p in ps:
			if not (p is Dictionary):
				continue
			var pid := int(p.get("id", 0))
			if _loaded.has(pid):
				p["count"] = (_loaded[pid] as Array).size()
		idx["pages"] = ps
		_write_json(INDEX_PATH, idx)
	data.reload_overrides()
	_refresh_info()
	_refresh_list()
	if written.is_empty():
		_set_status("没有改动需要保存")
	else:
		_set_status("已保存 %d 页：%s（原文件备份在 _out/npc_backups/）"
			% [written.size(), str(written)])


func _read_index() -> Dictionary:
	if not FileAccess.file_exists(INDEX_PATH):
		return {}
	var v = JSON.parse_string(FileAccess.get_file_as_string(INDEX_PATH))
	return v if v is Dictionary else {}


func _write_json(path: String, value) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return
	f.store_string(JSON.stringify(value, "  "))
	f.close()


func _set_status(text: String) -> void:
	if status_label != null:
		status_label.text = text


# ---------------------------------------------------------------- 输入

func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventMouse):
		return
	var mb := event as InputEventMouseButton
	if event is InputEventMouseButton:
		if mb.button_index == MOUSE_BUTTON_WHEEL_UP and mb.pressed:
			_zoom_at(1.15)
			return
		if mb.button_index == MOUSE_BUTTON_WHEEL_DOWN and mb.pressed:
			_zoom_at(1.0 / 1.15)
			return
		if mb.button_index == MOUSE_BUTTON_MIDDLE:
			_panning = mb.pressed
			return
		if mb.button_index == MOUSE_BUTTON_LEFT:
			var local := _to_world(mb.position)
			if mb.pressed:
				var hit := _hit(local)
				_select(hit)
				if hit >= 0:
					_dragging = true
					_drag_moved = false
					_pending_undo = true
					_drag_off = npc_pos(npcs[hit]) - local
			else:
				if _dragging and _drag_moved:
					_set_status("已移动：%s" % str(npcs[sel].get("name", "")) if sel >= 0 else "已移动")
				_dragging = false
			return
	var mm := event as InputEventMouseMotion
	if mm == null:
		return   # 右键等其它鼠标键：不处理，别再往下当移动事件解引用
	if _panning:
		camera.position -= mm.relative / camera.zoom
		return
	var local := _to_world(mm.position)
	if _dragging and sel >= 0 and sel < npcs.size():
		var t := tile_size()
		var target := local + _drag_off
		var gx := int(floor(target.x / t.x))
		var gy := int(floor(target.y / t.y))
		var p := _page_meta(page_id)
		gx = clampi(gx, 0, int(p.get("cols", 20)) * int(p.get("cell_w_tiles", 4)) - 1)
		gy = clampi(gy, 0, int(p.get("rows", 15)) * int(p.get("cell_h_tiles", 5)) - 1)
		if int(npcs[sel].get("x", 0)) != gx or int(npcs[sel].get("y", 0)) != gy:
			if _pending_undo:
				_push_undo("移动 NPC")
				_pending_undo = false
			npcs[sel]["x"] = gx
			npcs[sel]["y"] = gy
			_dirty[page_id] = true
			_syncing = true
			x_spin.value = gx
			y_spin.value = gy
			_syncing = false
			_drag_moved = true
			overlay.queue_redraw()
			return
	var h := _hit(local)
	if h != hover_index:
		hover_index = h
		overlay.queue_redraw()


func _to_world(screen_pos: Vector2) -> Vector2:
	var vp := get_viewport()
	return vp.get_canvas_transform().affine_inverse() * screen_pos


func _zoom_at(factor: float) -> void:
	var before := _to_world(get_viewport().get_mouse_position())
	camera.zoom = camera.zoom * factor
	camera.zoom = camera.zoom.clamp(Vector2(0.08, 0.08), Vector2(4.0, 4.0))
	var after := _to_world(get_viewport().get_mouse_position())
	camera.position += before - after


func _hit(local: Vector2) -> int:
	# 后画的盖住先画的，所以从后往前找
	for i in range(npcs.size() - 1, -1, -1):
		var r := npc_rect(npcs[i])
		var box := r.grow(6.0)
		if box.has_point(local):
			return i
	return -1


func _input(event: InputEvent) -> void:
	if not (event is InputEventKey) or not event.pressed or event.echo:
		return
	var k := event as InputEventKey
	var ctrl := k.ctrl_pressed
	match k.keycode:
		KEY_ESCAPE:
			sel = -1
			_sync_fields()
			overlay.queue_redraw()
		KEY_DELETE:
			delete_selected()
		KEY_S:
			if ctrl:
				save_all()
				get_viewport().set_input_as_handled()
		KEY_Z:
			if ctrl:
				undo_last()
				get_viewport().set_input_as_handled()
		KEY_F:
			if ctrl:
				search_edit.grab_focus()
			else:
				fit_view()
		KEY_N:
			if ctrl:
				add_npc()
		KEY_D:
			if ctrl:
				duplicate_npc()
		KEY_SLASH:
			_set_status("Ctrl+S 保存 · Ctrl+Z 撤销 · Del 删除 · F 适配 · 中键平移 · 滚轮缩放")
		_:
			return
	get_viewport().set_input_as_handled()


# ---------------------------------------------------------------- UI

func _build_ui() -> void:
	# 面板必须压在世界坐标的 NPC 造型之上：显式设层级 + 不透明底色，
	# 否则 Node2D 画的 300 个 NPC 会从面板缝里透出来（第一版就踩了）。
	ui.layer = 10
	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = Color(0.11, 0.12, 0.15, 0.97)
	panel_style.border_color = Color(0.28, 0.30, 0.36, 0.9)
	panel_style.set_border_width_all(1)
	panel_style.set_corner_radius_all(6)
	panel_style.set_content_margin_all(6)

	# ---- 顶部标题条（跨越，不挡地图操作区下缘）----
	var title := Label.new()
	title.text = "NPC 编辑器 · 第一版　（拖动摆放，Ctrl+S 写 data/overrides/npcs）"
	title.add_theme_font_size_override("font_size", 13)
	title.position = Vector2(PANEL_L + 16, 10)
	ui.add_child(title)

	# ---- 左栏 ----
	var left := PanelContainer.new()
	left.anchor_top = 0.0
	left.anchor_bottom = 1.0
	left.offset_left = 8
	left.offset_top = 8
	left.offset_right = 8 + PANEL_L - 16
	left.offset_bottom = -34
	ui.add_child(left)
	left.add_theme_stylebox_override("panel", panel_style)

	var lscroll := ScrollContainer.new()
	left.add_child(lscroll)
	var lv := VBoxContainer.new()
	lv.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	lv.add_theme_constant_override("separation", 6)
	lscroll.add_child(lv)

	lv.add_child(_label("展厅页"))
	page_option = OptionButton.new()
	page_option.item_selected.connect(func(i): load_page(int(pages[i].get("id", 0))))
	lv.add_child(page_option)

	search_edit = LineEdit.new()
	search_edit.placeholder_text = "搜索名字 / 图标 / 原地图 id（Ctrl+F）"
	search_edit.text_changed.connect(func(_t): _refresh_list())
	lv.add_child(search_edit)

	global_check = CheckBox.new()
	global_check.text = "全库搜索（跨 %d 页）" % pages.size()
	global_check.toggled.connect(func(_v): _refresh_list())
	lv.add_child(global_check)

	# 类型筛选：npcType 用原版语义（0 任务 / 1 怪物 / 2 商店 / 3 传送 / 5 战力 / 9 交易），
	# 另加「有战斗 / 无战斗」两项，直接按 battleID 是否配了编队来筛。
	type_filter = OptionButton.new()
	type_filter.add_item("全部类型")
	type_filter.set_item_metadata(0, "all")
	for t in [0, 1, 2, 3, 5, 9]:
		type_filter.add_item("%s(%d)" % [NpcInfo.type_name(t), t])
		type_filter.set_item_metadata(type_filter.item_count - 1, str(t))
	type_filter.add_item("有战斗编队")
	type_filter.set_item_metadata(type_filter.item_count - 1, "battle")
	type_filter.add_item("无战斗编队")
	type_filter.set_item_metadata(type_filter.item_count - 1, "nobattle")
	type_filter.item_selected.connect(func(_i): _refresh_list())
	lv.add_child(type_filter)

	info_label = Label.new()
	info_label.add_theme_font_size_override("font_size", 12)
	info_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	lv.add_child(info_label)

	var btns := HBoxContainer.new()
	btns.add_theme_constant_override("separation", 4)
	lv.add_child(btns)
	_add_button(btns, "保存", save_all, "Ctrl+S")
	_add_button(btns, "撤销", undo_last, "Ctrl+Z")
	_add_button(btns, "校验", func():
		validate_dialog.dialog_text = validate()
		validate_dialog.popup_centered(Vector2i(520, 260)))

	var btns2 := HBoxContainer.new()
	btns2.add_theme_constant_override("separation", 4)
	lv.add_child(btns2)
	_add_button(btns2, "新增", add_npc, "Ctrl+N")
	_add_button(btns2, "复制", duplicate_npc, "Ctrl+D")
	_add_button(btns2, "删除", delete_selected, "Del")

	var opts := HBoxContainer.new()
	opts.add_theme_constant_override("separation", 4)
	lv.add_child(opts)
	name_check = CheckBox.new()
	name_check.text = "名字"
	name_check.button_pressed = true
	name_check.toggled.connect(func(v):
		show_names = v
		overlay.queue_redraw())
	opts.add_child(name_check)
	cell_check = CheckBox.new()
	cell_check.text = "格子"
	cell_check.button_pressed = true
	cell_check.toggled.connect(func(v):
		show_cells = v
		overlay.queue_redraw())
	opts.add_child(cell_check)

	npc_list = ItemList.new()
	npc_list.custom_minimum_size.y = 420
	npc_list.size_flags_vertical = Control.SIZE_EXPAND_FILL
	npc_list.item_selected.connect(_on_list_selected)
	lv.add_child(npc_list)

	# ---- 右栏（属性）----
	var right := PanelContainer.new()
	right.anchor_left = 1.0
	right.anchor_right = 1.0
	right.anchor_top = 0.0
	right.anchor_bottom = 1.0
	right.offset_left = -PANEL_R
	right.offset_top = 8
	right.offset_right = -8
	right.offset_bottom = -34
	ui.add_child(right)
	right.add_theme_stylebox_override("panel", panel_style)

	var rscroll := ScrollContainer.new()
	right.add_child(rscroll)
	var rv := VBoxContainer.new()
	rv.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rv.add_theme_constant_override("separation", 6)
	rscroll.add_child(rv)

	rv.add_child(_h("属性（NPC 交互逻辑待设计，这里只存数据）"))
	name_edit = _field(rv, "名字", func(t): _apply("name", t))
	icon_edit = _field(rv, "icon1（外观编号）", func(t):
		_apply("icon1", t)
		_update_preview()
		overlay.queue_redraw())
	icon_label = _h("（未选中）")
	rv.add_child(icon_label)
	preview_rect = TextureRect.new()
	preview_rect.custom_minimum_size = Vector2(0, 96)
	preview_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	preview_rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	rv.add_child(preview_rect)

	# 战斗数据放在预览图下面（不放面板最底部）：选中怪就能直接看到几只/几级/多少血，
	# 铺图配难度时不用滚动。数据来自 NpcInfo：battleID → group → monster。
	battle_label = _h("")
	battle_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	battle_label.add_theme_color_override("font_color", Color(0.78, 0.84, 0.95))
	rv.add_child(battle_label)

	type_spin = _spin(rv, "npcType", 0, 20, func(v): _apply("npcType", int(v)))
	mission_spin = _spin(rv, "任务组 missionGroupID", 0, 999999, func(v): _apply("missionGroupID", int(v)))
	business_spin = _spin(rv, "商店图标 businessIcon", 0, 999999, func(v): _apply("businessIcon", int(v)))
	dir_spin = _spin(rv, "朝向 direction", 0, 7, func(v): _apply("direction", int(v)))
	x_spin = _spin(rv, "x（格）", 0, 400, func(v): _apply("x", int(v)))
	y_spin = _spin(rv, "y（格）", 0, 400, func(v): _apply("y", int(v)))

	rv.add_child(_h("对话（talkDetail，含 /cXXXXXX 颜色与 {1} 占位）"))
	talk_edit = TextEdit.new()
	talk_edit.custom_minimum_size.y = 120
	talk_edit.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	talk_edit.text_changed.connect(func(): _apply("talkDetail", talk_edit.text))
	rv.add_child(talk_edit)
	welcome_edit = _field(rv, "欢迎语 welcome", func(t): _apply("welcome", t))
	src_label = _h("")
	src_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	rv.add_child(src_label)

	# ---- 底部状态栏 ----
	status_label = Label.new()
	status_label.add_theme_font_size_override("font_size", 12)
	status_label.anchor_top = 1.0
	status_label.anchor_bottom = 1.0
	status_label.anchor_left = 0.0
	status_label.anchor_right = 1.0
	status_label.offset_left = PANEL_L + 16
	status_label.offset_right = -PANEL_R - 16
	status_label.offset_top = -26
	status_label.offset_bottom = -6
	status_label.text = "左键点选/拖动 · 中键平移 · 滚轮缩放 · F 适配 · Del 删除 · Ctrl+Z 撤销 · Ctrl+S 保存"
	ui.add_child(status_label)

	validate_dialog = AcceptDialog.new()
	validate_dialog.title = "校验结果"
	ui.add_child(validate_dialog)


func _populate_pages() -> void:
	page_option.clear()
	for p in pages:
		page_option.add_item("%d · %s（%d）" % [int(p.get("id", 0)),
			str(p.get("name", "")), int(p.get("count", 0))])


func _on_list_selected(idx: int) -> void:
	if idx < 0 or idx >= _list_map.size():
		return
	var e: Dictionary = _list_map[idx]
	var pid := int(e.get("page", page_id))
	if pid != page_id:
		load_page(pid, false)
	_select(int(e.get("index", -1)), true)


func _label(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 12)
	return l


func _h(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 12)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return l


func _add_button(parent: Control, text: String, cb: Callable, tip: String = "") -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.pressed.connect(cb)
	parent.add_child(b)
	return b


func _field(parent: Control, title: String, cb: Callable) -> LineEdit:
	parent.add_child(_label(title))
	var e := LineEdit.new()
	e.text_changed.connect(cb)
	parent.add_child(e)
	return e


func _spin(parent: Control, title: String, lo: float, hi: float, cb: Callable) -> SpinBox:
	parent.add_child(_label(title))
	var s := SpinBox.new()
	s.min_value = lo
	s.max_value = hi
	s.step = 1
	s.value_changed.connect(cb)
	parent.add_child(s)
	return s


func _maybe_capture() -> void:
	var shot := OS.get_environment("WORLDOL_CAPTURE")
	if shot.is_empty():
		return
	await get_tree().process_frame
	await get_tree().process_frame
	await get_tree().process_frame
	var img := get_viewport().get_texture().get_image()
	img.save_png("res://_out/" + shot)
	print("[capture] _out/", shot)
	get_tree().quit()
