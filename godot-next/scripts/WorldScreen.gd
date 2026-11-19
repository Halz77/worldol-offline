extends Node2D
## 世界地图屏：地图选择器 + 可行走角色 + NPC 信息。任务系统暂不接入。
## 场景树由 tools/build_world_scene.gd 生成，可在 Godot 编辑器里直接改布局。

const GameData = preload("res://scripts/GameData.gd")
const ScreenStateScript = preload("res://scripts/ScreenState.gd")

@onready var world_map: Node2D = $WorldMap
@onready var player: Node2D = $Player
@onready var camera: Camera2D = $Camera2D
@onready var map_label: Label = $UI/Margin/Root/Header/MapLabel
@onready var back_button: Button = $UI/Margin/Root/Header/BackButton
@onready var search: LineEdit = $UI/Margin/Root/Body/LeftPanel/Left/Search
@onready var map_option: OptionButton = $UI/Margin/Root/Body/LeftPanel/Left/MapOption
@onready var prev_button: Button = $UI/Margin/Root/Body/LeftPanel/Left/Buttons/PrevButton
@onready var next_button: Button = $UI/Margin/Root/Body/LeftPanel/Left/Buttons/NextButton
@onready var name_check: CheckBox = $UI/Margin/Root/Body/LeftPanel/Left/NameCheck
@onready var npc_check: CheckBox = $UI/Margin/Root/Body/LeftPanel/Left/NpcCheck
@onready var info_label: Label = $UI/Margin/Root/Body/LeftPanel/Left/InfoLabel
@onready var npc_label: Label = $UI/Margin/Root/Body/LeftPanel/Left/NpcLabel
@onready var footer: Label = $UI/Margin/Root/Footer

var data = GameData.new()
var screen_state = null
var _map_ids: Array = []
var _tag_re := RegEx.new()
var _initial_map: int = 4


func _ready() -> void:
	screen_state = get_node_or_null("/root/ScreenState")
	if screen_state == null:
		screen_state = ScreenStateScript.new()
		screen_state.name = "ScreenState"
		get_tree().root.add_child(screen_state)
		screen_state.call("load_selection")

	_tag_re.compile("/c[0-9a-fA-F]{6}|/p|\\{[0-9]+\\}")
	if OS.has_environment("WORLDOL_MAP"):
		_initial_map = int(OS.get_environment("WORLDOL_MAP"))
	if not data.get_entry("worldMaps", _initial_map):
		_initial_map = 4

	player.call("bind", world_map, screen_state)
	_populate_maps("")
	_wire()
	_load_map(_initial_map)
	camera.enabled = true
	_maybe_capture()


func _wire() -> void:
	search.text_changed.connect(_on_search)
	map_option.item_selected.connect(_on_map_selected)
	prev_button.pressed.connect(func(): _step_map(-1))
	next_button.pressed.connect(func(): _step_map(1))
	name_check.toggled.connect(func(v): world_map.call("set_show_names", v))
	npc_check.toggled.connect(func(v): world_map.call("set_show_npcs", v))
	back_button.pressed.connect(_back_to_character)


func _populate_maps(keyword: String) -> void:
	var kw := keyword.strip_edges().to_lower()
	_map_ids.clear()
	map_option.clear()
	for id in data.ids("worldMaps"):
		var nm := data.name_of("worldMaps", int(id))
		if not kw.is_empty() and str(id).find(kw) < 0 and nm.to_lower().find(kw) < 0:
			continue
		_map_ids.append(int(id))
		map_option.add_item("%d · %s" % [int(id), nm])
	if not _map_ids.is_empty():
		var idx := _map_ids.find(world_map.map_id)
		map_option.select(maxi(idx, 0))


func _on_search(_text: String) -> void:
	_populate_maps(search.text)


func _on_map_selected(idx: int) -> void:
	if idx >= 0 and idx < _map_ids.size():
		_load_map(int(_map_ids[idx]))


func _step_map(dir: int) -> void:
	if _map_ids.is_empty():
		return
	var idx := _map_ids.find(world_map.map_id)
	if idx < 0:
		idx = 0
	else:
		idx = (idx + dir + _map_ids.size()) % _map_ids.size()
	map_option.select(idx)
	_load_map(int(_map_ids[idx]))


func _load_map(id: int) -> void:
	if not world_map.call("load_map", id):
		return
	var sel := _map_ids.find(id)
	if sel >= 0:
		map_option.select(sel)
	player.call("set_pixel", world_map.call("spawn_pixel"))
	# NPC 默认只在「NPC 展厅」页显示；普通地图保持原版数据但不上屏（交互逻辑待设计）。
	var want_npcs := bool(data.call("is_npc_page", id))
	npc_check.set_pressed_no_signal(want_npcs)
	world_map.call("set_show_npcs", want_npcs)
	var meta: Array = data.get_entry("worldMaps", id)
	var nm := data.name_of("worldMaps", id)
	var npc_count := int(meta[0].get("npc_count", 0)) if not meta.is_empty() else 0
	map_label.text = "%s  #%d" % [nm, id]
	info_label.text = "尺寸 %d×%d · 图块 %d · 物件 %d · NPC %d\n%s" % [
		int(meta[0].get("w", 0)) if not meta.is_empty() else 0,
		int(meta[0].get("h", 0)) if not meta.is_empty() else 0,
		int(meta[0].get("tiles", 0)) if not meta.is_empty() else 0,
		int(meta[0].get("objects", 0)) if not meta.is_empty() else 0,
		npc_count,
		"有背景图" if (not meta.is_empty() and bool(meta[0].get("has_bg", false))) else "无背景图"]
	_update_camera(1.0)


func _process(delta: float) -> void:
	if world_map == null or player == null:
		return
	_update_camera(delta)
	var cfg_variant = world_map.get("cfg")
	if not (cfg_variant is Dictionary):
		return
	var cfg: Dictionary = cfg_variant
	if cfg.is_empty():
		return
	var tw := maxi(1, int(cfg.get("tW", 24)))
	var th := maxi(1, int(cfg.get("tH", 24)))
	footer.text = "WASD / 方向键行走 · N 显示名字 · PgUp/PgDn 切图 · Esc 返回    坐标 %d,%d · 地图 %d/%d" % [
		int(player.position.x / tw), int(player.position.y / th),
		world_map.map_id, data.count("worldMaps")]
	world_map.call("update_labels_near", player.position, 150.0)
	var near: Dictionary = world_map.call("nearest_npc", player.position.x, player.position.y, 56.0)
	if near.is_empty():
		npc_label.text = "靠近 NPC 可查看名字 / 台词"
		return
	var n: Dictionary = near.get("data", {})
	var line := _plain(str(n.get("welcome", "")))
	if line.is_empty():
		line = _plain(str(n.get("talkDetail", "")))
	npc_label.text = "【%s】%s" % [str(n.get("name", "?")), line.substr(0, 60)]


func _plain(text: String) -> String:
	var s := _tag_re.sub("", text, true)
	return s.replace("\n", " ").strip_edges()


func _update_camera(delta: float) -> void:
	if camera == null or player == null:
		return
	var vp := get_viewport_rect().size
	var size: Vector2 = world_map.call("map_size")
	# 排查用：WORLDOL_FIT=1 把整张地图缩放进窗口，截图坐标与地图坐标成线性比例，
	# 便于精确定位某块色块对应的地图位置。正常游玩不设置。
	if OS.has_environment("WORLDOL_FIT") and size.x > 0.0 and size.y > 0.0:
		var s := minf(vp.x / size.x, vp.y / size.y)
		camera.zoom = Vector2(s, s)
		camera.position = size / 2.0
		return
	var target := player.position
	if size.x <= vp.x:
		target.x = size.x / 2.0
	else:
		target.x = clampf(target.x, vp.x / 2.0, size.x - vp.x / 2.0)
	if size.y <= vp.y:
		target.y = size.y / 2.0
	else:
		target.y = clampf(target.y, vp.y / 2.0, size.y - vp.y / 2.0)
	camera.position = camera.position.lerp(target, clampf(delta * 12.0, 0.0, 1.0))


func _back_to_character() -> void:
	get_tree().change_scene_to_file("res://scenes/CharacterScreen.tscn")


func _unhandled_key_input(event: InputEvent) -> void:
	if not (event is InputEventKey):
		return
	var key := event as InputEventKey
	if not key.pressed or key.echo:
		return
	var focus := get_viewport().gui_get_focus_owner()
	if focus is LineEdit:
		return
	match key.physical_keycode:
		KEY_ESCAPE:
			_back_to_character()
		KEY_N:
			name_check.set_pressed_no_signal(not name_check.button_pressed)
			world_map.call("set_show_names", name_check.button_pressed)
		KEY_PAGEUP:
			_step_map(-1)
		KEY_PAGEDOWN:
			_step_map(1)
		_:
			return
	get_viewport().set_input_as_handled()


func _maybe_capture() -> void:
	if not OS.has_environment("WORLDOL_CAPTURE"):
		return
	await get_tree().process_frame
	await get_tree().process_frame
	var tex := get_viewport().get_texture()
	if tex == null:
		print("[capture] headless 下 viewport texture 不可用，跳过截图")
		return
	var img := tex.get_image()
	if img == null:
		return
	var out := ProjectSettings.globalize_path("res://_out")
	DirAccess.make_dir_recursive_absolute(out)
	var err := img.save_png(out + "/world_screen.png")
	print("[capture] 保存 ", out, "/world_screen.png err=", err)
	# WORLDOL_QUITAFTER=n：截图后 n 秒自动退出，便于无人值守批量截图
	if OS.has_environment("WORLDOL_QUITAFTER"):
		await get_tree().create_timer(float(OS.get_environment("WORLDOL_QUITAFTER"))).timeout
		get_tree().quit()
