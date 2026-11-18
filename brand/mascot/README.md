# NeuroBook 品牌形象角色（星璃 · Lyra）

本目录是 NeuroBook 官方品牌角色「**星璃 · Lyra**」的**定稿视觉母版、世界观设定、NovelAI V4.5 生成蓝图与精选图集**真相源。

她与 [`brand/logo/`](../logo/README.md) 中赤红书页后的象牙白小猫（`<neurobook-mood>`）互为一体两面：既是执掌天职圣器《万界真典》与「律政星杖」的先天司书，也是认真护书的随身搭档。

## 目录结构

| 路径 | 用途 |
| --- | --- |
| [`master/canonical-lyra-nai45.png`](master/canonical-lyra-nai45.png) | 定稿标准形象参考母版（图 6，`seed = 2948684181`，用于 NAI V4.5 Precise Reference 锚定角色特征） |
| [`guide/01-persona.md`](guide/01-persona.md) | **水面之上（日常必读）**：角色定位、常用名讳与 `Master` 称谓、三重灵魂底色、行事原则与自题古诗《书庭自题》、正反例边界、十大典型场景对话范本、`<neurobook-mood>` 11 状态映射、视觉锚点与日常生活品味 |
| [`guide/02-worldview-and-cosmology.md`](guide/02-worldview-and-cosmology.md) | **冰山之下（按需考据）**：先天司书本源、跨文明古籍尊号、万言星海（4D 星球 / 3D 投影 / 叙事星团）、溯言白洞与宇宙弦、界隙水镜涌字、有限度入世法则、书庭时间体系与「静潮时刻」、双区书架与「记忆宝石」、创世星环、天职圣器与「折页星舟」跨界漫游 |
| [`guide/03-nai45-prompt-engineering.md`](guide/03-nai45-prompt-engineering.md) | **生图指南**：NovelAI V4.5 标准参数（默认 28 步、并发 1）、防失真标定、512-Token T5 分词测算与消融精简指南 |
| [`writings/to-all-things-called-fiction.md`](writings/to-all-things-called-fiction.md) | **星璃自题诗（独立收录）**：现代诗《致所有被称作“虚构”的事物》 |
| [`gallery/portraits/`](gallery/portraits/) | 基于防失真参数生成的角色立绘与状态差分（4 幅） |
| [`gallery/illustrations/`](gallery/illustrations/) | 基于防失真参数生成的角色日常插图（4 幅） |
| [`gallery/scenes/`](gallery/scenes/) | 基于防失真参数生成的世界观宏大场景（4 幅） |

本地探索批次、7 张初筛原图、28 步消融实验及防失真标定对比图保留在 `.local/brand/mascot/current/`，不进入 Git。

应用自带的星璃表情包在 [`packages/neuro-book/src/plugins/stickers/builtin/`](../../packages/neuro-book/src/plugins/stickers/builtin/)：`lyra`（15 张）切自开发者生成的三张 3×3 表情图，`lyra-chibi`（12 张）由 image-gen 以 [`master/canonical-lyra-nai45.png`](master/canonical-lyra-nai45.png) 为参考生成；都抠了图、带白色模切边（`lyra` 的是抠图后补的），缩到 512×512 存 WebP。原图、切格与抠图脚本留在本地 `.local/brand/mascot/stickers/`，不进入 Git；挑选与做法见 [`w00050 t10`](../../.agents/works/w00050-lyra-persona-and-prompts/tasks/t10-lyra-default-stickers/README.md)。

## 标准生成基线（NovelAI V4.5 防失真配方）

- **模型**：`nai-diffusion-4-5-full`
- **默认步数**：`28`（Opus 免费档位上限；接口请求并发严格设为 `1`）
- **采样器与调度**：`k_euler_ancestral` + `karras`（`scale = 7.0`, **`cfg_rescale = 0.44`**, `prefer_brownian = true`, `uncond_scale = 0.0`）
- **精准参考（Precise Reference）**：挂载 [`master/canonical-lyra-nai45.png`](master/canonical-lyra-nai45.png)，在已有画师串的前提下**仅使用人物参考 `reference_type = "character"`**（不用 `style` 或 `character&style`），并将参数控制在 **`strength = 0.65`、`fidelity = 0.60`**（不超过 `0.75`），避免与画师权重叠加造成过饱和失真。
- **512-Token 预算控制**：母版原始提示词在保留下划线口径下占 **485 / 512 Tokens**（余量仅 27 Tokens）。生成立绘、插图与场景时，按 [`guide/03-nai45-prompt-engineering.md`](guide/03-nai45-prompt-engineering.md) 的三档精简母版剔除重复的 `fantasy_clothes`、可自动涌现的 `gold_embroidery` 以及画面外标签，可释放 **51–131 Tokens** 预算。

## 精选图集索引

### 1. 角色立绘（Portraits，`832 × 1216`）

| 文件 | 主题 | Token 用量（`u_total` / `sp_total`） |
| --- | --- | --- |
| [`gallery/portraits/P01_codex_keeper_standing.png`](gallery/portraits/P01_codex_keeper_standing.png) | 《万界真典》司书标准立绘 | `472 / 371` |
| [`gallery/portraits/P02_star_shuttle_weaver.png`](gallery/portraits/P02_star_shuttle_weaver.png) | 「律政星杖」拨弦咏唱动态立绘 | `493 / 386` |
| [`gallery/portraits/P03_curious_cat_tilt.png`](gallery/portraits/P03_curious_cat_tilt.png) | 歪头好奇半身立绘 | `439 / 342` |
| [`gallery/portraits/P04_sleepy_low_phlogiston.png`](gallery/portraits/P04_sleepy_low_phlogiston.png) | 星火燃素匮乏·犯困半身立绘 | `447 / 353` |

### 2. 角色插图（Illustrations）

| 文件 | 主题 | 尺寸 | Token 用量（`u_total` / `sp_total`） |
| --- | --- | --- | --- |
| [`gallery/illustrations/I01_tangled_starlight_threads.png`](gallery/illustrations/I01_tangled_starlight_threads.png) | 闲暇逗弄「星丝」私下俏皮插图 | `832 × 1216` | `498 / 387` |
| [`gallery/illustrations/I02_starlight_tea_recharge.png`](gallery/illustrations/I02_starlight_tea_recharge.png) | 「星火燃素」星光琥珀茶补给插图 | `832 × 1216` | `464 / 359` |
| [`gallery/illustrations/I03_chasing_memory_star_butterfly.png`](gallery/illustrations/I03_chasing_memory_star_butterfly.png) | 捕捉逸散「星屑光蝶」灵动插图 | `832 × 1216` | `486 / 376` |
| [`gallery/illustrations/I04_cushion_nap_with_red_codex.png`](gallery/illustrations/I04_cushion_nap_with_red_codex.png) | 抱书小憩星绒软垫插图 | `1216 × 832` | `498 / 380` |

### 3. 世界观场景（Scenes，`1216 × 832`）

| 文件 | 主题 | Token 用量（`u_total` / `sp_total`） |
| --- | --- | --- |
| [`gallery/scenes/S01_star_memory_atrium_library.png`](gallery/scenes/S01_star_memory_atrium_library.png) | 「忆星书庭」螺旋星穹图书馆主场景 | `435 / 349` |
| [`gallery/scenes/S02_sea_of_myriad_words.png`](gallery/scenes/S02_sea_of_myriad_words.png) | 「万言星海」银河叙事织网宏大场景 | `460 / 364` |
| [`gallery/scenes/S03_astral_observatory_desk.png`](gallery/scenes/S03_astral_observatory_desk.png) | 星象观测阅读台·夜读凝结「记忆宝石」 | `492 / 380` |
| [`gallery/scenes/S04_dawn_at_celestial_balcony.png`](gallery/scenes/S04_dawn_at_celestial_balcony.png) | 书庭破晓露台·万言归档晨景 | `445 / 352` |
