---
name: novel-import-silly-tavern-card
description: Import local SillyTavern character cards, worldbooks, presets, MVU and prompt-template material into a NeuroBook Project Workspace. Use when the user asks to inspect, unpack, convert or import 酒馆角色卡 / SillyTavern cards for novel writing, lorebook migration, RP or world simulation.
---

# novel-import-silly-tavern-card

把本地 SillyTavern 角色卡素材导入当前小说 Project Workspace。这个 skill 的核心职责是第一遍 lorebook 导入：尽可能把稳定 worldbook 条目按 NeuroBook 目录协议分类到 `lorebook/`，把动态运行、卡片主体文本、低置信、混合职责或污染风险内容写入报告和 `reference/silly-tavern/**`，交给后续 Agent / 作者继续处理。

**注意：SillyTavern 角色卡的格式可能是 json 或者 图片**

## Boundaries

- 这是导入 workflow，不是 SillyTavern runtime 兼容层。
- 不执行 JavaScript、regex、EJS、MVU、ST-Prompt-Template、Tavern Helper 或外部请求。
- 不自动创建 `simulation/subjects/`、`simulation/entities/` 或 `simulation/runs/`。
- 不生成 subject-facing `memory.jsonl`；角色可知信息必须后续按信息控制边界重写。
- 混合职责条目不自动拆分，进入 classification review queue。
- 低置信但可复用的稳定设定可进入 `lorebook/note/`，frontmatter `status: pending`。
- 动态 worldbook 条目不进入稳定 `lorebook/`，统一归档到 `reference/silly-tavern/{slug}/dynamic-worldbook/`。
- `first_mes`、`alternate_greetings`、`mes_example`、`scenario`、`description` 是卡片主体素材，归档到 `reference/silly-tavern/{slug}/card-body/`，不当作既定 canon。
- 结构分隔标记只进入原始 reference 和 report，不生成 lorebook / dynamic-worldbook 内容节点。

## CLI

脚本位置：

```powershell
bun assets/workspace/.nbook/agent/skills/novel-import-silly-tavern-card/scripts/silly-tavern-card.ts --help
```

常用命令：

```powershell
bun assets/workspace/.nbook/agent/skills/novel-import-silly-tavern-card/scripts/silly-tavern-card.ts inspect ".agent/workspace/cards/命定之诗/v4.2.1.raw.json"
bun assets/workspace/.nbook/agent/skills/novel-import-silly-tavern-card/scripts/silly-tavern-card.ts unpack ".agent/workspace/cards/公立育露学园/2.28_v1--reload.raw.json" --project "current-novel" --force
bun assets/workspace/.nbook/agent/skills/novel-import-silly-tavern-card/scripts/silly-tavern-card.ts import "reference/silly-tavern/2.28-尝鲜版v1-全裸登校-育露学园的第一天-reload" --project "current-novel" --rp --force
```

## Workflow

1. 确认当前小说 Project Workspace。`--project` 必须指向包含 `project.yaml` 的 Project Workspace 根目录。
2. 先运行 `inspect`。只读取本地卡片并输出 overview，不写文件。检查它是角色卡、preset 还是未知 JSON，并观察动态 marker 和分类风险。
3. 运行 `unpack`。生成 `reference/silly-tavern/{slug}/`，保存 raw card、inspect.json、overview、card-body、worldbook entries、regex scripts、Tavern Helper 脚本和变量，以及 unpack report。
4. 运行 `import`。从解包目录重新分类 worldbook，避免旧 inspect 结果过期；稳定条目写入 `lorebook/`，动态条目写入 `dynamic-worldbook/`，低置信和混合职责条目写入 report / pending note。
5. 如用户需要 RP 或世界模拟，加 `--rp` 生成 `reference/silly-tavern/{slug}/simulation-migration/`。它只包含 simulator、writer、subject、entity 和 unsupported runtime 的迁移候选，不初始化运行态。
6. 导入后阅读 `import-report.md`。先 review classification queue，再根据需要执行 `workspace node validate`。普通写作模式需要追踪时间线时，进入 `novel-setup` 阶段四（World Engine 初始化）和 `novel-writing`；legacy RP / simulation skill 已归档到 `docs/archived/skills/`，普通写作模式不要走它们。

## Classification Targets

- `character` -> `lorebook/character/`
- `location` -> `lorebook/location/`
- `faction` -> `lorebook/faction/`
- `species` -> `lorebook/species/`
- `item` -> `lorebook/item/`
- `event` -> `lorebook/event/`
- 世界规则 -> `lorebook/world/rule/`
- 可运行机制 / 玩法系统 -> `lorebook/system/`
- 低置信稳定设定、混合职责条目、格式风险条目 -> `lorebook/note/` + `status: pending`
- 动态 MVU / prompt template worldbook -> `reference/silly-tavern/{slug}/dynamic-worldbook/`
- scripts / regex / Tavern Helper / UI 状态栏 -> `reference/silly-tavern/{slug}/` 与 `simulation-migration/`

新导入不再生成旧 `lorebook/rule`。旧项目已有目录不要在本 skill 中迁移或删除。

## Report Contract

`import-report.md` 同时面向人类和 Agent，应优先阅读这些区块：

- `Import Mapping`: 实际写入的 lorebook roots。
- `Classification Stats`: 原始分类统计。
- `Affected Lorebook Roots`: 后续 validate / review 的范围。
- `Dynamic Worldbook Archive`: 已归档的动态 worldbook 条目。
- `Structural Markers`: 只保留在 report / 原始归档中的结构分隔标记。
- `Card Body Materials`: `first_mes`、`alternate_greetings` 等开场素材数量与位置。
- `Dynamic Migration Summary`: 动态机制规模。
- `Classification Review Queue`: 不应自动拆分或需要人工判断的条目。
- `Pending Lorebook Notes`: 已落到 `lorebook/note` 但不可直接当 canon 的条目。
- `Recommended Next Steps`: 下一步 validate、review、World Engine 初始化 / 剧情推进，或明确 RP 时的 legacy simulation。

## Follow-up Skills

- 普通写作模式需要初始化动态状态时，使用 `novel-setup` 阶段四（World Engine 初始化）。
- 普通写作模式需要推进剧情状态时，使用 `novel-writing`（剧情设计与拍板落库环节）。
- 需要正式章节正文时，使用 `novel-writing` 正文循环或普通 `writer`。
- legacy RP / simulation 引导已归档（`docs/archived/skills/`），不再作为可用 skill。
