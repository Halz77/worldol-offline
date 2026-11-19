extends SceneTree
## 一次性生成 res://scenes/WorldScreen.tscn：Node2D 世界 + CanvasLayer UI。
## 由 Godot 自己序列化场景，编辑器里节点树可见可改。
##   godot --headless --path godot-next --script res://tools/build_world_scene.gd

const OUT = "res://scenes/WorldScreen.tscn"


func _ctl(parent: Node, cls: String, node_name: String, script_path: String = "") -> Control:
	var n: Control = ClassDB.instantiate(cls) as Control
	n.name = node_name
	parent.add_child(n)
	if script_path != "":
		n.set_script(load(script_path))
	return n


func _node(parent: Node, cls: String, node_name: String, script_path: String = "") -> Node:
	var n: Node = ClassDB.instantiate(cls) as Node
	n.name = node_name
	parent.add_child(n)
	if script_path != "":
		n.set_script(load(script_path))
	return n


func _full(n: Control) -> Control:
	n.set_anchors_preset(Control.PRESET_FULL_RECT)
	return n


func _fill(n: Control) -> Control:
	n.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	n.size_flags_vertical = Control.SIZE_EXPAND_FILL
	return n


func _walk(node: Node, out: Array) -> void:
	for c in node.get_children():
		out.append(c)
		_walk(c, out)


func _initialize() -> void:
	var root := Node2D.new()
	root.name = "WorldScreen"
	root.set_script(load("res://scripts/WorldScreen.gd"))

	_node(root, "Node2D", "WorldMap", "res://scripts/WorldMap.gd")
	var player := _node(root, "Node2D", "Player", "res://scripts/WorldPlayer.gd")
	var sprite := _node(player, "AnimatedSprite2D", "Sprite")
	sprite.centered = false
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	var camera := _node(root, "Camera2D", "Camera2D")
	camera.enabled = true

	var ui := _node(root, "CanvasLayer", "UI")
	ui.set("layer", 1)
	var margin := _full(_ctl(ui, "MarginContainer", "Margin")) as MarginContainer
	margin.add_theme_constant_override("margin_left", 12)
	margin.add_theme_constant_override("margin_top", 10)
	margin.add_theme_constant_override("margin_right", 12)
	margin.add_theme_constant_override("margin_bottom", 10)

	var vbox := _fill(_ctl(margin, "VBoxContainer", "Root")) as VBoxContainer
	vbox.add_theme_constant_override("separation", 8)

	var header := _ctl(vbox, "HBoxContainer", "Header") as HBoxContainer
	var title := _ctl(header, "Label", "Title") as Label
	title.text = "世界OL · 地图"
	title.add_theme_font_size_override("font_size", 20)
	var map_label := _ctl(header, "Label", "MapLabel") as Label
	map_label.text = "太阳城 #4"
	map_label.add_theme_font_size_override("font_size", 16)
	var spacer := _ctl(header, "Control", "Spacer") as Control
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var back := _ctl(header, "Button", "BackButton") as Button
	back.text = "返回角色屏"

	var body := _fill(_ctl(vbox, "HSplitContainer", "Body")) as HSplitContainer
	body.split_offset = 276
	var left_panel := _ctl(body, "PanelContainer", "LeftPanel") as PanelContainer
	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = Color(0.04, 0.05, 0.07, 0.82)
	panel_style.set_corner_radius_all(6)
	panel_style.content_margin_left = 8
	panel_style.content_margin_right = 8
	panel_style.content_margin_top = 8
	panel_style.content_margin_bottom = 8
	left_panel.add_theme_stylebox_override("panel", panel_style)
	var left := _ctl(left_panel, "VBoxContainer", "Left") as VBoxContainer
	left.custom_minimum_size.x = 250
	left.add_theme_constant_override("separation", 6)

	var search := _ctl(left, "LineEdit", "Search") as LineEdit
	search.placeholder_text = "搜索地图名 / 编号…"
	var option := _ctl(left, "OptionButton", "MapOption") as OptionButton
	option.custom_minimum_size.x = 250
	_fill(option)
	var buttons := _ctl(left, "HBoxContainer", "Buttons") as HBoxContainer
	var prev := _ctl(buttons, "Button", "PrevButton") as Button
	prev.text = "‹ 上一张"
	prev.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var next := _ctl(buttons, "Button", "NextButton") as Button
	next.text = "下一张 ›"
	next.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var name_check := _ctl(left, "CheckBox", "NameCheck") as CheckBox
	name_check.text = "显示 NPC 名字"
	name_check.set_pressed_no_signal(true)
	var npc_check := _ctl(left, "CheckBox", "NpcCheck") as CheckBox
	npc_check.text = "显示 NPC（默认关闭）"
	npc_check.set_pressed_no_signal(false)
	var info := _ctl(left, "Label", "InfoLabel") as Label
	info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	info.custom_minimum_size.y = 70
	var npc := _ctl(left, "Label", "NpcLabel") as Label
	npc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	npc.custom_minimum_size.y = 60

	_fill(_ctl(body, "Control", "Right"))

	var footer := _ctl(vbox, "Label", "Footer") as Label
	footer.text = "WASD / 方向键行走 · N 显示名字 · PgUp/PgDn 切图 · Esc 返回"
	footer.add_theme_font_size_override("font_size", 12)

	var descendants: Array = []
	_walk(root, descendants)
	for n in descendants:
		n.owner = root
	var packed := PackedScene.new()
	var err := packed.pack(root)
	if err != OK:
		printerr("[build_world_scene] pack 失败 err=", err)
		quit(1)
		return
	err = ResourceSaver.save(packed, OUT)
	if err != OK:
		printerr("[build_world_scene] 保存失败 err=", err)
		quit(1)
		return
	print("[build_world_scene] 已生成 ", OUT, " 节点数 ", descendants.size() + 1)
	root.free()
	quit(0)
