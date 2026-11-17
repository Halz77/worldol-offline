extends Node2D
## 最小可跑场景：用 Godot 原生节点显示按原版帧表拼出的角色，可播放 / 切造型。
## 这一屏不依赖任何 JS、HTTP、WebSocket 或浏览器。

const SpriteComposer = preload("res://scripts/SpriteComposer.gd")
const GameData = preload("res://scripts/GameData.gd")
const Stats = preload("res://scripts/Stats.gd")

const MODELS = [300, 400, 100, 200]
const MODEL_NAMES = ["女 · 正常姿势", "女 · 战斗姿势", "男 · 正常姿势", "男 · 战斗姿势"]

var model_index = 0
var frame_index = 0
var frames: Array = []
var playing = true
var elapsed = 0.0
var sprite: Sprite2D
var label: Label


func _ready() -> void:
	sprite = Sprite2D.new()
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	sprite.position = Vector2(640, 360)
	add_child(sprite)

	label = Label.new()
	label.position = Vector2(24, 24)
	label.add_theme_font_size_override("font_size", 18)
	add_child(label)

	_load_model()


func _load_model() -> void:
	frames = SpriteComposer.frame_numbers(MODELS[model_index])
	frame_index = 0
	_show()


func _show() -> void:
	if frames.is_empty():
		label.text = "没找到 Model %d 的帧表" % MODELS[model_index]
		return
	var f = int(frames[frame_index % frames.size()])
	sprite.texture = SpriteComposer.render_frame(MODELS[model_index], f, 3)
	label.text = "世界OL · Godot 原生拼装\n造型 %s（Model %d）\n第 %d / %d 帧 · %s\n素材 %d 个 · 数据源 %d 个 · 数值基线 %d 角色\n← → 逐帧    空格 播放/暂停    1–4 换造型" % [
		MODEL_NAMES[model_index], MODELS[model_index], frame_index + 1, frames.size(),
		"播放中" if playing else "暂停",
		GameData.asset_count(), GameData.data_sources().size(), Stats.case_count()
	]


func _process(delta: float) -> void:
	if not playing or frames.size() < 2:
		return
	elapsed += delta
	if elapsed < 0.12:
		return
	elapsed = 0.0
	frame_index = (frame_index + 1) % frames.size()
	_show()


func _input(event: InputEvent) -> void:
	if not (event is InputEventKey) or not event.pressed:
		return
	var key = event as InputEventKey
	var count = max(frames.size(), 1)
	match key.keycode:
		KEY_RIGHT:
			frame_index = (frame_index + 1) % count
			_show()
		KEY_LEFT:
			frame_index = (frame_index - 1 + count) % count
			_show()
		KEY_SPACE:
			playing = not playing
			_show()
		KEY_1, KEY_2, KEY_3, KEY_4:
			model_index = key.keycode - KEY_1
			_load_model()
