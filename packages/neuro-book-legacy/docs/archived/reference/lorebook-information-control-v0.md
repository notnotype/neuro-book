# NeuroBook Directory Protocol

本文档写给 NeuroBook 的作者和 AI Agent。它定义 Project Workspace 中 `lorebook/`、`simulation/`、`subjects/`、`entities/`、`reference/` 与 `.nbook/` 的目录职责，让写作模式、RP 模式、simulator leader、若干 simulator、writer、retrieval、SillyTavern 导入器和 GraphRAG 使用同一套信息分层语言。

当前版本先规范目录层、lorebook 内容类型层、simulation 实体层和 subject 信息控制层；完整信息控制 frontmatter、正文分区、GraphRAG 边类型和变量系统仍是后续设计。

## Core Positioning

NeuroBook 的 Project Workspace 目录按职责分层：

| Directory | Purpose | Primary Reader |
| --- | --- | --- |
| `lorebook/` | 无状态、稳定、全知视角的作品说明书：类型、原型、规则和 canon | simulator leader、retrieval、开发者、授权后的 writer |
| `simulation/` | 世界模拟层：调度协议、信息控制主体、可变实体、运行过程和状态快照 | simulator leader、simulator profiles、写作/RP 信息控制流程 |
| `simulation/subjects/` | 信息控制主体：会知道、误解、判断、行动和隐瞒的角色或拟人化组织 | subject simulator、simulator leader |
| `simulation/entities/` | 有状态实例：物品、地点、机关、事件进程等需要被模拟的对象 | entity simulator、simulator leader |
| `reference/` | 外部素材、导入归档、低置信迁移材料 | 导入器、research / migration agent、simulator leader 审查流程 |
| `.nbook/` | 系统配置、Project SQLite、Agent runtime、模板覆盖和编译产物 | NeuroBook runtime、开发者、系统维护 agent |

`roleplay/` 是旧 RP 目录名。它之前更接近“世界模拟功能”，不是单纯角色扮演资源目录。当前目标结构硬切为 `simulation/`，不保留 `roleplay/` 模板兼容；旧 Project Workspace 需要手动迁移或等待后续迁移工具。

`actor` 是 simulator 的一种，不是 Project Workspace 的顶层目录概念。角色、玩家、势力等信息控制主体放在 `simulation/subjects/`；物品、地点、机关、事件进程等有状态对象放在 `simulation/entities/`。

## Target Directory Shape

推荐目标结构：

```text
project/
|-- project.yaml
|-- .nbook/
|-- manuscript/
|-- lorebook/
|   |-- index.md
|   |-- world/
|   |-- character/
|   |-- location/
|   |-- faction/
|   |-- item/
|   |-- event/
|   `-- system/
|-- simulation/
|   |-- config.yaml
|   |-- simulator.md
|   |-- cast.yaml
|   |-- writer.md
|   |-- subjects/
|   |   |-- index.md
|   |   `-- {subject-id}/
|   |       |-- subject.md
|   |       |-- events.md
|   |       |-- knowledge.md
|   |       |-- mind.md
|   |       `-- state.md
|   |-- entities/
|   |   |-- index.md
|   |   `-- {entity-id}/
|   |       |-- entity.md
|   |       |-- events.md
|   |       `-- state.md
|   `-- runs/
|       |-- current.md
|       `-- ticks/
`-- reference/
```

旧目录迁移结论：

```text
roleplay/                 -> simulation/
roleplay/gm.md            -> simulation/simulator.md
roleplay/actors/{id}/     -> simulation/subjects/{id}/
roleplay/playthrough/     -> simulation/runs/
```

当前默认 Project 模板直接生成 `simulation/`。`simulation/cast.yaml` 只保存本次模拟可调度的 simulator / subject 注册信息，并通过路径引用 `simulation/subjects/{subject-id}/...` 或 `simulation/entities/{entity-id}/...`。

## Information Layers

本协议推荐的基础建模模式是 **Prototype / Instance + Event Sourcing + Subject-facing View**：

- `lorebook/` 保存 prototype、类型、规则和全知 canon。
- `simulation/entities/` 只保存需要状态追踪的 instance。
- `events.md` 保存 subject 或 entity 经历过的重要事件流水。
- `state.md` 保存当前 snapshot。
- `knowledge.md` 保存 subject 以自己视角知道、相信或误解的内容。

引用路径不是可见性授权。`state.md` 或 `entity.md` 可以引用 `lorebook/...` 原型，但 subject 不能因为看到引用就读取完整 lorebook。subject 可见内容必须来自 `events.md`、subject-facing `state.md`、`knowledge.md`，或 simulator leader 过滤后的输入。

### Canonical Layer

Canonical layer 是作品事实、原型、规则和可复用说明。它主要放在 `lorebook/`。

内容包括：

- 世界真实设定、历史、地点、势力、物品、事件、机制。
- 上帝视角角色设定、背景故事、秘密和作者备注。
- 物品原型、机制规则、隐藏后果和通用使用规则。
- 作品级 AI 使用说明，例如文风、披露原则、检索优先级。

`lorebook/` 是全知的。任何 subject / entity simulator 都不能直接读取完整 lorebook 作为自己的可见知识。simulator leader、retrieval 或 sidecar 应根据视角过滤后注入。

### Subject Layer

Subject layer 是信息控制主体的视角资料。它主要放在 `simulation/subjects/{subject-id}/`。

内容包括：

- 角色、玩家、组织、势力等主体的模拟指令。
- 主体已经知道、被告知、观察到、自然理解或误解的信息。
- 当前心态、短期动机、疑虑和判断。
- 当前地点、持有物摘要、伤势、姿态、关系压力和短期目标。
- 主体经历过的重要事件流水账。

Subject layer 不是 canonical truth 的简单子集。subject 可以误解、遗漏或只知道传闻；simulator leader 在后台负责区分主体视角与真实设定。

### Entity Layer

Entity layer 是需要状态的实例。它主要放在 `simulation/entities/{entity-id}/`。

内容包括：

- 某个具体物品、地点、机关、事件进程、任务进程、委托进度、碎片、容器、门、仪式等实例。
- 该实例引用的 lorebook 原型。
- 当前持有人、位置、损坏程度、激活状态、进度、可见外观、隐藏状态。
- 该实例经历过的重要事件流水账。

不是所有 lorebook 条目都需要实例化为 entity。实例化的目的不是信息控制，而是状态追踪。只有当对象有独立状态、隐藏真相、唯一性、持有人差异、进度、损坏程度或剧情重要性时，才建立 entity。

### Run Layer

Run layer 是某次运行、游玩、调试或写作过程的产物。目标位置是 `simulation/runs/`。

内容包括：

- 当前局面、Tick 记录、simulator scratch、subject response、entity update、writer brief 和 prose。
- RP 运行配置、写作模拟配置、cast 调度、simulator 协议和 writer 协议。

Run layer 不是稳定 lorebook，也不是 subject 长期记忆。需要沉淀的结果应由 simulator leader、sidecar 或作者整理后写回 `lorebook/`、`simulation/subjects/` 或 `simulation/entities/`。

### Reference Layer

Reference layer 是原始外部素材和迁移材料，主要放在 `reference/`。

内容包括：

- SillyTavern 原始角色卡、worldbook 解包、导入报告。
- MVU、prompt template、regex、tavern helper 脚本。
- 低置信 OCR/解析结果、待 review 资料。

Reference layer 不直接等于稳定设定。导入器和 Agent 应把它作为迁移输入，而不是默认注入 writer、subject 或 entity simulator。

## Directory Responsibilities

### `lorebook/`

`lorebook/` 是给 AI 的无状态作品说明书。它保存稳定、可复用、需要被检索和引用的全知设定、类型、原型和规则。

Lorebook 可以包含两类内容，但必须区分：

- **作品内事实**：世界、角色、地点、势力、物品、事件、机制等。
- **AI 使用说明**：写作风格、创作边界、输出要求、信息披露规则等。

不适合作为默认 lorebook 条目的内容：

- 简介、故事概念、开局种子和项目定位。
- 剧情安排、章节过程、simulation run / RP playthrough。
- subject 的主观心智、个人记忆、当前目标和状态。
- entity 的当前持有人、激活状态、损坏状态、进度和实例差异。
- 原始外部素材。
- MVU、prompt template、regex、tavern helper 脚本。
- 临时导入缓存、低置信 OCR/解析结果、review 便签。

推荐归属：

| Content | Recommended Place |
| --- | --- |
| 短简介 | `project.yaml.summary` |
| 长简介 / 故事概念 / 项目定位 | `PROJECT-STATUS.md`、planning 文档，或后续独立 project brief |
| 稳定世界事实、原型和规则 | 拆入具体 lorebook 节点 |
| subject 视角资料 | `simulation/subjects/{subject-id}/` |
| 有状态实例 | `simulation/entities/{entity-id}/` |
| 运行过程 | `simulation/runs/` 或 Plot |
| 外部原始素材 | `reference/` |
| MVU / prompt template / regex / tavern helper | `reference/`，等待专门迁移 |

### `simulation/`

`simulation/` 是世界模拟层。它不只服务 RP，也服务写作过程中的世界推进、角色反应判断、信息控制和实体状态维护。

推荐结构：

```text
simulation/
|-- config.yaml
|-- simulator.md
|-- cast.yaml
|-- writer.md
|-- subjects/
|-- entities/
`-- runs/
```

文件职责：

| File | Purpose |
| --- | --- |
| `config.yaml` | simulation 运行配置，例如默认 simulator leader、subject simulator、entity simulator、writer profile、Tick checklist。 |
| `simulator.md` | 原 `gm.md` 的目标形态；主模拟器 / simulator leader 的运行协议、裁决原则和信息控制规则。 |
| `cast.yaml` | 本次 simulation 可调度的 subjects、entities、profiles 和路径注册表。 |
| `writer.md` | writer 的提示词素材、文风和输出契约。 |
| `subjects/` | 信息控制主体目录。 |
| `entities/` | 有状态实例目录。 |
| `runs/` | 本次运行过程记录和 Tick 产物。 |

`simulator leader` 负责全局裁决、世界推进、信息控制、subject / entity simulator 调度和 writer brief 构造。

`simulator` 是可被调用的模拟单元。`actor` 是 simulator 的一种，主要用于 subject；物品、地点、机制、组织和事件进程也可以拥有专门 simulator。

### `simulation/subjects/`

`subjects/` 是信息控制主体目录。它保存会知道、误解、判断、行动、隐瞒的主体。

推荐结构：

```text
simulation/subjects/
|-- index.md
`-- {subject-id}/
    |-- subject.md
    |-- events.md
    |-- knowledge.md
    |-- mind.md
    `-- state.md
```

文件职责：

| File | Purpose | Notes |
| --- | --- | --- |
| `subject.md` | subject 模拟指令、稳定人格、语气、行动原则和模拟限制 | 只写过滤后的 subject-facing 指令；不要直接展开或授予 `lorebook/character/...` 的全知内容。 |
| `events.md` | subject 亲历或被告知的重要事件流水账 | 记录“怎么知道的”“什么时候获得的”。 |
| `knowledge.md` | subject 已知世界观、事实、关系和地点认知 | subject-facing，不写上帝视角、幕后真相或 simulator 裁决。 |
| `mind.md` | 当前短期心理状态、疑虑、判断、动机和情绪倾向 | 主观、短期、可变化。 |
| `state.md` | 当前地点、持有物摘要、身体状态、关系压力和短期目标 | 短而可检查；可引用具体 `simulation/entities/...`。 |

玩家操控角色也应该是一个 subject。simulator leader 仍应把用户视为故事内 subject，但不能替用户决定核心行动意图。

`knowledge.md` 约定：

- 使用二级章节归类、三级标题表示条目。
- 条目正文用自然段，不要用 Markdown 列表堆条目。
- 不新增“信念与误解”“最近更新”或“更新规则”章节。
- 只记录 subject 已经知道、被告知、观察到或自然推断到的信息。
- 不直接写可让 subject simulator 展开的 `lorebook/...` 链接；如果需要追踪来源，可由 simulator leader 或 sidecar 在隐藏元数据 / 内部日志中记录 source ref。

示例：

```text
simulation/subjects/player/
|-- subject.md
|-- events.md
|-- knowledge.md
|-- mind.md
`-- state.md
```

```md
## 世界观

### 翠梦晶露

你在十年前的一次冒险中经过某座城市时，曾在酒馆里从一名流亡精灵口中听说过翠梦晶露。你知道这是一种与精灵秘仪相关的稀有材料，但并不知道它的完整用途。
```

背包中的普通物品可以只在 `state.md` 中引用 prototype，不必建立多个 entity：

```yaml
inventory:
  - prototype: lorebook/item/consumable/blood-potion/
    subjectVisibleName: 血药
    quantity: 3
    subjectKnownEffect: 通常用于恢复伤势
```

如果其中一瓶后来被下毒、绑定、损坏、藏有秘密，或成为剧情关键对象，再把那一瓶提升为 `simulation/entities/{entity-id}/`，并在 subject state 中引用该 entity。

### `simulation/entities/`

`entities/` 是有状态实例目录。它保存需要被模拟、会变化、会被持有、会被激活、会有进度或隐藏状态的对象。

推荐结构：

```text
simulation/entities/
|-- index.md
`-- {entity-id}/
    |-- entity.md
    |-- events.md
    `-- state.md
```

文件职责：

| File | Purpose | Notes |
| --- | --- | --- |
| `entity.md` | 实例说明、kind、prototype、模拟边界和可见名称 | `prototype` 通常指向 `lorebook/...`。 |
| `events.md` | 实例经历过的重要事件流水账 | 例如被谁制造、被谁下毒、被谁拿走、何时激活。 |
| `state.md` | 当前状态、位置、持有人、损坏程度、激活状态、可见外观和隐藏状态 | 用于模拟，不直接等于 subject knowledge。 |

普通、可堆叠、无差异、无隐藏状态的物品不需要实例化。可以在 subject 的 `state.md` 中用 `prototype + quantity` 表示。

一旦出现独立状态、隐藏真相、唯一性、持有人差异、剧情重要性或未来需要追踪，就建立 entity。

例子：

```text
lorebook/item/consumable/blood-potion/index.md
simulation/entities/poisoned-blood-potion-001/
|-- entity.md
|-- events.md
`-- state.md
```

`entity.md` 可以记录：

```yaml
kind: item
prototype: lorebook/item/consumable/blood-potion/
displayName: 血药
```

`state.md` 可以记录：

```yaml
holder: simulation/subjects/npc-a/
condition:
  poisoned: true
subjectVisibleName: 血药
subjectVisibleProperties:
  - 看起来和普通血药没有区别
```

subject 是否知道它有毒，不由 entity 引用决定，而由 `simulation/subjects/{subject-id}/knowledge.md` 决定。

### `simulation/runs/`

`runs/` 是运行过程目录。它保存本次世界模拟、RP、写作试跑或调试过程中的 Tick 产物。

推荐结构：

```text
simulation/runs/
|-- current.md
`-- ticks/
    `-- 000001/
        |-- user-input.md
        |-- simulator-scratch.md
        |-- subject-results/
        |-- entity-updates/
        |-- writer-brief.md
        `-- prose.md
```

关键边界：

- `runs/` 是过程记录，不是 canonical lorebook，也不是 subject 长期记忆。
- subject 默认不读取完整 `runs/`，除非 simulator leader 把其中内容过滤后注入。
- writer 可以在 simulator leader 明确要求时把正文写入 `runs/ticks/{tick-id}/prose.md`，但不自行浏览完整 `runs/`。
- 需要沉淀的内容应整理回 `simulation/subjects/`、`simulation/entities/` 或 `lorebook/`。

### `.nbook/`

Project Workspace 内的 `.nbook/` 保存系统、运行时和项目级配置资产，不保存作品正文设定。

典型内容：

- `.nbook/config.json`：Project Config。
- `.nbook/project.sqlite`：Project SQLite。
- `.nbook/agent/`：用户覆盖的 profile、skills、compiled artifacts、sessions。
- `.nbook/templates/`：用户覆盖的模板。

`.nbook/` 不是作者设定目录。不要把 lorebook、subject knowledge、entity state、simulation runs、SillyTavern 原始素材放进 `.nbook/`。

Bundled Workspace Template 位于仓库资产：

```text
assets/workspace/.nbook/templates/
```

用户覆盖层位于 Workspace Root：

```text
workspace/.nbook/templates/
```

这些模板可以生成或补齐 Project Workspace 的 `lorebook/`、`simulation/`、`reference/` 等目录，但模板本身不是作品内容。

## Prototype, Entity, Subject

本协议使用三类对象来避免把所有东西都实例化：

| Concept | Directory | Meaning |
| --- | --- | --- |
| Prototype | `lorebook/` | 类型、原型、全知规则、隐藏后果。 |
| Entity | `simulation/entities/` | 有状态实例。 |
| Subject | `simulation/subjects/` | 信息控制主体。 |

例子：血药原型写在 `lorebook/item/consumable/blood-potion/`。角色拥有三瓶普通血药时，不需要实例化三次，可以在 subject state 中写：

```yaml
inventory:
  - prototype: lorebook/item/consumable/blood-potion/
    subjectVisibleName: 血药
    quantity: 3
    subjectKnownEffect: 恢复伤势
```

如果其中一瓶被下毒，它有隐藏状态和独立剧情意义，就实例化：

```yaml
inventory:
  - entity: simulation/entities/poisoned-blood-potion-001/
    subjectVisibleName: 血药
```

世界之心被分成三块时，每块能力、持有人和可见信息都不同，应实例化三次：

```text
lorebook/item/artifact/world-heart/
simulation/entities/world-heart-fragment-a/
simulation/entities/world-heart-fragment-b/
simulation/entities/world-heart-fragment-c/
```

三个持有者的 `knowledge.md` 只记录各自知道的碎片信息；不能因为 state 引用了 entity 或 entity 引用了 lorebook，就把全知规则暴露给 subject。

## Compatibility With Current Content Specs

当前 [内容节点当前状态规范](state.md) 仍允许内容节点目录使用同级 `state.md` 表达当前世界状态，[retrieval / inject 规范](retrieval.md) 也允许 writer 在读取内容节点时读取同级可选 `state.md`。本协议不在第一版删除这条现有合同。

本协议先收敛目录职责：

- `lorebook/**/index.md` 保存稳定设定、目录说明和可复用 AI 使用说明。
- 现有 `lorebook/**/state.md` 仍按 `reference/content/state.md` 解释，用于客观当前状态。
- 不要新增 subject 主观状态、个人记忆、当前目标、情绪和私有 knowledge 到 lorebook 同级 `state.md`。
- subject 动态状态进入 `simulation/subjects/{subject-id}/state.md`。
- entity 动态状态进入 `simulation/entities/{entity-id}/state.md`。

长期方向是逐步减少并迁出 lorebook 下的 `state.md`，让 lorebook 更接近无状态说明书。迁移完成前，旧 `state.md` 仍是兼容结构，不应被导入器或 writer 立即视为非法。

## Lorebook Type System V1

第一版默认模板只放 7 个通用高频目录，外加入口说明：

```text
lorebook/
|-- index.md
|-- world/
|-- character/
|-- location/
|-- faction/
|-- item/
|-- event/
`-- system/
```

前两层建议结构：

```text
lorebook/
|-- index.md                         # 当前项目 lorebook 目录说明，不是设定条目
|-- world/                           # 世界结构、历史、常识、世界内规则
|   |-- overview/
|   |-- history/
|   |-- geography/
|   |-- ecology/
|   |-- culture/
|   `-- rule/
|-- character/                       # 上帝视角角色设定
|   |-- 重要角色A/
|   |-- 重要角色B/
|   `-- minor/
|-- location/                        # 空间层级，真实项目继续向下嵌套
|   |-- 大陆A/
|   |-- 国家A/
|   `-- 城市A/
|-- faction/                         # 国家、势力、阵营
|   |-- 势力A/
|   `-- 势力B/
|-- item/                            # 物品原型、材料、装备、资源
|   |-- prop/
|   |-- book/
|   |-- consumable/
|   |-- material/
|   `-- equipment/
|-- event/                           # 历史事件与背景事件
|   |-- history/
|   |-- incidents/
|   |-- wars/
|   `-- rituals/
`-- system/                          # 玩法/状态规则/变量机制
    |-- state-rules/
    |-- variable-rules/
    |-- mechanics/
    `-- ui/
```

这些第二层目录是推荐范例，不是强制枚举。

## Supported Lorebook Types

| Type | Default Root? | Meaning | Notes |
| --- | --- | --- | --- |
| `world` | Yes | 世界主设定、宇宙结构、历史总览、宏观地理、时代背景、世界内规则 | 世界规则放 `world/rule/`，但节点 type 仍是 `world`。 |
| `character` | Yes | 上帝视角角色设定、NPC、主角、重要配角、可扮演实体 | subject 视角资料放 `simulation/subjects/`。 |
| `location` | Yes | 地点、城市、区域、建筑、房间、场景空间 | 有独立当前状态时可建立 `simulation/entities/{location-id}/`。 |
| `faction` | Yes | 国家、势力、阵营、政治实体 | 需要拟人化模拟时可建立 `simulation/subjects/{faction-id}/`。 |
| `item` | Yes | 道具、装备、材料、资源、文档物品、设备、货币的原型 | 有独立状态时可建立 `simulation/entities/{item-id}/`。 |
| `event` | Yes | 历史事件、背景事件、战争、事故、仪式、比赛 | 正在推进的事件进程可建立 `simulation/entities/{event-process-id}/`。 |
| `system` | Yes | 玩法系统、状态规则、命定系统、炼金玩法、变量展示规则 | 机制化、可运行或可模拟的规则。 |
| `species` | No | 种族、血脉、生命类型 | 默认可放 `world/species/`；高频项目可提升为 `species/`。 |
| `creature` | No | 生物、魔物、动物、植物、生态实体 | 默认可放 `world/ecology/`；高频项目可提升为 `creature/`。 |
| `organization` | No | 组织、公会、学院部门、家族、教会、球队 | 默认可放 `faction/` 下；高频项目可提升为 `organization/`。 |
| `instruction` | No | 给 AI 的作品级使用说明，例如写作风格、创作边界、输出要求、检索规则、信息披露原则 | 只放可跨 agent 复用的作品级说明；profile 私有行为和工具权限不放 lorebook。 |

## Not Lorebook Types

| Name | Destination |
| --- | --- |
| `relationship` | 不设计独立类型。subject 关系写在 `simulation/subjects/` 或相关 lorebook 正文 / refs 中；实体关系写在 entity state 中。 |
| `rule` | 不作为正式协议类型。世界内规则归 `world`，AI 指令归 `instruction`，机制规则归 `system`。 |
| `note` | 不作为稳定 lorebook 类型。低置信导入、未整理资料和临时说明优先进入 `reference/` 或待 review 区。 |
| `formatting` | 不做独立 type。状态栏格式或输出格式归入 `instruction` 或 `system`。 |
| `dynamic-mvu` | 不属于稳定 lorebook；保留在 `reference/` 或后续 simulation mechanics 迁移任务。 |
| `dynamic-prompt` | 不属于稳定 lorebook；保留在 `reference/` 或后续 prompt / mechanics 迁移任务。 |

## Instruction Nodes

`instruction` 是给 AI 使用作品资料的说明，不是作品内事实。它适合保存“多个 agent 都可能需要知道”的作品级规则。

少量全局说明可以直接写在 `lorebook/index.md`。当说明较多、需要独立检索、需要 refs 或后续信息控制时，可以启用可选目录：

```text
lorebook/instruction/
|-- style/
|-- narration/
|-- boundary/
|-- disclosure/
|-- retrieval/
|-- formatting/
`-- continuity/
```

推荐 `instruction` subtype：

| Subtype | Use For | Examples |
| --- | --- | --- |
| `style` | 作品级文风、语气、修辞偏好 | 文笔清冷、少用网络梗、战斗描写偏写实。 |
| `narration` | 叙事视角、时态、旁白距离、内心描写边界 | 第三人称限知、避免上帝旁白提前揭示秘密。 |
| `boundary` | 创作边界、题材禁区、角色不可被破坏的底线 | 不写角色崩坏；不突破作品分级。 |
| `disclosure` | 信息披露原则、悬念保留、读者/角色知道什么的叙事规则 | 角色秘密只能通过剧情触发逐步揭示。 |
| `retrieval` | 检索和注入偏好，帮助 retrieval / writer 判断哪些条目优先使用 | 写学院场景时优先检索学院区、课程制度和当前出场角色。 |
| `formatting` | 作品级输出格式、状态栏展示、固定段落样式 | RP 输出末尾固定显示状态栏；章节正文不输出项目符号。 |
| `continuity` | 连贯性约束、设定优先级、冲突处理原则 | 新正文不得覆盖已确定时间线；冲突时以最近 canon 节点为准。 |

不应放入 `instruction` 的内容：

- 单次任务要求、用户临时指令和当前 Tick 命令。
- agent profile 私有行为、工具权限、run loop 流程和 sidecar 机制。
- subject 的个人记忆、心智、当前目标和状态。
- entity 的当前状态。
- 作品内事实本身；事实应拆到 `world`、`character`、`location`、`faction`、`item`、`event` 或 `system`。

如果某条说明只服务某个 profile，例如 writer 的工具限制、subject simulator 的扮演方式、simulator leader 的调度流程，应放到 agent profile / `simulation/simulator.md` 中，而不是 lorebook。

## Directory Conventions

### `lorebook/index.md`

`lorebook/index.md` 是当前项目 lorebook 的入口说明。它不是具体设定条目，而是告诉人类和 AI：这个项目如何组织说明书。

建议包含：

```md
# Lorebook

本目录是 AI 可检索的无状态作品说明书。稳定世界事实、角色设定、地点、势力、物品原型、事件和机制进入这里。

## 默认目录

- `world/`：世界结构、历史、常识和世界内规则。
- `character/`：上帝视角角色设定。
- `location/`：地点和空间层级。
- `faction/`：国家、势力和阵营。
- `item/`：物品原型、材料、装备和资源。
- `event/`：历史事件和背景事件。
- `system/`：玩法/状态规则/变量机制。

## 项目扩展目录

- `species/`：本项目种族设定非常重要，因此提升为顶层目录。
- `organization/`：学院政治和组织网络非常重要，因此提升为顶层目录。

## 不放在这里

- 章节正文、剧情安排、故事概念和粗略开局剧情进入 `manuscript/`、Plot、runs 或项目状态文档。
- subject 视角资料进入 `simulation/subjects/`。
- entity 当前状态进入 `simulation/entities/`。
- 原始外部素材进入 `reference/`。
- 动态脚本、MVU 变量补丁和提示词模板先进入 `reference/`，等待专门迁移。
```

### `simulation/subjects/index.md`

`simulation/subjects/index.md` 是 subject 目录入口。它说明哪些 subject 存在、哪些 subject 给写作/RP 复用、哪些 subject 由用户控制。

建议包含：

```md
# Subjects

本目录保存信息控制主体。subject 文件可被写作流程和 RP 流程复用。

## Subject 列表

- `player/`：玩家角色，由用户控制。
- `erina/`：重要 NPC，可由 subject simulator 扮演。

## 边界

- subject 文件不保存上帝视角秘密。
- subject 的 `knowledge.md` 只记录主体已经知道或合理相信的信息。
- subject 的 `mind.md` 和 `state.md` 是可变资料，不是 lorebook canon。
```

### `simulation/entities/index.md`

`simulation/entities/index.md` 是 entity 目录入口。它说明当前哪些实例需要独立模拟。

建议包含：

```md
# Entities

本目录保存需要状态追踪的实例。普通无差异物品不需要实体化。

## Entity 列表

- `poisoned-blood-potion-001/`：被下毒的血药。
- `world-heart-fragment-a/`：世界之心碎片 A。

## 边界

- entity 的 `state.md` 可以保存隐藏真实状态。
- subject 是否知道这些状态，由 subject 的 `knowledge.md` 决定。
- entity 引用 lorebook 原型不代表任何 subject 可以读取该 lorebook。
```

### Containment

有明显从属关系的 lorebook 内容，优先放到对应节点下；没有稳定上级、或需要跨很多场景复用时，再放到通用顶层目录。

例子：

```text
lorebook/creature/plants/月眠草/
|-- index.md                         # type: creature, subtype: plant
`-- 干叶/
    `-- index.md                     # type: item, subtype: material
```

```text
lorebook/location/皇宫/女仆-A/
`-- index.md                         # type: character
```

如果这个女仆后续需要独立模拟或长期信息控制，再建立：

```text
simulation/subjects/maid-a/
|-- subject.md
|-- events.md
|-- knowledge.md
|-- mind.md
`-- state.md
```

目录表达从属，frontmatter 表达节点本体，`simulation/subjects/` 表达主体视角运行资料。

### Location

推荐地点层级从大到小组织：

```text
宇宙 -> 星球 -> 大陆 -> 国家 -> 省/领 -> 城市 -> 建筑 -> 房间/区域
```

并不是每个项目都需要完整层级。普通奇幻小说可能从大陆或国家开始；校园、都市或密室故事可以直接从城市、学院或建筑开始。

示例：

```text
lorebook/location/
`-- 阿斯塔利亚大陆/
    `-- 奥古斯提姆帝国/
        `-- 艾瑟嘉德/
            `-- 学院区/
                |-- index.md
                |-- 炼金术师公会/
                |   `-- index.md
                `-- 第一实验楼/
                    |-- index.md
                    `-- 地下储藏室/
                        `-- index.md
```

地点如果需要独立当前状态，例如封锁、火灾、门禁、占领方、当前在场对象，可以建立 entity：

```text
simulation/entities/first-lab-building/
|-- entity.md
|-- events.md
`-- state.md
```

### Character And Subject

`lorebook/character/` 和 `simulation/subjects/` 分工不同：

| Directory | Meaning |
| --- | --- |
| `lorebook/character/{name}/` | 上帝视角角色设定、背景、秘密、作者说明。 |
| `simulation/subjects/{subject-id}/` | subject 视角资料、可扮演指令、已知信息、当前心智和状态。 |

重要角色建议在 `lorebook/character/` 下有 canonical 节点，也在 `simulation/subjects/` 下有 subject 节点。

不重要角色可以只放在 `lorebook/location/...` 或 `lorebook/faction/...` 的从属节点中；只有当它需要被 subject simulator 扮演、长期维护 knowledge/mind/state，或参与写作信息控制时，才建立 `simulation/subjects/{subject-id}/`。

### Faction And Organization

`faction` 保存国家、联盟、阵营和政治实体。势力通常不会很多，默认不建议细分太多二级目录。

`organization` 是支持类型，但不进默认模板。学院政治、组织网络、公会系统很重要的项目，可以提升为顶层目录：

```text
lorebook/organization/
|-- academy-council/
|-- alchemy-guild/
`-- student-union/
```

重要势力如果需要拟人化模拟，可以建立 subject：

```text
simulation/subjects/academy-council/
|-- subject.md
|-- events.md
|-- knowledge.md
|-- mind.md
`-- state.md
```

如果它只是有当前状态的组织实例，例如占领进度、资源、成员数量，也可以建立 entity：

```text
simulation/entities/academy-council-state/
|-- entity.md
|-- events.md
`-- state.md
```

### Species And Creature

`species` 更适合表达“人类、精灵、龙族、兽族”这类文明、血统、可成为角色身份的类型。

`creature` 更适合表达“史莱姆、森林狼、食人花、月眠草”这类生态对象。

默认模板可以把它们放在 `world/` 下面：

```text
lorebook/world/
|-- species/
`-- ecology/
```

高频项目可以提升：

```text
lorebook/
|-- species/
|   |-- elves/
|   |-- beastfolk/
|   `-- dragons/
`-- creature/
    |-- monsters/
    |-- animals/
    `-- plants/
```

### Item

`item` 是高频但不适合穷举的类型。现实项目中的物品分类取决于题材：现代都市会有电器、服装、证件；奇幻会有武器、药剂、材料；科幻会有终端、载具、芯片。

第一版只保留几类通用 subtype：

| Subtype | Use For | Notes |
| --- | --- | --- |
| `prop` | 普通道具、剧情道具、一次性叙事物件 | 最宽泛的物品 subtype。 |
| `equipment` | 可装备、穿戴、携带并长期影响能力或身份的物品 | 武器、防具、服装、饰品都可先归这里。 |
| `consumable` | 会被消耗的物品 | 药剂、食物、弹药、一次性符咒。 |
| `material` | 可作为制作、交易或采集对象的材料 | 矿石、草药干叶、怪物素材、布料。 |
| `document` | 承载文本或信息的物品 | 书籍、信件、契约、证件、档案。 |
| `device` | 有功能结构的器具、设备、电器、终端 | 现代电器、魔导器械、科幻设备。 |
| `vehicle` | 交通工具或可乘坐/驾驶的物品 | 马车、飞船、机甲、飞艇。 |
| `currency` | 货币、票据、可计价资源 | 金币、银票、点数、信用芯片。 |
| `artifact` | 独特遗物、神器、唯一或准唯一物品 | 独特性强时用。 |

目录可以继续按作者直觉细分：

```text
lorebook/item/
|-- equipment/
|   |-- clothing/
|   |-- weapon/
|   `-- accessory/
|-- device/
|   |-- appliance/
|   `-- terminal/
|-- document/
|   |-- book/
|   `-- contract/
`-- material/
```

如果物品属于某个地点、角色、组织或生物的附属内容，可以放到对应节点下面，不必强行放到 `item/` 根目录。

## Relationship Patterns

创作中常见关系按四层记录：

| Relation Kind | Where | Example |
| --- | --- | --- |
| prototype relation | `lorebook/` | 血药属于消耗品；世界之心可以被分成三块。 |
| state relation | `simulation/entities/*/state.md` 或 `simulation/subjects/*/state.md` | NPC-A 持有某个碎片；某扇门已锁定。 |
| knowledge relation | `simulation/subjects/*/knowledge.md` | NPC-A 只知道自己持有的碎片能力，不知道其他碎片能力。 |
| event relation | `events.md` | NPC-A 在十年前从流亡精灵口中听说翠梦晶露。 |

这些关系可以互相引用，但不会自动互相泄露信息。比如 `simulation/subjects/npc-a/state.md` 可以记录 NPC-A 持有 `simulation/entities/world-heart-fragment-a/`；`world-heart-fragment-a/state.md` 可以记录它真实能力；NPC-A 是否知道这份真实能力，仍取决于 `simulation/subjects/npc-a/knowledge.md` 和事件来源。

更多关系例子：

- 持有：subject 持有 entity，或持有某个 prototype 的若干普通副本。
- 所属：subject 属于某个组织；组织可以是 lorebook faction，也可以是 subject / entity。
- 位置：subject 或 entity 位于某个 location entity。
- 伪装：entity 真实是毒药，但可见名称是血药。
- 绑定：神器 entity 绑定某个 subject。
- 权限：只有特定血脉、身份或钥匙能激活 entity。
- 因果锁：拿走钥匙会触发警报。
- 进度：仪式 entity 已完成 2/3。
- 传闻：subject 只听说某物有诅咒，但真假未知。
- 认知错误：subject 以为 B 是普通人，但 lorebook canon 中 B 是王族。

## Classification Method

新概念优先按下面顺序判断：

1. 它是 AI 使用说明、作品内事实、subject 视角资料、entity 状态，还是运行过程产物？
2. 如果是作品内事实，它的主要语义角色是什么：世界背景、角色、地点、势力、物品、事件、机制？
3. 如果它是 subject 视角资料，放入 `simulation/subjects/{subject-id}/`，而不是 `lorebook/character/`。
4. 如果它是有状态实例，放入 `simulation/entities/{entity-id}/`，而不是 `lorebook/`。
5. 如果它是规则，判断是世界内规则、创作指令，还是可运行/可模拟机制。
6. 如果它有明显上级实体，优先用目录嵌套表达 lorebook 从属；运行时从属用 state relation 表达。
7. 如果它会跨场景复用、需要单独检索或信息控制，建立独立节点。
8. 更细的现实世界分类优先用 `subtype`、目录、tag、refs 表达，不急着升级为新 type。

压力测试结论：

- `type` 不追求覆盖现实世界所有名词，而追求覆盖 AI 理解作品说明书时最常见的语义角色。
- 目录、tag 和 refs 可以表达比 `type` 更细的真实世界分类。
- 只有当某类节点高频、稳定、需要独立管理时，才考虑提升为项目顶层目录。
- subject 视角资料进入 `simulation/subjects/`，避免污染上帝视角 lorebook。
- entity 当前状态进入 `simulation/entities/`，避免让 lorebook 承担运行时状态。

### Pressure Tests

| Concept | Suggested Type / Directory | Suggested Placement | Rationale |
| --- | --- | --- | --- |
| 血药原型 | `item` | `lorebook/item/consumable/blood-potion/` | 写全知规则、隐藏后果、制作方式。 |
| 三瓶普通血药 | subject state inventory | `simulation/subjects/{id}/state.md` | 普通可堆叠副本不需要实例化三次。 |
| 一瓶被下毒的血药 | entity | `simulation/entities/poisoned-blood-potion-001/` | 有隐藏状态和独立剧情意义，需要实例化。 |
| 世界之心原型 | `item` / `artifact` | `lorebook/item/artifact/world-heart/` | 写全知来源、总规则、拆分规则。 |
| 世界之心三个碎片 | entity | `simulation/entities/world-heart-fragment-a/` 等 | 每块能力、持有人和可见信息不同，应实例化。 |
| 碎片持有者知道自己的碎片能力 | subject knowledge | `simulation/subjects/{holder-id}/knowledge.md` | subject 知识不由 entity 引用自动泄露。 |
| 附魔术 | `system` | `lorebook/system/enchantment/` 或 `lorebook/world/rule/magic/enchantment/` | 如果重点是玩法流程、制作步骤、状态效果，用 `system`；如果重点是世界内魔法法则，用 `world`。 |
| 一把普通附魔剑 | `item` 或 inventory prototype | `lorebook/item/equipment/weapon/附魔剑/` | 只有无独立状态时可保持原型或背包条目。 |
| 断裂的唯一附魔剑 | entity | `simulation/entities/broken-enchanted-sword-001/` | 有损坏状态和唯一性，应实例化。 |
| 某场战争 | `event` | `lorebook/event/wars/某场战争/` | 已发生的历史事件用 `event`。 |
| 正在推进的仪式 | entity | `simulation/entities/ritual-001/` | 有进度、参与者和触发条件。 |
| 球队组织 | `organization` 或 `faction` | `lorebook/organization/sports-team/` | 组织 canon。 |
| 球队专精 simulator | subject | `simulation/subjects/sports-team/` | 当球队需要拟人化决策、发言或维护意图时，建立 subject。 |
| 体育馆 | `location` | `lorebook/location/.../体育馆/` | 空间原型 / canon。 |
| 体育馆当前封锁 | entity | `simulation/entities/gym-lockdown/` | 当前状态、封锁原因、可见入口属于 entity 状态。 |
| 角色当前误解 | subject knowledge | `simulation/subjects/{subject-id}/knowledge.md` | subject 视角资料，不写入 lorebook canon。 |
| 角色当前犹豫 | subject mind | `simulation/subjects/{subject-id}/mind.md` | 主观心态，不写入 lorebook canon。 |
| 本 Tick 裁决过程 | run artifact | `simulation/runs/ticks/{tick-id}/simulator-scratch.md` | run artifact，不是稳定设定。 |

## Information Control Deferred

信息控制层暂不在本版协议中定义 schema。

后续需要单独设计：

- lorebook 条目如何声明“谁默认知道什么、谁不知道什么”。
- `simulation/subjects/{subject-id}/knowledge.md` 如何覆盖默认声明。
- entity state 中的 hidden state 如何转换为 subject-facing observation。
- simulator leader、subject simulator、entity simulator、writer、retrieval 分别能读取哪些正文分区。
- GraphRAG 如何表示 `who knows what`、`who holds what`、`what is where` 等边。
- subject context-load sidecar 如何把上帝视角设定过滤成 subject-facing 上下文。

当前版本只保留一个原则：目录先分层，`lorebook/` 放 canonical / prototype，`simulation/subjects/` 放 information subject，`simulation/entities/` 放 stateful instance，`simulation/runs/` 放 run artifacts。在 schema 定稿前，不要求作者写固定信息控制字段。

## SillyTavern Worldbook Mapping

| Source Pattern | Target Type / Directory | Notes |
| --- | --- | --- |
| `世界主设定`、地理总览、历史年表、生命层级 | `world` | 生命层级可用 `subtype: power-scale`。 |
| `种族-*`、种族概览、血脉、智慧生物 | `species` 或 `world` | 默认模板可放 `world/species/`；种族高频项目可提升为 `species/`。 |
| 帝国、王国、联盟、阵营、势力概览 | `faction` | 国家和大势力进入 `faction/`。 |
| 公会、学院部门、行会、商会、家族、教会 | `organization` 或 `faction` | 默认模板可放 `faction/organization/`；组织高频项目可提升为 `organization/`。 |
| 城市、村镇、学院区、酒馆、公会建筑、遗迹 | `location` | 具体空间优先 `location`。 |
| `DLC-角色-*`、角色卡、NPC | `lorebook/character` + optional `simulation/subjects` | 上帝视角设定进 `lorebook/character`；需要模拟或信息控制的角色再建 subject。 |
| `DLC-事件-*`、战争、历史事故、仪式 | `event` 或 entity | 已成为背景事实的事件进 `event`；正在推进、有进度的事件进 `simulation/entities/`。 |
| 炼金、状态规则、角色生成、命定系统 | `system` | 与创作规则分开。 |
| 世界规则、生命层级、魔法法则 | `world` | 放入 `world/rule/`，使用更具体 subtype。 |
| 写作格式、创作边界、输出要求 | `instruction` | 可作为 AI 说明书，但必须和世界事实区分。 |
| 生物、魔物、植物、生态对象 | `creature` 或 `world` | 默认模板可放 `world/ecology/`；生态高频项目可提升为 `creature/`。 |
| 角色视角已知信息、当前心态、当前状态 | `simulation/subjects/` | 不写入 lorebook canon。 |
| 物品、地点、机关、事件进程的当前状态 | `simulation/entities/` | 不写入 lorebook canon。 |
| 简介、故事概念、项目定位、开局种子 | 非 lorebook 默认条目 | 短简介进 `project.yaml.summary`；长概念进 planning / `PROJECT-STATUS.md`；稳定事实拆入具体 lorebook。 |
| DLC 开始/结束 marker、目录分隔条目 | 忽略或 reference | 通常不应成为稳定设定。 |
| `InitVar`、`mvu_update`、变量补丁、EJS、`@INJECT` | `reference/` | 不进入稳定 lorebook；后续由 simulation mechanics / prompt migration 处理。 |

## Migration Notes

旧内容和导入结果仍可能使用 `rule`、`note`、旧 `roleplay/` 目录或把动态脚本混入 lorebook。迁移时应逐步收敛：

- `rule`：世界规则迁到 `world/rule/` 且 `type: world`；机制规则迁到 `system`；作品级 AI 指令迁到 `instruction`。
- `note`：低置信和未整理资料迁到 `reference/` 或待 review 区。
- `dynamic-mvu` / `dynamic-prompt`：保留到 `reference/`，等待 simulation mechanics / prompt migration 任务。
- `lorebook/**/state.md`：当前仍按 `reference/content/state.md` 兼容；不要新增 subject 主观状态或 entity 当前状态；后续逐步把 lorebook 下的动态状态迁到 `simulation/subjects/` 或 `simulation/entities/`。
- `roleplay/gm.md`：旧文件应迁移到 `simulation/simulator.md`。
- `roleplay/actors/{actor-id}/`：旧文件应迁移到 `simulation/subjects/{subject-id}/`，由 `simulation/cast.yaml` 引用。
- `roleplay/playthrough/`：旧文件应迁移到 `simulation/runs/`。
- `roleplay/`：不再作为新模板或新协议目录；目标能力目录是 `simulation/`。
