# Round 363 - Real Author Flow Browser Acceptance Plan

## 背景

Round 357-362 已经把主体文件建议 P0 链路补到可发现：

- 保存 slice 后提示右侧 Inspector 有主体文件建议。
- Inspector 顶栏显示 `N proposals`。
- Inspector 隐藏时，顶栏按钮和右侧恢复 rail 显示建议数量。
- 保存后 proposal context 与 `focusedSubjectId` 对齐，避免提示有建议但右栏落回 `world`。
- Timeline slice card 显示 `files N`，方便回看历史切片。
- 相关前端契约测试通过；全量 typecheck 仍被无关 `server/agent/tools/control-tools.test.ts` 阻塞。

Round 365-369 又把 proposal 入口从“可发现”推进到“可直达”：

- `files N` 已从只读徽标变成可点击入口。
- 点击 `files N` 会选中 slice、打开 Inspector，并滚到 `Subject file proposals`。
- Inspector 隐藏时，顶栏 Inspector 按钮和右侧恢复 rail 也会在有 proposal 时直达建议区。
- mock preview 与真实 Workbench 的 proposal 数量徽标、恢复 rail 行为保持一致。
- 主体文件建议复制失败时会提示 `复制失败，请手动选择文本后复制。`

下一步不该继续静态抠 UI 边界，而该做真实作者流浏览器验收。但项目规则要求不要自动进行浏览器验证，所以本轮先固化验收清单，等待用户明确允许后执行。

## 验收目标

以 `ming-ding-zhi-shi-2 / 命定之诗2` 为代表，验证作者能从真实 Project 进入 World Engine Workbench，设置 / 使用 subject schema，推演几步 slice，并覆盖常用操作。

## 浏览器验收清单

### 1. 打开真实 Project

- 从主 IDE 打开 `?project=workspace/ming-ding-zhi-shi-2`。
- 打开 World Engine Workbench。
- 确认左栏显示 `world-engine/schema.yaml` 与 `world-engine/calendar.yaml`。
- 确认左栏显示来自 `simulation/subjects` 的真实主体摘要，而不是只显示 World Engine SQLite subject。
- 当前 `ming-ding-zhi-shi-2` 已注册 6 个真实主体；`sample-npc` 是 Workbench 显式忽略的示例主体，不应作为待接入主体显示。
- 若其它 Project 或后续测试准备了真实待接入主体，确认同步入口文案说明：只注册 World Engine subject 身份，不复制或改写六文件正文。

### 2. 设置 / 使用 subject schema

- 从左栏打开 `world-engine/schema.yaml`。
- 确认回到 Workbench 后 schema 已加载，Slice Composer 的默认 mutation 会按当前 subject schema 选择合理 attr。
- 对 `ming-ding-zhi-shi-2` 角色没有 `events` attr 的情况，确认新建角色事件时默认能回退到 `world.events`，而不是误写 `hp` 等不合适字段。
- 注意当前 `calendar.yaml` 使用数字月格式，而 `player/events.jsonl` 历史行中仍有 `风信之月` 旧月名；验收时观察新 proposal 的时间文本与旧六文件历史事件并存时是否清晰。

### 3. 同步主体系统（条件项）

- 当前 `ming-ding-zhi-shi-2` 没有可用待接入主体，默认跳过本节。
- 不得使用 `sample-npc` 作为本节测试对象；它是被 Workbench 显式忽略的示例主体。
- 若要覆盖本节，需要先准备一个真实未注册 subject 目录，或改用存在 pending subject 的 Project。
- 存在待接入主体时，对该主体执行 `同步主体系统`。
- 确认同步后主体从“待接入”进入已注册 World Engine subject 列表。
- 确认同步不会修改 `simulation/subjects/*/subject.md / events.jsonl / memory.jsonl / state.md` 正文。
- 如果初始化时间冲突，确认错误文案能引导作者修改初始化时间或显式合并 slice。

### 4. 推演多步 slice

- 选择一个真实角色主体，例如 `player`。
- 新建第一条 slice，写入角色语境事件；若 mutation 落到 `world.events`，保存后仍应保留角色语境。
- 使用 `写入并继续下一步` 连续写第二条 / 第三条 slice。
- 确认每次保存后：
  - Timeline 刷新并定位到新 slice。
  - 保存提示能显示主体文件建议数量。
  - 右侧 Inspector 顶栏显示 `N proposals`。
  - 如果 Inspector 隐藏，顶栏 Inspector 按钮与右侧恢复 rail 也显示数量；点击后应展开右栏并滚到 `Subject file proposals`。
  - Slice card 显示 `files N`；点击后应选中该 slice、打开右侧 Inspector 并滚到 `Subject file proposals`。

### 5. 主体文件建议 P0 手动落地

- 选中刚写入的 slice。
- 在 Inspector 的 `Subject file proposals` 区域确认：
  - `events.jsonl draft` 使用第一人称主体经历草稿。
  - `memory.jsonl` 候选只在相关 memory / relationship mutation 存在时出现。
  - `state.md review` 指向 `当前位置 / 资源 / 持有物品 / 身体与姿态 / 关系压力 / 短期目标` 等区块。
  - source label 能区分 `直接触及该主体` 与 `当前主体语境下的 world 事件建议`。
- 测试复制：
  - 复制单个 subject proposal。
  - 复制全部 proposal。
  - 单独复制 `events.jsonl` 行。
  - 单独复制 `memory.jsonl` 候选行。
  - 单独复制 `state.md` 审查提示。
  - 若浏览器剪贴板写入失败，确认出现 `复制失败，请手动选择文本后复制。`，而不是静默无反馈。
- 测试打开目标文件：
  - 打开 `events.jsonl`。
  - 打开 `memory.jsonl`。
  - 打开 `state.md`。
- 确认打开文件前若 Workbench 有会话草稿，会先询问是否放弃。

### 6. 回看历史 slice

- 连续写入多步后，回到 timeline 较早 slice。
- 确认历史 slice card 上的 `files N` 能提示是否存在主体文件建议。
- 点击历史 slice card 的 `files N`，确认会直达该历史 slice 的 `Subject file proposals`，而不是只选中卡片或打开 Inspector 顶部。
- 选中历史 slice 后，Inspector 内容、proposal 数量和 slice card 徽标保持一致。
- 确认 `focusedSubjectId` 不会因为 `world.events` slice 回落到 `world` 而导致 proposal 消失。

### 7. 常用操作覆盖

- 编辑已有 slice 的 metadata。
- 编辑已有 slice 的 mutation value。
- 删除当前 slice，并确认删除返回 issues 不会错挂到刷新后的当前 slice。
- 查询当前 slice 触及主体状态。
- 展开完整世界状态。
- 切换单 subject / 多 subject timeline 过滤。
- 清空过滤并回到整体世界。
- 关闭 Slice Composer / Workbench 时确认未保存草稿保护生效。

## 通过标准

- 作者能从真实 Project 进入 Workbench，连续写入多步 slice、回看历史 slice、查看和复制主体文件建议；若验收环境存在真实待接入主体，还应完成主体同步。
- P0 主体文件建议只作为人工处理建议，不自动写 `simulation/subjects`。
- `world.events` 角色语境不会导致“提示有建议但 Inspector 看不到建议”。
- 常用读写 / 删除 / 查询操作不会让 timeline、Inspector、Review Queue 或主体文件建议状态错位。

## 本轮结果

本轮只新增验收计划文档，没有修改代码行为，没有运行测试或浏览器验收。

Round 370 已刷新本清单，使它覆盖 round 365-369 的 proposal 直达和复制失败反馈；仍未执行浏览器验收。

Round 371 已做只读真实 Project 预检：`ming-ding-zhi-shi-2` 的 schema、calendar、`simulation/subjects/player` 六文件均存在且与主体文件建议格式基本吻合；验收时需额外观察 legacy 月名与当前数字月格式并存的问题。

Round 372-374 已修正待接入主体前置条件：当前 `ming-ding-zhi-shi-2` 没有可用 pending subject，`sample-npc` 会被 Workbench 显式忽略，不能作为同步主体系统验收点；同步主体系统现在是有前置条件的条件项。

等待用户明确允许后，可按本清单执行浏览器验收并记录实际结果。
