---
schema: nbook.task/v2
taskId: t18-messages-float-window-im
status: active
updated: 2026-11-25
---

# 消息视图浮动成窗口时像 IM：列表栏可拖宽、bot 与会话的切换控件、浮动窗里视图自绘头

## 目标与范围

开发者 2026-11-25 把“消息”视图浮成窗口来看（[t15](../t15-messages-view/README.md) 的成果），指出三处，目标是浮成窗口时像 IM 软件：

1. **列表栏拖宽**：列表栏现在固定 260px、只有收起按钮。改用 nb-layout 的 `Splitter`：拖动改宽度，拖窄过了最小宽度吸成头像列，往回拖展开；宽度由宿主记住。nb-agent-ui 新增对 nb-layout 的依赖。`Splitter` 会裁切面板，窄版的列表是压在聊天区上的抽屉，列表要在两处之间挪动而不重挂；挪不干净时把缺口提给 nb-layout（导出不管面板、只给分隔条的零件）。
2. **bot 与会话的切换控件**：现状是 nb-ui 的下划线 `Tabs`，开发者觉得丑。出静态稿定。
3. **浮动窗里视图自绘头**：现状是工作台的面板头（“消息”一行）加对话头（“星璃”一行）。浮动窗的外框来自 nb-layout（矩形、叠放、缩放手柄），头由工作台的 `WorkbenchPanelHead` 画；已有的“视图接管标题区”（[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 19）只给标题行里的三格，消息视图宽版交还了它（t15 决定 6）。改成浮动窗里内置视图可以自绘整个头：工作台不画标题行，视图画到顶、标出可拖的区域，框架按钮由工作台叠在右上角并告诉视图留多少位置，键盘移动与右键“移动到”仍归工作台。只对浮动窗，停靠时不变。

合同：[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md)（消息视图的版式）；[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 19 与 [`ui/workbench-layout.md`](../../../../../docs/specs/ui/workbench-layout.md) 输出 39（第 3 条要改）。

## 开发者的决定

1. 第 3 条按“浮动窗里自绘整个头、停靠不变”走（2026-11-25 答“同意”）；第 1 条直接做，第 2、3 条出静态稿，定了再写 Spec 与计划。
2. 评审板第 1 轮（开发者 2026-11-25，两题都按推荐）：浮动窗的头用自绘头（列表栏通到顶，对话头那一行就是窗口头，“回到停靠”在右上角、排在“⋯”后面，两栏第一行等高）；bot 与会话的切换用标题式（没有横线，当前页靠字重与颜色区分，未读数跟在“Bot”后面，收起按钮在这一行右端）。
3. 第 3 条的计划（[`plan.md`](plan.md)）三处待确认都按推荐（开发者 2026-11-25 答“都同意”）：框架按钮沿用悬停这块窗才显示；键盘用的标题按钮平时看不见、聚焦时显示在左上角；浮动窗窄于 600 像素（窄版）时也自绘头。
4. 评审板第 2 轮（开发者 2026-11-25，计划草稿 2 的三处取舍）：视图加载中、出错时浮动窗照常画面板头，就绪才自绘（`loading-head = ready`，没按推荐；就绪那一刻内容上移 32 像素，接受）；窄版自绘时标题按钮的 Enter 不开抽屉，抽屉只由头像列顶上的按钮开（`narrow-enter = noop`）；窗里加第二个标签或拿走时内容上边距直接换、不过渡（`second-tab = instant`）。

## 当前状态

- 2026-11-25 经 nbdev 新建。评审板第 1 轮（[`artifacts/review/index.html`](artifacts/review/index.html)）两题已答，见决定 2。草稿在草稿 worktree `.worktree/w00043-t18-drafts`（分支 `w00043-t18/drafts`，不合并），Lab 组件 `MessagesWindow`。
- **第 1、2 条已合入 master（`4606b9c95`）**：
  - 第 1 条 `f637471ae`：`AgentMessages` 的列表栏与聊天区改成 nb-layout `Splitter` 的两块面板；列表栏 200 到 420 像素、聊天区至少 320 像素，拖到 200 以内再过 40 像素收成头像列；宽度由宿主记在内存里（同收起状态，重开窗口回到 260）。
  - nb-layout 的两处改动：`SplitterPanelConfig` 加可选的 `overflow: "visible"`（面板一律裁切溢出，窄版的列表抽屉要从 52 像素的头像列那块面板里伸出去；用 `Teleport` 挪列表会丢焦点与滚动位置）；预览回到手势开始时的样子时补发一次 `gesture-update`（审查第 1 条）。API 报告、`CHANGELOG.md`、应用的 SDK 快照跟着更新。
  - 发布脚本 `eaf3d66ea`、`c88a69f5b`：nb-agent-ui 新增对 nb-layout 的发布依赖，只载源码包的 `release:check` 与 `release:publish` 的闸门原先把 nb-layout 当成不发布的包；`checkReleasePackages` 缺省认已首发的生成包。**下次发版时 nb-layout 要与 nb-agent-ui 一起提版本**（nb-agent-ui 用到了新的 `overflow`）。
  - 第 2 条 `55579e680`：`AgentMessagesList` 的 nb-ui `Tabs` 换成标题式的 `tablist`，收起按钮经插槽 `switch-end` 进这一行；中文标签写“Bot”。
  - 实现审查：Sonnet 9 条（阻断 1、重要 1、建议 7），[处理](evidences/impl-review-1-disposition.md)，修正 `c88a69f5b`。接受取舍、交开发者知悉的两条：头像列与列表在收起那一刻直接换、不随 280ms 的宽度过渡；视图窄、宽度被压着时拖一下，记着的宽度换成压过的值。
  - 验证：nb-layout bun 670 条、vitest 358 条；nb-agent-ui bun 301 条、vitest 225 条；应用 agent、bots、Lab 的 vitest 125 条、agent 与 SDK 的 bun 80 条；发布脚本 vitest 120 条、`packages.test.ts` 13 条；类型检查三个包；`api:check`。e2e：`lab-agent-ui` 的“消息视图的分栏”6 条，`agent-conversation`、`bots-chat` 32 条里 31 条一次过、“按状态换场景”一条（测试自己的请求被对端断开）单独重跑通过。合入前那一轮与两条归为原有或负载的失败见处理表末尾。
  - 变异检查：宽度回写、收起回写、面板不裁切、发布检查的缺省、补发预览（组件测试与 e2e 各一条），都有用例失败。第一版的窄版用例没看住“不裁切”（`click` 会先把行滚进被裁切的面板再点），改成按行中心 `elementFromPoint` 判断。
  - Spec（planned）：`22101b06b`，[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 消息视图一段。
- 第 3 条（浮动窗自绘头）：计划草稿 1 开发者已确认（决定 3）；设计审查（Sonnet）13 条，阻断 2、重要 8、建议 3，[报告](evidences/design-review-1.txt)、[处理](evidences/design-review-1-disposition.md)。按审查改成草稿 2（[`plan.md`](plan.md)），按钮画到窗口零件层、内容上移、拖动区由视图声明，三处取舍经评审板第 2 轮定了（决定 4），计划按它定稿。

- **第 3 条已合入 master（`9036f72d7`）**（分支提交 `21915a5c7`、`8f77e3d99`、`955335994`、`8b0081bf1`，审查修正 `e6a75201a`、`74f09b38c`、`a74fefe06`，两次并 master `ae5697f74`、`f44a5b153`）：
  - 工作台：视图声明 `VIEW_OWN_HEAD {band}`（与 `VIEW_HEAD` 一起读，不进 SDK）；只有一个标签的浮动窗、视图实例就绪时自绘：表面不画面板头、内容顶到窗口顶、圆上角，工作台在内容里盖一条高 band 的头（框架按钮在右上，悬停这块窗才显示；标题按钮透明，只在键盘聚焦时显示），经 `--workbench-own-head-inset-end` 告诉视图右边留多少。视图用 `data-window-drag` 标拖动区：按在区里、中间没有可交互元素时拖整个窗，右键空白开“移动到”。
  - 消息视图：浮动时对话头、头像列顶行、列表的切换行同高 40（`MESSAGES_HEAD_BAND` 一处定义；nb-agent-ui 在 `windowDrag` 时缺省也是 40），都是拖动区；窄版抽屉从头下面开。
  - 偏离计划：头不放窗口零件层，放在内容里（审查第 1 条：零件层里焦点、F6、当前面板都认不出它）；没有加 `WorkbenchSurface` 的 Lab 场景，改由产品 e2e 走真实外壳；浮出与停靠的飞行不跳在 e2e 里量不了（减弱动效），留给真实页面走查。顺带修了第 2 条的字号：标题式标签用的 `--text-base` 不存在，改成 `--text-sm`（13px，就是开发者此前看到的大小）。
  - 实现审查：Sonnet 8 条（重要 3、建议 5），[报告](evidences/impl-review-2.txt)、[处理](evidences/impl-review-2-disposition.md)；接受取舍 1 条：窄版抽屉开着时浮出，Esc 后焦点到 body。
  - 变异检查：拖动区的可交互判定、右边留位变量、单标签判据、圆上角、标题按钮只在键盘聚焦时显示，都有用例失败。最后一条第一版空过（鼠标浮出后焦点其实在 body），改成鼠标操作后由程序聚焦再断言。
  - 验证：e2e `agent-conversation`、`workbench-float`、`workbench-views`、`bots-chat` 83 条全过（最后一处修正后 `agent-conversation` 26 条、`lab-agent-ui` 的“消息视图的分栏”5 条再跑全过）；`lab-agent-ui` 的 714、735 两条单独过，572（角色模型选择器）在 master `94907df91` 的对照 worktree 上同样失败，归原有。
  - `lab-scenes`（临时滤掉 ThemeEditor 的原有 404 才跑得到版面比对）与同一 master 的对照逐条比：新场景多出“头像列顶上按钮的聚焦光晕被裁”（Lab 不给头高、按缺省 32 时按钮离列顶 2px），改成 `windowDrag` 时缺省 40 后消失；其余与 master 相同（切换行的光晕被裁是所有消息场景原有的）。
  - 开发服务上的真实页面（不减弱动效，`--sample`）：浮出与回到停靠的飞行逐帧单调（13、20 帧，没有回跳），按对话头空白拖窗挪了 (-60, +30)，回到停靠后自绘头与拖动标记都去掉，控制台没有报错与警告。

## 下一步

- 开发者 2026-11-25 指出停靠时消息视图的头与下面两栏接得突兀（面板头横穿整宽、下沿无线，头像列分隔线与气泡边框都在头下沿被切断；停靠画法第 3 条没动）。评审板第 3 轮（`dock-seam`）：现状、A 头下画线（推荐，只加在消息视图停靠时）、B 分隔线上下缩 8 像素，稿是真实页面注入样式截的，原图在本地 `shots/r3-dock/`。等答复后实施。
- 核对第 3 条 Spec 的 planned 标记并晋升（要开发者批准）。
