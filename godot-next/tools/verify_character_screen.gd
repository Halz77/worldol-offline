extends SceneTree
## 角色屏验收（确定性检查，不靠人眼）：
##   godot --headless --path godot-next --script res://tools/verify_character_screen.gd
##
## 重点验证「改 PNG 下一帧立刻生效」：真实改写一张碎片图集 → 重渲染比对像素
## → 逐字节还原 → 再渲染确认与原始完全一致。不是口头声明。

const SpriteComposer = preload("res://scripts/SpriteComposer.gd")
const Naming = preload("res://scripts/Naming.gd")
const Stats = preload("res://scripts/Stats.gd")

var failures := 0


func ck(label: String, ok: bool, detail: String = "") -> void:
	if ok:
		print("[check] ok - ", label, (" · " + detail) if detail != "" else "")
	else:
		failures += 1
		printerr("[check] FAIL - ", label, " ", detail)


func _opaque(img: Image) -> int:
	if img == null:
		return -1
	var n := 0
	for y in range(img.get_height()):
		for x in range(img.get_width()):
			if img.get_pixel(x, y).a > 0.0:
				n += 1
	return n


func _same(a: Image, b: Image) -> bool:
	if a == null or b == null:
		return false
	if a.get_width() != b.get_width() or a.get_height() != b.get_height():
		return false
	for y in range(a.get_height()):
		for x in range(a.get_width()):
			if not a.get_pixel(x, y).is_equal_approx(b.get_pixel(x, y)):
				return false
	return true


## 必须在 _initialize（而非 _init）里做：--script 模式下 _init 时场景树还没初始化，
## 那时 add_child 不会触发节点 _ready，控件下拉与首帧纹理都还是空的。
func _initialize() -> void:
	var scene = load("res://scenes/CharacterScreen.tscn")
	ck("场景文件可加载", scene is PackedScene)
	if not (scene is PackedScene):
		quit(1)
		return
	var screen = scene.instantiate()
	root.add_child(screen)
	await process_frame
	await process_frame
	var state = screen.get("screen_state")
	ck("主屏已注入全局状态", state != null)
	if state != null:
		state.call("toggle_play")   # 关掉自动播放，避免检查期间帧号被推进

	# ---- 控件树 -----------------------------------------------------------
	var player = screen.get_node_or_null("Margin/Root/Body/PlayerSide/Stage/Player")
	var figure = screen.get_node_or_null("Margin/Root/Body/PlayerSide/Stage/Player/Center/Figure")
	var stats_panel = screen.get_node_or_null("Margin/Root/Body/StatsSide")
	var grid = screen.get_node_or_null("Margin/Root/Body/StatsSide/Scroll/Grid")
	var case_option = screen.get_node_or_null("Margin/Root/Body/StatsSide/Toolbar/CaseOption")
	var anim_option = screen.get_node_or_null("Margin/Root/Body/PlayerSide/Controls/AnimOption")
	ck("播放器 / 属性面板 / 控件节点齐全",
		player != null and figure != null and stats_panel != null and grid != null
		and case_option != null and anim_option != null)
	ck("角色下拉含 20 个基准角色", case_option != null and case_option.item_count == 20,
		str(case_option.item_count) if case_option != null else "null")
	ck("动作下拉已按 Model 填充", anim_option != null and anim_option.item_count >= 2,
		str(anim_option.item_count) if anim_option != null else "null")
	var tex = figure.texture if figure != null else null
	ck("首帧纹理 180x200 已生成",
		tex != null and tex.get_width() == 180 and tex.get_height() == 200)
	var stage = screen.get_node_or_null("Margin/Root/Body/PlayerSide/Stage")
	var bg_checker = screen.get_node_or_null("Margin/Root/Body/PlayerSide/Stage/Player/BgChecker")
	ck("舞台已布局出可用尺寸", stage != null and stage.size.x > 380 and stage.size.y > 300,
		str(stage.size) if stage != null else "null")
	ck("播放器默认 3x 最近邻", figure != null and is_equal_approx(figure.scale.x, 3.0)
		and figure.texture_filter == CanvasItem.TEXTURE_FILTER_NEAREST)
	ck("默认棋盘背景可见", bg_checker != null and bg_checker.visible)

	# ---- 性别 / 姿势 / 动作 / 帧 ------------------------------------------
	ck("默认女 · 正常 → Model 300", int(state.call("model_id")) == 300)
	state.call("set_pose", "战斗")
	ck("女 · 战斗 → Model 400", int(state.call("model_id")) == 400)
	state.call("set_sex", "男")
	ck("男 · 战斗 → Model 200", int(state.call("model_id")) == 200)
	state.call("set_pose", "正常")
	ck("男 · 正常 → Model 100", int(state.call("model_id")) == 100)
	state.call("set_sex", "女")
	state.call("set_pose", "战斗")
	var battle_anims: Array = state.call("animations")
	ck("战斗造型 9 个动作", battle_anims.size() == 9, str(battle_anims.size()))
	ck("动作名来自源码常量且有中文", str(battle_anims[0].get("name", "")).find("战斗") >= 0,
		str(battle_anims[0].get("name", "")))
	state.call("set_anim", 0)
	ck("站立动作 4 帧", int(state.call("frame_count")) == 4, str(state.call("frame_count")))
	state.call("set_all_frames", true)
	ck("全帧模式 = Model400 的 26 帧", int(state.call("frame_count")) == 26,
		str(state.call("frame_count")))
	state.call("set_all_frames", false)
	state.call("set_anim", 0)
	state.call("set_frame", 3)
	state.call("step", 1)
	ck("逐帧到末尾后回绕", int(state.get("frame_index")) == 0,
		str(state.get("frame_index")))
	state.call("set_pose", "正常")

	# ---- 原版 dirad 备用目录补漏：男性躯干 6001.png 必须存在且真的画出来 ---
	ck("男性躯干碎片 6001.png 已补齐",
		FileAccess.file_exists("res://assets/sprite_fragment/6001.png"))
	var male_idle := SpriteComposer.render_frame_image(100, 0)
	var male_opaque := _opaque(male_idle)
	# 缺 6001 时 Model100 只有 1200 个非透明像素；补齐后 1278。
	ck("男性 Model100 躯干已渲染", male_idle != null and male_opaque >= 1250, str(male_opaque))
	var male_battle := SpriteComposer.render_frame_image(200, 0)
	ck("男性战斗 Model200 躯干已渲染",
		male_battle != null and _opaque(male_battle) >= 1260, str(_opaque(male_battle)))
	if male_idle != null:
		var torso := 0
		for y in range(120, 140):
			for x in range(72, 96):
				if male_idle.get_pixel(x, y).a > 0.0:
					torso += 1
		ck("男性胸部区域确有贴图（非空白）", torso >= 100, str(torso))
	var female_idle := SpriteComposer.render_frame_image(300, 0)
	ck("女性 Model300 未受补漏影响", female_idle != null and _opaque(female_idle) >= 1182,
		str(_opaque(female_idle)))

	# ---- 属性面板 ---------------------------------------------------------
	state.call("set_case", 0)
	state.call("set_mode", 0)
	ck("战力评分 38 项 → 76 个格子", grid.get_child_count() == 76,
		str(grid.get_child_count()))
	state.call("set_mode", 1)
	ck("战斗面板 59 项 → 118 个格子", grid.get_child_count() == 118,
		str(grid.get_child_count()))
	var missing: Array = []
	for c in Stats.cases():
		for mode in ["rating", "battle"]:
			var bucket: Dictionary = c.get(mode, {})
			var values: Dictionary = bucket.get("stats", {})
			for k in values.keys():
				if str(Naming.stat(str(k))).ends_with("（未译）"):
					missing.append(str(k))
	ck("全部属性键都有中文名", missing.is_empty(), "未译：" + ",".join(missing))
	ck("JSON 浮点显示为整数", Naming.number(2327.0) == "2327", Naming.number(2327.0))

	# ---- 改 PNG 立刻生效（真实改写 + 逐像素比对 + 还原） ---------------------
	var parsed = JSON.parse_string(FileAccess.get_file_as_string(
		"res://assets/sprite_model/300.json"))
	var files: Array = parsed.get("files", [])
	var layers: Array = parsed.get("frames", {}).get("0", [])
	var chosen := -1
	var li := layers.size() - 1
	while li >= 0:
		var layer = layers[li]
		if layer is Array and layer.size() >= 2:
			var fid := int(files[int(layer[0])])
			if SpriteComposer._sub_frame(fid, int(layer[1])) != null:
				chosen = fid
				break
		li -= 1
	ck("找到确实会画出的最上层碎片", chosen > 0, str(chosen))
	if chosen > 0:
		var png := "res://assets/sprite_fragment/" + str(chosen) + ".png"
		var abs_png := ProjectSettings.globalize_path(png)
		var backup := FileAccess.get_file_as_bytes(png)
		ck("碎片 PNG 可读取", backup.size() > 0, str(backup.size()) + " 字节")
		var before := SpriteComposer.render_frame_image(300, 0)
		var before2 := SpriteComposer.render_frame_image(300, 0)
		ck("同帧重复渲染幂等", _same(before, before2))
		var original := Image.new()
		original.load_png_from_buffer(backup)
		var painted := Image.create(original.get_width(), original.get_height(), false, Image.FORMAT_RGBA8)
		painted.fill(Color(1.0, 0.0, 1.0, 1.0))
		ck("改写图集写盘成功", painted.save_png(abs_png) == OK)
		var after := SpriteComposer.render_frame_image(300, 0)
		ck("改 PNG 后同帧像素确实变化", not _same(before, after),
			"原非透明 " + str(_opaque(before)) + " → " + str(_opaque(after)))
		ck("改后仍能画出人物", _opaque(after) > 300)
		var restore_file := FileAccess.open(abs_png, FileAccess.WRITE)
		if restore_file != null:
			restore_file.store_buffer(backup)
			restore_file.close()
		var restored := SpriteComposer.render_frame_image(300, 0)
		ck("还原后与原图逐像素一致", _same(before, restored))
		ck("素材文件已逐字节复原",
			FileAccess.get_file_as_bytes(png) == backup)
	else:
		ck("改 PNG 生效验证（前置条件缺失）", false, "未找到可用碎片")

	# ---- 选择持久化 / 版本兼容 --------------------------------------------
	var save_path := "user://character_screen.json"
	state.call("set_case", 7)
	ck("选择已写入 user://", FileAccess.file_exists(save_path))
	var saved = JSON.parse_string(FileAccess.get_file_as_string(save_path))
	ck("存档 version = 1", saved is Dictionary and int(saved.get("version", -1)) == 1)
	ck("存档记下 case_index = 7", int(saved.get("case_index", -1)) == 7)
	# 只改内存、不触发 setter（setter 会自动落盘并盖掉刚写的 7），
	# 才能真实模拟「进程重启后内存丢失、只剩磁盘存档」。
	state.set("case_index", 0)
	state.call("load_selection")
	ck("重新载入恢复第 8 个角色", int(state.get("case_index")) == 7,
		str(state.get("case_index")))
	var vf := FileAccess.open(save_path, FileAccess.WRITE)
	vf.store_string(JSON.stringify({"version": 999, "case_index": 12}))
	vf.close()
	state.call("load_selection")
	ck("版本不符不崩且不被脏数据覆盖", int(state.get("case_index")) == 7,
		str(state.get("case_index")))
	state.call("set_bg", 2)
	state.call("set_scale", 3)
	state.call("reload_assets")
	ck("背景 / 缩放 / 重载帧表均可调用",
		int(state.get("bg_index")) == 2 and int(state.get("view_scale")) == 4)
	state.call("reset")
	ck("重置恢复默认", int(state.get("case_index")) == 0
		and int(state.call("model_id")) == 300 and int(state.get("view_scale")) == 3)

	if failures == 0:
		print("[verify] 全部通过")
	else:
		printerr("[verify] 失败 ", failures, " 项")
	quit(0 if failures == 0 else 1)
