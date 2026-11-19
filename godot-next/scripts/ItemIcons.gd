extends RefCounted
## 道具图标表：道具数据里的 bagIcon 号 → 图集里的一块矩形。
##
## 素材是多张图集（item_icon.png ~ item_icon7.png + item_mount + item_pet），
## 一张图上几十个尺寸不同的小图，光有 PNG 不知道「30 号图标在哪」。
## 矩形来自原版资源表，由 tools/extract_ui_frames.mjs 抽成
## data/compiled/itemIcons.json（924 个图标，覆盖全部 2505 件道具）。
##
## 用法：ItemIcons.texture(item.bagIcon) → AtlasTexture（内部缓存，同一号只建一次）。

const INDEX_PATH := "res://data/compiled/itemIcons.json"
const ATLAS_DIR := "res://assets/ui/"

static var _icons: Dictionary = {}
static var _atlases: Dictionary = {}
static var _textures: Dictionary = {}
static var _loaded := false


## 图标号 → 可直接给 Button / TextureRect / ItemList 用的纹理；没有则 null。
static func texture(bag_icon: int) -> Texture2D:
	_ensure()
	var key := str(bag_icon)
	if _textures.has(key):
		return _textures[key]
	var e = _icons.get(key, null)
	if not (e is Dictionary):
		return null
	var atlas := _atlas(str(e.get("atlas", "")))
	if atlas == null:
		return null
	var tex := AtlasTexture.new()
	tex.atlas = atlas
	tex.region = Rect2(float(e.get("x", 0)), float(e.get("y", 0)),
		float(e.get("w", 0)), float(e.get("h", 0)))
	# 只要矩形内像素，不要采到隔壁图标（缩放时尤其会糊边）
	tex.filter_clip = true
	_textures[key] = tex
	return tex


static func has(bag_icon: int) -> bool:
	_ensure()
	return _icons.has(str(bag_icon))


## 索引里一共多少个图标（自检 / 界面统计用）。
static func count() -> int:
	_ensure()
	return _icons.size()


static func _atlas(name: String) -> Texture2D:
	if name.is_empty():
		return null
	if _atlases.has(name):
		return _atlases[name]
	var path := ATLAS_DIR + name + ".png"
	var tex: Texture2D = null
	if ResourceLoader.exists(path):
		tex = load(path) as Texture2D
	_atlases[name] = tex
	return tex


static func _ensure() -> void:
	if _loaded:
		return
	_loaded = true
	var f := FileAccess.open(INDEX_PATH, FileAccess.READ)
	if f == null:
		push_warning("[ItemIcons] 读不到 " + INDEX_PATH + "，先跑 tools/extract_ui_frames.mjs")
		return
	var parsed = JSON.parse_string(f.get_as_text())
	f.close()
	if parsed is Dictionary and parsed.get("icons") is Dictionary:
		_icons = parsed["icons"]
