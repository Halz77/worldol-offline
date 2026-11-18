extends SceneTree
## 背/坐骑外观对照图（一次看清披风、翅膀、尾巴、坐骑整幅造型的落点）。
##   godot --headless --path godot-next --script res://tools/equip_looks.gd
## 产物：_out/equip_looks.png（4 列 × 2 行，2x 放大）
##
## 说明：披风不是按脚点定位，而是按该帧「衣服层」的 dx/dy（coatPt）当原点；
## 坐骑是整幅 model（含骑手与武器）。两处规则见 Equipment.gd 顶部注释。

const SpriteComposer = preload("res://scripts/SpriteComposer.gd")
const Equipment = preload("res://scripts/Equipment.gd")
const GameData = preload("res://scripts/GameData.gd")

const SCALE := 2
const COLS := 4

var gd = GameData.new()


func _render(base_mid: int, eq: Dictionary, fno: int) -> Image:
	var look := Equipment.appearance(gd, base_mid, eq)
	print("[look] model=", look.model_id, " cloak=", look.cloak_model,
		" replace=", look.part_replace, " detail=", look.detail)
	return SpriteComposer.render_frame_image_equipped(int(look.model_id), fno,
		look.part_replace, look.single_use, look.add_parts, int(look.cloak_model))


func _initialize() -> void:
	var panels := [
		_render(300, {}, 0),                                    # 女 裸
		_render(300, {"back": 13510}, 0),                       # 侠义披风 style1
		_render(300, {"back": 13563}, 0),                       # 黑翼 style3
		_render(300, {"back": 13526}, 0),                       # 尾巴 style5
		_render(100, {"transport": 31000, "weapon": 20300}, 0), # 白狼 style5 + 刀（男 2413）
		_render(300, {"transport": 31000, "weapon": 20300}, 0), # 白狼 style5 + 刀（女 2463）
		_render(100, {"transport": 31053, "weapon": 20300}, 0), # 狮鹫 style12 + 刀
		_render(100, {"transport": 31162, "weapon": 20300}, 0), # 凤凰之翼 style42 + 刀
	]
	var cell_w := SpriteComposer.CANVAS_W * SCALE
	var cell_h := SpriteComposer.CANVAS_H * SCALE
	var rows := int(ceil(float(panels.size()) / float(COLS)))
	var canvas := Image.create(cell_w * COLS + 10 * (COLS - 1),
		cell_h * rows + 10 * (rows - 1), false, Image.FORMAT_RGBA8)
	canvas.fill(Color(0.93, 0.94, 0.96, 1.0))
	for i in range(panels.size()):
		var img: Image = panels[i]
		if img == null:
			continue
		var scaled: Image = img.duplicate()
		scaled.resize(cell_w, cell_h, Image.INTERPOLATE_NEAREST)
		var ox := (i % COLS) * (cell_w + 10)
		var oy := (i / COLS) * (cell_h + 10)
		for y in range(cell_h):
			for x in range(cell_w):
				var c: Color = scaled.get_pixel(x, y)
				if c.a > 0.0:
					canvas.set_pixel(ox + x, oy + y, c)
	var out := ProjectSettings.globalize_path("res://_out")
	DirAccess.make_dir_recursive_absolute(out)
	var err := canvas.save_png(out + "/equip_looks.png")
	print("[look] save err=", err, " -> ", out, "/equip_looks.png")
	quit(0)
