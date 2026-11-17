extends Node2D
## 地图编辑器叠加层：阻挡格 / 格线 / 悬停格 / 出生点。
## 画在 MapRoot 之上（场景里必须排在它后面），只负责「提示」，不改任何数据。

const COL_GRID := Color(1, 1, 1, 0.10)
const COL_GRID_STRONG := Color(1, 1, 1, 0.22)
const COL_BLOCK := Color(0.95, 0.15, 0.2, 0.36)
const COL_HOVER := Color(0.4, 1.0, 0.5, 0.95)
const COL_HOVER_ERASE := Color(1.0, 0.55, 0.2, 0.95)
const COL_SPAWN := Color(0.3, 0.9, 1.0, 0.95)
const COL_BORDER := Color(0.5, 0.8, 1.0, 0.5)

## 由 MapEditor 在 _ready 里注入（这里不 preload，避免循环引用）。
var editor: Node = null


func _draw() -> void:
	if editor == null:
		return
	var cfg: Dictionary = editor.call("current_cfg")
	if cfg.is_empty():
		return
	var tw := maxi(1, int(cfg.get("tW", 24)))
	var th := maxi(1, int(cfg.get("tH", 24)))
	var cols := int(cfg.get("mW", 0)) / tw
	var rows := int(cfg.get("mH", 0)) / th
	if cols <= 0 or rows <= 0:
		return
	var w := cols * tw
	var h := rows * th

	# ---- 阻挡格：红块。数据只有 bit0，其它位留给以后的地形语义 ----
	if bool(editor.get("show_blocks")):
		var blocks = cfg.get("blocks", [])
		if blocks is Array:
			var n: int = mini(blocks.size(), cols * rows)
			for i in range(n):
				if (int(blocks[i]) & 1) != 0:
					draw_rect(Rect2((i % cols) * tw, (i / cols) * th, tw, th),
						COL_BLOCK, true)

	# ---- 格线：缩得太小时不画，否则糊成一片 ----
	var zoom := float(editor.call("view_zoom"))
	if bool(editor.get("show_grid")) and zoom >= 0.4:
		for c in range(cols + 1):
			var x := c * tw
			draw_line(Vector2(x, 0), Vector2(x, h),
				COL_GRID_STRONG if c % 5 == 0 else COL_GRID, 1.0)
		for r in range(rows + 1):
			var y := r * th
			draw_line(Vector2(0, y), Vector2(w, y),
				COL_GRID_STRONG if r % 5 == 0 else COL_GRID, 1.0)

	draw_rect(Rect2(0, 0, w, h), COL_BORDER, false, 2.0)

	# ---- 出生点（worldMaps.<id>.spawn，格子坐标） ----
	var sp: Vector2i = editor.call("spawn_cell")
	if sp.x >= 0 and sp.y >= 0 and sp.x < cols and sp.y < rows:
		draw_rect(Rect2(sp.x * tw + 2, sp.y * th + 2, tw - 4, th - 4),
			COL_SPAWN, false, 2.0)

	# ---- 悬停格 ----
	var cell: Vector2i = editor.get("hover_cell")
	if cell.x >= 0 and cell.y >= 0 and cell.x < cols and cell.y < rows:
		var col := COL_HOVER_ERASE if bool(editor.call("is_erasing")) else COL_HOVER
		draw_rect(Rect2(cell.x * tw, cell.y * th, tw, th), col, false, 2.0)
