extends SceneTree
## 装备系统验收（确定性检查，headless）。
##   godot --headless --path godot-next --script res://tools/verify_equipment.gd

const Equipment = preload("res://scripts/Equipment.gd")
const GameData = preload("res://scripts/GameData.gd")
const SpriteComposer = preload("res://scripts/SpriteComposer.gd")

var failures := 0
var gd = GameData.new()
## 测试会调用 ScreenState.equip()/clear_equipment()（内部会写 user://equipment.json），
## 跑完必须把玩家的存档原样写回，否则一次验收就清空了玩家的装备。
const EQUIP_PATH = "user://equipment.json"
var _equip_backup: PackedByteArray = []
var _equip_had_file := false


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
	_equip_had_file = FileAccess.file_exists(EQUIP_PATH)
	if _equip_had_file:
		_equip_backup = FileAccess.get_file_as_bytes(EQUIP_PATH)

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

	# ---- 无外观编码的槽位（腰带/鞋/护手/项链/戒指/护符）也要能选 ----
	# 原版这些道具 icon=0，只影响属性、不改外观；以前被 icon>0 过滤掉了。
	for slot in ["waist", "shoes", "hand", "necklace", "ring", "amulet"]:
		var n := Equipment.items_for_slot(gd, slot, 100000).size()
		ck("★%s 槽位有可选项" % Equipment.label_of_slot(slot), n > 0, str(n))

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
	# ★ 色号变体（4084/4088/4136…）自己没有 json，帧表在同组组首上（4081/4085/4133…），
	#   必须借用，否则整张双片图集会被当成「一帧」画出来 → 贴图挤压错位。
	ck("基础肩 4013 是多帧图集", Equipment.is_multi_frame(4013))
	var f4084 := SpriteComposer.fragment_frames(4084)
	ck("★朱红支配衬肩 4084 借用同组帧表（2 帧）", f4084.size() == 2, str(f4084.keys()))
	ck("★4084 帧尺寸 15x14 + 22x21", int(f4084.get("0", {}).get("w", 0)) == 15 and
		int(f4084.get("1", {}).get("h", 0)) == 21, str(f4084))
	var f4088 := SpriteComposer.fragment_frames(4088)
	ck("★朱红支配衬肩女款 4088 借用同组帧表（2 帧）", f4088.size() == 2, str(f4088.keys()))
	ck("★星月冥肩 4136 借用同组帧表（不再当单帧整图）", Equipment.is_multi_frame(4136),
		str(SpriteComposer.fragment_frames(4136).keys()))
	ck("★补表后 4185 是原版 2 帧图集", Equipment.is_multi_frame(4185),
		str(SpriteComposer.fragment_frames(4185).keys()))
	ck("整张图本身就是一帧的部件（如头发 1）仍判单帧", not Equipment.is_multi_frame(1))

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
	# ★ 星月冥肩：4136 现在能借到 4133 的帧表 → 按两片画，不再需要 single_use 兜底
	var look_shoulder := Equipment.appearance(gd, 300, {"shoulder": 11242})  # icon 4132
	ck("星月冥肩替换肩槽 4013→4136", int(look_shoulder.part_replace.get(4013, 0)) == 4136,
		str(look_shoulder.part_replace))
	ck("★星月冥肩有帧表 → 不标记 single_use（两片各画一次）",
		not (look_shoulder.single_use as Array).has(4013), str(look_shoulder.single_use))
	# ★ 朱红支配衬肩（item 11015，icon 4084）：本次修复的核心回归
	var look_red_f := Equipment.appearance(gd, 300, {"shoulder": 11015})
	ck("★朱红支配衬肩（女）替换肩槽 4013→4088",
		int(look_red_f.part_replace.get(4013, 0)) == 4088, str(look_red_f.part_replace))
	ck("★朱红支配衬肩（女）不标记 single_use",
		not (look_red_f.single_use as Array).has(4013), str(look_red_f.single_use))
	var look_red_m := Equipment.appearance(gd, 100, {"shoulder": 11015})
	ck("★朱红支配衬肩（男）替换肩槽 4001→4084",
		int(look_red_m.part_replace.get(4001, 0)) == 4084, str(look_red_m.part_replace))
	ck("★朱红支配衬肩（男）不标记 single_use",
		not (look_red_m.single_use as Array).has(4001), str(look_red_m.single_use))
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
	# ---- 背部：独立 cloak model（1100+backStyle），不再硬贴部件 ----
	ck("icon5001 → 背部 style 1", Equipment.back_style_of_item({"icon": 5001}) == 1)
	ck("icon14017 → 坐骑 style 5", Equipment.transport_style_of_item({"icon": 14017}) == 5)
	var look_back := Equipment.appearance(gd, 300, {"back": 13510})  # 侠义披风 icon5001
	ck("★背部→Cloak Model 1101", int(look_back.cloak_model) == 1101, str(look_back.cloak_model))
	ck("★披风不再伪装成 add_parts 硬贴", (look_back.add_parts as Array).is_empty())
	ck("背部 style31 原版不显示", Equipment.cloak_model_for(31, 0, 0) == 0)
	ck("坐骑 style36 藏披风", Equipment.cloak_model_for(1, 0, 36) == 0)
	ck("衣服 style51 → cloak 32（规则保留）", Equipment.cloak_model_for(1, 51, 0) == 1132)

	# ---- 坐骑：换整幅「人+坐骑」model（0055.js getHorseSpriteNameIDByWeapon）----
	var look_mount_m := Equipment.appearance(gd, 100, {"transport": 31000})  # 白狼 icon14017
	ck("★男号无武器坐骑 style5 → Model 705", int(look_mount_m.model_id) == 705,
		str(look_mount_m.model_id))
	var look_mount_f := Equipment.appearance(gd, 300, {"transport": 31000})
	ck("★女号无武器坐骑 → Model 905", int(look_mount_f.model_id) == 905,
		str(look_mount_f.model_id))
	var look_mount_sword_m := Equipment.appearance(gd, 100, {"transport": 31000, "weapon": 20300})
	ck("★男号坐骑+刀 → Model 2413", int(look_mount_sword_m.model_id) == 2413,
		str(look_mount_sword_m.model_id))
	var look_mount_sword_f := Equipment.appearance(gd, 300, {"transport": 31000, "weapon": 20300})
	ck("★女号坐骑+刀 → Model 2463", int(look_mount_sword_f.model_id) == 2463,
		str(look_mount_sword_f.model_id))
	ck("★坐骑 model 里仍替换武器图", int(look_mount_sword_m.part_replace.get(8001, 0)) == 8001,
		str(look_mount_sword_m.part_replace))
	var look_mount_battle := Equipment.appearance(gd, 200, {"transport": 31000})
	ck("★战斗造型不骑马（原版 0==n 分支）", int(look_mount_battle.model_id) == 200,
		str(look_mount_battle.model_id))
	# 武器姿势偏移照 0055.js，不是直接把 item.type 加到 model 上
	ck("武器姿势：空手 type24 不换姿势", Equipment.weapon_pose_offset(24) == 0)
	ck("武器姿势：单手锤 type37 +44", Equipment.weapon_pose_offset(37) == 44)
	ck("武器姿势：双手枪 type36 +73", Equipment.weapon_pose_offset(36) == 73)
	ck("坐骑武器偏移：单手枪 type35 +42", Equipment.horse_pose_offset(35) == 42)
	ck("坐骑武器偏移：空手 -1（走 700+style）", Equipment.horse_pose_offset(24) == -1)
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
	# ★ 护肩 two-frame 替换：4084/4088 借到帧表后应按两片分别画，
	#   渲染结果必须与「去掉肩部替换」不同，且与「强制只画一次」不同。
	var shoulder_red := SpriteComposer.render_frame_image_equipped(
		int(look_red_f.model_id), 0, look_red_f.part_replace, look_red_f.single_use)
	ck("★朱红支配衬肩渲染改变画面", _diff(base_img, shoulder_red) > 20,
		"差异像素 " + str(_diff(base_img, shoulder_red)))
	var shoulder_red_forced := SpriteComposer.render_frame_image_equipped(
		int(look_red_f.model_id), 0, look_red_f.part_replace, [4013])
	ck("★朱红支配衬肩按两片画（≠强制单次）", _diff(shoulder_red, shoulder_red_forced) > 5,
		"差异像素 " + str(_diff(shoulder_red, shoulder_red_forced)))
	# single_use 兜底机制仍在（真·单帧整图替换双片槽时用）
	var shoulder_raw := SpriteComposer.render_frame_image_equipped(300, 0, {4013: 4136}, [])
	var shoulder_dedup := SpriteComposer.render_frame_image_equipped(300, 0, {4013: 4136}, [4013])
	ck("single_use 强制只画一次仍生效", _diff(shoulder_raw, shoulder_dedup) > 5,
		"差异像素 " + str(_diff(shoulder_raw, shoulder_dedup)))
	# ★ add_parts 追加图层机制本身可用（保留能力，供以后整套造型系统用）
	var no_extra := SpriteComposer.render_frame_image_equipped(300, 0, {}, [], [])
	var with_extra := SpriteComposer.render_frame_image_equipped(300, 0, {}, [],
		[{"frag": 5001, "sub": 6, "dx": 0, "dy": -40, "behind": true, "scale": 1.0}])
	ck("add_parts 追加图层机制可用", _diff(no_extra, with_extra) > 10,
		"差异像素 " + str(_diff(no_extra, with_extra)))

	# ---- 披风层：coatPt 对齐（原版取衣服层 dx/dy）+ 画在角色后面 ----
	var base_m := SpriteComposer.render_frame_image_equipped(100, 0, {})
	ck("coatPt 取衣服层 dx/dy(-2,-35)",
		SpriteComposer._frame_coat_point(100, 0) == Vector2i(-2, -35),
		str(SpriteComposer._frame_coat_point(100, 0)))
	var with_cloak := SpriteComposer.render_frame_image_equipped(100, 0, {}, [], [], 1101)
	ck("★披风渲染增加像素", _opaque(with_cloak) > _opaque(base_m),
		"%d > %d" % [_opaque(with_cloak), _opaque(base_m)])
	var cloak_behind := true
	for y in range(base_m.get_height()):
		for x in range(base_m.get_width()):
			if base_m.get_pixel(x, y).a >= 1.0 and not with_cloak.get_pixel(x, y).is_equal_approx(base_m.get_pixel(x, y)):
				cloak_behind = false
	ck("★披风画在角色后面（不覆盖不透明像素）", cloak_behind)
	var mount_img := SpriteComposer.render_frame_image_equipped(705, 0, {})
	ck("★坐骑整幅 model 可渲染（像素多于站立）", _opaque(mount_img) > _opaque(base_m),
		"%d > %d" % [_opaque(mount_img), _opaque(base_m)])
	ck("★坐骑画面与站立明显不同", _diff(base_m, mount_img) > 500,
		"差异像素 " + str(_diff(base_m, mount_img)))

	# ---- 坐骑：装备后必须换整幅 model（不能静默回退基础造型）----
	# 2026-11-18 事故：743/943 等无武器款 model 漏导出 → 装备恶魔之翼毫无变化。
	var wings_m := Equipment.appearance(gd, 100, {"transport": 31164})   # 恶魔之翼
	var wings_f := Equipment.appearance(gd, 300, {"transport": 31164})
	ck("★恶魔之翼 男/无武器 → 743", int(wings_m.model_id) == 743, str(wings_m.model_id))
	ck("★恶魔之翼 女/无武器 → 943", int(wings_f.model_id) == 943, str(wings_f.model_id))
	ck("★天使之翼 无武器 → 742/942",
		int(Equipment.appearance(gd, 100, {"transport": 31162}).model_id) == 742 and
		int(Equipment.appearance(gd, 300, {"transport": 31162}).model_id) == 942)
	# 全量：151 件坐骑 × 男女 × 空手/刀，都不能保持基础 model
	var fallback: Array = []
	for id in gd.ids("items"):
		var entries = gd.get_entry("items", id)
		if entries.is_empty() or not (entries[0] is Dictionary):
			continue
		var it = entries[0]
		if int(it.get("type", -1)) != 11 or int(it.get("icon", 0)) <= 14000:
			continue
		for base in [100, 300]:
			for variant in [{"transport": int(id)}, {"transport": int(id), "weapon": 20300}]:
				var mid := int(Equipment.appearance(gd, base, variant).model_id)
				if mid == base or not Equipment.model_exists(mid):
					fallback.append([int(id), base, mid])
	ck("★151 件坐骑 × 男女 × 空手/刀 全部换成坐骑 model", fallback.is_empty(),
		"未换 %d 个，例：%s" % [fallback.size(), str(fallback.slice(0, 5))])

	# ---- 坐骑颜色：icon 低两位 = 同款 4 色号（PNG_TRANSPORT 分支）----
	ck("飞龙 14025 色号 0", Equipment.transport_color_of_item(
		Equipment.item_data(gd, 31046)) == 0)
	ck("蓝幼龙 14027 色号 2", Equipment.transport_color_of_item(
		Equipment.item_data(gd, 31120)) == 2)
	var dragon0 := SpriteComposer.render_frame_image_equipped(
		int(Equipment.appearance(gd, 100, {"transport": 31046}).model_id), 0,
		Equipment.appearance(gd, 100, {"transport": 31046}).part_replace)
	var dragon2 := SpriteComposer.render_frame_image_equipped(
		int(Equipment.appearance(gd, 100, {"transport": 31120}).model_id), 0,
		Equipment.appearance(gd, 100, {"transport": 31120}).part_replace)
	ck("★飞龙与蓝幼龙同 model 但颜色不同",
		int(Equipment.appearance(gd, 100, {"transport": 31046}).model_id) ==
		int(Equipment.appearance(gd, 100, {"transport": 31120}).model_id) and
		_diff(dragon0, dragon2) > 500, "差异像素 " + str(_diff(dragon0, dragon2)))

	# ---- 时装（type 12）：fashIcon 位域 → 整套部件覆盖，且不顶掉坐骑 ----
	var fash_item := Equipment.item_data(gd, 15030)   # 恶魔时装
	var parts_m := Equipment.fashion_parts(fash_item, 0)
	var parts_f := Equipment.fashion_parts(fash_item, 1)
	ck("★时装 15030 男款解出 衣/裤/头（6156/7451/10055）",
		int(parts_m.get(6, 0)) == 6156 and int(parts_m.get(7, 0)) == 7451
		and int(parts_m.get(10, 0)) == 10055, str(parts_m))
	ck("★时装女款图号 +4（6160/7455）",
		int(parts_f.get(6, 0)) == 6160 and int(parts_f.get(7, 0)) == 7455, str(parts_f))
	ck("★时装披风 style=10 → Cloak 1110",
		Equipment.fashion_back_style(fash_item) == 10)
	var fash_look := Equipment.appearance(gd, 100, {"fashion": 15030})
	ck("★时装不改基础 model", int(fash_look.model_id) == 100, str(fash_look.model_id))
	ck("★时装替换衣服图 6001→6156", int(fash_look.part_replace.get(6001, 0)) == 6156,
		str(fash_look.part_replace))
	ck("★时装披风叠上 Cloak 1110", int(fash_look.cloak_model) == 1110,
		str(fash_look.cloak_model))
	var fash_img := SpriteComposer.render_frame_image_equipped(100, 0,
		fash_look.part_replace, fash_look.single_use, fash_look.add_parts,
		int(fash_look.cloak_model))
	ck("★时装画面与裸装明显不同", _diff(base_m, fash_img) > 500,
		"差异像素 " + str(_diff(base_m, fash_img)))

	# 时装 + 坐骑：坐骑 model 不能被顶掉，时装部件要作用在坐骑 model 的身体槽上
	var fash_mount := Equipment.appearance(gd, 100,
		{"fashion": 15030, "transport": 31000})
	ck("★时装+坐骑：仍是坐骑 model 705", int(fash_mount.model_id) == 705,
		str(fash_mount.model_id))
	ck("★时装+坐骑：衣服仍被时装替换", int(fash_mount.part_replace.get(6001, 0)) == 6156,
		str(fash_mount.part_replace))
	var mount_plain := SpriteComposer.render_frame_image_equipped(705, 0, {})
	var fash_mount_img := SpriteComposer.render_frame_image_equipped(705, 0,
		fash_mount.part_replace, fash_mount.single_use, fash_mount.add_parts,
		int(fash_mount.cloak_model))
	ck("★时装+坐骑画面有变化", _diff(mount_plain, fash_mount_img) > 500,
		"差异像素 " + str(_diff(mount_plain, fash_mount_img)))
	# 恶魔之翼这种「替代整个人物」的坐骑 model 没有衣服槽，时装不生效但坐骑仍正常
	var fash_wings := Equipment.appearance(gd, 100,
		{"fashion": 15030, "transport": 31164})
	ck("★时装+恶魔之翼：坐骑 model 仍是 743", int(fash_wings.model_id) == 743,
		str(fash_wings.model_id))

	# 时装披风不能无条件覆盖玩家自己的背部/翅膀（否则换时装=随机换翅膀）
	var fash_keep := Equipment.appearance(gd, 300,
		{"fashion": 15183, "back": 13596})   # 天魔惊神之翼 style 28
	ck("★已穿翅膀优先，时装不覆盖背部", int(fash_keep.cloak_model) == 1128,
		str(fash_keep.cloak_model))

	# 时装部件不能套用「单帧大图缩到 34px」的护肩兜底：
	# 勇气使徒头盔 10213 是 42x35 单帧图，之前被压成 34px 宽。
	var fash_brave := Equipment.appearance(gd, 100, {"fashion": 28100})
	ck("★时装单帧部件不缩到 34px（勇气使徒头盔）",
		(fash_brave.single_use as Array).is_empty(),
		str(fash_brave.single_use))
	ck("★勇气使徒头盔 10213 已换上", int(fash_brave.part_replace.get(10021, 0)) == 10213,
		str(fash_brave.part_replace))


	# 全量：98 件时装都不能改 model / 不能带 transport 位
	var fash_bad: Array = []
	var fash_empty: Array = []
	for id in Equipment.items_for_slot(gd, "fashion", 100000):
		var it := Equipment.item_data(gd, int(id))
		for base in [100, 300]:
			var look := Equipment.appearance(gd, base, {"fashion": int(id)})
			if int(look.model_id) != base:
				fash_bad.append([int(id), base, int(look.model_id)])
			if (look.part_replace as Dictionary).is_empty():
				fash_empty.append(int(id))
	ck("★98 件时装都不改 model（只换部件）", fash_bad.is_empty(), str(fash_bad.slice(0, 5)))
	ck("★98 件时装都能换到部件（无空覆盖）", fash_empty.is_empty(),
		"空覆盖 %d 件，例：%s" % [fash_empty.size(), str(fash_empty.slice(0, 8))])


	# ---- 武器特效层（at=15，15001）：默认不画 ----
	ck("15001 是武器特效层（at=15）", SpriteComposer.is_effect_layer(15001))
	ck("普通武器图 8001 不是特效层", not SpriteComposer.is_effect_layer(8001))
	var no_flash := SpriteComposer.render_frame_image_equipped(113, 0, {})
	SpriteComposer.draw_weapon_flash = true
	var with_flash := SpriteComposer.render_frame_image_equipped(113, 0, {})
	SpriteComposer.draw_weapon_flash = false
	ck("★武器特效默认关闭（像素更少）", _opaque(no_flash) < _opaque(with_flash),
		"%d < %d" % [_opaque(no_flash), _opaque(with_flash)])

	# ---- 恶魔之翼：14169 的帧表曾漏导出，已按原版清单补齐；整组同表 ----
	var subs_14169 := SpriteComposer.fragment_frames(14169)
	ck("★14169 有原版帧表（7 帧）", subs_14169.size() == 7, str(subs_14169.size()))
	ck("★14169 与天使之翼 14165 共用同一张表",
		subs_14169 == SpriteComposer.fragment_frames(14165))
	ck("★14169 同组 14170/14171/14172 也补齐",
		SpriteComposer.fragment_frames(14170).size() == 7
		and SpriteComposer.fragment_frames(14171).size() == 7
		and SpriteComposer.fragment_frames(14172).size() == 7)
	ck("★14229（曾因缺表整张当一帧）现在有 16 帧表",
		SpriteComposer.fragment_frames(14229).size() == 16,
		str(SpriteComposer.fragment_frames(14229).size()))
	var sub0 = SpriteComposer._sub_frame(14169, 0)
	ck("★14169 子帧是裁切后的翅膀（不是整张 224x212 图集）",
		sub0 != null and (sub0.get_width() < 224 or sub0.get_height() < 212),
		("%dx%d" % [sub0.get_width(), sub0.get_height()]) if sub0 != null else "null")
	var atlas := Image.new()
	atlas.load_png_from_buffer(FileAccess.get_file_as_bytes(
		"res://assets/sprite_fragment/14169.png"))
	var demon := SpriteComposer.render_frame_image_equipped(32213, 0, {})
	ck("★恶魔之翼不再整张图集重画（像素少于整张图集）",
		_opaque(demon) < _opaque(atlas), "%d < %d" % [_opaque(demon), _opaque(atlas)])

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
		# _ready 会读玩家存档（可能已经穿着白狼/武器），先清成空列表再断言，
		# 而且直接改字段不落盘 —— 不能用 clear_equipment()，那会覆盖玩家存档。
		st2.set("equipped", {})
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

	# 还原玩家存档（上面几个 ScreenState 实例会写盘）
	if _equip_had_file:
		var f_out := FileAccess.open(EQUIP_PATH, FileAccess.WRITE)
		if f_out != null:
			f_out.store_buffer(_equip_backup)
			f_out.close()
	else:
		DirAccess.remove_absolute(ProjectSettings.globalize_path(EQUIP_PATH))

	if failures == 0:
		print("[verify] 装备系统全部通过")
	else:
		printerr("[verify] 失败 ", failures, " 项")
	quit(0 if failures == 0 else 1)
