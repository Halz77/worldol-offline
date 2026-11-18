extends SceneTree
## 生成装备外观对比图：左边=错误做法（女角色直接穿男款 icon），右边=修复后（女款图号）。
##   godot --headless --path godot-next --script res://tools/equip_compare.gd
## 产物：_out/equip_compare.png

const SpriteComposer = preload("res://scripts/SpriteComposer.gd")
const Equipment = preload("res://scripts/Equipment.gd")


func _initialize() -> void:
	# 女 model 300，帧 4（战斗站立，更能看清衣服裤子）
	var fno := 4
	# 三件装备：法袍 icon6075、锦裤 icon7089、肩饰 icon4145
	# 错误：直接把 icon 塞进槽位（女角色穿男款图）
	var wrong := {6005: 6075, 7005: 7089, 4013: 4145}
	# 正确：按性别换算女款图号
	var right := {}
	for spec in [[1, 6075, 6005], [2, 7089, 7005], [3, 4145, 4013]]:
		var frag := Equipment.part_fragment_id(int(spec[1]), int(spec[0]), 1)
		right[int(spec[2])] = frag
	print("[compare] 错误图号(男款): ", wrong)
	print("[compare] 修复图号(女款): ", right)

	var a := SpriteComposer.render_frame_image_equipped(300, fno, wrong)
	var b := SpriteComposer.render_frame_image_equipped(300, fno, right)
	if a == null or b == null:
		printerr("[compare] 渲染失败")
		quit(1)
		return
	# 拼成左右对比（各放大 2 倍）
	var scale := 2
	var W := a.get_width() * scale
	var H := a.get_height() * scale
	var canvas := Image.create(W * 2 + 20, H + 40, false, Image.FORMAT_RGBA8)
	canvas.fill(Color(0.93, 0.94, 0.96, 1.0))
	var ai := a.duplicate()
	ai.resize(W, H, Image.INTERPOLATE_NEAREST)
	var bi := b.duplicate()
	bi.resize(W, H, Image.INTERPOLATE_NEAREST)
	for y in range(H):
		for x in range(W):
			var pa: Color = ai.get_pixel(x, y)
			if pa.a > 0.0:
				canvas.set_pixel(x, y + 30, pa)
			var pb: Color = bi.get_pixel(x, y)
			if pb.a > 0.0:
				canvas.set_pixel(W + 20 + x, y + 30, pb)
	var out := ProjectSettings.globalize_path("res://_out")
	DirAccess.make_dir_recursive_absolute(out)
	var err := canvas.save_png(out + "/equip_compare.png")
	print("[compare] 保存 ", out, "/equip_compare.png err=", err,
		"  （左=男款错图，右=女款修复）")
	quit(0)
