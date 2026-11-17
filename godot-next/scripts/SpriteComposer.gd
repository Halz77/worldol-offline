extends RefCounted
## 按原版 v305 帧表拼装角色造型 —— 纯 GDScript，零外部依赖。
##
## 规格来源：analysis/modules 的 FrameBmp，以及已经用 Chrome 实拍验证过的
## sprite-workbench.mjs 实现。移植时四个坑必须照搬，否则人物会散架：
##   1. frames[帧号] 的数组顺序就是遮挡层级，必须逐层按顺序画；
##   2. 子帧表的键不一定从 0 连续（如 3001.json 是 1~14），要按键名取；
##   3. offX/offY/sourceW/sourceH 重建包围盒，不能直接用图集上的 w/h；
##   4. flip 3/5 是 90/270 度旋转，定位要用「变换后」的宽高居中。
##
## 素材：res://assets/sprite_model/<id>.json（组装表）
##       res://assets/sprite_fragment/<id>.png + .json（图集与子帧表）
## 改图：在 Godot 编辑器里直接替换对应 PNG，不需要重新导入、不需要 Node。

const CANVAS_W = 180
const CANVAS_H = 200
const ANCHOR_Y = 170
const MODEL_DIR = "res://assets/sprite_model/"
const FRAG_DIR = "res://assets/sprite_fragment/"


static func _read_json(file_path: String):
	if not FileAccess.file_exists(file_path):
		return null
	var text = FileAccess.get_file_as_string(file_path)
	if text.is_empty():
		return null
	return JSON.parse_string(text)


## 该 Model 有哪些帧（升序，供播放与下拉选择）。
static func frame_numbers(model_id: int) -> Array:
	var model = _read_json(MODEL_DIR + str(model_id) + ".json")
	if not (model is Dictionary):
		return []
	var frames = model.get("frames", {})
	if not (frames is Dictionary):
		return []
	var keys := []
	for k in frames.keys():
		keys.append(int(k))
	keys.sort()
	return keys


static func render_frame_image(model_id: int, frame_no: int = 0) -> Image:
	var model = _read_json(MODEL_DIR + str(model_id) + ".json")
	if not (model is Dictionary):
		return null
	var files = model.get("files", [])
	var frames = model.get("frames", {})
	if not (frames is Dictionary):
		return null
	var all_frames = frame_numbers(model_id)
	var wanted = str(frame_no)
	if not frames.has(wanted) and not all_frames.is_empty():
		wanted = str(all_frames[0])
	var layers = frames.get(wanted, null)
	if not (layers is Array):
		return null

	var canvas = Image.create(CANVAS_W, CANVAS_H, false, Image.FORMAT_RGBA8)
	canvas.fill(Color(0, 0, 0, 0))
	for layer in layers:
		if not (layer is Array) or layer.size() < 4:
			continue
		var file_idx = int(layer[0])
		if file_idx < 0 or file_idx >= files.size():
			continue
		var frag_id = int(files[file_idx])
		var sub = int(layer[1])
		var dx = int(layer[2])
		var dy = int(layer[3])
		var flip = int(layer[4]) if layer.size() > 4 else 0
		var box = _sub_frame(frag_id, sub)
		if box == null:
			continue
		var transformed = _transform(box, flip)
		var px = roundi(float(CANVAS_W) / 2.0 + float(dx) - float(transformed.get_width()) / 2.0)
		var py = roundi(float(ANCHOR_Y) + float(dy) - float(transformed.get_height()) / 2.0)
		_blend(canvas, transformed, px, py)
	return canvas


static func render_frame(model_id: int, frame_no: int = 0, scale: int = 3) -> ImageTexture:
	var img = render_frame_image(model_id, frame_no)
	if img == null:
		return null
	if scale > 1:
		img.resize(CANVAS_W * scale, CANVAS_H * scale, Image.INTERPOLATE_NEAREST)
	return ImageTexture.create_from_image(img)


## 从图集切出子帧，并按 sourceW/sourceH + offX/offY 还原包围盒。
static func _sub_frame(frag_id: int, sub: int) -> Image:
	var png = FRAG_DIR + str(frag_id) + ".png"
	if not FileAccess.file_exists(png):
		return null
	var atlas = Image.new()
	if atlas.load_png_from_buffer(FileAccess.get_file_as_bytes(png)) != OK:
		return null
	if atlas.get_format() != Image.FORMAT_RGBA8:
		atlas.convert(Image.FORMAT_RGBA8)

	var f = {}
	var table = _read_json(FRAG_DIR + str(frag_id) + ".json")
	if table is Dictionary:
		var subs = table.get("frames", {})
		if subs is Dictionary:
			if subs.has(str(sub)):
				f = subs[str(sub)]
			elif not subs.is_empty():
				f = subs[subs.keys()[0]]
	if f.is_empty():
		return atlas

	var cw = int(f.get("w", 0))
	var ch = int(f.get("h", 0))
	var fx = int(f.get("x", 0))
	var fy = int(f.get("y", 0))
	if cw <= 0 or ch <= 0 or fx + cw > atlas.get_width() or fy + ch > atlas.get_height():
		return null
	var bw = int(f.get("sourceW", cw))
	var bh = int(f.get("sourceH", ch))
	if bw <= 0:
		bw = cw
	if bh <= 0:
		bh = ch
	var ox = int(f.get("offX", 0))
	var oy = int(f.get("offY", 0))
	var box = Image.create(bw, bh, false, Image.FORMAT_RGBA8)
	box.fill(Color(0, 0, 0, 0))
	for y in range(ch):
		if y + oy < 0 or y + oy >= bh:
			continue
		for x in range(cw):
			if x + ox < 0 or x + ox >= bw:
				continue
			box.set_pixel(x + ox, y + oy, atlas.get_pixel(fx + x, fy + y))
	return box


## flip：0 原样；1/6/7 横镜像；2 竖镜像；4 双向；3/5 旋转 90/270。
static func _transform(box: Image, flip: int) -> Image:
	var w = box.get_width()
	var h = box.get_height()
	if flip == 0:
		return box
	if flip == 3 or flip == 5:
		var rotated = Image.create(h, w, false, Image.FORMAT_RGBA8)
		rotated.fill(Color(0, 0, 0, 0))
		for y in range(h):
			for x in range(w):
				var nx = h - 1 - y if flip == 3 else y
				var ny = x if flip == 3 else w - 1 - x
				rotated.set_pixel(nx, ny, box.get_pixel(x, y))
		return rotated
	var mx = flip == 1 or flip == 4 or flip == 6 or flip == 7
	var my = flip == 2 or flip == 4
	var mirrored = Image.create(w, h, false, Image.FORMAT_RGBA8)
	mirrored.fill(Color(0, 0, 0, 0))
	for y in range(h):
		for x in range(w):
			var tx = w - 1 - x if mx else x
			var ty = h - 1 - y if my else y
			mirrored.set_pixel(tx, ty, box.get_pixel(x, y))
	return mirrored


## 与引擎一致的 alpha 叠放：不透明直接覆盖，半透明做线性混合。
static func _blend(target: Image, src: Image, dx: int, dy: int) -> void:
	var W = target.get_width()
	var H = target.get_height()
	for y in range(src.get_height()):
		var ty = dy + y
		if ty < 0 or ty >= H:
			continue
		for x in range(src.get_width()):
			var tx = dx + x
			if tx < 0 or tx >= W:
				continue
			var s = src.get_pixel(x, y)
			if s.a <= 0.0:
				continue
			if s.a >= 1.0:
				target.set_pixel(tx, ty, Color(s.r, s.g, s.b, 1.0))
			else:
				var d = target.get_pixel(tx, ty)
				var v = 1.0 - s.a
				target.set_pixel(tx, ty, Color(
					s.r * s.a + d.r * v,
					s.g * s.a + d.g * v,
					s.b * s.a + d.b * v,
					maxf(d.a, s.a)
				))
