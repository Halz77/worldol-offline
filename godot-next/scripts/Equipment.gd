extends RefCounted
## 装备系统规则层（初步版，2026-11-18）。
##
## 范围：基础属性 + 外观。强化 / 鉴定 / 套装 / 绑定 / 时装一律不参与。
## 三件事：
##   1. 部位定义与装备列表：按道具 type 归类（type 是唯一部位字段，见 0004.js:2983）。
##   2. 属性加成：def_str/def_agi/def_mag + powerN/powerValueN → 属性键字典。
##      power 常量取自 analysis/modules/0004.js:2545+，与 Naming.STAT_LABELS 的键对齐。
##   3. 外观：武器用现成 model（基础 model + 武器类型偏移，见 0055.js getSpriteNameIDByWeapon）；
##      防具替换基础 model 的部件图（装备 icon 就是 sprite_fragment 编号，见 0056.js updateIcon）。
##
## 所有函数是 static，不需要实例；不依赖 Autoload，headless 自检可直接调用。

const GameData = preload("res://scripts/GameData.gd")

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


## 该部位的装备 id 列表（按 index 里的 name 排序）。默认上限 200，避免一次填几千项。
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
		if wanted_types.has(int(it.get("type", -1))) and int(it.get("icon", 0)) > 0:
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
static func is_multi_frame(frag_id: int) -> bool:
	var path := "res://assets/sprite_fragment/%d.json" % frag_id
	if not FileAccess.file_exists(path):
		return false
	var t = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not (t is Dictionary):
		return false
	var frames = t.get("frames", {})
	return frames is Dictionary and frames.size() > 1


## 计算外观：返回 {model_id, part_replace:{基础部件id:图号}, detail:[]}。
## base_model: 当前性别/姿势的基础 model（300/400/100/200）。sex 可显式传入（女=1）。
static func appearance(game_data, base_model: int, equipped: Dictionary, sex: int = -1) -> Dictionary:
	var gender := gender_of_model(base_model) if sex < 0 else sex
	var detail: Array = []
	var single_use: Array = []   # 替换成单帧图的槽位：多 layer 引用只画第一次，避免重复
	var add_parts: Array = []    # 追加图层：背部/坐骑（独立精灵，不在 model files 里）
	var result := {"model_id": base_model, "part_replace": {}, "single_use": single_use,
		"add_parts": add_parts, "detail": detail}
	var final_model := base_model

	# ---- 武器：先按 type 选现成 model（姿态），再把武器部件换成该装备的具体图 ----
	var weapon_part := 0   # 武器在 model files 里 at==8 的部件 id
	if equipped.has("weapon"):
		var w = item_data(game_data, int(equipped["weapon"]))
		var wtype := int(w.get("type", 0))
		if WEAPON_TYPES.has(wtype):
			var candidate := base_model + wtype
			if FileAccess.file_exists("res://assets/sprite_model/%d.json" % candidate):
				final_model = candidate
				detail.append("武器→Model %d" % candidate)
	# 读最终 model 的 files，找 at==8(武器)/at==10(头饰)/at==4(肩) 的实际部件 id
	var model_json = JSON.parse_string(FileAccess.get_file_as_string(
		"res://assets/sprite_model/%d.json" % final_model))
	var model_files: Array = []
	var model_file_ints: Array = []   # int 化，JSON 解析出的整数是 float，直接用 has(int) 匹配不上
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
			continue   # 背(type5)/坐骑(type11) 等单独处理或暂无外观层
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
		# ★ 单帧图替换多帧槽位：会被画多次 → 标记 single_use 去重
		if type == 3 and not is_multi_frame(frag):
			single_use.append(base_part)
		var note := "%s:%d→%d" % [str(d.label), base_part, frag]
		detail.append(note)
		if OS.has_environment("WORLDOL_EQUIP_DEBUG"):
			print("[equip-debug] %s item=%d icon=%d gender=%d → %s" % [
				str(d.label), int(equipped[slot]), icon, gender, note])

	# ---- 背部 / 坐骑：原版是独立多部件精灵，基础 model 里没有槽位和偏移数据 ----
	# ★ 不在这里硬贴：坐骑 icon 是"人+坐骑整幅战斗帧"（如 14017 白狼含角色+光效），
	#   背部 icon 是多块子帧拼的动画图集（如 5001 每 sub 只是 25x14 小碎片），
	#   没有原版那套逐部件 dx/dy 就无法正确定位，硬贴只会得到扭曲/错位的画面。
	#   这属于"整套造型系统"（类似时装 15xxx/20xxx），等单独做，不在基础版范围。
	for slot in ["back", "transport"]:
		if equipped.has(slot):
			detail.append("%s:外观未实现" % slot)
			if OS.has_environment("WORLDOL_EQUIP_DEBUG"):
				print("[equip-debug] %s 外观未实现（需整套造型系统）" % slot)
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
