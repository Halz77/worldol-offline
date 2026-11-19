extends RefCounted
## 地面图块库（TileSet）的运行时索引。
##
## 图块本身在 assets/tilesets/map_ground.tres（由 tools/build_map_tileset.gd 生成），
## 这里只负责「资源名 → source_id / 图集坐标 / 镜像变体」的查表，避免每次 set_cell
## 都去遍历 TileSet 的 sources。
##
## 索引文件 data/compiled/tileAtlas.json 与 .tres 同一次生成，两者必须成对更新。
## 找不到名字时返回空字典 —— 调用方据此跳过该格（原版就有 5 个名字没有贴图）。

const TILESET_PATH := "res://assets/tilesets/map_ground.tres"
const INDEX_PATH := "res://data/compiled/tileAtlas.json"

static var _tileset: TileSet = null
static var _index: Dictionary = {}
static var _loaded := false


static func tileset() -> TileSet:
	_ensure()
	return _tileset


## 资源名 → {"source": int, "cols": int, "rows": int, "alts": {"1": alt_id, ...}}
static func entry(name: String) -> Dictionary:
	_ensure()
	var e = _index.get(name, null)
	return e if e is Dictionary else {}


## 镜像变换 → alternative tile id（0 = 原版，没有变体时也回 0）。
static func alt(name: String, transform: int) -> int:
	if transform <= 0:
		return 0
	var e := entry(name)
	if e.is_empty():
		return 0
	var alts = e.get("alts", null)
	if not (alts is Dictionary):
		return 0
	return int(alts.get(str(transform), 0))


## 图块总数（自检用）。
static func source_count() -> int:
	var ts := tileset()
	return ts.get_source_count() if ts != null else 0


## 重新从磁盘读索引（重建 TileSet 之后调用）。
static func reload() -> void:
	_loaded = false
	_tileset = null
	_index = {}
	_ensure()


static func _ensure() -> void:
	if _loaded:
		return
	_loaded = true
	if ResourceLoader.exists(TILESET_PATH):
		_tileset = load(TILESET_PATH) as TileSet
	var f := FileAccess.open(INDEX_PATH, FileAccess.READ)
	if f == null:
		return
	var text := f.get_as_text()
	f.close()
	var parsed = JSON.parse_string(text)
	if parsed is Dictionary and parsed.get("sources") is Dictionary:
		_index = parsed["sources"]
