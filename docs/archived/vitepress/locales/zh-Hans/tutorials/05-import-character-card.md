# 导入一张角色卡

::: warning 先说清楚这一节的终点
如果你是冲着"用角色卡开一局 RP"来的：**RP 入口目前不可用**，正在按写作模式的标准重新设计。

这一节能做到的是：把 SillyTavern 角色卡和 worldbook **完整归档并迁入世界书**，作为**小说写作**的素材使用。导入不会启动任何 RP 或模拟流程。
:::

这一节结束后，你会知道如何把 SillyTavern 角色卡变成 NeuroBook 可管理的素材、世界书和 RP 迁移参考。

SillyTavern 卡片通常不只是“一个角色”。它可能包含 worldbook、变量初始化、动态更新规则、提示词模板、regex 脚本和作者说明。NeuroBook 的导入流程会先保留原始材料，再把稳定内容迁入 Project Workspace。

## 准备角色卡文件

先把角色卡文件放到 Agent 能读取的位置。常见输入包括：

- `.json`：已经导出的角色卡 JSON。
- `.raw.json`：从 PNG 中提取出的原始 JSON。
- `.png`：best-effort 读取嵌入 JSON，失败时需要先提取成 `.raw.json`。

如果你不确定文件能不能读，可以先对 Agent 说：

```text
我想导入这张 SillyTavern 角色卡。请先检查文件是否存在、格式是否支持，并告诉我下一步应该 inspect 还是先提取 raw.json。
```

## 三阶段流程

使用 `novel-import-silly-tavern-card` 时，默认按三阶段理解：

1. `inspect`：只查看概览，不生成文件。
2. `unpack`：解包成稳定归档，写入 `reference/silly-tavern/{slug}/`。
3. `import`：从解包目录导入稳定内容到当前 Project Workspace。

你可以先让 Agent 读取 Skill：

```text
请使用“novel-import-silly-tavern-card”帮我导入这张卡。先执行 inspect，给我概览和风险，再问我要不要 unpack。
```

## inspect：先看清卡片

`inspect` 的目标是让你和 Agent 看清这张卡里有什么：

- 角色基本信息。
- worldbook 条目数量和类型。
- 是否包含动态 MVU、提示词模板或脚本。
- 哪些内容适合导入 `lorebook/`。
- 哪些内容只适合归档到 `reference/`。

这一阶段不写文件，适合快速判断卡片质量。

## unpack：保留原始材料

确认要继续后，执行 `unpack`。它会把卡片拆成稳定目录，例如：

```text
reference/silly-tavern/{slug}/
```

这个目录是素材归档，不是正式世界书。它会保存 raw card、overview、worldbook entries、扩展脚本、变量和生成报告。这样后续即使导入策略变化，也能从原始归档重新迁移。

解包后你通常会看到类似结构：

```text
reference/silly-tavern/{slug}/
  raw/
  overview.md
  inspect.json
  worldbook/
  extensions/
  unpack-report.md
  generated.json
```

## import：迁入 Project Workspace

`import` 会读取解包目录，并把稳定文本导入项目。

常见结果包括：

- 角色、地点、势力、物品、世界规则进入 `lorebook/`，其中世界规则会写到 `lorebook/world/rule/`，系统机制会写到 `lorebook/system/`。
- 动态机制、低置信内容和混合职责内容保留在 `reference/silly-tavern/{slug}/`，其中低置信但可复用的稳定条目可能进入 `lorebook/note/` 并标记为 pending。
- 使用 `--rp` 时，额外生成 `simulation-migration/` 作为 legacy RP 迁移候选的归档。普通写作模式不使用这个目录——它只是把和 RP 相关的动态机制归档出来，供以后需要 RP 能力时参考。

注意：`--rp` 不等于立刻启动 RP runtime，也不会自动进入任何模拟流程。

导入后，正式项目里可能新增：

```text
lorebook/character/...
lorebook/location/...
lorebook/faction/...
lorebook/item/...
lorebook/event/...
lorebook/system/...
lorebook/world/rule/...
lorebook/note/...
reference/silly-tavern/{slug}/simulation-migration/
```

## 导入后做一次整理

导入完成后，让 Agent 做一次审查：

```text
请检查刚导入的 lorebook 条目。目标是保留稳定设定，标出动态机制、上帝视角秘密和需要登记进 World Engine 的状态内容。
```

你要特别留意：

- lorebook 是全知设定，不等于角色知道这些信息。
- 角色当前状态不要长期塞进 lorebook，后续应登记为 World Engine subject（角色当前状态 → subject 时间线切面）。
- 有独立状态的关键物品、机关或地点，也应该考虑登记为 World Engine subject。
- 混合职责条目不要强行自动拆成多个节点，先在 report 里保留原因，后续再人工判断。

如果导入结果很多，不要急着一次性登记进 World Engine。先让 Agent 按“可写作 / 需迁移 / 仅归档”三类整理：

```text
请把这次导入结果分成三类：已经可用于写作的 lorebook、需要登记进 World Engine 的动态状态、只保留在 reference 的动态机制。每类列路径和理由。
```

到这里教程路线就走完了。回到上一节的方法，用这些角色继续写作：让确认可用的设定进入 `novel-writing` 循环；如果这批角色之后要接入更完整的世界状态追踪，参考 `novel-setup` 阶段四把它们登记为可追踪的角色。
