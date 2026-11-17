extends RefCounted
## 数据与素材清单读取。144MB 原始 JSON 不进工程，运行时按清单懒加载。
## 冲突必须抛错，不静默取一边（SOURCES.md 里踩过「改了 A 生效的是 B」的坑）。

const ASSET_MANIFEST = "res://assets/manifest.json"
const DATA_MANIFEST = "res://data/manifest.json"
const BASELINE = "res://data/baselines/character_stats.json"


static func _json(file_path: String):
	if not FileAccess.file_exists(file_path):
		return null
	var text = FileAccess.get_file_as_string(file_path)
	if text.is_empty():
		return null
	return JSON.parse_string(text)


static func manifest() -> Dictionary:
	var v = _json(ASSET_MANIFEST)
	return v if v is Dictionary else {}


static func asset_count() -> int:
	return int(manifest().get("count", 0))


static func categories() -> Dictionary:
	var v = manifest().get("byCategory", {})
	return v if v is Dictionary else {}


## 按分类或文件名找素材，返回 res:// 路径数组。
static func find(keyword: String, limit: int = 50) -> Array:
	var out := []
	for e in manifest().get("entries", []):
		if not (e is Dictionary):
			continue
		if keyword.to_lower() in str(e.get("file", "")).to_lower() or keyword in str(e.get("catName", "")):
			out.append("res://assets/" + str(e.get("file", "")))
			if out.size() >= limit:
				break
	return out


static func data_manifest() -> Dictionary:
	var v = _json(DATA_MANIFEST)
	return v if v is Dictionary else {}


static func data_sources() -> Array:
	return data_manifest().get("files", [])


static func baseline() -> Dictionary:
	var v = _json(BASELINE)
	return v if v is Dictionary else {}


# ---------------------------------------------------------------- 阶段 2：分片懒加载
## 144 MB 源数据已由 tools/compile-game-data.mjs 编译成 5616 个小分片（21.9 MB），
## 运行时只读 index.json（136 KB），按 id 查询时才打开对应分片并缓存。
## 冲突在编译期抛错，运行时不做合并，也不读 official-v305.json。

const COMPILED = "res://data/compiled/"
var _index: Dictionary = {}
var _cache: Dictionary = {}


func compiled_index() -> Dictionary:
	if _index.is_empty():
		_index = _json(COMPILED + "index.json")
	return _index


func domains() -> Array:
	return compiled_index().get("domains", {}).keys()


func ids(domain: String) -> Array:
	var d: Dictionary = compiled_index().get("domains", {}).get(domain, {})
	return d.get("ids", [])


func count(domain: String) -> int:
	var d: Dictionary = compiled_index().get("domains", {}).get(domain, {})
	return int(d.get("count", 0))


## 返回该 id 的条目数组（技能同一 id 可能有多等级）。未命中返回空数组。
func get_entry(domain: String, id) -> Array:
	var key := domain + "/" + str(int(id))
	if _cache.has(key):
		return _cache[key]
	var v = _json(COMPILED + key + ".json")
	var out: Array = v if v is Array else []
	_cache[key] = out
	return out


func name_of(domain: String, id) -> String:
	var d: Dictionary = compiled_index().get("domains", {}).get(domain, {})
	var names: Dictionary = d.get("names", {})
	return str(names.get(str(int(id)), ""))


## 只查索引里的名字，不打开任何分片；适合大列表搜索。
func search(domain: String, keyword: String, limit: int = 50) -> Array:
	var out: Array = []
	if keyword.is_empty():
		return out
	var d: Dictionary = compiled_index().get("domains", {}).get(domain, {})
	var names: Dictionary = d.get("names", {})
	for k in names.keys():
		if keyword.to_lower() in str(names[k]).to_lower():
			out.append(int(k))
			if out.size() >= limit:
				break
	return out


func cache_size() -> int:
	return _cache.size()


func clear_cache() -> void:
	_cache.clear()


## 源数据里的历史遗留覆盖（如技能 1379），编译期记录，不影响运行。
func dangling_overrides() -> Dictionary:
	var v = compiled_index().get("danglingOverrides", {})
	return v if v is Dictionary else {}
