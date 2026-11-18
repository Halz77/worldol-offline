extends RefCounted
## 装备系统规则层（初步版，2026-11-18）。
##
## 范围：基础属性 + 外观。强化 / 鉴定 / 套装 / 绑定 不参与；时装(type 12)按原版位域做「整套部件覆盖」。
## 三件事：
##   1. 部位定义与装备列表：按道具 type 归类（type 是唯一部位字段，见 0004.js:2983）。
##   2. 属性加成：def_str/def_agi/def_mag + powerN/powerValueN → 属性键字典。
##      power 常量取自 analysis/modules/0004.js:2545+，与 Naming.STAT_LABELS 的键对齐。
##   3. 外观：武器用现成 model（基础 model + 武器类型偏移，见 0055.js getSpriteNameIDByWeapon）；
##      防具替换基础 model 的部件图（装备 icon 就是 sprite_fragment 编号，见 0056.js updateIcon）。
##
## 所有函数是 static，不需要实例；不依赖 Autoload，headless 自检可直接调用。

const GameData = preload("res://scripts/GameData.gd")
const SpriteComposer = preload("res://scripts/SpriteComposer.gd")

# ---- 部位 ----------------------------------------------------------------
# type → {slot, label}。slot 是装备字典的键。武器按 type 归到"武器"槽（单手/双手/法器都算）。
const SLOT_DEFS: Array = [
	{"type": 0,  "slot": "head",    "label": "头部"},
	{"type": 1,  "slot": "clothes", "label": "衣服"},
	{"type": 2,  "slot": "trousers","label": "裤子"},
	{"type": 3,  "slot": "shoulder","label": "护肩"},
	{"type": 4,  "slot": "waist",   "label": "腰带"},
	{"type": 5,  "slot": "back",    "label": "背部"},
	{"type": 6,  "slot": "shoes",   "label": "鞋子"},
	{"type": 7,  "slot": "hand",    "label": "护手"},
	{"type": 8,  "slot": "necklace","label": "项链"},
	{"type": 9,  "slot": "ring",    "label": "戒指"},
	{"type": 10, "slot": "amulet",  "label": "护符"},
	{"type": 11, "slot": "transport","label": "坐骑"},
	{"type": 12, "slot": "fashion", "label": "时装"},
	{"type": 13, "slot": "weapon",  "label": "武器"},
]
const WEAPON_TYPES: Array = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 34, 35, 36, 37, 38, 39]

# power id → 属性键（Naming.STAT_LABELS 里的键）。只映射基础属性能表达的，
# 鉴定 121 / 百分比类 / 技能类 / 宠物类不列出（本阶段不追求，避免误解）。
const POWER_TO_STAT: Dictionary = {
	11: "HPMAX", 13: "MPMAX",
	53: "SPEED", 54: "HIT_RATE", 55: "DODGE", 56: "HIT_MAGIC", 57: "CRITICAL",
	58: "ATK_STR", 59: "ATK_AGI", 60: "ATK_MAGIC",
	61: "DEF_STR", 62: "DEF_AGI", 63: "DEF_MAGIC",
	64: "WIL", 65: "TOUGH", 67: "BLOCK", 68: "INSIGHT",
	71: "BACK", 72: "MAGIC_BACK", 73: "LIFE_ABSORPTION", 74: "MANA_ABSORPTION",
	75: "MAGIC_PENETRATION", 76: "FORCE_HIT", 77: "HEAL_RECOVERY", 78: "MANA_RECOVERY",
	203: "CRITICAL_DAMAGE",
}

# 防具槽位：装备 type → {男款基础部件, 女款基础部件}。
# ★ 槽位归属由原版 at=floor(部件id/1000) 与 PNG_* 常量决定（0055.js:407）：
#   PNG_CLOTHES=6→6001/6005，PNG_TROUSERS=7→7001/7005，PNG_SHOULDER=4→4001/4013。
#   ★ 头盔 PNG_HELMET=10→基础部件是 **10021**（at=10，羽毛头饰），
#     绝不是 11001（at=11=PNG_EQUIP_OTHER，那是灰色脚底阴影 25x14！）,
#     之前错换成 11001 才导致头盔掉到脚底。
# ★ doChangeSpriteIcon 用 ((ot-1)>>2 & 1) 判断槽位性别，只替换同性别的槽。
const ARMOR_SLOT: Dictionary = {
	1: {"male": 6001, "female": 6005},   # 衣 START_CLOTHES=6000
	2: {"male": 7001, "female": 7005},   # 裤 START_TROUSERS=7000
	3: {"male": 4001, "female": 4013},   # 肩 START_SHOULDER=4000
}
const HELMET_SLOT: Dictionary = {"male": 10021, "female": 10021}   # ★ at=10 头饰槽

const PART_STEP8: Dictionary = {1: 6000, 2: 7000, 3: 4000}   # type → START（8 步长：4 男 + 4 女）

# ---- 背部 / 坐骑（0055.js / 0056.js / 0012.js）----------------------------
# ★ 这两类在原版里不是「换某个部件图」，而是换整幅 model：
#   背部 = 独立 cloak 精灵，model = SPR_INDEX_CLOAK_START(1100) + backStyle，叠在角色图层后面；
#   坐骑 = 「人 + 坐骑 + 武器」整幅 model，model = 2000 + 100*(style-1) [+26000] [+50 女] + 武器偏移。
#   把它们硬贴成 add_parts 会错位（背 5001 是 9 块碎片、坐骑 14017 是含骑手的整图集）。
const START_CLOTHES := 6000
const START_BACK := 5000
const START_TRANSPORT := 14000
const SPR_INDEX_CLOAK_START := 1100
const SPR_INDEX_WEAPON_HOUSE_START := 2000
const SPR_INDEX_WEAPON_HOUSE_END := 4000
const SPR_INDEX_WEAPON_HOUSE_ADD_DIS := 26000
const SPR_INDEX_MAN_HOUSE_WORLD_START := 700
const SPR_INDEX_WOMAN_HOUSE_WORLD_START := 900
## 0055.js isTwoPeopleStyle：11 / 54 是双人坐骑，固定用 700+style / 900+style。
const TWO_PEOPLE_TRANSPORT: Array = [11, 54]
## 0055.js transportStyleNotBack：这几个坐骑把披风藏起来。
const TRANSPORT_NO_BACK: Array = [36, 42, 43, 48]


static func slot_defs() -> Array:
	return SLOT_DEFS


static func slot_of_type(type: int) -> String:
	for d in SLOT_DEFS:
		if int(d.type) == type:
			return str(d.slot)
	if WEAPON_TYPES.has(type):
		return "weapon"
	return ""


static func label_of_slot(slot: String) -> String:
	for d in SLOT_DEFS:
		if str(d.slot) == slot:
			return str(d.label)
	return ""


## 该部位的装备 id 列表（按 id 排序）。默认上限 200，避免一次填几千项。
## ★ 腰带/鞋/护手/项链/戒指/护符在原版数据里 icon 全是 0（不改外观），
##   不能再用 icon>0 过滤，否则这些槽位一件都列不出来。
static func items_for_slot(game_data, slot: String, limit: int = 200) -> Array:
	var wanted_types: Array = []
	for d in SLOT_DEFS:
		if str(d.slot) == slot:
			wanted_types.append(int(d.type))
	if slot == "weapon":
		wanted_types = WEAPON_TYPES.duplicate()
	var out: Array = []
	for id in game_data.ids("items"):
		var entries = game_data.get_entry("items", id)
		if entries.is_empty():
			continue
		var it = entries[0]
		if not (it is Dictionary):
			continue
		if wanted_types.has(int(it.get("type", -1))):
			out.append(int(id))
	out.sort()
	if out.size() > limit:
		return out.slice(0, limit)
	return out


static func item_data(game_data, item_id: int) -> Dictionary:
	var entries = game_data.get_entry("items", item_id)
	if entries.is_empty() or not (entries[0] is Dictionary):
		return {}
	return entries[0]


static func item_name(game_data, item_id: int) -> String:
	var d := item_data(game_data, item_id)
	if not d.is_empty():
		return str(d.get("name", ""))
	return game_data.name_of("items", item_id)


## 单件装备的属性加成 → {属性键: 数值}。强化/鉴定字段不参与。
static func stats_of_item(item: Dictionary) -> Dictionary:
	var out: Dictionary = {}
	# 三防是固定字段（注意：def_str/agi/mag 在道具表里是装备提供的防御数值，不是需求）.
	var def_key_map: Dictionary = {
		"def_str": "DEF_STR", "def_agi": "DEF_AGI", "def_mag": "DEF_MAGIC"
	}
	for key in ["def_str", "def_agi", "def_mag"]:
		var v := int(item.get(key, 0))
		if v != 0:
			var stat_key: String = str(def_key_map[key])
			out[stat_key] = int(out.get(stat_key, 0)) + v
	# powerN / powerValueN：power id 查表，值累加。
	for i in range(1, 4):
		var pid := int(item.get("power%d" % i, 0))
		var pval := int(item.get("powerValue%d" % i, 0))
		if pid == 0 or pval == 0:
			continue
		if POWER_TO_STAT.has(pid):
			var key := str(POWER_TO_STAT[pid])
			out[key] = int(out.get(key, 0)) + pval
	return out


## 汇总一身装备的属性加成 → {属性键: 合计}。equipped: {slot:item_id}
static func aggregate_stats(game_data, equipped: Dictionary) -> Dictionary:
	var out: Dictionary = {}
	for slot in equipped.keys():
		var item := item_data(game_data, int(equipped[slot]))
		var part := stats_of_item(item)
		for key in part.keys():
			out[key] = int(out.get(key, 0)) + int(part[key])
	return out


## 性别位：男=0 女=1（0004.js SEX_MALE=0/SEX_FEMALE=1）。从基础 model 推断：100/200 男，300/400 女。
static func gender_of_model(base_model: int) -> int:
	return 1 if base_model >= 300 else 0


## 装备 icon → 实际部件图号（忠实移植 0056.js updateIcon 解码 + 0055.js doChangeSpriteIcon 编码）。
## 装备表里的 icon 是"男款"编码；衣/裤/肩每 style 占 8 号（4 男 + 4 女），
## 女角色必须 +4 换女款图（尺寸往往不同，如裤 7089 19x20 → 7093 19x16）。
## 头盔每 style 占 4 号、无性别位，直接返回 icon 本身。
## 返回 -1 表示该 icon 不属于这个部位（不该替换）。
static func part_fragment_id(icon: int, type: int, gender: int) -> int:
	if icon <= 0:
		return -1
	if type == 0:  # 头盔：START_HELMET=10000，4 步长，无性别位
		var t := icon - 10000
		if t <= 0 or icon >= 11000:
			return -1
		var style := 1 + (t - 1) / 4
		var color := (t - 1) % 4
		return 10000 + (style << 2) - 3 + color
	if WEAPON_TYPES.has(type):  # 武器：0055.js getWeaponIcon = START_WEAPON + style*4 - 3 + color
		return weapon_fragment_id(icon)
	if PART_STEP8.has(type):  # 衣/裤/肩：8 步长，4 男 + 4 女
		var start := int(PART_STEP8[type])
		var t2 := icon - start
		if t2 <= 0 or icon >= start + 1000:
			return -1
		var style2 := 1 + (t2 - 1) / 8
		var color2 := (t2 - 1) % 8
		# 原版公式：START + (style<<3) - 7 + (gender<<2) + color
		return start + (style2 << 3) - 7 + (gender << 2) + color2
	return -1


## 武器 icon → 武器部件图号。
## ★ 0056.js:3574 解码用 /4：style=1+((icon-8000-1)/4)，color=(icon-8000-1)%4；
##   0055.js:793 getWeaponIcon 编码用 *4：8000+style*4-3+color。
##   两者互逆 ⇒ 结果就是 icon 本身（>30000 的 ADD1 段同理也是 icon 本身）。
##   上一版误用 /8 解码，把法杖 8397 算成 8201（刀区间）、轻弩 8517 算成不存在的 8261，
##   导致"法杖变刀、所有弩同一套图"。直接返回 icon 即可。
static func weapon_fragment_id(icon: int) -> int:
	if icon <= 0:
		return -1
	return icon


## 判断一张部件图是单帧还是多帧图集（决定替换后是否会被画两次）。
## ★ 色号变体自己没有 .json，帧表在同组组首上，统一交给 SpriteComposer 解析；
##   之前只看自己的 json 会把 4084/4136 这类图集误判成单帧。
static func is_multi_frame(frag_id: int) -> bool:
	return SpriteComposer.is_multi_frame_fragment(frag_id)


## 基础姿势 model：100/200/300/400。传进来的可能是「已带武器姿势」的 313/321 等，
## 先归一化再加偏移，避免重复相加（原版 getSpriteNameIDByWeapon 也是从裸基础 model 起算）。
static func bare_model(base_model: int) -> int:
	if base_model >= 100 and base_model < 200:
		return 100
	if base_model >= 200 and base_model < 300:
		return 200
	if base_model >= 300 and base_model < 400:
		return 300
	if base_model >= 400 and base_model < 500:
		return 400
	return base_model


## 世界图（100/300）才会显示坐骑；战斗图（200/400）原版不骑马（getSpriteIdByIcon 的 0==n 分支）。
static func is_world_model(base_model: int) -> bool:
	return (base_model >= 100 and base_model < 200) or (base_model >= 300 and base_model < 400)


static func model_exists(model_id: int) -> bool:
	if model_id <= 0:
		return false
	return FileAccess.file_exists("res://assets/sprite_model/%d.json" % model_id)


## 武器 item.type → 世界图姿势偏移（0055.js getSpriteNameIDByWeapon）。
## 0 / 重武(17) / 空手(24) 保持基础姿势；枪 35→24、双手枪 36→73、单手锤 37→44、
## 双手锤 38→36、扇 39→37；其余（刀/双手剑/刃/杖/枪矛/弩/弓/法器…）偏移 = type 本身。
static func weapon_pose_offset(type: int) -> int:
	match type:
		0, 17, 24:
			return 0
		35:
			return 24
		36:
			return 73
		37:
			return 44
		38:
			return 36
		39:
			return 37
		_:
			return type


## 武器 item.type → 骑马 model 偏移（0055.js getHorseSpriteNameIDByWeapon）。
## 和世界图不同：单手枪 35→42、双手枪 36→43、单手锤 37→24；重武/空手返回 -1（用无武器坐骑姿势）。
static func horse_pose_offset(type: int) -> int:
	match type:
		0, 17, 24:
			return -1
		35:
			return 42
		36:
			return 43
		37:
			return 24
		38:
			return 36
		39:
			return 37
		_:
			return type


static func house_model_id(transport_style: int, gender: int) -> int:
	if transport_style <= 0:
		return 0
	var start := SPR_INDEX_WOMAN_HOUSE_WORLD_START if gender == 1 else SPR_INDEX_MAN_HOUSE_WORLD_START
	return start + transport_style


## 坐骑 model：style 1..N。双人坐骑 / 无武器 → 700+style（901+style 女）；
## 其余 → 2000+100*(style-1)，≥4000 加 26000，女 +50，再加武器偏移。
static func mount_model_id(base_model: int, transport_style: int, wtype: int, gender: int) -> int:
	if transport_style <= 0:
		return 0
	var house := house_model_id(transport_style, gender)
	if TWO_PEOPLE_TRANSPORT.has(transport_style):
		return house
	var off := horse_pose_offset(wtype)
	if off < 0:
		return house
	var mid := SPR_INDEX_WEAPON_HOUSE_START + 100 * (transport_style - 1)
	if mid >= SPR_INDEX_WEAPON_HOUSE_END:
		mid += SPR_INDEX_WEAPON_HOUSE_ADD_DIS
	if gender == 1:
		mid += 50
	return mid + off


## icon 位域解码：START + (style-1)*step + color  ⇒  style = 1 + (t-1)/step。
static func style_from_icon(icon: int, start: int, step: int) -> int:
	if icon <= start or step <= 0:
		return 0
	var t := icon - start
	return 1 + (t - 1) / step


static func back_style_of_item(item: Dictionary) -> int:
	return style_from_icon(int(item.get("icon", 0)), START_BACK, 4)


static func transport_style_of_item(item: Dictionary) -> int:
	return style_from_icon(int(item.get("icon", 0)), START_TRANSPORT, 4)


## 坐骑色号（0..3）。0055.js doChangeSpriteIcon 的 PNG_TRANSPORT 分支：
##   nt = ot - ((ot-1)&3) + Z   —— 模型里的坐骑图号先归到同款 4 色组首，再加色号。
## 色号就藏在 icon 低两位：icon 14025..14028 → 0..3（飞龙/极地白龙/蓝幼龙/幼龙 同 style 不同色）。
static func transport_color_of_item(item: Dictionary) -> int:
	var icon := int(item.get("icon", 0))
	if icon <= START_TRANSPORT:
		return 0
	return (icon - START_TRANSPORT - 1) % 4


static func clothes_style_of_item(item: Dictionary) -> int:
	return style_from_icon(int(item.get("icon", 0)), START_CLOTHES, 8)


## 背部 cloak model：1100 + backStyle。原版隐藏规则：
##   backStyle 31 → 不显示；坐骑 style 36/42/43/48 → 不显示；
##   衣服 style 51 时强制用 cloak 32（changeBackStyle，现有道具里没有 style 51，保留规则）。
## 返回 0 = 不画披风。
static func cloak_model_for(back_style: int, clothes_style: int, transport_style: int) -> int:
	if back_style <= 0 or back_style == 31:
		return 0
	if TRANSPORT_NO_BACK.has(transport_style):
		return 0
	var st := back_style
	if clothes_style == 51:
		st = 32
	return SPR_INDEX_CLOAK_START + st


# ---- 时装（type 12）--------------------------------------------------------
# 原版 0056.js `updateIconByFashion()`：时装不带外观 icon，而是带一套
# `fashIcon1/2/3` 位域（另一套角色 icon）。它会把这些位覆盖到角色 icon 上，
# 再走 `doChangeSpriteIcon` 换部件图 —— 所以时装本质是**同时换掉一身部件图**，
# 不换 model。也正因为它不写 transport 位，穿时装不会顶掉坐骑（用户要求）。
# 位域常量见 0012.js ModelConst（OFFSET_*/LEN_*）。
const OFFSET_HAIR_STYLE := 7
const LEN_HAIR_STYLE := 4
const OFFSET_HAIR_COLOR := 11
const LEN_HAIR_COLOR := 2
const OFFSET_HAIR_ADD := 0
const LEN_HAIR_ADD := 3
const OFFSET_FACE_STYLE := 13
const LEN_FACE_STYLE := 4
const OFFSET_FACE_ADD := 3
const LEN_FACE_ADD := 1
const OFFSET_HAND_STYLE := 17
const LEN_HAND_STYLE := 2
const OFFSET_HAND_COLOR := 19
const LEN_HAND_COLOR := 2
const OFFSET_HAND_ADD := 4
const LEN_HAND_ADD := 4
const OFFSET_FEET_STYLE := 21
const LEN_FEET_STYLE := 2
const OFFSET_FEET_COLOR := 23
const LEN_FEET_COLOR := 2
const OFFSET_FEET_ADD := 8
const LEN_FEET_ADD := 4
const OFFSET_HELMET_STYLE := 25
const LEN_HELMET_STYLE := 5
const OFFSET_HELMET_COLOR := 30
const LEN_HELMET_COLOR := 2
const OFFSET_HELMET_ADD := 12
const LEN_HELMET_ADD := 2
const OFFSET_SHOULDER_STYLE := 0
const LEN_SHOULDER_STYLE := 4
const OFFSET_SHOULDER_COLOR := 4
const LEN_SHOULDER_COLOR := 2
const OFFSET_SHOULDER_ADD := 31
const LEN_SHOULDER_ADD := 1
const OFFSET_SHOULDER_ADD_2 := 4
const LEN_SHOULDER_ADD_2 := 2
const OFFSET_CLOTHES_STYLE := 6
const LEN_CLOTHES_STYLE := 6
const OFFSET_CLOTHES_COLOR := 12
const LEN_CLOTHES_COLOR := 2
const OFFSET_CLOTHES_ADD := 2
const LEN_CLOTHES_ADD := 1
const OFFSET_TROUSERS_STYLE := 14
const LEN_TROUSERS_STYLE := 6
const OFFSET_TROUSERS_COLOR := 20
const LEN_TROUSERS_COLOR := 2
const OFFSET_TROUSERS_ADD := 3
const LEN_TROUSERS_ADD := 1
const OFFSET_BACK_STYLE := 0
const LEN_BACK_STYLE := 4
const OFFSET_BACK_COLOR := 4
const LEN_BACK_COLOR := 2
const OFFSET_BACK_ADD := 28
const LEN_BACK_ADD := 1
const OFFSET_BACK_ADD_2 := 0
const LEN_BACK_ADD_2 := 2


static func _fash_bits(value: int, off: int, len: int) -> int:
	return (value >> off) & ((1 << len) - 1)


## 取 64 位 fashIcon 的低/高 32 位（原版是 (low, high) 两个 number）。
static func _fash_halves(value: int) -> Array:
	return [value & 0xFFFFFFFF, (value >> 32) & 0xFFFFFFFF]


## 解出时装的全部 style/color 变量。★ 关键：0055.js doChangeSpriteIcon 在
## `et = icon3.low >> OFFSET_FASH_ADD & 1`（穿上时装必置 1）时，会按衣服 style
## 走一段 switch，强制改手/脚/头/肩/背的 style（0055.js:265-460）。
## 开拓者/电玩英雄等大号 style 全靠这段才有正确外观，不能只按位域直接换图。
static func _fash_styles(item: Dictionary, gender: int) -> Dictionary:
	var i1 := _fash_halves(int(item.get("fashIcon1", 0)))
	var i2 := _fash_halves(int(item.get("fashIcon2", 0)))
	var i3 := _fash_halves(int(item.get("fashIcon3", 0)))
	var l1: int = i1[0]
	var h1: int = i1[1]
	var l2: int = i2[0]
	var h2: int = i2[1]
	var l3: int = i3[0]
	var h3: int = i3[1]

	var hair := _fash_bits(l1, OFFSET_HAIR_STYLE, LEN_HAIR_STYLE) + \
		(_fash_bits(h1, OFFSET_HAIR_ADD, LEN_HAIR_ADD) << 4)
	var hair_c := _fash_bits(l1, OFFSET_HAIR_COLOR, LEN_HAIR_COLOR)
	var face := _fash_bits(l1, OFFSET_FACE_STYLE, LEN_FACE_STYLE) + \
		(_fash_bits(h1, OFFSET_FACE_ADD, LEN_FACE_ADD) << 4)
	var hand := _fash_bits(l1, OFFSET_HAND_STYLE, LEN_HAND_STYLE) + \
		(_fash_bits(h1, OFFSET_HAND_ADD, LEN_HAND_ADD) << 2)
	var hand_c := _fash_bits(l1, OFFSET_HAND_COLOR, LEN_HAND_COLOR)
	var feet := _fash_bits(l1, OFFSET_FEET_STYLE, LEN_FEET_STYLE) + \
		(_fash_bits(h1, OFFSET_FEET_ADD, LEN_FEET_ADD) << 2)
	var feet_c := _fash_bits(l1, OFFSET_FEET_COLOR, LEN_FEET_COLOR)
	var helm := _fash_bits(l1, OFFSET_HELMET_STYLE, LEN_HELMET_STYLE) + \
		(_fash_bits(h1, OFFSET_HELMET_ADD, LEN_HELMET_ADD) << 5)
	var helm_c := _fash_bits(l1, OFFSET_HELMET_COLOR, LEN_HELMET_COLOR)
	var shoulder := _fash_bits(l2, OFFSET_SHOULDER_STYLE, LEN_SHOULDER_STYLE) + \
		(_fash_bits(l2, OFFSET_SHOULDER_ADD, LEN_SHOULDER_ADD) << 4) + \
		(_fash_bits(h2, OFFSET_SHOULDER_ADD_2, LEN_SHOULDER_ADD_2) << 5)
	var shoulder_c := _fash_bits(l2, OFFSET_SHOULDER_COLOR, LEN_SHOULDER_COLOR)
	var clothes := _fash_bits(l3, OFFSET_CLOTHES_STYLE, LEN_CLOTHES_STYLE) + \
		(_fash_bits(h3, OFFSET_CLOTHES_ADD, LEN_CLOTHES_ADD) << 6)
	var clothes_c := _fash_bits(l3, OFFSET_CLOTHES_COLOR, LEN_CLOTHES_COLOR)
	var trousers := _fash_bits(l3, OFFSET_TROUSERS_STYLE, LEN_TROUSERS_STYLE) + \
		(_fash_bits(h3, OFFSET_TROUSERS_ADD, LEN_TROUSERS_ADD) << 6)
	var trousers_c := _fash_bits(l3, OFFSET_TROUSERS_COLOR, LEN_TROUSERS_COLOR)
	# 披风 style = low[0..3] + BACK_ADD(bit28)<<4 + BACK_ADD_2(high[0..1])<<5
	var back := _fash_bits(l3, OFFSET_BACK_STYLE, LEN_BACK_STYLE) + \
		(_fash_bits(l3, OFFSET_BACK_ADD, LEN_BACK_ADD) << 4) + \
		(_fash_bits(h3, OFFSET_BACK_ADD_2, LEN_BACK_ADD_2) << 5)

	# 0055.js:229 —— 手 style=3 时脚强制 4（switch 之前）
	if hand == 3:
		feet = 4

	# 0055.js:267-460 —— 时装标志置位后的「按衣服 style 强制整套配件」规则
	if clothes == 23 or clothes == 24:
		hand = 4
		feet = 5
	elif clothes == 26:
		shoulder_c = clothes_c
		hand = 5
		hand_c = clothes_c
		feet = 6
		feet_c = clothes_c
	match clothes:
		29, 30:
			helm = 43 if clothes == 29 else 32
			helm_c = clothes_c
			if gender == 1:
				feet = 5
		31, 32, 33, 34, 35, 36, 37, 38, 39, 40:
			# 原版 0055.js: case 39 → L=41 / x=40（L = F+2，不是 F+14）
			helm = clothes + 2
			helm_c = clothes_c
			shoulder = clothes + 1
			shoulder_c = clothes_c
			if gender == 1:
				feet = 5
		41:
			shoulder = 42
			shoulder_c = clothes_c
			face = 16 + clothes_c
			hand = 6
			hand_c = clothes_c
			feet = 7
			feet_c = clothes_c
		42:
			shoulder = 43
			shoulder_c = clothes_c
			face = 20 + clothes_c
			hand = 6
			hand_c = clothes_c
			feet = 7
			feet_c = clothes_c
		43:
			shoulder = 44
			shoulder_c = clothes_c
			face = 24 + clothes_c
			hand = 7
			hand_c = clothes_c
			feet = 8
			feet_c = clothes_c
		44:
			shoulder = 45
			shoulder_c = clothes_c
			face = 27 + clothes_c
			hand = 8
			hand_c = clothes_c
			feet = 9
			feet_c = clothes_c
		45:
			helm = 45 if gender == 1 else 44
			helm_c = clothes_c
			shoulder = 46
			shoulder_c = clothes_c
			hand = 9
			hand_c = clothes_c
			feet = 10
			feet_c = clothes_c
		46:
			helm = 46
			helm_c = clothes_c
			shoulder = 47
			shoulder_c = clothes_c
			hand = 10
			hand_c = clothes_c
			feet = 11
			feet_c = clothes_c
		47:
			helm = 48 if gender == 1 else 47
			helm_c = clothes_c
			shoulder = 31
			shoulder_c = clothes_c
			hand = 11
			hand_c = clothes_c
			feet = 12
			feet_c = clothes_c
		48:
			helm = 49
			helm_c = clothes_c
			shoulder = 48
			shoulder_c = clothes_c
			hand = 12
			hand_c = clothes_c
			feet = 8
			feet_c = clothes_c
		49:
			helm = 51 if gender == 1 else 50
			helm_c = clothes_c
			shoulder = 49
			shoulder_c = clothes_c
			hand = 13
			hand_c = clothes_c
			feet = 14
			feet_c = clothes_c
		50:
			helm = 52
			helm_c = clothes_c
			shoulder = 50
			shoulder_c = clothes_c
			hand = 14
			hand_c = clothes_c
			feet = 13
			feet_c = clothes_c
		51:
			back = 32

	return {"hair": hair, "hair_c": hair_c, "face": face,
		"hand": hand, "hand_c": hand_c, "feet": feet, "feet_c": feet_c,
		"helm": helm, "helm_c": helm_c,
		"shoulder": shoulder, "shoulder_c": shoulder_c,
		"clothes": clothes, "clothes_c": clothes_c, "trousers": trousers,
		"trousers_c": trousers_c, "back": back}


## 时装 → {at: 图号}。at 与模型 files 的 floor(id/1000) 对应：
##   0 头发 / 1 脸 / 2 手 / 3 脚 / 4 肩 / 6 衣服 / 7 裤 / 10 头盔。
static func fashion_parts(item: Dictionary, gender: int) -> Dictionary:
	var s := _fash_styles(item, gender)
	var gender_off := gender << 2
	var out: Dictionary = {}
	if int(s.hair) > 0:
		out[0] = (int(s.hair) << 3) - 7 + gender_off + int(s.hair_c)
	if int(s.face) > 0:
		out[1] = 1000 + (int(s.face) << 3) - 7 + gender_off
	if int(s.hand) > 0:
		out[2] = 2000 + (int(s.hand) << 3) - 7 + gender_off + int(s.hand_c)
	if int(s.feet) > 0:
		out[3] = 3000 + (int(s.feet) << 3) - 7 + gender_off + int(s.feet_c)
	if int(s.shoulder) > 0:
		out[4] = 4000 + (int(s.shoulder) << 3) - 7 + gender_off + int(s.shoulder_c)
	if int(s.clothes) > 0:
		out[6] = 6000 + (int(s.clothes) << 3) - 7 + gender_off + int(s.clothes_c)
	if int(s.trousers) > 0:
		out[7] = 7000 + (int(s.trousers) << 3) - 7 + gender_off + int(s.trousers_c)
	if int(s.helm) > 0:
		out[10] = 10000 + (int(s.helm) << 2) - 3 + int(s.helm_c)
	return out


## 时装的披风 style（含 switch(F) 的 51→32 规则与 add 位）。
static func fashion_back_style(item: Dictionary) -> int:
	return int(_fash_styles(item, 0).back)


## 计算外观：返回 {model_id, part_replace:{基础部件id:图号}, single_use, add_parts, cloak_model, detail}
## base_model: 当前性别/姿势的基础 model（100/200/300/400，可带武器姿势）。sex 可显式传入（女=1）。
static func appearance(game_data, base_model: int, equipped: Dictionary, sex: int = -1) -> Dictionary:
	var gender := gender_of_model(base_model) if sex < 0 else sex
	var detail: Array = []
	var single_use: Array = []   # 替换成单帧图的槽位：多 layer 引用只画第一次，避免重复
	var add_parts: Array = []    # 追加图层（保留能力；背/坐骑已改为换整 model，不再走这里）
	var result := {"model_id": base_model, "part_replace": {}, "single_use": single_use,
		"add_parts": add_parts, "cloak_model": 0, "detail": detail}
	var final_model := base_model

	# ---- 1. 先定 model：坐骑整幅替换，否则 基础姿势 + 武器姿势偏移 ----
	var base_pose := bare_model(base_model)
	var wtype := 0
	if equipped.has("weapon"):
		wtype = int(item_data(game_data, int(equipped["weapon"])).get("type", 0))
	var transport_style := 0
	var transport_color := 0
	if equipped.has("transport"):
		var t_item := item_data(game_data, int(equipped["transport"]))
		transport_style = transport_style_of_item(t_item)
		transport_color = transport_color_of_item(t_item)
	# 时装：整套部件覆盖 + 可选披风。原版不写 transport 位，所以不会顶掉坐骑。
	var fash_parts: Dictionary = {}
	var fash_back := 0
	if equipped.has("fashion"):
		var f_item := item_data(game_data, int(equipped["fashion"]))
		fash_parts = fashion_parts(f_item, gender)
		fash_back = fashion_back_style(f_item)

	var mount_used := false
	if transport_style > 0:
		if is_world_model(base_model):
			var mount_id := mount_model_id(base_pose, transport_style, wtype, gender)
			if model_exists(mount_id):
				final_model = mount_id
				mount_used = true
				detail.append("坐骑→Model %d(style %d)" % [mount_id, transport_style])
			else:
				var house_id := house_model_id(transport_style, gender)
				if house_id != mount_id and model_exists(house_id):
					final_model = house_id
					mount_used = true
					detail.append("坐骑→Model %d(style %d, 无武器姿势)" % [house_id, transport_style])
				else:
					detail.append("坐骑:缺 Model %d(style %d)，保持基础造型" % [mount_id, transport_style])
		else:
			detail.append("坐骑:战斗造型不显示")
	if not mount_used:
		var pose := base_pose + weapon_pose_offset(wtype)
		if model_exists(pose):
			final_model = pose
			if wtype > 0:
				detail.append("武器→Model %d" % pose)
	# 读最终 model 的 files，找 at==8(武器)/at==10(头饰)/at==4(肩) 的实际部件 id
	var model_json = JSON.parse_string(FileAccess.get_file_as_string(
		"res://assets/sprite_model/%d.json" % final_model))
	var model_files: Array = []
	var model_file_ints: Array = []   # int 化，JSON 解析出的整数是 float，直接用 has(int) 匹配不上
	var weapon_part := 0
	if model_json is Dictionary:
		model_files = model_json.get("files", [])
	for f in model_files:
		var fid := int(f)
		model_file_ints.append(fid)
		if fid / 1000 == 8 and weapon_part == 0:
			weapon_part = fid
	result.model_id = final_model

	# ---- 武器部件替换（用装备 icon 算具体武器图）----
	if equipped.has("weapon") and weapon_part > 0:
		var w = item_data(game_data, int(equipped["weapon"]))
		var wicon := int(w.get("icon", 0))
		var wfrag := weapon_fragment_id(wicon)
		if wfrag > 0 and FileAccess.file_exists("res://assets/sprite_fragment/%d.png" % wfrag):
			result.part_replace[weapon_part] = wfrag
			detail.append("武器图:%d→%d" % [weapon_part, wfrag])
	elif weapon_part > 0:
		# 空手：原版 doChangeSpriteIcon 把 PNG_WEAPON 层置 null（没装备武器就不画）。
		# 坐骑的无武器 model（743/943 等）其实和带武器款共用同一份 json，必须运行时去掉这层。
		result.part_replace[weapon_part] = -1
		detail.append("空手:隐藏武器层 %d" % weapon_part)

	# ---- 坐骑颜色：模型里的坐骑图号按 icon 色号换同款 4 色组（PNG_TRANSPORT 分支）----
	if transport_style > 0:
		for fid in model_file_ints:
			if fid / 1000 != 14:
				continue
			var base_col: int = fid - ((fid - 1) % 4)
			var wanted: int = base_col + transport_color
			if wanted != fid and FileAccess.file_exists(
					"res://assets/sprite_fragment/%d.png" % wanted):
				result.part_replace[fid] = wanted
				detail.append("坐骑色:%d→%d(色 %d)" % [fid, wanted, transport_color])

	# ---- 防具：按性别换算图号，替换当前 model 对应的槽位 ----
	for d in SLOT_DEFS:
		var slot := str(d.slot)
		var type := int(d.type)
		if not equipped.has(slot):
			continue
		var it = item_data(game_data, int(equipped[slot]))
		var icon := int(it.get("icon", 0))
		var slot_pair: Dictionary = {}
		if type == 0:
			slot_pair = HELMET_SLOT
		elif ARMOR_SLOT.has(type):
			slot_pair = ARMOR_SLOT[type]
		else:
			continue   # 背(type5)/坐骑(type11) 单独处理
		var frag := part_fragment_id(icon, type, gender)
		if frag < 0:
			continue
		if not FileAccess.file_exists("res://assets/sprite_fragment/%d.png" % frag):
			frag = icon
			if not FileAccess.file_exists("res://assets/sprite_fragment/%d.png" % frag):
				continue
		var base_part := int(slot_pair.get("female" if gender == 1 else "male", 0))
		if base_part <= 0:
			continue
		# base_part 必须真的在 model files 里，否则替换无效
		if not model_file_ints.has(base_part):
			continue
		result.part_replace[base_part] = frag
		# ★ 真·单帧整图（组内无帧表）替换多帧槽位：会被画多次 → 标记 single_use 去重
		if type == 3 and not is_multi_frame(frag):
			single_use.append(base_part)
		var note := "%s:%d→%d" % [str(d.label), base_part, frag]
		detail.append(note)
		if OS.has_environment("WORLDOL_EQUIP_DEBUG"):
			print("[equip-debug] %s item=%d icon=%d gender=%d → %s" % [
				str(d.label), int(equipped[slot]), icon, gender, note])

	# ---- 时装：一套部件图整体覆盖（原版 updateIconByFashion 在装备之后覆盖）----
	# 只替换当前 model 里实际存在的同 at 图层，所以「时装 + 坐骑」时坐骑整幅
	# model 里的身体部件也会一起换，坐骑本体不受影响。
	var fash_applied := false
	if not fash_parts.is_empty():
		for at in fash_parts.keys():
			var want := int(fash_parts[at])
			if want <= 0 or not FileAccess.file_exists(
					"res://assets/sprite_fragment/%d.png" % want):
				continue
			var hit := 0
			for fid in model_file_ints:
				if fid / 1000 == int(at) and fid != want:
					result.part_replace[fid] = want
					# 只有护肩（at=4，左右两片）需要单帧去重；其它部位套用
					# 「单帧大图缩到 34px」的兜底会把头盔/衣服压扁（勇气使徒 10213 就是这样坏的）。
					if int(at) == 4 and not is_multi_frame(want) and not single_use.has(fid):
						single_use.append(fid)
					hit += 1
			if hit > 0:
				fash_applied = true
				detail.append("时装:at%d→%d" % [int(at), want])

	# 时装生效时隐藏基础头发：模型里「脸层先画、头发层后画」，头发会盖在
	# 时装头盔/整颗脸上（电玩英雄、勇气使徒最明显）。98 件时装都带头盔 style，
	# 但「整个身体被翅膀替掉」的坐骑 model 没有衣服槽 → fash_applied=false，
	# 不会误伤坐骑上的小人。
	if fash_applied:
		for fid in model_file_ints:
			if fid / 1000 == 0 and fid > 0:
				result.part_replace[fid] = -1
				detail.append("时装:隐藏基础头发 %d" % fid)
				break

	# ---- 背部：独立 cloak model（1100+backStyle），SpriteComposer 把它画在角色图层后面 ----
	if equipped.has("back"):
		var bstyle := back_style_of_item(item_data(game_data, int(equipped["back"])))
		var cstyle := 0
		if equipped.has("clothes"):
			cstyle = clothes_style_of_item(item_data(game_data, int(equipped["clothes"])))
		var cloak_id := cloak_model_for(bstyle, cstyle, transport_style)
		if cloak_id > 0 and model_exists(cloak_id):
			result.cloak_model = cloak_id
			detail.append("背部→Cloak %d(style %d)" % [cloak_id, bstyle])
		elif bstyle <= 0:
			detail.append("背部:图标无外观编码")
		elif bstyle == 31:
			detail.append("背部:style 31 原版不显示")
		elif TRANSPORT_NO_BACK.has(transport_style):
			detail.append("背部:坐骑 style %d 不显示披风" % transport_style)
		else:
			detail.append("背部:缺 Cloak Model %d" % cloak_id)
		if OS.has_environment("WORLDOL_EQUIP_DEBUG"):
			print("[equip-debug] 背部 style=%d clothes=%d transport=%d → cloak=%d" % [
				bstyle, cstyle, transport_style, int(result.cloak_model)])

	# 时装的披风覆盖背部装备：只在玩家没有可见披风/翅膀时生效。
	# ★ 不能无条件覆盖 —— 否则换一件时装就把玩家自己的翅膀（如天魔惊神之翼）
	#   顶成时装自带的那套，看起来像「随机变成别的翅膀」。
	if fash_back > 0 and int(result.cloak_model) == 0:
		var fst := fash_back
		var fhide := fst == 31 or TRANSPORT_NO_BACK.has(transport_style)
		if not fhide and equipped.has("clothes"):
			if clothes_style_of_item(item_data(game_data, int(equipped["clothes"]))) == 51:
				fst = 32
		var fcloak := 0 if fhide else SPR_INDEX_CLOAK_START + fst
		if fcloak > 0 and model_exists(fcloak):
			result.cloak_model = fcloak
			detail.append("时装披风→Cloak %d(style %d)" % [fcloak, fst])
	elif fash_back > 0:
		detail.append("时装披风:保留已穿背部")
	return result


## 取部件图第一个有效子帧号（多帧动画图静态展示用）。优先 0，否则取最小键。
static func _first_frame(frag_id: int) -> int:
	var path := "res://assets/sprite_fragment/%d.json" % frag_id
	if not FileAccess.file_exists(path):
		return 0
	var t = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not (t is Dictionary):
		return 0
	var frames = t.get("frames", {})
	if not (frames is Dictionary) or frames.is_empty():
		return 0
	if frames.has("0"):
		return 0
	var keys: Array = []
	for k in frames.keys():
		keys.append(int(k))
	keys.sort()
	return int(keys[0])


## 外观差异描述（给界面显示用）。
static func appearance_text(game_data, base_model: int, equipped: Dictionary, sex: int = -1) -> String:
	var a := appearance(game_data, base_model, equipped, sex)
	var parts: Array = a.get("detail", [])
	return " + ".join(parts) if not parts.is_empty() else "无（基础造型）"
