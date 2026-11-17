extends SceneTree
## 地图编辑器验收（确定性检查，不写真实的 assets/map）：
##   godot --headless --path godot-next --script res://tools/verify_map_editor.gd
##
## 覆盖：
##   - 编辑器场景可实例化、复用 WorldMap 渲染，且 prefill_enabled = false（不显示虚构地面）
##   - 图层列表 / 调色板条目与 cfg 数据一致
##   - tile 画笔真的改 layers[li].data、撤销能原地还原
##   - 阻挡画笔只改 bit0、撤销能还原
##   - 合成网格图（没有视觉 JSON）拒绝保存，且不会写出文件
##   - 290 张地图「解析 → 规范化 → 序列化 → 再解析」往返不丢信息，输出里没有小数

const GameData = preload("res://scripts/GameData.gd")

var failures := 0
var data = GameData.new()
var _started_ms := 0


## 看门狗：headless 脚本一旦中途抛错就走不到 quit()，进程会一直挂着。
## 这里用 SceneTree._process 兜底，超时强制退出（返回 true 即退出主循环）。
func _process(_delta: float) -> bool:
	if _started_ms > 0 and Time.get_ticks_msec() - _started_ms > 120000:
		print("[verify] 超时 120s，强制退出（大概率是上面某步抛错，没走到 quit）")
		quit(2)
		return true
	return false


func ck(label: String, ok: bool, detail: String = "") -> void:
	if ok:
		print("[check] ok - ", label, (" · " + detail) if detail != "" else "")
	else:
		failures += 1
		print("[check] FAIL - ", label, " ", detail)


func _same(a, b) -> bool:
	if a is Dictionary and b is Dictionary:
		if a.size() != b.size():
			return false
		for k in a.keys():
			if not b.has(k):
				return false
			if not _same(a[k], b[k]):
				return false
		return true
	if a is Array and b is Array:
		if a.size() != b.size():
			return false
		for i in range(a.size()):
			if not _same(a[i], b[i]):
				return false
		return true
	if (a is float or a is int) and (b is float or b is int):
		return float(a) == float(b)
	return a == b


func _initialize() -> void:
	_started_ms = Time.get_ticks_msec()
	print("[verify] 1/6 实例化编辑器场景")
	var scene = load("res://tools/map_editor/MapEditor.tscn")
	ck("编辑器场景可加载", scene is PackedScene)
	if not (scene is PackedScene):
		quit(1)
		return
	var editor = scene.instantiate()
	root.add_child(editor)
	await process_frame
	await process_frame
	# 脚本解析失败时场景仍能实例化，但根节点没有这些方法。先挡掉，否则后面全是连带错误。
	if not editor.has_method("current_cfg") or not editor.has_method("load_map"):
		ck("编辑器脚本成功挂载", false, "MapEditor.gd 解析/加载失败，见上面的 SCRIPT ERROR")
		quit(1)
		return
	print("[verify] 2/6 检查载入 / 叠加层 / 图层 / 调色板")

	# ---------- 载入与渲染复用 ----------
	ck("默认打开地图 4", int(editor.get("map_id")) == 4, str(editor.get("map_id")))
	var world_map: Node2D = editor.get_node("MapRoot")
	ck("复用 WorldMap 渲染节点", world_map != null and world_map.has_method("load_map"))
	ck("编辑器关闭补洞（不显示虚构地面）", not bool(world_map.get("prefill_enabled")))
	ck("编辑器不显示 NPC / 名字",
		not bool(world_map.get("show_npcs")) and not bool(world_map.get("show_names")))
	ck("叠加层已注入编辑器引用", editor.get_node("Overlay").get("editor") == editor)

	var cfg: Dictionary = editor.call("current_cfg")
	ck("地图 4 的 cfg 已载入", not cfg.is_empty(), "mW=%d" % int(cfg.get("mW", 0)))

	# ---------- 图层 / 调色板与数据一致 ----------
	var layers: Array = cfg.get("layers", [])
	var layer_list: ItemList = editor.get("layer_list")
	ck("图层列表条目数 = layers 数", layer_list != null and layer_list.item_count == layers.size(),
		"%d / %d" % [layer_list.item_count if layer_list != null else -1, layers.size()])

	var tile_list: Array = world_map.get("_tile_list")
	var expected := 0
	for def in cfg.get("tiles", []):
		expected += int(def[2]) * int(def[3])
	ck("tileList 展开条数与 tiles 定义一致", tile_list.size() == expected,
		"%d / %d" % [tile_list.size(), expected])

	var palette_grid: GridContainer = editor.get("palette_grid")
	ck("调色板 = tileList + 1（含空格）",
		palette_grid.get_child_count() == tile_list.size() + 1,
		"%d / %d" % [palette_grid.get_child_count(), tile_list.size() + 1])

	var tile_layer := -1
	for i in range(layers.size()):
		if int(layers[i].get("type", 0)) == 2:
			tile_layer = i
			break
	ck("至少有一个地块层", tile_layer >= 0, str(tile_layer))

	var info_label: Label = editor.get("info_label")
	var info: String = str(info_label.text)
	ck("信息栏显示 tile 额度", info.find("/ 255") >= 0 or info.find("/255") >= 0,
		info.split("\n")[1] if info.find("\n") >= 0 else info)

	# ---------- tile 画笔 + 撤销 ----------
	print("[verify] 3/6 tile 画笔 / 撤销")
	var cols := int(cfg.get("mW", 0)) / maxi(1, int(cfg.get("tW", 24)))
	var data_arr: Array = layers[tile_layer].get("data", [])
	var target_index := -1
	for i in range(data_arr.size()):
		if int(data_arr[i]) != 0:
			target_index = i
			break
	ck("找到可改写的格子", target_index >= 0)
	if target_index >= 0 and cols > 0:
		var before_value := int(data_arr[target_index])
		editor.call("select_layer", tile_layer)
		editor.call("set_brush_tile", 0)
		editor.call("begin_stroke", false)
		editor.call("paint_cell", target_index % cols, target_index / cols)
		editor.call("end_stroke")
		ck("tile 画笔改了目标格数据", int(data_arr[target_index]) == 0,
			"%d → %d" % [before_value, int(data_arr[target_index])])
		ck("一次笔画记一步撤销", int(editor.call("undo_count")) == 1)
		editor.call("undo_last")
		ck("撤销后数据原地还原", int(data_arr[target_index]) == before_value,
			"%d" % int(data_arr[target_index]))
		ck("撤销栈已清空", int(editor.call("undo_count")) == 0)
		ck("撤销后数据数组引用未换（WorldMap 不需要重载）",
			is_same(layers[tile_layer].get("data"), data_arr))

	# ---------- 阻挡画笔 + 撤销 ----------
	print("[verify] 4/6 阻挡画笔 / 撤销")
	editor.call("set_brush_mode", "block")
	var blocks: Array = cfg.get("blocks", [])
	var free_index := -1
	for i in range(blocks.size()):
		if (int(blocks[i]) & 1) == 0:
			free_index = i
			break
	ck("找到可标记为阻挡的格子", free_index >= 0)
	if free_index >= 0 and cols > 0:
		editor.call("begin_stroke", false)
		editor.call("paint_cell", free_index % cols, free_index / cols)
		editor.call("end_stroke")
		ck("阻挡画笔置 bit0", (int(blocks[free_index]) & 1) == 1, str(int(blocks[free_index])))
		ck("阻挡不改其它位", (int(blocks[free_index]) & 0xFE) == 0, str(int(blocks[free_index])))
		editor.call("undo_last")
		ck("撤销阻挡还原 bit0", (int(blocks[free_index]) & 1) == 0, str(int(blocks[free_index])))
		ck("阻挡撤销后 WorldMap 指向同一个数组",
			is_same(world_map.get("_blocks"), blocks))

	# ---------- 合成网格图拒绝保存 ----------
	print("[verify] 5/6 合成网格图拒绝保存")
	var synthetic_ok := false
	for id in data.ids("worldMaps"):
		if not FileAccess.file_exists("res://assets/map/%d.json" % int(id)):
			synthetic_ok = int(id) == 814 or synthetic_ok
			if int(id) == 814:
				break
	ck("存在没有视觉 JSON 的地图（814）", synthetic_ok)
	editor.call("load_map", 814)
	var cfg814: Dictionary = editor.call("current_cfg")
	ck("814 走合成网格兜底", bool(cfg814.get("__synthetic", false)))
	var saved: bool = bool(editor.call("save_map"))
	ck("合成网格图拒绝保存", not saved)
	ck("拒绝保存时没有写出文件", not FileAccess.file_exists("res://assets/map/814.json"))

	# ---------- 290 张地图序列化往返 ----------
	print("[verify] 6/6 290 张地图序列化往返")
	editor.call("load_map", 4)
	var text4: String = str(editor.call("map_json_text"))
	ck("序列化输出整数（不写成 960.0）",
		text4.find("\"mW\":960") >= 0 and text4.find(".0") < 0,
		text4.substr(0, 60))

	var re := RegEx.new()
	re.compile("\\d\\.\\d")
	var bad_round := []
	var bad_decimal := []
	var missing := 0
	for id in data.ids("worldMaps"):
		var path := "res://assets/map/%d.json" % int(id)
		if not FileAccess.file_exists(path):
			missing += 1
			continue
		var original = JSON.parse_string(FileAccess.get_file_as_string(path))
		if not (original is Dictionary):
			bad_round.append(str(id) + ":parse")
			continue
		var norm = editor.call("normalize_value", original)
		var text: String = JSON.stringify(norm, "", false)
		if text.is_empty():
			bad_round.append(str(id) + ":stringify")
			continue
		if re.search(text) != null:
			bad_decimal.append(str(id))
		var back = JSON.parse_string(text)
		if not _same(norm, editor.call("normalize_value", back)):
			bad_round.append(str(id))
	ck("294 张图里 290 张有视觉 JSON", missing == 4, str(missing))
	ck("290 张图序列化往返不丢信息", bad_round.is_empty(),
		str(bad_round).substr(0, 160))
	ck("290 张图序列化后没有小数", bad_decimal.is_empty(),
		str(bad_decimal).substr(0, 160))

	# ---------- 第二版：物件 / 图层 / 结构操作 ----------
	print("[verify] 7/10 物件编辑（放置 / 选中 / 旋转 / 删除 / 撤销）")
	# 先验证第二版 UI 控件存在且交互路径通（资源列表 → 物件模式）
	var obj_list_ui: ItemList = editor.get("obj_list")
	ck("物件资源列表有条目", obj_list_ui != null and obj_list_ui.item_count > 0,
		str(obj_list_ui.item_count) if obj_list_ui != null else "null")
	if obj_list_ui != null and obj_list_ui.item_count > 0:
		editor.call("_on_obj_selected", 0)
		ck("点资源切到物件模式", editor.get("brush_mode") == "object",
			str(editor.get("brush_mode")))
		ck("画笔资源名已设置", not str(editor.get("brush_obj_src")).is_empty(),
			str(editor.get("brush_obj_src")))
	ck("地图操作对话框已建", editor.get("ops_dialog") != null)
	editor.call("load_map", 4)
	var cfg2: Dictionary = editor.call("current_cfg")
	var layers2: Array = cfg2.get("layers", [])
	var obj_layer := -1
	for i in range(layers2.size()):
		if layers2[i] is Dictionary and int(layers2[i].get("type", 0)) == 3 \
				and layers2[i].get("obj") is Array:
			obj_layer = i
			break
	ck("地图 4 有物件图层", obj_layer >= 0, str(obj_layer))
	if obj_layer >= 0:
		var obj_arr: Array = layers2[obj_layer]["obj"]
		var before_n: int = obj_arr.size()
		# 选一个存在的资源名做画笔
		var fi = GameData._json("res://data/compiled/mapFrames.json")
		var names = fi.keys()
		editor.set("brush_obj_src", str(names[0]))
		editor.call("_place_obj", str(names[0]), Vector2(100, 100))
		ck("放置物件后 obj 数 +1", obj_arr.size() == before_n + 1,
			"%d → %d" % [before_n, obj_arr.size()])
		var placed: Array = obj_arr[obj_arr.size() - 1]
		ck("物件格式 [2,src,x,y,w,h,tr]", placed.size() == 7 and int(placed[0]) == 2,
			str(placed))
		ck("放置坐标吸附 8px", int(placed[2]) % 8 == 0 and int(placed[3]) % 8 == 0,
			str(placed))
		ck("放置后自动选中", int(editor.get("selected_obj_index")) == obj_arr.size() - 1)
		# 旋转
		editor.call("_rotate_selected_obj")
		ck("R 旋转 transform +1", int(placed[6]) == 1, str(placed[6]))
		editor.call("_rotate_selected_obj")
		ck("旋转到 2", int(placed[6]) == 2)
		# 拖动（走真实笔画流程：begin → record → move → end）
		var ox := float(placed[2])
		editor.set("selected_obj_layer", obj_layer)
		editor.set("selected_obj_index", obj_arr.size() - 1)
		editor.call("begin_stroke", false)
		editor.call("_record_undo", "obj", obj_arr, obj_layer)
		editor.call("_move_selected_obj", Vector2(16, 24))
		editor.call("end_stroke")
		ck("拖动改 x/y", int(placed[2]) == int(ox) + 16, str(placed[2]))
		# 撤销拖动
		editor.call("undo_last")
		ck("撤销拖动还原坐标", int(placed[2]) == int(ox), str(placed[2]))
		# 删除
		editor.call("_delete_selected_obj")
		ck("删除后 obj 数还原", obj_arr.size() == before_n,
			"%d" % obj_arr.size())

	print("[verify] 8/10 图层增删")
	editor.call("load_map", 4)
	var cfg3: Dictionary = editor.call("current_cfg")
	var layers3: Array = cfg3.get("layers", [])
	var n_layer0: int = layers3.size()
	editor.call("add_tile_layer")
	ck("加图层后层数 +1", (editor.call("current_cfg") as Dictionary)["layers"].size() == n_layer0 + 1)
	ck("新图层是最底层（末尾）", int((layers3[layers3.size() - 1] as Dictionary).get("type", 0)) == 2)
	editor.call("undo_last")
	ck("撤销加图层后层数还原", layers3.size() == n_layer0, str(layers3.size()))
	var n_layer1: int = layers3.size()
	editor.call("remove_current_layer")
	ck("删图层后层数 -1", layers3.size() == n_layer1 - 1)
	editor.call("undo_last")
	ck("撤销删图层后层数还原", layers3.size() == n_layer1)

	print("[verify] 9/10 改尺寸 / 批量替换 / 校验")
	editor.call("load_map", 4)
	var cfg4: Dictionary = editor.call("current_cfg")
	var tw4 := maxi(1, int(cfg4.get("tW", 24)))
	var th4 := maxi(1, int(cfg4.get("tH", 24)))
	var oc: int = int(cfg4.get("mW", 0)) / tw4
	var orr: int = int(cfg4.get("mH", 0)) / th4
	editor.call("_do_resize", oc + 2, orr + 2, "center")
	ck("改尺寸 mW/mH 正确", int(cfg4.get("mW", 0)) == (oc + 2) * tw4
		and int(cfg4.get("mH", 0)) == (orr + 2) * th4,
		"%dx%d" % [int(cfg4.get("mW", 0)), int(cfg4.get("mH", 0))])
	var lay4: Array = cfg4.get("layers", [])
	var data_ok := true
	for layer in lay4:
		if layer is Dictionary and int(layer.get("type", 0)) == 2:
			if (layer.get("data", []) as Array).size() != (oc + 2) * (orr + 2):
				data_ok = false
	ck("改尺寸后每层 data 长度同步", data_ok)
	var blk4 = cfg4.get("blocks", null)
	ck("改尺寸后 blocks 长度同步", not (blk4 is Array) or (blk4 as Array).size() == (oc + 2) * (orr + 2))
	editor.call("undo_last")
	ck("撤销改尺寸还原来 mW", int(cfg4.get("mW", 0)) == oc * tw4)

	editor.call("load_map", 4)
	var cfg5: Dictionary = editor.call("current_cfg")
	# 取地图 4 里真实存在的一个 tile 资源名来替换
	var first_src := ""
	for def in cfg5.get("tiles", []):
		if def is Array and (def as Array).size() > 0:
			first_src = str((def as Array)[0])
			break
	var to_src := first_src + "_renamed_test"
	editor.call("_do_replace", first_src, to_src)
	var replace_hits := 0
	for def in cfg5.get("tiles", []):
		if def is Array and str((def as Array)[0]) == to_src:
			replace_hits += 1
	ck("批量替换 tiles 里的资源名", replace_hits > 0, "%s → %s (%d)" % [first_src, to_src, replace_hits])
	editor.call("undo_last")
	var still_old := 0
	for def in cfg5.get("tiles", []):
		if def is Array and str((def as Array)[0]) == first_src:
			still_old += 1
	ck("撤销批量替换还原资源名", still_old > 0, str(still_old))

	ck("校验地图 4 无硬错误", (editor.call("validate_cfg", cfg5) as Array).is_empty(),
		str(editor.call("validate_cfg", cfg5)).substr(0, 120))

	print("[verify] 10/10 改名 override（内存 + 文件往返）")
	editor.call("load_map", 4)
	editor.call("_do_rename", "太阳城_测试改名")
	data.reload_overrides()
	ck("改名后 name_of 命中 override",
		data.name_of("worldMaps", 4) == "太阳城_测试改名",
		data.name_of("worldMaps", 4))
	# 还原：删掉测试改名，避免污染工作区
	var name_path := "res://data/overrides/map_names.json"
	var ovn = GameData._json(name_path)
	if ovn is Dictionary:
		ovn.erase("4")
		var f := FileAccess.open(ProjectSettings.globalize_path(name_path),
			FileAccess.WRITE)
		if f != null:
			f.store_string(JSON.stringify(ovn, "", false))
			f.close()
	data.reload_overrides()
	ck("还原后名字回到原名", data.name_of("worldMaps", 4).find("太阳城") >= 0,
		data.name_of("worldMaps", 4))

	editor.queue_free()
	print("[verify] 失败项 ", failures)
	quit(1 if failures > 0 else 0)
