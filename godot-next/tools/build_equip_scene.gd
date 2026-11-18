extends SceneTree
## 生成 res://scenes/EquipScreen.tscn（装备屏，基础版）。
## 用 Godot 自己 pack，控件树在编辑器里可见可改。
##   godot --headless --path godot-next --script res://tools/build_equip_scene.gd

const OUT = "res://scenes/EquipScreen.tscn"


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
	root.name = "EquipScreen"
	root.set_script(load("res://scripts/EquipScreen.gd"))
	root.set_anchors_preset(Control.PRESET_FULL_RECT)

	var margin := _full(_add(root, "MarginContainer", "Margin")) as MarginContainer
	margin.add_theme_constant_override("margin_left", 16)
	margin.add_theme_constant_override("margin_top", 14)
	margin.add_theme_constant_override("margin_right", 16)
	margin.add_theme_constant_override("margin_bottom", 12)

	var vbox := _fill(_add(margin, "VBoxContainer", "Root")) as VBoxContainer
	vbox.add_theme_constant_override("separation", 10)

	# 标题行
	var header := _add(vbox, "HBoxContainer", "Header") as HBoxContainer
	var back := _add(header, "Button", "BackButton") as Button
	back.text = "← 返回角色屏"
	var title := _add(header, "Label", "Title") as Label
	title.text = "世界OL · 装备（基础版）"
	title.add_theme_font_size_override("font_size", 20)
	var spacer := _add(header, "Control", "Spacer") as Control
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL

	# 主体：四列（造型 / 部位 / 装备列表 / 属性）
	var body := _fill(_add(vbox, "HBoxContainer", "Body")) as HBoxContainer
	body.add_theme_constant_override("separation", 10)

	# --- 造型预览 ---
	var preview := _add(body, "VBoxContainer", "Preview") as VBoxContainer
	preview.custom_minimum_size = Vector2(340, 0)
	preview.size_flags_vertical = Control.SIZE_EXPAND_FILL
	preview.add_theme_constant_override("separation", 6)
	var stage := _fill(_add(preview, "PanelContainer", "Stage")) as PanelContainer
	stage.clip_contents = true
	stage.custom_minimum_size.y = 380
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
	var look := _add(preview, "Label", "LookLabel") as Label
	look.text = "造型：无（基础造型）"
	look.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	look.add_theme_font_size_override("font_size", 12)

	# --- 部位槽 ---
	var slots := _add(body, "VBoxContainer", "Slots") as VBoxContainer
	slots.custom_minimum_size = Vector2(150, 0)
	slots.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var slot_scroll := _fill(_add(slots, "ScrollContainer", "SlotScroll")) as ScrollContainer
	var slot_list := _fill(_add(slot_scroll, "ItemList", "SlotList")) as ItemList
	slot_list.size_flags_vertical = Control.SIZE_EXPAND_FILL

	# --- 候选装备 ---
	var items := _add(body, "VBoxContainer", "Items") as VBoxContainer
	items.custom_minimum_size = Vector2(260, 0)
	items.size_flags_vertical = Control.SIZE_EXPAND_FILL
	items.add_theme_constant_override("separation", 6)
	var item_title := _add(items, "Label", "ItemTitle") as Label
	item_title.text = "可选装备"
	item_title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var item_scroll := _fill(_add(items, "ScrollContainer", "ItemScroll")) as ScrollContainer
	var item_list := _fill(_add(item_scroll, "ItemList", "ItemList")) as ItemList
	item_list.size_flags_vertical = Control.SIZE_EXPAND_FILL

	# --- 属性变化 ---
	var stats_col := _add(body, "VBoxContainer", "Stats") as VBoxContainer
	stats_col.custom_minimum_size = Vector2(300, 0)
	stats_col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	stats_col.size_flags_vertical = Control.SIZE_EXPAND_FILL
	stats_col.add_theme_constant_override("separation", 6)
	var meta := _add(stats_col, "Label", "Meta") as Label
	meta.text = "属性变化"
	meta.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	meta.custom_minimum_size.y = 40
	var stat_scroll := _fill(_add(stats_col, "ScrollContainer", "StatScroll")) as ScrollContainer
	var stat_grid := _add(stat_scroll, "GridContainer", "StatGrid") as GridContainer
	stat_grid.columns = 2
	stat_grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	stat_grid.add_theme_constant_override("h_separation", 12)
	stat_grid.add_theme_constant_override("v_separation", 3)

	# 底部状态行
	var footer := _add(vbox, "Label", "Footer") as Label
	footer.text = "点击部位 → 选装备穿上；再点已穿装备卸下。无穿戴限制 · 属性与外观实时变化"
	footer.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	footer.add_theme_font_size_override("font_size", 12)

	# footer 文本同步给脚本（脚本里没设 footer 就用场景默认）
	var descendants: Array = []
	_walk(root, descendants)
	for n in descendants:
		n.owner = root
	var packed := PackedScene.new()
	var pack_err := packed.pack(root)
	if pack_err != OK:
		printerr("[build_equip_scene] pack 失败 err=", pack_err)
		quit(1)
		return
	var save_err := ResourceSaver.save(packed, OUT)
	if save_err != OK:
		printerr("[build_equip_scene] 保存失败 err=", save_err)
		quit(1)
		return
	print("[build_equip_scene] 已生成 ", OUT, " 节点数 ", descendants.size() + 1)
	root.free()
	quit(0)
