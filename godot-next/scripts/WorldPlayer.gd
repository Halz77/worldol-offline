extends Node2D
## 地图里的玩家：WASD / 方向键走动，逐格判定障碍，动画帧复用角色屏的拼装器。
## 只改本脚本就能换手感；素材仍然直接来自 assets/sprite_model 与 sprite_fragment。

const SpriteComposer = preload("res://scripts/SpriteComposer.gd")

@onready var sprite: Sprite2D = get_node_or_null("Sprite")

var world_map: Node2D = null
var screen_state = null
var speed: float = 132.0
var walk_fps: float = 7.0
## 1 = 朝右，-1 = 朝左。★ 原版素材（sprite_model 的站立/行走帧）默认朝左，
## 所以「朝右」必须水平镜像：sprite.scale.x 取负值。早期实现按「素材朝右」取符号，
## 结果按左键人物朝右、按右键人物朝左。
var facing: int = 1
var _frames: Array = []          # 行走序列（anis id=2），不是全部帧
var _walk_model_id: int = 300
var _stand_frame: int = 0
var _textures: Dictionary = {}
var _frame_index: int = 0
var _timer: float = 0.0
var _moving: bool = false


func bind(map_node: Node2D, state) -> void:
	world_map = map_node
	screen_state = state
	_rebuild_frames()


## 地图里的人物固定用「正常」姿势（女 300 / 男 100）。
## 角色屏可能停在战斗姿势，直接拿它的 model_id 会让地图角色摆战斗动作。
func _normal_model_id() -> int:
	if screen_state != null:
		var table = screen_state.get("MODEL_TABLE")
		var sex := str(screen_state.get("sex"))
		if table is Dictionary and table.has(sex + "|正常"):
			return int(table[sex + "|正常"])
	return 300


## 取指定动作的 gesture 帧序列。模型 JSON 的 anis 顺序不保证，必须按 id 找。
func _gesture(model_id: int, anis_id: int) -> Array:
	var path := "res://assets/sprite_model/" + str(model_id) + ".json"
	if not FileAccess.file_exists(path):
		return []
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not (parsed is Dictionary) or not (parsed.get("anis") is Array):
		return []
	for a in parsed["anis"]:
		if not (a is Dictionary) or int(a.get("id", -1)) != anis_id:
			continue
		if not (a.get("gesture") is Array):
			continue
		var out: Array = []
		for g in a["gesture"]:
			if g is Array and not g.is_empty():
				out.append(int(g[0]))
		return out
	return []


func _rebuild_frames() -> void:
	_walk_model_id = _normal_model_id()
	# 原版地图：id 0 = 站立/待机，id 2 = 行走。全帧里混着站立帧，
	# 战斗 model 更全是战斗动作，所以两者都不能直接用。
	_frames = _gesture(_walk_model_id, 2)
	if _frames.is_empty():
		_frames = SpriteComposer.frame_numbers(_walk_model_id)
	if _frames.is_empty():
		_frames = [0]
	var stand := _gesture(_walk_model_id, 0)
	_stand_frame = int(stand[0]) if not stand.is_empty() else int(_frames[0])
	_frame_index = 0
	_textures.clear()


func set_tile(gx: int, gy: int) -> void:
	if world_map == null:
		return
	var cfg: Dictionary = world_map.get("cfg")
	var tw := maxi(1, int(cfg.get("tW", 24)))
	var th := maxi(1, int(cfg.get("tH", 24)))
	position = Vector2((gx + 0.5) * tw, (gy + 0.5) * th)


func set_pixel(p: Vector2) -> void:
	position = p


func _texture(frame_no: int) -> ImageTexture:
	if _textures.has(frame_no):
		return _textures[frame_no]
	var tex := SpriteComposer.render_frame(_walk_model_id, frame_no, 1)
	_textures[frame_no] = tex
	return tex


func _physics_process(delta: float) -> void:
	if world_map == null or sprite == null:
		return
	var v := _input_vector()
	_moving = v.length_squared() > 0.01
	if _moving:
		v = v.normalized()
		var dx := v.x * speed * delta
		var dy := v.y * speed * delta
		if not world_map.call("is_blocked_px", position.x + dx, position.y):
			position.x += dx
		if not world_map.call("is_blocked_px", position.x, position.y + dy):
			position.y += dy
		if absf(v.x) > 0.1:
			facing = 1 if v.x > 0.0 else -1
		_timer += delta
		if _timer >= 1.0 / maxf(1.0, walk_fps):
			_timer = 0.0
			_frame_index = (_frame_index + 1) % _frames.size()
	else:
		_frame_index = 0
		_timer = 0.0

	# 静止显示站立首帧，移动才播行走序列；不再把全部帧（含战斗帧）轮一遍。
	var frame_no := _stand_frame if not _moving else int(_frames[_frame_index])
	var tex := _texture(frame_no)
	if tex != null:
		sprite.texture = tex
	sprite.scale = Vector2(-0.5 * float(facing), 0.5)
	sprite.offset = Vector2(-SpriteComposer.CANVAS_W / 2.0, -SpriteComposer.ANCHOR_Y)


## 脚下的小圆环：地图上 NPC 很多，给玩家一个稳定的定位标记。
func _draw() -> void:
	draw_arc(Vector2.ZERO, 13.0, 0.0, TAU, 24, Color(1.0, 0.85, 0.25, 0.9), 2.0)


func _input_vector() -> Vector2:
	var v := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	if absf(v.x) < 0.1:
		v.x = (1.0 if Input.is_key_pressed(KEY_D) else 0.0) - \
			(1.0 if Input.is_key_pressed(KEY_A) else 0.0)
	if absf(v.y) < 0.1:
		v.y = (1.0 if Input.is_key_pressed(KEY_S) else 0.0) - \
			(1.0 if Input.is_key_pressed(KEY_W) else 0.0)
	return v


## 供自检脚本直接驱动，不依赖真实键盘事件。
func move_by(dx: float, dy: float) -> void:
	if world_map == null:
		return
	# 分步走，避免一次大位移直接跳过障碍格（自检里会拿 1000px 撞边界）。
	var steps := maxi(1, ceili(maxf(absf(dx), absf(dy)) / 6.0))
	var sx := dx / float(steps)
	var sy := dy / float(steps)
	for _i in range(steps):
		if not world_map.call("is_blocked_px", position.x + sx, position.y):
			position.x += sx
		if not world_map.call("is_blocked_px", position.x, position.y + sy):
			position.y += sy
