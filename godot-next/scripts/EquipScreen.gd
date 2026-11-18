extends Panel
## 装备屏（初步版）：造型预览 + 部位槽 + 候选装备列表 + 属性变化。
## 只做基础属性与外观，强化 / 鉴定 / 套装不做。无穿戴限制。
##
## 数据来源：Equipment.gd（规则）+ GameData.items（2505 分片懒加载）+ ScreenState.equipped。

const Equipment = preload("res://scripts/Equipment.gd")
const GameData = preload("res://scripts/GameData.gd")
const Stats = preload("res://scripts/Stats.gd")
const Naming = preload("res://scripts/Naming.gd")
const CharacterPlayerScript = preload("res://scripts/CharacterPlayer.gd")

@onready var back_button: Button = $Margin/Root/Header/BackButton
@onready var title: Label = $Margin/Root/Header/Title
@onready var player: Control = $Margin/Root/Body/Preview/Stage/Player
@onready var look_label: Label = $Margin/Root/Body/Preview/LookLabel
@onready var slot_list: ItemList = $Margin/Root/Body/Slots/SlotScroll/SlotList
@onready var item_list: ItemList = $Margin/Root/Body/Items/ItemScroll/ItemList
@onready var item_title: Label = $Margin/Root/Body/Items/ItemTitle
@onready var stat_grid: GridContainer = $Margin/Root/Body/Stats/StatScroll/StatGrid
@onready var stat_meta: Label = $Margin/Root/Body/Stats/Meta
@onready var footer: Label = $Margin/Root/Footer

var state
var game_data = GameData.new()
var _current_slot: String = "weapon"
var _slot_order: Array = []
var _item_ids: Array = []
var _refreshing := false


func _ready() -> void:
	state = get_node_or_null("/root/ScreenState")
	if state == null:
		push_warning("[EquipScreen] 未找到 ScreenState Autoload，装备操作不可用")
	# 播放器脚本在场景里预设，_ready 已自动调用过（棋盘背景等）；这里只注入状态。
	if player.has_method("bind") and state != null:
		player.call("bind", state)
	if "view_scale_override" in player:
		player.set("view_scale_override", 2)
		player.call("refresh")

	title.text = "世界OL · 装备（基础版）"
	back_button.text = "← 返回角色屏"
	_item_ids = []
	_fill_slots()
	_wire()
	if state != null and not state.is_connected("state_changed", Callable(self, "_on_state")):
		state.connect("state_changed", Callable(self, "_on_state"))
	_apply_capture_equip()
	_select_slot("weapon")
	_refresh()
	_maybe_capture()


## 截图/演示用：WORLDOL_EQUIP=weapon:20300,clothes:10032 预置穿戴，方便无交互环境下看效果。
func _apply_capture_equip() -> void:
	if not OS.has_environment("WORLDOL_EQUIP") or state == null:
		return
	var spec := OS.get_environment("WORLDOL_EQUIP")
	state.call("clear_equipment")   # 先清空旧存档，避免多次截图时装备串场
	for pair in spec.split(","):
		var kv := pair.split(":")
		if kv.size() == 2 and kv[0] != "":
			state.call("equip", str(kv[0]), int(kv[1]))


func _wire() -> void:
	back_button.pressed.connect(_on_back)
	slot_list.item_selected.connect(_on_slot_selected)
	item_list.item_selected.connect(_on_item_selected)


func _fill_slots() -> void:
	slot_list.clear()
	_slot_order = []
	for d in Equipment.slot_defs():
		var slot := str(d.slot)
		_slot_order.append(slot)
		slot_list.add_item(str(d.label))
	# 默认选武器
	var idx := _slot_order.find("weapon")
	if idx >= 0:
		slot_list.select(idx)


func _on_back() -> void:
	get_tree().change_scene_to_file("res://scenes/CharacterScreen.tscn")


func _on_slot_selected(idx: int) -> void:
	if idx < 0 or idx >= _slot_order.size():
		return
	_select_slot(str(_slot_order[idx]))


func _select_slot(slot: String) -> void:
	_current_slot = slot
	var idx := _slot_order.find(slot)
	if idx >= 0:
		slot_list.select(idx)
	_rebuild_item_list()


func _rebuild_item_list() -> void:
	item_list.clear()
	_item_ids = Equipment.items_for_slot(game_data, _current_slot, 200)
	var eq: Dictionary = state.get("equipped") if state != null and state.get("equipped") is Dictionary else {}
	var worn_id := int(eq.get(_current_slot, 0))
	var worn_name := Equipment.item_name(game_data, worn_id) if worn_id > 0 else ""
	for id in _item_ids:
		var name := Equipment.item_name(game_data, id)
		var label := name
		if id == worn_id:
			label = "✓ " + name + "（已穿）"
		item_list.add_item(label)
	item_title.text = "%s · 可选 %d 件（当前：%s）" % [
		Equipment.label_of_slot(_current_slot), _item_ids.size(),
		worn_name if worn_name != "" else "无"
	]


func _on_item_selected(idx: int) -> void:
	if state == null or idx < 0 or idx >= _item_ids.size():
		return
	var id := int(_item_ids[idx])
	var eq: Dictionary = state.get("equipped") if state.get("equipped") is Dictionary else {}
	if int(eq.get(_current_slot, 0)) == id:
		state.call("unequip", _current_slot)   # 再点一次已穿的 = 卸下
	else:
		state.call("equip", _current_slot, id)


func _on_state(field: String) -> void:
	if field == "equip" or field == "reset" or field == "sex" or field == "pose":
		_refresh()


func _refresh() -> void:
	_refreshing = true
	var eq: Dictionary = state.get("equipped") if state != null and state.get("equipped") is Dictionary else {}
	_rebuild_item_list()

	# 槽位标签：显示已穿装备名（截取）
	for i in range(_slot_order.size()):
		var slot := str(_slot_order[i])
		var worn_id := int(eq.get(slot, 0))
		if worn_id > 0:
			var nm := Equipment.item_name(game_data, worn_id)
			if nm.length() > 7:
				nm = nm.substr(0, 6) + "…"
			slot_list.set_item_text(i, "%s：%s" % [Equipment.label_of_slot(slot), nm])
		else:
			slot_list.set_item_text(i, "%s：—" % Equipment.label_of_slot(slot))

	# 外观描述
	var base_mid := int(state.call("model_id"))
	var look := Equipment.appearance(game_data, base_mid, eq)
	var look_text := " + ".join(look.detail) if not (look.detail as Array).is_empty() else "基础造型"
	look_label.text = "造型：" + look_text

	# 底部提示：背部/坐骑需整套造型系统，当前只加属性不换外观
	var pending: Array = []
	if eq.has("back"): pending.append("背部")
	if eq.has("transport"): pending.append("坐骑")
	footer.text = "点击部位 → 选装备穿上；再点已穿装备卸下。无穿戴限制 · 属性与外观实时变化"
	if not pending.is_empty():
		footer.text += "    ⚠ " + "/".join(pending) + "外观暂未实现（需整套造型系统），仅属性生效"

	_refresh_stats(eq)
	_refreshing = false


func _refresh_stats(eq: Dictionary) -> void:
	for child in stat_grid.get_children():
		stat_grid.remove_child(child)
		child.free()

	var bonus := Equipment.aggregate_stats(game_data, eq)
	stat_meta.text = "穿上装备后的属性变化（在所选角色基线之上叠加）· 共 %d 项属性受影响" % bonus.size()
	if bonus.is_empty():
		var empty := Label.new()
		empty.text = "（未穿装备，无属性加成）"
		empty.custom_minimum_size.x = 400
		stat_grid.add_child(empty)
		return
	# 按属性键排序，输出 名称 / +数值
	var keys := bonus.keys()
	keys.sort()
	for key in keys:
		var name_label := Label.new()
		name_label.text = Naming.stat(str(key))
		name_label.custom_minimum_size.x = 170
		var value_label := Label.new()
		value_label.text = "+%s" % Naming.number(bonus[key])
		value_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		value_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		stat_grid.add_child(name_label)
		stat_grid.add_child(value_label)


func _maybe_capture() -> void:
	if not OS.has_environment("WORLDOL_CAPTURE"):
		return
	await get_tree().process_frame
	await get_tree().process_frame
	var tex := get_viewport().get_texture()
	if tex == null:
		return
	var img := tex.get_image()
	if img == null:
		return
	var out := ProjectSettings.globalize_path("res://_out")
	DirAccess.make_dir_recursive_absolute(out)
	var err := img.save_png(out + "/equip_screen.png")
	print("[capture] 装备屏保存 err=", err)


func _unhandled_key_input(event: InputEvent) -> void:
	if not (event is InputEventKey):
		return
	var key := event as InputEventKey
	if not key.pressed or key.echo:
		return
	if key.physical_keycode == KEY_ESCAPE:
		_on_back()
		get_viewport().set_input_as_handled()
