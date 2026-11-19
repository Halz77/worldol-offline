extends SceneTree
## 把 assets/map_slice/*.png 烘成一张共享的 Godot TileSet（地面图块库）。
##
## 为什么要它：地图 tile 层原来是「一个格一次 draw_texture_rect_region」，图块只有
## 字符串名字、没有引擎侧身份。改成一个 TileSet 之后：
##   - 图块在 Godot 的 TileSet 编辑器里能直接看到、编号、改锚点；
##   - 地图用 TileMapLayer 承载，图层是真实节点，可单独隐藏/排序；
##   - 图块来源仍是原始 PNG（TileSetAtlasSource 引用 PNG），改图下一帧生效。
##
## 生成规则（和 WorldMap 旧的取图逻辑一一对应）：
##   1. 一个 map_slice/<name>.png → 一个 TileSetAtlasSource，纹理区域 24×24，
##      (col,row) 就是图集里的第 col 列第 row 个子格 —— 与旧代码
##      「region.position + col*24 / row*24」完全一致。
##   2. 所有切片图宽高都是 24 的整数倍（已全量校验 206 张），所以不需要缩放。
##   3. 镜像变换用 alternative tile 表达：原版 transform 1=垂直镜像 / 2=水平镜像 /
##      3=两者，对应 TileData 的 flip_v / flip_h。只给「地图里真的用到」的组合建变体，
##      避免每个图块无脑 ×8 把 TileSet 撑大。
##
## 用法：Godot --headless --path godot-next --script res://tools/build_map_tileset.gd
## 产物：
##   res://assets/tilesets/map_ground.tres      TileSet（编辑器可打开）
##   res://data/compiled/tileAtlas.json         资源名 → source/cols/rows/变体表（运行时索引）
## 改了 map_slice 的图或新地图用了新变换，重跑一次即可；不改则不需要跑。

const SLICE_DIR := "res://assets/map_slice/"
const MAP_DIR := "res://assets/map/"
const OUT_DIR := "res://assets/tilesets/"
const OUT_PATH := "res://assets/tilesets/map_ground.tres"
const INDEX_PATH := "res://data/compiled/tileAtlas.json"
## 地图格边长。290 张地图全部是 24×24（已校验），换尺寸要连 mW/mH 一起改。
const CELL := 24
## 原版 transform → TileData 的翻转位。
## 0055/client 的 t.transform()：1=MIRROR_V(上下翻转) 2=MIRROR_H(左右翻转) 3=两者。
## tile 层实测只出现 0–3（90° 旋转只出现在物件层），所以这里只处理翻转。
const FLIP_V := 1
const FLIP_H := 2


func _initialize() -> void:
	var used := _scan_usage()
	var names := _slice_names()
	if names.is_empty():
		printerr("[tileset] map_slice 下没有 PNG")
		quit(1)
		return

	var ts := TileSet.new()
	ts.tile_size = Vector2i(CELL, CELL)
	var index := {}
	var total_tiles := 0
	var total_alts := 0
	var skipped := []

	for name in names:
		var tex := load(SLICE_DIR + name + ".png") as Texture2D
		if tex == null:
			printerr("[tileset] 读不到纹理 ", name)
			continue
		var w := tex.get_width()
		var h := tex.get_height()
		if w % CELL != 0 or h % CELL != 0:
			# 不是整数格：TileSet 没法在不缩放的前提下表达，跳过并报出来。
			skipped.append("%s (%dx%d)" % [name, w, h])
			continue
		var cols := w / CELL
		var rows := h / CELL
		var src := TileSetAtlasSource.new()
		src.texture = tex
		src.texture_region_size = Vector2i(CELL, CELL)
		for r in range(rows):
			for c in range(cols):
				src.create_tile(Vector2i(c, r))
				total_tiles += 1
		var sid := ts.add_source(src)

		# 该资源在地图里实际用到的镜像变换（0 不需要变体）
		var trs: Array = []
		if used.has(name):
			for t in used[name].keys():
				if int(t) != 0 and int(t) < 8:
					trs.append(int(t))
		trs.sort()
		var alt_map := {}
		var next_id := 1
		for t in trs:
			var ok_all := true
			for r in range(rows):
				for c in range(cols):
					var aid := src.create_alternative_tile(Vector2i(c, r), next_id)
					if aid != next_id:
						ok_all = false
					var td := src.get_tile_data(Vector2i(c, r), aid)
					if td != null:
						td.flip_v = (int(t) & FLIP_V) != 0
						td.flip_h = (int(t) & FLIP_H) != 0
					total_alts += 1
			if not ok_all:
				printerr("[tileset] 变体 id 不符合预期：", name, " t=", t)
			alt_map[str(t)] = next_id
			next_id += 1

		index[name] = {"source": sid, "cols": cols, "rows": rows, "alts": alt_map}

	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUT_DIR))
	var err := ResourceSaver.save(ts, OUT_PATH)
	if err != OK:
		printerr("[tileset] 保存失败 err=", err)
		quit(1)
		return

	var payload := {
		"generated": Time.get_datetime_string_from_system(),
		"cell": CELL,
		"sources": index,
	}
	var f := FileAccess.open(INDEX_PATH, FileAccess.WRITE)
	if f == null:
		printerr("[tileset] 写不了索引 ", INDEX_PATH)
		quit(1)
		return
	f.store_string(JSON.stringify(payload, "\t"))
	f.close()

	print("[tileset] 完成：%d 个资源 / %d 个图块 / %d 个镜像变体 → %s" % [
		index.size(), total_tiles, total_alts, OUT_PATH])
	if not skipped.is_empty():
		print("[tileset] 跳过非整数格图片 ", skipped)
	if used.size() > index.size():
		var missing := []
		for n in used.keys():
			if not index.has(n):
				missing.append(n)
		print("[tileset] 地图引用了但没有切片图的资源（占位空图，原版本就没有）：", missing)
	quit(0)


## 扫全部地图的 tiles 定义，统计「资源名 → 用到的变换集合」。
func _scan_usage() -> Dictionary:
	var used := {}
	var dir := DirAccess.open(MAP_DIR)
	if dir == null:
		return used
	var files: Array = []
	for f in dir.get_files():
		if f.ends_with(".json"):
			files.append(f)
	files.sort()
	for f in files:
		var parsed = JSON.parse_string(FileAccess.get_file_as_string(MAP_DIR + f))
		if not (parsed is Dictionary):
			continue
		for d in parsed.get("tiles", []):
			if not (d is Array) or d.size() < 4:
				continue
			var nm := str(d[0])
			if not used.has(nm):
				used[nm] = {}
			used[nm][int(d[1])] = true
	return used


func _slice_names() -> Array:
	var out: Array = []
	var dir := DirAccess.open(SLICE_DIR)
	if dir == null:
		return out
	for f in dir.get_files():
		if f.ends_with(".png"):
			out.append(f.trim_suffix(".png"))
	out.sort()
	return out
