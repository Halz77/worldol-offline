# 自制宠物 · 贴图素材

这个目录放**你要做的宠物贴图**和它的构建配置 `reskin.json`。

`data/local-pets.json`（模板/数值）和这里（贴图）是两回事：
- `local-pets.json` —— 宠物叫什么、几阶、数值多少、用哪个外观编号
- `local-pet-art/` —— 外观的图本身 + 换皮配置

## 三步流程

1. **选底模**：从现有 136 个有精灵的宠物里挑一个当动画基底（朝向、动作、攻击帧全靠它）。
   贴图已导出到 `<项目根>/FileRecv/MobileFile/pet-reskin-templates/`，
   打开 `00-尺寸清单.md` 看每个底模的贴图尺寸。
2. **画贴图**：照底模主体那张（1~2 张）的尺寸画，**像素级一致**。
   阴影之类的小件不用管 —— 那是几千个 model 共用的，构建时原样保留。
3. **写 `reskin.json` 并构建**：

```json
{
  "fragmentIdStart": 40000,
  "modelIdStart": 60000,
  "entries": [
    {
      "key": "冰霜幼龙:4",
      "baseModel": 504,
      "baseHead": 503,
      "replace": { "model": [0], "head": [0] },
      "textures": { "model": ["冰霜幼龙-body.png"], "head": ["冰霜幼龙-head.png"] }
    }
  ]
}
```

```
node tools/build-pet-reskin.mjs --check   # 先验尺寸，不写文件
node tools/build-pet-reskin.mjs           # 构建
```

构建完会打印 `冰霜幼龙:4 → model:60000 headIcon:60001`，把这两个号填进
`data/local-pets.json` 里那只宠物的 `baseline.model` / `baseline.headIcon`。

## 素材硬约束

| 项 | 要求 |
|---|---|
| 格式 | PNG（JPG 没有透明通道，不行） |
| 背景 | 必须透明 |
| 尺寸 | **像素级等于底模对应槽位**（差一个像素帧就全错位，构建会直接报错挡住） |
| 颜色 | 随意，索引色由构建时处理 |
| 内容 | 只有主体，**不要画阴影**、不要带文字/边框 |

## 换皮为什么只要改一个数字

model json 里 `frames` 的 `fi` 是 **`files` 数组的下标**，不是贴图编号：

```
files:  [12017]                    ← 贴图编号
frames: {0:[[0,sub,x,y,flag],...]} ← fi=0，指 files[0]
anis:   [{id:0},{id:2}]            ← 待机 / 攻击
```

所以把 `files[0]` 从 12017 换成新编号 40000，`frames` 和 `anis` **一个字节都不用动** ——
朝向、动作、攻击帧全部白送。这也是为什么换皮只要 1~2 张图，而不是重画 300 帧。

## 注意

- `client/` 不入库（见 .gitignore），构建产出的贴图不进 git。换机器后重跑
  `node tools/build-pet-reskin.mjs` 就能重建。
- 只丢了图、登记表还在也没关系：资源登记时会检查文件是否存在，缺图就跳过，
  那只宠物只是沿用底模外观，不会让游戏起不来。
