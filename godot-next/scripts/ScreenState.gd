extends Node
## 角色屏全局状态（Autoload 名 ScreenState，见 project.godot）。
##
## 架构范式：
##   P3 Autoload 持有全局状态，变更 emit 广播；
##   P1 UI 只调用 setter，播放器 / 属性面板订阅信号，彼此不直接调用；
##   P8 选择持久化到 JSON，带 version 字段，缺字段或版本不符一律回默认值。
##
## 状态按「搭配」组织：性别 + 姿势 → 4 套基础 Model；动作 → anis 帧序列。
## 数值面板用 20 个基准角色快照（见 Stats.gd），不是实时属性公式。

const SpriteComposer = preload("res://scripts/SpriteComposer.gd")
const Naming = preload("res://scripts/Naming.gd")
const Appearance = preload("res://scripts/Appearance.gd")

const SAVE_PATH = "user://character_screen.json"
const SAVE_VERSION = 1
## 装备单独存，不碰 character_screen.json 的 version=1 结构（角色屏 44 项自检依赖它）。
const EQUIP_PATH = "user://equipment.json"
## 外观（发型/脸型/手/脚）也单独存，理由同上。
const LOOK_PATH = "user://appearance.json"

const SEXES = ["女", "男"]
const POSES = ["正常", "战斗"]
# 原版四套基础造型：女 300/400、男 100/200
const MODEL_TABLE = {"女|正常": 300, "女|战斗": 400, "男|正常": 100, "男|战斗": 200}
const SPEEDS = [0.5, 1.0, 2.0, 4.0]
const SCALES = [1, 2, 3, 4]

signal state_changed(field: String)

var sex: String = "女"
var pose: String = "正常"
var anim_index: int = 0
var frame_index: int = 0
var all_frames: bool = false
var playing: bool = true
var speed_index: int = 1
var view_scale: int = 3
var bg_index: int = 0          # 0 棋盘 / 1 纯白 / 2 纯黑
var case_index: int = 0        # 20 个基准角色
var mode_index: int = 0        # 0 战力评分 / 1 战斗面板
## 穿戴中的装备：{部位 slot: 道具 id}。无穿戴限制，穿脱只改这张表并广播。
var equipped: Dictionary = {}
## 外观：发型/脸型/手部/脚部的档位（见 Appearance.gd）。性别不在这里，跟随 sex。
var appearance: Dictionary = {}

var _anim_cache: Dictionary = {}


func _ready() -> void:
	load_selection()
	load_equipment()
	load_appearance()


# ---------------------------------------------------------------- 查询

func model_id() -> int:
	return int(MODEL_TABLE.get(sex + "|" + pose, 300))


## 性别位：女=1、男=0（原版位域 OFFSET_SEX + LEN_SEX=1，女 1 男 0）。
func gender() -> int:
	return 1 if sex == "女" else 0


## 当前 Model 的全部动作：[{id, name, frames:[帧号…], loops}]
func animations() -> Array:
	var mid := model_id()
	if _anim_cache.has(mid):
		return _anim_cache[mid]
	var out: Array = []
	var path := "res://assets/sprite_model/" + str(mid) + ".json"
	if FileAccess.file_exists(path):
		var parsed = JSON.parse_string(FileAccess.get_file_as_string(path))
		if parsed is Dictionary:
			for a in parsed.get("anis", []):
				if not (a is Dictionary):
					continue
				var seq: Array = []
				for g in a.get("gesture", []):
					if g is Array and not g.is_empty():
						seq.append(int(g[0]))
				var aid := int(a.get("id", -1))
				out.append({
					"id": aid,
					"name": Naming.animation(aid),
					"frames": seq,
					"loops": int(a.get("loops", 1))
				})
	_anim_cache[mid] = out
	return out


## 逐帧依据：动作序列（含重复帧，用来还原节奏）或该 Model 的全部帧号。
func frame_sequence() -> Array:
	if all_frames:
		return SpriteComposer.frame_numbers(model_id())
	var anims := animations()
	if anim_index >= 0 and anim_index < anims.size():
		var seq: Array = anims[anim_index].get("frames", [])
		if not seq.is_empty():
			return seq
	return SpriteComposer.frame_numbers(model_id())


func frame_count() -> int:
	return frame_sequence().size()


func current_frame_no() -> int:
	var seq := frame_sequence()
	if seq.is_empty():
		return 0
	return int(seq[clampi(frame_index, 0, seq.size() - 1)])


func speed_value() -> float:
	return float(SPEEDS[clampi(speed_index, 0, SPEEDS.size() - 1)])


# ---------------------------------------------------------------- setter

func _commit(field: String) -> void:
	frame_index = clampi(frame_index, 0, maxi(frame_count() - 1, 0))
	state_changed.emit(field)
	save_selection()


func set_sex(value: String) -> void:
	if not SEXES.has(value) or value == sex:
		return
	sex = value
	anim_index = 0
	frame_index = 0
	_commit("sex")


func set_pose(value: String) -> void:
	if not POSES.has(value) or value == pose:
		return
	pose = value
	anim_index = 0
	frame_index = 0
	_commit("pose")


func set_anim(idx: int) -> void:
	anim_index = clampi(idx, 0, maxi(animations().size() - 1, 0))
	frame_index = 0
	_commit("anim")


func set_frame(idx: int) -> void:
	frame_index = clampi(idx, 0, maxi(frame_count() - 1, 0))
	state_changed.emit("frame")   # 逐帧不落盘，避免拖动滑块时反复写文件


func step(dir: int) -> void:
	var n := frame_count()
	if n < 2:
		return
	frame_index = (frame_index + dir + n) % n
	state_changed.emit("frame")


func toggle_play() -> void:
	playing = not playing
	_commit("playing")


func set_speed(idx: int) -> void:
	speed_index = clampi(idx, 0, SPEEDS.size() - 1)
	_commit("speed")


func set_scale(idx: int) -> void:
	view_scale = int(SCALES[clampi(idx, 0, SCALES.size() - 1)])
	_commit("scale")


func set_bg(idx: int) -> void:
	bg_index = clampi(idx, 0, 2)
	_commit("bg")


func set_all_frames(value: bool) -> void:
	all_frames = value
	frame_index = 0
	_commit("all_frames")


func set_case(idx: int) -> void:
	case_index = clampi(idx, 0, 19)
	_commit("case")


func set_mode(idx: int) -> void:
	mode_index = clampi(idx, 0, 1)
	_commit("mode")


# ---------------------------------------------------------------- 装备（无穿戴限制）

## 穿上/替换某部位装备。item_id<=0 视为卸下。不检查等级/属性需求。
func equip(slot: String, item_id: int) -> void:
	if slot.is_empty():
		return
	if item_id <= 0:
		equipped.erase(slot)
	else:
		equipped[slot] = item_id
	state_changed.emit("equip")
	save_equipment()


func unequip(slot: String) -> void:
	equip(slot, 0)


func clear_equipment() -> void:
	equipped.clear()
	state_changed.emit("equip")
	save_equipment()


func save_equipment() -> void:
	var data := {"version": 1, "equipped": equipped}
	var f := FileAccess.open(EQUIP_PATH, FileAccess.WRITE)
	if f == null:
		return
	f.store_string(JSON.stringify(data, "\t"))
	f.close()


func load_equipment() -> void:
	if not FileAccess.file_exists(EQUIP_PATH):
		return
	var raw = JSON.parse_string(FileAccess.get_file_as_string(EQUIP_PATH))
	if not (raw is Dictionary) or int(raw.get("version", -1)) != 1:
		return
	var e = raw.get("equipped", {})
	if e is Dictionary:
		equipped = e.duplicate()


## 改过 sprite_model/*.json 后点「重新载入」：清动作缓存，重读帧表。
## PNG 本来就是每帧从磁盘读，不需要额外处理。
func reload_assets() -> void:
	_anim_cache.clear()
	state_changed.emit("assets")


# ---------------------------------------------------------------- 外观（发型/脸型/手/脚）

## 改单个外观字段（hair_style / hair_color / face_style / hand_style / hand_color /
## feet_style / feet_color，以及自由调色用的 *_rgb）。非法值静默忽略。
## save=false 时只广播不落盘（拖拾色器时避免每动一下就写文件）。
func set_look(field: String, value: int, save: bool = true) -> void:
	var is_color := false
	var known := false
	for part in [0, 1, 2, 3]:
		var f: Dictionary = Appearance.FIELDS[part]
		if str(f["style"]) == field or (not str(f["color"]).is_empty() and str(f["color"]) == field):
			known = true
			break
		if str(f["rgb"]) == field:
			known = true
			is_color = true
			break
	if not known:
		return
	if is_color and (value < -1 or value > 0xFFFFFF):
		return
	if int(appearance.get(field, -999)) == value:
		return
	appearance[field] = value
	state_changed.emit("look")
	if save:
		save_appearance()


## 自由调色：给某部位设任意颜色（Color 版）。
func set_look_color(field: String, color: Color, save: bool = true) -> void:
	set_look(field, Appearance.color_to_int(color), save)


## 关掉某部位的自由调色，回到原版 4 档配色。
func clear_look_color(field: String) -> void:
	set_look(field, -1)


## 整体替换（预设 / 随机 / 截图注入）。
func set_look_all(look: Dictionary) -> void:
	for k in look.keys():
		appearance[str(k)] = int(look[k])
	state_changed.emit("look")
	save_appearance()


func randomize_appearance() -> void:
	set_look_all(Appearance.random_look(gender()))


func reset_appearance() -> void:
	set_look_all(Appearance.defaults(gender()))


## 当前实际使用的四个部件图号（给调试/验收用）。
func resolved_parts() -> Dictionary:
	return Appearance.resolve(appearance, gender())


func save_appearance() -> void:
	var data := {"version": 1, "look": appearance}
	var f := FileAccess.open(LOOK_PATH, FileAccess.WRITE)
	if f == null:
		return
	f.store_string(JSON.stringify(data, "\t"))
	f.close()


func load_appearance() -> void:
	var base := Appearance.defaults(gender())
	if FileAccess.file_exists(LOOK_PATH):
		var raw = JSON.parse_string(FileAccess.get_file_as_string(LOOK_PATH))
		if raw is Dictionary and int(raw.get("version", -1)) == 1:
			var look = raw.get("look", {})
			if look is Dictionary:
				for k in base.keys():
					if look.has(k):
						base[k] = int(look[k])
	appearance = base
	_apply_look_env()


## 截图 / 演示用：WORLDOL_LOOK="hair_style:5,hair_color:2,hair_rgb:#ff8800"
## （rgb 收 #RRGGBB / 0xRRGGBB / 十进制；写 -1 关掉）
## ★ 只改内存、不写盘，且必须放在 load_appearance 末尾 —— 否则会被存档覆盖回去。
func _apply_look_env() -> void:
	var spec := OS.get_environment("WORLDOL_LOOK")
	if spec.is_empty():
		return
	for pair in spec.split(","):
		var kv := pair.split(":")
		if kv.size() < 2:
			continue
		var key := kv[0].strip_edges()
		var raw := kv[1].strip_edges()
		if raw.begins_with("#"):
			appearance[key] = Appearance.color_to_int(Color.from_string(raw, Color.WHITE))
		elif raw.begins_with("0x"):
			appearance[key] = raw.substr(2).hex_to_int()
		else:
			appearance[key] = int(raw)


func reset() -> void:
	sex = "女"
	pose = "正常"
	anim_index = 0
	frame_index = 0
	all_frames = false
	playing = true
	speed_index = 1
	view_scale = 3
	bg_index = 0
	case_index = 0
	mode_index = 0
	equipped.clear()
	appearance = Appearance.defaults(gender())
	_anim_cache.clear()
	_commit("reset")
	save_equipment()
	save_appearance()


# ---------------------------------------------------------------- 选择持久化（P8）

func save_selection() -> void:
	var data := {
		"version": SAVE_VERSION,
		"sex": sex, "pose": pose, "anim_index": anim_index,
		"all_frames": all_frames, "playing": playing,
		"speed_index": speed_index, "view_scale": view_scale, "bg_index": bg_index,
		"case_index": case_index, "mode_index": mode_index
	}
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f == null:
		return
	f.store_string(JSON.stringify(data, "\t"))
	f.close()


func load_selection() -> void:
	if not FileAccess.file_exists(SAVE_PATH):
		_apply_env_override()
		return
	var raw = JSON.parse_string(FileAccess.get_file_as_string(SAVE_PATH))
	if not (raw is Dictionary):
		return
	if int(raw.get("version", -1)) != SAVE_VERSION:
		return   # 版本不符：丢弃旧档，不崩、不猜测字段
	if SEXES.has(str(raw.get("sex", ""))):
		sex = str(raw.get("sex"))
	if POSES.has(str(raw.get("pose", ""))):
		pose = str(raw.get("pose"))
	anim_index = clampi(int(raw.get("anim_index", 0)), 0, 99)
	all_frames = bool(raw.get("all_frames", false))
	playing = bool(raw.get("playing", true))
	speed_index = clampi(int(raw.get("speed_index", 1)), 0, SPEEDS.size() - 1)
	view_scale = clampi(int(raw.get("view_scale", 3)), 1, 4)
	bg_index = clampi(int(raw.get("bg_index", 0)), 0, 2)
	case_index = clampi(int(raw.get("case_index", 0)), 0, 19)
	mode_index = clampi(int(raw.get("mode_index", 0)), 0, 1)
	frame_index = 0
	_anim_cache.clear()
	_apply_env_override()


## 截图 / 演示用：必须在存档读取之后调用，否则会被存档里的 sex / pose 覆盖回去。
## 默认启动不设置这两个变量时，行为完全走存档。
func _apply_env_override() -> void:
	if OS.has_environment("WORLDOL_SEX"):
		var s := OS.get_environment("WORLDOL_SEX")
		if SEXES.has(s):
			sex = s
	if OS.has_environment("WORLDOL_POSE"):
		var p := OS.get_environment("WORLDOL_POSE")
		if POSES.has(p):
			pose = p
