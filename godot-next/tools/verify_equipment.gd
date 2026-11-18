extends SceneTree
## 装备系统验收（确定性检查，headless）。
##   godot --headless --path godot-next --script res://tools/verify_equipment.gd

const Equipment = preload("res://scripts/Equipment.gd")
const GameData = preload("res://scripts/GameData.gd")
const SpriteComposer = preload("res://scripts/SpriteComposer.gd")

var failures := 0
var gd = GameData.new()


func ck(label: String, ok: bool, detail: String = "") -> void:
	if ok:
		print("[check] ok - ", label, (" · " + detail) if detail != "" else "")
	else:
		failures += 1
		printerr("[check] FAIL - ", label, " ", detail)


func _opaque(img) -> int:
	if img == null:
		return -1
	var n := 0
	for y in range(img.get_height()):
		for x in range(img.get_width()):
			if img.get_pixel(x, y).a > 0.0:
				n += 1
	return n


func _diff(a, b) -> int:
	if a == null or b == null:
		return -1
	var n := 0
	for y in range(a.get_height()):
		for x in range(a.get_width()):
			if not a.get_pixel(x, y).is_equal_approx(b.get_pixel(x, y)):
				n += 1
	return n


func _initialize() -> void:
	# ---- 部位定义 ----
	ck("部位槽共 14 个", Equipment.slot_defs().size() == 14,
		str(Equipment.slot_defs().size()))
	ck("type 19(法杖) → weapon 槽", Equipment.slot_of_type(19) == "weapon")
	ck("type 1(衣) → clothes 槽", Equipment.slot_of_type(1) == "clothes")
	ck("部位中文名：护肩", Equipment.label_of_slot("shoulder") == "护肩")

	# ---- 装备列表（数据可用）----
	var weapons := Equipment.items_for_slot(gd, "weapon", 50)
	ck("武器列表非空且 ≤50", weapons.size() > 0 and weapons.size() <= 50, str(weapons.size()))
	var clothes := Equipment.items_for_slot(gd, "clothes", 50)
	ck("衣服列表非空", clothes.size() > 0, str(clothes.size()))
	ck("武器 20300 名为青铜剑", Equipment.item_name(gd, 20300) == "青铜剑",
		Equipment.item_name(gd, 20300))

	# ---- 属性加成解析 ----
	var robe := Equipment.item_data(gd, 10032)   # 地狱炎纹法袍
	var robe_stats := Equipment.stats_of_item(robe)
	ck("法袍 def_mag 计入 DEF_MAGIC", int(robe_stats.get("DEF_MAGIC", 0)) == 842,
		str(robe_stats.get("DEF_MAGIC", 0)))
	ck("法袍 power1=13 计入 MPMAX", int(robe_stats.get("MPMAX", 0)) == 255,
		str(robe_stats.get("MPMAX", 0)))
	var high := Equipment.item_data(gd, 100664)  # 御舞轻风头饰，power=121 鉴定
	var high_stats := Equipment.stats_of_item(high)
	ck("鉴定 power 121 被忽略", not high_stats.has("IDENTIFY") and not high_stats.has("121"),
		str(high_stats.keys()))
	ck("头饰三防均计入", int(high_stats.get("DEF_MAGIC", 0)) == 1200,
		str(high_stats.get("DEF_MAGIC", 0)))

	# ---- 汇总：穿两件叠加 ----
	var eq := {"weapon": 20003, "clothes": 10032}  # 宽宏之杖 + 地狱炎纹法袍
	var agg := Equipment.aggregate_stats(gd, eq)
	ck("两件装备属性叠加：MPMAX = 20 + 255", int(agg.get("MPMAX", 0)) == 275,
		str(agg.get("MPMAX", 0)))
	ck("两件装备属性叠加：DEF_MAGIC = 842", int(agg.get("DEF_MAGIC", 0)) == 842,
		str(agg.get("DEF_MAGIC", 0)))

	# ---- 外观：武器换 model ----
	var look_empty := Equipment.appearance(gd, 300, {})
	ck("无装备 → model 不变", int(look_empty.model_id) == 300)
	var look_sword := Equipment.appearance(gd, 300, {"weapon": 20300})  # 青铜剑 type13
	ck("青铜剑 → Model 313", int(look_sword.model_id) == 313, str(look_sword.model_id))
	var look_staff := Equipment.appearance(gd, 300, {"weapon": 20003})  # 法杖 type19
	ck("法杖 → Model 319", int(look_staff.model_id) == 319, str(look_staff.model_id))
	var look_male := Equipment.appearance(gd, 100, {"weapon": 20300})
	ck("男号青铜剑 → Model 113", int(look_male.model_id) == 113, str(look_male.model_id))

	# ---- 图号换算（★性别半区，本次修复核心）----
	ck("衣 icon6075 男款→6075", Equipment.part_fragment_id(6075, 1, 0) == 6075,
		str(Equipment.part_fragment_id(6075, 1, 0)))
	ck("衣 icon6075 女款→6079", Equipment.part_fragment_id(6075, 1, 1) == 6079,
		str(Equipment.part_fragment_id(6075, 1, 1)))
	ck("裤 icon7089 男款→7089", Equipment.part_fragment_id(7089, 2, 0) == 7089,
		str(Equipment.part_fragment_id(7089, 2, 0)))
	ck("裤 icon7089 女款→7093", Equipment.part_fragment_id(7089, 2, 1) == 7093,
		str(Equipment.part_fragment_id(7089, 2, 1)))
	ck("肩 icon4145 男款→4145", Equipment.part_fragment_id(4145, 3, 0) == 4145,
		str(Equipment.part_fragment_id(4145, 3, 0)))
	ck("肩 icon4145 女款→4149", Equipment.part_fragment_id(4145, 3, 1) == 4149,
		str(Equipment.part_fragment_id(4145, 3, 1)))
	ck("头盔 icon10101 无性别偏移→10101", Equipment.part_fragment_id(10101, 0, 1) == 10101,
		str(Equipment.part_fragment_id(10101, 0, 1)))
	# ---- 武器图号换算（0055.js getWeaponIcon）----
	ck("武器 icon8001(青铜剑)→8001", Equipment.weapon_fragment_id(8001) == 8001,
		str(Equipment.weapon_fragment_id(8001)))
	ck("★武器 icon8393(冰核法杖)→8393（不是刀区间8197）", Equipment.weapon_fragment_id(8393) == 8393,
		str(Equipment.weapon_fragment_id(8393)))
	ck("★轻弩 icon8517→8517，重弩 icon8581→8581（各自不同图）",
		Equipment.weapon_fragment_id(8517) == 8517 and Equipment.weapon_fragment_id(8581) == 8581,
		str(Equipment.weapon_fragment_id(8517)) + "/" + str(Equipment.weapon_fragment_id(8581)))
	ck("★法术书 icon8769→8769（不与法杖8385混）", Equipment.weapon_fragment_id(8769) == 8769,
		str(Equipment.weapon_fragment_id(8769)))
	# ---- 单帧/多帧判定（护肩去重依据）----
	ck("基础肩 4013 是多帧图集", Equipment.is_multi_frame(4013))
	ck("星月冥肩 4132 是单帧图", not Equipment.is_multi_frame(4132))
	ck("星月冥肩女款 4136 是单帧图", not Equipment.is_multi_frame(4136))

	# ---- 外观：防具按性别替换正确的槽位与图号 ----
	var look_robe_f := Equipment.appearance(gd, 300, {"clothes": 10032})  # 女 model，icon 6075
	ck("女号法袍替换衣槽 6005→6079", int(look_robe_f.part_replace.get(6005, 0)) == 6079,
		str(look_robe_f.part_replace))
	var look_robe_m := Equipment.appearance(gd, 100, {"clothes": 10032})  # 男 model，icon 6075
	ck("男号法袍替换衣槽 6001→6075", int(look_robe_m.part_replace.get(6001, 0)) == 6075,
		str(look_robe_m.part_replace))
	var look_pants_f := Equipment.appearance(gd, 300, {"trousers": 100661})  # icon 7089
	ck("女号锦裤替换裤槽 7005→7093", int(look_pants_f.part_replace.get(7005, 0)) == 7093,
		str(look_pants_f.part_replace))
	var look_helm := Equipment.appearance(gd, 300, {"head": 100664})    # icon 10101
	ck("★头饰替换头槽 10021→10101（不是脚底阴影11001）", int(look_helm.part_replace.get(10021, 0)) == 10101,
		str(look_helm.part_replace))
	ck("头饰没有错换到阴影槽11001", not look_helm.part_replace.has(11001),
		str(look_helm.part_replace))
	# ★ 星月冥肩：单帧大图替换多帧肩槽 → 必须标记 single_use 防止画两遍
	var look_shoulder := Equipment.appearance(gd, 300, {"shoulder": 11242})  # icon 4132
	ck("星月冥肩替换肩槽 4013→4136", int(look_shoulder.part_replace.get(4013, 0)) == 4136,
		str(look_shoulder.part_replace))
	ck("★星月冥肩标记 single_use 防重复", (look_shoulder.single_use as Array).has(4013),
		str(look_shoulder.single_use))
	# 多帧肩饰不该标记 single_use（原版就是两片拼的）
	var look_shoulder2 := Equipment.appearance(gd, 300, {"shoulder": 100660})  # icon 4145 多帧
	ck("多帧肩饰不标记 single_use", not (look_shoulder2.single_use as Array).has(4013),
		str(look_shoulder2.single_use))
	# ★ 武器：换 model 后还要替换 model 里的武器部件图为装备的具体图
	var look_wpn := Equipment.appearance(gd, 300, {"weapon": 20032})  # 冰核法杖 icon8393
	ck("★法杖替换武器部件为 8393（自身 icon）", look_wpn.part_replace.values().has(8393),
		str(look_wpn.part_replace))
	# 轻弩/重弩换成各自不同的图
	var lb_id := -1
	for cand in gd.ids("items"):
		var e = gd.get_entry("items", cand)
		if e.is_empty(): continue
		if int((e[0] as Dictionary).get("type", -1)) == 21:
			lb_id = int(cand)
			break
	if lb_id > 0:
		var lb: Dictionary = gd.get_entry("items", lb_id)[0]
		var lb_look := Equipment.appearance(gd, 321, {"weapon": lb_id})
		ck("★轻弩用自身icon而非共用图", lb_look.part_replace.values().has(int(lb.get("icon", 0))),
			str(lb_look.part_replace))
	# ★ 背部/坐骑：整套造型系统未实现，明确标注且不硬贴错误画面
	var look_back := Equipment.appearance(gd, 300, {"back": 13510})  # 侠义披风 icon5001
	ck("★背部标注外观未实现且不硬贴", (look_back.add_parts as Array).is_empty() and
		(look_back.detail as Array).has("back:外观未实现"), str(look_back.detail))
	var look_mount := Equipment.appearance(gd, 300, {"transport": 31000})  # 白狼 icon14017
	ck("★坐骑标注外观未实现且不硬贴", (look_mount.add_parts as Array).is_empty() and
		(look_mount.detail as Array).has("transport:外观未实现"), str(look_mount.detail))
	# 项链 icon=0，不该产生替换
	var look_neck := Equipment.appearance(gd, 300, {"necklace": 14001})
	ck("无外观编码装备不替换部件", look_neck.part_replace.is_empty(),
		str(look_neck.part_replace))

	# ---- 外观渲染：装备确实改变画面 ----
	var base_img := SpriteComposer.render_frame_image_equipped(300, 0, {})
	var sword_img := SpriteComposer.render_frame_image_equipped(313, 0, {})
	ck("基础造型能画出人物", _opaque(base_img) >= 1182, str(_opaque(base_img)))
	ck("持剑造型能画出人物", _opaque(sword_img) >= 1182, str(_opaque(sword_img)))
	ck("持剑造型与基础画面不同", _diff(base_img, sword_img) > 50,
		"差异像素 " + str(_diff(base_img, sword_img)))
	var robe_img := SpriteComposer.render_frame_image_equipped(300, 0, {6005: 6079})
	ck("换衣造型与基础画面不同", _diff(base_img, robe_img) > 20,
		"差异像素 " + str(_diff(base_img, robe_img)))
	# 男女款部件图尺寸不同（6075 男 16x14 / 6079 女 13x11），渲染结果必须不同
	var robe_male_img := SpriteComposer.render_frame_image_equipped(300, 0, {6005: 6075})
	var robe_female_img := SpriteComposer.render_frame_image_equipped(300, 0, {6005: 6079})
	ck("男款衣/女款衣渲染确实不同", _diff(robe_male_img, robe_female_img) > 10,
		"差异像素 " + str(_diff(robe_male_img, robe_female_img)))
	# ★ 护肩单帧图去重：4013 被两层引用，标记 single_use 后只画一次，画面应与不去重不同
	var shoulder_raw := SpriteComposer.render_frame_image_equipped(300, 0, {4013: 4136}, [])
	var shoulder_dedup := SpriteComposer.render_frame_image_equipped(300, 0, {4013: 4136}, [4013])
	ck("★护肩单帧去重确实改变画面", _diff(shoulder_raw, shoulder_dedup) > 5,
		"差异像素 " + str(_diff(shoulder_raw, shoulder_dedup)))
	# ★ add_parts 追加图层机制本身可用（保留能力，供以后整套造型系统用）
	var no_extra := SpriteComposer.render_frame_image_equipped(300, 0, {}, [], [])
	var with_extra := SpriteComposer.render_frame_image_equipped(300, 0, {}, [],
		[{"frag": 5001, "sub": 6, "dx": 0, "dy": -40, "behind": true, "scale": 1.0}])
	ck("add_parts 追加图层机制可用", _diff(no_extra, with_extra) > 10,
		"差异像素 " + str(_diff(no_extra, with_extra)))

	# ---- 装备屏场景可加载 ----
	var scene = load("res://scenes/EquipScreen.tscn")
	ck("装备屏场景可加载", scene is PackedScene)
	if scene is PackedScene:
		var inst = scene.instantiate()
		ck("装备屏脚本已挂载", inst.get_script() != null)
		# 四列控件与列表齐全
		var slot_list = inst.get_node_or_null("Margin/Root/Body/Slots/SlotScroll/SlotList")
		var item_list = inst.get_node_or_null("Margin/Root/Body/Items/ItemScroll/ItemList")
		var stat_grid = inst.get_node_or_null("Margin/Root/Body/Stats/StatScroll/StatGrid")
		ck("装备屏四列控件齐全", slot_list != null and item_list != null and stat_grid != null)
		# 用带 Autoload 的独立树实例化，验证 UI 交互链路（选择装备→穿戴→外观变化）
		var StateScript = preload("res://scripts/ScreenState.gd")
		var st2 = StateScript.new()
		st2.name = "ScreenState"
		root.add_child(st2)
		root.add_child(inst)
		await process_frame
		await process_frame
		ck("装备屏已绑定全局状态", inst.get("state") != null)
		st2.call("set_sex", "女")   # 固定基准，避免存档里的男号污染断言
		st2.call("set_pose", "正常")
		# 穿上青铜剑（item id 20300）后，外观 model 应为 313
		st2.call("equip", "weapon", 20300)
		await process_frame
		var look := Equipment.appearance(gd, int(st2.call("model_id")), st2.get("equipped"))
		ck("UI 穿剑后外观 model=313", int(look.model_id) == 313, str(look.model_id))
		# 卸下后回到 300
		st2.call("unequip", "weapon")
		await process_frame
		var look2 := Equipment.appearance(gd, int(st2.call("model_id")), st2.get("equipped"))
		ck("UI 卸剑后外观回到基础 300", int(look2.model_id) == 300, str(look2.model_id))

	# ---- ScreenState 装备状态 ----
	var StateScript = preload("res://scripts/ScreenState.gd")
	var st = StateScript.new()
	st.equip("weapon", 20300)
	ck("equip 后状态记录", int(st.equipped.get("weapon", 0)) == 20300)
	st.unequip("weapon")
	ck("unequip 后状态清除", not st.equipped.has("weapon"))
	st.equip("weapon", 20300)
	st.equip("head", 100664)
	st.clear_equipment()
	ck("clear_equipment 清空全部", st.equipped.is_empty())

	if failures == 0:
		print("[verify] 装备系统全部通过")
	else:
		printerr("[verify] 失败 ", failures, " 项")
	quit(0 if failures == 0 else 1)
