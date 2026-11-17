extends SceneTree
## 一次性生成 res://scenes/CharacterScreen.tscn。
##
## 由 Godot 自己序列化场景，控件树在编辑器里可见可改（改布局不用改代码）。
## 生成后只在需要重建控件树时重跑；平时直接编辑 .tscn 即可。
##   godot --headless --path godot-next --script res://tools/build_scene.gd

const OUT = "res://scenes/CharacterScreen.tscn"


func _add(parent: Node, cls: String, node_name: String, script_path: String = "") -> Control:
	var n := ClassDB.instantiate(cls) as Control
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


func _init() -> void:
	var root := Panel.new()
	root.name = "CharacterScreen"
	root.set_script(load("res://scripts/CharacterScreen.gd"))
	root.set_anchors_preset(Control.PRESET_FULL_RECT)

	# ---- 外框 -------------------------------------------------------------
	var margin := _full(_add(root, "MarginContainer", "Margin")) as MarginContainer
	margin.add_theme_constant_override("margin_left", 16)
	margin.add_theme_constant_override("margin_top", 14)
	margin.add_theme_constant_override("margin_right", 16)
	margin.add_theme_constant_override("margin_bottom", 12)

	var vbox := _fill(_add(margin, "VBoxContainer", "Root")) as VBoxContainer
	vbox.add_theme_constant_override("separation", 10)

	# ---- 标题行 -----------------------------------------------------------
	var header := _add(vbox, "HBoxContainer", "Header") as HBoxContainer
	var title := _add(header, "Label", "Title") as Label
	title.text = "世界OL · 角色屏"
	title.add_theme_font_size_override("font_size", 20)
	var spacer := _add(header, "Control", "Spacer") as Control
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var world_button := _add(header, "Button", "WorldButton") as Button
	world_button.text = "进入地图 →"
	var hint := _add(header, "Label", "Hint") as Label
	hint.text = "改 PNG 保存后，下一帧立刻生效"
	hint.add_theme_font_size_override("font_size", 13)

	# ---- 主体（左播放器 / 右属性面板） -------------------------------------
	var body := _fill(_add(vbox, "HSplitContainer", "Body")) as HSplitContainer
	body.split_offset = 470

	var left := _add(body, "VBoxContainer", "PlayerSide") as VBoxContainer
	left.custom_minimum_size.x = 430
	left.add_theme_constant_override("separation", 8)

	# 舞台
	var stage := _fill(_add(left, "PanelContainer", "Stage")) as PanelContainer
	stage.clip_contents = true
	stage.custom_minimum_size.y = 340
	var player := _fill(_full(_add(stage, "Control", "Player",
		"res://scripts/CharacterPlayer.gd"))) as Control
	player.mouse_filter = Control.MOUSE_FILTER_IGNORE

	var bg_color := _full(_add(player, "ColorRect", "BgColor")) as ColorRect
	bg_color.color = Color(0, 0, 0, 0)
	bg_color.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var bg_checker := _full(_add(player, "TextureRect", "BgChecker")) as TextureRect
	bg_checker.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var center := _full(_add(player, "CenterContainer", "Center")) as CenterContainer
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var figure := _add(center, "TextureRect", "Figure") as TextureRect
	figure.custom_minimum_size = Vector2(180, 200)
	figure.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	figure.mouse_filter = Control.MOUSE_FILTER_IGNORE

	# 控件网格
	var controls := _add(left, "GridContainer", "Controls") as GridContainer
	controls.columns = 3
	controls.add_theme_constant_override("h_separation", 6)
	controls.add_theme_constant_override("v_separation", 6)
	var opts := [
		["SexOption", "OptionButton"], ["PoseOption", "OptionButton"], ["AnimOption", "OptionButton"],
		["AllFramesCheck", "CheckBox"], ["SpeedOption", "OptionButton"], ["ScaleOption", "OptionButton"],
		["BgOption", "OptionButton"], ["PrevButton", "Button"], ["NextButton", "Button"],
		["PlayButton", "Button"], ["ReloadButton", "Button"], ["ResetButton", "Button"]
	]
	for spec in opts:
		var c := _add(controls, str(spec[1]), str(spec[0])) as Control
		c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		c.custom_minimum_size.x = 120
	var all_check := controls.get_node("AllFramesCheck") as CheckBox
	all_check.text = "显示全部帧"
	(controls.get_node("PrevButton") as Button).text = "‹ 上一帧"
	(controls.get_node("NextButton") as Button).text = "下一帧 ›"
	(controls.get_node("PlayButton") as Button).text = "⏸ 暂停"
	(controls.get_node("ReloadButton") as Button).text = "重新载入"
	(controls.get_node("ResetButton") as Button).text = "重置选择"

	# 帧滑块
	var frame_bar := _add(left, "HBoxContainer", "FrameBar") as HBoxContainer
	var frame_label := _add(frame_bar, "Label", "FrameLabel") as Label
	frame_label.text = "第 1 步"
	frame_label.custom_minimum_size.x = 72
	var slider := _add(frame_bar, "HSlider", "FrameSlider") as HSlider
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	slider.min_value = 0.0
	slider.max_value = 1.0
	slider.step = 1.0
	slider.value = 0.0
	var frame_count_label := _add(frame_bar, "Label", "FrameCount") as Label
	frame_count_label.text = "/ 1"
	frame_count_label.custom_minimum_size.x = 120

	# 属性面板
	var right := _add(body, "VBoxContainer", "StatsSide",
		"res://scripts/StatsPanel.gd") as VBoxContainer
	right.custom_minimum_size.x = 360
	right.add_theme_constant_override("separation", 8)
	var toolbar := _add(right, "HBoxContainer", "Toolbar") as HBoxContainer
	var case_option := _add(toolbar, "OptionButton", "CaseOption") as OptionButton
	case_option.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	case_option.custom_minimum_size.x = 180
	var mode_option := _add(toolbar, "OptionButton", "ModeOption") as OptionButton
	mode_option.custom_minimum_size.x = 150
	var meta := _add(right, "Label", "Meta") as Label
	meta.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	meta.custom_minimum_size.y = 62
	var scroll := _fill(_add(right, "ScrollContainer", "Scroll")) as ScrollContainer
	var grid := _add(scroll, "GridContainer", "Grid") as GridContainer
	grid.columns = 2
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 3)

	# ---- 底部状态行 -------------------------------------------------------
	var footer := _add(vbox, "Label", "Footer") as Label
	footer.text = "Model 300"
	footer.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	footer.add_theme_font_size_override("font_size", 12)

	# ---- 打包保存（由 Godot 自己写 .tscn，格式绝对正确） -------------------
	var descendants: Array = []
	_walk(root, descendants)
	for n in descendants:
		n.owner = root
	var packed := PackedScene.new()
	var pack_err := packed.pack(root)
	if pack_err != OK:
		printerr("[build_scene] pack 失败 err=", pack_err)
		quit(1)
		return
	var save_err := ResourceSaver.save(packed, OUT)
	if save_err != OK:
		printerr("[build_scene] 保存失败 err=", save_err)
		quit(1)
		return
	print("[build_scene] 已生成 ", OUT, " 节点数 ", descendants.size() + 1)
	root.free()
	quit(0)
