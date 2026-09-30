---
schema: nbook.task/v2
taskId: t04-visual-shell
---

# 共享外壳的视觉方案

## 目标

实现切片 S2：做出消息流共用的视觉零件（卡片、步骤行、摘要行、文件 chip），在 Lab 里并排给出 2 到 3 套视觉方案，由开发者选定一套后再推广到后续切片。

## 合同

[ui.agent-conversation-view](../../../../../docs/specs/ui/agent-conversation-view.md)（planned）中的“分轮视图”“消息”与“边界与兼容”的视觉要求。视觉取值是提案里的待决问题，本 Task 只给出候选，不改 Spec 的行为条款。

## 范围

- 在 `app/components/agent/` 新增纯零件 `AgentCard`、`AgentStepLine`、`AgentTurnSummary`（第六轮改名 `AgentChainSummary`）、`AgentFileChip`（第五轮换成 `AgentFileChanges`），各带同名 `.md` 与 Lab 场景。
- `AgentConversationView` 改用这些零件；`interact` 与 `other` 类工具以通用卡片呈现。
- 视觉取值集中为组件内的 CSS 变量；候选方案以 Lab 专用样式覆盖这些变量，开发者选定后把选中的取值收回组件，删除 Lab 专用样式。

## 非目标

- 消息流的滚动、锚点、历史分页（S3），工具的详细内容组件（S5），输入框（S6）。

## 当前状态（2026-09-30）：开发者确认 S2 视觉，已完成收尾审查

对比过程：
- 第一轮给了 A 线性、B 分层、C 稿面三套。开发者认为 A 没有亮点且左边缘没对齐；B 方向对，但回复正文也要装进容器；C 不符合整体风格。
- 第二轮沿 B 做了 B1 一体卡、B2 卡内嵌面、B3 分组堆叠。开发者选定 B1，并要求改得更好看。

第三轮调整，按开发者的反馈与 ui-development skill 自检：
- 折叠后的过程压到最多两行：
  - 过程摘要并入卡片头部一行（头像、名称、状态、“› 12 步 · 读 7 · 改 2 · 1:00”，完整说法在悬停提示）；
  - 改动文件单独一行，最多 3 个 chip，其余收成“+N”；
  - 以错误结束的轮次把错误放在正文位置。
- 右上角加回消息操作，参考旧 AgentSidebarView：分支切换、复制、编辑、重新生成、从此处分支。操作走注册表的“消息操作”扩展点（`builtin-message-actions.ts`），以浮层表面浮在卡片与用户气泡的右上沿，悬停或键盘聚焦时出现，不占布局。
- tokens 与费用移到卡片右下角（参考旧设计），悬停显示输入、输出、缓存读写明细；`TurnMetrics` 新增 `usage` 明细。
- 视图超过 800 行审查线，按稳定边界拆出 `AgentConversationTurn`（一轮的整理、折叠、步骤展开与操作）；视图只按轮次边界切分消息。分轮逻辑相应导出 `splitIntoTurnGroups` 与 `buildTurn`。
- 新零件 `AgentMessageActions`、`AgentConversationTurn`，各有同名 `.md` 与 Lab 场景。
- skill 自检后的修正：
  - 分隔线与卡片描边改用 `--divider`；
  - 消息流声明 `scrollbar-gutter: stable`；
  - 控件圆角改用 `--radius-control`，不再用 `rounded-md`；
  - 主触发区与操作按钮是兄弟节点，没有嵌套按钮；
  - 没有字面颜色、`transition: all`、斜体或写死的缓动。

第四轮：开发者认为 B1 卡片仍不如旧 `AgentSidebarView`，要求直接沿用旧侧栏的对话气泡版式，再把分轮折叠等新能力融进去。
- 版式照旧侧栏：每条消息上面一行角色行（16px 头像、大写 “YOU”/“ASSISTANT”、模型徽标、时间、状态徽标，右端常显操作条），下面缩进 24px 的圆角气泡；用户气泡带淡强调色。旧文件只作参考，没有 import。
- 融入的新能力：
  - 过程行放在助手角色行下面（旧侧栏思维链的位置）：“› 12 步 · 读 7 · 改 2 · 1:00”，折叠时同一行跟最多 2 个改动文件 chip 和“+N”。所以折叠后助手一侧只有角色行加过程行两行，再下面是回复气泡。
  - 展开的步骤挂在从摘要箭头垂下的竖线上；工具组、卡片、steer、系统提醒沿用第三轮。
  - 用量行照旧侧栏放在气泡右下：tokens、输入、输出、缓存读取、费用，悬停显示明细。
  - 以错误结束且折叠时，错误说明放进危险色气泡。
  - 操作条改为常显、颜色弱，触屏不再需要额外手势，原“触屏点击显示操作”的已知偏差随之消除；分支切换改为描边小框“‹ ⑂ 2/2 ›”。
- 去掉第三轮的卡片外框和顶边进度细线，运行中改由角色行的转圈与状态徽标表示。
- 开发者同时要求把 `.vue` 硬审查线从 800 行放宽到 1200 行，已改 `docs/standards/code/frontend.md`。

第五轮：开发者认可第四轮的版式，提出四处修改。
- 改动文件单独一个气泡：新零件 `AgentFileChanges`（替换并删除 `AgentFileChip`），每个文件一行，显示文件名、目录与增删，超过 5 个可展开其余；折叠与展开时都显示，排在回复气泡上面。过程行只留摘要。
- 工具之间的说明文字按 Markdown 渲染，装进浅底小气泡、用正文色，和淡色工具行拉开层级；思考全文也改为 Markdown。`AgentMarkdown` 新增 `--acv-markdown-color`、`--acv-markdown-size` 两个外观变量。
- 任务清单、Workflow、提问、切换模式不随折叠隐藏：工具渲染器新增 `pinned`，`ConversationTurn` 新增 `pinned` 列表，折叠态在摘要下显示这些卡片；固定显示的 Workflow 不再重复成关键结果。
- 系统提醒直接显示：不再并入探查组、不再只显示计数；`reminderCount` 与“N 条系统提醒”文案删除。
- Spec 的分轮视图、关键结果定义、渲染器登记表与验收 1、2 同步改写（同时补记第三、四轮定下的用量位置与操作条常显）。

第六轮：开发者否定了“固定显示的卡片”，重新理了需求（已写入 Spec 与跨会话记忆）：
- 准则：Message[] 对用户透明（界面能反推消息序列），但注意力集中在主要信息上。
- 由此把一轮分成三层，取代“整轮折叠”：
  - 常显层：用户消息；Agent 说出的 content（运行中中间 content 用轻气泡常显，结束后并入思维链，只留最终回复）；人机交互控件（渲染器新增 `presentation: "node"`，内置为提问、切换模式、任务清单、Workflow）；信息条目（系统提醒、自定义消息，淡色一行）；分隔线；steer；错误。
  - 思维链：两个常显条目之间的思考、普通工具调用、系统提示词与并入的中间 content，默认折叠为一行摘要（`AgentChainSummary`，由 `AgentTurnSummary` 改名），运行中显示当前执行的一步；展开后两条消息之间有边界。
  - 轮末汇总：改动文件气泡与用量行（新增用时）。
- 分轮模型 `conversation-turns.ts` 改为输出 `blocks`（chain、content、node、notice、divider、steer、error）与 `trailing`；去掉 `keyResults`、`pinned`、`defaultTurnExpanded` 与渲染器的 `keyResult`、`pinned`。
- 任务清单每次调用都显示：新增 `task-list.ts`（解析结果 `details`、找上一版、比对变化，带单测）、纯零件 `AgentTaskList`、登记在渲染器上的 `AgentTaskListNode`。“当前清单”面板独立于本视图，Spec 记为非目标、另行规划。
- 注册表新增“角色”扩展点与 `builtin-roles.ts`，为第三种角色预留。

第七轮：开发者举例说明翻看历史时只关心“最后一条 content + diff 卡片”，任务清单、思维链、系统提醒都不是第一关注对象；另外 diff 卡片注意力太多。
- 模型：`ConversationTurn` 新增 `outcomeStart`（末尾连续的最终回复与错误是“结果”，其余是“过程”）与 `foldable`（已结束且有过程）；`TurnMetrics` 新增 `failed`；恢复 `defaultTurnExpanded`（最新一轮出错或被停止时展开，其余收起）。
- 模型输出改为纯数据：`ToolStep` 不再带渲染器，视图按工具名向注册表查。这样 `ConversationTurn` 可完整 JSON 化，单个块也能在 Lab 里用 JSON 场景驱动。
- 视图：已结束的轮次把过程收成一行“过程 · 14 步 · 读 7 · 改 2”，下面只有结果、改动文件与用量；展开后过程挂在竖线上、缩进一级。单个块的渲染拆成新组件 `AgentTurnBlock`（含 9 个 Lab 场景），`AgentConversationTurn` 只管角色行、整轮收起与轮末汇总。
- diff 卡片（`AgentFileChanges`）改为低调样式：只有细分隔线描边，没有底色和阴影，标题 11px、文件名用次级色，行高 22px。

第八轮：开发者认为 diff 卡片占的空间和注意力仍然偏大，宽屏下尤其浪费。
- `AgentFileChanges` 从整行宽的列表卡片改为一行文件小标签（宽度随内容、放不下时换行，同名文件带上级目录，超过 5 个收成“+N”），并和用量合成轮末一行：文件靠左、用量靠右，放不下时用量折到下一行。
- 消息操作图标在有悬停能力的设备上只在指向或聚焦该条消息时出现，触屏常显；分支切换始终可见（通过 `--agent-message-actions-opacity` 变量控制）。
- 面板拉宽时每轮限宽 800px 居中。

第九轮：开发者要求系统提醒能点开看。
- 信息条目（系统提醒、自定义消息）整行改为按钮，点开在下方显示 Markdown 全文；思维链里的系统提示词、带摘要的上下文压缩与分支摘要分隔线也能点开。思考与系统提示词展开后行内不再重复第一行。
- 轮末的尾随分隔线改由 `AgentTurnBlock` 渲染，与其他块共用同一套展开逻辑。
- Lab 数据补了一条 Skill 系统提示词、多行系统提醒和带摘要的压缩；`AgentTurnBlock` 新增 `divider`、`divider-plain` 两个场景。

第十轮：开发者要求优化思维链摘要行的样式与布局、改友好摘要文案，并指出分支切换常显而右上角按钮悬停才显示，放在一起会留空位。
- `AgentChainSummary`：开头改为种类图标（思考为大脑、工具为扳手、整轮为列表），折叠箭头移到末尾并随展开旋转；宽度随内容、淡色，悬停才有浅底；失败次数以危险色单独附在末尾（新增 `icon`、`alert` 两个 prop）。
- 文案：新增 `process-summary.ts`（`describeChain`、`describeTurn`），把“思考 · 3 步 · 读 2 · 改 1”改为“思考 · 读了 2 个文件，改了 1 个 · 另有 1 次操作”，整轮为“过程 · 14 次操作 · 读了 7 个文件，改了 2 个”。`ChainSummary` 新增 `others`（成功但没读改文件的调用数）。工具组文案同步改为“读了 N 个文件”“搜索了 N 次”等。
- 分支切换移到角色行附加信息之后、靠左常显；右端只剩悬停出现的操作按钮。

第十一轮：开发者改为分支切换仍靠右、操作按钮不悬停也常显；并要求每个工具行都能点开，常用工具做适配，没有适配的展开后看底层参数与结果。
- 撤回悬停显示：`AgentMessageActions` 回到分支切换加操作按钮一组、常显于角色行右端，删除 `--agent-message-actions-opacity`。
- 工具详情：新增 `AgentToolDetail`（按注册表的 `detail` 分派，没有适配时显示原始参数、结果与结构化结果）、`AgentCodeBlock`（行号、增删着色、块内滚动）、`AgentFileContentDetail`（read）、`AgentFileDiffDetail`（edit、write、apply_patch）、`AgentCommandDetail`（bash、execute_sql）；单行、组内项、出错项、卡片与通用控件卡片全部可点开。这提前做了 S5 中“通用、读写改与补丁 diff”的一部分。
- 纯函数：参数读取移到 `tool-args.ts`（含 `parsePatchChanges`，避免 `builtin-tools` 与详情组件循环依赖），行整理在 `tool-detail-lines.ts`，补 5 个单测。
- Lab：新增上述 5 个组件共 17 个场景；样例数据补了真实的文件内容、带 offset 的读取和一个没有适配的工具（`subject_memory_update`）。

收尾审查（2026-09-30，开发者确认 S2 视觉后）：
- 修复：最终回复之后若跟着系统提醒，`outcomeStart` 会等于块数，整轮收起时把最终回复也收进过程。改为 `findOutcomeStart`：末尾的提醒跟随结果显示；补回归测试。
- 修复：工具组内夹带的思考不能点开，与别处不一致；改为可展开看 Markdown 全文。

## 验证

- 三套方案 × 明暗两种配色（NeuroBook 夜深色、昼浅色）× 手机 390 与平板 768 宽，共 12 组截图：都没有横向滚动，也没有页面错误。截图按 t01 的方法复现，不入库。
- 四个零件的 16 个 Lab 场景都能挂载，390 宽下没有横向溢出；第二轮新增 `AgentMarkdown` 及其两个场景。
- 第二轮：B1、B2、B3 × 明暗两种配色 × 390 宽，都没有横向滚动，也没有页面错误。
- 第三轮：`long-conversation`、`running` × 明暗 × 390 宽，都没有横向滚动，也没有页面错误；折叠后头部 34px、文件行 30px。20 个零件场景都能挂载，390 宽下不溢出。
- 第四轮：`long-conversation`（折叠、展开）、`running`（含底部运行中一轮）× 明暗 × 390 宽，都没有横向滚动，也没有页面错误；折叠的过程行在 390 宽下放得下摘要加 2 个文件 chip。
- 第五轮：`long-conversation`（折叠、展开）、`running`（运行中、运行结束）× 明暗 × 390 宽，都没有横向滚动，也没有页面错误；20 个零件场景（含 `AgentFileChanges` 三个）都能挂载，390 宽下不溢出。
- 第六轮：`long-conversation`（默认、展开第一条思维链）、`running`（运行中、运行结束）× 明暗 × 390 宽，都没有横向滚动，也没有页面错误；新零件 `AgentTaskList`、`AgentTaskListNode`、`AgentChainSummary` 的场景都能挂载。
- 第七轮：`long-conversation`（默认收起、展开第二轮）、`running`（运行中、运行结束后自动收起）× 明暗 × 390 宽，都没有横向滚动，也没有页面错误；`AgentTurnBlock` 场景都能挂载。
- 第八轮：`long-conversation`（默认、展开）、`running`（运行中、运行结束）与 `AgentFileChanges` 三个场景 × 随窗口与手机 390 宽，都没有横向溢出，也没有页面错误。Lab 外壳已被他人改动、`data-lab-subject` 不再标在对话视图上，截图改按组件根节点定位。
- 第九轮：`long-conversation` 展开整轮、思维链、全部系统提醒、系统提示词和压缩摘要后，随窗口与手机 390 宽都没有横向溢出、没有页面错误；`AgentTurnBlock` 的 `notice`、`divider`、`divider-plain` 场景可挂载。
- 第十轮：`long-conversation`（默认、展开整轮与两条思维链、底部带分支的一轮）、`AgentConversationTurn` 的 `branch`、`running` × 随窗口与手机 390 宽，都没有横向溢出、没有页面错误；`app/components/agent` 单测 38 个通过（新增 `process-summary.test.ts`）。
- 第十一轮：5 个新组件的场景与 `long-conversation` 展开第三轮两个工具后，随窗口与手机 390 宽都没有横向溢出、没有页面错误或警告；单测与 Lab 登记检查 59 个用例通过。
- `fixtures/index.test.ts`、`component-index.test.ts`、`app/components/agent` 单测：50 个用例全部通过。同目录的 `WorkbenchShellLayoutFixture.test.ts` 有 9 个失败（`Cannot read properties of undefined (reading 'clear')`），与本 Task 改动的文件无关。
- `bun run typecheck`：新增文件没有错误；其余既有错误同 t03。
- `bun run docs:check`：failures 为 0。
