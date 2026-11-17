extends VBoxContainer
## 属性面板组件（P5 组合）：只订阅 ScreenState，不直接操作播放器。
##
## 数值来源是 data/baselines/character_stats.json 的 20 个基准角色快照
## （原版 0056 get() 口径），不是实时属性公式 —— 界面里明确标注，避免误解。

const Stats = preload("res://scripts/Stats.gd")
const Naming = preload("res://scripts/Naming.gd")

@onready var case_option: OptionButton = $Toolbar/CaseOption
@onready var mode_option: OptionButton = $Toolbar/ModeOption
@onready var meta: Label = $Meta
@onready var grid: GridContainer = $Scroll/Grid

var state


func _ready() -> void:
	for c in Stats.cases():
		case_option.add_item(str(c.get("name", "?")))
	mode_option.add_item("战力评分 · 38 项")
	mode_option.add_item("战斗面板 · 59 项")
	case_option.item_selected.connect(_on_case)
	mode_option.item_selected.connect(_on_mode)


func bind(s) -> void:
	state = s
	if not state.is_connected("state_changed", Callable(self, "_on_state")):
		state.connect("state_changed", Callable(self, "_on_state"))
	refresh()


func _on_case(idx: int) -> void:
	if state != null:
		state.call("set_case", idx)


func _on_mode(idx: int) -> void:
	if state != null:
		state.call("set_mode", idx)


func _on_state(_field: String) -> void:
	refresh()


func refresh() -> void:
	if state == null:
		return
	case_option.select(clampi(int(state.get("case_index")), 0, maxi(case_option.item_count - 1, 0)))
	mode_option.select(clampi(int(state.get("mode_index")), 0, 1))

	var cases := Stats.cases()
	var idx := int(state.get("case_index"))
	if idx < 0 or idx >= cases.size():
		return
	var c: Dictionary = cases[idx]
	var mode := "battle" if int(state.get("mode_index")) == 1 else "rating"
	var bucket: Dictionary = c.get(mode, {})
	var values: Dictionary = bucket.get("stats", {})
	var role: Dictionary = c.get("role", {})
	var formation: Dictionary = c.get("formation", {})
	var inv = role.get("inventory", [])
	var skills = role.get("skills", {})

	meta.text = "%s｜等级 %s｜生命 %s · 魔法 %s｜装备 %d 件 · 技能 %d 条\n阵法：%s｜%s\n数值来源：20 角色基线快照（原版 0056 get() 口径），非实时公式" % [
		str(c.get("name", "")), Naming.number(role.get("level", 0)),
		Naming.number(role.get("hp", 0)), Naming.number(role.get("mp", 0)),
		inv.size(), skills.size(), _formation_text(formation), str(c.get("note", ""))
	]

	for child in grid.get_children():
		grid.remove_child(child)
		child.free()
	for key in values.keys():
		var name_label := Label.new()
		name_label.text = Naming.stat(str(key))
		name_label.custom_minimum_size.x = 170
		var value_label := Label.new()
		value_label.text = Naming.number(values[key])
		value_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		value_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		grid.add_child(name_label)
		grid.add_child(value_label)


func _formation_text(f: Dictionary) -> String:
	var mode := str(f.get("mode", "none"))
	match mode:
		"none": return "未启用"
		"add": return "叠加模式"
		"replace": return "替换模式"
		_: return mode
