extends RefCounted
## 自由 RGB 调色引擎：把预渲染位图的颜色换成任意目标色，**保留原画明暗层次**。
##
## 为什么不用 modulate / 色相旋转：
##   素材是 3D 预渲染导出的位图，一个部件本身就是一个色族的明暗渐变
##   （例：发型 5 是 #260038→#b600d5 的紫，发型 13 是 #0e2a2a→#01d6d2 的青）。
##   - `modulate` 是整张图乘色，会把高光和描边一起压暗，人物会糊成一坨；
##   - 单纯色相旋转会保留原图的饱和度，改深色时反而发灰。
##
## 这里用的是「相对明度重映射」——把每个像素看成原图内部的一个明暗档位：
##   d = (像素 V − 本层中位 V) / (上/下半幅)                 （−1 最暗，0 中间调，+1 最亮）
##   d>0：V = 目标V + (1 − 目标V) × 0.70 × d                （往白靠，天然不超 1.0）
##   d<0：V = 目标V × (1 + 0.45 × d)                        （往暗走）
##   S = 目标S × (1 ∓ 小幅)，色相直接取目标色相
## 于是描边还是描边（变成目标色的深色），高光还是高光，只是换了个色族。
##
## ★ 三个关键点，都是踩过坑才定的：
##   ① 必须用分位数定范围、且**以中位色为锚**：用中位数做除法的话，黑发（style 9，
##     V 只有 0.02~0.35）染白发会中间调过曝、暗部仍纯黑 → 头发一块块黑斑；
##     以中位为锚则「用户选的颜色 = 图里占多数的中间调」，不会金发染成土黄、
##     深褐肤染成浅褐（早期版本两个方向都偏，实测中位 V 偏 0.2 以上）。
##   ② 亮部走「往白靠」而不是乘系数：目标色本身 V=1.0 时乘 1.4 会削平成一片白。
##   ③ 色相只在目标色相上取，绝不保留原图色相 —— 保留会把蓝色系染出紫色杂边。
##
## 两种作用范围：
##   MODE_FULL —— 整层重着色（头发：整张图都是头发）
##   MODE_SKIN —— 只认「肤色像素」（脸/手/脚：眼睛、嘴唇、指甲、暗描边保持原样）。
##                肤色基准色相从图里自动统计（出现最多的色相桶），
##                再用色相距离 + 明度下限 + 饱和度上限做软遮罩，边缘平滑过渡。

const MODE_FULL := "full"
const MODE_SKIN := "skin"

## 视为「未启用自由调色」的颜色（alpha=0 的占位）。
const NONE := Color(0, 0, 0, 0)


static func enabled(target: Color) -> bool:
	return target.a > 0.0


## 主入口：返回重着色后的新图（不改入参）。
static func tint(src: Image, target: Color, mode: String = MODE_FULL) -> Image:
	if src == null or not enabled(target):
		return src
	var img: Image = src.duplicate()
	var w := img.get_width()
	var h := img.get_height()
	if w <= 0 or h <= 0:
		return img

	# ---- 第一遍：统计本层明暗范围（只在会被着色的像素上统计）
	var h_ref := target.h
	var v_list: Array = []
	if mode == MODE_SKIN:
		h_ref = _dominant_hue(img)
	for y in range(h):
		for x in range(w):
			var c := img.get_pixel(x, y)
			if c.a <= 0.01:
				continue
			# 只统计「确实是肤色」的像素（权重≥0.5）：把边缘半遮罩的暗描边算进来，
			# 会把中位 V 拉低，深肤色就染不深（实测偏 0.3 以上）。
			if mode == MODE_SKIN and _skin_weight(c, h_ref) < 0.5:
				continue
			v_list.append(c.v)
	if v_list.is_empty():
		return img
	v_list.sort()
	var v_lo := _percentile(v_list, 0.05)
	var v_med := _percentile(v_list, 0.50)
	var v_hi := _percentile(v_list, 0.95)
	if v_med - v_lo < 0.03:
		v_lo = 0.0
	if v_hi - v_med < 0.03:
		v_hi = minf(1.0, v_med + 0.12)
	var lo_span := maxf(0.02, v_med - v_lo)
	var hi_span := maxf(0.02, v_hi - v_med)

	# ---- 第二遍：写回
	var th := target.h
	var ts := target.s
	var tv := target.v
	for y in range(h):
		for x in range(w):
			var c := img.get_pixel(x, y)
			if c.a <= 0.01:
				continue
			var weight := 1.0
			if mode == MODE_SKIN:
				weight = _skin_weight(c, h_ref)
				if weight < 0.02:
					continue
			var d := 0.0
			if c.v >= v_med:
				d = (c.v - v_med) / hi_span
			else:
				d = (c.v - v_med) / lo_span
			d = clampf(d, -1.0, 1.0)
			var nv := 0.0
			var ns := 0.0
			if d > 0.0:
				nv = tv + (1.0 - tv) * 0.70 * d      # 亮部往白靠，天然不会超 1.0
				ns = ts * (1.0 - 0.18 * d)           # 高光稍微去饱和
			else:
				nv = tv * (1.0 + 0.45 * d)           # 暗部压低
				ns = ts * (1.0 + 0.08 * (-d))        # 暗部稍微加饱和
			nv = clampf(nv, 0.0, 1.0)
			ns = clampf(ns, 0.0, 1.0)
			var tinted := Color.from_hsv(th, ns, nv)
			var out := c.lerp(tinted, weight) if weight < 1.0 else tinted
			img.set_pixel(x, y, Color(out.r, out.g, out.b, c.a))
	return img


## 已排序数组的分位数（0~1）。
static func _percentile(sorted_vals: Array, p: float) -> float:
	var n := sorted_vals.size()
	if n == 0:
		return 0.0
	var idx := clampi(int(round(p * float(n - 1))), 0, n - 1)
	return float(sorted_vals[idx])


## 该部件「原本是什么颜色」——色号色块 / 拾色器初始值用。
static func dominant_color(src: Image, mode: String = MODE_FULL) -> Color:
	if src == null:
		return Color(0.5, 0.5, 0.5)
	var w := src.get_width()
	var h := src.get_height()
	if w <= 0 or h <= 0:
		return Color(0.5, 0.5, 0.5)
	var h_ref := _dominant_hue(src)
	var s_list: Array = []
	var v_list: Array = []
	for y in range(h):
		for x in range(w):
			var c := src.get_pixel(x, y)
			if c.a <= 0.01:
				continue
			if mode == MODE_SKIN and _skin_weight(c, h_ref) < 0.25:
				continue
			s_list.append(c.s)
			v_list.append(c.v)
	if v_list.is_empty():
		return Color(0.5, 0.5, 0.5)
	s_list.sort()
	v_list.sort()
	return Color.from_hsv(h_ref, float(s_list[s_list.size() / 2]),
		float(v_list[v_list.size() / 2]))


## 出现最多的色相桶中心（0~1）。忽略近黑与近灰像素，避免描边和白色高光定义基准。
static func _dominant_hue(src: Image) -> float:
	const BUCKETS := 24
	var hist := PackedInt32Array()
	hist.resize(BUCKETS)
	var w := src.get_width()
	var h := src.get_height()
	for y in range(h):
		for x in range(w):
			var c := src.get_pixel(x, y)
			if c.a <= 0.01 or c.v < 0.22 or c.s < 0.10:
				continue
			var b := clampi(int(c.h * float(BUCKETS)), 0, BUCKETS - 1)
			hist[b] += 1
	var best := 0
	var best_n := 0
	for i in range(BUCKETS):
		if hist[i] > best_n:
			best_n = hist[i]
			best = i
	if best_n == 0:
		return 0.0
	return (float(best) + 0.5) / float(BUCKETS)


## 肤色权重 0~1：色相靠近基准色、够亮、别太艳（把眼睛/嘴唇/描边留在原色）。
static func _skin_weight(c: Color, h_ref: float) -> float:
	var dh := absf(c.h - h_ref)
	dh = minf(dh, 1.0 - dh)
	var w_h := 1.0 - smoothstep(0.040, 0.075, dh)
	var w_v := smoothstep(0.16, 0.30, c.v)
	var w_s := 1.0 - smoothstep(0.58, 0.82, c.s)
	return w_h * w_v * w_s
