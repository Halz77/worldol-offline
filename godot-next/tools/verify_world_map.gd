extends SceneTree
## 地图 / NPC 验收（确定性检查）：
##   godot --headless --path godot-next --script res://tools/verify_world_map.gd
##
## 覆盖：290 张地图全部可加载、1939 个 NPC 全部编译并可定位、tile 层展开正确、
## 障碍格判定、角色移动不能穿墙、切图与名字开关。

const GameData = preload("res://scripts/GameData.gd")

var failures := 0
var data = GameData.new()


func ck(label: String, ok: bool, detail: String = "") -> void:
	if ok:
		print("[check] ok - ", label, (" · " + detail) if detail != "" else "")
	else:
		failures += 1
		printerr("[check] FAIL - ", label, " ", detail)


func _cell(cfg: Dictionary, blocks: Array, index: int) -> bool:
	if index < 0 or index >= blocks.size():
		return false
	return (int(blocks[index]) & 1) == 0


## 两张 ImageTexture 的像素差异数（用于「换装后画面确实变了」）。
func _tex_diff(a, b) -> int:
	if a == null or b == null:
		return -1
	var ia: Image = (a as Texture2D).get_image()
	var ib: Image = (b as Texture2D).get_image()
	if ia == null or ib == null or ia.get_size() != ib.get_size():
		return -1
	var n := 0
	for y in range(ia.get_height()):
		for x in range(ia.get_width()):
			if not ia.get_pixel(x, y).is_equal_approx(ib.get_pixel(x, y)):
				n += 1
	return n


func _initialize() -> void:
	var scene = load("res://scenes/WorldScreen.tscn")
	ck("世界场景可加载", scene is PackedScene)
	if not (scene is PackedScene):
		quit(1)
		return
	var screen = scene.instantiate()
	root.add_child(screen)
	await process_frame
	await process_frame

	# ---------- 数据编译 ----------
	ck("地图目录 295 张（290 视觉 + 4 兜底 + 1 NPC 展厅页）", data.count("worldMaps") == 295,
		str(data.count("worldMaps")))
	ck("NPC 按地图分 63 组", data.count("npcs") == 63, str(data.count("npcs")))
	var npc_total := 0
	for id in data.ids("npcs"):
		npc_total += data.get_entry("npcs", id).size()
	ck("NPC 总数 1939", npc_total == 1939, str(npc_total))

	var world_map: Node2D = screen.get_node("WorldMap")
	var player: Node2D = screen.get_node("Player")
	ck("默认进入地图 4", world_map.get("map_id") == 4, str(world_map.get("map_id")))
	ck("默认不显示 NPC", not bool(world_map.get("show_npcs")) and
		(world_map.get("npcs") as Array).is_empty())
	world_map.call("set_show_npcs", true)

	var cfg: Dictionary = world_map.get("cfg")
	ck("地图 JSON 已载入", not cfg.is_empty(), "mW=%d" % int(cfg.get("mW", 0)))
	var tiles: Array = cfg.get("tiles", [])
	var expected_tiles := 0
	for def in tiles:
		expected_tiles += int(def[2]) * int(def[3])
	var tile_list: Array = world_map.get("_tile_list")
	ck("tile 展开顺序与格数一致", tile_list.size() == expected_tiles,
		"%d / %d" % [tile_list.size(), expected_tiles])
	var atlas_frames: Dictionary = world_map.get("_atlas_frames")
	ck("合并图集帧表可读", atlas_frames.size() > 0, str(atlas_frames.size()))

	# 画面正确性相关的硬指标：不能靠「加载成功」糊弄过去。
	var global_frames: Dictionary = world_map.get("_frames_index")
	ck("全局图集帧索引已载入", global_frames.size() >= 2400, str(global_frames.size()))
	var offset_frame: Dictionary = world_map.call("_resolve", "1101")
	ck("带偏移帧用 sourceW/H 逻辑包围盒",
		not offset_frame.is_empty() and offset_frame.get("region").size == Vector2(65, 55),
		str(offset_frame.get("region", Rect2()).size))
	world_map.call("load_map", 258)
	var cross_frame: Dictionary = world_map.call("_resolve", "88")
	ck("本图缺帧时从别的图集补回", not cross_frame.is_empty(),
		"atlas=" + str((global_frames.get("88", {}) as Dictionary).get("atlas", -1)))
	world_map.call("load_map", 10)
	var neg_decoded := false
	var cfg10: Dictionary = world_map.get("cfg")
	var list10: Array = world_map.get("_tile_list")
	for l in cfg10.get("layers", []):
		if l is Dictionary and int(l.get("type", 0)) == 2 and l.get("data") is Array:
			for v in l["data"]:
				if int(v) < -1 and (int(v) & 255) < list10.size():
					neg_decoded = true
					break
	ck("负数 tile 索引按 & 255 解码", neg_decoded)
	world_map.call("load_map", 4)

	# ---------- 图层节点化：TileMapLayer / MapObjectLayer ----------
	var layers_cfg: Array = (world_map.get("cfg") as Dictionary).get("layers", [])
	var want_tiles := 0
	var want_objs := 0
	for L in layers_cfg:
		if not (L is Dictionary):
			continue
		if int(L.get("type", 0)) == 2 and L.get("data") is Array:
			want_tiles += 1
		elif L.get("obj") is Array:
			want_objs += 1
	var nodes: Array = world_map.call("layer_nodes")
	var got_tiles := 0
	var got_objs := 0
	var cells_total := 0
	var ts_ok := true
	for n in nodes:
		if n is TileMapLayer:
			got_tiles += 1
			cells_total += (n as TileMapLayer).get_used_cells().size()
			if (n as TileMapLayer).tile_set == null:
				ts_ok = false
		elif n.get("objects") != null:
			got_objs += 1
	ck("地块层全部转成 TileMapLayer（可含补洞层）", got_tiles >= want_tiles,
		"%d / %d" % [got_tiles, want_tiles])
	ck("物件层全部转成独立节点", got_objs == want_objs,
		"%d / %d" % [got_objs, want_objs])
	ck("每个 TileMapLayer 都挂了共享 TileSet", ts_ok)
	ck("TileMapLayer 实际铺出了图块", cells_total > 100, str(cells_total))
	# 「只看选中层」：图层是真实节点，切 visible 即可，不动数据
	world_map.call("solo_layer", 0)
	var hidden := 0
	for n in nodes:
		if not (n as CanvasItem).visible:
			hidden += 1
	ck("只看某一层会隐藏其它图层节点", hidden >= 1, str(hidden))
	world_map.call("solo_layer", -1)
	var all_visible := true
	for n in nodes:
		if not (n as CanvasItem).visible:
			all_visible = false
	ck("取消只看后图层全部恢复显示", all_visible)

	var npcs: Array = world_map.get("npcs")
	ck("地图 4 的 NPC 实体数 23", npcs.size() == 23, str(npcs.size()))
	var textured := 0
	for n in npcs:
		var sp: Sprite2D = n.get("sprite")
		if sp != null and sp.texture != null:
			textured += 1
	ck("NPC 图标至少覆盖多数实体", textured >= 18, "%d / %d" % [textured, npcs.size()])

	if not npcs.is_empty():
		var first: Dictionary = npcs[0]
		player.call("set_pixel", first.get("pos", Vector2.ZERO))
		var near: Dictionary = world_map.call("nearest_npc", player.position.x, player.position.y, 8.0)
		ck("靠近 NPC 能识别到实体", not near.is_empty(),
			str(near.get("data", {}).get("name", "")))
		ck("NPC 名字标签可见", bool(first.get("label").visible))

	world_map.call("set_show_names", false)
	ck("名字总开关生效", not world_map.get("_name_root").visible)
	world_map.call("set_show_names", true)

	# ---------- 障碍与行走 ----------
	var tw := maxi(1, int(cfg.get("tW", 24)))
	var th := maxi(1, int(cfg.get("tH", 24)))
	var cols := int(cfg.get("mW", 0)) / tw
	var rows := int(cfg.get("mH", 0)) / th
	var blocks: Array = cfg.get("blocks", [])
	var blocked_index := -1
	var free_run := -1
	for row in range(rows):
		for col in range(cols):
			var i := row * cols + col
			if blocked_index < 0 and not _cell(cfg, blocks, i):
				blocked_index = i
			if free_run < 0 and col + 2 < cols and _cell(cfg, blocks, i) \
					and _cell(cfg, blocks, i + 1) and _cell(cfg, blocks, i + 2):
				free_run = i
	ck("地图有障碍格数据", blocked_index >= 0)
	if blocked_index >= 0:
		var bx := (blocked_index % cols + 0.5) * tw
		var by := (blocked_index / cols + 0.5) * th
		ck("障碍格判定为不可走", world_map.call("is_blocked_px", bx, by))
	if free_run >= 0:
		var gx := free_run % cols
		var gy := free_run / cols
		player.call("set_pixel", Vector2((gx + 0.5) * tw, (gy + 0.5) * th))
		var before := player.position.x
		player.call("move_by", 1.4 * tw, 0.0)
		ck("角色可沿空地行走", player.position.x > before + tw * 0.8,
			"%.1f → %.1f" % [before, player.position.x])
		player.call("move_by", -2000.0, 0.0)
		ck("大位移不会穿出地图左边界", player.position.x >= tw * 0.5 - 1.0,
			"x=%.1f" % player.position.x)
		player.call("move_by", 2000.0, 4000.0)
		ck("大位移不会穿出地图右下边界",
			player.position.x <= (cols - 0.5) * tw + 1.0 and
			player.position.y <= (rows - 0.5) * th + 1.0,
			"x=%.1f y=%.1f" % [player.position.x, player.position.y])

	# 真实键盘事件路径（不是只测 move_by）：按 D 后应真的往右走。
	if free_run >= 0:
		player.call("set_pixel", Vector2((free_run % cols + 0.5) * tw,
			(free_run / cols + 0.5) * th))
	var key_before := player.position.x
	Input.action_press("ui_right")
	ck("按键状态被引擎接收", Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down").x > 0.0)
	for _f in range(10):
		await process_frame
	Input.action_release("ui_right")
	ck("方向键动作能驱动角色行走", player.position.x > key_before + 0.5,
		"%.1f → %.1f" % [key_before, player.position.x])

	# 朝向：素材默认朝左，往右走必须镜像（scale.x < 0），往左走不镜像。
	var sprite: Node2D = player.get_node("Sprite")
	ck("向右走时人物朝右（素材默认朝左，需镜像）", sprite.scale.x < 0.0,
		"scale.x=%.2f" % sprite.scale.x)
	var left_before := player.position.x
	Input.action_press("ui_left")
	for _f in range(10):
		await process_frame
	Input.action_release("ui_left")
	ck("按左键向左走", player.position.x < left_before - 0.5,
		"%.1f → %.1f" % [left_before, player.position.x])
	ck("向左走时人物朝左（不镜像）", sprite.scale.x > 0.0,
		"scale.x=%.2f" % sprite.scale.x)
	for _f in range(2):
		await process_frame

	# 走路动作：必须用正常 model 的 anis id=2（帧 4..9），静止是 id=0 首帧（0）；
	# 不能拿全帧轮播，也不能跟随角色屏停住的战斗姿势。
	# ★ 装备会改 model（武器姿势 / 坐骑整幅），先清空装备取基线，测完再还原。
	var state = player.get("screen_state")
	var original_model := int(player.get("_walk_model_id"))
	var saved_equip: Dictionary = {}
	if state != null:
		saved_equip = state.get("equipped").duplicate(true)
		state.set("equipped", {})
		state.emit_signal("state_changed", "equip")
		await process_frame
	var walk_frames: Array = player.get("_frames")
	ck("行走帧序列是地图行走动作", walk_frames == [4, 5, 6, 7, 8, 9], str(walk_frames))
	ck("静止帧是站立首帧", int(player.get("_stand_frame")) == 0,
		str(player.get("_stand_frame")))
	var walk_model := int(player.get("_walk_model_id"))
	ck("地图角色使用正常姿势模型（不受战斗姿势影响）",
		walk_model == 100 or walk_model == 300, str(walk_model))

	# ---------- 动画走 SpriteFrames / AnimatedSprite2D ----------
	var sf = player.get("_anim_frames")
	ck("动画已编译成 SpriteFrames", sf is SpriteFrames)
	if sf is SpriteFrames:
		ck("有 idle 与 walk 两条命名动作",
			sf.has_animation("idle") and sf.has_animation("walk"),
			str(sf.get_animation_names()))
		ck("walk 帧数与 anis[2] 手势一致",
			sf.get_frame_count("walk") == walk_frames.size(),
			"%d / %d" % [sf.get_frame_count("walk"), walk_frames.size()])
		ck("walk 帧率保持 7fps（与改造前画面速度一致）",
			is_equal_approx(sf.get_animation_speed("walk"), 7.0),
			str(sf.get_animation_speed("walk")))
		ck("idle 是循环动作、walk 也是循环",
			sf.get_animation_loop("idle") and sf.get_animation_loop("walk"))
		# 角色节点本身必须是 AnimatedSprite2D，且真的绑上了这套 SpriteFrames
		ck("地图角色节点是 AnimatedSprite2D", sprite is AnimatedSprite2D)
		ck("节点绑定了同一套 SpriteFrames", sprite.get("sprite_frames") == sf)
		# 走起来要播 walk，停下要停在 idle 首帧（不能停在中途帧）
		Input.action_press("ui_right")
		for _f in range(6):
			await process_frame
		ck("行走时播放 walk 动作",
			str(sprite.get("animation")) == "walk" and bool(sprite.call("is_playing")),
			str(sprite.get("animation")))
		Input.action_release("ui_right")
		for _f in range(6):
			await process_frame
		ck("停下后回到 idle 且暂停在首帧",
			str(sprite.get("animation")) == "idle" and not bool(sprite.call("is_playing"))
			and int(sprite.get("frame")) == 0,
			"%s frame=%d" % [str(sprite.get("animation")), int(sprite.get("frame"))])

	# ---------- 地图小人接装备外观 ----------
	if state != null:
		var base_mid := walk_model
		var is_female := base_mid == 300
		var idle_tex = player.call("_texture", int(player.get("_stand_frame")))
		state.call("equip", "weapon", 20300)          # 刀 type13 → base+13
		await process_frame
		ck("地图换武器后立刻换 model（+13 姿势）",
			int(player.get("_walk_model_id")) == base_mid + 13,
			str(player.get("_walk_model_id")))
		var sword_tex = player.call("_texture", int(player.get("_stand_frame")))
		ck("地图角色外观像素随装备变化", _tex_diff(idle_tex, sword_tex) > 100,
			"差异像素 " + str(_tex_diff(idle_tex, sword_tex)))
		state.call("equip", "transport", 31000)       # 白狼 style5
		await process_frame
		var mount_mid := 2463 if is_female else 2413
		ck("骑坐骑后地图角色换整幅马 model", int(player.get("_walk_model_id")) == mount_mid,
			str(player.get("_walk_model_id")))
		var ride_tex = player.call("_texture", int(player.get("_stand_frame")))
		ck("坐骑造型与站姿明显不同", _tex_diff(sword_tex, ride_tex) > 500,
			"差异像素 " + str(_tex_diff(sword_tex, ride_tex)))
		# 空手 + 坐骑：必须用「无武器坐骑 model」，不能静默回退基础造型
		state.call("unequip", "weapon")
		await process_frame
		var bare_mount := 905 if is_female else 705
		ck("★空手骑坐骑仍是整幅坐骑 model（不静默回退）",
			int(player.get("_walk_model_id")) == bare_mount,
			"%d / 期望 %d" % [int(player.get("_walk_model_id")), bare_mount])
		# 恶魔之翼（无武器款 743/943）：正是「装备后人物没变化」的事故点
		state.call("equip", "transport", 31164)
		await process_frame
		var wings_mid := 943 if is_female else 743
		ck("★空手装备恶魔之翼 → 743/943",
			int(player.get("_walk_model_id")) == wings_mid,
			"%d / 期望 %d" % [int(player.get("_walk_model_id")), wings_mid])
		var wings_tex = player.call("_texture", int(player.get("_stand_frame")))
		ck("★恶魔之翼地图画面确实换了", _tex_diff(idle_tex, wings_tex) > 500,
			"差异像素 " + str(_tex_diff(idle_tex, wings_tex)))
		# 时装：只换部件图，不改 model
		state.call("unequip", "transport")
		state.call("equip", "fashion", 15030)   # 恶魔时装
		await process_frame
		ck("★地图穿时装不改 model", int(player.get("_walk_model_id")) == base_mid,
			str(player.get("_walk_model_id")))
		var fash_tex = player.call("_texture", int(player.get("_stand_frame")))
		ck("★地图穿时装画面有变化", _tex_diff(idle_tex, fash_tex) > 500,
			"差异像素 " + str(_tex_diff(idle_tex, fash_tex)))
		# 还原装备（含写回 user://equipment.json，别污染玩家存档）
		state.set("equipped", saved_equip)
		state.emit_signal("state_changed", "equip")
		state.call("save_equipment")
		await process_frame
		ck("还原装备后地图 model 回到原样",
			int(player.get("_walk_model_id")) == original_model,
			"%d / 原 %d" % [int(player.get("_walk_model_id")), original_model])

	# ---------- 全量切图 ----------
	# NPC 展厅页（9901+）是「把 1939 个 NPC 复制一份集中摆放」的分页，
	# 不能算进原版分布的总数里，否则总数会翻倍。
	var bad := []
	var total_npcs := 0
	var showcase_npcs := 0
	for id in data.ids("worldMaps"):
		if not world_map.call("load_map", int(id)):
			bad.append(str(id) + ":load")
			continue
		var c: Dictionary = world_map.get("cfg")
		var tl: Array = world_map.get("_tile_list")
		if c.is_empty() or (tl.is_empty() and not bool(c.get("__synthetic", false))):
			bad.append(str(id) + ":empty")
		var actual: Array = world_map.get("npcs")
		if bool(data.call("is_npc_page", int(id))):
			showcase_npcs += actual.size()
		else:
			total_npcs += actual.size()
		ck_meta(int(id), data.get_entry("npcs", int(id)).size(), actual.size(), bad)
	ck("全部地图逐张可加载", bad.is_empty(), "异常 " + str(bad) + " / " + str(bad.size()))
	ck("原版地图 NPC 实体总数 1939", total_npcs == 1939, str(total_npcs))
	ck("展厅页 NPC 实体总数 282（同 icon1 去重后）", showcase_npcs == 282, str(showcase_npcs))

	# 停在城市场景，方便后续人工看画面
	world_map.call("load_map", 4)
	player.call("set_pixel", world_map.call("spawn_pixel"))

	print("[verify] 失败项 ", failures)
	quit(1 if failures > 0 else 0)


func ck_meta(id: int, expected: int, actual: int, bad: Array) -> void:
	if expected != actual:
		bad.append(str(id) + ":npc " + str(actual) + "/" + str(expected))
