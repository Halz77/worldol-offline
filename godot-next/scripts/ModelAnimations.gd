extends RefCounted
## 把 sprite_model/<id>.json 的 anis 定义编译成 Godot 的 SpriteFrames。
##
## 为什么要这层：原版每个模型自带一段动画表（anis），旧实现是自己在 _process 里
## 数计时器、切帧、切动作，帧率写在代码里、动作名是魔法数字。改成 SpriteFrames 之后：
##   - 动作有名字（idle / walk / actionN），AnimatedSprite2D 直接 play("walk")；
##   - 每个动作的帧率、是否循环都是资源里的字段，改动画不用碰逻辑；
##   - 以后接攻击/施法只要加一个 anis id，播放端不用改。
##
## ★ 这一层不能直接引用烘死的 .tres：帧是「基础模型 + 装备换部件 + 外观换发型 + 自由调色」
##   在运行时合成出来的，组合数远超素材数量。所以 SpriteFrames 在换装/换外观时重建，
##   一帧约 1.5ms，10 帧动画约 15ms，切换时重建一次可以接受。

const SpriteComposer = preload("res://scripts/SpriteComposer.gd")

## 原版 anis id 的语义（0055.js doChangeSpriteIcon 一带的播放逻辑：0 站立、2 行走）。
## 其余 id 还没用到，统一叫 action<id>，帧序列照样保留。
const ANIM_NAMES := {0: "idle", 2: "walk"}
## 每个动作的默认帧率。gesture 里的第二列不是毫秒（0 号动画混着 4/1/2），
## 直接换算会得到忽快忽慢的节奏；这里按动作类型给固定帧率，
## walk 保持改造前 WorldPlayer 的 7fps，画面速度不变。
const ANIM_FPS := {0: 4.0, 2: 7.0}
const DEFAULT_FPS := 6.0


## 动作名（外部判断用，避免到处写魔法字符串）。
static func anim_name(anis_id: int) -> String:
	return str(ANIM_NAMES.get(anis_id, "action%d" % anis_id))


## 生成一个模型的全部动画。replace / single_use / add_parts / cloak_model / tints
## 与 SpriteComposer.render_frame_equipped 的后四个参数同义（装备 + 外观 + 调色）。
static func build(model_id: int, replace: Dictionary = {}, single_use: Array = [],
		add_parts: Array = [], cloak_model: int = 0, tints: Dictionary = {}) -> SpriteFrames:
	var sf := SpriteFrames.new()
	# SpriteFrames 自带一个空的 "default"，删掉免得界面上多一条没用的动画。
	if sf.has_animation("default"):
		sf.remove_animation("default")
	var anis: Array = _anis_of(model_id)
	for a in anis:
		if not (a is Dictionary):
			continue
		var gesture = a.get("gesture", null)
		if not (gesture is Array) or (gesture as Array).is_empty():
			continue
		var aid := int(a.get("id", -1))
		var name := anim_name(aid)
		if sf.has_animation(name):
			continue
		sf.add_animation(name)
		sf.set_animation_speed(name, float(ANIM_FPS.get(aid, DEFAULT_FPS)))
		sf.set_animation_loop(name, int(a.get("loops", 1)) != 0)
		for g in gesture:
			if not (g is Array) or (g as Array).is_empty():
				continue
			var fno := int((g as Array)[0])
			var tex = SpriteComposer.render_frame_equipped(model_id, fno, 1,
				replace, single_use, add_parts, cloak_model, tints)
			if tex != null:
				sf.add_frame(name, tex)
		if sf.get_frame_count(name) == 0:
			sf.remove_animation(name)
	if not sf.has_animation("idle"):
		# 兜底：没有动画定义的模型至少给一张站立帧，播放端不用做空判断。
		sf.add_animation("idle")
		sf.set_animation_speed("idle", 1.0)
		sf.set_animation_loop("idle", false)
		var frames := SpriteComposer.frame_numbers(model_id)
		var f0 := int(frames[0]) if not frames.is_empty() else 0
		var tex = SpriteComposer.render_frame_equipped(model_id, f0, 1,
			replace, single_use, add_parts, cloak_model, tints)
		if tex != null:
			sf.add_frame("idle", tex)
	return sf


## 模型自带的 anis 数组（读不到就返回空）。
static func _anis_of(model_id: int) -> Array:
	var path := "res://assets/sprite_model/" + str(model_id) + ".json"
	if not FileAccess.file_exists(path):
		return []
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not (parsed is Dictionary) or not (parsed.get("anis") is Array):
		return []
	return parsed["anis"]
