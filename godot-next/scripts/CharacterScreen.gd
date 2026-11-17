extends Panel
## 角色屏主控制器（P5 组合）：把全局状态注入两个组件，把控件接到状态 setter。
## 快捷键用 physical_keycode（P9），避免中文输入法吞掉字母键。

const ScreenStateScript = preload("res://scripts/ScreenState.gd")
const GameData = preload("res://scripts/GameData.gd")
const Stats = preload("res://scripts/Stats.gd")

@onready var player: Control = $Margin/Root/Body/PlayerSide/Stage/Player
@onready var stats_panel: VBoxContainer = $Margin/Root/Body/StatsSide
@onready var title: Label = $Margin/Root/Header/Title
@onready var hint: Label = $Margin/Root/Header/Hint
@onready var world_button: Button = $Margin/Root/Header/WorldButton
@onready var sex_option: OptionButton = $Margin/Root/Body/PlayerSide/Controls/SexOption
@onready var pose_option: OptionButton = $Margin/Root/Body/PlayerSide/Controls/PoseOption
@onready var anim_option: OptionButton = $Margin/Root/Body/PlayerSide/Controls/AnimOption
@onready var all_frames_check: CheckBox = $Margin/Root/Body/PlayerSide/Controls/AllFramesCheck
@onready var speed_option: OptionButton = $Margin/Root/Body/PlayerSide/Controls/SpeedOption
@onready var scale_option: OptionButton = $Margin/Root/Body/PlayerSide/Controls/ScaleOption
@onready var bg_option: OptionButton = $Margin/Root/Body/PlayerSide/Controls/BgOption
@onready var prev_button: Button = $Margin/Root/Body/PlayerSide/Controls/PrevButton
@onready var next_button: Button = $Margin/Root/Body/PlayerSide/Controls/NextButton
@onready var play_button: Button = $Margin/Root/Body/PlayerSide/Controls/PlayButton
@onready var reload_button: Button = $Margin/Root/Body/PlayerSide/Controls/ReloadButton
@onready var reset_button: Button = $Margin/Root/Body/PlayerSide/Controls/ResetButton
@onready var frame_label: Label = $Margin/Root/Body/PlayerSide/FrameBar/FrameLabel
@onready var frame_slider: HSlider = $Margin/Root/Body/PlayerSide/FrameBar/FrameSlider
@onready var frame_count_label: Label = $Margin/Root/Body/PlayerSide/FrameBar/FrameCount
@onready var footer: Label = $Margin/Root/Footer

var screen_state
var _refreshing := false
var game_data = GameData.new()   # 分片索引查询是非静态方法，需要实例


func _ready() -> void:
	# 正常运行时由 Autoload 提供；headless 自检脚本里自建一个等价实例。
	screen_state = get_node_or_null("/root/ScreenState")
	if screen_state == null:
		screen_state = ScreenStateScript.new()
		screen_state.name = "ScreenState"
		get_tree().root.add_child(screen_state)
		screen_state.call("load_selection")

	player.call("bind", screen_state)
	stats_panel.call("bind", screen_state)

	title.text = "世界OL · 角色屏"
	hint.text = "改 PNG 保存后，下一帧立刻生效"
	_populate_options()
	_wire()
	if not screen_state.is_connected("state_changed", Callable(self, "_on_state")):
		screen_state.connect("state_changed", Callable(self, "_on_state"))
	_refresh(true)
	_maybe_capture()


func _populate_options() -> void:
	sex_option.clear()
	for s in ["女", "男"]:
		sex_option.add_item(s)
	pose_option.clear()
	for p in ["正常", "战斗"]:
		pose_option.add_item(p)
	speed_option.clear()
	for s in ["0.5x", "1x", "2x", "4x"]:
		speed_option.add_item(s)
	scale_option.clear()
	for s in ["1x", "2x", "3x", "4x"]:
		scale_option.add_item(s)
	bg_option.clear()
	for s in ["棋盘", "纯白", "纯黑"]:
		bg_option.add_item(s)


func _wire() -> void:
	sex_option.item_selected.connect(_on_sex)
	pose_option.item_selected.connect(_on_pose)
	anim_option.item_selected.connect(_on_anim)
	all_frames_check.toggled.connect(_on_all_frames)
	speed_option.item_selected.connect(_on_speed)
	scale_option.item_selected.connect(_on_scale)
	bg_option.item_selected.connect(_on_bg)
	prev_button.pressed.connect(func(): screen_state.call("step", -1))
	next_button.pressed.connect(func(): screen_state.call("step", 1))
	play_button.pressed.connect(func(): screen_state.call("toggle_play"))
	reload_button.pressed.connect(func(): screen_state.call("reload_assets"))
	reset_button.pressed.connect(func(): screen_state.call("reset"))
	frame_slider.value_changed.connect(_on_frame_slider)
	world_button.pressed.connect(_on_world)


func _on_sex(idx: int) -> void:
	screen_state.call("set_sex", "女" if idx == 0 else "男")
func _on_pose(idx: int) -> void:
	screen_state.call("set_pose", "正常" if idx == 0 else "战斗")
func _on_anim(idx: int) -> void:
	screen_state.call("set_anim", idx)
func _on_all_frames(v: bool) -> void:
	screen_state.call("set_all_frames", v)
func _on_speed(idx: int) -> void:
	screen_state.call("set_speed", idx)
func _on_scale(idx: int) -> void:
	screen_state.call("set_scale", idx)
func _on_bg(idx: int) -> void:
	screen_state.call("set_bg", idx)
func _on_frame_slider(v: float) -> void:
	if not _refreshing:
		screen_state.call("set_frame", int(v))


func _on_world() -> void:
	get_tree().change_scene_to_file("res://scenes/WorldScreen.tscn")


func _on_state(field: String) -> void:
	var rebuild := ["sex", "pose", "assets", "all_frames", "anim", "reset"].has(field)
	_refresh(rebuild)


func _refresh(rebuild_anim: bool) -> void:
	_refreshing = true
	sex_option.select(0 if str(screen_state.get("sex")) == "女" else 1)
	pose_option.select(0 if str(screen_state.get("pose")) == "正常" else 1)
	speed_option.select(int(screen_state.get("speed_index")))
	scale_option.select(int(screen_state.get("view_scale")) - 1)
	bg_option.select(int(screen_state.get("bg_index")))
	all_frames_check.set_pressed_no_signal(bool(screen_state.get("all_frames")))

	if rebuild_anim:
		anim_option.clear()
		var anims: Array = screen_state.call("animations")
		if anims.is_empty():
			anim_option.add_item("（无动作数据）")
		for a in anims:
			var seq: Array = a.get("frames", [])
			anim_option.add_item("%s · %d 帧" % [str(a.get("name", "")), seq.size()])
	if anim_option.item_count > 0:
		anim_option.select(clampi(int(screen_state.get("anim_index")), 0, anim_option.item_count - 1))

	var count := int(screen_state.call("frame_count"))
	var idx := int(screen_state.get("frame_index"))
	frame_slider.min_value = 0.0
	frame_slider.max_value = float(maxi(count - 1, 0))
	frame_slider.step = 1.0
	frame_slider.set_value_no_signal(float(clampi(idx, 0, maxi(count - 1, 0))))
	# 「步」= 动作序列里的位置（同一帧号会重复出现以控制节奏）；
	# 「帧号」= 原版 model json 里的 frames 键。两者不是一回事，分开写。
	frame_label.text = "第 %d 步" % (idx + 1)
	frame_count_label.text = "/ %d · 帧号 %d" % [count, int(screen_state.call("current_frame_no"))]
	play_button.text = "⏸ 暂停" if bool(screen_state.get("playing")) else "▶ 播放"

	footer.text = "Model %d（%s / %s）· 动作 %s · 素材 %d 个 · 数据索引：道具 %d / 技能 %d / 怪物 %d / 宠物 %d（按需加载）    快捷键：← → 逐帧 · 空格 播放 · 1/2 性别 · 3/4 姿势 · R 重载 · M 进入地图" % [
		int(screen_state.call("model_id")), str(screen_state.get("sex")), str(screen_state.get("pose")),
		anim_option.get_item_text(anim_option.selected) if anim_option.selected >= 0 else "—",
		GameData.asset_count(), game_data.count("items"), game_data.count("skills"),
		game_data.count("monsters"), game_data.count("petProfiles")
	]
	_refreshing = false


## 设环境变量 WORLDOL_CAPTURE=1 时把当前屏存成 PNG，用于无窗口环境下的布局核对。
## 用环境变量而不是命令行参数：Godot 会吞掉 -- 之后的自定义参数。
func _maybe_capture() -> void:
	if not OS.has_environment("WORLDOL_CAPTURE"):
		return
	await get_tree().process_frame
	await get_tree().process_frame
	print("[capture] sex=", screen_state.get("sex"), " pose=", screen_state.get("pose"),
		" model=", screen_state.call("model_id"))
	var tex := get_viewport().get_texture()
	if tex == null:
		print("[capture] headless 下 viewport texture 不可用，跳过截图")
		return
	var img := tex.get_image()
	if img == null:
		return
	var out := ProjectSettings.globalize_path("res://_out")
	DirAccess.make_dir_recursive_absolute(out)
	var err := img.save_png(out + "/character_screen.png")
	print("[capture] 保存 ", out, "/character_screen.png err=", err)


func _unhandled_key_input(event: InputEvent) -> void:
	if not (event is InputEventKey):
		return
	var key := event as InputEventKey
	if not key.pressed or key.echo:
		return
	match key.physical_keycode:
		KEY_LEFT: screen_state.call("step", -1)
		KEY_RIGHT: screen_state.call("step", 1)
		KEY_SPACE: screen_state.call("toggle_play")
		KEY_1: screen_state.call("set_sex", "女")
		KEY_2: screen_state.call("set_sex", "男")
		KEY_3: screen_state.call("set_pose", "正常")
		KEY_4: screen_state.call("set_pose", "战斗")
		KEY_R: screen_state.call("reload_assets")
		KEY_M: _on_world()
		_: return
	get_viewport().set_input_as_handled()
