extends Control
## 外观屏（发型 / 脸型 / 手部 / 脚部）。
##
## 用法：
##   godot --path godot-next res://scenes/AppearanceScreen.tscn
## 从角色屏「外观」按钮或快捷键 L 进入。
##
## 设计要点：
##   - **每个档位都用缩略图选**，不显示裸编号 —— 发型 14 档、脸 15 档，
##     光看数字根本不知道选了什么。
##   - 改一项立刻重算缩略图 + 刷新预览 + 写 user://appearance.json（自动存盘）。
##   - 缩略图带缓存：切色号只重建该部位那一行，不重解整页 PNG。
##   - 造型由 CharacterPlayer 渲染，与装备外观叠加（外观只管头发/脸/手/脚四个槽）。

const Appearance = preload("res://scripts/Appearance.gd")
const SpriteComposer = preload("res://scripts/SpriteComposer.gd")
const PlayerScript = preload("res://scripts/CharacterPlayer.gd")
const Recolor = preload("res://scripts/Recolor.gd")

const THUMB_BOX := 60
const COLOR_BOX := 44
const SEX_OPTIONS := ["女", "男"]

var state
var player: Control
var look_label: Label
var hint_label: Label
var sex_option: OptionButton
var style_row: Dictionary = {}   # part -> HBoxContainer
var color_row: Dictionary = {}   # part -> HBoxContainer
var style_buttons: Dictionary = {}  # part -> Array[Button]
var color_buttons: Dictionary = {}  # part -> Array[Button]
var rgb_picker: Dictionary = {}  # part -> ColorPickerButton
var rgb_label: Dictionary = {}   # part -> Label
var _thumb_cache: Dictionary = {}
var _palette_cache: Dictionary = {}
var _syncing := false


func _ready() -> void:
	state = get_node_or_null("/root/ScreenState")
	if state == null:
		push_warning("[Appearance] 未找到 ScreenState，外观操作不可用")
		return
	_build_ui()
	player.call("bind", state)
	_sync_sex_option()
	_refresh_all()
	_maybe_capture()


# ---------------------------------------------------------------- UI

func _build_ui() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)

	var bg := ColorRect.new()
	bg.color = Color(0.09, 0.10, 0.13, 1.0)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 12)
	add_child(margin)

	var root := VBoxContainer.new()
	root.add_theme_constant_override("separation", 10)
	margin.add_child(root)

	# ---- 顶栏 ----
	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 8)
	root.add_child(header)
	var title := Label.new()
	title.text = "外观 · 发型 / 脸型 / 手 / 脚"
	title.add_theme_font_size_override("font_size", 18)
	header.add_child(title)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(spacer)

	var sex_label := Label.new()
	sex_label.text = "性别"
	header.add_child(sex_label)
	sex_option = OptionButton.new()
	for s in SEX_OPTIONS:
		sex_option.add_item(s)
	sex_option.item_selected.connect(_on_sex)
	header.add_child(sex_option)

	header.add_child(_btn("随机一套", _on_random))
	header.add_child(_btn("恢复默认", _on_reset))
	header.add_child(_btn("返回角色屏", _on_back))

	# ---- 一键配色预设（发型 + 三处皮肤整套上色） ----
	var combo_row := HBoxContainer.new()
	combo_row.add_theme_constant_override("separation", 6)
	root.add_child(combo_row)
	var combo_title := Label.new()
	combo_title.text = "配色预设"
	combo_title.add_theme_font_size_override("font_size", 12)
	combo_row.add_child(combo_title)
	for i in range(Appearance.COMBOS.size()):
		var row: Array = Appearance.COMBOS[i]
		var b := Button.new()
		b.text = str(row[0])
		b.tooltip_text = "发型 #%s · 皮肤 #%s" % [
			Appearance.color_from_int(int(row[1])).to_html(false),
			Appearance.color_from_int(int(row[2])).to_html(false)]
		b.add_theme_color_override("font_color",
			Appearance.color_from_int(int(row[1])).lerp(Color(1, 1, 1, 1), 0.45))
		b.pressed.connect(_on_combo.bind(i))
		combo_row.add_child(b)
	combo_row.add_child(_btn("随机发色", _on_random_hair_color))
	combo_row.add_child(_btn("取消全部调色", _on_clear_colors))

	# ---- 主体 ----
	var body := HBoxContainer.new()
	body.add_theme_constant_override("separation", 12)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	root.add_child(body)

	# 左：造型预览
	var preview := VBoxContainer.new()
	preview.custom_minimum_size.x = 360
	preview.add_theme_constant_override("separation", 6)
	body.add_child(preview)
	var stage := PanelContainer.new()
	stage.size_flags_vertical = Control.SIZE_EXPAND_FILL
	stage.clip_contents = true
	var stage_style := StyleBoxFlat.new()
	stage_style.bg_color = Color(0.14, 0.16, 0.20, 1.0)
	stage_style.corner_radius_top_left = 6
	stage_style.corner_radius_top_right = 6
	stage_style.corner_radius_bottom_left = 6
	stage_style.corner_radius_bottom_right = 6
	stage.add_theme_stylebox_override("panel", stage_style)
	preview.add_child(stage)
	player = _make_player()
	stage.add_child(player)
	look_label = Label.new()
	look_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	look_label.add_theme_font_size_override("font_size", 12)
	preview.add_child(look_label)

	# 右：四个部位
	var opt_scroll := ScrollContainer.new()
	opt_scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	opt_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(opt_scroll)
	var opts := VBoxContainer.new()
	opts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	opts.add_theme_constant_override("separation", 10)
	opt_scroll.add_child(opts)

	for part in [Appearance.PART_HAIR, Appearance.PART_FACE,
			Appearance.PART_HAND, Appearance.PART_FEET]:
		_build_part_group(opts, int(part))

	# ---- 底栏 ----
	hint_label = Label.new()
	hint_label.add_theme_font_size_override("font_size", 12)
	hint_label.text = "改动立即生效并保存到 user://appearance.json。「色号」是原版 4 档预渲染配色；「自由调色」可任选 RGB —— 保留原画的明暗和描边，只换色族，脸/手/脚只染肤色像素（眼睛、嘴唇、指甲保持原样）。"
	root.add_child(hint_label)


func _build_part_group(parent: VBoxContainer, part: int) -> void:
	var title := Label.new()
	title.text = str(Appearance.PART_LABEL[part])
	title.add_theme_font_size_override("font_size", 14)
	parent.add_child(title)

	var row := GridContainer.new()
	row.columns = 7          # 发型 14 档 / 脸 15 档，7 列刚好两到三行，不用横向滚
	row.add_theme_constant_override("h_separation", 4)
	row.add_theme_constant_override("v_separation", 4)
	parent.add_child(row)
	style_row[part] = row

	if int(Appearance.MAX_COLOR[part]) > 0:
		var color_title := Label.new()
		color_title.text = "色号"
		color_title.add_theme_font_size_override("font_size", 12)
		parent.add_child(color_title)
		var crow := HBoxContainer.new()
		crow.add_theme_constant_override("separation", 4)
		parent.add_child(crow)
		color_row[part] = crow

	# 自由调色：任意 RGB，保留原画明暗层次（见 Recolor.gd）
	var rgb_title := Label.new()
	rgb_title.text = "自由调色"
	rgb_title.add_theme_font_size_override("font_size", 12)
	parent.add_child(rgb_title)
	var rrow := HBoxContainer.new()
	rrow.add_theme_constant_override("separation", 6)
	parent.add_child(rrow)
	var pk := ColorPickerButton.new()
	pk.custom_minimum_size = Vector2(64, 28)
	pk.edit_alpha = false
	pk.tooltip_text = "点开选任意 RGB 颜色：保留原画的明暗与描边，只换色族"
	pk.color_changed.connect(_on_rgb_change.bind(part))
	pk.popup_closed.connect(_on_rgb_commit.bind(part))
	rrow.add_child(pk)
	rgb_picker[part] = pk
	var lab := Label.new()
	lab.add_theme_font_size_override("font_size", 12)
	lab.custom_minimum_size.x = 150
	lab.text = "原版配色"
	rrow.add_child(lab)
	rgb_label[part] = lab
	rrow.add_child(_btn("回到档位色", _on_clear_color.bind(part)))


func _make_player() -> Control:
	var p := Control.new()
	p.name = "Player"
	p.set_script(PlayerScript)
	p.clip_contents = true
	p.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	p.size_flags_vertical = Control.SIZE_EXPAND_FILL

	var bgc := ColorRect.new()
	bgc.name = "BgColor"
	bgc.color = Color(0, 0, 0, 0)
	bgc.set_anchors_preset(Control.PRESET_FULL_RECT)
	bgc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	p.add_child(bgc)

	var bgt := TextureRect.new()
	bgt.name = "BgChecker"
	bgt.set_anchors_preset(Control.PRESET_FULL_RECT)
	bgt.mouse_filter = Control.MOUSE_FILTER_IGNORE
	p.add_child(bgt)

	var center := Control.new()
	center.name = "Center"
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	p.add_child(center)

	var fig := TextureRect.new()
	fig.name = "Figure"
	# 以预览区中心为锚点（CharacterPlayer 用 pivot_offset=90,100 做整数倍缩放，
	# 锚点必须落在框中心，否则放大后往右下溢出）。
	fig.anchor_left = 0.5
	fig.anchor_top = 0.5
	fig.anchor_right = 0.5
	fig.anchor_bottom = 0.5
	fig.offset_left = -90
	fig.offset_top = -100
	fig.offset_right = 90
	fig.offset_bottom = 100
	center.add_child(fig)

	p.set("view_scale_override", 2)
	return p


func _btn(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	return b


# ---------------------------------------------------------------- 缩略图与刷新

func _thumb(part: int, style: int, color: int) -> ImageTexture:
	var gender := int(state.call("gender"))
	var tint := Appearance.look_color(state.get("appearance"), part)
	var key := "%d|%d|%d|%d|%s" % [part, style, color, gender, tint.to_html(true)]
	if _thumb_cache.has(key):
		return _thumb_cache[key]
	var id := Appearance.part_id(part, style, color, gender)
	var tex = null
	if id > 0:
		tex = SpriteComposer.part_thumbnail(id, int(Appearance.PREVIEW_SUB[part]),
			THUMB_BOX, tint, Appearance.part_mode(part))
	_thumb_cache[key] = tex
	return tex


## 色号缩略图**保持原版配色**：它代表「预渲染的 4 档颜色」，
## 跟着自由调色一起变色的话，就没法知道点了会变成什么样。
func _color_thumb(part: int, style: int, color: int) -> ImageTexture:
	var gender := int(state.call("gender"))
	var key := "c%d|%d|%d|%d" % [part, style, color, gender]
	if _thumb_cache.has(key):
		return _thumb_cache[key]
	var id := Appearance.part_id(part, style, color, gender)
	var tex = null
	if id > 0:
		tex = SpriteComposer.part_thumbnail(id, int(Appearance.PREVIEW_SUB[part]), COLOR_BOX)
	_thumb_cache[key] = tex
	return tex


## 该部位「原图本来的颜色」——自由调色没启用时，拾色器从这个颜色起步。
func _palette_color(part: int) -> Color:
	var gender := int(state.call("gender"))
	var f: Dictionary = Appearance.FIELDS[part]
	var style := int(state.get("appearance").get(str(f["style"]), 1))
	var color := 0
	if not str(f["color"]).is_empty():
		color = int(state.get("appearance").get(str(f["color"]), 0))
	var key := "%d|%d|%d|%d" % [part, style, color, gender]
	if _palette_cache.has(key):
		return _palette_cache[key]
	var id := Appearance.part_id(part, style, color, gender)
	var out := Color(0.5, 0.5, 0.5)
	var img := SpriteComposer.part_image(id, int(Appearance.PREVIEW_SUB[part]))
	if img != null:
		out = Recolor.dominant_color(img, Appearance.part_mode(part))
	_palette_cache[key] = out
	return out


func _refresh_all() -> void:
	_syncing = true
	for part in [Appearance.PART_HAIR, Appearance.PART_FACE,
			Appearance.PART_HAND, Appearance.PART_FEET]:
		_refresh_styles(int(part))
		_refresh_colors(int(part))
	_sync_pickers()
	_syncing = false
	_refresh_look_label()
	if player != null:
		player.call("refresh")


## 拾色器与色值文字跟着当前状态走（程序化设色会被 _syncing 挡掉回调，不会互相打架）。
func _sync_pickers() -> void:
	var look: Dictionary = state.get("appearance")
	for part in [Appearance.PART_HAIR, Appearance.PART_FACE,
			Appearance.PART_HAND, Appearance.PART_FEET]:
		var pk: ColorPickerButton = rgb_picker.get(part)
		if pk == null:
			continue
		var custom := Appearance.has_free_color(look, int(part))
		var c := Appearance.look_color(look, int(part)) if custom else _palette_color(int(part))
		pk.color = c
		var lab: Label = rgb_label.get(part)
		if lab != null:
			lab.text = ("自定义 #" + c.to_html(false)) if custom else "原版配色"


func _refresh_styles(part: int) -> void:
	var row: GridContainer = style_row.get(part)
	if row == null:
		return
	for c in row.get_children():
		c.queue_free()
	var f: Dictionary = Appearance.FIELDS[part]
	var style := int(state.get("appearance").get(str(f["style"]), 1))
	var color := 0
	if not str(f["color"]).is_empty():
		color = int(state.get("appearance").get(str(f["color"]), 0))
	var styles := Appearance.available_styles(part, int(state.call("gender")), color)
	var btns: Array = []
	for s in styles:
		var b := Button.new()
		b.custom_minimum_size = Vector2(THUMB_BOX + 12, THUMB_BOX + 26)
		b.icon = _thumb(part, int(s), color)
		b.expand_icon = true
		b.toggle_mode = true
		b.button_pressed = int(s) == style
		b.tooltip_text = "第 %d 档" % int(s)
		b.text = str(s)
		b.vertical_icon_alignment = VERTICAL_ALIGNMENT_TOP
		b.add_theme_font_size_override("font_size", 11)
		b.pressed.connect(_on_style.bind(part, int(s)))
		row.add_child(b)
		btns.append(b)
	style_buttons[part] = btns


func _refresh_colors(part: int) -> void:
	var row: HBoxContainer = color_row.get(part)
	if row == null:
		return
	for c in row.get_children():
		c.queue_free()
	var f: Dictionary = Appearance.FIELDS[part]
	var style := int(state.get("appearance").get(str(f["style"]), 1))
	var color := int(state.get("appearance").get(str(f["color"]), 0))
	var colors := Appearance.available_colors(part, int(state.call("gender")), style)
	var custom := Appearance.has_free_color(state.get("appearance"), part)
	var btns: Array = []
	for c in colors:
		var b := Button.new()
		b.custom_minimum_size = Vector2(COLOR_BOX + 16, COLOR_BOX + 22)
		b.icon = _color_thumb(part, style, int(c))
		b.expand_icon = true
		b.toggle_mode = true
		b.button_pressed = (int(c) == color) and not custom
		b.tooltip_text = "色号 %d（%s）" % [int(c), Appearance.COLOR_LABEL[int(c)]]
		b.text = str(Appearance.COLOR_LABEL[int(c)])
		b.vertical_icon_alignment = VERTICAL_ALIGNMENT_TOP
		b.add_theme_font_size_override("font_size", 11)
		b.pressed.connect(_on_color.bind(part, int(c)))
		row.add_child(b)
		btns.append(b)
	color_buttons[part] = btns


func _refresh_look_label() -> void:
	var look: Dictionary = state.get("appearance")
	look_label.text = Appearance.look_text(look)


# ---------------------------------------------------------------- 交互

func _on_style(part: int, style: int) -> void:
	if _syncing:
		return
	var f: Dictionary = Appearance.FIELDS[part]
	state.call("set_look", str(f["style"]), style)
	if not str(f["color"]).is_empty():
		# 换档后该档未必有当前色号 → 夹回第一个可用色
		var cur := int(state.get("appearance").get(str(f["color"]), 0))
		var cols := Appearance.available_colors(part, int(state.call("gender")), style)
		if not cols.has(cur) and not cols.is_empty():
			state.call("set_look", str(f["color"]), int(cols[0]))
	_sync_sex_option()
	_refresh_all()


func _on_color(part: int, color: int) -> void:
	if _syncing:
		return
	var f: Dictionary = Appearance.FIELDS[part]
	state.call("set_look", str(f["color"]), color)
	# 点原版色号 = 回到预渲染配色，自由调色自动关掉（否则点了没反应）
	if Appearance.has_free_color(state.get("appearance"), part):
		state.call("clear_look_color", str(f["rgb"]))
	_refresh_all()


# ---------------------------------------------------------------- 自由调色

func _on_rgb_change(color: Color, part: int) -> void:
	if _syncing:
		return
	var f: Dictionary = Appearance.FIELDS[part]
	state.call("set_look_color", str(f["rgb"]), color, false)   # 拖动中不落盘
	var lab: Label = rgb_label.get(part)
	if lab != null:
		lab.text = "自定义 #" + color.to_html(false)
	_refresh_look_label()


## 拾色器弹窗关闭 = 一次调色结束：落盘 + 把缩略图刷成新色调。
func _on_rgb_commit(part: int) -> void:
	if _syncing:
		return
	state.call("save_appearance")
	_palette_cache.clear()
	_syncing = true
	_refresh_styles(part)
	_refresh_colors(part)
	_syncing = false


func _on_clear_color(part: int) -> void:
	if _syncing:
		return
	var f: Dictionary = Appearance.FIELDS[part]
	state.call("clear_look_color", str(f["rgb"]))
	_refresh_all()


func _on_combo(idx: int) -> void:
	var base: Dictionary = state.get("appearance")
	state.call("set_look_all", Appearance.combo_look(idx, base))
	_palette_cache.clear()
	_refresh_all()


func _on_random_hair_color() -> void:
	var c := Color.from_hsv(randf(), randf_range(0.45, 0.95), randf_range(0.55, 1.0))
	state.call("set_look_color", "hair_rgb", c)
	_palette_cache.clear()
	_refresh_all()


func _on_clear_colors() -> void:
	state.call("set_look_all", {"hair_rgb": -1, "face_rgb": -1, "hand_rgb": -1, "feet_rgb": -1})
	_palette_cache.clear()
	_refresh_all()


func _on_sex(idx: int) -> void:
	if _syncing or idx < 0 or idx >= SEX_OPTIONS.size():
		return
	state.call("set_sex", SEX_OPTIONS[idx])
	_thumb_cache.clear()   # 性别变了，所有缩略图都要按新性别重算
	_refresh_all()


func _on_random() -> void:
	state.call("randomize_appearance")
	_refresh_all()


func _on_reset() -> void:
	state.call("reset_appearance")
	_refresh_all()


func _on_back() -> void:
	# 拾色器可能还开着（拖动中的改动只广播没落盘），离开前补一次
	state.call("save_appearance")
	get_tree().change_scene_to_file("res://scenes/CharacterScreen.tscn")


func _sync_sex_option() -> void:
	if sex_option == null:
		return
	var cur := str(state.get("sex"))
	var idx := maxi(0, SEX_OPTIONS.find(cur))
	_syncing = true
	sex_option.select(idx)
	_syncing = false


func _maybe_capture() -> void:
	if not OS.has_environment("WORLDOL_CAPTURE"):
		return
	await get_tree().process_frame
	await get_tree().process_frame
	await get_tree().process_frame
	var img := get_viewport().get_texture().get_image()
	if img != null:
		img.save_png("res://_out/appearance_screen.png")
		print("[capture] _out/appearance_screen.png")
	if OS.has_environment("WORLDOL_QUITAFTER"):
		await get_tree().create_timer(float(OS.get_environment("WORLDOL_QUITAFTER"))).timeout
		get_tree().quit()
