extends SceneTree
## headless 自检：确认工程能打开、素材清单可读、拼装器能真的画出人物。
##   godot --headless --path godot-next --script res://tools/selfcheck.gd
## 这不是测试护栏，只是一次性的「工程可用」检查；用户不需要维护它。

const SpriteComposer = preload("res://scripts/SpriteComposer.gd")
const GameData = preload("res://scripts/GameData.gd")
const Stats = preload("res://scripts/Stats.gd")


func _init() -> void:
	print("[selfcheck] Godot ", Engine.get_version_info().get("string", "?"))
	var m = GameData.manifest()
	print("[selfcheck] 素材 ", m.get("count", 0), " 个 / 分类 ", GameData.categories().size(), " 类")
	print("[selfcheck] 数据源 ", GameData.data_sources().size(), " 个 / 数值基线 ", Stats.case_count(), " 角色")

	var out_dir = ProjectSettings.globalize_path("res://_out")
	DirAccess.make_dir_recursive_absolute(out_dir)

	# 300 基础女角色 / 323 带翅膀与武器 / 465 带 flip 旋转部件的双持刀
	var checks = [[300, 0], [323, 0], [465, 0]]
	for entry in checks:
		var mid = int(entry[0])
		var fno = int(entry[1])
		var frames = SpriteComposer.frame_numbers(mid)
		var img = SpriteComposer.render_frame_image(mid, fno)
		if frames.is_empty() or img == null:
			printerr("[selfcheck] Model", mid, " 帧表或拼装失败")
			quit(1)
			return
		var opaque = 0
		for y in range(img.get_height()):
			for x in range(img.get_width()):
				if img.get_pixel(x, y).a > 0.0:
					opaque += 1
		var big = img.duplicate() as Image
		big.resize(540, 600, Image.INTERPOLATE_NEAREST)
		var out_png = out_dir + "/frame_" + str(mid) + "_" + str(fno) + ".png"
		var err = big.save_png(out_png)
		print("[selfcheck] Model", mid, " 帧数 ", frames.size(), " 非透明像素 ", opaque, " → ", out_png, " err=", err)
		if opaque < 800 or err != OK:
			printerr("[selfcheck] Model", mid, " 校验失败：拼装结果为空或写盘失败")
			quit(1)
			return
	print("[selfcheck] 全部通过")
	quit(0)
