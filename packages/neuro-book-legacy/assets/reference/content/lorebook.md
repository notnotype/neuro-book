# Lorebook Directory

`lorebook/` is the mostly stateless, omniscient canon layer. It stores stable facts, prototypes, rules and reusable AI instructions.

## Default Shape

```text
lorebook/
|-- index.md
|-- world/
|-- character/
|-- location/
|-- faction/
|-- item/
|-- event/
|-- system/
|-- note/
`-- instruction/
```

Use `lorebook/index.md` to explain project-specific directory conventions when the project customizes the default structure.

## Default Types

| Directory | Meaning |
| --- | --- |
| `world/` | World structure, laws, eras, history and large-scale rules. |
| `character/` | Omniscient character canon, background, secrets and author notes. |
| `location/` | Places organized by actual spatial hierarchy. |
| `faction/` | Important factions, political bodies and conflict groups. |
| `item/` | Artifacts, equipment, documents, consumables and materials. |
| `event/` | Historical events that already happened in canon. |
| `system/` | Game-like systems, procedures, mechanics and rule modules. |
| `note/` | Initialization material, low-confidence facts, temporary lore notes and material waiting to be promoted. |
| `instruction/` | Reusable AI instructions for this project, such as style, boundaries, retrieval and disclosure rules. |

Supported but not default top-level directories include `species/`, `organization/`, `creature/`, `plant/`, `technology/`, `culture/`, `religion`, `magic`, `profession` and similar project-specific high-frequency categories.

## Type Guidelines

| Type | Use For |
| --- | --- |
| `world` | 世界结构、历史、地理、文化、生态、世界内规则。 |
| `character` | 上帝视角角色设定、背景、秘密、作者备注。 |
| `location` | 空间层级，按真实地点从大到小嵌套。 |
| `faction` | 国家、阵营、政治实体、冲突集团。 |
| `item` | 物品原型、装备、道具、文档、材料、设备、消耗品。 |
| `event` | 已发生的历史事件、背景事件、战争和事故。 |
| `system` | 可运行/可模拟机制、玩法模块、状态规则。 |
| `note` | 初始化素材、低置信设定、待整理说明和临时世界书笔记。 |
| `instruction` | 作品级 AI 使用说明，例如风格、边界、检索、披露、continuity。 |
| `species` | 文明、血统、可成为角色身份的种族类型。 |
| `creature` | 魔物、动物、植物和生态对象。 |
| `organization` | 公会、学院部门、商会、家族、教会等组织。 |

`rule` is not a standalone compatibility directory. Put world rules under `world/rule/`, mechanism rules under `system/`, and AI-facing rules under `instruction/`.

## Import Notes

When importing SillyTavern worldbooks, treat author `comment` naming patterns as strong classification hints, but keep the output conservative:

- Stable entries may become `lorebook/` nodes.
- `species` is supported and may be promoted to a top-level `lorebook/species/` directory when the project has a significant race / bloodline taxonomy.
- Dynamic MVU, EJS, prompt-template, variable-update or UI-runtime entries do not become stable lorebook canon; archive them under `reference/silly-tavern/{slug}/dynamic-worldbook/`.
- Card body materials such as `first_mes`, `alternate_greetings`, `mes_example`, `scenario` and `description` belong under `reference/silly-tavern/{slug}/card-body/`, not `lorebook/event/`.
- Structure-only worldbook separators remain in raw reference and reports only.

## Location

Locations should use actual spatial hierarchy:

```text
宇宙 -> 星球 -> 大陆 -> 国家 -> 省/领 -> 城市 -> 建筑 -> 房间/区域
```

Projects do not need to fill every level. Campus, city or locked-room stories can start directly from city, academy or building nodes.

## Item

Default item subtypes:

| Subtype | Use For |
| --- | --- |
| `prop` | 普通道具和剧情道具。 |
| `equipment` | 武器、防具、服装、饰品等长期装备。 |
| `consumable` | 药剂、食物、弹药、一次性符咒。 |
| `material` | 矿石、草药、怪物素材、布料。 |
| `document` | 书籍、信件、契约、证件、档案。 |
| `device` | 电器、魔导器械、终端、功能设备。 |
| `vehicle` | 交通工具、坐骑、飞船、机甲。 |
| `currency` | 货币、票据、点数、信用芯片。 |
| `artifact` | 独特遗物、神器、唯一或准唯一物品。 |

More specific real-world classifications should use directory hierarchy, `subtype`, tags and refs.

## Boundary

Use lorebook for:

- World facts and rules.
- Character canon and background.
- Locations, factions, items, events and systems.
- Reusable project instructions, such as style boundaries or disclosure rules.
- Initialization notes and low-confidence material that have not yet been promoted into stable canon.

Do not use lorebook for:

- Temporary plot plans.
- Subject private knowledge, current mind state or inventory snapshots.
- Entity holder, hidden activation state, damage or progress.
- Raw imported cards, scripts or low-confidence migration notes.
- Temporary run logs.

Runtime state belongs in `simulation/subjects/` and `simulation/entities/`. Plot planning belongs in the Plot System.
