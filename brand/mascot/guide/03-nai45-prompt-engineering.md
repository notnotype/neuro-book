# NovelAI V4.5 生成蓝图与 512-Token 提示词工程指南

本文件记录「星璃 · Lyra」在 NovelAI Diffusion V4.5 Full (`nai-diffusion-4-5-full`) 下的标准生成参数、防失真标定结论、T5 分词预算测算结果，以及基于同种子（`seed = 2948684181`、28 步）对照实验得出的提示词精简策略。

## 1. 标准生成参数与精准参考防失真配置

母版参考图（图 6）为 [`master/canonical-lyra-nai45.png`](../master/canonical-lyra-nai45.png)（原始文件 `16-14-50-2948684181.png`）。日常生成默认采用 Opus 免费档位（**28 步**），并发数严格固定为 **1**。

| 参数字段 | 默认值 | 说明 |
| --- | --- | --- |
| `model` | `nai-diffusion-4-5-full` | NovelAI Diffusion V4.5 Full |
| `steps` | `28` | 默认采用 Opus 免费步数上限（母版图 6 精修时曾使用 40 步） |
| `sampler` | `k_euler_ancestral` | Euler Ancestral 采样器 |
| `noise_schedule` | `karras` | Karras 噪声调度 |
| `scale` | `7.0` | CFG Scale |
| `cfg_rescale` | **`0.44`** | 由 `0.40` 上调至 `0.44`，抑制高权重画师串与参考图叠加引起的色彩过饱和与线条失真 |
| `seed` | `2948684181` | 母版基准种子（衍生立绘/插图/场景可固定或微调） |
| `width` × `height` | `832 × 1216`（竖）/ `1216 × 832`（横） | 总像素 `1,011,712 <= 1,048,576`（Opus 免费分辨率上限） |
| `prefer_brownian` | `true` | 开启布朗运动噪声相关性 |
| `deliberate_euler_ancestral_bug` | `false` | 关闭旧版 Euler A 缺陷 |
| `uncond_scale` | `0.0` | 关闭全局额外无条件缩放 |
| `v4_prompt.use_coords` | `false` | 单人构图无需强制坐标框 |
| `v4_prompt.use_order` | `true` | 启用标签顺序权重感知 |
| `Precise Reference` | `master/canonical-lyra-nai45.png` | **两种互斥模式**：<br>`character`：`strength = 0.65`、`fidelity = 0.60`（配合画师串使用，锚定五官与服装结构）<br>`style`：`strength = 0.9`、`fidelity = 0.8`（**必须移除画师串**，只借画风与光照，推荐见「用 style 参考替代画师串」一节） |

### 防失真标定实验结论（Calibration `C1`–`C5`）

当 `base_caption` 已包含完整画师权重串时，若同时开启 `character&style` 且将 `strength = 1.0, fidelity = 1.0` 拉满，会导致画风特征双重注入，产生局部线条烧灼、色块硬化与面部细节失真（尤其在 `P03` 半身动作差分中最显著）。

通过固定 `seed = 2948684303, steps = 28` 的 5 组受控实验（保存于 `.local/brand/mascot/current/calibration-p03-fix/`），得出以下工程规范：

1. **参考类型必须限定为 `"character"`**：画风完全交由 `base_caption` 中的画师串控制，不需要也不应开启风格参考。
2. **参考强度与保真度控制在 `0.75` 以下**：实测 `strength = 0.65, fidelity = 0.60`（即 `secondary_strength = 0.40`）既能稳固锚定四角金星胸针、红白双层阔袖、头顶光环与发型特征，又赋予模型充足的姿态与透视自由度。
3. **`cfg_rescale` 提升至 `0.44`**：相比 `0.40` 能有效平抑高光与暗部交界处的过曝伪影；而对画师串整体乘以 `0.85` 降权（实验 `C4`）会削弱原有的笔触层次感，因此优先采用 **原画师串 + `cfg_rescale = 0.44` + `character (0.65 / 0.60)`** 的黄金组合。

## 2. 512-Token T5 分词预算精确测算

NovelAI V4.5 使用 Google T5 (`t5-v1_1-xxl`) SentencePiece Unigram 词表（总上限 **512 Tokens**）。在送入 T5 编码器前，引擎会先剥离 `w::...::` 权重标记并转换为逐 Token 乘数。由于 T5 原生词表不含下划线 `_`，保留下划线时每个 `_` 会独占 1 个 Token（保守上界 `u_total`），而将下划线规范化为空格后可显著合并词片（`sp_total`）。

对母版图 6 原始提示词的逐段分词审计结果如下：

| 计量口径 | `base_caption` | `char_captions[0]` | EOS / 分隔开销 | 总计 Token | 距离 512 上限余量 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 保留下划线（保守上界 `u_total`） | 153 | 330 | 2 | **485** | **仅剩 27 Tokens** |
| 下划线转空格（规范化 `sp_total`） | 149 | 229 | 2 | **380** | 剩余 132 Tokens |

**核心结论**：图 6 原始提示词在保留下划线的保守口径下已达 **485 / 512 Tokens**（占用率 **94.7%**），仅剩 **27 Tokens** 余量。一旦直接追加复杂的动作、道具、互动或宏大场景描述，极易突破 512 上限并导致位于提示词末尾的标签被静默截断。

### 高 Token 消耗标签审计表（Top Cost Tags）

| 原始标签 | `u_tokens`（含 `_`） | `sp_tokens`（转空格） | 分词拆解原因与优化建议 |
| --- | ---: | ---: | --- |
| `1.2::short_low-tied_sidelocks_twin_braids` | **19** | 12 | 含 4 个下划线与连字符，是角色外观的核心发型锚点，**不可删**。 |
| `pink_gradient_cat_tail` | **9** | 5 | 核心尾部特征，**不可删**。 |
| `layered_sleeves` / `lace_sleeves` | 各 **9** | 各 4 | `lace`、`layered`、`sleeves` 拆分多片；远景场景中若挂载图 6 参考可精简。 |
| `crimson_eyes` / `cross-shaped_pupils` | 各 **8** | 6 / 5 | 标志性眼部特征，**不可删**。 |
| `star_hair_ornament` / `frilled_collar` | 各 **8** | 4 / 5 | 头饰与领口核心特征，立绘与近景必留。 |
| `1.25::gold_embroidery::` | **8** | 3 | `embroidery` 子词拆分多；实测会由画风与红金礼裙自动涌现。 |
| `detached_sleeves` / `wide_sleeves` / `red_sleeves` | 各 **8** | 各 3 | 决定双层红白阔袖的关键剪裁词，建议至少保留 `detached_sleeves, wide_sleeves, red_sleeves`。 |
| `1.4::fantasy_clothes::`（首尾重复出现 2 次） | **12**（6×2） | 6（3×2） | 图 6 原串首尾重复写了两次，且本身属于泛化风格词。 |

## 3. 提示词精简消融实验（28 步同种子对照）

在固定 `seed = 2948684181, steps = 28` 下完成的消融实验结果如下：

| 实验编号 | 变更内容 | `u_total` | 节省 Token | 画面实测表现与结论 |
| --- | --- | ---: | ---: | --- |
| **A0** | 图 6 原串逐字不改（28 步基准） | 485 | 0 | 28 步与 40 步母版高度一致，仅蕾丝微纹理略柔和。 |
| **A1** | 去除末尾重复的 `1.4::fantasy_clothes::` 及空 `, ::` | 472 | **-13** | 清除重复词后末尾 `standing` 权重回升，服饰细节 100% 一致。 |
| **A2** | 完全移除 `1.4::fantasy_clothes::` | 466 | **-19** | **验证实测判断**：移除后红金礼服、披肩、星徽与蕾丝袖毫无损失，反而消除了背景偶发的杂物干扰。 |
| **A3a** | 在 A2 基础上移除 `1.25::gold_embroidery::`（保留 `lolita_fashion`） | 458 | **-27** | **验证自动涌现**：金边刺绣在红斗篷与领口上 **100% 自动涌现**，且纯白背景更干净。 |
| **A3** | 同时移除 `lolita_fashion` 与 `gold_embroidery`（无参考图） | 452 | -33 | 在**不挂参考图**的纯文本生成中，连带删掉 `lolita_fashion` 会使裙装向中式宽袍偏移。 |
| **A4** | **全身精简母版（Slim-Full）**：移除 `fantasy_clothes`、`lolita_fashion`、`gold_embroidery`、`royal_robe`、`bridal_legwear`、`jewelry`、`pointy_ears` | 434 | **-51** | 为动作与场景释放了 **78 Tokens** 的充裕空间。 |
| **A5** | **上半身精简母版（Slim-Upper）**：在 A4 基础上进一步移除画面外的下装/足部词 | 406 | **-79** | 在半身或中近景构图中，剔除画面外腿部标签不仅节省 28 Tokens，还能避免模型强行把构图拉回全身。 |
| **A6 / Fixed** | **精简母版 + 挂载图 6 `character` 参考（`0.65 / 0.60`）+ `cfg_rescale = 0.44`** | 434 | **-51** | **最佳实践**：挂载图 6 人物参考后，使用删去 51–131 Tokens 的精简词即可 **100% 还原西式多层蕾丝礼裙、金边刺绣与四角星胸针**，且画面通透无失真。 |

### 标签影响力分级总结

1. **第一优先级剔除（零负向影响，立省 27–35 Tokens）**：
   - 末尾重复的 `1.4::fantasy_clothes::` 与多余空逗号 `, ::`；
   - 首部的 `1.4::fantasy_clothes::`（具体衣着词已足够支撑礼装质感）；
   - `1.25::gold_embroidery::`（在红斗篷 + 金星胸针 + 画师栈作用下会自动涌现精致金绣）；
   - `0.75::royal_robe::`、`jewelry`、`pointy_ears`（已被 `red_cape`、`star_brooch`、`cat_ears` 完全覆盖）。
2. **按构图动态剔除（中近景/场景立省 25–45 Tokens）**：
   - 在半身像（`upper_body` / `cowboy_shot`）或桌前坐姿中，优先丢掉不在画面内的下肢与足部标签；
   - 在挂载图 6 作为 `Precise Reference (character)` 时，可安全省略 `lolita_fashion`、`lace_sleeves`、`layered_sleeves`，由参考图特征自动补全。
3. **不可剔除的核心锚点（Core Identity Anchors）**：
   - **头面部与发型**：`white_hair, long_hair, blunt_bangs, 1.5::half_updo::, 1.2::short_low-tied_sidelocks_twin_braids, red_ribbon, back_bow::, cat_ears, tareme, crimson_eyes, cross-shaped_pupils, halo, star_hair_ornament, 1.25::lolita_hairband::`
   - **上装与斗篷剪裁**：`1.35::red_cape, floating_cape, coattails::, 1.3::capelet::, 1.3::collared_dress::, frilled_collar, star_brooch, white_dress, 1.25::layered_dress::, chest_ribbon, 1.3::shoulder_cutout, detached_sleeves, wide_sleeves, red_sleeves::`
   - **尾部特征**：`pink_gradient_cat_tail, tail_bow`

## 4. 三档精简母版与 Token 预算余量

生成新立绘、插图与场景时，按构图选择以下三档模板（配合图 6 `character` 参考 `strength = 0.65, fidelity = 0.60, cfg_rescale = 0.44`）：

| 模板档位 | 适用构图 | 基础总计（`u_total` / `sp_total`） | 距离 512 上限余量 | 核心裁剪项 |
| --- | --- | ---: | ---: | --- |
| **Tier-1 Full（全身精简版）** | 全身站姿、动态咏唱、坐地互动 | `418 / 329` | **+94 Tokens** | 剔除重复 `fantasy_clothes`、`gold_embroidery`、`royal_robe`、`jewelry` |
| **Tier-2 Upper（半身/中景版）** | 半身特写、饮茶、书桌夜读 | `387 / 305` | **+125 Tokens** | 在 Tier-1 基础上剔除画面外的下装与袜部标签 |
| **Tier-3 Scene（宏大场景版）** | 忆星书庭、万言星海、破晓露台等宽幅场景 | `354 / 289` | **+158 Tokens** | 进一步合并次要蕾丝/袖层修饰词，留出充足环境与光影预算 |

## 5. 角落文字与 Logo 伪影的抑制工程

### 现象与根因

初版图集中 7 幅作品在画面角落出现小型签名、印章或模糊字符。定位到三个叠加原因：

1. **负面词位置与 `use_order` 顺序衰减**：母版负面串（约 229 Tokens）虽已含 `signature, artist name, artist logo`，但位于长串中后段且无权重标注。`v4_prompt.use_order = true` 会让靠后的标签实际约束力下降，末端标签近乎失效。
2. **画师权重串的反向诱导**：`base_caption` 中 21 位 `artist:xxx` 加权标签本身就是「画师作品」语义，会提高模型绘制署名标记的先验。
3. **参考图的原始印记**：人物参考只约束形体与配色，不抑制构图角落元素的生成倾向。

### 处置方案（实测有效）

把防署名标签**前置到负面提示词最前**并显式加权，同时在正向提示词末尾加一次显式否定：

| 位置 | 内容 | 作用 |
| --- | --- | --- |
| `v4_negative_prompt.base_caption` 首位 | `3.0::signature, watermark, artist_name, logo, text, stamp, seal, username, copyright_name, english_text, chinese_text::, ` | 最高优先级抑制各类署名、水印、印章与画面文字 |
| `v4_negative_prompt.char_captions[0]` 首位 | `2.5::signature, watermark, logo, text, stamp::, ` | 在人物图层同样抑制 |
| `v4_prompt.base_caption` 末尾 | `1.4::no_text::` | 正向显式要求无文字 |

前置后 `base_uc` 从 229 Tokens 升至 **257 Tokens**（`2.5::` 版）/ **264 Tokens**（`3.0::` 版），合计负面预算 **318–324 Tokens**，仍在 512 上限内（正负提示词分别独立计费额度）。

实测覆盖率：`2.5::` 前置配置一次消除 `P01`、`P02`、`P04`、`I03`、`I04`、`S02`、`S03` 共 7 幅的角落印记；剩余 `P03`、`I01`、`I02`、`S01`、`S04` 在提升到 `3.0::` 后一并消除。当前 [`gallery/`](../gallery/) 12 幅作品全部无签名、水印与画面文字。

### 场景透视失效的处置（`S04` 案例）

原提示词使用 `marble_balcony, floating_island, sea_of_clouds, wide_angle` 组合，再叠加 `wide_angle, vanishing_point, architectural_geometry, balanced_perspective` 修正词，结果露台仍被渲染成倾斜悬空斜面——**透视修正词无法推翻「悬空平台 + 超广角」这一构图语义**。

改为**正对的中景构图**后一次通过：

```
base: cowboy_shot, straight-on, outdoor, stone_balcony, ornate_balustrade,
      classical_columns, sea_of_clouds, sunrise, golden_hour, morning_glow
char: standing_by_balustrade, one_hand_on_railing, holding_book_to_chest,
      red_book, gentle_breeze, glowing_halo, morning_light
```

结论：**场景透视出错时优先换构图语义（机位、镜头段落、建筑类型），而不是追加透视修正标签。**

## 6. 自由生成的强制纪律

在批量衍生立绘、插图、场景（含不入库的 `.local` 探索批次）时，以下三项缺一即导致画面退化，属于必须逐条自检的硬约束：

1. **`base_caption` 必须以画师权重串开头**。精准参考固定为 `reference_type = "character"` 后，画风完全由 `base_caption` 的画师串承载；一旦漏掉，模型立刻退回 NAI 通用默认画风（实测同一角色的配色、笔触层次与高光处理全线漂移）。
2. **`char_captions[0]` 必须以角色精简母版开头**。仅写动作短语（如 `holding_book, smile`）会丢失发型、胸针、阔袖结构；必须前置 `Tier-1 Full` / `Tier-2 Upper` / `Tier-3 Scene` 三档母版之一，再接动作与表情差分词。
3. **非人形形态必须关闭人物精准参考**。猫形态（`animal_focus, white_cat`）挂载人物参考时，模型会把人形结构拉回画面；正确做法是关闭参考、保留画师串，用纯文本约束毛色、粉渐变尾巴与红蝴蝶结。

## 7. 关闭精准参考时的替代配方（纯文本一致性维持）

精准参考并非必需。在 `use_img6_ref = False` 下，角色一致性改由「画师串 + 完整角色母版 + 组件级加权」承担。经 4 轮同种子对照（`A1`–`A4` 三维修正，`B1`–`B4` 过曝标定）标定出以下配方：

| 配置项 | 无参考取值 | 与带参考的差异 |
| --- | --- | --- |
| 画师串 | `base_caption` 以画师权重串开头，但**整体乘 `0.85` 降权** | 带参考时保持原权重（参考图会稀释风格注入）；无参考时原权重会过曝 |
| 角色段 | `Tier-1 Full` / `Tier-2 Upper` / `Tier-3 Scene` 母版 | **必须加回 `1.25::lolita_fashion::`**，无参考时删掉会让裙装向宽袍偏移 |
| 场景档补词 | 额外补 `star_brooch, white_stockings, garter_straps, stirrup_legwear, no_shoes` | 带参考时可靠参考图补全，无参考必须显式写出 |
| `cfg_rescale` | **`0.45`** | 带参考时 `0.44`；无参考时高光溢出更明显，`0.45` 进一步压制 |
| 光环 `halo` | 使用裸 `halo`，**不做专项加权或 UC 抑制** | 形状与颜色由抽卡决定，可通过换种子挑选 |

### 过曝标定实验（`B1`–`B4`，同种子 `2948685600`、28 步）

固定 `A1`（全身动态 + 星海背景）提示词，只改变 `cfg_rescale` 与画师串权重：

| 实验 | 画师串权重 | `cfg_rescale` | 实测表现 |
| --- | --- | --- | --- |
| `A1_v3`（基准） | 原权重 | `0.44` | 面部与白裙高光溢出、红色偏刺眼，颜色失真明显 |
| `B1` | 原权重 | `0.45` | 略收敛，但过曝仍存在 |
| `B2` | 原权重 | `0.50` | 饱和略降，改善有限，仍不及降权方案 |
| `B3` | **×`0.85`** | `0.44` | 过曝显著消退，红色柔和、白裙层次恢复，笔触略平 |
| **`B4`（采纳）** | **×`0.85`** | **`0.45`** | **过曝控制最佳，脸部高光正常、裙褶层次清晰，红色不刺眼** |

结论：**无参考时过曝的主因是高权重画师串缺少参考图稀释，而非 `cfg_rescale` 不足**。把画师串乘 `0.85` 是主要手段，`cfg_rescale` 提到 `0.45` 作为收尾微调；单纯把 `cfg_rescale` 推到 `0.50` 收益很小。

### 两处实测坑（无参考时才会暴露）

1. **场景远景会抹掉下半身**。`Tier-3` 精简母版本身不含下装与足部标签，`wide_shot` 远景下模型直接不画腿脚，胸针也一并丢失。补回下装与胸针锚点后结构立即完整。
2. **猫形态的瞳色被物种先验覆盖**。`white_cat` + `animal_focus` 下，裸 `crimson_eyes` 会被刷成蓝眼。需把 `1.4::crimson_eyes, cross-shaped_pupils::` 加权，并在 `char_uc` 前置 `blue_eyes, purple_eyes, heterochromia, gold_eyes::` 抑制。

### 光环的处理原则

`halo` 在无参考时容易退化为彩色发光环线，但**不为此建立专项工程**：加权重会把它推向尖刺/多角环（颜色更不可控），改写为 `golden_halo, simple_ring` 又会削弱母版中悬浮星饰的偶发性。实际做法是保留裸 `halo`，在成图不理想时换种子重抽。

### 光照控制：靠画面内的光源物体，不靠光照标签

无参考生成最常见的失败不是过曝，而是**脸部背光**：角色整体处在逆光中，面部成为暗面。原因有三：

1. 正向提示词里的光源词全部位于背景（`starry_sky`、`glowing_threads`、`god_rays`、`lantern`、月光、金色星环），模型据此把主光源放在角色身后；
2. 负面提示词里没有任何针对背光或剪影的抑制项；
3. 多位画师的既有笔触本身就偏氛围逆光。

#### 抽象光照词无效（`C`–`G` 共 9 组）

| 组别 | 写法 | 结果 |
| --- | --- | --- |
| `C1` | 基线（无光照词） | 脸背光，下半脸与颧骨下出现暗带 |
| `D1` / `D4` | 负面抑制 `backlighting, silhouette, contre-jour, shadowed_face, dark_face` | 脸部转亮，但**背景氛围光同时消失**，画面变闷 |
| `D2` | 正向（`base_caption`）加 `light from front, light on face` | 脸部转亮，背景被压暗 |
| `E1` / `E2` | 正向（`char_caption`）加 `light on face` | 脸部转亮且背景暖光保留，但**诱发 POV 前景手**（多出两只手） |
| `G1` | 正面加 `front_lighting, cast_shadow`，负面抑制 `bloom, overexposed, specular_highlight, ambient_lighting` | 脸部均匀提亮，**仍无刘海在脸上的投影**，属漫反射而非定向光 |
| `G2` | `G1` 再补 `shadow from bangs on face, hair shadow` | 额头出现淡影，但**生成第二个头部轮廓** |
| `G3` | 自然语言 `key light from front, bangs casting soft shadow on forehead` | 与 `G1` 同级，无投影 |

**为什么无效**：这类标签描述的是「光照效果」，模型只能把它们当成画面元素去贴，无法据此重建光路。加提亮词得到均匀补光，加阴影词得到额外的阴影形状。

#### 具体光源物体有效（`L1`–`L3`）

当画面内存在**可被指认的光源物体**时，模型会自行推导光路，产生定向光与真实投影：

| 场景 | 关键光源标签 | 实测光影表现 |
| --- | --- | --- |
| 夜晚篝火夜谈 | `campfire, bonfire, firelight, warm_light, dark_background, sparks` | **火光从下方照亮脸、腿与裙摆**，头发边缘透光，暗部保留星空冷调 |
| 中世纪街道晴天 | `day, sunny, medieval_street, cobblestone, sunbeams` | 角色朝画面伸手，**发丝出现逆光边缘光**，地面有建筑投下的斑驳阴影 |
| 晨光起床 | `morning, sunrise, sunlight_through_window, window, bed, sunbeams` | **窗光从右侧照亮半边脸与头发**，另一侧为柔和阴影，方向明确 |

三张均一次成型，无需任何光照修正标签。

#### 标准光位 tag 有效（`U1`–`U3`）

Danbooru 有一组专门描述光源方向的 tag，比自然语言描述可靠得多：

| tag | 含义 |
| --- | --- |
| `backlighting` | 逆光，光源在角色背后 |
| `overlighting` | 上方打光，顶部过曝 |
| `underlighting` | 下方打光，自下而上 |
| `sidelighting` | 侧面打光 |
| `bloom` | 泛光 |
| `vignetting` | 暗角 |

三个场景按正确光位重画（`cfg_rescale = 0.42`、`A4_NOEXPR` 角色串、负面前置 `2.0::backlighting, overlighting::` 抑制反向光）：

| 场景 | 光位 tag | 实测光影 |
| --- | --- | --- |
| 篝火夜谈 | `campfire, bonfire, underlighting, firelight` | **火光自下而上照亮腿部、裙摆与下半脸，上半身与头发保持冷调阴影**，形成上下分割的强对比 |
| 中世纪街道 | `day, sunny, medieval_street, cobblestone, sidelighting` | **左半身受光、右侧落影，石板路上出现明确的角色投影**，发丝有侧向高光 |
| 晨光起床（跪坐） | `morning, sunrise, sunlight_through_window, sidelighting` | 跪坐 `kneeling, seiza, on_bed` 到位，右侧窗光照亮半边头发与脸，另一侧留暗 |

要点：

- **光位 tag 必须与实际光源位置一致**。篝火在角色下方，所以用 `underlighting` 而不是 `sidelighting`；窗在侧面，用 `sidelighting`。
- **负面提示词要抑制反向光位**（`backlighting`、`overlighting`），否则模型可能把光放到背后。
- 与 `1.6::cel_shading, flat_color, strong_shadows, hard_shadow, two_tone_shading::` 组合，能得到完整的赛璐璐明暗关系。

#### 工程结论

- **需要定向光时，两只手都要用**：画面里放可指认的光源物体（篝火、窗户、太阳、灯笼、蜡烛），再加 Danbooru 标准光位 tag（`underlighting` / `sidelighting` / `overlighting`）指明方向。
- **不要写自然语言光照描述**：`light from front`、`key light`、`cast_shadow`、`bangs casting shadow` 这类写法只会得到均匀提亮或伪阴影，甚至诱发多余的头部或手部。真正无效的是这种描述方式，不是光照 tag 本身。
- **负面提示词抑制反向光位**：`2.0::backlighting, overlighting::` 前置，可避免模型把主光放到角色背后。
- 带参考图集（`gallery/`）的光照正确来自母版参考图本身的高调正面平光；无参考模式下，**光源物体 + 光位 tag 同样能获得正确的光路**，不必依赖参考图。
- 仍需注意：光源只写在**背景**（星空、月光、远处发光物）且没有光位 tag 时，模型会把主光放在角色身后，导致脸部成为暗面——这是 `C1` 的成因。

#### 赛璐璐阴影与明暗对比（`S1`–`S3`、`T1`–`T3`）

一个反直觉的事实：`gallery/portraits/P03`、`P04` 的赛璐璐阴影**不来自任何阴影标签**。逐字检查它们的 `base_caption` 与 `char_caption`，只有画师串、构图词、角色描述与动作表情，没有任何 `cel_shading`、`shadow`、`dramatic_lighting`。

它们的赛璐璐观感来自四处配置：

1. **精确参考 `character` `0.65 / 0.60`**：母版参考图本身是赛璐璐渲染，模型直接复制了该着色结构；
2. **画师串保持原权重**（`3::fugtrup::`、`2.3::dino::`）；
3. **`cfg_rescale = 0.44`**：比 `0.45`/`0.50` 保留更多明暗对比；
4. **纯白背景**：没有背景光参与色彩预算，角色的明暗关系最清晰。

关闭参考后，赛璐璐阴影必须靠显式标签建立。实测两档强度（同种子、`A4_NOEXPR` 角色串）：

| 实验 | 追加标签 | `cfg_rescale` | 效果 |
| --- | --- | ---: | --- |
| `S1` / `S2` / `S3` | `1.3::cel_shading, strong_shadows, chiaroscuro::`（`S2`、`S3` 另加 `1.2::rim_light, backlit_hair::` / `light_on_hair`） | `0.44` | 光影明显强于无标签版：篝火光自下而上照亮腿部与裙摆，街道出现地面投影与发丝边缘光 |
| **`T1` / `T3`** | **`1.6::cel_shading, flat_color, strong_shadows, hard_shadow, chiaroscuro, two_tone_shading::`** | **`0.42`** | **极致色块化：腿部明暗分界锐利，半边脸与半边头发落入冷调阴影，赛璐璐质感最强** |

有效标签清单（按贡献排序）：

```
1.6::cel_shading, flat_color, two_tone_shading::   # 着色方式：色块化、双色调
1.5::strong_shadows, hard_shadow::                 # 阴影强度与硬度
1.3::chiaroscuro::                                 # 明暗对照法，强化主光与暗部反差
1.2::rim_light, light_on_hair, backlit_hair::      # 头发与轮廓的大面积受光
```

配合把 `cfg_rescale` 从 `0.45` 降到 `0.42`，对比度进一步放开。注意这与「过曝时提高 `rescale`」的方向相反：**压缩过曝用高 `rescale`，追求强光影用低 `rescale`**。

仍需先满足前面那条前提：**画面里必须有可指认的光源物体**（篝火、窗户、太阳），否则这些标签只能得到整体提亮或伪阴影。

#### 篝火场景专项：火堆位置与尺寸决定光影强度（`C1`–`C7`）

同为「夜晚、星空、篝火、`underlighting`」，画面效果差异极大。七组变体（`cfg_rescale = 0.42`、`1.6::cel_shading, flat_color, strong_shadows, hard_shadow, two_tone_shading::`）：

| 实验 | 火堆位置与描述 | `underlighting` 权重 | 实测光影 |
| --- | --- | ---: | --- |
| `C1` | 画面底部边缘，`campfire, bonfire` | `1.6` | 光只到腿脚，脸部仍为冷调 |
| `C2` | 底部，`from_below` 低机位 | `1.6` | 仅脚部受光 |
| `C3` | 左下角，`log, forest` | `1.6` | 腿与裙摆受光，脸未受影响 |
| `C4` | **正下方大火焰**，`sitting_on_ground` | `1.6` | 手、腿、下巴均受光，但**腿部与火焰重叠，人物像坐在火里** |
| `C5` | 前景中央，`campfire_in_foreground` | `1.6` | 手部受光，脸部仍弱 |
| `C6` | **右前方地面**，`sitting_on_log, campfire_in_front, large_fire` | `1.6` | 腿、裙摆、下半脸均被暖光照到，姿态自然，伸手互动感好 |
| **`C7`（光影最强）** | **左侧**，`sitting_on_ground, campfire_beside, large_fire` | `1.6` | **左半身、腿部与脸大面积暖光，与右侧星空形成强冷暖对比** |

关键结论：

1. **火堆必须进入画面且足够大**。只写 `campfire` 而让火堆待在画幅底部边缘时，光只能照到腿脚；`large_fire` 才让火光具备照到脸的量级。
2. **`underlighting` 权重提到 `1.6::`**，弱权重（`1.0`）几乎看不出仰光效果。
3. **火堆位置**：正下方（`C4`）光影正确但会与身体重叠；**侧向（左右）效果最好**，能同时保住姿态完整与脸部受光。
4. **机位收近到 `cowboy_shot`**，脸部占比更大，光影关系才读得出来；全身景别下脸太小，逆光/仰光都不明显。
5. **POV 结合**：`pov, facing_viewer, looking_at_viewer, talking` 能形成「少女与观者对坐夜谈」的构图，与 `pov` 配合时前景可以留观者的视角。

推荐配方（篝火夜谈）：

```
base_caption: 画师串 + 1girl, solo, pov, sitting_on_ground, cowboy_shot,
              night, starry_sky, campfire_beside, large_fire,
              1.6::underlighting, firelight::, dark_background, sparks
              + 1.6::cel_shading, flat_color, strong_shadows, hard_shadow, two_tone_shading::
              + 1.4::no_text::
char_captions: A4_LEAN + sitting, facing_viewer, talking, holding_cup, warm_smile
negative:      2.0::backlighting, overlighting:: 前置
cfg_rescale:   0.42
```

#### 氛围感与浪漫感的标签组合（`D1`–`D3`）

`C1`–`C7` 解决了光影结构，但画面偏「图解」而缺少情绪。补上氛围标签后（同构图、同种子 `2948694501`、`cfg_rescale = 0.42`）：

| 实验 | 氛围标签 | 着色标签 | 画面表现 |
| --- | --- | --- | --- |
| `D1` | `dark, bloom, soft_focus, depth_of_field, bokeh, light_particles, fireflies, vignetting` | `1.2::cel_shading, chiaroscuro, colored_shadow::` | 银河下的草地、稀疏萤火、柔焦光斑，最温和 |
| `D2` | `dark, bloom, depth_of_field, bokeh, light_particles, fireflies, forest` | `1.3::cel_shading, strong_shadows, hard_shadow, chiaroscuro, colored_shadow::` | 松林剪影 + 密集萤火，火光与林地冷调对比强 |
| **`D3`（最具叙事感）** | `dark, darkness, bloom, lens_flare, depth_of_field, bokeh, light_particles, fireflies, vignetting, volumetric_light` | `1.3::cel_shading, chiaroscuro, silhouette::` | 城堡剪影与流星出现在远景，萤火密集，电影质感最强 |

贡献最大的三个标签：

1. **`fireflies`**：夜空下的黄绿色光点，是「浪漫」最直接的视觉符号。单这一项就把画面从技术演示变成有情绪的场景。
2. **`depth_of_field` + `bokeh`**：前景光斑与远景虚化拉开空间层次，避免所有元素都平铺在同一个焦平面上。
3. **`dark` / `darkness`**：压低整体明度，让火光成为唯一暖色主体；缺少它时画面会被拉亮成傍晚而非深夜。

`shadow` 这个 tag 在 Danbooru 上专指**特别强或有趣的阴影**，普通明暗不算；硬边赛璐璐的正式标签是 `anime_coloring`。可用类型还包括 `colored_shadow`（火光下的阴影带暖色）、`face_in_shadow`、`silhouette`、`vignetting`、`drop_shadow`。

**硬阴影与柔光需要分别加权、分开使用**：`1.3::cel_shading, strong_shadows, hard_shadow::` 负责结构，`bloom, soft_focus, bokeh` 负责情绪。把两者都推到高权重会互相抵消，出现硬边块面配模糊光斑的割裂感。

推荐组合（篝火夜谈·浪漫版）：

```
base: 画师串 + 1girl, solo, pov, sitting_on_ground, cowboy_shot,
      night, starry_sky, campfire_beside, large_fire,
      1.6::underlighting, firelight::,
      dark, bloom, depth_of_field, bokeh, light_particles, fireflies, vignetting,
      1.3::cel_shading, chiaroscuro, colored_shadow::, 1.4::no_text::
char: CAMP_LEAN（231 tokens）+ sitting, facing_viewer, talking, holding_cup, warm_smile
neg:  2.0::backlighting, overlighting:: 前置
rescale: 0.42
```

#### 动作差分：安静倾听的四种姿态（`I1`–`I4`）

D 组三套配方的差别只在背景与着色强度（`D1` 柔光草地 / `D2` 松林强阴影 / `D3` 城堡剪影 + 体积光）。把动作统一改成「闭嘴 + 微笑 + 看镜头」后，四种差分（同配方、不同种子）：

| 实验 | 背景配方 | 动作追加 | 效果 |
| --- | --- | --- | --- |
| `I1` | `D1` 柔光 | `both_hands` | 双手捧杯，火光自左侧照亮，最温和 |
| `I2` | `D2` 松林 | `head_tilt` | 歪头倾听，右侧受光左侧落影，松林与银河压底 |
| `I3` | `D3` 城堡 | `hand_on_own_cheek` | 托腮静听，火光正前方照亮，城堡剪影在远景 |
| **`I4`（最佳）** | `D3` 城堡 | `leaning_forward, relaxed` | 前倾靠近火堆，晚霞与城堡剪影，萤火密集，叙事感最强 |

动作词模板：

```
char 追加: , sitting, facing_viewer, looking_at_viewer, closed_mouth, smile, holding_cup
变体追加: both_hands / head_tilt / hand_on_own_cheek / leaning_forward, relaxed
```

两个必须注意的点：

1. **必须先摘掉母版的固定表情**。母版角色串自带 `smile, blush, closed_mouth, happy`，不摘除时追加的 `closed_mouth`、`calm_expression` 会被压制，所有差分都会是同一张固定笑face。
2. **`closed_mouth` 与 `smile` 可以共存**，组合结果是抿嘴微笑，正是「安静倾听」需要的表情；若只写 `smile` 常会变成张嘴笑。

#### 光影强度的权重边界（`J1`–`J4`）

「光影太小」的实质是受光面积不足。四档权重递增（去掉了 `holding_cup`，改为托腮 `hand_on_own_cheek`，同种子 `2948695104`）：

| 实验 | `underlighting` | `cel_shading` 组 | `cfg_rescale` | 结果 |
| --- | ---: | ---: | ---: | --- |
| `J1` | `2.0::` | `1.6::` | `0.40` | 光影克制，只有局部受光 |
| `J2` | `2.3::` | `2.0::` | `0.38` | 明暗分界明确，腿部与脸部同时受光 |
| **`J3`（最佳）** | **`2.6::`** | **`2.3::`** | **`0.36`** | **前景出现大面积被火光照亮的地面，角色坐在亮区内，与暗背景形成强对比** |
| `J4` | `3.0::` | `2.5::` | `0.34` | **过曝崩坏：画面底部出现两块纯白矩形** |

结论：

1. **`underlighting` 的上限在 `2.6::`**，`cel_shading` 组上限在 `2.3::`；再往上会突破动态范围，出现不可控的纯色块面。
2. **`cfg_rescale` 与权重配合下探到 `0.36`**，配合 `2.6::underlighting` 才能让「受光地面」的面积撑开；单独降 `rescale` 不会扩大受光区。
3. **扩大光影面积靠的是光源量级**（`large_fire` + 高权重 `underlighting`），不是靠提高 `chiaroscuro` 本身；`chiaroscuro` 只负责反差，不负责面积。
4. **去掉手持道具后改托腮**（`hand_on_own_cheek`）更适合「安静倾听」的语境，也避免了杯子在强逆光下过曝成白块。

#### 角色的长投影：给地面加一层纵深（`E5`–`E6`）

画面只有「背景 + 角色」两层时容易显得平板。让角色自己的影子落到地面，就多出一层，且影子方向能反向印证光源位置。

Danbooru 上对应的两个 tag：

| tag | 定义 |
| --- | --- |
| `long_shadow` | 相对投射者很长的影子，常见于低角度光源（日落、篝火） |
| `colored_shadow` | 非黑色的影子；纯黑影子只用 `shadow` |

实测（`E5`/`E6`，`1.5::long_shadow, colored_shadow, shadow::`）：

| 实验 | 场景 | 结果 |
| --- | --- | --- |
| `E5` | 银河草原 | 沙漠/草地质感变强，但篝火在正前方，影子被角色与火堆遮挡，读不出来 |
| **`E6`（采纳）** | 城堡剪影 + 湖面 | **画面底部出现两道向外的长投影**，贴地延伸，地面层次与纵深同时成立 |

结论：

1. **影子方向必须与光源一致**。篝火在角色正前方时，影子会被身体挡住；光源在**侧前方**、角色略微侧坐时，长投影才会落到可见的地面上。
2. **`colored_shadow` 在火光场景很关键**。火光下的影子应带暖褐或暗橙，而不是纯黑；纯黑影子会和夜空糊在一起。
3. 长投影天然带「低机位 + 贴地」的透视，和 `cowboy_shot` 组合能拉出地面的延伸感，这是单纯加背景元素做不到的。

推荐组合：

```
base 追加: 1.5::long_shadow, colored_shadow, shadow::
```

#### 奇幻星体：丰富星空的四种写法（`F1`–`F4`）

`starry_sky` + `milky_way` 只能得到常规夜空。加入具体天体后，夜空本身成为叙事元素。四组（`from_below` 仰视 + D 组氛围配置 + 安静倾听姿态）：

| 实验 | 天体标签 | 画面 |
| --- | --- | --- |
| `F1` | `1.4::giant_planet, nebula::` + `shooting_star, constellation` | 右上角巨型行星的弧边与大气光晕，蓝色星云横贯，流星划过 |
| `F2` | `1.4::full_moon, crescent_moon::` + `nebula` | 双月同框（满月与新月交叠），银河与星云铺底 |
| `F3` | `1.4::aurora, nebula::` + `shooting_star` | **绿色极光帘幕**垂直落下，松林剪影压在底部 |
| **`F4`（最超现实）** | **`1.4::giant_planet, ringed_planet, nebula::` + `floating_islands`** | **左上巨行星占据大片天空，空中漂浮岩石碎片**，配合萤火形成异星感 |

要点：

1. **`nebula` 是必需的底色**。没有它，天体只是贴在纯黑天幕上的贴纸；有星云后，空间才有体积。
2. **`giant_planet` 产生「占据画面的行星」**，视觉冲击最大；`ringed_planet` 单独使用时效果不明显，需要与 `giant_planet` 组合。
3. **`floating_islands` 在星空场景会涌现为漂浮岩块**，是「超现实」感的来源，比单纯加行星更有效。
4. **`from_below` 仰视与天体天然契合**：角色坐在火边抬头，天体占据画面上半部，构图重心自然上移，篝火压在下缘作为暖色锚点。
5. 天体词权重给到 `1.4::` 才压得住画师串对背景的影响；不加权重时天体常被画成普通星星。

#### 基于强光影基线的星体版本（`G1`–`G4`）

`F` 组为了塞进氛围标签，把着色权重从 `1.6::` 降到 `1.3::`，画面变柔但丢了强赛璐璐的明暗结构。改为**固定 C2 的构图与种子（`2948694402`）+ `1.6::cel_shading, flat_color, strong_shadows, hard_shadow, two_tone_shading::` + `from_below` + `cfg_rescale = 0.42`**，只叠加氛围与星体：

| 实验 | 星体 | Token | 画面 |
| --- | --- | ---: | --- |
| `G1` | `nebula` | `507` | 星云铺底，强色块光影保留 |
| `G2` | `1.4::giant_planet, nebula::` | `503` | 巨行星弧边压在上方，青蓝星云，bokeh 光斑 |
| `G3` | `1.4::aurora, nebula::` | `510` | 绿色极光帘幕 + 强火光对比 |
| **`G4`（最佳）** | **`1.4::giant_planet, ringed_planet, nebula::` + `floating_islands`** | `500` | **巨行星占据上半幅天空，星云与萤火铺满，色块化光影最完整** |

关键点：

1. **着色权重不能为氛围让路**。`1.6::` 的强赛璐璐是「光影感」的来源，降到 `1.3::` 会让画面回到柔光状态。
2. **同种子可对比**。四张与 `C2` 共用 `2948694402`，只改星空部分，便于判断天体标签的实际贡献。
3. **角色串必须精简到 `221` tokens**（`CAMP_LEAN2`，摘除 `lace_trim`/`garter_straps`/`chest_ribbon`/`long_ribbon`），否则叠加氛围与星体后必然超过 512。
4. **篝火位置沿用 C2 会与腿部重叠**（光影正确但构图略挤）；若在意这点，可把 `campfire` 换成侧前方位置，代价是牺牲部分仰视感。

### 无参考与带参考的能力边界

| 维度 | 带精准参考（`character` `0.65 / 0.60`） | 关闭参考（纯文本） |
| --- | --- | --- |
| 半身/全身角色一致性 | 高，面部与发型稳定 | 中，脸型更圆、眼睛略小，可辨识为同一角色 |
| 场景远景角色结构 | 稳定 | 需显式补全身锚点，否则肢体缺失 |
| **光照结构（定向主光、投影）** | 正确，由参考图提供 | 据画面内光源物体推导可达正确，抽象光照词无效 |
| 构图与笔触自由度 | 受参考约束 | 更高，画面更放飞 |
| 适用场景 | 官方图集、宣传物料、需要严格一致性的成品 | 快速探索、批量差分、非人形形态 |

无参考批次的探索结果保留在 `.local/brand/mascot/current/` 下（按批次命名），不进入 Git。

## 8. 用 style 参考替代画师串（推荐方案）

### 动机

画师权重串占 **144 Tokens**（`base_caption` 的 31%），且只能提供「笔触倾向」，无法提供光照结构。实测发现，改用精确参考的 `reference_type = "style"` 并**完全去掉画师串**，可以得到更好的综合效果。

### Vibe Transfer 不可行

先测试了 Vibe Transfer（`reference_image_multiple` + `reference_information_extracted_multiple` + `reference_strength_multiple`），6 组强度全部失败：

| 实验 | `information_extracted` | `strength` | 结果 |
| --- | ---: | ---: | --- |
| `V1` | `0.7` | `0.6` | 构图被完全锁定为母版：白底站姿、手持书、书堆底座 |
| `V2` | `0.7` | `0.9` | 同上，更强 |
| `V3` | `1.0` | `0.7` | 同上 |
| `V4` | `0.7` | `0.25` | 开始响应文本（书架室内），但母版的书堆、木地板、黑色皮鞋仍被注入 |
| `V5` | `0.7` | `0.35` | 同上，书桌与书本元素仍强 |
| `V6` | `0.5` | `0.45` | 同上 |

**原因**：Vibe 编码的是整幅图像的全局特征，包含布局、道具、材质；它没有「只取画风」的通道。降低强度只会让构图混合得更脏，不会变成纯风格。

### style 参考可行

改用精确参考的 `style` 类型、同时移除画师串，构图完全交还给文本：

| 实验 | `strength` | `fidelity` | 结果 |
| --- | ---: | ---: | --- |
| `S1` | `0.7` | `0.6` | 构图正确，画面最通透，脸部干净 |
| `S3` | `0.5` | `0.5` | 构图正确，细节略多，亮度稍低 |
| `S2` | `0.9` | `0.8` | 构图正确，笔触最贴母版（金边、光影层次最接近） |
| `S4` | `0.9` | `0.8` | 场景档（螺旋图书馆）验证通过，透视与角色结构完整 |
| `S5` | `0.9` | `0.8` | 全身档（星海织星）验证通过 |

**关键收益**：

| 指标 | 画师串方案 | style 参考方案 |
| --- | --- | --- |
| 正向 Token（全身档） | `466` | **`323`（省 143）** |
| 正向 Token（半身档） | `434` | **`285`（省 149）** |
| 正向 Token（场景档） | `450` | **`307`（省 143）** |
| 光照结构 | 不可控（脸部易背光） | 由参考图提供，脸部正面受光 |
| 构图自由度 | 高 | 高（与画师串方案相同） |
| 笔触一致性 | 中 | 高（直接复制母版笔触） |

**推荐配方（无画师串）**：

```
base_caption:   构图与场景词（不含任何 artist: 权重）
char_captions:  Tier-1/2/3 角色母版 + 1.25::lolita_fashion:: + 动作表情差分
Precise Reference: reference_type = "style", strength = 0.9, fidelity = 0.8
                   （追求更通透可降到 0.7 / 0.6）
cfg_rescale:    0.45
steps:          28
```

省下的 143–149 Tokens 应优先分配给场景环境与光影描述，而不是加回画师串。

## 9. 画师串的功能分层与 style 兼容性

### 三层结构

母版 `base_caption` 的 21 位画师不是等价堆叠，按作用分为三层：

| 层级 | 画师 | 作用 |
| --- | --- | --- |
| 画法层 | `nekodayo22`（最关键）、`freng`、`liduke` | 决定线条组织、笔触密度、细节收放，是风格骨架 |
| 氛围层 | `dino (dinoartforame)`、`bm94199`、`cutesexyrobutts` | 决定光影强度、空气感与色彩氛围 |
| 调色层 | `dishwasher1910`、`ru_zhai`、`gtunver`、`wita_hika`、`seito_edaha`、`c (theta)`、`cian_yo`、`q_azieru`、`agoto`、`wanke`、`quasarcake`、`zankuro`、`goldenmiocola`、`zynxy` | 微调色相与对比，可整体删除 |

### `fugtrup` 的权重问题

`fugtrup` 在母版中权重为 **`3::fugtrup::`**，是全串最高值。三组同种子对照（`F1`–`F3`，均不挂 style 参考）：

| 实验 | 权重 | 结果 |
| --- | --- | --- |
| `F1` | `3.0`（原始） | 画面整体偏红紫，脸部与头发带明显紫色调，饱和度偏高 |
| `F2` | `1.0` | 色彩恢复中性，脸部白净通透 |
| `F3` | 移除 | 与 `F2` 接近，偏粉调 |

结论：`fugtrup` 是色彩失真的主要来源，应降至 `1.0` 以下或直接删除。

### 画师标签的书写格式（`bm94199` 的踩坑）

`bm94199` 在母版中写作 **`1.5::bm94199 ::`**（`bm94199` 与 `::` 之间有一个尾随空格）。若按常规格式改写成 `1.5::bm94199::`，会出现两类故障：

| 场景 | `1.5::bm94199::`（无尾随空格） | `1.5::bm94199 ::`（母版原样） |
| --- | --- | --- |
| 无参考生成 | HTTP `500 Internal Server Error` | 正常出图 |
| 配合 `style` 参考 | 输出整幅彩色噪点 | 正常出图（`R1`） |

因此此前的「`bm94199` 与 style 参考 embedding 冲突」是误判，真实原因是**标签写法解析失败**。工程规则：**母版画师串必须逐字符原样复用，不要手工改写权重格式**；需要调整强度时用整体缩放，不要重排标签。

早期含 `1.5::bm94199::` 的组合（`T1`、`T3`、`K2`、`K3`）崩溃均由此引起，重写为带空格形式后全部恢复。

### 压制饱和度的三条有效手段

`K1`（画法三人 + `style 0.9/0.8` + `rescale 0.45`）结构正确但饱和偏高。四组压制对照（`M1`–`M4`）：

| 实验 | 画师 | `style` | `cfg_rescale` | 结果 |
| --- | --- | --- | ---: | --- |
| `K1` 基准 | 三人 | `0.9/0.8` | `0.45` | 色彩偏浓、红区发烫 |
| `M1` | 三人 | `0.9/0.8` | `0.50` | 饱和略降，但背景发闷 |
| `M2` | 三人 | `0.7/0.6` | `0.45` | 明显柔和，画面偏暖橙 |
| `M3` | 三人 | `0.7/0.6` | `0.50` | 柔和且明亮 |
| **`M4`（采纳）** | **二人（去 `liduke`）** | **`0.7/0.6`** | **`0.48`** | **明亮通透、脸部干净、饱和适中、金边清晰** |

压制优先级：**降低 `style` 强度 > 提高 `cfg_rescale` > 减少画师数量**。把 `cfg_rescale` 单独推到 `0.50` 只会让背景发闷。

### 画师权重与人数：三人组优先

按原权重保留画法层二人（`V01`–`V04`）时，4 个构图只有 1 张达标：画风被拉向 `nekodayo22` 的单色平涂，头发偏紫、脸偏灰、猫形态被人形污染。

但把权重压到 `0.6::nekodayo22::, 0.5::freng::`（`W01`/`W02`）虽然稳定，**笔触会变薄**，失去 `liduke` 提供的厚度与金边层次。因此推荐保留完整画法三人组，通过 `style` 强度与 `cfg_rescale` 压制饱和。

### 三人组参数网格（`X1`–`X4`，同种子 `2948686112`）

| 实验 | 画师 | `style` | `cfg_rescale` | 画面特征 |
| --- | --- | --- | ---: | --- |
| `X1` | 三人 | `0.8/0.7` | `0.47` | 笔触完整，明亮，饱和中高 |
| `X2` | 三人 | `0.8/0.7` | `0.50` | 压制最狠，但背景发闷、脸部偏灰 |
| `X3` | 三人 | `0.9/0.8` | `0.47` | 笔触最厚，饱和最高 |
| **`X4`（推荐）** | **三人 + `0.5::cutesexyrobutts::`** | **`0.85/0.75`** | **`0.48`** | **金边细节与通透度平衡最佳，饱和适中，脸部干净** |

压制饱和度时不要再减少画师人数——`liduke` 决定厚涂质感，删掉后画法层次直接下降。

### 三种参考方式的成本与质量对比

同一批 4 个主题（半身茶歇、全身织星、场景图书馆、猫形态）分别用三种方式生成，逐张比对：

| 方式 | 单张 Anlas | 画法细节 | 光照 | 构图自由度 | 稳定性 |
| --- | ---: | --- | --- | --- | --- |
| 精确参考 `character` | `5` | 最高（金边、蕾丝、厚涂分层完整） | 母版光照，脸部正面受光 | 高 | 高 |
| 精确参考 `style` | `5` | 高（金边与蕾丝到位，偶有色彩过载） | 母版光照 | 高 | 高 |
| Vibe Transfer | `0`（编码一次 `2`，可复用） | 中（画面柔化、细节简化、对比度偏低） | 柔光，缺乏方向性 | 基本自由（偶发白底污染） | 中 |
| 纯 tag（无参考） | `0` | 中低（平涂、金边常整块缺失） | 环境光偏暗 | 完全自由 | 高 |

三组实拍结论：

1. **Vibe `strength = 0.3` 已经不锁构图，但会把母版的白背景与低对比度一起带进来**（`C_02` 出现约四成画幅的灰白空白），细节密度不如精确参考。
2. **纯 tag（完整画师串 + `fugtrup 1.0`）能消除红紫失真，但补不回画法密度**：金边、蕾丝分层大量缺失，整体偏暗。
3. **成本换质量**：`5 Anlas/张` 的精确参考仍是成品唯一可靠方案；`0 Anlas` 的 Vibe 与纯 tag 适合批量探索、构图试错与差分筛选，入选后再用精确参考重出。

### 大面积底色过载的处置

`cosmic_background` 与 `glowing_threads` 叠加高权重画法串时，画面会出现紫青大面积混色。两组修复对照（`A02_fix1`、`A02_fix2`）：

| 实验 | 手段 | 结果 |
| --- | --- | --- |
| `A02_fix1` | 移除 `glowing_threads` | 略收敛，背景仍偏紫青 |
| **`A02_fix2`（采纳）** | 负面前置 `1.5::colorful, rainbow, multicolored, chromatic_aberration, oversaturated::` | 色彩均匀、脸部干净、金边清晰 |

负面抑制有效但无法消除背景色的固有色调——那是 `cosmic_background` 本身的色相。需要更中性的宇宙背景时，改用 `night_sky, starry_sky` 替代 `cosmic_background`。

### 最终推荐配方

```
base_caption:   nekodayo22, 1.2::freng::, 1.4::liduke::   # 画法三人组，保留原权重
                可选 + 0.5::cutesexyrobutts::              # 需要暖氛围时
                构图与场景词
                1.4::no_text::
                ← 必须删除 bm94199（崩溃）与 fugtrup（色彩失真）
char_captions:  Tier-1/2/3 角色母版 + 1.25::lolita_fashion:: + 动作表情差分
Precise Reference: reference_type = "style", strength = 0.85, fidelity = 0.75
cfg_rescale:    0.48
steps:          28
```

正向 Token：半身档 `307`、全身档 `339`、场景档 `324`，距 512 上限仍有 170 以上余量。

若完全去掉画师串（仅 `style 0.9/0.8`），画风同样贴母版且稳定性最好（`S1`–`S5` 五个构图全部达标，Token 再降约 30），可作为无画师串的保底方案。

## 10. 母版 tag 直接复用（当前效果最佳）

把母版 `base_caption` 与 `char_captions[0]` **逐字复用**、只替换姿势动作词，是不挂参考时最接近母版画质的路线。实测明显优于降权画师串（后者约为母版 80% 的观感）。

### 方法一：母版串原样 + 换姿势

```
base_caption:  母版画师串逐字保留（含 3::fugtrup::、2.3::dino (dinoartforame)::）
               + 构图词（simple_background / white_background / 机位）
char_captions: 母版角色串逐字保留，仅摘除站姿词 standing
               + 目标姿势动作词
Precise Reference: 不挂
cfg_rescale:   0.45
```

三张验证（`M1`–`M3`）：坐姿读书、伸手摘星、侧身回望均保持了母版的厚涂质感、金边层次与脸部色调；坐姿与伸手两张达到可直接使用的水平，侧身回望姿势未被完全执行（仍为正面站姿），属抽卡范围。

**必须替换表情词，不能只加不动**。母版角色串内含固定表情 `smile, blush, closed_mouth, happy`，若不摘除，追加的 `serious_expression`、`surprised` 等会被压制，所有差分都会是同一张笑脸。摘除后（`Z1`、`Z2`，同种子 `2948689002`）：

| 实验 | 追加表情 | 结果 |
| --- | --- | --- |
| `Z1` | `serious_expression, focused, parted_lips` | 表情转为平静专注 |
| `Z2` | `surprised, wide_eyes, open_mouth, blush` | 张嘴惊讶，表情明显变化 |

注意母版原文是 `smile, blush, closed_mouth, happy`（`blush` 夹在中间），按 `smile, closed_mouth, happy` 去替换会匹配失败，需按实际片段处理。摘除这四个词后角色串从 `308` 降到 `298`，正好腾出表情差分的空间。

**Token 是硬约束**：母版角色串占 `330`，加画师串与构图后总量达到 `505–509`，仅剩个位数余量。实测两种溢出处理：

| 情况 | `u_total` | 处理 |
| --- | ---: | --- |
| 伸手姿势原方案 | `516` | 超限被拒，需精简 |
| 摘除 `fantasy_clothes`、`jewelry`、`bridal_legwear` | `505` | 通过 |
| 场景档（构图词更长） | `518` | 再摘 `stirrup_legwear`、`floating_books`、`god_rays` 后降到 `509` |

这说明**母版串 + 复杂姿势/场景几乎必然逼近上限**，必须预留精简预算。

### 方法二：母版串 + 降低高权重画师 + 提高 `cfg_rescale`

在母版串上只压缩四个高权重项，其余原样：

| 项目 | 母版权重 | 调整后 |
| --- | ---: | ---: |
| `fugtrup` | `3.0` | `1.5` |
| `dino (dinoartforame)` | `2.3` | `1.0` |
| `zynxy` | `1.6` | `1.0` |
| `bm94199 ` | `1.5` | `1.0` |

配合 `cfg_rescale = 0.50`，角色串使用精简版（摘除 `fantasy_clothes`、`jewelry`、`bridal_legwear`、`stirrup_legwear`）。

两张验证结果：

| 构图 | `u_total` | 效果 |
| --- | ---: | --- |
| `K_A1` 全身织星（`832 × 1216`） | `505` | 画风贴母版，金边与蕾丝完整，色彩柔和，脸部干净 |
| `K_A3` 螺旋图书馆场景（`1216 × 832`） | `509` | 透视正确，角色受光，金边细节到位 |

两张均达到与母版同级的完成度，明显优于降权方案与 `style` 参考方案。

### 背景对画风的影响（`V1`–`V4` 单变量对照）

同一构图（`from_side, looking_back, walking, holding_book`）、同种子 `2948692203`，只改一个变量：

| 实验 | 画师权重 | `cfg_rescale` | 背景 | 画面表现 |
| --- | --- | ---: | --- | --- |
| `V1`（= `M3`） | 母版原值 | `0.45` | 纯白 | 最厚实，金边与缎面质感最完整 |
| `V3` | 降到 K 档 | `0.45` | 纯白 | 略平，金边层次减一档 |
| `V2` | 母版原值 | `0.50` | 纯白 | 更淡，对比下降，细节收缩 |
| `V4` | 母版原值 | `0.45` | 星海 | 角色画风保持，但背景色渗入画面 |

影响排序：**背景 > 画师权重 > `cfg_rescale`**。

- **纯白背景给画风留出全部表达预算**，金边、蕾丝、缎面的分层才立得住；换成宇宙或室内场景后，背景自身要占用色彩表达，画面容易变脏。
- **原权重画师串提供笔触浓度**，压到 `1.5 / 1.0` 后层次明显变平，这就是「降权方案只有母版约 80%」的来源。
- **`cfg_rescale = 0.50` 会伤细节**，它在压制过曝的同时降低对比。只在确实过曝时才提高，`0.45` 是常规值。

### 带场景时原权重与色彩的取舍

用原权重画师串 + `rescale 0.45` 重画 A1/A3（角色串用摘表情精简版，`298` tokens）：

| 构图 | `u_total` | 笔触密度 | 色彩 |
| --- | ---: | --- | --- |
| `A1` 全身织星 | `495` | 明显优于 `K_A1`，金边与缎面分层完整 | 偏紫，星海色相被高权重放大 |
| `A3` 螺旋图书馆 | `503` | 明显优于 `K_A3`，蕾丝与金边清晰 | 偏紫红，背景冷光被放大 |

对照 `K` 组（降权 + `rescale 0.50`）：

| 配置 | 笔触 | 色彩 |
| --- | --- | --- |
| 原权重 + `0.45` | 厚，层次多 | 偏紫，对比强 |
| 降权 + `0.50` | 薄一档 | 干净柔和 |

两者是直接取舍，不存在同时最优的单一配置。**带大面积发光背景时，优先保色彩干净（降权 + `0.50`）；纯白或弱背景时优先保笔触（原权重 + `0.45`）**。若必须两者兼得，可按 A1/A3 的 `A02_fix2` 方式在负面前置 `1.5::colorful, rainbow, multicolored, chromatic_aberration, oversaturated::` 压制背景色相。

### 三种无参考路线的定位

| 路线 | 与母版接近度 | 姿势自由度 | 适用 |
| --- | --- | --- | --- |
| 母版串原样 + 换姿势 | 最高 | 低（Token 仅剩个位数余量） | 立绘、表情差分 |
| 母版串 + 降权 + `rescale 0.50` | 高 | 中（精简后可放场景词） | 插图、场景 |
| 画师串整体降权 `0.85` | 约 80% | 高 | 批量探索、快速出图 |

## 11. 复现与元数据

完整原始提示词与单图元数据内嵌于 [`master/canonical-lyra-nai45.png`](../master/canonical-lyra-nai45.png) 及 `gallery/` 下各 PNG 文件的 `Comment` JSON 字段中，可直接通过脚本或启动器读取复现。

- 正向提示词：`Comment` 的 `v4_prompt.caption.base_caption` 与 `v4_prompt.caption.char_captions[0].char_caption`
- 负面提示词：`Comment` 的 `v4_negative_prompt.caption.*`
- 精确参考：`Comment` 的 `director_reference_descriptions`（`base_caption` 即参考类型）与 `director_reference_information_extracted`。注意 NAI 回写 `Comment` 时**不回填** `director_reference_strength_values` / `director_reference_secondary_strength_values`，该两项恒为 `null`，不代表未使用参考强度。
