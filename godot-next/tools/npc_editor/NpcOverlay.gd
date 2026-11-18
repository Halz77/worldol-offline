extends Node2D
## NPC 编辑器叠加层：负责画 NPC 造型、名字、选中框、悬停格与展厅格子边框。
## 定位公式必须和 WorldMap._draw_npc_sprite 完全一致（矩形由编辑器统一算，这里只画），
## 否则编辑器里对好了、进游戏又错位。

const COL_SEL := Color(1.0, 0.85, 0.2, 0.95)
const COL_HOVER := Color(0.45, 1.0, 0.6, 0.7)
const COL_CELL := Color(1, 1, 1, 0.10)
const COL_NAME := Color(1, 1, 0.85)
const COL_NAME_SHADOW := Color(0, 0, 0, 0.85)
const COL_MISSING := Color(1, 0.35, 0.35, 0.9)

## 由 NPCEditor 在 _ready 注入（不 preload，避免互相引用）。
var editor: Node = null


func _draw() -> void:
	if editor == null:
		return
	var list: Array = editor.get("npcs")
	if not list is Array:
		return
	var zoom := float(editor.call("view_zoom"))
	var font := ThemeDB.fallback_font

	# 展厅格子（每个 NPC 一格 96×120）：缩得太小时不画，否则糊成一片
	if bool(editor.get("show_cells")) and zoom >= 0.35:
		for id in editor.call("cell_rects"):
			draw_rect(id, COL_CELL, false, 1.0)

	for i in range(list.size()):
		var n = list[i]
		if not (n is Dictionary):
			continue
		var r: Rect2 = editor.call("npc_rect", n)
		var tex: Texture2D = editor.call("npc_texture", n)
		if tex != null:
			draw_texture_rect(tex, r, false)
		else:
			# 没有可用图标也要能看见实体，否则没法选中/编辑
			var c := r.position + r.size * 0.5
			draw_line(c - Vector2(9, 9), c + Vector2(9, 9), COL_MISSING, 2.0)
			draw_line(c - Vector2(9, -9), c + Vector2(9, -9), COL_MISSING, 2.0)

		# 名字：只在放大到能看清时画，300 个标签在缩略视图里只会糊成一团
		if bool(editor.get("show_names")) and zoom >= 0.42:
			var label := str(n.get("name", ""))
			# 长名字（剧本副本那种一串十几个字）会和隔壁格的标签横向挤在一起，
			# 按格宽 120px 截到 9 个字，完整名字看右栏。
			if label.length() > 9:
				label = label.substr(0, 8) + "…"
			if not label.is_empty():
				var px: float = r.position.x + r.size.x * 0.5
				var py: float = r.position.y - 4.0
				var w := font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x
				draw_string(font, Vector2(px - w * 0.5 + 1, py + 1), label,
					HORIZONTAL_ALIGNMENT_LEFT, -1, 12, COL_NAME_SHADOW)
				draw_string(font, Vector2(px - w * 0.5, py), label,
					HORIZONTAL_ALIGNMENT_LEFT, -1, 12, COL_NAME)

	var hover: int = int(editor.get("hover_index"))
	if hover >= 0 and hover < list.size():
		draw_rect(editor.call("npc_rect", list[hover]), COL_HOVER, false, 2.0)

	var sel: int = int(editor.get("sel"))
	if sel >= 0 and sel < list.size():
		var sr: Rect2 = editor.call("npc_rect", list[sel])
		draw_rect(sr, COL_SEL, false, 2.5)
		for dx in [0.0, sr.size.x]:
			for dy in [0.0, sr.size.y]:
				draw_rect(Rect2(sr.position.x + dx - 2.5, sr.position.y + dy - 2.5, 5, 5),
					COL_SEL, true)
