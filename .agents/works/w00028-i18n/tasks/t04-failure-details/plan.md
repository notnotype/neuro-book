# t04 实施计划：失败详情载体与常驻通知（第二版）

## Context

ADR 0034 要求开发诊断原文只进“详情”、不当主文案；而界面里放得下详情的地方很少（[w00031 t03 前端计划审查](../../../w00031-language-policy/tasks/t03-failure-projection/evidences/plan-review-sonnet-frontend.txt) 第 1 条、[w00028 t01 前端审查](../t01-requirements/evidences/plan-review-sonnet-frontend.txt) 第 2、11 条）。本 Task 做载体，不做使用方迁移：

- 使用方（编辑器、资源管理器）的迁移在 [t05](../t05-editor-explorer-to-notifications/README.md)；
- 详情原文由谁产出（错误码与参数）在 [w00031 t03](../../../w00031-language-policy/tasks/t03-failure-projection/README.md)。**载体合同**：载体只接收已脱敏、有界的 `string`；码与参数由 w00031 t03 在进入通知之前投影成这个字符串，不得把 `detail` 改成别的形状（交接写进 w00031 t03 的 README）。

依据：评审板三轮（`artifacts/review/`），决定记在 [Task README 的“设计决定”](README.md) 第 1 到 12 条。要点：

- 带详情的通知缺省常驻；视口最多显示最新 4 条，其余折成“还有 n 条较早的通知”。
- 通知的动作行在正文下一行，左对齐，“重试”与“详情”并排，关闭键留在右上角；动作按钮颜色跟随通知色调。
- “详情”点开居中对话框，通知本身不变高；对话框里是“原文 + 复制”，复用现有 `CodeBlock`。
- `detail` 是不翻译的字符串。

第一版计划经两份设计审查（omp 13 条、Claude Sonnet 前端 17 条，`evidences/plan-review-omp.txt`、`plan-review-sonnet-frontend.txt`），处理记录在末尾；本版按它修订。

工作方式：代码与组件同名 `.md`、测试在 worktree 分支提交；**Spec、`plan.md` 与 Task 记录只在主工作区 master 改，按路径限定提交**（`git commit -- <路径>`），实现 worktree 不改 `.agents/works` 与 `docs/specs`。前端审查派 Sonnet；Lab 截图用亮色。

## 关键设计

### 规则的 owner：常驻与时长只在工作台服务里定

Spec“实现合同”已定：常驻与时长规则在工作台服务，nb-ui 队列只认折算后的时长。本 Task 不改变这一点：

- nb-ui `useNotification`：`NotificationInput`、`NotificationItem` 加 `detail?: string` 与 `detailTruncated?: boolean`，`NotificationPatch` 可改；**不在队列里按 `detail` 折算时长**（队列的缺省时长仍只按色调）。直接用队列的调用方（Lab、dev-panel）带详情时自己给 `duration: 0`，写进 `.md`。
- nb-ui 导出判据函数 `hasNotificationDetail(detail)`（`@notnotype/nb-ui/notifications`，没有 DOM 依赖）：`detail` 去掉首尾空白后非空才算“有详情”。**服务、队列、视口共用这一个判据**；空串与全空白等于没有详情，既不常驻也不出“详情”入口。
- nb-ui 导出 `NOTIFICATION_DETAIL_MAX_CHARS = 8000`，队列在 `notify`、`update` 时把超长 `detail` 截到上限并置 `detailTruncated`（对话框显示“原文过长，已截断”）。上限取值：[`runtime.diagnostics`](../../../../docs/specs/runtime/diagnostics.md) 单条消息默认 4000 字符，加堆栈留一倍余量。载体不做脱敏（脱敏是诊断提供者的责任，[`runtime.diagnostics`](../../../../docs/specs/runtime/diagnostics.md) 已规定），只在 Spec 里写明“传进来的必须已脱敏”，也不声称保护密钥。

### `packages/neuro-book/src/plugins/workbench/`（服务）

- `shared/contracts.ts`：`NotificationInput.detail?: string`（注释写明：开发诊断原文，已脱敏的有界字符串，不翻译，不是 `DisplayText`）；`update` 补丁含它，传空串清除详情。
- `web/notifications.ts`：
  - `notify`、`update` 透传 `detail`；`durationOf` 缺省常驻判据加“有详情”：`sticky ?? (tone === danger || action !== undefined || hasNotificationDetail(detail))`。**优先级只有一条**：明确给的 `sticky`（含 `false`）优先，这是 Spec 输出 5 的既有语义，不为 `detail` 破例；所以决定 1 的准确说法是“带详情的通知缺省常驻”。
  - `update` 的重算条件加“详情有无发生变化”（无→有、有→无）；新增、替换为另一段文字、清除各一条合同测试。更新用的当前值从队列条目里读，不另存一份。
  - 工作台服务每次 `notify` 显式给 `duration`，所以 nb-ui 的缺省不参与；测试里服务与队列各自创建独立队列，不依赖模块级默认队列。

### `packages/nb-ui/src/components/display/CodeBlock.vue`

保持纯展示（Spec 规范要求公共零件耦合度为 0，`CodeBlock` 被 `nb-agent-ui` 等几处共用，不能因为复制而背上剪贴板与定时器）。只加：

- `maxHeight?: string`：覆盖固定的 280px，缺省不变；
- 头行插槽 `actions`：右上角放操作按钮；有 `label` 或有 `actions` 内容时才画头行；
- 文字区自己 `select-text`，各行之间是真实换行，选中后粘出的文字与复制的一致（空行不写成空格）；
- 同名 `.md` 同步。

### `packages/nb-ui/src/components/controls/CopyButton.vue`（新，同名 `.md` 先写）

复制按钮是独立小组件，隐藏通道声明在它自己的 `.md`：`env:clipboard`（写剪贴板）、`env:timer`（复位计时）、`state:inject`（文字端口）、`state:local`；不注册全局监听。

```ts
defineProps<{
    /** 要复制的完整文字。 */
    text: string;
    /** “已复制”状态保持多久（毫秒）；缺省 1500。测试传小值，等 `data-copy-state` 回到 idle，不等固定时长。 */
    resetAfter?: number;
}>();
```

- 三态：`idle`、`copied`（对勾，“已复制”）、`failed`（“复制失败，请手动选择文字”）；状态写在 `data-copy-state`，同时在不可见的 `role="status"` 里播报文字。
- 复制顺序：`navigator.clipboard.writeText`；该 API 不存在（非安全上下文）或被拒时退到不可见 `<textarea>` 加 `document.execCommand("copy")`（已弃用但非安全上下文里它仍是唯一的一键复制；不再设计“选中全部并提示 Ctrl+C”，那条路要监听 `selectionchange`、键名随平台变，评审指出它不可靠）；两条都失败才是 `failed`。
- 计时器随组件销毁清掉；组件卸载后不再改状态。
- 文字（“复制”“已复制”“复制失败，请手动选择文字”）经 `useUiText()`，键放在 nb-ui 目录的 `copyButton` 下，两种语言齐全。按钮用最小的 `Button` 档；若现有档偏大，只在 Lab 里核对，不为它扩 `Button` 的尺寸档。

### `packages/nb-ui/src/components/feedback/DetailDialog.vue`（新，同名 `.md` 先写）

通知与别的宿主界面共用的“详情对话框”；**受控、无自有状态**，t05 与 w00031 需要时各自在自己的位置挂一份，不必改通知视口。

```ts
defineProps<{
    open: boolean;
    /** 标题（已是当前语言的字符串，由调用方按当前语言算出，所以随语言切换更新）。 */
    title: string;
    /** 诊断原文；按换行拆成 CodeBlock 的行，CRLF 与 LF 一样拆。 */
    detail: string;
    /** 原文已被截断：块底显示“原文过长，已截断”。 */
    truncated?: boolean;
}>();
defineEmits<{(e: "update:open", value: boolean): void}>();
```

- `Dialog`（`size="md"`）里放一块 `CodeBlock`（`label` 写“诊断原文”，`actions` 插槽放 `CopyButton`，`maxHeight` 取对话框正文剩余高度，正文本身不再出第二层纵向滚动）。原文单行很长时横向滚动，字号用 `CodeBlock` 现有的 2xs 之上一档（实施时在 Lab 里看清晰度，样式是开发者要求优化的点）。
- 页脚只有“关闭”次级按钮（`Dialog` 默认的主色确认键对只读内容太抢眼，用 `footer` 插槽换）；初始焦点给正文容器（`tabindex="-1"` 的真实目标，`initialFocus` 指向它），复制按钮不带焦点光晕；Esc、点遮罩、“关闭”都关。
- 导出到 `components/index.ts`、SDK 的 `src/sdk/components.ts`。

### `packages/nb-ui/src/components/feedback/Notification.vue`

- 布局改成网格：图标列、正文列、右上角关闭键；动作行跨正文列，在正文（与进度条）下面，不再画“动作按钮”那一列。窄屏同一结构。
- 动作行：`action` 槽或 `actionLabel` 产生“动作”文字按钮（颜色取 `--nb-notification-tone`），有详情时多一个“详情”文字按钮（带下划线的次级文字，按下态浅底）；并排、左对齐；可见高度 24px，点击区用伪元素撑到 32px 且相邻不重叠；两个按钮都带 `nb-ui-focus-ring`，焦点环不被卡片裁切。
- 新增 `hasDetail?: boolean`、`detailLabel?: string`（缺省取文字端口“详情”，与现有 `closeLabel ?? text(...)` 同一写法）、事件 `detail`；`actionLabel`、`action` 槽与事件保留，只是位置换了。根节点的 `select-none` 不改，原文选择在对话框里。
- 正文加 `text-wrap: pretty`；同名 `.md` 同步。
- 既有使用方：只有 `packages/dev-panel/src/web/parts/WriteResult.vue` 用 `<Notification>`（含 `action-label`），实施时截图核对；`PermissionRulesPage.vue` 不用它（第一版计划误列）。

### `packages/nb-ui/src/components/feedback/NotificationStack.vue`

- `maxVisible?: number`（缺省 4）：边界处归一化为 ≥1 的整数（`NaN`、0、负数、小数取缺省或向下取整后至少 1）；只渲染最新 `maxVisible` 条。排序沿用现状：所有位置都是最早的在上、最新的在下，所以折叠小条**在整列的最上面**（不论 `position`）。
- 折叠小条是真实按钮：文字“还有 n 条较早的通知”，`aria-expanded`、`aria-controls`；展开后改为“收起”，焦点留在这个按钮上。展开时列表在一个纵向滚动容器里（最大高度随视口，滚动容器自己 `pointer-events-auto` 并留出阴影与焦点环的内边距，展开与新通知到达时滚到最新一条）；总数回到上限以内自动回到收起态。折叠的通知计时照常（限时的仍会按时消失，用户展开时可能已不在，Spec 写明）。折叠只按时间，不区分常驻错误与限时提示，已接受的取舍。
- 视口根加 `role="region"` 与可访问名称（“通知”，经文字端口），让键盘与读屏用户能到达这一块。
- 对话框：点“详情”时记下（a）打开它的按钮元素，（b）通知的原始标题 `Text` 与 `detail`、`detailTruncated`、色调（快照，**存文字值而不是翻好的字符串**）；渲染时用 `computed` 经文字端口生成当前语言的标题——有标题时“`{{title}}`：详情”，没有标题时只写“详情”（目录两个键 `notification.detailTitle`、`notification.detailTitleBare`），所以打开后切换语言标题跟着换。
- 对话框打开期间视口整体 `inert` 并 `aria-hidden`（通知层级 9050 高于对话框 9000，不处理的话通知会盖在对话框上、仍可点；改成 inert 后与“模态”一致，也不会盖住对话框的关闭与复制按钮）；同一时间只有一个详情对话框，不存在“换内容”的情形。通知在对话框打开期间被移除，对话框继续显示快照。
- 关闭对话框后的焦点：沿用 `Dialog` 现有的交还（交还打开前的元素）；Stack 在关闭后检查记下的按钮是否仍连接——连接就聚焦它（Safari 点按钮不聚焦，所以显式聚焦而不是依赖 `Dialog` 记到的元素），不连接（通知已移除或被挤进折叠）就聚焦视口根（`tabindex="-1"`，`preventScroll`），不让焦点落到 `body`。
- 传给 `Notification` 的 `hasDetail` 用 `hasNotificationDetail(item.detail)`。

### 不在本 Task（写明，避免被当成遗漏）

- 编辑器、资源管理器、状态栏对载体的使用（t05；状态栏条目点开详情现在没有原文可放：`StatusBarProblem` 只有码，待 w00031 给原文再接）。
- 失败页与 Agent 对话视图：它们已有自己的详情位，等 w00031 t03 迁移时再接同一个组件。
- 通知去重、按键更新、“全部关闭”：t05 绑定文档状态时一并设计（写进 t05 README）；通知中心与历史：通知 Spec 已列为不承诺。
- 选区高亮色统一：主题没有这一项，不在默认范围。
- nb-ui 与 SDK 的版本号：发布与否按版本表另行授权，不在本 Task 改。

## Spec 与文档改动（主工作区 master，按路径限定提交）

- `docs/specs/workbench/notifications.md`：输入合同加 `detail`（含清除语义、有界、已脱敏前提）；输出 3 加“带详情缺省常驻，明确给的 `sticky` 仍优先”；输出 5 加“详情有无变化时重算”；新输出：动作行与详情入口、视口上限与折叠小条、详情对话框（模态、通知视口 inert、标题随语言、焦点归还）；失败与恢复补“对话框打开期间通知被移除”“超长原文被截断”；验收加三条；实现合同补 owner 一句“规则只在服务里定，队列与视口只用共用判据”；证据节更新。
- 组件同名 `.md`（随代码分支提交）：`Notification`、`NotificationStack`、`CodeBlock`、新的 `CopyButton`、`DetailDialog`；`packages/nb-ui/docs/ui-development-spec.md` 若有通知相关条目，实施时 grep。
- nb-ui 目录（`src/locales/zh-CN.ts`、`en-US.ts`）新增键并更新 `src/locales/locales.test.ts` 与 `src/components/default-text.test.ts` 的对照表（不更新它们会变红）。
- w00031 t03 README 加一行载体合同交接；t05 README 加“去重、按键更新、全部关闭”；Work README 与 t04 README 的状态。

## 切片

1. **CodeBlock 头行与 CopyButton**：`CodeBlock` 的 `maxHeight`、`actions`、可选中；`CopyButton`、`.md`、目录两种语言；单元测试；Lab 夹具加 `CopyButton` 与 `CodeBlock` 带操作的场景，截图给开发者看样式（开发者要求优化的点在这一片定）。提交一次。
2. **DetailDialog**：组件、`.md`、导出（`components/index.ts`、SDK `components.ts`、公开面快照与 `plugin-sdk/pack.test.ts`）、Lab 夹具与测试。
3. **队列与服务**：`useNotification` 的 `detail`、`detailTruncated`、`hasNotificationDetail`、上限；工作台 `contracts.ts` 与 `notifications.ts`；队列与服务的合同测试。
4. **Notification 的动作行**：网格布局、`hasDetail`、`detailLabel`、`detail` 事件、`.md`、dev-panel 的 `WriteResult` 截图核对；Lab 夹具更新。
5. **NotificationStack**：上限与折叠、region、对话框接线、inert、焦点归还；Lab 夹具加“带详情”“六条堆叠”“top-right”场景。
6. **收口**：受影响的 nb-ui 与 neuro-book 测试、`docs:check`、`governance:check`；e2e；Lab 取证；Spec（主工作区）；Task README 完成状态与证据。

每片：先写同名 `.md`，再写 `.vue`；自跑该片的测试与 `typecheck`；单独提交。

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 工作台服务：带详情缺省常驻，包括警告级、无动作的；明确给的 `sticky: false` 仍限时（`workbench.notifications` 输出 3、5） | `notifications.dom.test.ts`：真实队列、真实服务，`sticky` 三种取值 × 有无 `detail`，读队列条目的 `duration` 与（用很短的 `sticky:false` 色调时长之外的真实等待，见下）是否被移除；不用假计时器 |
| `update` 的详情：无→有（限时变常驻）、替换、有→无（常驻回到按色调限时）、空串与全空白等于没有 | `notifications.dom.test.ts` 三条 update 合同，读队列条目字段 |
| 超长原文截断并置 `detailTruncated` | 队列合同测试（`useNotification.test.ts`）：一百万字符输入，条目里 `detail` 长度等于上限、标志为真；对话框块底有“已截断”提示（`NotificationStack.test.ts`） |
| 视口上限与折叠小条 | `NotificationStack.test.ts`：六条常驻只渲染最新 4 条；小条是按钮，带 `aria-expanded`；点后全部显示，再点收起；移除到 4 条内自动收起；`maxVisible` 传 0、负数、1.5、NaN 时取到合法值；折叠中的限时通知到时照常移除（等该通知条目消失这一可观察状态，不等固定时长） |
| 动作行与详情入口 | `Notification` 单测：有 `hasDetail` 才出“详情”；点它发 `detail`；动作与详情同一行；动作按钮不与关闭键同一行；`detailLabel` 缺省随语言切换 |
| 详情对话框内容与标题 | `NotificationStack.test.ts`：点“详情”打开对话框，里面是原文各行（CRLF 与 LF 同样拆）；标题有标题时为“标题：详情”，无标题时为“详情”；打开后切换语言标题原位更新 |
| 打开期间通知被移除 | 同文件：对话框仍在、内容是快照；视口 `inert`；关闭后焦点落到视口根，不在 `body` |
| 打开期间通知仍在 | 同文件：关闭后焦点回到“详情”按钮（测试里显式 `focus()`，happy-dom 的 `click()` 不聚焦，计划不依赖它）；对话框打开时点不到通知里的“重试” |
| 复制三态 | `CopyButton` 单测：剪贴板可用时写入完整文字，`data-copy-state` 变 `copied`，传 `resetAfter` 小值后回到 `idle`（等该属性，不等固定时长）；无 `navigator.clipboard` 时走 `execCommand` 路径；两条都失败为 `failed`；卸载后不再改状态 |
| 真实浏览器的复制与对话框 | `e2e/lab-nb-ui.e2e.ts` 加一例（先 `bun run build` 与 `bun run build:e2e`；授予剪贴板读写权限）：Lab 的通知夹具里点“详情”，对话框出现、点“复制”后读剪贴板等于原文；用初始化脚本把 `navigator.clipboard` 置空后再点，仍读到原文（`execCommand` 路径）；`Esc` 关闭 |
| 公开面 | `sdk.test.ts`、`surface.test.ts`、`plugin-sdk/pack.test.ts`（生成的 `components.d.ts` 含 `DetailDialog`、`CopyButton`）；仓库外作者项目的类型检查 smoke 并入 `release:smoke` 的既有流程时才跑，本 Task 只核对生成物含新组件 |
| 两种语言齐全；缺省文案 | nb-ui `locales.test.ts`、`default-text.test.ts`（更新对照表） |
| 切换语言后动作与详情文字原地更新 | `notifications.dom.test.ts` 现有语言切换用例扩到带详情的通知 |
| 窄屏不溢出、主题 | Lab：`NotificationStack`（带详情、六条堆叠、top-right）与 `DetailDialog` 场景在 `nbook`/`macos` × 亮/暗 四种组合与 390 预设下 `lab:shot`，读 `report.json` 的溢出、焦点环被裁、pageerror 与控制台；无宿主端口的缺省文案由 `default-text.test.ts` 覆盖 |

“很短的色调时长之外的真实等待”一行的做法：`sticky: false` 且无详情的 info 通知本来就按色调 3.2 秒消失；测试不等它，而是断言队列条目的 `duration` 取值（折算结果是合同），消失本身由 `useNotification.test.ts` 已有的计时用例覆盖。

## 验证

- 单元与 DOM：nb-ui（受影响的 vitest 文件与 `typecheck`）、neuro-book（`notifications.dom.test.ts`、`sdk.test.ts`、`surface.test.ts`）、`plugin-sdk/pack.test.ts`；`docs:check`、`governance:check`；只跑受影响的，不跑全量。
- 真实浏览器：上表的 e2e 一例；e2e 前先停掉多余服务。
- 取证：Lab 夹具截图按上表四种组合加 390；与评审板第 3 轮的截图对照；给开发者看 `CodeBlock` 加复制的样式（切片 1）。
- 留下的未验证边界：真实非安全页面（`http://` 局域网）里 `execCommand` 复制没有手点过，只用 e2e 里置空 `navigator.clipboard` 的方式验证；Safari 的按钮焦点行为只靠“显式聚焦”这一设计，没有在 Safari 里验证。

## 不做与风险

- 不改失败页、Agent 视图、状态栏、编辑器、资源管理器（见上）。
- `Notification` 动作列改成动作行是视觉变化，SDK 里它是 nb-ui 组件导出，插件作者的外观会变，0.x 走次版本号，发布与否另行授权。
- 载体不脱敏：`detail` 传进来必须已脱敏，复制会把原文交给系统剪贴板；生产者（w00031 t03 的投影、诊断提供者）负责。
- 折叠只按时间：折叠的可能是常驻错误；折叠小条总显示数量，已接受。
- 对话框期间通知视口 inert：不能边看原文边点“重试”，要先关对话框；这是已接受的取舍（评审板第 3 轮 `notice-detail-where` 选 A）。

## 审查处理（第一轮，2026-11-07）

报告：`evidences/plan-review-omp.txt`（13 条，全部“重要”）、`evidences/plan-review-sonnet-frontend.txt`（17 条，重要 8、建议 9）。两份有大量重合，下面按主题合并列出处理；编号 O 指 omp、F 指前端。

| 主题 | 条目 | 处理 |
|---|---|---|
| `CodeBlock` 加复制破坏公共零件“耦合度 0” | F1 | 成立，已改：`CodeBlock` 只加 `maxHeight` 与 `actions` 槽，复制做成独立的 `CopyButton`（隐藏通道写在它自己的 `.md`） |
| 复制退路：选区自触发、Ctrl+C 写死、排除 `execCommand` 无理由、两条路径粘出文字不一致 | F2、O7（一部分） | 成立，已改：不再做“选中全部并提示”，改 `execCommand` 退路，两条都失败才显示“复制失败，请手动选择文字”；文字区是真实换行；不监听 `selectionchange` |
| 复制状态复位的测试不能用固定时长 | O7 | 成立，已改：`resetAfter` 属性，测试传小值、等 `data-copy-state` |
| 对话框期间“重试”点不到的前提不成立（通知层级高于对话框） | F3、F10 一部分 | 成立，已核实（`NB_Z_INDEX.notification` 9050 > `dialog` 9000）：改为对话框打开期间视口整体 `inert`；单槽问题随之消失（同一时间只有一个对话框）；对话框受控无状态，别处各挂一份（F10） |
| 焦点归还只验证了最理想的情形 | F4、O6 | 成立，已改：记下触发按钮，关闭后连接则显式聚焦，不连接则聚焦视口根；两种顺序分开测，测试显式 `focus()` |
| 常驻判据两层、优先级不清、空 `detail`、清除语义 | F5、F11、O1、O2、O3、O9 | 成立，已改：规则的 owner 只在服务，队列不折算；共用 `hasNotificationDetail`；明确给的 `sticky` 仍优先（决定 1 改称“缺省常驻”）；空串与全空白等于没有，传空串清除；`update` 重算条件加“详情有无变化”；三条 update 合同测试 |
| `detail` 无上限、可能含密钥 | O4、F6（一部分） | 部分成立：加 8000 字符上限与截断标记；不在载体里脱敏（`runtime.diagnostics` 已规定诊断提供者脱敏），Spec 写明“传入必须已脱敏”；不声称保护密钥 |
| 标题快照与语言、无标题 | F8、O5 | 成立，已改：快照原始 `Text`，渲染时 `computed` 出当前语言标题，无标题只写“详情”；加切换语言用例 |
| 原文展示边界（长单行、字号、双层滚动、CRLF） | F6 | 部分成立：长单行横向滚动、CRLF 与 LF 同样拆、对话框内只留一层纵向滚动；字号在 Lab 里看清晰度再定（样式本是开发者要求优化的点） |
| 折叠小条位置、展开滚动、`pointer-events`、限高 | F7、O8 | 成立，已改：核实现有排序所有位置都是最早在上，所以小条一律在列顶（第一版“top-right 在下方”是错的）；展开滚动容器自带 `pointer-events-auto`、内边距、滚到最新；折叠按时间不区分类型，作为已接受的取舍写明 |
| `maxVisible` 非法值、折叠小条的键盘与读屏 | O8、F9、F17 | 成立，已改：归一化；按钮带 `aria-expanded`、`aria-controls`；视口 `role="region"` |
| “已复制”读屏播报、复制按钮不带光晕与焦点环规范 | F9、F16 | 成立，已改：不可见 `role="status"`；初始焦点给正文容器这个真实目标，不再用找不到的选择器 |
| `detailLabel` 与 `closeLabel` 取文字不一致、动作按钮缺焦点环 | F13 | 成立，已改：`detailLabel ?? text(...)` 与 `closeLabel` 同写法；动作与详情按钮带焦点环 |
| 队列无限增长、去重、全部关闭 | F12、F17 一部分 | 部分成立，超出本 Task：去重键、按键更新、“全部关闭”交 t05（绑定文档状态时一并设计），写进 t05 README |
| 验收有测不出的条目、缺边界用例 | F14、O7 | 成立，已改：验收映射重写，补空/截断/非法 `maxVisible`/两种焦点顺序/语言切换/e2e 一例；不用假计时器 |
| 文档与登记漏项；`PermissionRulesPage` 误列 | F15 | 成立，已改：`locales.test.ts`、`default-text.test.ts` 对照表列入；既有使用方只有 dev-panel 的 `WriteResult` |
| Lab 取证不满足 nb-ui 共享组件的四组合门禁 | O11 | 成立，已改：`nbook`/`macos` × 亮/暗 加 390，读 `report.json` |
| Spec 与 Task 记录的提交位置自相矛盾 | O12 | 成立，已改：记录与 Spec 只在主工作区 master 按路径限定提交，实现 worktree 不改 |
| 公开面验收只覆盖源码名单 | O13 | 成立，已改：加 `plugin-sdk/pack.test.ts` 核对生成的 `components.d.ts`；仓库外作者项目 smoke 并入既有发布冒烟，版本号不在本 Task |
| 载体与 w00031 t03 的 `detail` 合同可能失配 | O10 | 成立，已改：写明载体合同（已脱敏有界字符串），交接写进 w00031 t03 README |
| 对照 VS Code 与 Sonner 缺的项 | F17 | 键盘到达（region）已加；去重已交 t05；展开态的悬停暂停沿用现有逐条悬停，不另做 |

## 待确认项

无需开发者另行决定的偏离；决定 1 的措辞由“一律常驻”改为“缺省常驻”（明确给的 `sticky: false` 仍优先，Spec 输出 5 的既有语义），因为不改这一条就要破坏 Spec 既有合同。
