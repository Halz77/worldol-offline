extends Node2D
## 地图渲染 + NPC 实体 —— 直接吃原版 v305 的 map/*.json，不经过任何 JS。
##
## 原版图层语义（从 client/js 的 MapLayerType / PixelType 反查）：
##   type 2 = Tile 层：每个格子一个 data[i] 索引，指向 tiles 定义展开后的 tileList；
##              -1 表示空格。tiles 项是 [图名, 变换, 横格数, 纵格数]，展开顺序是
##              先 row 后 col，图本身可能是 3x3 / 5x1 的小图集，用 col/row 切子帧。
##   type 3 = Pixel 层：静态物件（PixelType.IMAGE=2）与地图自带 NPC 模型（=4）。
##   type 4 = Player 层：和角色同一深度排序的静态装饰，画法与 Pixel 相同。
## 贴图来源优先级：本图图集 → 全局帧索引里任意一张图集 → map_slice/<name>.png。
## ★ 绝不回退到 sprite_fragment：那是角色部件库，不是地图贴图。
## frames 的 offX/offY/sourceW/sourceH 必须还原成逻辑包围盒，否则物件会整体偏移/拉伸。
## 换图只要在 Godot 里替换 PNG，下一帧生效。

const GameData = preload("res://scripts/GameData.gd")
const SpriteComposer = preload("res://scripts/SpriteComposer.gd")

const MAP_DIR = "res://assets/map/"
const ATLAS_DIR = "res://assets/map_merged/"
const SLICE_DIR = "res://assets/map_slice/"
const FRAG_DIR = "res://assets/sprite_fragment/"

signal map_loaded(id: int)

var data = GameData.new()
var map_id: int = 0
var cfg: Dictionary = {}
var show_names: bool = true
var show_npcs: bool = false   # 用户要求先把 NPC 从地图上撤掉；数据仍保留，可随时打开

var _tile_list: Array = []
var _blocks: Array = []
var _cols: int = 0
var _rows: int = 0
var _tile_w: int = 24
var _tile_h: int = 24
var _atlas: Texture2D = null
var _atlas_frames: Dictionary = {}
var _frames_index: Dictionary = {}
var _atlas_images: Dictionary = {}
var _tex_cache: Dictionary = {}
var _model_cache: Dictionary = {}
## 变换后子图缓存：key = 纹理实例|源区域|变换。切图时清空。
var _xform_cache: Dictionary = {}
var _npc_root: Node2D
## 排查用：WORLDOL_SKIP="325,366" 可临时不画这些资源名的物件，定位某块色块的来源。
## 正常游玩不设置该变量，行为不受影响。
var _skip_srcs: Array = []
## 排查用：WORLDOL_NOTRANS=1 忽略物件旋转变换，用于确认某块错位是否由变换引起。
var _ignore_transform: bool = false
## 排查用：WORLDOL_NOOBJ=1 完全不画物件层（只留 tile），定位色块属于哪一层。
var _no_objects: bool = false
## 排查用：WORLDOL_ONLYLAYER=3 只画指定层索引，用来定位某块画面属于哪一层。
var _only_layer: int = -1
## 排查用：WORLDOL_SKIPTILE="106_1,304" 临时不画这些资源名的 tile，定位地面色块来源。
var _skip_tiles: Array = []
var _name_root: Node2D
var npcs: Array = []


func _ready() -> void:
	if OS.has_environment("WORLDOL_SKIP"):
		for s in OS.get_environment("WORLDOL_SKIP").split(",", false):
			_skip_srcs.append(s.strip_edges())
	_ignore_transform = OS.has_environment("WORLDOL_NOTRANS")
	_no_objects = OS.has_environment("WORLDOL_NOOBJ")
	if OS.has_environment("WORLDOL_SKIPTILE"):
		for s in OS.get_environment("WORLDOL_SKIPTILE").split(",", false):
			_skip_tiles.append(s.strip_edges())
	if OS.has_environment("WORLDOL_ONLYLAYER"):
		_only_layer = int(OS.get_environment("WORLDOL_ONLYLAYER"))
	var index_path := "res://data/compiled/mapFrames.json"
	if FileAccess.file_exists(index_path):
		var parsed = JSON.parse_string(FileAccess.get_file_as_string(index_path))
		if parsed is Dictionary:
			_frames_index = parsed
	_npc_root = get_node_or_null("Npcs")
	if _npc_root == null:
		_npc_root = Node2D.new()
		_npc_root.name = "Npcs"
		add_child(_npc_root)
	_name_root = get_node_or_null("Names")
	if _name_root == null:
		_name_root = Node2D.new()
		_name_root.name = "Names"
		add_child(_name_root)


func load_map(id: int) -> bool:
	map_id = id
	var path := MAP_DIR + str(id) + ".json"
	var parsed = null
	if FileAccess.file_exists(path):
		parsed = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not (parsed is Dictionary):
		# 没有视觉 JSON 的地图（官方有 NPC / 名字但资源未导出）用合成网格兜底，
		# 绝不让这些 NPC 因为「地图文件缺失」而从世界里消失。
		var meta: Array = data.get_entry("worldMaps", id)
		if meta.is_empty():
			cfg = {}
			queue_redraw()
			return false
		var m: Dictionary = meta[0]
		var cols := maxi(1, int(ceil(float(m.get("w", 960)) / float(m.get("tile_w", 24)))))
		var rows := maxi(1, int(ceil(float(m.get("h", 720)) / float(m.get("tile_h", 24)))))
		parsed = {
			"mW": cols * int(m.get("tile_w", 24)),
			"mH": rows * int(m.get("tile_h", 24)),
			"tW": int(m.get("tile_w", 24)), "tH": int(m.get("tile_h", 24)),
			"tiles": [], "layers": [], "blocks": [], "__synthetic": true
		}
	cfg = parsed
	_tile_w = maxi(1, int(cfg.get("tW", 24)))
	_tile_h = maxi(1, int(cfg.get("tH", 24)))
	_cols = int(cfg.get("mW", 0)) / _tile_w
	_rows = int(cfg.get("mH", 0)) / _tile_h
	_blocks = cfg.get("blocks", [])

	_tile_list.clear()
	for def in cfg.get("tiles", []):
		if not (def is Array) or def.size() < 4:
			continue
		var name := str(def[0])
		var transform := int(def[1])
		var span_x := maxi(1, int(def[2]))
		var span_y := maxi(1, int(def[3]))
		for row in range(span_y):
			for col in range(span_x):
				_tile_list.append({"src": name, "transform": transform, "col": col, "row": row})

	_atlas = null
	_atlas_frames = {}
	_tex_cache.clear()   # 本图图集换了，按资源名缓存的纹理可能来自上一张图
	_xform_cache.clear() # 变换后的子图同样不能跨图复用
	_opaque_cache.clear()
	_bright_cache.clear()
	_solid_cache.clear()
	var atlas_path := ATLAS_DIR + str(id) + ".png"
	if FileAccess.file_exists(atlas_path):
		_atlas = load(atlas_path) as Texture2D
		var frame_file = GameData._json(ATLAS_DIR + str(id) + ".json")
		if frame_file is Dictionary and frame_file.get("frames") is Dictionary:
			_atlas_frames = frame_file["frames"]

	_build_npcs(id)
	queue_redraw()
	map_loaded.emit(id)
	return true


func set_show_npcs(value: bool) -> void:
	if show_npcs == value:
		return
	show_npcs = value
	if not cfg.is_empty():
		_build_npcs(map_id)
	queue_redraw()


func _build_npcs(id: int) -> void:
	for c in _npc_root.get_children():
		c.free()
	for c in _name_root.get_children():
		c.free()
	npcs.clear()
	if not show_npcs:
		return
	for n in data.get_entry("npcs", id):
		if not (n is Dictionary):
			continue
		var gx := clampi(int(n.get("x", 0)), 0, maxi(_cols - 1, 0))
		var gy := clampi(int(n.get("y", 0)), 0, maxi(_rows - 1, 0))
		var pos := Vector2((gx + 0.5) * _tile_w, (gy + 0.5) * _tile_h)
		var sprite := Sprite2D.new()
		sprite.centered = false
		sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		sprite.texture = _npc_texture(str(n.get("icon1", "")))
		var label := Label.new()
		label.text = str(n.get("name", ""))
		label.add_theme_font_size_override("font_size", 11)
		label.add_theme_color_override("font_color", Color(1, 1, 0.85))
		label.add_theme_constant_override("outline_size", 2)
		label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
		label.position = pos + Vector2(-40, -92)
		_npc_root.add_child(sprite)
		_name_root.add_child(label)
		_draw_npc_sprite(sprite, pos, str(n.get("icon1", "")))
		npcs.append({"data": n, "pos": pos, "sprite": sprite, "label": label})


func _npc_texture(icon: String) -> Texture2D:
	if icon.is_empty() or icon == "0":
		return null
	if FileAccess.file_exists(FRAG_DIR + icon + ".png"):
		return load(FRAG_DIR + icon + ".png") as Texture2D
	if FileAccess.file_exists("res://assets/sprite_model/" + icon + ".json"):
		return _model_texture(int(icon))
	return null


func _draw_npc_sprite(sprite: Sprite2D, pos: Vector2, icon: String) -> void:
	if not (sprite is Sprite2D):
		return
	var tex := sprite.texture
	if tex == null:
		# 没有可用图标时也保留实体：画一个小标记，保证「所有 NPC 都在地图上」。
		sprite.position = pos - Vector2(6, 12)
		sprite.scale = Vector2(1, 1)
		return
	if FileAccess.file_exists(FRAG_DIR + icon + ".png"):
		sprite.position = pos + Vector2(-tex.get_width() / 2.0, -tex.get_height() + 8)
		sprite.scale = Vector2(1, 1)
	else:
		sprite.position = pos
		sprite.scale = Vector2(0.45, 0.45)
		sprite.offset = Vector2(-SpriteComposer.CANVAS_W / 2.0, -SpriteComposer.ANCHOR_Y)


## 模型 frame 0 不一定是站立帧（如 15113 的 0 属于「行走」，站立是 3）。
## 原版按 anis[0]（站立）播放，取它的首帧，避免 NPC 永远摆着奇怪的动作。
func _stand_frame(model_id: int) -> int:
	var path := "res://assets/sprite_model/" + str(model_id) + ".json"
	if FileAccess.file_exists(path):
		var model = JSON.parse_string(FileAccess.get_file_as_string(path))
		if model is Dictionary and model.get("anis") is Array:
			for a in model["anis"]:
				if a is Dictionary and int(a.get("id", -1)) == 0 and a.get("gesture") is Array:
					for g in a["gesture"]:
						if g is Array and not g.is_empty():
							return int(g[0])
	var frames := SpriteComposer.frame_numbers(model_id)
	return frames[0] if not frames.is_empty() else 0


func _model_texture(model_id: int) -> ImageTexture:
	var frame_no := _stand_frame(model_id)
	var key := str(model_id) + "|" + str(frame_no)
	if _model_cache.has(key):
		return _model_cache[key]
	var tex := SpriteComposer.render_frame(model_id, frame_no, 1)
	_model_cache[key] = tex
	return tex


func update_labels_near(pos: Vector2, radius: float) -> void:
	if not show_names or not show_npcs or _name_root == null:
		return
	for n in npcs:
		var label: Label = n.get("label")
		if label != null:
			label.visible = pos.distance_to(n.get("pos", Vector2.ZERO)) <= radius


func set_show_names(value: bool) -> void:
	show_names = value
	if _name_root != null:
		_name_root.visible = value


func map_size() -> Vector2:
	return Vector2(float(cfg.get("mW", 0)), float(cfg.get("mH", 0)))


func spawn_pixel() -> Vector2:
	var meta = data.get_entry("worldMaps", map_id)
	var tile = [0, 0]
	if not meta.is_empty() and meta[0].get("spawn") is Array:
		tile = meta[0]["spawn"]
	var gx := int(tile[0]) if tile.size() > 0 else 0
	var gy := int(tile[1]) if tile.size() > 1 else 0
	gx = clampi(gx, 0, maxi(_cols - 1, 0))
	gy = clampi(gy, 0, maxi(_rows - 1, 0))
	return Vector2((gx + 0.5) * _tile_w, (gy + 0.5) * _tile_h)


## 以像素坐标问障碍格；越界视为不可走。
func is_blocked_px(px: float, py: float) -> bool:
	var col := int(floor(px / float(_tile_w)))
	var row := int(floor(py / float(_tile_h)))
	if col < 0 or row < 0 or col >= _cols or row >= _rows:
		return true
	var idx := row * _cols + col
	if idx < 0 or idx >= _blocks.size():
		return false
	return (int(_blocks[idx]) & 1) == 1


func nearest_npc(px: float, py: float, radius: float = 56.0) -> Dictionary:
	var best := -1.0
	var found := {}
	for n in npcs:
		var d = Vector2(px, py).distance_to(n.get("pos", Vector2.ZERO))
		if d <= radius and (best < 0.0 or d < best):
			best = d
			found = n
	return found


# ---------------------------------------------------------------- 绘制

func _draw() -> void:
	if cfg.is_empty():
		return
	var w := int(cfg.get("mW", 0))
	var h := int(cfg.get("mH", 0))
	draw_rect(Rect2(0, 0, w, h), Color(0.08, 0.09, 0.12), true)
	# ★ assets/map_bg/<id>.jpg 是原版的「场景切换模糊过渡图」，全是 160×100 缩略图
	#   （对应原版 getMapBlurUrl），不是地图底图。把它拉伸到 720×1200 会在 tile 空格处
	#   露出放大 7 倍的糊色块——16 号台阶石头连接处、19/23/24 的怪色块就是这么来的。
	#   只有「没有视觉 JSON 的合成网格地图」才拿它当底衬，正常地图一律不画。
	if bool(cfg.get("__synthetic", false)):
		var bg_tex := _background()
		if bg_tex != null:
			draw_texture_rect(bg_tex, Rect2(0, 0, w, h), false)
		for x in range(0, w, _tile_w):
			draw_line(Vector2(x, 0), Vector2(x, h), Color(0.22, 0.24, 0.3, 0.45), 1.0)
		for y in range(0, h, _tile_h):
			draw_line(Vector2(0, y), Vector2(w, y), Color(0.22, 0.24, 0.3, 0.45), 1.0)

	# 原版 scene.init 是 i=length-1 downto 0 逐个 addChild：layers[0] 最后加、画在最上层。
	# 所以这里必须倒序画，正序画会让 tile 层盖住前面的物件层。
	var layers: Array = cfg.get("layers", [])
	# 最先铺一层「兜底地面」：把所有 tile 层都没画过的内圈格子，用最近的真实地面补上。
	# 必须在所有图层之下，才不会盖住湖面/桥/台阶（它们下层本来有 tile）。
	if _only_layer < 0:
		_prefill_holes(layers)
	# 单遍倒序，和原版 addChild 顺序完全一致：tile / 物件层之间的前后关系不能打乱。
	for li in range(layers.size() - 1, -1, -1):
		if _only_layer >= 0 and li != _only_layer:
			continue
		var layer = layers[li]
		if not (layer is Dictionary):
			continue
		var type := int(layer.get("type", 0))
		if type == 2 and layer.get("data") is Array:
			var cells: Array = layer["data"]
			var count := mini(cells.size(), _cols * _rows)
			var painted: Array = []
			var info: Array = []
			painted.resize(count)
			info.resize(count)
			painted.fill(false)
			for i in range(count):
				# 引用坏资源的格子：整格不画 tile，只留底下补出来的地面
				# （否则 layer5 的淡色 106_1 会把补好的地面又盖回去）。
				if not _broken_cells.is_empty() and i < _broken_cells.size() \
						and _broken_cells[i]:
					continue
				# 原版 sliceLayer.loadSlice 是 `cfg.data[i] & 255`：负数不是空格，
				# 而是按字节解码的 tileList 索引（约 1.8 万个格子），-1 解码后正好是 255 空。
				var idx := int(cells[i]) & 255
				if idx == 255 or idx >= _tile_list.size():
					continue
				var t: Dictionary = _tile_list[idx]
				if not _skip_tiles.is_empty() and _skip_tiles.has(str(t.get("src", ""))):
					continue
				var res = _resolve(str(t.get("src", "")), true)
				if res.is_empty():
					if OS.has_environment("WORLDOL_DEBUG_SKIP"):
						print("[skip] layer=", li, " col=", i % _cols, " row=", i / _cols,
							" src=", t.get("src"), " col/row=", t.get("col"), "/", t.get("row"))
					continue
				var region: Rect2 = res.get("region")
				# 图集可能是 3x3 / 5x1 / 4x1，横纵各自判断，不能要求两轴都大于格子。
				var crop_x := region.size.x > _tile_w
				var crop_y := region.size.y > _tile_h
				region = Rect2(
					region.position.x + (int(t.get("col", 0)) * _tile_w if crop_x else 0),
					region.position.y + (int(t.get("row", 0)) * _tile_h if crop_y else 0),
					_tile_w if crop_x else region.size.x,
					_tile_h if crop_y else region.size.y)
				var transform := int(t.get("transform", 0))
				var dest := Rect2(i % _cols * _tile_w, i / _cols * _tile_h, _tile_w, _tile_h)
				_draw_tex(res.get("texture"), dest, region, transform)
				# 100 号中下部那块地面（106_1）原版素材本身偏亮（亮度≈0.60，周围草地≈0.45），
				# 上层本该盖住它的 182/183 在原版资源表里根本不存在，于是整片发白很突兀。
				# 这里只做「轻微压暗」，不换铺装、不改其他地图。
				if map_id == _tone_down_map and _tone_down_srcs.has(str(t.get("src", ""))):
					draw_rect(dest, Color(0, 0, 0, _tone_down_alpha), true)
				painted[i] = true
				info[i] = {"texture": res.get("texture"), "region": region,
					"transform": transform}

			# ★ 空格（idx=255）是原版语义上的「透明」，必须保持不画：
			#   水面、桥下、台阶空缺都靠它露出下层/背景。曾试过把空格也补成地面，
			#   结果 2 号湖面、7 号桥下、17 号台阶全被填成色块——不要再这么干。
			# 只补「索引有效但资源没导出」的格子（原版有贴图，包里缺文件）。
			for i in range(count):
				if painted[i]:
					continue
				if (int(cells[i]) & 255) == 255:
					continue
				var from := _nearest_painted(i, painted)
				if from < 0:
					continue
				var d: Dictionary = info[from]
				_draw_tex(d.get("texture"), Rect2(i % _cols * _tile_w,
					i / _cols * _tile_h, _tile_w, _tile_h), d.get("region"),
					int(d.get("transform", 0)))
		elif layer.get("obj") is Array and not _no_objects:
			for obj in layer["obj"]:
				if not (obj is Array) or obj.size() < 6:
					continue
				var kind := int(obj[0])
				var x := float(obj[2])
				var y := float(obj[3])
				if kind == 2:
					if not _skip_srcs.is_empty() and _skip_srcs.has(str(obj[1])):
						continue
					var res = _resolve(str(obj[1]))
					if not res.is_empty():
						var size: Vector2 = res.get("region").size if bool(res.get("logical", false)) \
							else Vector2(float(obj[4]), float(obj[5]))
						var tr := int(obj[6]) if obj.size() > 6 else 0
						if _ignore_transform:
							tr = 0
						_draw_tex(res.get("texture"), Rect2(x, y, size.x, size.y),
							res.get("region"), tr)
				elif kind == 3 or kind == 4:
					if not show_npcs:
						continue
					var tex := _model_texture(int(obj[5]))
					if tex != null:
						var flip = -1.0 if int(obj[4]) != 0 else 1.0
						draw_set_transform(Vector2(x, y), 0.0, Vector2(0.45 * flip, 0.45))
						draw_texture(tex, Vector2(-SpriteComposer.CANVAS_W / 2.0,
							-SpriteComposer.ANCHOR_Y))
						draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

	# 排查用：WORLDOL_GRID=1 画格子标尺，方便肉眼读出某块画面属于哪一格。
	if OS.has_environment("WORLDOL_GRID"):
		for gx in range(0, _cols + 1, 5):
			draw_line(Vector2(gx * _tile_w, 0), Vector2(gx * _tile_w, h),
				Color(1, 0, 0, 0.5), 1.0)
		for gy in range(0, _rows + 1, 5):
			draw_line(Vector2(0, gy * _tile_h), Vector2(w, gy * _tile_h),
				Color(1, 0, 0, 0.5), 1.0)


## 把所有 tile 层都没覆盖到的「内圈空洞」用最近的真实地面补上。
## ★ 关键：有些 tile 资源本身就是「全透明占位图」（如 91.png 在 275 号里全透明），
##   resolve 成功但画不出任何像素，仍然会露出底色。必须按「这段区域有没有不透明像素」
##   判断，而不是「资源存不存在」，否则黑块永远补不掉。
## 只处理「全部层都没画出像素」的格子：湖面 / 桥下 / 台阶上空格在下层有 tile，
## 会被正常绘制覆盖，这里不会误填。
func _prefill_holes(layers: Array) -> void:
	var cell_total := _cols * _rows
	if cell_total <= 0:
		return
	var final_info: Array = []
	final_info.resize(cell_total)
	final_info.fill({})
	# ★ 100 号这类地图：靠上的 tile 层引用了「资源表里根本不存在」的图
	#   （182/183/136/138 —— 原版 gd 资源表里没有这几个键，客户端也取不到），
	#   于是那一层画不出来，盖不住底下 layer5 的淡色 106_1，整片就露出浅白色块。
	#   处理：把「引用了坏资源的格子」当作空洞交给补洞，用周围真实地面填上。
	#   ★ 只对白名单地图生效：275/276 的缺图格另有成因（黑色阴影层），
	#     用户明确要求先别动，绝不能因为这条改动被动到。
	var track_broken := _fill_broken_maps.has(map_id)
	_broken_cells.clear()
	if track_broken:
		_broken_cells.resize(cell_total)
		_broken_cells.fill(false)
	# 倒序 = 底 → 顶，后写覆盖先写，得到每格最终可见的地面。
	for li in range(layers.size() - 1, -1, -1):
		var layer = layers[li]
		if not (layer is Dictionary) or int(layer.get("type", 0)) != 2:
			continue
		if not (layer.get("data") is Array):
			continue
		var cells: Array = layer["data"]
		var count := mini(cells.size(), cell_total)
		for i in range(count):
			var idx := int(cells[i]) & 255
			if idx == 255 or idx >= _tile_list.size():
				continue
			var t: Dictionary = _tile_list[idx]
			if not _skip_tiles.is_empty() and _skip_tiles.has(str(t.get("src", ""))):
				continue
			var res = _resolve(str(t.get("src", "")), true)
			if res.is_empty():
				if track_broken:
					_broken_cells[i] = true
				continue
			var region: Rect2 = res.get("region")
			var crop_x := region.size.x > _tile_w
			var crop_y := region.size.y > _tile_h
			region = Rect2(
				region.position.x + (int(t.get("col", 0)) * _tile_w if crop_x else 0),
				region.position.y + (int(t.get("row", 0)) * _tile_h if crop_y else 0),
				_tile_w if crop_x else region.size.x,
				_tile_h if crop_y else region.size.y)
			# 全透明的 tile 等于没画，不能算「这一格有地面」。
			# ★ 还要排除「只有半透明层」的格子：137（石路 0.4）、91（阴影 0.4）、
			#   135/184/255（光照蒙版 0.4）这些本来就是「叠在别的地面上」的叠加层。
			#   如果它们下面没有实心地面，叠出来就是一条条半透明白斑——
			#   260 号圆盘周围那片「地形不对」就是这么来的。
			if not _region_is_solid(res.get("texture"), region):
				continue
			if _region_brightness(res.get("texture"), region) < 0.12:
				continue
			final_info[i] = {"texture": res.get("texture"), "region": region,
				"transform": int(t.get("transform", 0)), "src": str(t.get("src", ""))}
	# 白名单地图里：最终可见地面是「过亮的浅色地面」的格子，也当空洞重填。
	# 100 号中下部整片是 106_1（原版就是这张淡色图，亮度≈0.60），
	# 上层本该盖住它的 182/183 在资源表里不存在，于是整片发白、边缘是直角阶梯。
	# 只靠「坏格」修不动：相邻的格子照样显示 106_1，最后一半白一半草，更花。
	if track_broken:
		for i in range(cell_total):
			var fi: Dictionary = final_info[i]
			if fi.is_empty():
				continue
			if _replace_srcs.has(str(fi.get("src", ""))):
				final_info[i] = {}
				_broken_cells[i] = true
	# ★ 补洞按「空连通区」整块处理，不再给每个洞孤立地就近取一块地面。
	#   孤立取色的后果：100 号中下部那片大空洞，中心取到了远处的浅色石板，
	#   整片填成一块突兀的浅白（用户点名）。现在改成：
	#     1) 找出一片连通的空格区；
	#     2) 若它碰到地图边界 → 那是地图外框/水域外围，一律不填；
	#     3) 否则从区域边缘逐圈向内扩散，每格取「周围已确定地面里出现最多的那种」，
	#        材质沿边界自然延伸，不会在洞中间蹦出一块异色。
	var filled := _fill_enclosed_holes(final_info)
	if OS.has_environment("WORLDOL_DEBUG_PREFILL"):
		print("[prefill] map=", map_id, " 总格=", cell_total, " 填充=", filled,
			" 坏格=", _broken_cells.size(), " 样本=", _dbg_sample)


## 引用「资源表里不存在的图」的地图（只对它们把坏格子当空洞补）。
## 100：layer3 用的 182/183/136/138 在原版资源表里没有，盖不住 layer5 的淡色 106_1，
##      导致中下部整片浅白。275/276 有同类现象但成因不同，用户要求先不动，别加进来。
const _fill_broken_maps := []
## 白名单地图里：最终可见地面是这些资源名的格子，一律当空洞重填（换成周围正常草地）。
var _replace_srcs: Array = ["106_1"]
## 白名单地图 → 替代地面资源名（坏格与该替换格统一铺这一种）。
## 100：正常草地就是 304；靠自动挑邻居会挑到 203_5 水域，整片发花。
const _replace_ground := {100: "304"}
## 压暗处理：只对这张地图、这些资源名的 tile 轻微叠一层暗色。
const _tone_down_map := 100
var _tone_down_srcs: Array = ["106_1"]
const _tone_down_alpha := 0.16
## 这些格子（下标记）在 _draw 里整格跳过 tile 绘制，只显示补出来的兜底地面。
var _broken_cells: Array = []
var _dbg_sample: String = ""


## 对每个「完全被地面包围」的空连通区做逐圈填充，返回填充格数。
func _fill_enclosed_holes(final_info: Array) -> int:
	var cell_total := _cols * _rows
	# 引用坏资源的格子：先丢掉它低层画出来的淡色地面，当空洞处理。
	if not _broken_cells.is_empty():
		for i in range(mini(_broken_cells.size(), cell_total)):
			if _broken_cells[i]:
				final_info[i] = {}
	if OS.has_environment("WORLDOL_NOFILL"):
		return 0
	var visited: Array = []
	visited.resize(cell_total)
	visited.fill(false)
	var filled := 0
	var dirs: Array = [Vector2i(0, -1), Vector2i(0, 1), Vector2i(-1, 0), Vector2i(1, 0)]
	# 坏格区的统一填充样本：所有坏格共用同一块地面，整片材质一致。
	# 若按每小块各取样本，304 的 6 个不同亮度子格会随机混进来，整片变成马赛克棋盘。
	var broken_fill: Dictionary = {}
	if _replace_ground.has(map_id):
		# 白名单地图直接指定替代地面：自动挑邻居会挑到 203_5（水域）这类不合适的东西。
		var rr = _resolve(str(_replace_ground[map_id]), true)
		if not rr.is_empty():
			var reg0: Rect2 = rr.get("region")
			if reg0.size.x > _tile_w or reg0.size.y > _tile_h:
				# 取图集里偏暗的那一格当草地主体（304 的 (0,1) 亮度≈0.45）。
				reg0 = Rect2(reg0.position.x, reg0.position.y + _tile_h, _tile_w, _tile_h)
			broken_fill = {"texture": rr.get("texture"), "region": reg0,
				"transform": 0, "src": str(_replace_ground[map_id])}
	if broken_fill.is_empty() and not _broken_cells.is_empty():
		for i in range(cell_total):
			if i >= _broken_cells.size() or not bool(_broken_cells[i]):
				continue
			if not (final_info[i] as Dictionary).is_empty():
				continue
			var s := _find_normal_ground(i, final_info, dirs)
			if not s.is_empty():
				broken_fill = s
				_dbg_sample = str(s.get("src", "")) + " " + str(s.get("region"))
				break
	for seed in range(cell_total):
		if visited[seed] or not (final_info[seed] as Dictionary).is_empty():
			continue
		var seed_broken := (not _broken_cells.is_empty() and seed < _broken_cells.size()
			and bool(_broken_cells[seed]))
		# ---- 收集这一片连通空格 ----
		var region_cells: Array = []
		var touches_edge := false
		var stack: Array = [seed]
		visited[seed] = true
		while not stack.is_empty():
			var cur: int = stack.pop_back()
			region_cells.append(cur)
			var cc: int = cur % _cols
			var cr: int = cur / _cols
			# 只有「本来就是空格」的格子在边缘才判成地图外框；
			# 「引用坏资源的格子」是已知该有地面、只是取不到图，必须补，不能因贴边被豁免。
			var is_broken := (not _broken_cells.is_empty() and cur < _broken_cells.size()
				and bool(_broken_cells[cur]))
			if not is_broken and (cc == 0 or cr == 0 or cc == _cols - 1 or cr == _rows - 1):
				touches_edge = true
			for dv in dirs:
				var d: Vector2i = dv
				var nc: int = cc + d.x
				var nr: int = cr + d.y
				if nc < 0 or nr < 0 or nc >= _cols or nr >= _rows:
					continue
				var ni: int = nr * _cols + nc
				if visited[ni] or not (final_info[ni] as Dictionary).is_empty():
					continue
				# 坏格与「本来就空」的格子分成两个独立连通区，
				# 否则坏格会顺着外部空旷区一路连到地图边缘，被 touches_edge 整片豁免。
				var nb_broken := (not _broken_cells.is_empty() and ni < _broken_cells.size()
					and bool(_broken_cells[ni]))
				if nb_broken != is_broken:
					continue
				visited[ni] = true
				stack.append(ni)
		if touches_edge:
			continue
		# 坏格区（整片地面图取不到）：整片统一用同一个地面样本。
		var uniform: Dictionary = {}
		if seed_broken and not broken_fill.is_empty():
			uniform = broken_fill
		# ---- 逐圈向内扩散填充 ----
		var queued: Array = []
		queued.resize(cell_total)
		queued.fill(false)
		var queue: Array = []
		for cell in region_cells:
			if _has_ground_neighbor(cell, final_info, dirs):
				queue.append(cell)
				queued[cell] = true
		var head := 0
		while head < queue.size():
			var cur2: int = queue[head]
			head += 1
			if not (final_info[cur2] as Dictionary).is_empty():
				continue
			var d2: Dictionary
			if not uniform.is_empty():
				d2 = uniform
			else:
				var pick := _pick_mode_neighbor(cur2, final_info, dirs)
				if pick < 0:
					continue
				d2 = final_info[pick]
			_draw_tex(d2.get("texture"), Rect2(cur2 % _cols * _tile_w,
				cur2 / _cols * _tile_h, _tile_w, _tile_h), d2.get("region"),
				int(d2.get("transform", 0)))
			final_info[cur2] = {
				"texture": d2.get("texture"), "region": d2.get("region"),
				"transform": int(d2.get("transform", 0)), "src": str(d2.get("src", ""))}
			filled += 1
			var c2: int = cur2 % _cols
			var r2: int = cur2 / _cols
			for dv2 in dirs:
				var d3: Vector2i = dv2
				var nc2: int = c2 + d3.x
				var nr2: int = r2 + d3.y
				if nc2 < 0 or nr2 < 0 or nc2 >= _cols or nr2 >= _rows:
					continue
				var ni2: int = nr2 * _cols + nc2
				if queued[ni2] or not (final_info[ni2] as Dictionary).is_empty():
					continue
				queued[ni2] = true
				queue.append(ni2)
	return filled


## 找一块「正常亮度」的地面当坏格填充样本。
## 为什么要限亮度：坏格旁边往往就是那片过亮的浅色地面（100 号是 106_1，亮度≈0.60），
## 直接取邻居众数等于原样不动；取回来还是浅白，等于没修。
## 这里只接受亮度 0.25–0.55 的地面（草地/泥地/石板路都在这个区间）。
func _find_normal_ground(index: int, final_info: Array, dirs: Array) -> Dictionary:
	var col := index % _cols
	var row := index / _cols
	for radius in range(1, 6):
		for dr in range(-radius, radius + 1):
			for dc in range(-radius, radius + 1):
				if maxi(absi(dr), absi(dc)) != radius:
					continue
				var nc: int = col + dc
				var nr: int = row + dr
				if nc < 0 or nr < 0 or nc >= _cols or nr >= _rows:
					continue
				var info: Dictionary = final_info[nr * _cols + nc]
				if info.is_empty():
					continue
				var b := _region_brightness(info.get("texture"), info.get("region"))
				if b >= 0.25 and b <= 0.55:
					return info
	return {}


func _has_ground_neighbor(index: int, final_info: Array, dirs: Array) -> bool:
	var col := index % _cols
	var row := index / _cols
	for dv in dirs:
		var d: Vector2i = dv
		var nc: int = col + d.x
		var nr: int = row + d.y
		if nc < 0 or nr < 0 or nc >= _cols or nr >= _rows:
			continue
		if not (final_info[nr * _cols + nc] as Dictionary).is_empty():
			return true
	return false


## 四邻里出现次数最多的地面材质；平票时取更亮的那块（避免挑中阴影）。
func _pick_mode_neighbor(index: int, final_info: Array, dirs: Array) -> int:
	var col := index % _cols
	var row := index / _cols
	var counts := {}
	var best_of := {}
	var best := -1
	for dv in dirs:
		var d: Vector2i = dv
		var nc: int = col + d.x
		var nr: int = row + d.y
		if nc < 0 or nr < 0 or nc >= _cols or nr >= _rows:
			continue
		var ni: int = nr * _cols + nc
		var info: Dictionary = final_info[ni]
		if info.is_empty():
			continue
		var key := str(info.get("src", ""))
		counts[key] = int(counts.get(key, 0)) + 1
		if not best_of.has(key):
			best_of[key] = {"idx": ni, "bright": _region_brightness(info.get("texture"), info.get("region"))}
		elif float(best_of[key]["bright"]) < _region_brightness(info.get("texture"), info.get("region")):
			best_of[key] = {"idx": ni, "bright": _region_brightness(info.get("texture"), info.get("region"))}
	if counts.is_empty():
		return -1
	var best_key := ""
	var best_count := -1
	var best_bright := -1.0
	for k in counts.keys():
		var c := int(counts[k])
		var b := float(best_of[k]["bright"])
		if c > best_count or (c == best_count and b > best_bright):
			best_key = str(k)
			best_count = c
			best_bright = b
	best = int(best_of[best_key]["idx"])
	return best


## 这一格是否铺了「实心地面」：不透明像素要占到一半以上。
## 用来把「纯叠加层」排除在地面之外——137/91/135/184/255 这些图整体 alpha≈0.4，
## 本来就是叠在别的地面上的（石路纹理 / 阴影 / 光照），单独存在就只剩半透明白斑。
var _solid_cache: Dictionary = {}

func _region_is_solid(tex: Texture2D, region: Rect2) -> bool:
	if tex == null:
		return false
	var key := "%d|%d,%d,%d,%d" % [tex.get_instance_id(),
		int(region.position.x), int(region.position.y),
		int(region.size.x), int(region.size.y)]
	if _solid_cache.has(key):
		return bool(_solid_cache[key])
	var img := tex.get_image()
	var solid := false
	if img != null:
		var r := Rect2i(int(region.position.x), int(region.position.y),
			int(region.size.x), int(region.size.y))
		r = r.intersection(Rect2i(0, 0, img.get_width(), img.get_height()))
		if r.size.x > 0 and r.size.y > 0:
			var total := 0
			var opaque := 0
			var step := maxi(1, mini(r.size.x, r.size.y) / 10)
			for y in range(r.position.y, r.position.y + r.size.y, step):
				for x in range(r.position.x, r.position.x + r.size.x, step):
					total += 1
					if img.get_pixel(x, y).a >= 0.85:
						opaque += 1
			solid = total > 0 and float(opaque) / float(total) >= 0.5
	_solid_cache[key] = solid
	return solid


## 判断一段纹理区域里有没有不透明像素（缓存）。全透明 = 这一格实际没画出东西。
var _opaque_cache: Dictionary = {}

func _region_has_pixels(tex: Texture2D, region: Rect2) -> bool:
	if tex == null:
		return false
	var key := "%d|%d,%d,%d,%d" % [tex.get_instance_id(),
		int(region.position.x), int(region.position.y),
		int(region.size.x), int(region.size.y)]
	if _opaque_cache.has(key):
		return bool(_opaque_cache[key])
	var img := tex.get_image()
	var ok := false
	if img != null:
		var r := Rect2i(int(region.position.x), int(region.position.y),
			int(region.size.x), int(region.size.y))
		r = r.intersection(Rect2i(0, 0, img.get_width(), img.get_height()))
		if r.size.x > 0 and r.size.y > 0:
			# 稀疏采样即可：只为判断「是否全透明」，不必逐像素。
			var step := maxi(1, mini(r.size.x, r.size.y) / 8)
			for y in range(r.position.y, r.position.y + r.size.y, step):
				for x in range(r.position.x, r.position.x + r.size.x, step):
					if img.get_pixel(x, y).a > 0.15:
						ok = true
						break
				if ok:
					break
	_opaque_cache[key] = ok
	return ok


## 在 final_info 里找最近一个「够亮」的地面格来补洞。
## ★ 必须跳过纯黑贴图：91.png 这类资源是全黑阴影（RGB 全 0、只有 alpha），
##   拿它当填充源会直接填出一块黑方块——275/276 的黑块就是这么来的。
func _nearest_bright_info(index: int, final_info: Array) -> int:
	var dark_fallback := -1
	var col := index % _cols
	var row := index / _cols
	for radius in range(1, 7):
		for dr in range(-radius, radius + 1):
			for dc in range(-radius, radius + 1):
				if maxi(absi(dr), absi(dc)) != radius:
					continue
				var nc := col + dc
				var nr := row + dr
				if nc < 0 or nr < 0 or nc >= _cols or nr >= _rows:
					continue
				var ni := nr * _cols + nc
				var info: Dictionary = final_info[ni]
				if info.is_empty():
					continue
				if _region_brightness(info.get("texture"), info.get("region")) >= 0.30:
					return ni
				if dark_fallback < 0:
					dark_fallback = ni
	return dark_fallback


## 纹理区域里不透明像素的平均亮度（0–1）。用于区分「地面」和「黑色阴影」。
var _bright_cache: Dictionary = {}

func _region_brightness(tex: Texture2D, region: Rect2) -> float:
	if tex == null:
		return 0.0
	var key := "%d|%d,%d,%d,%d" % [tex.get_instance_id(),
		int(region.position.x), int(region.position.y),
		int(region.size.x), int(region.size.y)]
	if _bright_cache.has(key):
		return float(_bright_cache[key])
	var img := tex.get_image()
	var sum := 0.0
	var n := 0
	if img != null:
		var r := Rect2i(int(region.position.x), int(region.position.y),
			int(region.size.x), int(region.size.y))
		r = r.intersection(Rect2i(0, 0, img.get_width(), img.get_height()))
		var step := maxi(1, mini(r.size.x, r.size.y) / 8)
		for y in range(r.position.y, r.position.y + r.size.y, step):
			for x in range(r.position.x, r.position.x + r.size.x, step):
				var p := img.get_pixel(x, y)
				if p.a > 0.15:
					sum += (p.r + p.g + p.b) / 3.0
					n += 1
	var v := sum / float(maxi(n, 1))
	_bright_cache[key] = v
	return v


## 在 final_info 里找最近一个非空地面格（只用于补洞，找不到返回 -1）。
func _nearest_info(index: int, final_info: Array) -> int:
	var col := index % _cols
	var row := index / _cols
	for radius in range(1, 7):
		for dr in range(-radius, radius + 1):
			for dc in range(-radius, radius + 1):
				if maxi(absi(dr), absi(dc)) != radius:
					continue
				var nc := col + dc
				var nr := row + dr
				if nc < 0 or nr < 0 or nc >= _cols or nr >= _rows:
					continue
				var ni := nr * _cols + nc
				if not (final_info[ni] as Dictionary).is_empty():
					return ni
	return -1


func _nearest_painted(index: int, painted: Array) -> int:
	var col := index % _cols
	var row := index / _cols
	for radius in range(1, 6):
		for dr in range(-radius, radius + 1):
			for dc in range(-radius, radius + 1):
				if maxi(absi(dr), absi(dc)) != radius:
					continue
				var nc := col + dc
				var nr := row + dr
				if nc < 0 or nr < 0 or nc >= _cols or nr >= _rows:
					continue
				var ni := nr * _cols + nc
				if painted[ni]:
					return ni
	return -1


func _background() -> Texture2D:
	var path := "res://assets/map_bg/" + str(map_id) + ".jpg"
	if FileAccess.file_exists(path):
		return load(path) as Texture2D
	return null


func _resolve(name: String, prefer_slice: bool = false) -> Dictionary:
	var key := name + ("|slice" if prefer_slice else "|atlas")
	if _tex_cache.has(key):
		return _tex_cache[key]
	var out: Dictionary = {}
	var slice_path := SLICE_DIR + name + ".png"
	# 原版 tile 层走 setSrc() 直接加载 map_slice/<name>.png，不查 map_merged；
	# 物件层才走 merged.getTexture()。同名资源在图集与切片里可能不是一回事。
	if prefer_slice and FileAccess.file_exists(slice_path):
		var slice_tex := load(slice_path) as Texture2D
		if slice_tex != null:
			out = {"texture": slice_tex, "region": Rect2(0, 0,
				float(slice_tex.get_width()), float(slice_tex.get_height()))}
	if out.is_empty():
		# 1) 本图图集；2) 别的地图图集里同名的帧（资源名是全局的）；3) 原始切片。
		if _atlas != null and _atlas_frames.has(name):
			out = _logical_frame(_atlas, _atlas_frames[name])
		elif _frames_index.has(name):
			var entry: Dictionary = _frames_index[name]
			var alt := int(entry.get("atlas", 0))
			var img := _atlas_image(alt)
			if img != null:
				out = _logical_frame(img, entry.get("frame", {}))
	if out.is_empty() and FileAccess.file_exists(slice_path):
		var tex := load(slice_path) as Texture2D
		if tex != null:
			out = {"texture": tex, "region": Rect2(0, 0,
				float(tex.get_width()), float(tex.get_height()))}
	# 找不到就留空：绝不拿 sprite_fragment 的角色部件冒充地图贴图。
	_tex_cache[key] = out
	return out


func _atlas_image(id: int) -> Image:
	if _atlas_images.has(id):
		return _atlas_images[id]
	var path := ATLAS_DIR + str(id) + ".png"
	var img: Image = null
	if FileAccess.file_exists(path):
		var tex := load(path) as Texture2D
		if tex != null:
			img = tex.get_image()
	_atlas_images[id] = img
	return img


## 图集帧的 w/h 是实际像素，sourceW/sourceH + offX/offY 才是原版 sprite 的逻辑包围盒。
## 直接拿 w/h 画会让 1101 这类带左偏移 4px 的物件整体错位并被拉伸。
func _logical_frame(atlas, frame) -> Dictionary:
	if not (frame is Dictionary):
		return {}
	var img: Image = null
	if atlas is Image:
		img = atlas
	elif atlas is Texture2D:
		img = (atlas as Texture2D).get_image()
	if img == null:
		return {}
	var fw := maxi(1, int(frame.get("w", 1)))
	var fh := maxi(1, int(frame.get("h", 1)))
	var sw := maxi(fw, int(frame.get("sourceW", fw)))
	var sh := maxi(fh, int(frame.get("sourceH", fh)))
	var ox := clampi(int(frame.get("offX", 0)), 0, maxi(sw - fw, 0))
	var oy := clampi(int(frame.get("offY", 0)), 0, maxi(sh - fh, 0))
	var fx := int(frame.get("x", 0))
	var fy := int(frame.get("y", 0))
	if fx < 0 or fy < 0 or fx + fw > img.get_width() or fy + fh > img.get_height():
		return {}
	var box := Image.create(sw, sh, false, Image.FORMAT_RGBA8)
	box.fill(Color(0, 0, 0, 0))
	box.blit_rect(img, Rect2i(fx, fy, fw, fh), Vector2i(ox, oy))
	return {"texture": ImageTexture.create_from_image(box), "logical": true,
		"region": Rect2(0, 0, float(sw), float(sh))}


## 变换枚举与原版 client/js 的 t.transform() 完全一致（egret 锚点在左上角）。
## ★ 不用 draw_set_transform 在画布上旋转：旋转 + 负缩放叠加时，旋转后的包围盒
##   与目标矩形对不齐，会露出底色方块（16 号石头 361 曾画成青绿矩形）。
##   改为「先按 region 裁出子图 → 用 Image 做变换 → 尺寸换成变换后的尺寸画」，
##   位置仍是 (x, y)，结果与原版旋转后的目标矩形 (x, y, h, w) 一致。
##   Image 变换与 egret 的对应关系：
##     MIRROR_V(1)  flip_y                      MIRROR_H(2)  flip_x
##     ROT180(3)    flip_x + flip_y             ROT90(5)     rotate 90 顺时针
##     ROT270(6)    rotate 90 逆时针            MIRROR_H_90(4)  flip_y + rotate 顺时针
##     MIRROR_H_270(7) flip_y + rotate 逆时针
func _draw_tex(tex: Texture2D, dest: Rect2, region: Rect2, transform: int) -> void:
	if tex == null:
		return
	if transform == 0:
		# 无变换支持 dest 缩放（tile 层把子帧画到 24×24）。
		draw_texture_rect_region(tex, dest, region)
		return
	var prep := _transformed_texture(tex, region, transform)
	if prep.is_empty():
		draw_texture_rect_region(tex, dest, region)
		return
	draw_texture_rect(prep.get("texture"), Rect2(dest.position, prep.get("size")), false)


## 按 (纹理, 源区域, 变换) 缓存变换后的子图，避免每帧重建。
func _transformed_texture(tex: Texture2D, region: Rect2, transform: int) -> Dictionary:
	var key := "%d|%d,%d,%d,%d|%d" % [tex.get_instance_id(),
		int(region.position.x), int(region.position.y),
		int(region.size.x), int(region.size.y), transform]
	if _xform_cache.has(key):
		return _xform_cache[key]
	var full := tex.get_image()
	if full == null:
		return {}
	var r := Rect2i(int(region.position.x), int(region.position.y),
		int(region.size.x), int(region.size.y))
	# 夹到图像范围内，避免 get_region 越界报错。
	r = r.intersection(Rect2i(0, 0, full.get_width(), full.get_height()))
	if r.size.x <= 0 or r.size.y <= 0:
		return {}
	var sub := full.get_region(r)
	match transform:
		1:
			sub.flip_y()
		2:
			sub.flip_x()
		3:
			sub.flip_x()
			sub.flip_y()
		5:
			sub.rotate_90(ClockDirection.CLOCKWISE)
		6:
			sub.rotate_90(ClockDirection.COUNTERCLOCKWISE)
		4:
			sub.flip_y()
			sub.rotate_90(ClockDirection.CLOCKWISE)
		7:
			sub.flip_y()
			sub.rotate_90(ClockDirection.COUNTERCLOCKWISE)
	var out := {"texture": ImageTexture.create_from_image(sub),
		"size": Vector2(sub.get_width(), sub.get_height())}
	_xform_cache[key] = out
	return out
