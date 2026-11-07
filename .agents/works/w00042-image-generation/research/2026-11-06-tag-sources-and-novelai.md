# 标签来源、NovelAI 能力与法典图鉴

2026-11-06 的调研。NovelAI 能力读自官方文档的离线副本（主工作区 `.local/novelai-docs/en/image/`，线上站对自动抓取返回 403）；其余写明来源。第三方数据没有进入本仓库。

## 标签来源

| 来源 | 内容 | 授权 | 怎么用 |
|---|---|---|---|
| [tagcomplete](https://github.com/DominikDoom/a1111-sd-webui-tagcomplete) `danbooru.csv` | 约 14 万行：名字、类别、热度、别名 | 仓库 MIT | 基础层的起点。不含 NovelAI 专属词；`extra-quality-tags.csv` 只有 6 个画质词 |
| [Danbooru](https://github.com/danbooru/danbooru) API | `tags`（`name`、`post_count`、`category`、`is_deprecated`、`words`）、别名表、wiki 的 `other_names` | 字段读自开源代码；站点 2026-11-06 维护中（503），限流与条款没读到 | 构建时拉取，不做运行时依赖 |
| NovelAI [Special Tags](https://docs.novelai.net/en/image/tags#special-tags) | 见下一节 | 官方文档 | 转成数据，并入基础层 |
| NovelAI `suggest-tags` | 见下下节 | 非公开接口 | 在线增强，不作真相源 |
| [标签超市](https://github.com/wfjsw/danbooru-diffusion-prompt-builder) | 中文分类、例图、预设 | AGPL-3.0，与本仓库相同 | 中文分类的候选；2024 年后没有更新 |
| [DanbooruSearch](https://huggingface.co/spaces/SAkizuki/DanbooruSearch) | 四层向量的中文语义搜索（bge-m3）、NPMI 共现、画师推荐，有 REST 与 MCP | Space 标 GPL-3.0；[数据管线仓库](https://github.com/SuzumiyaAkizuki/danbooru-tag-pipeline)未声明授权 | 可选的中文与语义层；内置前要确认数据授权，模型体积未测量 |
| [Auto-NovelAI-Refactor](https://github.com/zhulinyv/Auto-NovelAI-Refactor) | 法典图鉴的中文对照词库来自它 | GPL-3.0 | 中文层候选；数据来源与覆盖面没看 |
| [法典图鉴](https://novelai.quicktagcloud.com/) | 见最后一节 | 代码 MIT，数据不可再分发 | 借交互与代码，不用数据 |

知乎那篇（用户给的 `p/2034742851238675889`）返回 403，没读到。

## NovelAI 官方特殊标签

| 类别 | 标签 | 适用模型 |
|---|---|---|
| 质量 | `best quality`、`amazing quality`、`great quality`、`normal quality`、`bad quality`、`worst quality` | 未限定 |
| 美学 | `masterpiece` | V4.5 起 |
| | `top aesthetic` | V4 起 |
| | `very aesthetic`、`aesthetic`、`displeasing`、`very displeasing` | 未限定 |
| 复杂度 | `low complexity`、`medium complexity`、`high complexity`、`ultra complexity` | 仅 V5 |
| 年份 | `year XXXX` | 未限定 |
| 数据集 | `fur dataset` | V4 起 |
| | `background dataset` | V4.5 起 |
| 透明 | `transparent background`、`has alpha`、`alpha transparency` | 仅 V5 |
| 其他 | `location` | 未限定 |
| | `depthness`、`attractive male`、`meta:novel era`、`meta:golden era`、`visual novel art`、`visual novel bg`、`visual novel cg`、`visual novel chibi`、`visual novel sprite` | 仅 V5 |
| 语法前缀 | `source#`、`target#`、`mutual#` | 多角色提示词 |

另外可以转成数据的：

- **改名表**（`tags.md` 的 Renamed Tags，9 条）：`v` 写成 `peace sign`，`tachi-e` 写成 `character image` 等。Danbooru 的名字不能原样发给 NovelAI。
- **各模型自动追加的质量词**（`qualitytags.md`）：例如 V5 Full 的标准档是 `, very aesthetic, masterpiece, no text`。
- **各模型的负面预设**（`undesiredcontent.md`）。

注意 Danbooru 里的 `2014` 标签（1735 条）与 NovelAI 的 `year 2014` 不是一回事。

## 权重语法

| | NovelAI | SD WebUI |
|---|---|---|
| 加强 | `{tag}`，乘 1.05 | `(tag)`，乘 1.1 |
| 减弱 | `[tag]`，除以 1.05 | `[tag]`，除以 1.1 |
| 指定数值 | `1.5::tag::`（V4 起），负值 V4.5 起 | `(tag:1.5)` |
| 圆括号 | 不表示加权 | 表示加权 |

SD 一列来自第三方资料与标签超市页面，没有读 WebUI 源码；ComfyUI 接近 SD 是主会话的了解，没有查证。

NovelAI 的语义是线性的：每个 `{` 或 `]` 对右边所有内容乘 1.05，每个 `}` 或 `[` 除以 1.05；括号可以不配对，`::` 能关闭所有括号，`{{{{{rain ::` 合法。权重可以跨多个标签甚至半句话。所以提示词模型不能是括号树（[t03](../tasks/t03-core-contracts/README.md)）。

## 能力

| 能力 | V4.5 | V5 | 依据 |
|---|---|---|---|
| 自然语言 | 有 | 更强，支持日语等多语言提示词；中文提示词没明说 | `models.md` |
| 多角色 | V4 最多 6 个，V4.5 没写数量；5x5 网格定位 | 最多 22 个，定位重做 | `multiplecharacters.md` |
| 精确参考（角色、风格） | 有 | 文档写“只在 V4.5” | `precisereference.md` |
| 氛围迁移 | 有 | 文档只写“V4 或更高”，第三方 SDK 说没有，**待 t02 实测** | `vibetransfer.md` |
| 局部重绘 | 有 | V5 Full 有（Effort 页提到其 inpainting 模式） | `inpaint.md`、`effort.md` |
| 提示词上限 | 约 512 T5 token | Full 约 1471，Curated 约 703 | `models.md` |

影响设计的几条：

- **多张角色参考会混在一起：** 文档原话是“will currently blend them together”。多人同框不能靠参考图保持稳定，主力是角色档案里的标签加多角色提示词。精确参考也与氛围迁移不兼容。
- **Effort：** V5 Full 的 Medium 档固定 14 步、固定采样器，不能自定义负面提示词。后端能力要细到“模型加档位”。
- **Prompt Chunks 与 Randomizer：** 官方的片段可保存、拖入、嵌套（`!macro:名字!`），输入 `@` 调出；`||facing viewer|from above||` 是随机选项。片段不进图片元数据，存的是展开后的内容。这与预设和模块的设计一致。
- **标签知识指示：** 补全会显示模型对标签的了解程度，并按 Anime 或 Furry 模式切换数据集。“模型认不认识”不能靠 Danbooru 热度判断。

## suggest-tags

都来自第三方 SDK（[novelai-sdk](https://github.com/caru-ini/novelai-sdk)、[novelai-python](https://github.com/LlmKira/novelai-python)），**没有测通**：

- `GET https://image.novelai.net/ai/generate-image/suggest-tags`，参数 `model`、`prompt`、`lang`（en 或 jp）。
- 英文返回 `{tags: [{tag, count, confidence}]}`，日文返回 `[{jp_tag, en_tag, power}]`；`count` 与 `power` 上限 10000。据称免费，不耗 Anlas。结果随模型不同。
- `confidence` 很可能就是界面的知识指示（推断）。

**接入风险：** 2026-11-06 不带凭据访问该域名，两个出口都被 Cloudflare 返回 403，分不清是缺令牌还是客户端指纹。novelai-python 专门模仿 Chrome 的 TLS 指纹，novelai-sdk 的更新记录提到接口域名变动、拒绝部分第三方客户端。主会话不建议把模仿指纹当产品方案：这是绕过站点防护，也容易失效，服务条款也没读到。t02 用真实令牌发普通请求后再定。

## 法典图鉴

子代理调研（Sonnet，2026-11-06），主会话看了中转站与搜索两张截图、读了 `nai-sd.js`。代码没有运行。截图留本地：`.local/agent/works/w00042-image-generation/tasks/t01-research-decisions/qtc-shots/`。

**数据：** 15 本书约 6.2 万条，分法典、画风、构图、图包四卷。词条字段是 `id`、`title`、`path`、`tags`（整串提示词）、`negative`、`note`、`characterPrompts`、`image` 等。法典与画风多是整串提示词，画师词典（5468 条）与构图书接近单个标签。没有模型版本字段，靠分书区分。没有单独的专属词表：“质量词”目录在 N4.5 法典 17 条、N5 法典 1 条，每条是一串组合。

**能否使用：** LICENSE 写明词条、分类、配图与汇编结构都不在 MIT 范围内；站内没有使用条款页，声明内容版权归各自作者；没有公开的法典导入格式。联系途径有反馈表单、公告里的 QQ 群、GitHub Issues。不做法律结论；要不要联系是开发者的决定。

**值得借鉴：**

1. 中转站的来源占位符：素材进入组装区后是带缩略图的 `#NAI5时期 31项`，输出时才展开，能合并重复标签。对应“片段引用加文本”的序列。
2. 用过的自动变成素材。我们可以让抽卡结果与配方自动进素材库。
3. 搜索条件变成可删的胶囊，配“字段、条件、值”的筛选表单。Agent 的检索工具可以用同一套条件结构。
4. 收藏存快照，来源下线后还能用。

**不照搬：** 复制到剪贴板作为终点；全库线性扫描；以例图墙为中心（可以用用户自己的抽卡结果积累例图墙）。

**缺口：** 中文词不会翻译成标签去搜（“白发”0 条）。中文到标签的映射值得我们重点做。

**代码（MIT）：**

| 模块 | 判断 |
|---|---|
| `site/assets/community/params-core.js` | 最值得移植：读 PNG、JPEG、WebP 与 LSB 隐写，解析 NovelAI 与 SD 的参数，有解压体积上限。主会话没有读 |
| `site/assets/app/nai-default-tags.js` | 处理默认尾巴，可以移植，带夹具 |
| `site/assets/app/nai-sd.js` | 只作参考：它是复制到 SD 的兼容转换，未闭合的左括号“只丢弃括号本身”，与官方语义不同（读代码推断） |

README 说空格表示“同时满足”已过时，实测要用逗号分隔。
