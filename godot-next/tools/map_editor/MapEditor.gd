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

# ---- 第二版：物件编辑 / 地图级操作 ----
const FRAMES_INDEX := "res://data/compiled/mapFrames.json"
const OVERRIDE_NAMES := "res://data/overrides/map_names.json"
const OVERRIDE_MAPS := "res://data/overrides/maps.json"
const OBJ_SNAP := 8               # 放置/拖动吸附像素
var frames_index: Dictionary = {}  # mapFrames.json（资源名 → atlas/frame）
var brush_obj_src: String = ""     # 当前选中的物件资源名
var obj_search: LineEdit
var obj_list: ItemList
var selected_obj_layer: int = -1   # 当前选中物件所在图层
var selected_obj_index: int = -1   # 当前选中物件在 obj 数组中的下标
var _obj_dragging: bool = false
var _obj_drag_start_world: Vector2 = Vector2.ZERO
var _obj_drag_orig: Array = []     # 拖动开始时的物件坐标副本
# 地图级操作对话框
var ops_dialog: AcceptDialog
var ops_kind: String = ""          # new | copy | resize | rename | replace
var ops_fields: Dictionary = {}


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
	# 物件数组里嵌套着每个物件的小数组，必须深拷贝，否则撤销时读到的是被改过的值。
	var snap: Array = []
	for e in source:
		snap.append(e.duplicate(true) if e is Array or e is Dictionary else e)
	_stroke = {"kind": kind, "layer": layer, "before": snap}


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
	var before = entry.get("before", [])
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
	elif kind == "obj":
		var li := int(entry.get("layer", -1))
		var layers: Array = cfg.get("layers", [])
		if li >= 0 and li < layers.size():
			var arr = layers[li].get("obj", [])
			if arr is Array:
				# 原地恢复每个物件的字段（保持元素引用，选中框才不会指向废对象）。
				# 共有下标逐个同步；多出来的删掉、缺的补上。
				var common := mini(arr.size(), before.size())
				for i in range(common):
					if arr[i] is Array and before[i] is Array:
						_restore_value_inplace(arr[i], before[i])
					else:
						var e = before[i]
						arr[i] = e.duplicate(true) if e is Array or e is Dictionary else e
				while arr.size() > before.size():
					arr.pop_back()
				while arr.size() < before.size():
					var e2 = before[arr.size()]
					arr.append(e2.duplicate(true) if e2 is Array or e2 is Dictionary else e2)
				# 选中下标可能已越界
				if selected_obj_layer == li and selected_obj_index >= arr.size():
					_clear_obj_selection()
	elif kind == "struct":
		# 结构变化（图层增删/改尺寸/批量替换/物件层整体）用整 cfg 快照原地恢复。
		_restore_cfg_snapshot(before)
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

	# 整栏可滚动：第二版加了物件浏览器和地图操作区，内容超过一屏，不能让调色板吃满高度。
	var panel_scroll := ScrollContainer.new()
	panel_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	margin.add_child(panel_scroll)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel_scroll.add_child(box)

	var title := Label.new()
	title.text = "地图编辑器 · 第二版"
	title.add_theme_font_size_override("font_size", 17)
	box.add_child(title)

	var hint := Label.new()
	hint.text = "中键平移 · 滚轮缩放 · F 适配 · 左侧栏可滚动\nT/B/O 切换地块/阻挡/物件 · Ctrl+Z 撤销 · Ctrl+S 保存"
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
	var mode_obj_btn := Button.new()
	mode_obj_btn.text = "物件 (O)"
	mode_obj_btn.toggle_mode = true
	mode_obj_btn.button_group = _mode_group
	mode_obj_btn.focus_mode = Control.FOCUS_NONE
	mode_obj_btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	mode_obj_btn.pressed.connect(func():
		brush_mode = "object"
		_refresh_brush_label()
		overlay.queue_redraw())
	var mode_row := HBoxContainer.new()
	mode_row.add_theme_constant_override("separation", 6)
	mode_row.add_child(mode_tile_btn)
	mode_row.add_child(mode_block_btn)
	mode_row.add_child(mode_obj_btn)
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
	palette_scroll.custom_minimum_size = Vector2(0, 170)
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

	# ---- 第二版 UI：物件资源浏览器 + 地图级操作按钮 ----
	_build_v2_ui(box)

	_ui_ready = true
	if OS.has_environment("WORLDOL_CAPTURE"):
		_maybe_capture()


func _maybe_capture() -> void:
	await get_tree().process_frame
	await get_tree().process_frame
	await get_tree().process_frame
	# 自动截图模式：可选放置一个物件、再截，便于实测第二版 UI 与物件渲染
	if OS.has_environment("WORLDOL_AUTOSHOT"):
		var src := OS.get_environment("WORLDOL_AUTOSHOT")
		if not src.is_empty() and frames_index.has(src):
			_place_obj(src, Vector2(500, 400))
			await get_tree().process_frame
	var tex := get_viewport().get_texture()
	if tex == null:
		print("[capture] 编辑器 headless 下跳过截图")
		return
	var img := tex.get_image()
	if img == null:
		return
	var out := ProjectSettings.globalize_path("res://_out")
	DirAccess.make_dir_recursive_absolute(out)
	var err := img.save_png(out + "/map_editor_screen.png")
	print("[capture] 编辑器截图 ", out + "/map_editor_screen.png", " err=", err)
	# WORLDOL_QUITAFTER=n：截图后自动退出，便于无人值守实测
	if OS.has_environment("WORLDOL_QUITAFTER"):
		await get_tree().create_timer(float(OS.get_environment("WORLDOL_QUITAFTER"))).timeout
		get_tree().quit(0)


func _build_v2_ui(box: VBoxContainer) -> void:
	box.add_child(HSeparator.new())
	var obj_title := Label.new()
	obj_title.text = "物件资源（第二版）"
	obj_title.add_theme_font_size_override("font_size", 12)
	box.add_child(obj_title)

	obj_search = LineEdit.new()
	obj_search.placeholder_text = "搜索物件资源名（如 541 / 树 / rock）"
	obj_search.text_changed.connect(_on_obj_search_changed)
	box.add_child(obj_search)

	obj_list = ItemList.new()
	obj_list.custom_minimum_size = Vector2(0, 92)
	obj_list.size_flags_vertical = Control.SIZE_EXPAND_FILL
	obj_list.select_mode = ItemList.SELECT_SINGLE
	obj_list.item_selected.connect(_on_obj_selected)
	box.add_child(obj_list)
	_reload_frames_index()
	_fill_obj_list("")

	var sel_hint := Label.new()
	sel_hint.text = "点资源→物件图层放 · 点已放物件选中 · 拖动移动 · R 旋转 · Del 删"
	sel_hint.add_theme_font_size_override("font_size", 10)
	sel_hint.add_theme_color_override("font_color", Color(0.68, 0.72, 0.78))
	box.add_child(sel_hint)

	box.add_child(HSeparator.new())
	var mapops_title := Label.new()
	mapops_title.text = "地图操作（第二版）"
	mapops_title.add_theme_font_size_override("font_size", 12)
	box.add_child(mapops_title)

	var row1 := HBoxContainer.new()
	row1.add_theme_constant_override("separation", 6)
	for spec in [["+图层", "add_layer"], ["-图层", "remove_layer"],
			["新建图", "new"], ["复制图", "copy"]]:
		var b := Button.new()
		b.text = spec[0]
		b.focus_mode = Control.FOCUS_NONE
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.pressed.connect(_on_map_op.bind(spec[1]))
		row1.add_child(b)
	box.add_child(row1)

	var row2 := HBoxContainer.new()
	row2.add_theme_constant_override("separation", 6)
	for spec in [["改尺寸", "resize"], ["改名", "rename"],
			["批量换资源", "replace"], ["校验", "validate"]]:
		var b := Button.new()
		b.text = spec[0]
		b.focus_mode = Control.FOCUS_NONE
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.pressed.connect(_on_map_op.bind(spec[1]))
		row2.add_child(b)
	box.add_child(row2)

	ops_dialog = AcceptDialog.new()
	ops_dialog.title = "地图操作"
	ops_dialog.ok_button_text = "执行"
	ops_dialog.confirmed.connect(_on_ops_confirmed)
	ui.add_child(ops_dialog)


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
	if brush_mode == "object":
		brush_label.text = "物件：%s（左键放置/选中拖动 · R 旋转 · Del 删）" % (
			brush_obj_src if not brush_obj_src.is_empty() else "未选资源")
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
			if brush_mode == "object":
				_handle_obj_mouse(mb)
			else:
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
			if brush_mode == "object":
				if _obj_dragging:
					var world := _screen_to_world(mm.position)
					_move_selected_obj(world - _obj_drag_start_world)
					_obj_drag_start_world = world
					get_viewport().set_input_as_handled()
			elif _painting:
				_paint_at_mouse()


func _handle_obj_mouse(mb: InputEventMouseButton) -> void:
	var world := _screen_to_world(mb.position)
	if not mb.pressed:
		# 拖动结束：落一步撤销
		if _obj_dragging:
			_obj_dragging = false
			end_stroke()
			_refresh_undo_button()
		return
	# 右键 = 删除命中的物件
	if mb.button_index == MOUSE_BUTTON_RIGHT:
		var hit_r := _hit_obj(world)
		if not hit_r.is_empty():
			selected_obj_layer = int(hit_r[0])
			selected_obj_index = int(hit_r[1])
			_delete_selected_obj()
		return
	# 左键：先命中已有物件 → 选中并准备拖动；否则放新物件
	var hit := _hit_obj(world)
	if not hit.is_empty():
		selected_obj_layer = int(hit[0])
		selected_obj_index = int(hit[1])
		var obj = _obj_at(selected_obj_layer, selected_obj_index)
		_obj_drag_start_world = world
		_obj_dragging = true
		begin_stroke(false)
		var layers: Array = cfg.get("layers", [])
		var arr: Array = layers[selected_obj_layer]["obj"]
		_record_undo("obj", arr, selected_obj_layer)
		_set_status("选中物件 %s（拖动移动 · R 旋转 · Del 删）" % str((obj as Array)[1]), false)
		overlay.queue_redraw()
	else:
		_place_obj(brush_obj_src, world)


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
		KEY_O:
			brush_mode = "object"
			_refresh_mode_buttons()
			_refresh_brush_label()
			_set_status("物件模式：先在右侧资源列表选一个资源", false)
		KEY_R:
			if brush_mode == "object":
				_rotate_selected_obj()
		KEY_DELETE:
			if brush_mode == "object":
				_delete_selected_obj()
		KEY_BACKSPACE:
			if brush_mode == "object":
				_delete_selected_obj()
		KEY_ESCAPE:
			_clear_obj_selection()
			hover_cell = Vector2i(-1, -1)
			overlay.queue_redraw()
		_:
			return
	get_viewport().set_input_as_handled()


# ================================================================ 第二版：物件资源浏览器

func _reload_frames_index() -> void:
	var v = GameData._json(FRAMES_INDEX)
	frames_index = v if v is Dictionary else {}


func _fill_obj_list(keyword: String) -> void:
	if obj_list == null:
		return
	obj_list.clear()
	var kw := keyword.strip_edges().to_lower()
	var keys: Array = frames_index.keys()
	keys.sort()
	# 有搜索词时最多列 200 条，避免 2485 条一次铺满卡界面
	var limit := 200 if not kw.is_empty() else 400
	for key in keys:
		if not kw.is_empty() and str(key).to_lower().find(kw) < 0:
			continue
		obj_list.add_item(str(key))
		if obj_list.item_count >= limit:
			break


func _on_obj_search_changed(text: String) -> void:
	_fill_obj_list(text)


func _on_obj_selected(index: int) -> void:
	if index < 0 or index >= obj_list.item_count:
		return
	brush_obj_src = obj_list.get_item_text(index)
	brush_mode = "object"
	_refresh_mode_buttons()
	_clear_obj_selection()
	_set_status("物件画笔：%s　（在物件图层左键放置）" % brush_obj_src, false)
	overlay.queue_redraw()


## 物件资源在场景里的显示尺寸：优先帧的 sourceW/sourceH（逻辑尺寸），
## 没有则退回 w/h；和 WorldMap._resolve 的 logical frame 一致。
func _obj_src_size(src: String) -> Vector2:
	var res: Dictionary = world_map.call("_resolve", src)
	if not res.is_empty() and bool(res.get("logical", false)):
		return (res.get("region") as Rect2).size
	if frames_index.has(src):
		var f: Dictionary = (frames_index[src] as Dictionary).get("frame", {})
		var sw := int(f.get("sourceW", f.get("w", 24)))
		var sh := int(f.get("sourceH", f.get("h", 24)))
		return Vector2(maxi(1, sw), maxi(1, sh))
	# 没帧表的资源（如纯切片）：直接读图片尺寸
	var res2: Dictionary = world_map.call("_resolve", src, true)
	if not res2.is_empty():
		return (res2.get("region") as Rect2).size
	return Vector2(24, 24)


func _first_obj_layer() -> int:
	var layers: Array = cfg.get("layers", [])
	# 物件层优先 type==3；找不到就取任意有 obj 键的层
	for want_type in [3, -1]:
		for i in range(layers.size()):
			var layer = layers[i]
			if not (layer is Dictionary):
				continue
			if want_type == 3 and int(layer.get("type", 0)) != 3:
				continue
			if layer.get("obj") is Array:
				return i
	return -1


# ================================================================ 第二版：物件编辑

func _clear_obj_selection() -> void:
	selected_obj_layer = -1
	selected_obj_index = -1
	overlay.queue_redraw()


func selected_obj_rect() -> Rect2:
	if selected_obj_layer < 0 or selected_obj_index < 0:
		return Rect2()
	var obj = _obj_at(selected_obj_layer, selected_obj_index)
	return _obj_rect(obj)


func _obj_at(li: int, oi: int):
	var layers: Array = cfg.get("layers", [])
	if li < 0 or li >= layers.size():
		return null
	var layer = layers[li]
	if not (layer is Dictionary) or not (layer.get("obj") is Array):
		return null
	var arr: Array = layer["obj"]
	if oi < 0 or oi >= arr.size():
		return null
	return arr[oi]


func _obj_rect(obj) -> Rect2:
	if not (obj is Array) or (obj as Array).size() < 6:
		return Rect2()
	var arr: Array = obj
	var x := float(arr[2])
	var y := float(arr[3])
	var w := maxf(1.0, float(arr[4]))
	var h := maxf(1.0, float(arr[5]))
	var tr := int(arr[6]) if arr.size() > 6 else 0
	# 90/270 度旋转后包围盒宽高交换（变换 4/5/6/7）
	if tr == 4 or tr == 5 or tr == 6 or tr == 7:
		return Rect2(x, y, h, w)
	return Rect2(x, y, w, h)


## 命中检测：从最上层（layers[0]，倒序绘制里最后画）往下找，
## 同层内从后往前（后画的在上）。返回 [layer, index] 或空。
func _hit_obj(world: Vector2) -> Array:
	var layers: Array = cfg.get("layers", [])
	for li in range(layers.size()):
		var layer = layers[li]
		if not (layer is Dictionary) or not (layer.get("obj") is Array):
			continue
		var arr: Array = layer["obj"]
		for oi in range(arr.size() - 1, -1, -1):
			var obj = arr[oi]
			if not (obj is Array):
				continue
			# kind 3/4 是 NPC/模型，编辑器不选中（它们由 npcs 数据驱动）
			if int((obj as Array)[0]) != 2:
				continue
			if _obj_rect(obj).has_point(world):
				return [li, oi]
	return []


func _place_obj(src: String, world: Vector2) -> void:
	if src.is_empty():
		_set_status("请先选一个物件资源", true)
		return
	if bool(cfg.get("__synthetic", false)):
		_set_status("合成网格图不支持编辑物件", true)
		return
	var li := _first_obj_layer()
	if li < 0:
		_set_status("本图没有物件图层（layers 里没有带 obj 的层）", true)
		return
	var layers: Array = cfg.get("layers", [])
	var arr: Array = layers[li]["obj"]
	var sz := _obj_src_size(src)
	var x := snappedf(world.x - sz.x * 0.5, float(OBJ_SNAP))
	var y := snappedf(world.y - sz.y * 0.5, float(OBJ_SNAP))
	var obj: Array = [2, src, x, y, int(sz.x), int(sz.y), 0]
	begin_stroke(false)
	_record_undo("obj", arr, li)
	arr.append(obj)
	selected_obj_layer = li
	selected_obj_index = arr.size() - 1
	end_stroke()
	dirty = true
	_refresh_title()
	_refresh_undo_button()
	world_map.queue_redraw()
	overlay.queue_redraw()
	_set_status("放置物件 %s @ (%.0f,%.0f)" % [src, x, y], false)


func _delete_selected_obj() -> void:
	if selected_obj_layer < 0 or selected_obj_index < 0:
		_set_status("没有选中的物件", false)
		return
	var obj = _obj_at(selected_obj_layer, selected_obj_index)
	var layers: Array = cfg.get("layers", [])
	var arr: Array = layers[selected_obj_layer]["obj"]
	begin_stroke(false)
	_record_undo("obj", arr, selected_obj_layer)
	arr.remove_at(selected_obj_index)
	end_stroke()
	_clear_obj_selection()
	dirty = true
	_refresh_title()
	_refresh_undo_button()
	world_map.queue_redraw()
	_set_status("已删除物件 %s" % (str((obj as Array)[1]) if obj is Array else "?"), false)


func _rotate_selected_obj() -> void:
	var obj = _obj_at(selected_obj_layer, selected_obj_index)
	if not (obj is Array):
		_set_status("没有选中的物件", false)
		return
	var layers: Array = cfg.get("layers", [])
	var arr: Array = layers[selected_obj_layer]["obj"]
	begin_stroke(false)
	_record_undo("obj", arr, selected_obj_layer)
	var oa: Array = obj
	var tr := int(oa[6]) if oa.size() > 6 else 0
	if oa.size() > 6:
		oa[6] = (tr + 1) % 8
	else:
		oa.append(1)
	end_stroke()
	dirty = true
	_refresh_title()
	_refresh_undo_button()
	world_map.queue_redraw()
	overlay.queue_redraw()
	_set_status("物件 %s 变换 %d → %d" % [str(oa[1]), tr, int(oa[6])], false)


func _move_selected_obj(delta: Vector2) -> void:
	var obj = _obj_at(selected_obj_layer, selected_obj_index)
	if not (obj is Array):
		return
	var arr: Array = obj
	arr[2] = snappedf(float(arr[2]) + delta.x, float(OBJ_SNAP))
	arr[3] = snappedf(float(arr[3]) + delta.y, float(OBJ_SNAP))
	world_map.queue_redraw()
	overlay.queue_redraw()


# ================================================================ 第二版：结构快照 / 图层 / 地图操作

## 结构操作前调用：记一步整 cfg 快照（原地恢复用）。
func _record_struct_undo() -> void:
	if not _stroke.is_empty():
		return
	_stroke = {"kind": "struct", "layer": -1,
		"before": cfg.duplicate(true)}


## 递归原地恢复：把 src 的内容写回 dst，保持所有嵌套 Array/Dictionary 的引用不变。
## ★ 必须原地：WorldMap 持有 cfg 和 layers[i].data 的引用，整体替换会让它们失效，
##   后续 queue_redraw 画的还是旧数据（这正是第一版 tile/block 撤销强调的原则）。
func _restore_value_inplace(dst, src) -> void:
	if dst is Array and src is Array:
		dst.clear()
		for e in src:
			if e is Array or e is Dictionary:
				var copy = e.duplicate(true)
				dst.append(copy)
			else:
				dst.append(e)
	elif dst is Dictionary and src is Dictionary:
		for k in dst.keys():
			if not src.has(k):
				dst.erase(k)
		for k in src.keys():
			if dst.has(k) and (dst[k] is Array or dst[k] is Dictionary) \
					and (src[k] is Array or src[k] is Dictionary):
				_restore_value_inplace(dst[k], src[k])
			else:
				var v = src[k]
				dst[k] = v.duplicate(true) if v is Array or v is Dictionary else v


## 整 cfg 快照原地恢复（不换 cfg 引用，WorldMap 持有同一个 Dictionary）。
func _restore_cfg_snapshot(snap: Dictionary) -> void:
	for k in cfg.keys():
		if not snap.has(k):
			cfg.erase(k)
	for k in snap.keys():
		if cfg.has(k) and (cfg[k] is Array or cfg[k] is Dictionary) \
				and (snap[k] is Array or snap[k] is Dictionary):
			_restore_value_inplace(cfg[k], snap[k])
		else:
			var v = snap[k]
			cfg[k] = v.duplicate(true) if v is Array or v is Dictionary else v
	# 层数变了，当前图层下标可能越界
	var layers_now: Array = cfg.get("layers", [])
	layer_index = clampi(layer_index, -1, layers_now.size() - 1)
	world_map.call("rebuild_from_cfg")
	_rebuild_layers()
	_rebuild_palette()
	_clear_obj_selection()
	_refresh_info()
	zoom_to_fit()


func _finish_struct_edit(msg: String, is_error: bool = false) -> void:
	end_stroke()
	dirty = true
	world_map.call("rebuild_from_cfg")
	_rebuild_layers()
	_rebuild_palette()
	_refresh_info()
	_refresh_title()
	_set_status(msg, is_error)


# ---- 图层增删 ----

func add_tile_layer() -> void:
	var layers: Array = cfg.get("layers", [])
	var tw := maxi(1, int(cfg.get("tW", 24)))
	var th := maxi(1, int(cfg.get("tH", 24)))
	var cells := (int(cfg.get("mW", 0)) / tw) * (int(cfg.get("mH", 0)) / th)
	if cells <= 0:
		_set_status("地图尺寸无效，无法加图层", true)
		return
	_record_struct_undo()
	var data_arr: Array = []
	data_arr.resize(cells)
	data_arr.fill(EMPTY_TILE)
	# layers[0] 在最上层；append 到末尾 = 新层在最底层（地面层的正确位置）
	layers.append({"type": 2, "data": data_arr})
	layer_index = layers.size() - 1
	_finish_struct_edit("新增地块图层 %d（最底层，%d 格全空）" % [layer_index, cells])


func remove_current_layer() -> void:
	var layers: Array = cfg.get("layers", [])
	if layers.size() <= 1:
		_set_status("只剩一个图层，不能删除", true)
		return
	if layer_index < 0 or layer_index >= layers.size():
		_set_status("请先选中要删除的图层", true)
		return
	_record_struct_undo()
	layers.remove_at(layer_index)
	layer_index = clampi(layer_index, 0, layers.size() - 1)
	_finish_struct_edit("已删除图层，现在共 %d 层" % layers.size())


# ---- 地图级操作对话框 ----

func _on_map_op(kind: String) -> void:
	if kind == "add_layer":
		add_tile_layer()
		return
	if kind == "remove_layer":
		remove_current_layer()
		return
	if kind == "validate":
		var problems := validate_cfg(cfg)
		if problems.is_empty():
			_set_status("校验通过：%d 项约束全部满足" % 8, false)
		else:
			_set_status("校验失败（%d 项）：\n%s" % [problems.size(), "\n".join(problems)], true)
		return
	ops_kind = kind
	ops_fields.clear()
	ops_dialog.dialog_text = ""
	# 用 VBoxContainer 承载输入控件
	for c in ops_dialog.get_children():
		if c is Control:
			ops_dialog.remove_child(c)
			c.queue_free()
	var vb := VBoxContainer.new()
	vb.add_theme_constant_override("separation", 8)
	ops_dialog.add_child(vb)

	match kind:
		"new", "copy":
			var lbl := Label.new()
			lbl.text = "从当前地图复制一份（%d），填写新 id：" % map_id if kind == "copy" else \
				"从当前地图复制一份作为模板，填写新 id："
			vb.add_child(lbl)
			_add_field(vb, "id", "新地图 id（建议 10001+）", str(_suggest_new_id()))
			var nm := Label.new()
			nm.text = "创建后可在 override 里改名；接通传送需另配 NPC。"
			vb.add_child(nm)
		"resize":
			var tw := maxi(1, int(cfg.get("tW", 24)))
			var th := maxi(1, int(cfg.get("tH", 24)))
			_add_field(vb, "cols", "新宽度（格，原 %d）" % (int(cfg.get("mW", 0)) / tw),
				str(int(cfg.get("mW", 0)) / tw))
			_add_field(vb, "rows", "新高度（格，原 %d）" % (int(cfg.get("mH", 0)) / th),
				str(int(cfg.get("mH", 0)) / th))
			_add_field(vb, "strategy", "策略：keep=留左上 / center=居中 / edge=扩边", "center")
		"rename":
			_add_field(vb, "name", "新名字", data.name_of("worldMaps", map_id))
		"replace":
			_add_field(vb, "from", "原资源名", "106_1")
			_add_field(vb, "to", "新资源名", "304")
	ops_dialog.popup_centered()


func _add_field(parent: VBoxContainer, key: String, label: String, default: String) -> void:
	var l := Label.new()
	l.text = label
	parent.add_child(l)
	var e := LineEdit.new()
	e.text = default
	parent.add_child(e)
	ops_fields[key] = e


func _suggest_new_id() -> int:
	var ids: Array = data.ids("worldMaps")
	var m := 10000
	for id in ids:
		m = maxi(m, int(id))
	return m + 1


func _on_ops_confirmed() -> void:
	var kind := ops_kind
	match kind:
		"new", "copy":
			_do_copy_map(int(str(ops_fields["id"].text).strip_edges()))
		"resize":
			_do_resize(int(str(ops_fields["cols"].text).strip_edges()),
				int(str(ops_fields["rows"].text).strip_edges()),
				str(ops_fields["strategy"].text).strip_edges().to_lower())
		"rename":
			_do_rename(str(ops_fields["name"].text).strip_edges())
		"replace":
			_do_replace(str(ops_fields["from"].text).strip_edges(),
				str(ops_fields["to"].text).strip_edges())
	ops_kind = ""


func _copy_map_cfg() -> Dictionary:
	return cfg.duplicate(true)


func _do_copy_map(new_id: int) -> void:
	if new_id <= 0:
		_set_status("新 id 必须为正整数", true)
		return
	if data.get_entry("worldMaps", new_id) is Array and not (data.get_entry("worldMaps", new_id) as Array).is_empty():
		_set_status("地图 %d 已存在，换一个 id" % new_id, true)
		return
	if FileAccess.file_exists(MAP_DIR + str(new_id) + ".json"):
		_set_status("assets/map/%d.json 已存在，换一个 id" % new_id, true)
		return
	var new_cfg := _copy_map_cfg()
	new_cfg.erase("__synthetic")
	var err := _write_map_file(new_id, new_cfg)
	if err != OK:
		_set_status("复制地图失败：写文件出错（%d）" % err, true)
		return
	# 登记 override（不动 index.json 快照）
	var ov = GameData._json(OVERRIDE_MAPS)
	if not (ov is Dictionary):
		ov = {}
	var meta: Dictionary = {}
	var src_meta: Array = data.get_entry("worldMaps", map_id)
	if not src_meta.is_empty() and src_meta[0] is Dictionary:
		meta = (src_meta[0] as Dictionary).duplicate(true)
	meta["id"] = new_id
	meta["name"] = data.name_of("worldMaps", map_id) + "（副本）"
	meta["npc_count"] = 0
	meta["has_config"] = true
	meta["has_atlas"] = FileAccess.file_exists("res://assets/map_merged/%d.png" % new_id)
	ov[str(new_id)] = meta
	var werr := _write_text(ProjectSettings.globalize_path(OVERRIDE_MAPS),
		JSON.stringify(normalize_value(ov), "", false))
	if werr != OK:
		_set_status("地图文件已建，但登记 override 失败（%d）：新图可能不出现在列表" % werr, true)
		return
	data.reload_overrides()
	_fill_map_list(search_edit.text)
	_set_status("已复制地图 %d → %d（含地形/物件/阻挡；NPC 分片未复制）" % [map_id, new_id], false)


func _write_map_file(id: int, cfg_write: Dictionary) -> int:
	var abs_path := ProjectSettings.globalize_path(MAP_DIR + str(id) + ".json")
	return _write_text(abs_path, JSON.stringify(normalize_value(cfg_write), "", false))


func _do_resize(new_cols: int, new_rows: int, strategy: String) -> void:
	if new_cols <= 0 or new_rows <= 0:
		_set_status("尺寸必须为正", true)
		return
	if strategy != "keep" and strategy != "center" and strategy != "edge":
		strategy = "center"
	var tw := maxi(1, int(cfg.get("tW", 24)))
	var th := maxi(1, int(cfg.get("tH", 24)))
	var old_cols := int(cfg.get("mW", 0)) / tw
	var old_rows := int(cfg.get("mH", 0)) / th
	var new_cells := new_cols * new_rows
	if new_cells > 100000:
		_set_status("目标格数 %d 过大，拒绝" % new_cells, true)
		return
	_record_struct_undo()
	# 计算旧格到新格的偏移
	var off_c := 0
	var off_r := 0
	if strategy == "center":
		off_c = (new_cols - old_cols) / 2
		off_r = (new_rows - old_rows) / 2
	# keep / edge：旧格落在左上角（edge 的扩边就是右侧/下侧补空）
	var layers: Array = cfg.get("layers", [])
	for layer in layers:
		if not (layer is Dictionary):
			continue
		if layer.get("data") is Array:
			var old_data: Array = layer["data"]
			var nd: Array = []
			nd.resize(new_cells)
			nd.fill(EMPTY_TILE)
			for r in range(old_rows):
				for c in range(old_cols):
					var nc := c + off_c
					var nr := r + off_r
					if nc < 0 or nc >= new_cols or nr < 0 or nr >= new_rows:
						continue
					var oi := r * old_cols + c
					if oi >= old_data.size():
						continue
					nd[nr * new_cols + nc] = old_data[oi]
			layer["data"] = nd
	# blocks 同步
	var blocks = cfg.get("blocks", null)
	if blocks is Array:
		var old_blocks: Array = blocks
		var nb: Array = []
		nb.resize(new_cells)
		nb.fill(0)
		for r in range(old_rows):
			for c in range(old_cols):
				var nc := c + off_c
				var nr := r + off_r
				if nc < 0 or nc >= new_cols or nr < 0 or nr >= new_rows:
					continue
				var oi := r * old_cols + c
				if oi >= old_blocks.size():
					continue
				nb[nr * new_cols + nc] = old_blocks[oi]
		cfg["blocks"] = nb
	# 物件坐标：center 策略整体平移，keep/edge 不动
	if strategy == "center":
		var dx := float(-off_c * tw)
		var dy := float(-off_r * th)
		for layer in layers:
			if layer is Dictionary and layer.get("obj") is Array:
				for obj in layer["obj"]:
					if obj is Array and (obj as Array).size() >= 4:
						(obj as Array)[2] = float((obj as Array)[2]) + dx
						(obj as Array)[3] = float((obj as Array)[3]) + dy
	cfg["mW"] = new_cols * tw
	cfg["mH"] = new_rows * th
	_finish_struct_edit("改尺寸：%dx%d → %dx%d 格（%s）" % [
		old_cols, old_rows, new_cols, new_rows, strategy])


func _do_rename(new_name: String) -> void:
	if new_name.is_empty():
		_set_status("名字不能为空", true)
		return
	var ov = GameData._json(OVERRIDE_NAMES)
	if not (ov is Dictionary):
		ov = {}
	ov[str(map_id)] = new_name
	var err := _write_text(ProjectSettings.globalize_path(OVERRIDE_NAMES),
		JSON.stringify(normalize_value(ov), "", false))
	if err != OK:
		_set_status("改名失败：写 override 出错（%d）" % err, true)
		return
	data.reload_overrides()
	_fill_map_list(search_edit.text)
	_refresh_title()
	_refresh_info()
	_set_status("已改名：%d → %s（写在 override，不动 index.json）" % [map_id, new_name], false)


func _do_replace(from: String, to: String) -> void:
	if from.is_empty() or to.is_empty() or from == to:
		_set_status("原资源名和新资源名不能为空且不能相同", true)
		return
	var count := 0
	_record_struct_undo()
	var tiles: Array = cfg.get("tiles", [])
	for def in tiles:
		if def is Array and (def as Array).size() > 0 and str((def as Array)[0]) == from:
			(def as Array)[0] = to
			count += 1
	var layers: Array = cfg.get("layers", [])
	for layer in layers:
		if layer is Dictionary and layer.get("obj") is Array:
			for obj in layer["obj"]:
				if obj is Array and (obj as Array).size() > 1 and str((obj as Array)[1]) == from:
					(obj as Array)[1] = to
					count += 1
	_finish_struct_edit("批量替换 %s → %s：%d 处" % [from, to, count])


# ---- 保存前校验（§4 硬约束 + 索引上限 + 物件不越界 + 引用完整） ----

func validate_cfg(check_cfg: Dictionary) -> Array:
	var problems: Array = []
	var tw := maxi(1, int(check_cfg.get("tW", 24)))
	var th := maxi(1, int(check_cfg.get("tH", 24)))
	var mw := int(check_cfg.get("mW", 0))
	var mh := int(check_cfg.get("mH", 0))
	if mw <= 0 or mh <= 0 or mw % tw != 0 or mh % th != 0:
		problems.append("mW/mH 必须是 tW/tH 的整数倍")
	var cols := mw / tw
	var rows := mh / th
	var cells := cols * rows
	var tile_list: Array = []
	for def in check_cfg.get("tiles", []):
		if not (def is Array) or (def as Array).size() < 4:
			continue
		for _r in range(maxi(1, int((def as Array)[3]))):
			for _c in range(maxi(1, int((def as Array)[2]))):
				tile_list.append(def)
	if tile_list.size() > 255:
		problems.append("tileList=%d > 255" % tile_list.size())
	var layers: Array = check_cfg.get("layers", [])
	for i in range(layers.size()):
		var layer = layers[i]
		if not (layer is Dictionary):
			problems.append("图层 %d 不是对象" % i)
			continue
		if int(layer.get("type", 0)) == 2:
			var arr = layer.get("data", [])
			if not (arr is Array) or (arr as Array).size() != cells:
				problems.append("图层 %d data 长度 %d ≠ %d" % [
					i, (arr as Array).size() if arr is Array else -1, cells])
		if layer.get("obj") is Array:
			for obj in layer["obj"]:
				if not (obj is Array) or (obj as Array).size() < 6:
					continue
				var oa: Array = obj
				if int(oa[0]) == 2:
					var tr := int(oa[6]) if oa.size() > 6 else 0
					var ww := float(oa[4]); var hh := float(oa[5])
					if tr == 4 or tr == 5 or tr == 6 or tr == 7:
						var t := ww; ww = hh; hh = t
					var x := float(oa[2]); var y := float(oa[3])
					if x < -ww or y < -hh or x > mw + ww or y > mh + hh:
						problems.append("物件 %s 越界 @(%d,%d)" % [str(oa[1]), int(x), int(y)])
	var blocks = check_cfg.get("blocks", null)
	if blocks is Array and (blocks as Array).size() > cells:
		problems.append("blocks 长度 %d > %d" % [(blocks as Array).size(), cells])
	# 传送 / 编队引用（数据链完整性，白名单忽略历史缺口）
	var npc_path := "res://data/compiled/npcs/%d.json" % map_id
	if FileAccess.file_exists(npc_path):
		var npcs = GameData._json(npc_path)
		if npcs is Array:
			for npc in npcs:
				if not (npc is Dictionary):
					continue
				var jumps = npc.get("jumpMapID", [])
				if jumps is Array:
					for jid in jumps:
						if data.get_entry("worldMaps", int(jid)).is_empty():
							problems.append("NPC %s 传送目标 %d 不存在" % [
								str(npc.get("name", "?")), int(jid)])
	return problems
