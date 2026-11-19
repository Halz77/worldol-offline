extends Node2D
## 一个原版物件层（type 3 = Pixel / type 4 = Player）的绘制节点。
##
## 为什么物件不做成 TileMapLayer：物件坐标是任意像素（x,y 带小数），尺寸也各不相同，
## 还带 8 种旋转/镜像变换。TileMapLayer 的格子是整数网格，放不下这种「自由摆放的贴图」。
## 原版本身也是「一张张精灵自由定位」，所以这里保留精灵式绘制，只是把它拆成独立节点：
##   - 图层在场景树里可见、可单独隐藏、顺序由树顺序决定；
##   - 和 TileMapLayer 交错排列，还原原版 addChild 的前后关系；
##   - 贴图解析仍走 WorldMap._resolve()，和地图编辑器、调色板共用同一套规则。

const SpriteComposer = preload("res://scripts/SpriteComposer.gd")

## 宿主 WorldMap（提供 _resolve / _model_texture / 排查开关）
var map: Node2D = null
## 原版 obj 数组：每项 [kind, 资源名, x, y, w, h, transform?, ...]
var objects: Array = []


func _draw() -> void:
	if map == null or objects.is_empty():
		return
	var skip_srcs: Array = map.get("_skip_srcs")
	var ignore_transform := bool(map.get("_ignore_transform"))
	var show_npcs := bool(map.get("show_npcs"))
	for obj in objects:
		if not (obj is Array) or obj.size() < 6:
			continue
		var kind := int(obj[0])
		var x := float(obj[2])
		var y := float(obj[3])
		if kind == 2:
			if not skip_srcs.is_empty() and skip_srcs.has(str(obj[1])):
				continue
			var res: Dictionary = map.call("_resolve", str(obj[1]))
			if not res.is_empty():
				var size: Vector2 = res.get("region").size if bool(res.get("logical", false)) \
					else Vector2(float(obj[4]), float(obj[5]))
				var tr := int(obj[6]) if obj.size() > 6 else 0
				if ignore_transform:
					tr = 0
				_draw_tex(res.get("texture"), Rect2(x, y, size.x, size.y),
					res.get("region"), tr)
		elif kind == 3 or kind == 4:
			if not show_npcs:
				continue
			var tex = map.call("_model_texture", int(obj[5]))
			if tex != null:
				var flip = -1.0 if int(obj[4]) != 0 else 1.0
				draw_set_transform(Vector2(x, y), 0.0, Vector2(0.45 * flip, 0.45))
				draw_texture(tex, Vector2(-SpriteComposer.CANVAS_W / 2.0,
					-SpriteComposer.ANCHOR_Y))
				draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


## 与原版 client/js 的 t.transform() 一致的贴图变换。
## ★ 不用 draw_set_transform 在画布上旋转：旋转 + 负缩放叠加时包围盒对不齐，
##   会露出底色方块（16 号石头 361 曾画成青绿矩形）。改为先裁子图、用 Image 做变换。
func _draw_tex(tex: Texture2D, dest: Rect2, region: Rect2, transform: int) -> void:
	if tex == null:
		return
	if transform == 0:
		draw_texture_rect_region(tex, dest, region)
		return
	var prep: Dictionary = map.call("_transformed_texture", tex, region, transform)
	if prep.is_empty():
		draw_texture_rect_region(tex, dest, region)
		return
	draw_texture_rect(prep.get("texture"), Rect2(dest.position, prep.get("size")), false)
