extends Control
## 造型播放器组件（P5 组合）：只订阅 ScreenState，不直接操作其它 UI。
##
## 显示链路：SpriteComposer 每帧从磁盘读 PNG → 180x200 原始像素图 →
## TextureRect 用最近邻 + 节点 scale 做 1x/2x/3x/4x 整数倍放大。
## 因为不经过 ResourceLoader 的纹理缓存，改 PNG 后下一帧就生效。

const SpriteComposer = preload("res://scripts/SpriteComposer.gd")
const Equipment = preload("res://scripts/Equipment.gd")
const GameData = preload("res://scripts/GameData.gd")

var game_data = GameData.new()

@onready var bg_color: ColorRect = $BgColor
@onready var bg_checker: TextureRect = $BgChecker
@onready var figure: TextureRect = $Center/Figure

var state
var elapsed := 0.0
## 预览缩放覆盖：装备屏设为 2，避免 3x 的角色超出预览框被裁切；不影响 ScreenState 里的角色屏存档。
var view_scale_override: int = 0


func _ready() -> void:
	bg_checker.texture = _checker_texture()
	bg_checker.stretch_mode = 1              # TextureRect.STRETCH_TILE（4.3 枚举值）
	figure.custom_minimum_size = Vector2(180, 200)
	figure.pivot_offset = Vector2(90, 100)   # 以画布中心缩放，不往右下溢出
	figure.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	figure.mouse_filter = Control.MOUSE_FILTER_IGNORE


## 由主屏注入状态对象；组件自身不引用 Autoload 全局名，便于 headless 自检。
func bind(s) -> void:
	state = s
	if not state.is_connected("state_changed", Callable(self, "_on_state")):
		state.connect("state_changed", Callable(self, "_on_state"))
	refresh()


func _on_state(_field: String) -> void:
	refresh()


func refresh() -> void:
	if state == null:
		return
	var bg := int(state.get("bg_index"))
	bg_checker.visible = bg == 0
	match bg:
		1: bg_color.color = Color(1.0, 1.0, 1.0, 1.0)
		2: bg_color.color = Color(0.07, 0.07, 0.09, 1.0)
		_: bg_color.color = Color(0.0, 0.0, 0.0, 0.0)
	var mid := int(state.call("model_id"))
	var fno := int(state.call("current_frame_no"))
	var equipped: Dictionary = state.get("equipped") if state.get("equipped") is Dictionary else {}
	var look := Equipment.appearance(game_data, mid, equipped)
	var tex := SpriteComposer.render_frame_equipped(int(look.model_id), fno, 1,
		look.part_replace, look.single_use, look.add_parts, int(look.cloak_model))
	figure.texture = tex
	var z := view_scale_override if view_scale_override > 0 else int(state.get("view_scale"))
	figure.scale = Vector2(z, z)


func _process(delta: float) -> void:
	if state == null or not bool(state.get("playing")):
		return
	if int(state.call("frame_count")) < 2:
		return
	var interval := 0.12 / maxf(float(state.call("speed_value")), 0.1)
	elapsed += delta
	if elapsed < interval:
		return
	elapsed = 0.0
	state.call("step", 1)


func _checker_texture() -> ImageTexture:
	var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
	for y in range(32):
		for x in range(32):
			var cx := int(floor(float(x) / 8.0))
			var cy := int(floor(float(y) / 8.0))
			var light := (cx + cy) % 2 == 0
			img.set_pixel(x, y,
				Color(0.87, 0.89, 0.93, 1.0) if light else Color(0.71, 0.75, 0.82, 1.0))
	return ImageTexture.create_from_image(img)
