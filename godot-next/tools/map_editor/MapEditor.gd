extends Node2D
## 地图编辑器 · 第一版
##
## 直接读写 assets/map/<id>.json（运行时 load_map 读的同一份文件），保存后 F5 立刻生效，
## 不经过 TileSet、不需要重新导入 / 重新编译。
##
## 功能：按 id 或名字载入 294 张地图 · 图层列表 · tile 调色板画笔 · 阻挡画笔 ·
##       中键平移 / 滚轮缩放 / F 适配 · 撤销 50 步 · 原子保存 + 备份。
##
## 关键约定（详见 docs/地图编辑与重命名指南.md §4）：
##   - tile 索引 1 字节，255 = 空格，tileList 上限 255 条；
##   - layers[0] 在最上层，append 到末尾 = 最底层；
##   - blocks 每格 1 字节，目前只用 bit0（1 = 不可走）；
##   - 编辑器必须关掉 WorldMap.prefill_enabled，否则会看到运行时虚构的地面。

const GameData = preload("res://scripts/GameData.gd")

const MAP_DIR := "res://assets/map/"
const BACKUP_DIR := "res://_out/map_backups/"
const EMPTY_TILE := 255
const UNDO_LIMIT := 50
const PANEL_W := 360
const DEFAULT_MAP := 4

@onready var world_map: Node2D = $MapRoot
@onready var overlay: Node2D = $Overlay
@onready var camera: Camera2D = $Camera2D
@onready var ui: CanvasLayer = $UI

var data = GameData.new()
var map_ids: Array = []
var cfg: Dictionary = {}
var map_id: int = 0
var layer_index: int = -1
var brush_tile: int = EMPTY_TILE
var brush_mode: String = "tile"      # tile | block
var show_grid: bool = true
var show_blocks: bool = true
var dirty: bool = false
var hover_cell := Vector2i(-1, -1)

var _undo: Array = []
var _stroke: Dictionary = {}
var _painting: bool = false
var _erasing: bool = false
var _panning: bool = false
var _pending_map: int = -1
var _ui_ready: bool = false

# ---- 控件 ----
var map_option: OptionButton
var search_edit: LineEdit
var info_label: Label
var layer_list: ItemList
var palette_grid: GridContainer
var palette_scroll: ScrollContainer
var brush_label: Label
var status_label: Label
var save_button: Button
var undo_button: Button
var grid_check: CheckBox
var block_check: CheckBox
var mode_tile_btn: Button
var mode_block_btn: Button
var confirm_dialog: ConfirmationDialog
var _mode_group: ButtonGroup
var _palette_group: ButtonGroup
var _palette_buttons: Array = []


func _ready() -> void:
	# 编辑器里绝不允许补洞：补出来的是运行时幻觉，不是 JSON 里的真实地面。
	world_map.set("prefill_enabled", false)
	world_map.call("set_show_names", false)
	world_map.call("set_show_npcs", false)
	overlay.set("editor", self)
	camera.enabled = true
	camera.make_current()
	_build_ui()
	_fill_map_list("")
	var initial := DEFAULT_MAP
	if OS.has_environment("WORLDOL_MAP"):
		initial = int(OS.get_environment("WORLDOL_MAP"))
	if data.get_entry("worldMaps", initial).is_empty():
		initial = DEFAULT_MAP
	load_map(initial)


# ================================================================ 载入

func current_cfg() -> Dictionary:
	return cfg


func load_map(id: int) -> void:
	if not world_map.call("load_map", id):
		_set_status("无法载入地图 %d（没有视觉 JSON 也没有元数据）" % id, true)
		return
	map_id = id
	cfg = world_map.get("cfg")
	_undo.clear()
	_stroke.clear()
	_painting = false
	dirty = false
	brush_tile = EMPTY_TILE
	layer_index = _first_tile_layer()
	_rebuild_layers()
	_rebuild_palette()
	_select_option(id)
	_refresh_info()
	_refresh_brush_label()
	_refresh_undo_button()
	_refresh_title()
	zoom_to_fit()
	world_map.queue_redraw()
	overlay.queue_redraw()
	var nm := data.name_of("worldMaps", id)
	var synthetic := bool(cfg.get("__synthetic", false))
	_set_status("已载入 %d · %s%s" % [id, nm,
		"　（合成网格，只读）" if synthetic else ""], false)


func _first_tile_layer() -> int:
	var layers: Array = cfg.get("layers", [])
	for i in range(layers.size()):
		if layers[i] is Dictionary and int(layers[i].get("type", 0)) == 2:
			return i
	return -1


func _select_option(id: int) -> void:
	if map_option == null:
		return
	var idx := map_ids.find(id)
	if idx >= 0:
		map_option.select(idx)


# ================================================================ 视图

func view_zoom() -> float:
	return camera.zoom.x if camera != null else 1.0


func spawn_cell() -> Vector2i:
	if map_id <= 0:
		return Vector2i(-1, -1)
	var meta: Array = data.get_entry("worldMaps", map_id)
	if meta.is_empty():
		return Vector2i(-1, -1)
	var sp = meta[0].get("spawn", [])
	if not (sp is Array) or sp.size() < 2:
		return Vector2i(-1, -1)
	return Vector2i(int(sp[0]), int(sp[1]))


func zoom_to_fit() -> void:
	if cfg.is_empty():
		return
	var size: Vector2 = world_map.call("map_size")
	var vp := get_viewport_rect().size
	var avail := Vector2(maxf(vp.x - float(PANEL_W), 96.0), maxf(vp.y - 24.0, 96.0))
	var s := minf(avail.x / maxf(size.x, 1.0), avail.y / maxf(size.y, 1.0))
	s = clampf(s, 0.05, 4.0)
	camera.zoom = Vector2(s, s)
	# 让地图落在左侧面板右边那块可见区域的中心。
	camera.position = size * 0.5 - Vector2(float(PANEL_W) * 0.5 / s, 0.0)
	overlay.queue_redraw()


func _screen_to_world(screen: Vector2) -> Vector2:
	var vp := get_viewport_rect().size
	return camera.position + (screen - vp * 0.5) / camera.zoom


func _zoom_at(factor: float, screen: Vector2) -> void:
	var before := _screen_to_world(screen)
	var z := clampf(camera.zoom.x * factor, 0.05, 8.0)
	camera.zoom = Vector2(z, z)
	var after := _screen_to_world(screen)
	camera.position += before - after
	overlay.queue_redraw()


func _refresh_hover(screen: Vector2) -> void:
	if cfg.is_empty():
		return
	var world := _screen_to_world(screen)
	var tw := maxi(1, int(cfg.get("tW", 24)))
	var th := maxi(1, int(cfg.get("tH", 24)))
	var cell := Vector2i(int(floor(world.x / float(tw))), int(floor(world.y / float(th))))
	if cell == hover_cell:
		return
	hover_cell = cell
	overlay.queue_redraw()


func _paint_at_mouse() -> void:
	var world := get_global_mouse_position()
	var tw := maxi(1, int(cfg.get("tW", 24)))
	var th := maxi(1, int(cfg.get("tH", 24)))
	_paint_cell(Vector2i(int(floor(world.x / float(tw))),
		int(floor(world.y / float(th)))), _erasing)


# ================================================================ 编辑

func is_erasing() -> bool:
	return _erasing


func set_brush_mode(mode: String) -> void:
	brush_mode = mode
	_refresh_mode_buttons()
	_refresh_brush_label()
	overlay.queue_redraw()


func set_brush_tile(index: int) -> void:
	brush_tile = index
	brush_mode = "tile"
	_refresh_mode_buttons()
	_refresh_brush_label()
	_highlight_palette(index)
	overlay.queue_redraw()


func select_layer(index: int) -> void:
	layer_index = index
	if layer_list != null and index >= 0 and index < layer_list.item_count:
		layer_list.select(index)
	_on_layer_selected(index)


func begin_stroke(erase: bool = false) -> void:
	_painting = true
	_erasing = erase
	_stroke = {}


func end_stroke() -> void:
	_painting = false
	if _stroke.is_empty():
		return
	_stroke["map"] = map_id
	_undo.append(_stroke)
	_stroke = {}
	while _undo.size() > UNDO_LIMIT:
		_undo.pop_front()
	if not dirty:
		dirty = true
		_refresh_title()
	_refresh_undo_button()


func paint_cell(col: int, row: int) -> void:
	_paint_cell(Vector2i(col, row), _erasing)


func undo_count() -> int:
	return _undo.size()


func _record_undo(kind: String, source: Array, layer: int = -1) -> void:
	if not _stroke.is_empty():
		return
	_stroke = {"kind": kind, "layer": layer, "before": source.duplicate()}


func _paint_cell(cell: Vector2i, erase: bool) -> void:
	if cfg.is_empty():
		return
	var tw := maxi(1, int(cfg.get("tW", 24)))
	var th := maxi(1, int(cfg.get("tH", 24)))
	var cols := int(cfg.get("mW", 0)) / tw
	var rows := int(cfg.get("mH", 0)) / th
	if cols <= 0 or rows <= 0:
		return
	if cell.x < 0 or cell.y < 0 or cell.x >= cols or cell.y >= rows:
		return
	if brush_mode == "block":
		_paint_block(cell, cols, rows, erase)
	else:
		_paint_tile(cell, cols, rows, erase)


func _paint_tile(cell: Vector2i, cols: int, rows: int, erase: bool) -> void:
	var layers: Array = cfg.get("layers", [])
	if layer_index < 0 or layer_index >= layers.size():
		return
	var layer = layers[layer_index]
	if not (layer is Dictionary) or int(layer.get("type", 0)) != 2:
		return
	var data_arr = layer.get("data", [])
	if not (data_arr is Array) or data_arr.size() < cols * rows:
		return
	var index := cell.y * cols + cell.x
	var want := EMPTY_TILE if erase else brush_tile
	if int(data_arr[index]) == want:
		return
	_record_undo("tile", data_arr, layer_index)
	data_arr[index] = want
	world_map.queue_redraw()
	overlay.queue_redraw()


## blocks 可能整个键都不存在（如 450 号图），也可能比格子数短。
## 画阻挡前先补 0（0 = 可走，不改变原有行为），并让 WorldMap 指向新数组。
func _ensure_blocks(cols: int, rows: int) -> Array:
	var cells := cols * rows
	var blocks = cfg.get("blocks", null)
	if not (blocks is Array):
		blocks = []
		cfg["blocks"] = blocks
	if blocks.size() < cells:
		_record_undo("block", blocks)
		while blocks.size() < cells:
			blocks.append(0)
	world_map.set("_blocks", blocks)
	return blocks


func _paint_block(cell: Vector2i, cols: int, rows: int, erase: bool) -> void:
	var blocks := _ensure_blocks(cols, rows)
	var index := cell.y * cols + cell.x
	if index < 0 or index >= blocks.size():
		return
	var cur := int(blocks[index])
	var want := (cur & 0xFE) if erase else (cur | 1)
	if want == cur:
		return
	_record_undo("block", blocks)
	blocks[index] = want
	world_map.queue_redraw()
	overlay.queue_redraw()


func undo_last() -> void:
	if _undo.is_empty():
		_set_status("没有可撤销的操作", false)
		return
	var entry: Dictionary = _undo.pop_back()
	var before: Array = entry.get("before", [])
	var kind := str(entry.get("kind", ""))
	if kind == "tile":
		var li := int(entry.get("layer", -1))
		var layers: Array = cfg.get("layers", [])
		if li >= 0 and li < layers.size():
			var data_arr = layers[li].get("data", [])
			if data_arr is Array:
				# 原地恢复：WorldMap 持有的是同一个数组引用，不能整体替换。
				data_arr.clear()
				data_arr.append_array(before)
	elif kind == "block":
		var blocks = cfg.get("blocks", null)
		if not (blocks is Array):
			blocks = []
			cfg["blocks"] = blocks
		blocks.clear()
		blocks.append_array(before)
		world_map.set("_blocks", blocks)
	dirty = true
	world_map.queue_redraw()
	overlay.queue_redraw()
	_refresh_undo_button()
	_refresh_title()
	_set_status("已撤销一步（还可撤销 %d 步）" % _undo.size(), false)


# ================================================================ 保存

## 把 JSON 解析出来的 float 整数规范化回 int，否则文件会被写成 960.0。
func normalize_value(value):
	if value is float:
		if is_finite(value) and absf(value - roundf(value)) < 0.000001:
			return int(roundf(value))
		return value
	if value is Array:
		var out_arr: Array = []
		out_arr.resize(value.size())
		for i in range(value.size()):
			out_arr[i] = normalize_value(value[i])
		return out_arr
	if value is Dictionary:
		var out_dict: Dictionary = {}
		for k in value.keys():
			out_dict[k] = normalize_value(value[k])
		return out_dict
	return value


## 序列化成与原文件同风格的紧凑单行 JSON（键顺序保持解析时的顺序）。
func map_json_text() -> String:
	return JSON.stringify(normalize_value(cfg), "", false)


func save_map() -> bool:
	if cfg.is_empty():
		_set_status("没有载入地图，无法保存", true)
		return false
	if bool(cfg.get("__synthetic", false)):
		_set_status("保存中止：这张图是「合成网格」（没有 assets/map/%d.json），第一版不支持保存" % map_id, true)
		return false

	var tw := maxi(1, int(cfg.get("tW", 24)))
	var th := maxi(1, int(cfg.get("tH", 24)))
	var mw := int(cfg.get("mW", 0))
	var mh := int(cfg.get("mH", 0))
	if mw <= 0 or mh <= 0 or mw % tw != 0 or mh % th != 0:
		_set_status("保存中止：mW/mH 必须是 tW/tH 的整数倍（%d×%d / %d×%d）" % [mw, mh, tw, th], true)
		return false
	var cols := mw / tw
	var rows := mh / th
	var cells := cols * rows

	# ---- 存盘前校验（硬错误 → 不写文件） ----
	var problems: Array = []
	var tile_list: Array = world_map.get("_tile_list")
	if tile_list.size() > 255:
		problems.append("tileList = %d 条，超过 255 上限" % tile_list.size())
	var layers: Array = cfg.get("layers", [])
	for i in range(layers.size()):
		var layer = layers[i]
		if not (layer is Dictionary) or int(layer.get("type", 0)) != 2:
			continue
		var data_arr = layer.get("data", [])
		if not (data_arr is Array) or data_arr.size() != cells:
			problems.append("图层 %d 的 data 长度 %d，应为 %d" % [
				i, (data_arr as Array).size() if data_arr is Array else -1, cells])
	var blocks = cfg.get("blocks", null)
	if blocks is Array and blocks.size() > cells:
		problems.append("blocks 长度 %d，超过格子数 %d" % [blocks.size(), cells])
	if not problems.is_empty():
		_set_status("保存中止：\n" + "\n".join(problems), true)
		return false

	# ---- blocks 缺键 / 过短：补 0，不改变可走性 ----
	var notes: Array = []
	if blocks is Array and blocks.size() > 0 and blocks.size() < cells:
		var old_n: int = blocks.size()
		while blocks.size() < cells:
			blocks.append(0)
		world_map.set("_blocks", blocks)
		notes.append("blocks 从 %d 补到 %d（新格按可走处理）" % [old_n, cells])

	# ---- 写临时文件 → 备份原文件 → 覆盖 ----
	var target := MAP_DIR + str(map_id) + ".json"
	var abs_target := ProjectSettings.globalize_path(target)
	var abs_tmp := abs_target + ".tmp"
	var abs_backup_dir := ProjectSettings.globalize_path(BACKUP_DIR)
	var abs_backup := abs_backup_dir + str(map_id) + ".json.bak"

	var err := _write_text(abs_tmp, map_json_text())
	if err != OK:
		_set_status("保存失败：写临时文件出错（%d）" % err, true)
		return false
	if FileAccess.file_exists(target):
		DirAccess.make_dir_recursive_absolute(abs_backup_dir)
		var berr := DirAccess.copy_absolute(abs_target, abs_backup)
		if berr != OK:
			DirAccess.remove_absolute(abs_tmp)
			_set_status("保存失败：备份原文件出错（%d）" % berr, true)
			return false
	var cerr := DirAccess.copy_absolute(abs_tmp, abs_target)
	DirAccess.remove_absolute(abs_tmp)
	if cerr != OK:
		_set_status("保存失败：覆盖目标文件出错（%d）" % cerr, true)
		return false

	dirty = false
	_refresh_title()
	var msg := "已保存 %s · %d 字节" % [target, FileAccess.get_file_as_string(target).length()]
	if FileAccess.file_exists(BACKUP_DIR + str(map_id) + ".json.bak"):
		msg += "\n备份：%s" % (BACKUP_DIR + str(map_id) + ".json.bak")
	if not notes.is_empty():
		msg += "\n" + "\n".join(notes)
	_set_status(msg, false)
	print("[map_editor] ", msg.replace("\n", " "))
	return true


func _write_text(abs_path: String, text: String) -> int:
	var f := FileAccess.open(abs_path, FileAccess.WRITE)
	if f == null:
		return FileAccess.get_open_error()
	f.store_string(text)
	f.close()
	return OK


# ================================================================ 界面

func _build_ui() -> void:
	var root := Control.new()
	root.name = "Root"
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(root)

	var panel := PanelContainer.new()
	panel.name = "Panel"
	panel.anchor_top = 0.0
	panel.anchor_bottom = 1.0
	panel.offset_left = 0.0
	panel.offset_top = 0.0
	panel.offset_right = float(PANEL_W)
	panel.offset_bottom = 0.0
	root.add_child(panel)

	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 10)
	panel.add_child(margin)

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	margin.add_child(box)

	var title := Label.new()
	title.text = "地图编辑器 · 第一版"
	title.add_theme_font_size_override("font_size", 17)
	box.add_child(title)

	var hint := Label.new()
	hint.text = "中键平移 · 滚轮缩放 · F 适配\n左键画 / 右键擦 · Ctrl+Z 撤销 · Ctrl+S 保存"
	hint.add_theme_font_size_override("font_size", 11)
	hint.add_theme_color_override("font_color", Color(0.68, 0.72, 0.78))
	box.add_child(hint)

	search_edit = LineEdit.new()
	search_edit.placeholder_text = "搜索地图名 / id"
	search_edit.text_changed.connect(_on_search_changed)
	box.add_child(search_edit)

	map_option = OptionButton.new()
	map_option.item_selected.connect(_on_map_option)
	box.add_child(map_option)

	info_label = Label.new()
	info_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	info_label.add_theme_font_size_override("font_size", 12)
	box.add_child(info_label)

	box.add_child(HSeparator.new())

	var layer_title := Label.new()
	layer_title.text = "图层（灰 = 非地块层）"
	layer_title.add_theme_font_size_override("font_size", 12)
	box.add_child(layer_title)

	layer_list = ItemList.new()
	layer_list.custom_minimum_size = Vector2(0, 108)
	layer_list.item_selected.connect(_on_layer_selected)
	box.add_child(layer_list)

	box.add_child(HSeparator.new())

	_palette_group = ButtonGroup.new()
	_mode_group = ButtonGroup.new()
	mode_tile_btn = Button.new()
	mode_tile_btn.text = "地块画笔 (T)"
	mode_tile_btn.toggle_mode = true
	mode_tile_btn.button_group = _mode_group
	mode_tile_btn.focus_mode = Control.FOCUS_NONE
	mode_tile_btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	mode_tile_btn.pressed.connect(func(): set_brush_mode("tile"))
	mode_block_btn = Button.new()
	mode_block_btn.text = "阻挡画笔 (B)"
	mode_block_btn.toggle_mode = true
	mode_block_btn.button_group = _mode_group
	mode_block_btn.focus_mode = Control.FOCUS_NONE
	mode_block_btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	mode_block_btn.pressed.connect(func(): set_brush_mode("block"))
	var mode_row := HBoxContainer.new()
	mode_row.add_theme_constant_override("separation", 6)
	mode_row.add_child(mode_tile_btn)
	mode_row.add_child(mode_block_btn)
	box.add_child(mode_row)

	var check_row := HBoxContainer.new()
	check_row.add_theme_constant_override("separation", 12)
	grid_check = CheckBox.new()
	grid_check.text = "格线"
	grid_check.button_pressed = true
	grid_check.focus_mode = Control.FOCUS_NONE
	grid_check.toggled.connect(func(v): show_grid = v; overlay.queue_redraw())
	block_check = CheckBox.new()
	block_check.text = "阻挡"
	block_check.button_pressed = true
	block_check.focus_mode = Control.FOCUS_NONE
	block_check.toggled.connect(func(v): show_blocks = v; overlay.queue_redraw())
	check_row.add_child(grid_check)
	check_row.add_child(block_check)
	box.add_child(check_row)

	brush_label = Label.new()
	brush_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	brush_label.add_theme_font_size_override("font_size", 12)
	box.add_child(brush_label)

	palette_scroll = ScrollContainer.new()
	palette_scroll.custom_minimum_size = Vector2(0, 250)
	palette_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	palette_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	box.add_child(palette_scroll)

	palette_grid = GridContainer.new()
	palette_grid.columns = 9
	palette_grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	palette_scroll.add_child(palette_grid)

	var action_row := HBoxContainer.new()
	action_row.add_theme_constant_override("separation", 6)
	undo_button = Button.new()
	undo_button.text = "撤销 (Ctrl+Z)"
	undo_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	undo_button.focus_mode = Control.FOCUS_NONE
	undo_button.disabled = true
	undo_button.pressed.connect(undo_last)
	save_button = Button.new()
	save_button.text = "保存 (Ctrl+S)"
	save_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	save_button.focus_mode = Control.FOCUS_NONE
	save_button.pressed.connect(save_map)
	var reload_button := Button.new()
	reload_button.text = "重载"
	reload_button.focus_mode = Control.FOCUS_NONE
	reload_button.pressed.connect(func(): _request_load(map_id))
	action_row.add_child(undo_button)
	action_row.add_child(save_button)
	action_row.add_child(reload_button)
	box.add_child(action_row)

	status_label = Label.new()
	status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	status_label.custom_minimum_size = Vector2(0, 54)
	status_label.add_theme_font_size_override("font_size", 12)
	box.add_child(status_label)

	confirm_dialog = ConfirmationDialog.new()
	confirm_dialog.title = "未保存的修改"
	confirm_dialog.confirmed.connect(_on_confirm_discard)
	ui.add_child(confirm_dialog)

	_ui_ready = true


func _fill_map_list(keyword: String) -> void:
	if map_option == null:
		return
	var kw := keyword.strip_edges().to_lower()
	map_ids.clear()
	map_option.clear()
	for id in data.ids("worldMaps"):
		var nid := int(id)
		var nm := data.name_of("worldMaps", nid)
		if not kw.is_empty() and str(nid).find(kw) < 0 and nm.to_lower().find(kw) < 0:
			continue
		map_ids.append(nid)
		map_option.add_item("%d · %s" % [nid, nm])
	_select_option(map_id)


func _on_search_changed(text: String) -> void:
	_fill_map_list(text)


func _on_map_option(index: int) -> void:
	if index < 0 or index >= map_ids.size():
		return
	_request_load(int(map_ids[index]))


func _request_load(id: int) -> void:
	if id <= 0:
		return
	if dirty and id != map_id:
		_pending_map = id
		confirm_dialog.dialog_text = "地图 %d 有未保存的修改，确定放弃并切换到 %d 吗？" % [map_id, id]
		confirm_dialog.popup_centered()
		return
	load_map(id)


func _on_confirm_discard() -> void:
	if _pending_map > 0:
		var target := _pending_map
		_pending_map = -1
		load_map(target)


func _rebuild_layers() -> void:
	if layer_list == null:
		return
	layer_list.clear()
	var layers: Array = cfg.get("layers", [])
	for i in range(layers.size()):
		var layer = layers[i]
		if not (layer is Dictionary):
			continue
		var kind := int(layer.get("type", 0))
		var text := "%d · %s" % [i, _layer_kind(kind)]
		if kind == 2:
			text += " · %d 格" % (layer.get("data", []) as Array).size()
		else:
			text += " · %d 物件" % (layer.get("obj", []) as Array).size()
		layer_list.add_item(text)
		if kind != 2:
			layer_list.set_item_custom_fg_color(i, Color(0.62, 0.64, 0.70))
	if layer_index >= 0 and layer_index < layer_list.item_count:
		layer_list.select(layer_index)


func _layer_kind(kind: int) -> String:
	match kind:
		2:
			return "地块层"
		3:
			return "物件层"
		4:
			return "角色层"
	return "类型 %d" % kind


func _on_layer_selected(index: int) -> void:
	layer_index = index
	var layers: Array = cfg.get("layers", [])
	if index < 0 or index >= layers.size():
		return
	if int(layers[index].get("type", 0)) != 2:
		_set_status("图层 %d 是物件/角色层：可以查看，但不能用 tile 画笔" % index, false)
	else:
		_set_status("正在编辑地块图层 %d" % index, false)
	overlay.queue_redraw()


func _rebuild_palette() -> void:
	if palette_grid == null:
		return
	for child in palette_grid.get_children():
		palette_grid.remove_child(child)
		child.queue_free()
	_palette_buttons.clear()
	var tile_list: Array = world_map.get("_tile_list")
	var empty_btn := _make_palette_button(null, EMPTY_TILE, "空 / 擦除（写 255）")
	palette_grid.add_child(empty_btn)
	for i in range(tile_list.size()):
		var t: Dictionary = tile_list[i]
		var tex := _tile_texture(t)
		var tip := "%d · %s [%d,%d]" % [i, str(t.get("src", "")),
			int(t.get("col", 0)), int(t.get("row", 0))]
		var btn := _make_palette_button(tex, i, tip)
		palette_grid.add_child(btn)
	_highlight_palette(brush_tile)


func _make_palette_button(tex: Texture2D, index: int, tip: String) -> Button:
	var btn := Button.new()
	btn.custom_minimum_size = Vector2(34, 34)
	btn.tooltip_text = tip
	btn.focus_mode = Control.FOCUS_NONE
	btn.toggle_mode = true
	btn.button_group = _palette_group
	btn.set_meta("tile", index)
	if tex == null:
		btn.text = "空" if index == EMPTY_TILE else "?"
		btn.add_theme_font_size_override("font_size", 11)
	else:
		btn.icon = tex
		btn.expand_icon = true
	btn.pressed.connect(func(): set_brush_tile(index))
	_palette_buttons.append(btn)
	return btn


## 与 WorldMap._draw 完全一致的取子帧方式：图集比一个格子大时按 col/row 裁。
func _tile_texture(t: Dictionary) -> Texture2D:
	var res: Dictionary = world_map.call("_resolve", str(t.get("src", "")), true)
	if res.is_empty():
		return null
	var tex: Texture2D = res.get("texture")
	if tex == null:
		return null
	var region: Rect2 = res.get("region")
	var tw := maxi(1, int(cfg.get("tW", 24)))
	var th := maxi(1, int(cfg.get("tH", 24)))
	var crop_x := region.size.x > float(tw)
	var crop_y := region.size.y > float(th)
	var r := Rect2(
		region.position.x + (int(t.get("col", 0)) * tw if crop_x else 0),
		region.position.y + (int(t.get("row", 0)) * th if crop_y else 0),
		float(tw) if crop_x else region.size.x,
		float(th) if crop_y else region.size.y)
	var at := AtlasTexture.new()
	at.atlas = tex
	at.region = r
	return at


func _highlight_palette(index: int) -> void:
	for btn in _palette_buttons:
		if btn == null or not is_instance_valid(btn):
			continue
		if int(btn.get_meta("tile", -1)) == index:
			btn.set_pressed_no_signal(true)
		else:
			btn.set_pressed_no_signal(false)


func _refresh_mode_buttons() -> void:
	if mode_tile_btn == null:
		return
	mode_tile_btn.set_pressed_no_signal(brush_mode == "tile")
	mode_block_btn.set_pressed_no_signal(brush_mode == "block")


func _refresh_brush_label() -> void:
	if brush_label == null:
		return
	if brush_mode == "block":
		brush_label.text = "当前画笔：阻挡（左键 = 不可走，右键 = 可走）"
		return
	if brush_tile == EMPTY_TILE:
		brush_label.text = "当前画笔：空（擦除本格 tile）"
		return
	var tile_list: Array = world_map.get("_tile_list")
	var src := "?"
	if brush_tile >= 0 and brush_tile < tile_list.size():
		src = str((tile_list[brush_tile] as Dictionary).get("src", "?"))
	brush_label.text = "当前画笔：地块 #%d（%s）" % [brush_tile, src]


func _refresh_info() -> void:
	if info_label == null or cfg.is_empty():
		return
	var tw := maxi(1, int(cfg.get("tW", 24)))
	var th := maxi(1, int(cfg.get("tH", 24)))
	var cols := int(cfg.get("mW", 0)) / tw
	var rows := int(cfg.get("mH", 0)) / th
	var tile_list: Array = world_map.get("_tile_list")
	var layers: Array = cfg.get("layers", [])
	var tile_layers := 0
	for layer in layers:
		if layer is Dictionary and int(layer.get("type", 0)) == 2:
			tile_layers += 1
	var line := "%s  #%d\n%d×%d px · %d×%d 格（%d）\ntile %d / 255 · 图层 %d（地块 %d）" % [
		data.name_of("worldMaps", map_id), map_id,
		int(cfg.get("mW", 0)), int(cfg.get("mH", 0)), cols, rows, cols * rows,
		tile_list.size(), layers.size(), tile_layers]
	if bool(cfg.get("__synthetic", false)):
		line += "\n⚠ 合成网格：没有 assets/map/%d.json" % map_id
	info_label.text = line
	if tile_list.size() >= 230:
		info_label.add_theme_color_override("font_color", Color(1.0, 0.72, 0.4))
	else:
		info_label.add_theme_color_override("font_color", Color(0.85, 0.88, 0.92))


func _refresh_undo_button() -> void:
	if undo_button != null:
		undo_button.disabled = _undo.is_empty()


func _refresh_title() -> void:
	if map_id <= 0:
		return
	var mark := " *" if dirty else ""
	DisplayServer.window_set_title("地图编辑器 · %d %s%s" % [
		map_id, data.name_of("worldMaps", map_id), mark])


func _set_status(text: String, is_error: bool) -> void:
	if status_label != null:
		status_label.text = text
		status_label.add_theme_color_override("font_color",
			Color(1.0, 0.5, 0.45) if is_error else Color(0.62, 0.9, 0.66))
	if is_error:
		print("[map_editor][warn] ", text.replace("\n", " "))


# ================================================================ 输入

func _unhandled_input(event: InputEvent) -> void:
	if not _ui_ready:
		return
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_WHEEL_UP and mb.pressed:
			_zoom_at(1.15, mb.position)
			get_viewport().set_input_as_handled()
		elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN and mb.pressed:
			_zoom_at(1.0 / 1.15, mb.position)
			get_viewport().set_input_as_handled()
		elif mb.button_index == MOUSE_BUTTON_MIDDLE:
			_panning = mb.pressed
			get_viewport().set_input_as_handled()
		elif mb.button_index == MOUSE_BUTTON_LEFT or mb.button_index == MOUSE_BUTTON_RIGHT:
			if mb.pressed:
				begin_stroke(mb.button_index == MOUSE_BUTTON_RIGHT)
				_refresh_hover(mb.position)
				_paint_at_mouse()
			else:
				end_stroke()
			get_viewport().set_input_as_handled()
	elif event is InputEventMouseMotion:
		var mm := event as InputEventMouseMotion
		if _panning:
			camera.position -= mm.relative / camera.zoom
			get_viewport().set_input_as_handled()
		else:
			_refresh_hover(mm.position)
			if _painting:
				_paint_at_mouse()


func _shortcut_input(event: InputEvent) -> void:
	if not _ui_ready:
		return
	if not (event is InputEventKey):
		return
	var key := event as InputEventKey
	if not key.pressed or key.echo:
		return
	if key.ctrl_pressed:
		match key.physical_keycode:
			KEY_S:
				save_map()
				get_viewport().set_input_as_handled()
				return
			KEY_Z:
				undo_last()
				get_viewport().set_input_as_handled()
				return
		return
	match key.physical_keycode:
		KEY_F:
			zoom_to_fit()
		KEY_T:
			set_brush_mode("tile")
		KEY_B:
			set_brush_mode("block")
		KEY_ESCAPE:
			hover_cell = Vector2i(-1, -1)
			overlay.queue_redraw()
		_:
			return
	get_viewport().set_input_as_handled()
