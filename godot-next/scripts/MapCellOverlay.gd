extends Node2D
## 单层「格子叠色」节点：给指定格子盖一层半透明颜色。
##
## 目前唯一的用途是 100 号地图：下中部的 106_1 地面原版素材本身偏亮（亮度≈0.60），
## 上层本该盖住它的 182/183 在原版资源表里不存在，整片发白很突兀，这里轻微压暗。
## 做成独立节点是为了保持「只压那一层」的绘制顺序（旧实现在 tile 循环里顺带 draw_rect）。

var cells: Array = []          # 格子下标（row*cols+col）
var cols: int = 0
var cell_size := Vector2(24, 24)
var tint := Color(0, 0, 0, 0.16)


func _draw() -> void:
	if cols <= 0:
		return
	for i in cells:
		var idx := int(i)
		draw_rect(Rect2(idx % cols * cell_size.x, idx / cols * cell_size.y,
			cell_size.x, cell_size.y), tint, true)
