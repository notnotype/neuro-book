# t04 实施计划：失败详情载体与常驻通知

## Context

ADR 0034 要求开发诊断原文只进“详情”、不当主文案；而界面里放得下详情的地方很少（[w00031 t03 前端计划审查](../../../w00031-language-policy/tasks/t03-failure-projection/evidences/plan-review-sonnet-frontend.txt) 第 1 条、[w00028 t01 前端审查](../t01-requirements/evidences/plan-review-sonnet-frontend.txt) 第 2、11 条）。本 Task 做载体，不做使用方迁移：

- 使用方（编辑器、资源管理器）的迁移在 [t05](../t05-editor-explorer-to-notifications/README.md)；
- 详情原文由谁产出（错误码与参数）在 [w00031 t03](../../../w00031-language-policy/tasks/t03-failure-projection/README.md)。

依据：评审板三轮（`artifacts/review/`，截图在 `r1`、`r2`、`r3`），决定记在 [Task README 的“设计决定”](README.md) 第 1 到 12 条。要点：

- 带详情的通知一律常驻，只能手动关闭或由发出方移除；视口最多显示最新 4 条，更早的折成“还有 n 条较早的通知 · 展开”。
- 通知的动作行在正文下一行，左对齐，“重试”与“详情”并排，关闭键留在右上角；动作按钮颜色跟随通知色调。不带详情的通知同一套排法。
- “详情”点开居中对话框（`Dialog`），通知本身不变高；对话框里是“原文 + 复制”，开发者要求样式优化并复用现有组件。
- 详情是字符串（开发诊断原文，不翻译）：`NotificationInput.detail?: string`。

工作方式：代码在 worktree；Spec 与 Task 记录在主工作区 master 提交；前端审查派 Sonnet；Lab 截图用亮色。

## 关键设计

### `packages/nb-ui/src/components/display/CodeBlock.vue`（复用，不新写原文块）

对话框里的原文用现有 `CodeBlock`，不另写等宽块。它现在是纯展示、最大高度 280px 固定、没有复制。要加：

- `copyable?: boolean`（缺省 false）：块顶出一条头行，左边是 `label`（没有 label 时为空），右边是“复制”按钮。复制的文字是各行 `text` 以换行连接，不含行号与 `+`/`-` 前缀。
- 复制三态：待复制、已复制（对勾，约 1.5 秒后复位）、剪贴板不可用或被拒时的退路——选中全部文字并在头行提示“已选中，按 Ctrl+C 复制”，选区一变提示就撤掉。不用已弃用的 `execCommand`。
- `maxHeight?: string`：覆盖固定的 280px，缺省不变。
- 文字区自己 `select-text`（调用方在 `select-none` 的祖先里也能选）。
- 文字提示（“复制”“已复制”“已选中，按 Ctrl+C 复制”）经 `useUiText()` 取，键放在 nb-ui 的目录（`src/locales/zh-CN.ts`、`en-US.ts` 的 `codeBlock` 下），由现有目录测试核对两种语言齐全。
- 同名 `.md` 同步（数据、状态与边界、交互、`state:inject` 理由已有）。

评审板里的 `DetailBlock` 是草稿，不进产品：它的头行排法与复制三态搬进 `CodeBlock`，实现前在 Lab 里出 `CodeBlock` 带复制的场景，截图给开发者看，样式按开发者“文字展示 + 复制”的要求再调。

### `packages/nb-ui/src/components/feedback/DetailDialog.vue`（新，同名 `.md` 先写）

通知与别的宿主界面共用的“详情对话框”：`Dialog`（`size="md"`）里放一块 `CodeBlock`（`copyable`、`maxHeight` 取对话框可用高度）。

```ts
defineProps<{
    open: boolean;
    /** 标题；对话框的可访问名称。 */
    title: string;
    /** 诊断原文；按行拆开交给 CodeBlock。 */
    detail: string;
}>();
defineEmits<{(e: "update:open", value: boolean): void}>();
```

- 页脚只有一个次级按钮“关闭”（`Dialog` 默认页脚的主色确认键对只读内容太抢眼，用 `footer` 插槽换）；初始焦点给面板（`initialFocus` 给一个找不到的选择器，Dialog 约定退到面板），复制按钮不带焦点光晕；Esc、点遮罩、“关闭”都关。
- 不翻译原文；标题由调用方给（通知堆叠用通知标题加“：详情”的目录文字）。
- 导出到 `components/index.ts` 与 SDK 的 `src/sdk/components.ts`（插件作者的详情入口也走它），公开面快照随之更新。

### `packages/nb-ui/src/composables/useNotification.ts`

- `NotificationInput` 加 `detail?: string`，`NotificationItem` 带上；`NotificationPatch` 可改它。
- `duration` 缺省：给了 `detail` 就是 0（常驻）；明确给的 `duration` 仍优先。理由：诊断原文是排查线索，丢了比占屏更糟；用户选中文字时鼠标离开通知，限时通知会被移走。
- 其余队列逻辑（悬停暂停、更新、移除）不变。

### `packages/nb-ui/src/components/feedback/Notification.vue`

- 布局改成网格：图标列、正文列、右上角关闭键；动作行跨正文列，放在正文（与进度条）下面，不再画“动作按钮”那一列。窄屏同一结构。
- 动作行：`action` 插槽或 `actionLabel` 产生“动作”文字按钮（颜色取通知色调，沿用现在的 `--nb-notification-tone`），`detailLabel` 非空产生“详情”文字按钮（带下划线的次级文字，按下态是浅底）；二者并排、左对齐；可见高度 24px，点击区用伪元素撑到 32px 且相邻点击区不重叠。
- 新增 `detailLabel?: string`（有值才出“详情”）、事件 `detail`；`actionLabel`、`action` 槽与 `action` 事件保留，只是位置换了（视觉变化，`.md` 写明）。
- 根节点的 `select-none` 不改；原文的选择在对话框里，不在通知里。
- 正文加 `text-wrap: pretty`，避免窄屏单字孤行（评审板手机图里出现过“容。”）。
- 同名 `.md` 同步（布局、数据、事件）。已有使用方先核对：`packages/dev-panel/src/web/parts/WriteResult.vue`、`packages/neuro-book/src/plugins/agent/web/components/PermissionRulesPage.vue` 是否用到动作列，动作行变化后截图确认。

### `packages/nb-ui/src/components/feedback/NotificationStack.vue`

- 新增 `maxVisible?: number`（缺省 4）：只渲染最新 `maxVisible` 条；更早的有 n 条时，在视口远离屏幕边缘的一侧画一条同宽、低一档表面的折叠小条“还有 n 条较早的通知”和“展开”。点“展开”显示全部（视口内部纵向滚动，最大高度不超过窗口高度减边距），“收起”还原；总数回到上限以内时自动回到收起态。折叠的通知计时照常（限时的仍会按时消失）。
- 持有“当前打开详情”的通知 id：点通知的“详情”时，把该通知的标题与原文快照下来交给 `DetailDialog`；通知在对话框打开期间被移除时，对话框继续显示快照，关闭后才释放，不悬空。
- 队列里 `item.detail` 不为空才给 `Notification` 传 `detailLabel`（文字经 `useUiText()`：“详情”）。
- `position` 不同时折叠小条的位置随边缘（bottom-* 在上方，top-right 在下方）。

### `packages/neuro-book/src/plugins/workbench/`

- `shared/contracts.ts`：`NotificationInput.detail?: string`（注释写明：开发诊断原文，字符串，不翻译，不是 `DisplayText`）；`NotificationHandle.update` 的补丁含它。
- `web/notifications.ts`：`notify`、`update` 透传 `detail`；`durationOf` 缺省常驻判据加“有 `detail`”：`sticky ?? (tone === danger || action !== undefined || detail !== undefined)`，明确给的 `sticky` 仍优先（Spec 输出 5 的“明确给过的 sticky 一直算数”不变）；`update` 改了 `detail` 时和改色调、动作一样重算。
- `web/components/WorkbenchNotifications.vue`：不变（视口自己接线）。

### 不在本 Task（写明，避免被当成遗漏）

- 编辑器、资源管理器、状态栏对载体的使用（t05；状态栏条目点开详情现在没有原文可放：`StatusBarProblem` 只有码，待 w00031 给原文再接）。
- 失败页与 Agent 对话视图：它们已有自己的详情位，等 w00031 t03 迁移时再接同一个组件。
- 通知中心、历史（通知 Spec 已列为不承诺）。
- 选区高亮色的统一（`::selection`）：主题没有这一项，实现时若影响可读性再单独记，不在本 Task 默认范围。

## Spec 与文档改动

- `docs/specs/workbench/notifications.md`：输入合同加 `detail`；输出 3（时长）加“带详情的通知不自动消失”；输出 2 或新输出写动作行与详情入口、视口上限 4 与折叠小条（含“展开”“收起”、折叠的通知计时照常）；失败与恢复补“对话框打开期间通知被移除”；验收加三条（见验收映射）；实现合同的 owner 与不变量补“队列里不存翻好的字符串”之外的一条：`detail` 原样进队列、不翻译。证据节更新。
- nb-ui 的 `Notification.md`、`NotificationStack.md`、`CodeBlock.md`、新的 `DetailDialog.md`、`docs/ui-development-spec.md` 若有通知相关条目（实施时 grep）。
- Work README 的任务表与 t04 README 的状态；`pending-confirmations.md` 本 Work 没有，若出现偏离已接受提案的决定再建（本计划没有）。

## 切片

1. **CodeBlock 复制与最大高度**：`CodeBlock.vue`、`.md`、nb-ui 目录两种语言；单元测试；Lab 里 `CodeBlock` 夹具加复制场景，截图给开发者看样式（开发者要求优化的点在这一片定）。提交一次。
2. **DetailDialog**：组件、`.md`、导出（`components/index.ts`、SDK 的 `components.ts`、公开面快照）、Lab 夹具与测试。
3. **useNotification 与 Notification 的动作行**：`detail` 字段与缺省时长；`Notification` 网格布局、动作行、`detailLabel`、`detail` 事件、`.md`；检查两个既有使用方的外观；Lab 夹具更新。
4. **NotificationStack**：上限与折叠、对话框接线与快照；Lab 夹具加“带详情”“六条堆叠”场景。
5. **工作台服务**：契约、`notifications.ts` 透传与常驻判据；Spec 与测试。
6. **收口**：受影响的 nb-ui 与 neuro-book 测试、`docs:check`、`governance:check`；e2e（见验证）；Lab 截图对照；Task README 完成状态与证据。

每片：先写同名 `.md`，再写 `.vue`；自跑 `typecheck` 与该片的测试后单独提交；Spec 与计划随代码分支或在主工作区按仓库的现行写法提交（实施时按 `.agents/works/README.md` 确认）。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| `workbench.notifications` 输出 3（带详情的通知不自动消失，包括警告级与不带动作的） | `notifications.dom.test.ts` 新用例：`notify({tone:"warning", detail})` 经假计时之外的真实队列等待，不被移除；`useNotification.test.ts`：`duration` 缺省为 0，明确给的 `duration` 仍生效 |
| 输出 5（`update` 改 `detail`、明确给过的 `sticky` 保留） | `notifications.dom.test.ts` |
| 视口上限与折叠小条（输出 2 新增） | `NotificationStack.test.ts`：六条常驻只渲染最新 4 条、小条显示“还有 2 条”、点“展开”全部显示、移除到 4 条内自动回到收起态；折叠中的限时通知到时照常移除 |
| 动作行与详情入口 | `Notification` 单测：有 `detailLabel` 才出“详情”；点它发 `detail`；动作与详情在同一行；没有“动作那一列”（动作按钮不在关闭键同一行） |
| 详情对话框 | `NotificationStack.test.ts`：点“详情”打开 `DetailDialog`，对话框里是原文各行；打开期间通知被移除，对话框仍在，关闭后释放；Esc 关闭、焦点回到“详情”按钮 |
| 复制三态 | `CodeBlock` 单测：剪贴板可用时写入各行文字以换行连接并显示“已复制”后复位；去掉 `navigator.clipboard` 时选中全部文字并出现提示，选区变化后提示撤掉 |
| 窄屏不溢出 | Lab 场景在 390 预设下 `lab:shot` 无溢出报告 |
| 两种语言齐全 | nb-ui 现有 `locales.test.ts` |
| 切换语言后动作与详情文字原地更新 | `notifications.dom.test.ts` 现有的语言切换用例扩到带详情的通知 |

## 验证

- 单元与 DOM：nb-ui（`bun run test:vitest` 受影响的文件，加 `typecheck`）、neuro-book（`notifications.dom.test.ts`、公开面快照 `sdk.test.ts`/`surface.test.ts`）。只跑受影响的，不跑全量。
- 真实浏览器：Lab 的 `NotificationStack` 夹具里点“详情”打开对话框、选中并复制（`e2e/lab-nb-ui.e2e.ts` 加一例，需要先 `bun run build` 与 `bun run build:e2e`）；e2e 前先停掉多余服务。
- 截图：Lab 夹具亮色桌面与 390 窄屏，暗色一张，给开发者看；与评审板第 3 轮的截图对照。
- 留下的未验证边界：非安全上下文（`http://` 局域网）的真实剪贴板被拒的浏览器行为只用测试里去掉 `navigator.clipboard` 的方式验证，没有在真实非安全页面里点过。

## 不做与风险

- 不改失败页、Agent 视图、状态栏、编辑器、资源管理器（见上）。
- `Notification` 动作列改成动作行是视觉变化，影响所有使用方；SDK 公开面里它是 nb-ui 组件导出，插件作者的外观会变，0.x 走次版本号，发布与否按版本表另行授权。
- 折叠小条里折叠的通知仍有计时：若折叠的是限时通知，用户展开时可能已消失，属预期，Spec 写明。
- 对话框是模态：打开期间通知里的“重试”点不到，要先关对话框；这是已接受的取舍（第 3 轮 `notice-detail-where` 选 A）。
