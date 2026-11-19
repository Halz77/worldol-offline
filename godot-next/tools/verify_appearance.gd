extends SceneTree
## 外观系统验收（确定性检查，headless）。
##   godot --headless --path godot-next --script res://tools/verify_appearance.gd
##
## 覆盖：图号公式（与原版位域一致）、可用档位、替换只动 at=0/1/2/3、
## 换发型/脸/肤色的渲染差异、性别换边、越界回退、存档往返、与装备外观共存。

const Appearance = preload("res://scripts/Appearance.gd")
const Equipment = preload("res://scripts/Equipment.gd")
const GameData = preload("res://scripts/GameData.gd")
const SpriteComposer = preload("res://scripts/SpriteComposer.gd")
const Recolor = preload("res://scripts/Recolor.gd")
const StateScript = preload("res://scripts/ScreenState.gd")

const LOOK_PATH = "user://appearance.json"

var failures := 0
var gd = GameData.new()
var _bak: PackedByteArray = []
var _had := false


func ck(label: String, ok: bool, detail: String = "") -> void:
	if ok:
		print("[check] ok - ", label, (" · " + detail) if detail != "" else "")
	else:
		failures += 1
		printerr("[check] FAIL - ", label, " ", detail)


func _diff(a, b) -> int:
	if a == null or b == null:
		return -1
	var n := 0
	for y in range(a.get_height()):
		for x in range(a.get_width()):
			if not a.get_pixel(x, y).is_equal_approx(b.get_pixel(x, y)):
				n += 1
	return n


## 图里有多少个不同的「感知亮度」档（判断调色有没有把明暗压成一片）。
## 用亮度而不是 HSV 的 V：满饱和色的 V 天花板就是 1.0，明暗是靠饱和度表现的。
func _levels(img: Image) -> int:
	var seen: Dictionary = {}
	for y in range(img.get_height()):
		for x in range(img.get_width()):
			var c: Color = img.get_pixel(x, y)
			if c.a < 0.9:
				continue
			var lum := 0.299 * c.r + 0.587 * c.g + 0.114 * c.b
			seen[int(round(lum * 48.0))] = true
	return seen.size()


## 调色只换色族、不该压平明暗：抽若干对像素，检查「谁比谁亮」的排序没被打乱。
func _order_preserved(a: Image, b: Image) -> bool:
	var vals: Array = []
	for y in range(a.get_height()):
		for x in range(a.get_width()):
			var c: Color = a.get_pixel(x, y)
			if c.a < 0.9:
				continue
			vals.append([c.v, b.get_pixel(x, y).v])
	if vals.size() < 24:
		return false
	var agree := 0
	var total := 0
	var i := 0
	while i + 7 < vals.size():
		var p: Array = vals[i]
		var q: Array = vals[i + 7]
		if absf(float(p[0]) - float(q[0])) > 0.08:
			total += 1
			if (float(p[0]) > float(q[0])) == (float(p[1]) > float(q[1])):
				agree += 1
		i += 5
	if total < 5:
		return false
	return float(agree) / float(total) >= 0.85


func _initialize() -> void:
	_had = FileAccess.file_exists(LOOK_PATH)
	if _had:
		_bak = FileAccess.get_file_as_bytes(LOOK_PATH)

	# ---------- 图号公式：拿 model 300/100 的真实 files 反推 ----------
	# model 300（女）files = [1005, 5, 2005, 3005, ...] → 脸/发/手/脚都是 style1 color0
	ck("女-发型 style1 色0 = 5", Appearance.part_id(0, 1, 0, 1) == 5,
		str(Appearance.part_id(0, 1, 0, 1)))
	ck("男-发型 style1 色0 = 1", Appearance.part_id(0, 1, 0, 0) == 1,
		str(Appearance.part_id(0, 1, 0, 0)))
	ck("女-脸型 style1 = 1005", Appearance.part_id(1, 1, 0, 1) == 1005,
		str(Appearance.part_id(1, 1, 0, 1)))
	ck("男-脸型 style1 = 1001", Appearance.part_id(1, 1, 0, 0) == 1001,
		str(Appearance.part_id(1, 1, 0, 0)))
	ck("女-手 style1 色0 = 2005", Appearance.part_id(2, 1, 0, 1) == 2005,
		str(Appearance.part_id(2, 1, 0, 1)))
	ck("女-脚 style1 色0 = 3005", Appearance.part_id(3, 1, 0, 1) == 3005,
		str(Appearance.part_id(3, 1, 0, 1)))
	# 同 style 换性别 = +4（8 号一组：前 4 男后 4 女）
	ck("换性别图号 +4（发型）", Appearance.part_id(0, 3, 0, 1) - Appearance.part_id(0, 3, 0, 0) == 4,
		"%d vs %d" % [Appearance.part_id(0, 3, 0, 1), Appearance.part_id(0, 3, 0, 0)])
	ck("色号每档 +1（手部）", Appearance.part_id(2, 1, 3, 1) - Appearance.part_id(2, 1, 0, 1) == 3,
		"%d vs %d" % [Appearance.part_id(2, 1, 3, 1), Appearance.part_id(2, 1, 0, 1)])

	# ---------- 可用档位（图必须真实存在）----------
	var hair_f := Appearance.available_styles(0, 1, 0)
	var face_f := Appearance.available_styles(1, 1, 0)
	var hand_f := Appearance.available_styles(2, 1, 0)
	var feet_f := Appearance.available_styles(3, 1, 0)
	ck("女-可选发型 14 档", hair_f.size() == 14, str(hair_f.size()) + " " + str(hair_f))
	ck("女-可选脸型 15 档", face_f.size() == 15, str(face_f.size()))
	ck("女-可选手部 3 档", hand_f.size() == 3, str(hand_f))
	ck("女-可选脚部 3 档", feet_f.size() == 3, str(feet_f))
	ck("发型第 12 档缺图（原版素材如此）", not hair_f.has(12), str(hair_f))
	var cols := Appearance.available_colors(0, 1, 1)
	ck("发型有 4 档色号", cols.size() == 4, str(cols))
	ck("脸型无颜色位", Appearance.MAX_COLOR[1] == 0, str(Appearance.MAX_COLOR[1]))
	# 每一档都要真有一张 PNG，否则界面上会出现空白格子
	var missing: Array = []
	for part in [0, 1, 2, 3]:
		for s in Appearance.available_styles(part, 1, 0):
			var id := Appearance.part_id(part, int(s), 0, 1)
			if not Appearance.has_texture(id):
				missing.append("%d/%d" % [part, int(s)])
	ck("所有可选档位都有 PNG", missing.is_empty(), str(missing))

	# ---------- 替换只动 at=0/1/2/3 ----------
	var files := SpriteComposer.model_files(300)
	ck("model 300 files 读得到", files.size() == 9, str(files.size()))
	var look := {"hair_style": 7, "hair_color": 1, "face_style": 9,
		"hand_style": 2, "hand_color": 3, "feet_style": 2, "feet_color": 1}
	var rep := Appearance.part_replace(files, look, 1)
	var bad_keys: Array = []
	for k in rep.keys():
		if int(k) / 1000 > 3:
			bad_keys.append(int(k))
	ck("替换键只落在 0/1/2/3 段（不碰衣裤肩头）", bad_keys.is_empty(), str(bad_keys))
	ck("四处部位都产生了替换", rep.size() == 4, str(rep))
	ck("换发型 → files[1] 5 换成 style7 女款",
		int(rep.get(5, 0)) == Appearance.part_id(0, 7, 1, 1),
		"%d vs %d" % [int(rep.get(5, 0)), Appearance.part_id(0, 7, 1, 1)])
	# 默认外观不该产生任何替换
	var rep0 := Appearance.part_replace(files, Appearance.defaults(1), 1)
	ck("默认外观不产生替换（等于 model 原生）", rep0.is_empty(), str(rep0))

	# ---------- 渲染确实变化 ----------
	var base := SpriteComposer.render_frame_image_equipped(300, 0, {})
	var hair_rep := Appearance.part_replace(files, {"hair_style": 5, "hair_color": 2}, 1)
	var hair_img := SpriteComposer.render_frame_image_equipped(300, 0, hair_rep)
	ck("换发型后画面不同", _diff(base, hair_img) > 60, "差异像素 " + str(_diff(base, hair_img)))
	var face_rep := Appearance.part_replace(files, {"face_style": 10}, 1)
	var face_img := SpriteComposer.render_frame_image_equipped(300, 0, face_rep)
	ck("换脸型后画面不同", _diff(base, face_img) > 40, "差异像素 " + str(_diff(base, face_img)))
	var skin_rep := Appearance.part_replace(files,
		{"hand_color": 3, "hand_style": 1, "feet_color": 3, "feet_style": 1}, 1)
	var skin_img := SpriteComposer.render_frame_image_equipped(300, 0, skin_rep)
	ck("换手/脚肤色后画面不同", _diff(base, skin_img) > 20, "差异像素 " + str(_diff(base, skin_img)))
	# 男款 model 100 也要能换
	var files_m := SpriteComposer.model_files(100)
	var rep_m := Appearance.part_replace(files_m, look, 0)
	ck("男款 model100 同样能换四处", rep_m.size() == 4, str(rep_m))

	# ---------- 自由调色（RGB）----------
	ck("色值往返 0xRRGGBB", Appearance.color_to_int(Appearance.color_from_int(0x3A7BC8)) == 0x3A7BC8,
		str(Appearance.color_to_int(Appearance.color_from_int(0x3A7BC8))))
	ck("-1 = 关闭调色", not Recolor.enabled(Appearance.color_from_int(-1)),
		str(Appearance.color_from_int(-1)))
	var tint_look: Dictionary = Appearance.defaults(1)
	tint_look["hair_rgb"] = 0xFF8800
	var tints: Dictionary = Appearance.resolve_tints(tint_look, 1)
	ck("只给启用的部位出 tints（发型图号 5）", tints.size() == 1 and tints.has(5), str(tints.keys()))
	ck("调色不产生额外部件替换", Appearance.apply(files, tint_look, 1)["replace"].is_empty(),
		str(Appearance.apply(files, tint_look, 1)["replace"]))
	var tint_img := SpriteComposer.render_frame_image_equipped(300, 0, {}, [], [], 0, tints)
	ck("调色后整帧画面变化", _diff(base, tint_img) > 60, "差异像素 " + str(_diff(base, tint_img)))
	# 头发图号 5 原色是紫（h≈0.80），染成橙后主色相必须贴到目标
	var hair_src := SpriteComposer.part_image(5, 0)
	var hair_tinted := Recolor.tint(hair_src, Color(1.0, 0.53, 0.0))
	var h_after := Recolor.dominant_color(hair_tinted)
	ck("发型调色后主色相 ≈ 目标橙", absf(h_after.h - 0.09) < 0.04,
		"h=%.3f" % h_after.h)
	# 明暗层次不能丢：调色前后同一像素的亮度排序要基本一致
	# （用中间明度的目标色验，满饱和色的 V 天花板是 1.0，排序本来就会被夹）
	var hair_mid := Recolor.tint(hair_src, Color(0xCC / 255.0, 0x88 / 255.0, 0x44 / 255.0))
	var order_ok := _order_preserved(hair_src, hair_mid)
	ck("调色保留明暗层次（亮度排序不塌）", order_ok)
	var levels_before := _levels(hair_src)
	var levels_hot := _levels(Recolor.tint(hair_src, Color(1.0, 0.53, 0.0)))
	ck("纯饱和目标色也不压成一片单色", levels_hot >= maxi(6, levels_before / 2),
		"调色后 %d 档 / 原图 %d 档" % [levels_hot, levels_before])
	# 肤色模式必须放过眼睛/描边（原图近黑像素保持近黑）
	var face_src := SpriteComposer.part_image(1005, 0)
	var face_tinted := Recolor.tint(face_src, Color(0.45, 0.75, 0.40), "skin")
	var dark_total := 0
	var dark_kept := 0
	for y in range(face_src.get_height()):
		for x in range(face_src.get_width()):
			var s := face_src.get_pixel(x, y)
			if s.a < 0.5 or s.v >= 0.18:
				continue
			dark_total += 1
			if face_tinted.get_pixel(x, y).v < 0.18:
				dark_kept += 1
	ck("肤色模式保留眼睛/描边", dark_total > 0 and dark_kept == dark_total,
		"%d/%d" % [dark_kept, dark_total])
	# 肤色模式确实改了皮肤（亮部色相变了）
	var skin_after := Recolor.dominant_color(face_tinted, "skin")
	ck("肤色模式改了皮肤色相", absf(skin_after.h - 0.30) < 0.08, "h=%.3f" % skin_after.h)
	ck("配色预设一次给四处上色",
		Appearance.combo_look(0, Appearance.defaults(1)).size() == Appearance.defaults(1).size()
		and int(Appearance.combo_look(0, Appearance.defaults(1))["hair_rgb"]) >= 0,
		str(Appearance.combo_look(0, Appearance.defaults(1))))

	# ---------- 越界与回退 ----------
	ck("style 超上限返回 -1", Appearance.part_id(0, 99, 0, 1) == -1, str(Appearance.part_id(0, 99, 0, 1)))
	ck("color 超上限返回 -1", Appearance.part_id(2, 1, 9, 1) == -1, str(Appearance.part_id(2, 1, 9, 1)))
	var broken := Appearance.resolve({"hair_style": 12, "face_style": 0}, 1)
	ck("缺图档位（发型12）回退到 style1", int(broken[0]) == 5, str(broken[0]))
	ck("脸型 0 回退到 style1", int(broken[1]) == 1005, str(broken[1]))

	# ---------- 与装备外观共存 ----------
	var look_eq := Equipment.appearance(gd, 300, {"clothes": 10032})
	var eq_rep: Dictionary = look_eq.part_replace
	# ★ 必须 duplicate：GDScript 字典是引用类型，直接赋值会把原字典也改掉
	var merged: Dictionary = eq_rep.duplicate()
	for k in rep.keys():
		merged[k] = rep[k]
	var overlap := 0
	for k in eq_rep.keys():
		if rep.has(k):
			overlap += 1
	ck("外观与装备替换键不重叠", overlap == 0, str(overlap))
	ck("合并后既有衣/裤又有发/脸", merged.size() == eq_rep.size() + rep.size(),
		"%d + %d = %d" % [eq_rep.size(), rep.size(), merged.size()])

	# ---------- 存档往返 ----------
	var st = StateScript.new()
	st.sex = "女"
	st.appearance = Appearance.defaults(1)
	st.set_look("hair_style", 9)
	st.set_look("face_style", 11)
	st.set_look("hand_color", 2)
	ck("set_look 生效", int(st.appearance.get("hair_style", 0)) == 9,
		str(st.appearance.get("hair_style")))
	ck("改外观会写盘", FileAccess.file_exists(LOOK_PATH))
	var st2 = StateScript.new()
	st2.sex = "女"
	st2.load_appearance()
	ck("存档读回发型 9", int(st2.appearance.get("hair_style", 0)) == 9,
		str(st2.appearance.get("hair_style")))
	ck("存档读回脸型 11", int(st2.appearance.get("face_style", 0)) == 11,
		str(st2.appearance.get("face_style")))
	ck("存档读回手色 2", int(st2.appearance.get("hand_color", 0)) == 2,
		str(st2.appearance.get("hand_color")))
	# 非法字段名要被忽略，不能往存档里塞垃圾键
	st.set_look("not_a_field", 5)
	ck("未知字段被忽略", not st.appearance.has("not_a_field"))
	# 自由调色的存档往返 + 越界拒绝
	st.set_look_color("hair_rgb", Color(0.2, 0.6, 0.9))
	st.set_look("face_rgb", 0x74A85A)
	ck("自由调色写进状态", int(st.appearance.get("hair_rgb", -1)) == Appearance.color_to_int(Color(0.2, 0.6, 0.9)),
		str(st.appearance.get("hair_rgb")))
	var st3 = StateScript.new()
	st3.sex = "女"
	st3.load_appearance()
	ck("存档读回自由发色", int(st3.appearance.get("hair_rgb", -1)) == Appearance.color_to_int(Color(0.2, 0.6, 0.9)),
		str(st3.appearance.get("hair_rgb")))
	ck("存档读回自由肤色", int(st3.appearance.get("face_rgb", -1)) == 0x74A85A,
		str(st3.appearance.get("face_rgb")))
	st.set_look("hair_rgb", 0x1234567)
	ck("越界色值被拒绝", int(st.appearance.get("hair_rgb", -1)) != 0x1234567,
		str(st.appearance.get("hair_rgb")))
	st.clear_look_color("hair_rgb")
	ck("clear_look_color 回到 -1", int(st.appearance.get("hair_rgb", 0)) == -1,
		str(st.appearance.get("hair_rgb")))
	# 随机结果必须全部可用
	var rnd := Appearance.random_look(1)
	var ok_rnd := true
	for part in [0, 1, 2, 3]:
		var f: Dictionary = Appearance.FIELDS[part]
		var s := int(rnd.get(str(f["style"]), 1))
		var c := int(rnd.get(str(f["color"]), 0)) if not str(f["color"]).is_empty() else 0
		if not Appearance.exists(part, s, c, 1):
			ok_rnd = false
	ck("随机出来的组合全部有图", ok_rnd, str(rnd))

	# ---------- 还原玩家存档 ----------
	if _had:
		var f2 := FileAccess.open(LOOK_PATH, FileAccess.WRITE)
		if f2 != null:
			f2.store_buffer(_bak)
			f2.close()
	else:
		if FileAccess.file_exists(LOOK_PATH):
			DirAccess.remove_absolute(ProjectSettings.globalize_path(LOOK_PATH))
	ck("验收后已还原玩家外观存档",
		FileAccess.get_file_as_bytes(LOOK_PATH) == _bak if _had else not FileAccess.file_exists(LOOK_PATH))

	# ---------- 场景可加载 ----------
	var scene = load("res://scenes/AppearanceScreen.tscn")
	ck("外观屏场景可加载", scene is PackedScene)
	if scene is PackedScene:
		var inst = scene.instantiate()
		ck("外观屏脚本已挂载", inst.get_script() != null)
		inst.free()

	print("[verify] 失败项 ", failures)
	quit(1 if failures > 0 else 0)
