# t37 实施计划：对话状态栏的自定义

## Context

[t29](../t29-ui-polish-after-t15/README.md) 评审板定下、2026-11-16 拆出来的状态栏自定义（决定原文见本 Task README 与 t29 的决定 2、4、5；静态稿在 `.worktree/w00032-t29-drafts` 的 Lab 场景 `StatusLineDraft`，评审板第 1 轮已定稿）。要做的：

1. 右键状态栏弹勾选菜单改显隐，最后一项“状态栏设置…”。
2. 设置里新分区“状态栏”：预览，左边、右边两组，每项一个勾选，拖动或上移下移排序；全局一份，存用户设置。
3. 可选项：上下文用量、用量与缓存命中（累计、输入、输出、缓存命中合成一项）、费用、模型与推理档，以及插件经贡献点加的项（标“插件”）。缺省与现在一样。缓存倒计时不做（开发者 2026-11-17 定，评审板 `review` v1 的 `cache-ttl`）：有人要的话自己写成插件的项，插件拿到的 `ctx` 里有最近回复的时间、模型与缓存读写量，够算。
4. 提醒类总显示、不能关：运行阶段与用时、等你处理、等重发、费用超过告警线、“全部放行”警告、非默认模式标记、断线。
5. 右栏窄时右边按顺序从前往后收进悬停，费用最后收。
6. 不做配命令；5 小时与 7 天限额不做。

依据：[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 15 到 18、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“状态栏”、[`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md)、[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md)。

工作方式：代码在新 worktree（分支 `feat/w00032-t37-status-line`）；Spec 与 Task 记录在主工作区 master；每片一个提交、片内跑所改包的全量测试加类型检查（t36 的教训）。

## 技术选型

| 问题 | 选 | 理由 |
|---|---|---|
| 拖动排序 | 原生 HTML5 拖放加上移、下移按钮 | 仓库里没有现成的排序列表（`nb-ui`、`nb-form`、`nb-layout` 的拖动都是别的用途）；两项最多十来行，不为它引库。按钮同时是键盘与触屏的路径 |
| 右栏窄时收项 | `ResizeObserver` 量宽度，记每项自然宽度，从前往后把放不下的收进悬停 | CSS 容器查询只能按固定宽度阈值切，项数与每项宽度随设置变，阈值写不死；`nb-layout` 已有同类的 `useLayoutExtent`，沿用它的做法 |
| 设置存储 | 一个用户层设置项，形状见下，不拆成每项一个 | 要存顺序；分开存会有“顺序在哪个项里”的问题 |
| 右键菜单 | `nb-ui` 的 `ContextMenu` | 草稿用的就是它 |
| 插件的项 | 新贡献点 `agent.statusItems` | 与别的 `agent.*` 贡献点同写法（`implementation: "required"`，只接受浏览器入口） |

## 关键设计

### nb-agent-ui：状态栏的目录与解算（`src/status-line.ts`，纯 TS）

- **目录项**：`{id, side: "left" | "right", title: Text, description?: Text, defaultVisible: boolean, source?: string}`。内置四项由本文件登记：`context`（左，缺省开）、`usage`（右，开）、`cost`（右，开）、`model`（右，关）。插件的项来自注册表的 `statusItems`（登记项加 `side`、`title`、`description?`、`defaultVisible?`；原来只有 `component`，现有的 `statusItems` 用法（编辑器状态栏条目走的是工作台自己的，不是它）无外部使用方，直接加字段）。
- **设置形状** `StatusLineSetting = {order?: string[]; visible?: Record<string, boolean>}`：`order` 是用户排过的 id 次序（可以不全），`visible` 是用户改过的显隐；两者都只记改过的。
- **解算** `resolveStatusLine(catalog, setting) → {left: Item[]; right: Item[]; all: Item[]}`：每一侧里先按 `order` 里的先后，没出现在 `order` 里的按目录顺序排在后面；显隐取 `visible[id] ?? defaultVisible`；目录里没有的 id 忽略（插件被禁用后设置里还留着，回来时照样生效）。`all` 是设置页与右键菜单要的完整清单（含隐藏的）。
- 不变量：缺省设置（空对象）解出的就是现在的状态栏；提醒类不在目录里。

### nb-agent-ui：状态栏组件（`AgentStatusBar.vue`）

- 新属性 `statusLine?: {left: string[]; right: string[]}`（解算后的可见 id 序列，由宿主给；不给时用缺省，包内其它使用方 nb-story 不受影响）。
- 内置的四项各拆成小组件放进 `src/vue/composer/status/`：`StatusContext`（原圆环）、`StatusUsage`（累计、输入、输出、缓存命中，明细在悬停）、`StatusCost`、`StatusModel`（`ctx.composer.effectiveModel` 加推理档，一行文字）。
- 提醒类仍在左边固定位置，不受设置影响；插件的项按目录里的 `side` 与次序画。
- **窄时收项**：右侧项按序渲染；`ResizeObserver` 量状态栏可用宽度，从第一项起把放不下的标成收起（不画），悬停那一块（现在用量的悬停）列出所有被收起项的文字；费用最后收。每项的自然宽度量到后记着，收起后宽度变大时能判断放不放得下。
- 右键：状态栏根监听 `contextmenu`，视图自己用 `ContextMenu` 画勾选项（列目录里全部项，插件的项标“插件”），点一项发出 `statusLine.toggle {id}`，最后“状态栏设置…”发出 `statusLine.openSettings`；这两个是 `ViewAction`，宿主处理。视图的属性 `statusLine` 不给时不弹菜单。

### nbook.agent：贡献点、设置、设置页与宿主

- **`agent.statusItems`**（`shared/points.ts`）：声明 `{title: Text, description?: Text, side, defaultVisible?}`，实现 `{load(): Promise<Component>}`，组件属性 `{ctx}`；id 前缀同别的点；只接受浏览器入口。SDK 子路径 `/agent` 加助手 `agentStatusItem`。
- **设置项** `nbook.agent/statusLine`（`shared/settings.ts`，用户层）：`StatusLineSetting` 的 schema，`additionalProperties: false`，`order` 至多 64 项、id 非空；不在“其它”里列：由下面的页面画。
- **设置页**“状态栏”（`web/components/StatusLinePage.vue`，page 分区 `nbook.agent.statusLine`，`ai` 组，`order` 35，`layers: ["user"]`）：顶上预览（用样本数据画一条真实的状态栏，随设置变）；“左边”“右边”两组，每行一个勾选加说明、插件的项标“插件”、拖动柄与上移下移；写入走设置服务（改一项写一次，整份 `statusLine` 写回，改回缺省时删键）。预览里的样本、顺序与窄宽收起都用 nb-agent-ui 导出的解算与组件，不再写一份。
- **宿主**（`session-host.ts`、`plugin.ts`、`ConversationHost.vue`）：读设置与贡献点（浏览器入口加 `receives: [STATUS_ITEMS_POINT]`），算 `statusLine` 给视图；处理三个动作：`toggle` 写设置、`openSettings` 经 `nbook.settings.open` 打开分区 `nbook.agent.statusLine`、菜单的勾选状态来自同一份解算。设置写失败走现有通知。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `agent/conversation.md` | 输出 15 改为“右边按设置显示，缺省同现在”，新输出：状态栏的可选项与设置、右键菜单、窄时收项（均标 planned） |
| `ui/agent-conversation-view.md` | “状态栏”一节：目录项、`statusLine` 属性、三个动作、窄时收项、右键菜单 |
| `agent/contributions.md` | 新贡献点 `agent.statusItems`（形状、id、只接受浏览器入口） |
| `settings` 相关 | 新页面“状态栏”写进 `agent/conversation.md`（设置的形状在那里），不另开 Spec |

组件 `.md`：新增 `StatusLinePage.md` 与 `status/` 下五个小组件各一份（或合并成一份 `status/README`，按仓库规则逐个组件各一份），改 `AgentStatusBar.md`。

## 切片

1. **目录与解算**：`status-line.ts`、注册表 `StatusItemEntry` 加字段；纯函数测试（缺省等于现在、顺序、显隐、未知 id、插件项）。
2. **状态栏组件**：五个内置项拆出、`statusLine` 属性、窄时收项、右键菜单与三个动作；DOM 测试；Lab 场景（缺省、只留上下文与费用、开模型加一个插件项、窄宽 390、没选会话）；`AgentStatusBar.md` 更新。
3. **设置、贡献点与宿主**：设置项、`agent.statusItems`、宿主算 `statusLine` 与处理动作；`session-host.test.ts`（真实设置写入、动作处理）、贡献点的合同测试。
4. **设置页**：`StatusLinePage.vue`、预览、拖动与上移下移；DOM 测试；Lab 场景；e2e：右键勾选一项状态栏即变、设置里排序后顺序变、刷新还在。
5. **收口**：Spec、前端实现审查（Sonnet）、合入。

每片 e2e：`agent-conversation.e2e.ts`（含右键与设置的新用例）、`settings.e2e.ts`、`lab-agent-ui.e2e.ts`、`lab-scenes.e2e.ts`（临时滤掉 ThemeEditor 的 404，同 t36）。

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 缺省设置解出的状态栏与现在一样 | 纯函数测试；DOM 测试比对缺省的内容 |
| 右键勾选改显隐，菜单最后有“状态栏设置…” | DOM 测试；e2e |
| 设置里排序、勾选，全局一份，刷新还在 | 页面 DOM 测试；e2e |
| 提醒类关不掉 | DOM 测试：所有项都关时运行阶段、等你处理、断线、全部放行仍在 |
| 窄时从前往后收进悬停，费用最后收 | DOM 测试（给定宽度）；Lab 窄宽场景 |
| 插件的项出现在目录里、标“插件”，禁用插件后设置保留 | 贡献点合同测试；解算的纯函数测试 |

## 验证

- 每片：所改包的类型检查与全量单元和 DOM 测试，加覆盖它的 e2e；Lab 场景登记齐（t36 漏过，`index.dom.test.ts` 会拦）。
- 收口：`bun run typecheck`、`test:affected --since master`、上面列的 e2e 去重一次跑完。
- 未验证的边界：窄时收项在真实字体与不同语言下的抖动，靠 Lab 与 e2e 各看一次。

## 不做与风险

- 不做：缓存倒计时（见上，用户可自己写插件项）、配命令（开发者 2026-11-17 问过能否让用户自己写代码，见 README 的决定 3，是否另加一条“用户脚本”路径待定）、5 小时与 7 天限额、每个会话单独一份设置、提醒类的显隐、状态栏项在左右之间移动（每项的侧由目录定）。
- 风险：窄时收项靠量宽度，量的时机（字体加载、项内容变化）会让收起的数量抖一下，用“只在宽度或项集合变化时重算，量宽度用 `ResizeObserver` 的回调”压住，Lab 与 e2e 各看一次。
