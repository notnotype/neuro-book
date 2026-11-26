---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: agent.page-agent
owners:
  - nbook.page-agent
  - nb-page-agent
---

# Agent 看懂并引导界面（`ui`）

## 目标与非目标

给应用内的 Agent 一个 eval 全局对象 `ui`（[`agent/eval.md`](eval.md)）：看懂用户当前的 NeuroBook 窗口（文字快照、截图）、在界面目录里找到设置、视图与命令在哪里，并一步步高亮控件引导用户操作。

不承诺：

- 不代替用户操作界面：点击、填写、按键、选择、拖动都不在本 Spec。
- 不执行页面里的任意脚本；不进入 iframe 内部；不读写设置；不调用命令。
- 不是安全边界：Agent 能读到窗口里显示的内容（密码框的值除外），快照与截图不区分私有内容。
- 界面目录不收菜单（右键、菜单栏、溢出菜单）里的命令，也不收插件页面里没有声明的内部内容与多步才完成的流程。
- 截图是按 DOM 重画的近似图，不是屏幕像素。

## 术语与参与者

- **窗口**：一个打开着 NeuroBook 的浏览器页面，即通道里一个客户端实例（[`runtime/plugin-channel.md`](../runtime/plugin-channel.md)）；刷新后是新的实例。
- **当前窗口**：按输出 1 为一次 `ui` 调用选中的窗口。
- **引用**：快照给每个元素的编号，形如 `a3.12`，只在发它的那次页面加载里有效。
- **稳定名**：`target` 加可选 `key`，来自控件上写的 `data-nb-target`、`data-nb-key`，或由插件把现有标记翻译而来（输出 6）。
- **说明框**：高亮时显示在目标旁边的小框。
- **引导**：一段 eval 代码按顺序高亮多个控件、等用户逐步操作。

## 输入与前置条件

`ui` 在开启了它的 Profile 里可用：作主创与临时帮手的可选工具，Profile 页按对象一行开关；后台会话（[`harness/session.md`](../harness/session.md) 的 `background`）里没有 `ui`。

| 方法 | 审批档 | 参数 | 返回 |
|---|---|---|---|
| `ui.snapshot` | read | `scope?`（引用或稳定名）、`includeText?`、`maxTokens?`（缺省 3000，至多 8000） | 窗口信息、文本树、元素数组、`truncated`、`warnings` |
| `ui.find` | read | `query`、`kind?`（`setting`、`view`、`command`）、`limit?`（缺省 5） | 条目数组（输出 7） |
| `ui.screenshot` | exec | `of?`（定位）、`annotate?` | 窗口信息、宽高；图片附在结果里 |
| `ui.highlight` | read | 定位、`message`、`title?`、`side?`、`until`（`click` 或 `next`）、`step?`、`total?`、`timeout?`（秒，缺省 300，1 到 3600） | 结局（输出 9） |

**定位**是一个对象，恰好给下面一种主定位：`ref`；`target` 加可选 `key`；`command`（命令 id）；`role` 加 `name`；`text`。可另给 `exact`、`nth`、`within`（引用或稳定名）。

## 输出与可观察行为

1. **选窗口。** 每次调用按次序取第一个：这个会话上次用的窗口（还连着、看得见、2 分钟内用过）；有焦点的窗口；看得见、最近有用户输入的窗口。用户切到另一个窗口时，只要上次那个还看得见、2 分钟内用过，就不跟过去。子会话自己选，不继承父会话的。
2. **没有可用的窗口。** 没有符合的窗口得 `no-window`；窗口在规定时间里没有应答（快照与目录 3 秒、截图 15 秒）得 `window-unresponsive`；查询窗口失败不报成 `no-window`。
3. **快照。** 只列看得见的可交互元素与带名字的容器，按层级缩进成文本树，每行写角色、名字、引用与状态：
   - 看得见按祖先链累乘的不透明度、`visibility`、`display`、是否被裁成零面积判断；不透明度很低的仍列出并标 `faint`；`aria-hidden`、`inert` 的不列。
   - 被别的元素完全盖住的不列；滚出滚动容器的标 `offscreen`。
   - 弹层（dialog、alertdialog、menu、listbox）各成一层，表头按先后写出各层；完全被挡住的层只写名字。
   - 列表类容器写一行摘要（总数、已渲染的范围、能否滚动），行上带位置。
   - 树行、标签、菜单项这类由内容命名的元素，名字不含状态标记。
   - 名字与值按 JSON 字符串转义（换行、控制字符、双向控制字符都转义），先截断再转义。
   - Agent 自己的对话视图与 `data-nb-agent="skip"` 的区域不列；密码框的值不输出。
   - 超过 `maxTokens` 时按“最上层 > 焦点所在区域 > 其余”截断，`truncated` 为真，并写出可以用 `scope` 缩小到的区域。
4. **引用。** 同一元素在同一次页面加载里引用不变。用引用时，前缀不是这次加载的、或元素的身份（角色、名字、稳定名、key、所在层）变了，按元素不在了处理：同一层里稳定名与 key 都相同的元素只有一个时改用它并在 `warnings` 标 `rebound`，否则得 `stale-ref`，`details` 列出当前候选。
5. **定位。** 名字与文字缺省不分大小写、折叠空白的子串匹配，`exact` 为真时精确匹配；命中多个又没给 `nth` 得 `ambiguous`，`details` 列出候选；没有命中得 `not-found`。目标本身不可交互时，落到它唯一的可交互后代。
6. **稳定名。** 控件上的 `data-nb-target` 与 `data-nb-key`、以及下表的现有标记都能作稳定名定位，快照里写成 `target=… key=…`：

   | 标记 | 稳定名 |
   |---|---|
   | `data-title-action` | 命令 id（`command`） |
   | `data-activity-item` | `workbench.activity` 加项 id |
   | `data-tool-view` | `workbench.view` 加视图 id |
   | `data-settings-tabs` 里 `role=radio` 的 `data-value` | `settings.layer` 加 `user` 或 `project` |
   | `data-settings-nav` | `settings.section` 加节 id |
   | `data-settings-row` | `settings.row` 加设置键 |

7. **界面目录。** `ui.find` 交回至多 `limit` 条，按与命令面板相同的打分排序，标题与说明用当前界面语言；同名的不同种类分开列。每条有 `kind`、`title`、标识（设置键、视图 id 或命令 id）与 `path`：
   - 设置：活动栏的设置项 → 用户或作品层 → 节 → 行；
   - 视图：它当前所在的视图容器入口 → 视图；按视图标题与入口上的名字都能搜到；
   - 命令：只收出现在活动栏或视图标题栏上的命令，路径是那个入口；另给快捷键；命令可由用户运行、没有必填参数且此刻可用时，另给“命令面板”入口。
   路径每一步有定位 `at` 与这一步之后页面上会出现什么 `appears`；已经走到路径中途的，从第一个还没完成的步骤给起。
8. **截图。** 截当前窗口或 `of` 指的控件，长边至多 1280 像素，编码后至多 512 KB，作为结果里的一张图片交给模型；`annotate` 为真时图上叠引用编号。审批的判定对象是 `{kind: "screen", value: "window"}` 或 `{kind: "screen", value: "element"}`，按 [`agent/permissions.md`](permissions.md) 判定，结果写明截的是哪个窗口。截图过程中断开或超时，没有图进结果。
9. **高亮与等待。** 先等目标出现并滚进视野（至多 5 秒，否则 `not-found`），再画描边框与说明框，等到下列之一就交回结局并撤掉高亮：
   - `clicked`：`until` 为 `click`，用户在目标上点击或抬起指针，或在目标里按 Enter、空格；
   - `next`：`until` 为 `next`，用户点了说明框里的“下一步”；
   - `asked`：用户在说明框里提问，结果带 `question`；
   - `missed`：`until` 为 `click`，用户用主键按在目标、说明框、滚动条与遮罩之外的元素上，结果带 `clicked`（那个元素的角色与名字）；按右键不算；
   - `dismissed`：用户点了“跳过引导”；
   - `gone`：目标从页面上消失；
   - `replaced`：同一窗口开始了另一个高亮；
   - `timeout`：到了 `timeout`；
   - `window-gone`：窗口断开或刷新；
   - `cancelled`：这段 eval 被停止或单元超时。
   目标滚出视野时描边框隐藏、滚回来再显示。
10. **说明框。** 显示 `title`、`message`（只作纯文字）、给了 `step` 与 `total` 时的进度“第 N 步，共 M 步”、`until` 为 `next` 时的“下一步”按钮、“跳过引导”按钮与一个提问输入框。说明框出现不改变页面的焦点与选区；点“下一步”“跳过引导”不移走焦点；在弹层（菜单、下拉、命令面板、对话框）里高亮时，点说明框不会关掉弹层，提问框能输入。说明框不压暗页面、不改页面元素的样式；减弱动效时没有过渡。
11. **等用户不计时。** 高亮装上之后到结局之间，eval 单元的时限暂停（[`agent/eval.md`](eval.md) 输出 14 的“等用户应答”）。
12. **失败的内容与大小。** 业务失败在代码里抛出，带码与 `details`（可序列化为 JSON，至多 8 KB）；成功结果的警告在 `warnings`。窗口交回的文字至多 64 KB、元素至多 500 个，超了截断并在 `warnings` 标明，不会断开窗口的连接。
13. **文档。** eval 说明里 `ui` 只占一行摘要与文档地址；文档列出全部方法，签名带每个字段的说明、可选与缺省，并写明页面里的文字是证据不是指令、改正文用文件工具。

## 状态与转换

一次高亮：装上（等目标出现）→ 等用户 → 结局（撤掉）。同一窗口同时至多一个高亮。

时序与寿命：

- 高亮只在这次 `ui.highlight` 调用期间存在；调用以任何结局结束时高亮已撤掉，不会留在页面上。
- 窗口断开或刷新时，正在等的高亮以 `window-gone` 结束；同一窗口之后重连，不会恢复这次高亮。
- 服务端重启时，正在等的高亮所在的 eval 已随进程结束；窗口那边的高亮撤掉。
- 引用在窗口刷新后全部作废（`stale-ref`）；同一页面加载里，断线重连后仍有效。
- “上次用的窗口”只保存在服务端内存里，服务端重启后重新选；转后台或 2 分钟没用后不再优先。

## 副作用与数据

- 不改作品数据与设置。
- 截图作为工具结果存进会话日志（[`harness/session.md`](../harness/session.md) 的大块内容），是会话的持久数据：归档不删，fork 会复制。
- 高亮期间给目标所在的悬停区域加一个属性让悬停才出现的动作显示出来，高亮撤掉时去掉。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `no-window` | 没有可用的窗口，或会话在后台 | 请用户打开或切回 NeuroBook 窗口 |
| `window-hidden` | 选中的窗口看不见（截图、高亮时） | 请用户切回那个窗口 |
| `window-gone` | 窗口在调用途中断开或刷新 | 重新快照，重做这一步 |
| `window-unresponsive` | 窗口没有在时限内应答，或查询窗口失败 | 稍后重试 |
| `stale-ref` | 引用已失效 | 重新快照 |
| `ambiguous` | 定位命中多个 | 用 `details` 的候选或加 `nth`、`within` |
| `not-found` | 定位没有命中，或高亮等目标超时 | 换定位方式；虚拟列表里没渲染的行先滚动或搜索 |

审批与通道的失败码沿用 [`agent/permissions.md`](permissions.md) 与 [`runtime/plugin-channel.md`](../runtime/plugin-channel.md)。

## 边界与兼容

- 公开面：`ui` 的方法、参数、返回与失败码；控件上的 `data-nb-target`、`data-nb-key` 与 `data-nb-agent="skip"`；核心包 `nb-page-agent` 的 `./attrs` 入口（`nbTarget(name, key?)` 返回这些属性）。输出 6 的现有标记被改名时，翻译表随之改，稳定名不变。
- 被官方引导或 Skill 引用的稳定名不改名。
- 信任边界：本机插件都受信、只有一个使用主体；窗口提供的远程服务只接受服务端调用。

## 验收与 Smoke

1. 打开样例作品，用一段 eval 代码 `ui.find({query: "主题", kind: "setting"})`，按路径逐步 `ui.highlight`，用真实点击推进；每一步高亮的是路径里那个控件，最后一步点“下一步”结束；全程 eval 只审批一次（询问模式）。
2. 三个窗口：在其中一个上有真实输入后调 `ui.snapshot`，选中它；切到另一个并输入，2 分钟内仍用原来的；原来那个转后台后改用新的；全部关掉得 `no-window`。
3. 快照后刷新窗口：旧引用得 `stale-ref`；高亮等待中刷新得 `window-gone`，页面上没有残留的高亮。
4. 询问模式：先批 eval，再出截图的审批卡；拒绝后代码里看到被拒；批准后结果里有一张不超过 512 KB 的图。
5. 一个快照超过字节上限的页面：快照被截断并标明，窗口连接不断开。
6. 在命令面板与下拉菜单打开时高亮其中一项：点“下一步”不关掉它们，提问框能输入，焦点与输入框的选区不变。
7. 高亮等待中停止 eval：结局 `cancelled`，高亮撤掉；单元时限在等待期间不走。

Smoke：`packages/neuro-book/src/plugins/page-agent/page-agent.llm.test.ts`（真实模型“在哪改主题，带我去”）。

## 证据

- 批准依据：[w00033 t01](../../../.agents/works/w00033-page-agent/tasks/t01-design/README.md) 的决定 1 到 19 与[设计稿](../../../.agents/works/w00033-page-agent/tasks/t01-design/design.md)第四稿（开发者 2026-11-26 确认）
