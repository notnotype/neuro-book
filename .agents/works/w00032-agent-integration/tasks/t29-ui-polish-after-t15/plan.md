# t29 实施计划：两个设置左栏单行、删除服务商挪到条目上、子代理卡片写工具名

## Context

开发者 2026-11-06 体验后的反馈与 2026-11-16 的六轮评审板（[评审板](artifacts/review/index.html)，决定见 [README](README.md#决定)）。评审板定下的事按交付边界拆成三份：本 Task 做设置页的两个左栏与子代理卡片这三项小改动；对话面板改版另开 [t36](../t36-conversation-panel-redesign/README.md)，状态栏自定义另开 [t37](../t37-status-line-customization/README.md)。

本 Task 做：

1. 服务商列表的条目改单行（决定 5）：名称一行，行尾一格写启用了几个模型；密钥有问题、检测失败时这一格换成图标（钥匙是没有密钥、警示是环境变量没有值或检测失败），悬停写原因。
2. 删除服务商挪到条目上（决定 5）：悬停的条目行尾出删除图标；右键条目弹菜单“删除服务商…”；两条路都打开现在的确认框。标题区的删除按钮去掉。
3. Profile 设置的左栏同样改单行（决定 6）：问题（不可用、有错误）换成行尾图标、悬停写原因；来源不再写在列表里，详情头部的提示里本来就有。
4. 子代理卡片运行中那一行写注册表里的动作名（“读取 第二章.md”），不写工具 id（t29 第 5 条）；“等你批准：…”同样写动作名。

依据：[`models/settings-pages.md`](../../../../../docs/specs/models/settings-pages.md) 输出 1、12，[`agent/profile-settings.md`](../../../../../docs/specs/agent/profile-settings.md) 输出 2，[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 33。

## 技术选型

无新依赖：右键菜单用 nb-ui 的 `ContextMenu`，提示用 `Tooltip`，图标按钮用 `IconButton`。

## 关键设计

### `src/plugins/models/web/components/ProviderRail.vue`

- 条目单行：图标、名称（截断）、行尾一格（定宽，免得名称随状态挪动）。行尾一格的内容按 `status()` 现有的先后：没有密钥 → `i-lucide-key-round`（警示色），环境变量没有值 → `i-lucide-circle-alert`（危险色），检测失败 → 同上，否则淡色的模型数。图标是 `Tooltip` 的触发器，提示写原来第二行的文字；条目的 `title` 不变，读屏名称加上原因（`aria-describedby` 指向视觉隐藏的原因文字）。
- 删除：条目悬停或聚焦时行尾一格换成删除图标（`IconButton`，`tabindex="-1"`，点击 `stopPropagation`），发 `remove(id)`；条目上 `contextmenu` 打开 `ContextMenu`（一项“删除服务商…”），也发 `remove(id)`。键盘：条目上 `Delete` 与 `Shift+F10`/菜单键分别发 `remove`、开菜单。“全部模型”一项没有删除。只读（`disabled`）时都没有。
- 新事件 `remove(id: string)`；条目高度取 `--control-h-sm`，与设置窗口左栏一致。
- 窄（不到 600px，列表收成下拉）时：下拉旁边一个删除图标按钮，删当前选中的服务商（悬停条目在下拉里不存在）。

### `src/plugins/models/web/components/ProvidersPage.vue`

- 去掉标题区 `SettingsPageActions` 里的删除；`openRemove` 改为接收服务商 id（左栏的 `remove` 与窄时的按钮都走它），确认框与 `removeProvider` 不变。删完焦点到下一个服务商的条目，没有时到“添加服务商”（原规则，只是起点从标题区按钮换成条目）。
- `data-provider-remove` 挪到新的删除图标上（e2e 沿用这个标记）。

### `src/plugins/agent/web/components/ProfileRail.vue`

- 同服务商列表的单行与行尾一格：有 `statusText` 时显示图标（不可用 `i-lucide-circle-slash`、有错误 `i-lucide-circle-alert`，色调照 `statusText.tone`），悬停写原因；没有问题时这一格空着（不写来源）。分组标题“后台”不变。

### 子代理卡片：`src/plugins/agent/web/subagent-card.ts`、`SubagentCard.vue`、`plugin.ts`

- 卡片是工具节点，属性固定（`ToolComponentProps`），拿不到视图的注册表。由 `plugin.ts` 建注册表后，经 `provide` 交一个“工具名 → 动作名”的查询（`registry.resolveTool(name).label`，按当前语言解出文字）；`SubagentCard` `inject` 它，没有时退回工具 id（Lab 与单独挂载）。
- `cardModel` 不再拼好那一行，改为交出 `step: {tool, target}`；卡片组件拼“动作名 对象”。对象是地址（含 `://`）时只写最后一段（`project://正文/第二章.md` → `第二章.md`），否则原样。`waitingFor.tool` 同样经查询写动作名。
- 注册表里查不到的工具（插件贡献、没有渲染器）`resolveTool` 给通用项（`GENERIC_TOOL_RENDERER`，按它的 `id` 认，不按文字）：这时写工具 id 的最后一段，不写通用项的“工具”。

## Spec 与文档改动

- `models/settings-pages.md`：输出 1 的列表项改为单行与行尾一格；输出 12 的删除改为条目上的删除图标、右键菜单与 `Delete` 键，窄时在下拉旁边。
- `agent/profile-settings.md` 输出 2：单行，问题是行尾图标。
- `agent/conversation.md` 输出 33：运行中与“等你批准”写注册表的动作名与对象（地址只写最后一段）。
- 组件 `.md`：`ProviderRail.md`、`ProvidersPage.md`、`ProfileRail.md`、`SubagentCard.md`。

## 切片

1. **服务商列表与删除**（`ProviderRail`、`ProvidersPage`、`.md`、Spec 输出 1、12、Lab 场景补“悬停删除”“右键菜单”“窄”），提交。验证：`ModelsPageFixture` 的四个场景 `nbdev shot`（手机与自由画布）；`e2e/models.e2e.ts` 改删除的点法后跑这一个文件。
2. **Profile 左栏**（`ProfileRail`、`.md`、Spec 输出 2），提交。验证：`profile-page.dom.test.ts`；Lab 场景 `ProfileRail` 截图。
3. **子代理卡片写动作名**（`subagent-card.ts`、`SubagentCard.vue`、`plugin.ts`、`.md`、Spec 输出 33），提交。验证：`subagent-card.test.ts`（交出 `step` 的那几条改断言）、卡片的 DOM 渲染补一条“读取 第二章.md”；Lab 场景截图。

收口：`bun run typecheck`、`test:affected`、上面两个 e2e 文件之外不跑 e2e；前端实现审查一次（Sonnet）。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| `models/settings-pages.md` 输出 1 | Lab 截图（越界、焦点环被裁为 0）；`models.e2e.ts` 选中服务商 |
| `models/settings-pages.md` 输出 12 | 新加 `provider-rail.dom.test.ts`：悬停出图标、右键菜单、`Delete` 键都发 `remove`，“全部模型”与只读时没有；`models.e2e.ts` 的删除改点条目上的图标 |
| `agent/profile-settings.md` 输出 2 | `profile-page.dom.test.ts` 补“有问题的条目行尾是图标、悬停写原因” |
| `agent/conversation.md` 输出 33 | `subagent-card.test.ts`、卡片 DOM 一条（动作名与对象，查不到时写 id 的最后一段） |

## 验证

- 真实浏览器：`models.e2e.ts`；Lab 截图：服务商页（宽、窄、英文）、Profile 左栏、子代理卡片运行中与等你批准。
- 未验证边界：右键菜单的触屏长按（`ContextMenu` 不管触屏，和别处一样）。

## 不做与风险

- 对话面板改版、状态栏自定义在 t36、t37。
- 编辑组的横幅以后另改（决定 10），不在本 Task。
- 风险：删除图标在条目按钮之外又一个可点的元素，条目是 roving tabindex 的按钮，不能套按钮；图标与条目做成并列的兄弟、绝对定位叠在行尾，点击与键盘各自处理，不靠冒泡。
