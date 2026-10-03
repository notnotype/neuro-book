# Agent RP Mode

> 2026-07-31 CLI 路径取代说明：下文出现的 `assets/workspace/.nbook/agent/scripts/workspace.ts` 是当时实现证据，不再是当前运行合同。Agent 稳定入口为 `.nbook/agent/bin/workspace`；Source checkout wrapper 调用 Product-owned source entry，发行物通过 Task 130 的 Product Runtime Contract 解析 `workspace` 逻辑命令，不保留旧脚本 fallback。

## Current Target: Simulation / Profile Context V2

2026-06-07 update: 本任务里的早期 `leader.rp`、`simulation/simulator.md`、`simulation/writer.md`、`simulation/config.yaml`、`simulation/cast.yaml` 说法已经被 profile context V2 取代。当前合同是：Project root `AGENTS.md` 和 `agent-context/{profile}/context.md` / `agent-context/{profile}/generated.md` 作为 profile guidance 入口；`simulator.leader` 读 `agent-context/simulator.leader/context.md`；`simulation/` 只保留 `subjects/`、`entities/`、`runs/` runtime state。

2026-06-10 update: `rp.writer` 的 profile input 已精简为空对象。它不再绑定 `writerInstructionPath` 或自动读取 `agent-context/rp.writer/context.md`；每轮只消费上级注入的 writer brief。若项目维护 `agent-context/rp.writer/context.md`，由 `rp.leader` / `simulator.leader` 读取后把可写偏好注入 brief。`rp.writer` 仍保留“小猫之神”写作预设、`thinking_mode`、文风/段落/视角约束和 `stop-slop` skill，并只在 brief 明确给路径时读写文件。

2026-06-10 update: `rp.leader` 与 `simulator.leader` 的 profile input 也已精简为空对象。当前 Project 不再由 InputSchema 的 `projectPath` / `manualRoot` / `simulationRoot` 指定，而是由 session `projectPath` 和 `WorkspaceFocusReminder` 表达；profile 根据当前 Project 推导 `manual/` 与 `simulation/` 路径。`leader.default` 与 `leader.assets` 的创建 input 同步精简为 `{}`，前端默认 profile 新建入口可以用同一 `input: {}` 创建这些 leader session。

2026-06-08 update: subject memory 合同已 hard cut 到 `memory-seed.md`、`events.jsonl`、`memory.jsonl`、`mind.md`、`state.md`。下文早期出现的 `events.md` / `knowledge.md` 只表示历史设计记录；当前实现和模板以 Subject RAG Memory task 与 `reference/content/simulation.md` 为准。

2026-06-09 update: RP 用户交流层已实现为 `rp.leader` builtin profile。当前分工是：`rp.leader` 作为 RP 引导、用户交流和陪伴式统筹层，读取 `manual/` 与 `agent-context/rp.leader/`，负责开局引导、化身创建、体验边界、化身可见信息整理和调用模拟内核；`simulator.leader` 继续作为世界模拟和裁决内核，维护 `simulation/subjects`、`simulation/entities` 和 `simulation/runs`。新合同只使用 `rp.leader` 这个名字，不使用 `rp.gm` 或恢复旧 `leader.rp`。

2026-06-09 prompt update: `rp.leader` 和 `RP模式` skill 已参考 5e PHB / DMG / DM Screen 的运行结构优化：普通 RP 入口优先进入 `rp.leader`，Tick 循环固定为“处境 -> 行动 -> 世界回应 -> 新选择点”；开局先确认默认化身、调整默认化身或自定义化身；世界观披露按化身创建和第一幕逐步展开；世界裁决、人物/环境反应和 state commit 仍交给 `simulator.leader`。

2026-06-14 prompt update: RP 正文归属已收紧为“所有世界内用户可见正文都由 `rp.writer` 写”。开场白 / 初始化正文发生在第一个常规 Tick 前，但不再是 `rp.leader` 亲自写正文的例外；`rp.leader` 必须生成 Writer Brief 并调用 `rp.writer` 写入 `simulation/runs/ticks/000000-initial-state/prose.md`，自己只组装正文链接和元场景引导。

2026-06-14 contract fix: 修复 `rp.writer` Brief 传递合同漂移。`RpWriterInputSchema` 回到空对象，`rp.leader` 创建 writer 时使用 `input: {}`，每轮通过 `invoke_agent.message` 直接发送完整 Writer Brief；`rp.writer` 不再依赖 check/render 阶段参数或旧补充字段，而是在收到 Brief 后自检，缺材料用 `report_result.result` 提问，材料足够则写入 Brief 指定路径并用 `report_result.result` 汇报落点。同步更新系统 profile 与 workspace 覆盖，避免旧 prompt 遮蔽修复。

本任务当前实现目标已从独立 `roleplay/` 运行目录硬切为默认 Project 模板内的 `simulation/`：

- 新 Project 默认使用 `assets/workspace/.nbook/templates/project-directory-templates`。
- `simulation/` 随默认 Project 模板创建，不再安装独立 `roleplay-directory-templates`。
- 旧 `roleplay/gm.md` 的当前职责被拆分：人类主持说明进入 `manual/gm-guide.md`，用户交流层项目上下文进入 `agent-context/rp.leader/context.md`；世界模拟和裁决协议进入 `agent-context/simulator.leader/context.md`。
- 旧 `roleplay/actors/{id}/actor.md` 改为 `simulation/subjects/{id}/subject.md`。
- 旧 `roleplay/playthrough/` 改为 `simulation/runs/`。
- `rp.leader`、`simulator.leader`、`simulator.actor`、`rp.writer` 是当前 RP/simulation 目标分层；`rp.leader` 已作为 builtin profile 可运行，负责用户交流和陪伴主持。
- 开场白、初始化 prose 和常规 Tick prose 都由 `rp.writer` 生成；`rp.leader` 不直接撰写世界内正文。
- `leader.rp` 是已删除的 legacy profile；如果后续恢复 RP 主持能力，应使用 `rp.leader` 名称。
- `RP目录初始化` skill 已删除；`RP模式` skill 已说明 `rp.leader` 用户层、`simulator.leader` 模拟层和默认 Project `manual/` 入口。

下文包含早期设计记录；凡与本节冲突，以本节为准。

## User Request

- 为当前项目的 Agent 设计 RP（Role Play）模式。
- 先讨论 skill 设计，不急着实现 runtime、变量系统或复杂游戏引擎。
- 参考 `.agent/workspace/cards` 中的 SillyTavern 卡片样本，以及 `.agent/workspace/tavern2agent` 的转换思路，但不要被其 pi-native 架构绑定。
- RP 模式要和现有小说写作模式共存。
- SillyTavern 角色卡导入后应先服务基础写作模式，RP 模式作为写作项目之上的扩展层。
- 先把已讨论内容整理为计划文档。

## Goal

- 增加 RP 相关 skill，让用户能理解本系统如何运行 RP/simulation、如何使用默认 Project 模板内的 `simulation/` 目录、如何导入或分析 SillyTavern 角色卡。
- 第一阶段优先支持纯文字或轻量文本卡，不复刻重前端卡的 UI、脚本、API 请求和复杂变量系统。
- 保持当前项目的文件化 workspace 心智：稳定设定进入 `lorebook/`，外部原始素材进入 `reference/`，profile 专用说明进入 `agent-context/`，当前运行态进入 `simulation/`；第一版不设计持久化 session 目录。
- 角色卡迁移首先是写作项目导入器，其次才是 RP 扩展生成器；写作模式和 RP 模式共享同一批 `lorebook/` 设定资产。
- 迁移脚本需要作为长期可迭代工具维护，后续会反复根据样本卡优化分类、拆分和写入策略。
- 后续再讨论变量系统、泛用自然语言编辑工具和更强的多 Agent RP 编排。

## Current State

- 当前 skill 通过 `assets/agent/skills/*/SKILL.md` 暴露，catalog 只读取 frontmatter 中的 `name` 和 `description`，正文按需加载。
- 用户 assets 已支持在 `workspace/.nbook/assets/agent/skills/*/SKILL.md` 创建或覆盖 skill。
- 动态 profile 已支持系统 assets 与用户 assets；workspace 可以创建或覆盖自己的 agent/profile，因此 RP 可以在单个小说 workspace 中拥有专属角色 agent、旁白 agent、GM agent 或其他角色化 agent，而不影响其他 workspace。
- 当前内容节点支持 `state.md`，适合小说创作中的当前状态维护，但对游戏化数值、变量、背包、好感度等频繁精确更新还不够方便。
- 已补充第三方工具研究文档：[SillyTavern RP Tooling Research](../../research/st-roleplay-tooling.md)，覆盖 JS-Slash-Runner、MagVarUpdate 和 ST-Prompt-Template 的本地源码/文档结论。
- `.agent/workspace/cards` 里当前样本包含三张 PNG 角色卡和一个独立 JSON 预设：
  - `公立育露学园/2.28_v1--reload.png`
  - `命定之诗/v4.2.1.png`
  - `碧蓝档案/V1.5_1.png`
  - `命定之诗/命定之诗Kemini5-3.8.json`
- 三张 PNG 已提取原始内嵌 JSON，文件名为 `*.raw.json`；预设 JSON 保持原文件，不再重复 extract 或归一化。

## Walkthrough

1. 熟悉当前 skill 机制和现有写作流程 skill，确认新增 skill 应继续遵守当前项目的 `SKILL.md` 最小 frontmatter 约定。
2. 检查 SillyTavern 样本卡，确认卡片不一定是“一个角色”，可能包含大规模 worldbook、regex scripts、tavern_helper 变量和状态栏逻辑。
3. 讨论 RP 模式定位：RP 不是替代写作模式，而是在当前 novel workspace 之上增加一个运行层；角色卡导入的基础产物应能直接用于写作模式。
4. 讨论轻量 RP 与配置型 RP：
   - 轻量 RP：Leader 直接承担 GM、旁白和多角色代入，参考 `剧情规划流程` 中的旁白式代入、多角色代入和世界模拟式因果推导。
   - 配置型 RP：Leader 仍作为 Leader/GM 统筹，根据 RP 配置把角色、旁白、天道、势力等分配给不同 subagent。
5. 讨论 SillyTavern 导入边界：第一阶段保留原始素材、生成检查报告和导入报告，先支持文本设定导入，不执行前端脚本或复杂变量系统。
6. 讨论泛用自然语言编辑工具：它不只服务 RP state，也可作为未来 Agent 记忆系统和常规文件编辑减负工具。
7. 讨论角色卡迁移脚本的长期维护方式：用三张样本卡做 fixtures，持续优化 worldbook 分类、MVU/EJS 识别、幂等写入和导入报告。

## Decisions

- RP 相关能力先拆成至少三个 skill：
  - `RP模式`：介绍本系统如何运行 RP、如何进入 `rp.leader` 引导层、如何理解 `rp.leader` / `simulator.leader` / `simulator.actor` / `rp.writer` 分工、如何引用 RP 文档和导入流程。
  - `RP目录初始化`：已废弃并删除；simulation 目录进入默认 Project 模板。
  - `novel-import-silly-tavern-card`：提取或读取角色卡原始 JSON，生成检查报告，并把稳定文本设定导入当前 workspace 的写作资产；当前使用 canonical skill `novel-import-silly-tavern-card`；RP 动态机制优先归档到 `reference/`，后续再转写为 `simulation/` 编排文件。
- 角色卡导入分两层：
  - 基础写作层：默认执行，把可稳定复用的角色、地点、势力、规则、世界观、事件背景等导入 `lorebook/` 和 `reference/`。
  - RP 扩展层：可选执行，在基础写作层之上创建或更新 `agent-context/` 与 `simulation/`，保存 simulator leader 口径、subject 映射、actor 指令、writer 规则、变量草案、MVU 更新规则和状态栏/UI 迁移说明。
- 不单独维护 `conversion-plan.md`。`inspect` 只输出临时 overview；稳定证据由 `unpack` 写入解包目录；导入过程以 unpack report 和 import report 记录本次写入、跳过、归档和需人工确认的内容。
- RP 目录建议使用更可读的 `simulation/`，而不是缩写 `rp/`。
- `simulation/` 是当前小说 workspace 的 runtime state 目录；profile 专用说明不再混放到 `simulation/`，而是进入 `agent-context/{profile}/context.md`。
- `manual/` 是当前 Project 的说明书目录，保存快速开始、玩家手册、角色创建指南、世界观导览、规则指南、GM 手册和主持人速查屏；它不替代 `lorebook/` canon，也不替代 `simulation/` runtime state。
- `rp.leader` 是当前 RP 用户交流层的唯一 canonical 名称；`rp.gm` 不作为目录、profile 或合同名，`leader.rp` 只保留为历史实现记录。
- `rp.leader` 与 `simulator.leader` 分工：前者负责 RP 引导、化身创建、体验边界、陪伴和用户交流，后者负责世界模拟、裁决和 runtime state。
- RP/simulation 目录已经并入默认 Project 模板 `project-directory-templates`。新建 Project 时默认生成 `simulation/`；目标 Project Workspace 已存在且显式传入 `--template project-directory-templates` 时，只补齐缺失的默认模板文件，不覆盖用户已有内容。
- 试用反馈后的 RP 交互决策：
  - `rp.writer` 可以开放 bash 与文件读写工具。它不再必须通过 `report_result.data.prose` 报告正文；可以直接写作或写入 GM 指定文件。后续实现要用 profile prompt 和输入参数约束写入范围。
  - `rp.writer` 只负责正文，不负责生成“选项”“下一步行动建议”或 simulator leader 控制面内容。可选行动、提示、确认问题由 `simulator.leader` 生成和呈现。
  - 历史记录：早期曾讨论 `simulator.leader` 直接面向用户并承担旁白职责。当前合同已覆盖这一点：普通 RP 用户入口是 `rp.leader`，世界内正文统一由 `rp.writer` 写，`simulator.leader` 只负责世界模拟、裁决和 runtime state。
  - actor 目录应拆出 `mind.md` 与 `state.md`：`mind.md` 记录角色当前思维、判断、猜测和动机；`state.md` 记录角色当前状态，例如位置、持有物品、伤势、关系压力、短期目标等。
- RP/simulation 目录入口收束：删除 `simulation/AGENTS.md`，避免它和 profile context 形成双入口混淆；通用启动说明下放到 `RP模式` skill 和 `simulator.leader` profile，作者主要修改 `agent-context/simulator.leader/context.md`。
- `knowledge.md` 是给 actor 看的角色视角资料，不写上帝视角；模板改为二级章节归类、三级标题作为条目，并新增 `## 世界观`。不再维护“信念与误解”“最近更新”“更新规则”章节；是否误解由 GM / leader 在后台判断，更新规则写在 profile prompt 中。
- lorebook 信息控制继续讨论：一个方向是在 lorebook frontmatter 中标注条目可见对象或可知条件，让 actor 的 `knowledge.md` 可以引用“这个角色可知道”的公开世界观/常识条目，避免每个 actor 重复维护通用世界观。但 canonical lorebook 仍默认是 GM / leader / 作者视角，actor 不能因为引用而自行读取完整 lorebook。
  - 暂定推荐方向：visibility 只是“谁能知道/何时能知道”的元数据，不代表 actor 可直接读取原文；`knowledge.md` 优先保存角色视角摘要或引用索引。混合公开常识和隐藏真相的 lorebook 条目后续应拆条目，或提供 actor-safe 摘要字段，由 GM / leader 注入。
- Tick / 过程产物目录命名为 `simulation/runs/`，避免和 Agent Session 混淆；用于保存当前游戏进程、每个 Tick 的 user input、GM scratch、actor result、writer brief 和 writer 正文文件。
- GM 发给 actor 的消息不应使用 YAML / JSON / 字段任务单。内部可以结构化组织信息，但发送给 actor 时应改成第二人称自然语言，只描述角色合理可知、可见、可感受到的内容；不要发送 `not_known_to_you`、`task`、返回格式或 hidden facts。
- `report_result.walkthrough` 已严格改名为 `result`；模型可见 schema、工具执行和 harness 读取都使用 `result`。中期目标仍是用 sidecar result pass 整理 actor 主上下文的沉浸式回应。
- actor `knowledge.md` 引用 lorebook 的方式使用项目已支持的 Markdown 相对路径链接，例如 `[王都公共常识](../../lorebook/world/capital.md)`；链接是维护索引或可知来源，不代表 actor 可以自行读取完整 canonical 原文。
- 最新 `simulation/` 目标结构收束为 runtime state 目录；profile guidance 进入 `agent-context/`：

```text
agent-context/
|-- simulator.leader/
|   |-- context.md
|   |-- memory.md
|   `-- generated.md
`-- rp.writer/
    |-- context.md
    |-- memory.md
    `-- generated.md

simulation/
|-- entities/      # stateful instances
|-- runs/          # current playthrough / tick artifacts
`-- subjects/
    |-- player/
    |   |-- subject.md
    |   |-- memory-seed.md
    |   |-- events.jsonl
    |   |-- memory.jsonl
    |   |-- mind.md
    |   `-- state.md
    `-- {subject-id}/
        |-- subject.md
        |-- memory-seed.md
        |-- events.jsonl
        |-- memory.jsonl
        |-- mind.md
        `-- state.md
```

- 外部原始素材建议结构：

```text
reference/silly-tavern/{card-slug}/
|-- raw/
|   |-- card.json
|   `-- source.png
|-- overview.md
|-- inspect.json
|-- generated.json
|-- unpack-report.md
|-- import-report.md
|-- worldbook/
|   |-- entries.json
|   `-- entries/
`-- extensions/
    |-- extensions.json
    |-- regex_scripts.json
    |-- regex_scripts/
    |-- tavern_helper.json
    |-- tavern_helper.scripts.json
    |-- tavern_helper.variables.json
    `-- tavern_helper/
        |-- scripts/
        `-- variables/
```

- 导入到项目稳定结构时，按内容语义进入：

```text
lorebook/character/...
lorebook/location/...
lorebook/faction/...
lorebook/world/rule/...
lorebook/system/...
lorebook/event/...
lorebook/note/...
agent-context/simulator.leader/context.md
agent-context/rp.writer/context.md
simulation/entities/{entity-id}/entity.md
simulation/entities/{entity-id}/state.md
simulation/subjects/{actor-id}/subject.md
simulation/subjects/{actor-id}/memory-seed.md
simulation/subjects/{actor-id}/events.jsonl
simulation/subjects/{actor-id}/memory.jsonl
simulation/subjects/{actor-id}/mind.md
simulation/subjects/{actor-id}/state.md
```

- 角色卡导入流程建议使用三个阶段：

```text
inspect -> unpack -> import
```

  - `inspect`：只读取输入并在 stdout 输出 overview 给 AI 临时查看，不写入 Project Workspace。
  - `unpack`：识别 PNG 角色卡、JSON 角色卡或预设 JSON，保存原始素材、inspect JSON、overview、worldbook entries、regex scripts、tavern_helper scripts / variables 和 unpack report；worldbook 按 `insertion_order` 排序，文件名前缀使用 6 位补零的 `insertion_order`，逐条保存为 frontmatter + 正文 Markdown，并在 `st` 下保留除 `content` 外的原始字段，包括 `insertion_order`、`extensions` 和触发/排序字段；regex、tavern_helper scripts、tavern_helper variables 同时保留聚合 JSON 和逐条 JSON。
  - `import`：从解包目录读取 `raw/card.json` 和 `inspect.json`，按 `insertion_order` 和确定性分类规则把稳定 worldbook entry 写入 Project Workspace 的普通 `lorebook/character`、`lorebook/location`、`lorebook/faction`、`lorebook/world/rule`、`lorebook/system`、`lorebook/item`、`lorebook/event` 或 `lorebook/note` 文件；目录名前缀使用 6 位补零的 `insertion_order`，并在 `ext.sillyTavernWorldbook` 下保留原始 worldbook 元数据和本次 classification；动态 MVU / prompt 条目只归档和报告，不进入稳定 lorebook；混合职责条目不自动拆分，低置信稳定设定进入 pending note；可选 `--rp` 额外在解包目录下生成 `reference/silly-tavern/{card-slug}/simulation-migration/` 动态机制迁移参考。

- 迁移脚本应按长期工具设计，模块边界暂定为：

```text
extractor      # PNG/JSON/preset 提取
normalizer     # 统一 chara_card_v2/v3/preset 数据结构
classifier     # worldbook entry 分类
mvu-detector   # InitVar / UpdateVariable / json_patch / _.set
ejs-detector   # EJS / @INJECT / @@if / GENERATE / RENDER
mapper         # ST 分类 -> Neuro Book 文件目标
writer         # 幂等写入 project
reporter       # overview.md / inspect.json / unpack-report.md / import-report.md
```

- 迁移脚本的工程要求：
  - 可重复运行，同一张卡优化规则后可以重新导入，不能随意覆盖用户手改内容。
  - 保留 source id，包括来源卡、entry uid、comment、原始路径，方便回溯。
  - 分类规则、目录映射、命名策略需要可配置。
  - 三张样本卡应作为 fixtures 或快照测试输入，后续每次优化脚本都验证不退化。
  - LLM 只做辅助总结和拆分建议；提取、分类、写入路径尽量 deterministic。

## Implemented V1

2026-06-07 note: 本节保留 V1 历史实现记录。当前活跃合同已切到 `simulator.leader` + `agent-context/`；下列 `leader.rp`、`simulation/config.yaml`、`simulation/cast.yaml`、`simulation/simulator.md`、`simulation/writer.md` 只表示早期落地状态，不再作为当前实现入口。

- 已新增系统 skill：`assets/workspace/.nbook/agent/skills/novel-import-silly-tavern-card/SKILL.md`；旧 `assets/workspace/.nbook/agent/skills/novel-import-silly-tavern-card/SKILL.md` 作为兼容入口保留。
- 已新增系统 skill：`assets/workspace/.nbook/agent/skills/RP模式/SKILL.md`，作为用户进入 `leader.rp` / GM Tick 流程的可发现入口。
- `RP目录初始化` skill 已废弃并删除；`simulation/` 随默认 Project 模板创建。
- 已新增配套 CLI：`assets/workspace/.nbook/agent/skills/novel-import-silly-tavern-card/scripts/silly-tavern-card.ts`。
- 已合并 RP/simulation 目录模板到：`assets/workspace/.nbook/templates/project-directory-templates/simulation/`，包含 `config.yaml`、`cast.yaml`、`simulator.md`、`writer.md`、`subjects/player/*` 和 `subjects/sample-npc/*`。
- RP/simulation 目录模板已升级为混合模板：保留待填写位置，同时提供 fallback scene、profile 输入边界、Tick 清单、actor-facing message / response 约束、GM scratch、writer brief 缺失处理、runs 示例和 actor knowledge 更新规则，方便创建 Project 后直接试跑一轮 RP。
- 已扩展 `workspace project create`：目标不存在时仍创建完整 Project Workspace；支持 `--target <dir>` 指定实际写入目录；目标已存在且显式传入 `--template` 时，把模板缺失文件补入现有 Project Workspace，并在 `--json` 中返回 `mode: "updated"`、`createdFiles` 和 `skippedFiles`。
- 已更新 `leader.default` profile 的 Shell commands 提示词：Project 创建默认使用 `workspace project create <project> [--target <dir>]`，已有 Project Workspace 需要补齐模板时显式传入 `--template project-directory-templates`。
- CLI 当前支持：
  - `inspect <input>`：读取 `.json`、`.raw.json` 或 best-effort PNG 文本块，只在 stdout 输出临时 overview，不生成文件。
  - `unpack <input> --project <path>`：生成 `reference/silly-tavern/{slug}/` 解包目录，包含 raw、overview、inspect、worldbook、regex、tavern_helper 和 unpack report；worldbook 会逐条拆成 frontmatter + 正文 Markdown，regex/scripts/variables 会逐条拆成独立 JSON。
  - `import <unpackDir> --project <path>`：从解包目录读取数据，把稳定 worldbook entries 按 deterministic 分类写入 `lorebook/character`、`lorebook/location`、`lorebook/faction`、`lorebook/world/rule`、`lorebook/system`、`lorebook/item`、`lorebook/event` 或 `lorebook/note`，并在解包目录生成带 `Import Mapping`、`Skipped Dynamic Content`、`Classification Review Queue`、`Pending Lorebook Notes` 和 `Recommended Next Steps` 的 `import-report.md`。
  - `import <unpackDir> ... --rp`：额外生成 `reference/silly-tavern/{slug}/simulation-migration/README.md`、`simulator-candidates.md`、`writer-candidates.md`、`subject-candidates.md`、`entity-candidates.md`、`unsupported-runtime.md`，作为后续转写到 `agent-context/simulator.leader/context.md`、`agent-context/rp.writer/context.md`、subject 文件或 simulation mechanics 的迁移参考；不会创建 `simulation/subjects`、`simulation/entities` 或 `simulation/runs`。
  - preset-like JSON 只归档和报告，不作为角色主体写入 lorebook。
  - `--project` 必须指向包含 `project.yaml` 的 Project Workspace，避免和 Workspace Root / `.nbook` 混淆。
  - `import` 会拒绝 unknown 解包目录；`inspect` / `unpack` 仍允许 unknown，用于查看和保存原始结构。
  - 解包目录根部有集中 `generated.json` 指纹清单；`--force` 只覆盖未被用户手改的脚本生成文件。
- 已实现 SillyTavern worldbook V2 映射：
  - 分类类别：`character`、`location`、`faction`、`rule`、`item`、`event`、`system`、`formatting`、`dynamic-mvu`、`dynamic-prompt`、`unknown`。
  - 动态类别优先级最高；命中 InitVar、UpdateVariable、json patch、EJS、`@INJECT`、`@@if`、`GENERATE`、`RENDER` 等 marker 时跳过稳定 lorebook 导入。
  - `rule` 进入 `lorebook/world/rule`；`system` 进入 `lorebook/system`；`event` 进入 `lorebook/event`；`unknown`、混合职责条目和格式风险条目进入 `lorebook/note` pending，并在 report 中列为 classification review。
  - `inspect --json` 和 `import --json` 都输出 `mappingSummary`，便于后续 Agent 或脚本继续优化分类规则。
- 已新增测试：`server/agent/skills/silly-tavern-card-cli.test.ts`，覆盖三张样本 raw 卡、预设识别、动态 marker 统计、Windows 路径 slug、Project Workspace 校验、inspect 不写文件、unpack 目录结构、集中 `generated.json`、import 从解包目录读取和用户手改保护。
- 2026-06-07 文档清理：将 Current Target、RP skill 说明和导入迁移目标同步到 profile context V2；当前入口为 `simulator.leader`，profile guidance 位于 `agent-context/`，`simulation/` 只保留 runtime state。`roleplay-runtime-structure.md` 明确降级为早期设计记录。

- 变量系统暂不实现。第一阶段先把纯文本卡导入做好；复杂数值、好感度、背包、任务进度、状态栏等后续专门设计。
- 泛用自然语言编辑工具先记录为 TODO。该工具不是 state 专用，参数方向暂定为：目标文件、自然语言操作说明、可选携带上下文消息数量，后续可接轻量模型。
- `SidecarProfilePass` 已在 Harness 层实现 V1，详见 `docs/tasks/23-agent-sidecar-profile-pass/README.md`。`simulator.actor` 已接入 `actor.context-load` / `actor.memory-save` 两个旁路：主 run 前检索并注入 actor-safe 设定，主 run 后维护 `events.jsonl`、`memory.jsonl` 与 `mind.md`；`state.md` 与 `simulation/entities/` 由 GM 裁决后写入。`rp.writer` 暂未接入 sidecar，仍由 GM 注入可写 lorebook 摘要。
- 已新增第一版 RP builtin profiles：
  - `rp.leader`：用户进入 RP 模式后的用户交流与陪伴式主持 profile；需要世界裁决时调用 `simulator.leader`，不直接替代世界模拟主管。
  - `simulator.actor`：通用 subject simulator profile，创建 input 只接收 `{ subjectPath }`，profile 内部从该目录派生 `subject.md`、`events.jsonl`、`memory.jsonl`、`mind.md` 与 `state.md`；主 run 只根据 actor-facing packet 和 `<actor-sidecar-context>` 返回结构化 actor response packet。
  - `rp.writer`：RP Tick 正文渲染 profile，input 为空，每轮根据 GM writer brief 直接输出正文；只在 brief 明确指定路径时使用文件工具，不自主检索完整 lorebook。
- 当前 profile 工具边界：
  - `rp.leader` 拥有用户交流、agent 编排和必要文件工具；世界状态写入优先交给 `simulator.leader` 裁决。
  - `simulator.actor` 保留 `subject_rag_search`、`subject_event_append`、`subject_memory_update`、`read`、`edit`、`report_result` 作为 profile 最大工具集合；主扮演 run 实际只允许 `report_result`。`actor.context-load` 旁路允许 `subject_rag_search` / `read` / `report_result`，`actor.memory-save` 旁路允许 subject memory 工具、`read` / `edit` / `report_result`，并通过 prompt 限定只维护 `events.jsonl`、`memory.jsonl` 与 `mind.md`。
  - `rp.writer` 开放 `read` / `write` / `edit` / `bash`，但提示词约束它只按 GM 明确路径读写；正文用普通 assistant 回复，不强制 `report_result`。
- 已更新 `leader.default` 的多 Agent 协作说明：进入 roleplay 模式时优先创建或切换到 `leader.rp`；`simulator.actor` 和 `rp.writer` 通常只由 `leader.rp` 调用。
- 试用反馈已落地到 profile/template：
  - `rp.writer` 可使用 bash 与文件工具，并通过写文件或直接正文完成写作，不强制走 `report_result.data.prose`。
  - `rp.writer` prompt 删除“写选项/行动建议”职责，只写正文；选项由 GM 生成。
  - 历史记录：旧 `leader.rp` prompt 曾加强直接面向用户的 GM 旁白职责。当前合同已切到 `rp.leader` + `rp.writer`：`rp.leader` 做引导与 brief，世界内正文由 `rp.writer` 写。
  - actor 模板与 profile input 增加 `mind.md`、`state.md`，把角色认知、思维和可变状态从 `knowledge.md` 中拆开。
- 二轮提示词收紧已落地：
  - `rp.leader` 明确区分初始化、常规 Tick 和元指令；初始化后必须给用户可行动现场，不输出后台流程。
  - `rp.leader` 明确 cast 路径需要从 Project Workspace 相对路径转换为 Agent cwd 路径。
  - `simulator.actor` 强化玩家 actor 不替用户新增行动、台词、情绪或目标；无真实变化时不要为了更新而改文件。
  - `rp.writer` 强化“正文代笔，不是 GM”，不输出标题、摘要、选项或解释，不替玩家角色补未输入的内心和关键动作。
  - roleplay 模板同步了 GM / writer / actor 的上述提示词边界。
- Information Control Protocol 落地：
  - `simulator.actor` 合同已切到 JSONL subject memory；context-load sidecar 读取 `events.jsonl` / `memory.jsonl` 并注入 actor-safe 摘要。
  - `actor.memory-save` 旁路现在维护 `events.jsonl`、`memory.jsonl` 与 `mind.md`，仍不修改 `state.md`。
  - `leader.rp` 负责 GM 裁决后的 subject `state.md` 与 `simulation/entities/` 写入；actor 的 `state_update` 只是候选。
  - 默认 Project 模板新增 `simulation/entities/example-item/`，用于说明普通物品不实例化、特殊有状态实例才进入 entities。

## SillyTavern Sample Notes

当前样本卡数据概览：

| 文件 | 类型 | 名称 | worldbook entries | enabled | constant | 脚本/扩展 | 初步判断 |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `公立育露学园/2.28_v1--reload.png` | `chara_card_v3` | `[2.28 尝鲜版v1]全裸登校-育露学园的第一天-reload` | 23 | 17 | 11 | regex 8 / tavern_helper scripts 2 | 中等复杂，适合作为第一版导入实验 |
| `命定之诗/v4.2.1.png` | `chara_card_v3` | `命定之诗与黄昏之歌v4.2` | 469 | 326 | 86 | regex 12 / tavern_helper scripts 6 / variables 2 | 超大世界书，适合作为压力测试 |
| `碧蓝档案/V1.5_1.png` | `chara_card_v3` | `在基沃托斯跟学生们涩涩的日子V1.5` | 244 | 215 | 48 | regex 10 / tavern_helper scripts 5 | 大型多角色 RP 卡，适合作为结构拆分样本 |
| `命定之诗/命定之诗Kemini5-3.8.json` | JSON 预设 | 无角色名 | 0 | 0 | 0 | SPreset / regex scripts / tavern_helper | 这是预设，不是角色卡，不应重复 extract |

已生成原始 JSON：

- `.agent/workspace/cards/公立育露学园/2.28_v1--reload.raw.json`
- `.agent/workspace/cards/命定之诗/v4.2.1.raw.json`
- `.agent/workspace/cards/碧蓝档案/V1.5_1.raw.json`

## Files Changed

- `PROJECT-STATUS.md`：新增泛用自然语言编辑工具 TODO。
- `docs/tasks/01-agent-roleplay-mode/README.md`：新增并持续更新本任务 walkthrough。
- `docs/tasks/01-agent-roleplay-mode/roleplay-runtime-structure.md`：新增并持续更新 RP 运行目录和 Tick 协议设计。
- `assets/workspace/.nbook/templates/project-directory-templates/simulation/*`：新增 RP 目录模板。
- `.gitignore`：放行 RP 目录模板中的 `simulation/config.yaml`，避免模板配置被全局 `config.yaml` 忽略规则漏掉。
- `assets/workspace/.nbook/agent/scripts/workspace.ts`：`project create` 支持 `--target` 指定写入目录，并支持给已有 Project Workspace 补入显式模板。
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`：更新 `workspace project create` 与 RP 模板安装提示词。
- `assets/workspace/.nbook/agent/profiles/builtin/leader.rp.profile.tsx`：新增 RP GM 主控 profile。
- `assets/workspace/.nbook/agent/profiles/builtin/simulator.actor.profile.tsx`：新增通用 actor profile。
- `assets/workspace/.nbook/agent/profiles/builtin/rp.writer.profile.tsx`：新增 RP Tick writer profile。
- `server/agent/profiles/builtin-contracts.ts`：新增 `LeaderRp*`、`SubjectSimulator*`、`RpWriter*` 输入输出 schema。
- `server/agent/profiles/rp-profiles.test.ts`：新增 RP profile 合同、工具边界和自动注入测试。
- `assets/workspace/.nbook/agent/skills/RP模式/SKILL.md`：新增 RP 模式入口 skill。
- `assets/workspace/.nbook/agent/skills/RP目录初始化/SKILL.md`：已删除，simulation 进入默认 Project 模板。
- `assets/workspace/.nbook/agent/skills/novel-import-silly-tavern-card/SKILL.md`：新增权威英文角色卡导入 skill 入口说明。
- `assets/workspace/.nbook/agent/skills/novel-import-silly-tavern-card/SKILL.md`：保留为旧中文兼容入口。
- `assets/workspace/.nbook/agent/skills/novel-import-silly-tavern-card/scripts/silly-tavern-card.ts`：新增 inspect/unpack/import CLI。
- `server/agent/skills/silly-tavern-card-cli.test.ts`：新增 CLI helper 与 catalog 可发现性测试。
- `.agent/workspace/cards/*/*.raw.json`：从三张 PNG 样本卡提取原始内嵌 JSON，供后续分析使用。

## Verification

- 已用 `jq` 校验三张 `*.raw.json` 能正常解析。
- 已确认 `命定之诗Kemini5-3.8.json` 是预设 JSON，不再重复 extract。
- 已运行 `bun run test server/agent/skills/silly-tavern-card-cli.test.ts`，覆盖三张样本 raw 卡、preset-like JSON、动态 marker、slug、v3 SkillCatalog 可发现性、inspect/unpack/import 三段式行为和用户手改保护。
- 已运行 `bunx vitest run server/agent/skills/silly-tavern-card-cli.test.ts`，覆盖 V2 deterministic 分类映射、动态条目跳过、unknown review、`mappingSummary` JSON 输出和 legacy import 行为。
- 已运行旧 `roleplay 模板` 窄测试；当前测试目标已迁移为 `simulation` / `project-directory-templates`。
- 已用 YAML parser 校验 `simulation/config.yaml` 和 `simulation/cast.yaml` 可解析。
- RP profiles 验证命令：
  - `bun scripts/build/profile.ts check builtin/leader.rp.profile.tsx --system`
  - `bun scripts/build/profile.ts check builtin/simulator.actor.profile.tsx --system`
  - `bun scripts/build/profile.ts check builtin/rp.writer.profile.tsx --system`
  - `bun scripts/build/profile.ts check builtin/writer.profile.tsx --system`
  - `bun scripts/build/profile.ts check builtin/retrieval.profile.tsx --system`
  - `bun run profile:metadata`
  - `bunx vitest run server/agent/profiles/rp-profiles.test.ts`
- 2026-06-10 rp.writer 小猫预设同步验证：
  - `bun scripts/build/profile.ts check builtin/rp.writer.profile.tsx --system` 通过。
  - `bun scripts/build/profile.ts check builtin/writer.profile.tsx --system` 通过。
  - `bun scripts/build/profile.ts compile --all --system` 通过，刷新 12 个系统 profile artifact。
  - `bun run profile:metadata` 通过，compiled stale 为 0。
  - `bunx vitest run server/agent/profiles/rp-profiles.test.ts` 通过，8 个测试通过。
  - `bunx vitest run server/agent/profiles/leader-assets-profile.test.ts` 通过，10 个测试通过。
- 已运行 `bunx vitest run server/agent/profiles/report-result-schema.test.ts`，确认 `report_result` schema 已严格使用 `result`。
- 已运行 `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "report_result"`，确认 harness 读取 `report_result.result`。
- 已运行 `bunx vitest run server/agent/profiles/workbench-service.test.ts`，确认 profile workbench 的 report mode 文案仍可通过。
- 已运行 `bunx vitest run server/agent/harness/prepare-next-turn.test.ts server/agent/harness/turn-continuation.test.ts server/agent/harness/run-frame-state.test.ts`，确认 report_result reminder / continuation 相关窄测试未回归。

## TODO / Follow-ups

- 真实试跑 `simulator.leader` 初始化流程，检查 `agent-context/simulator.leader/context.md`、subject 路径到 actor session 的创建/复用提示是否足够清晰。
- 继续增强 SillyTavern worldbook 迁移脚本：基于更多真实样本优化分类规则，尤其是事件、系统、格式约束、角色别名和大型世界书目录名。
- 后续把 `simulation-migration/` 归档进一步转写为 `agent-context/simulator.leader/context.md` / `agent-context/rp.writer/context.md` / subject 文件补丁或 simulation mechanics。
- 扩展 PNG 提取能力：当前只 best-effort 读取 `tEXt` 文本块，后续按样本需要再支持 `iTXt` / `zTXt`。
- 设计泛用自然语言编辑工具：输入目标文件、自然语言操作说明和可选上下文消息数量，由轻量模型辅助修改文件；后续可用于 Agent 记忆系统、RP 状态维护和常规文件编辑减负。
- 单独讨论 RP 变量系统：如何表示数值、列表、背包、好感度、任务、世界时钟，以及它和 `state.md`、`simulation/runs/` 的关系。
- 继续细化 `simulation/runs/`：分支剧情、debug 信息、正式游玩时是否保留示例 Tick，以及 writer 正文文件命名规则。
- 后续继续增强 `actor.context-load` 的 lorebook 信息过滤规则，例如结合 visibility frontmatter、actor-safe 摘要字段和 GraphRAG who-knows-what 边；`rp.writer` 写作前 lorebook retrieval sidecar 仍待设计。
