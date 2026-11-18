extends RefCounted
## 角色外观规则层（发型 / 脸型 / 手部 / 脚部 + 性别）。
##
## 全部按原版位域与图号公式：
##   - 位域常量：`0012.js:169-250`（OFFSET_* / LEN_* / START_*）
##   - 换部件公式：`0055.js:405-530`（doChangeSpriteIcon）
##
##   hair = START_HAIR(0)    + style*8 - 7 + gender*4 + color
##   face = START_FACE(1000) + style*8 - 7 + gender*4          （脸没有颜色位）
##   hand = START_HAND(2000) + style*8 - 7 + gender*4 + color
##   feet = START_FEET(3000) + style*8 - 7 + gender*4 + color
##
## 每个 style 占 8 个连续图号：前 4 个男、后 4 个女；color 0-3 是组内偏移。
## 校验示例：model 300（女）files 里是 [1005(脸), 5(发), 2005(手), 3005(脚)]，
## 对应 style=1 / gender=1 / color=0，公式算出来与 files 完全一致。
##
## 实测可用档位（sprite_fragment 里 PNG 真实存在，2026-11-18 全量扫描）：
##   hair style 1-11, 13-15（缺 12）· face 1-15 · hand/feet style 1-3
##   hair/hand/feet 各有 color 0-3 四档；face 无颜色。
##
## 该模块只算「图号」与「可用档位」，不认识装备；装备外观仍由 Equipment.gd 负责，
## 两者在 CharacterPlayer 里合并成同一份 part_replace（外观只管 at=0/1/2/3 四个槽）。

const FRAG_DIR := "res://assets/sprite_fragment/"

const PART_HAIR := 0
const PART_FACE := 1
const PART_HAND := 2
const PART_FEET := 3

const START := {0: 0, 1: 1000, 2: 2000, 3: 3000}
const MAX_STYLE := {0: 15, 1: 15, 2: 3, 3: 3}
const MAX_COLOR := {0: 3, 1: 0, 2: 3, 3: 3}

const PART_LABEL := {0: "发型", 1: "脸型", 2: "手部", 3: "脚部"}
const COLOR_LABEL := ["浅", "中", "深", "黝"]
## 缩略图取哪一子帧：沿用 model 300/100 的 frame0 里首次引用该部件时的 sub 号
const PREVIEW_SUB := {0: 0, 1: 0, 2: 3, 3: 0}

## 外观字段 → 部位
##   style/color 是原版图号（4 档预渲染配色）；
##   rgb 是自由调色（0xRRGGBB，-1 = 关闭 → 用原图配色）；mode 见 Recolor.gd。
const FIELDS := {
	0: {"style": "hair_style", "color": "hair_color", "rgb": "hair_rgb", "mode": "full"},
	1: {"style": "face_style", "color": "", "rgb": "face_rgb", "mode": "skin"},
	2: {"style": "hand_style", "color": "hand_color", "rgb": "hand_rgb", "mode": "skin"},
	3: {"style": "feet_style", "color": "feet_color", "rgb": "feet_rgb", "mode": "skin"},
}

## 一键盘配色（只动发型 + 三处皮肤的 rgb，不改档位）。
const COMBOS := [
	["金发雪肤", 0xE8C46A, 0xFBE3D6],
	["银发冷肤", 0xD8E4F2, 0xEEDCDA],
	["酒红麦肤", 0x8E1E3C, 0xDFA87F],
	["暗精灵", 0xEDE9FF, 0xA493C9],
	["兽人", 0x3A2A1A, 0x74A85A],
	["炎魔", 0xFF7A3C, 0xC04A2E],
]


## 默认外观 = model 300/100 里烘焙的那套（hair/face/hand/feet 的 style 都是 1、color 0）。
static func defaults(sex: int) -> Dictionary:
	var out := {
		"hair_style": 1, "hair_color": 0, "hair_rgb": -1,
		"face_style": 1, "face_rgb": -1,
		"hand_style": 1, "hand_color": 0, "hand_rgb": -1,
		"feet_style": 1, "feet_color": 0, "feet_rgb": -1,
	}
	return out


## 图号公式（style 从 1 开始；color 从 0 开始）。
static func part_id(part: int, style: int, color: int, gender: int) -> int:
	if not START.has(part):
		return -1
	if style < 1 or style > int(MAX_STYLE[part]):
		return -1
	if color < 0 or color > int(MAX_COLOR[part]):
		return -1
	return int(START[part]) + (style << 3) - 7 + (gender << 2) + color


static func has_texture(id: int) -> bool:
	return id > 0 and FileAccess.file_exists(FRAG_DIR + str(id) + ".png")


static func exists(part: int, style: int, color: int, gender: int) -> bool:
	return has_texture(part_id(part, style, color, gender))


## 某部位在该性别+色号下的可用 style 列表（图不存在的档位直接跳过）。
static func available_styles(part: int, gender: int, color: int) -> Array:
	var out: Array = []
	for s in range(1, int(MAX_STYLE[part]) + 1):
		if exists(part, s, color, gender):
			out.append(s)
	return out


## 某部位在该性别+style 下的可用色号列表。
static func available_colors(part: int, gender: int, style: int) -> Array:
	var out: Array = []
	for c in range(0, int(MAX_COLOR[part]) + 1):
		if exists(part, style, c, gender):
			out.append(c)
	return out


## 取外观字段（带默认值兜底，避免存档里缺键）。
static func look_value(look: Dictionary, field: String, fallback: int = 0) -> int:
	return int(look.get(field, fallback))


## 解析成 {hair: 图号, face: 图号, hand: 图号, feet: 图号}；不可用的档位回退到 style 1。
static func resolve(look: Dictionary, gender: int) -> Dictionary:
	var out := {}
	for part in [PART_HAIR, PART_FACE, PART_HAND, PART_FEET]:
		var f: Dictionary = FIELDS[part]
		var style := look_value(look, str(f["style"]), 1)
		var color := look_value(look, str(f["color"]), 0) if not str(f["color"]).is_empty() else 0
		var id := part_id(part, style, color, gender)
		if not has_texture(id):
			id = part_id(part, 1, 0, gender)
		out[part] = id
	return out


## 把 model 里 at=0/1/2/3 的槽换成目标图号。
## model_files 传的是该 base model 的 files 数组（如 model 300 = [1005,5,2005,3005,...]）。
static func part_replace(model_files: Array, look: Dictionary, gender: int) -> Dictionary:
	var want := resolve(look, gender)
	var out := {}
	for f in model_files:
		var fid := int(f)
		var at := fid / 1000
		if not want.has(at):
			continue
		var target := int(want[at])
		if target > 0 and target != fid and has_texture(target):
			out[fid] = target
	return out


# ---------------------------------------------------------------- 自由调色（RGB）

## 0xRRGGBB → Color；负数表示「关闭自由调色，用原图配色」。
static func color_from_int(v: int) -> Color:
	if v < 0:
		return Color(0, 0, 0, 0)
	return Color(float((v >> 16) & 0xFF) / 255.0,
		float((v >> 8) & 0xFF) / 255.0,
		float(v & 0xFF) / 255.0, 1.0)


static func color_to_int(c: Color) -> int:
	return (clampi(roundi(c.r * 255.0), 0, 255) << 16) \
		| (clampi(roundi(c.g * 255.0), 0, 255) << 8) \
		| clampi(roundi(c.b * 255.0), 0, 255)


## 某部位的当前自由调色颜色（未启用返回 alpha=0 的 NONE）。
static func look_color(look: Dictionary, part: int) -> Color:
	if not FIELDS.has(part):
		return Color(0, 0, 0, 0)
	return color_from_int(int(look.get(str(FIELDS[part]["rgb"]), -1)))


static func has_free_color(look: Dictionary, part: int) -> bool:
	if not FIELDS.has(part):
		return false
	return int(look.get(str(FIELDS[part]["rgb"]), -1)) >= 0


static func part_mode(part: int) -> String:
	if not FIELDS.has(part):
		return "full"
	return str(FIELDS[part]["mode"])


## 自由调色表 {部件图号: {"color": Color, "mode": "full"/"skin"}}。
## 只包含启用了 RGB 的部位；键是「最终使用」的部件图号（含装备/档位替换后的号）。
static func resolve_tints(look: Dictionary, gender: int) -> Dictionary:
	var parts := resolve(look, gender)
	var out := {}
	for part in [PART_HAIR, PART_FACE, PART_HAND, PART_FEET]:
		if not has_free_color(look, part):
			continue
		out[int(parts[part])] = {
			"color": look_color(look, part),
			"mode": part_mode(part),
		}
	return out


## 外观一次性打包：{replace: 部件替换表, tints: 自由调色表}。
## CharacterPlayer / WorldPlayer / 装备屏预览共用，避免三处各写一遍合并逻辑。
static func apply(model_files: Array, look: Dictionary, gender: int) -> Dictionary:
	return {
		"replace": part_replace(model_files, look, gender),
		"tints": resolve_tints(look, gender),
	}


## 一套预设配色 {hair_rgb, face_rgb, hand_rgb, feet_rgb}（0 号不带名字）。
static func combo_look(idx: int, base: Dictionary) -> Dictionary:
	var out := base.duplicate()
	if idx < 0 or idx >= COMBOS.size():
		return out
	var row: Array = COMBOS[idx]
	out["hair_rgb"] = int(row[1])
	out["face_rgb"] = int(row[2])
	out["hand_rgb"] = int(row[2])
	out["feet_rgb"] = int(row[2])
	return out


## 随机一套（按真实可用档位抽，抽不到就退回默认）。
static func random_look(gender: int) -> Dictionary:
	var look := defaults(gender)
	for part in [PART_HAIR, PART_FACE, PART_HAND, PART_FEET]:
		var f: Dictionary = FIELDS[part]
		var color := 0
		if not str(f["color"]).is_empty():
			var cols := available_colors(part, gender, 1)
			if not cols.is_empty():
				color = int(cols[randi() % cols.size()])
		var styles := available_styles(part, gender, color)
		if styles.is_empty():
			continue
		var style := int(styles[randi() % styles.size()])
		look[str(f["style"])] = style
		if not str(f["color"]).is_empty():
			look[str(f["color"])] = color
	return look


## 界面用的一行摘要。
static func look_text(look: Dictionary) -> String:
	var hs := look_value(look, "hair_style", 1)
	var hc := look_value(look, "hair_color", 0)
	var fs := look_value(look, "face_style", 1)
	var ms := look_value(look, "hand_style", 1)
	var mc := look_value(look, "hand_color", 0)
	var ns := look_value(look, "feet_style", 1)
	var nc := look_value(look, "feet_color", 0)
	return "发型 %s · 脸型 %s · 手 %s · 脚 %s" % [
		_part_text(look, PART_HAIR, hs, hc), _part_text(look, PART_FACE, fs, -1),
		_part_text(look, PART_HAND, ms, mc), _part_text(look, PART_FEET, ns, nc)]


## 单个部位的文字：有自由调色时显示色号，否则显示原版色档。
static func _part_text(look: Dictionary, part: int, style: int, color: int) -> String:
	if has_free_color(look, part):
		return "%d-%s" % [style, color_from_int(int(look[str(FIELDS[part]["rgb"])])).to_html(false)]
	if color >= 0:
		return "%d-%s" % [style, _color_name(color)]
	return str(style)


static func _color_name(c: int) -> String:
	if c >= 0 and c < COLOR_LABEL.size():
		return str(COLOR_LABEL[c])
	return str(c)
