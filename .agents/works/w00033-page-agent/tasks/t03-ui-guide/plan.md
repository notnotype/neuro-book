# 实施计划：第一批 `ui`（快照、界面目录、截图与引导）

第二版：按计划审查（Opus、Sonnet 前端、Sonnet 整体）修订，审查的处理见 [evidences/plan-review-disposition.txt](evidences/plan-review-disposition.txt)。

## Context

- 为什么做：让应用内的 Agent 看懂用户当前的 NeuroBook 窗口，并能一步步高亮控件教用户操作（来源 w00032 t16 的讨论，w00033 的目标）。
- 依据：[t01 设计稿](../t01-design/design.md)第四稿、[t01 的决定 1 到 19](../t01-design/README.md)、[本 Task 的决定 1 到 3](README.md)、Spec [`agent/page-agent.md`](../../../../../docs/specs/agent/page-agent.md)（planned）、[开工前的实验](../t01-design/evidences/)。
- 已定：全局对象 `ui`，方法 `snapshot`、`find`、`screenshot`、`highlight`；不做动作（t02）、不做安全边界（t01 决定 10）；eval 审批两层不改（t01 决定 13）；不做指令，稳定名由控件的拥有者写（t01 决定 14 与本 Task 决定 1）；引导的下一步、进度、跳过、提问、`missed`（t01 决定 15、16）；界面目录不收菜单（t01 决定 19）；切片按功能分两轮（本 Task 决定 2）；选窗口只看会话的作品（本 Task 决定 3）。
- 工作方式：Work 分支 `feat/w00033-page-agent`、worktree `.worktree/w00033-page-agent`（已建、已装依赖）；每项上游改动单独提交；e2e 按“测试与业务并行”交 Sonnet 子代理在自己的 worktree 写（见“测试分工”）。

## 技术选型

| 问题 | 选用 | 否决 |
|---|---|---|
| 可访问名 | `dom-accessibility-api`（MIT，Testing Library 在用）；第 5 片先量 500 个元素的耗时，超预算就只给可交互元素与带名容器算名字 | 照抄 Playwright 的 `roleUtils`（依赖其内部模块） |
| 说明框定位 | `@floating-ui/dom`（MIT；锁文件里已有，经 reka-ui 间接依赖） | 自写定位（翻转、避让边界要重写一遍） |
| 截图 | `@zumer/snapdom`（MIT），放核心包单独的 `./capture` 入口 | modern-screenshot、html-to-image（实验 1：慢 10 倍以上、弹层缺失） |
| 目录搜索 | 命令面板现有的跨语言子序列打分，移进工作台的 `shared/` 后两边共用 | 新写分词匹配 |
| 参数与返回 | TypeBox（仓库已用） | — |
| 真实浏览器测试 | Playwright，`channel: "chrome"`（仓库约定，照 nb-layout 的 `e2e/`） | happy-dom（布局、命中检查、`popover` 都不真实） |

## 关键设计

### `packages/nb-runtime/src/remote/router.ts`

- 只改路由交给服务端自己节点的上游（构造函数里的 `Upstream`），不动 `node.ts`：
  - `request` 对 `INSTANCES_CONTRACT` 本地交回 `this.instances()`，与 `#routeRequest` 用同一个函数、同一份成员表。
  - `subscribe` 给 handlers 包一层，把 `disconnected` 改报 `target-gone`，与 `#routeSubscribe` 一致。服务端自己的上游是进程内的路由、从不重连，项目子进程的链路断开即实例结束，所以客户端与项目两种目标都这样结束（今天两种都会一直挂着）。
- 不变量：经路由转发的订阅、客户端作订阅方的重建不变；`ended` 标记保证与服务端自己取消同时发生时只结束一次（Opus 核过现有逻辑）。
- 测试用 `routing.test.ts` 的 `topology()`：服务端列实例与成员经路由查到的相同；服务端订阅窗口、窗口链路断开得 `target-gone`；同实例重连不重建、以 `target-gone` 结束；服务端订阅项目实例、子进程链路断开得 `target-gone`；客户端作订阅方断线重连后仍重建（回归）。

### 拥有者给出的只读目录与稳定名

- **设置**（`plugins/settings/`）：新的只读门面服务键（`shared/contracts.ts`），由设置窗口 `buildCatalog` 的落位结果投影：节（id、标题、是否页面节、支持的层、行键列表）、设置（键、标题、说明、所在节、支持的层）；只在桌面外壳显示的节、`other` 节、页面节、窗口是否绑定作品都按窗口自己的落位算。原来的 `settingsWindowSourceKey` 带写入口，不公开。
- **工作台**（`plugins/workbench/`）：界面目录读取服务（`shared/contracts.ts`）：视图（id、标题、所在容器 id、是否可见、标题栏动作的命令 id）、容器（id、标题、入口所在区域）、活动栏项（id、标题、命令 id），来自工作台已接收的贡献点与当前布局。`command-query.ts` 的 `matchCommandText`、`searchCommands` 移进 `workbench/shared/`（纯函数，无 DOM 类型）并由 contracts 导出，命令面板改用同一处。
- **稳定名**（本 Task 决定 1）：`TitleActions.vue`（命令按钮）、`WorkbenchToolStrip.vue` 与 `WorkbenchRegionStrip.vue`（活动栏项、容器入口、单视图入口）、多视图容器的视图标题头（`WorkbenchPanelHead`）、`SettingsWindow.vue`（层、节）、`SettingsRow.vue`（行）各加 `v-bind="nbTarget(…)"`；原有标记保留（拖动与 e2e 在用）。
- **悬停显示**：`hover-actions.css` 的隐藏规则加 `:not([data-nb-agent-reveal])`（现有规则的特异性高，另加一条盖不过它）。
- **对话视图**：nb-agent-ui 的消息列表根元素标 `data-nb-agent="skip"`；输入框、状态栏、会话面板不标。
- 不变量：都是只读接口；拥有者的现有行为与 e2e 不变。

### `packages/nb-page-agent/`（新包）

- 包：`private`、MIT，`exports` 指 `src`（照 nb-flock）；入口 `.`（引擎）、`./api`（TypeBox schema，无 DOM）、`./attrs`（`nbTarget`）、`./capture`（snapdom 截图）。依赖只有 `dom-accessibility-api`、`@floating-ui/dom`、`@zumer/snapdom`、`typebox`。登记：根 `AGENTS.md` 结构图、`packages/AGENTS.md`、`docs/modules/monorepo-boundaries.md`、`packages/neuro-book/src/architecture.test.ts` 的 `PACKAGE_SIDES`（主入口 `web`，`./api`、`./attrs` 为 `neutral`）、包 README（Owner、Interface、依赖方向、验证命令）。发布与否等 w00034 要用时再定。
- 不认识 NeuroBook：`./api` 只放页面里的概念（定位、快照、高亮的参数与页面结局、`stale-ref`、`ambiguous`、`not-found`）；`find`、窗口类失败码、`command` 定位由插件扩展（插件把 `{command}` 换成 `{target: "command", key}` 再交给引擎）。宿主注入：截图实现、界面文字表、悬停显示钩子 `reveal(target) → Element[]`、主题（CSS 变量 `--nb-page-agent-*` 加兜底值）。
- `src/snapshot/`：可见性（累乘不透明度、`faint`）、命中检查（中心退四角，分清被盖住与滚出；用 `elementsFromPoint` 跳过自己的节点，递归 open shadow root）、层、列表摘要、主名、转义、预算、字节上限（按 UTF-8 量）、跳过区域写占位行。
- `src/refs.ts`：加载前缀、单调发号、身份核对；同层重找只给不改页面的调用。
- `src/locate.ts`：扁平定位对象的校验与匹配（调用方把它放在 `at`、`of`、`scope`、`within`）。
- `src/guide/`：
  - 描边框与说明框：open shadow root、`popover="manual"`，重置 UA 的 popover 样式；挂进目标所在的层（按目标祖先链上的弹层与 top layer 判定）。每次重算检查是否还在页面上、那一层是否还在，变了就换到目标现在所在的层。
  - 不抢焦点：整个说明框在 `pointerdown`、`mousedown` 取消默认（提问框除外）。键盘隔离：说明框宿主在冒泡阶段截住 `keydown`、`keyup`、`keypress`、`beforeinput`、`input`；提问 Enter 提交（`isComposing` 时不提交），Esc 清空并还焦点；提交后焦点还给原来的元素。
  - 跟随：`ResizeObserver`、捕获阶段的滚动、DOM 变化（忽略自己的节点）；只在目标祖先链上有动画或过渡时逐帧更新，结束即停；结局时全部撤掉。
  - `highlight()` 交回 `{installed, outcome}` 两个 Promise 与 `cancel()`；引擎另报当前在等的高亮数，插件据此处理 `replaced`。
- `src/capture.ts`（`./capture`）：snapdom 重画、缩放、WebP（不支持时 JPEG）编码与大小上限。
- `e2e/`：夹具页只测与具体弹层库无关的规则（原生与 ARIA 控件、open shadow root、遮挡层、嵌套滚动、以 index 为 key 的列表、500 元素的性能页）；真实弹层的用例放应用 e2e。

### `packages/nb-harness/src/kernel/`

- `ToolContext.waitingForUser<T>(promise)`：嵌套调用里在 promise 未结算期间向父工具报 `onWaiting(true)`，结算或取消时报 `false`。`invokeNested` 记下每次嵌套调用未收回的等待，调用结算时（`writeResult` 或 attempt 的 `finally`）补齐 `false`：提供方被撤回、promise 永不结算时计时也能恢复。
- 锁不变：等用户期间仍占着它的并发名额，写进 `harness/runtime.md`。
- 不加 `foreground` 声明：前台过滤在 agent 插件做（下一节）。

### `packages/neuro-book/src/plugins/agent/`

- 失败详情：`agent.tools` 声明加可选 `errors: {[code]: schema}`，与 `returns` 对称；只有声明了的码、且 `details` 通过校验、按 JSON 序列化后至多 8 KB 时，才交给代码里的 `ToolCallError.details`。文档按声明列出失败码与形状。
- `tsType`：没有任何字段带说明或缺省时保持单行；否则换行缩进，加字段的 JSDoc（说明里的 `*/` 写成 `*\/`、换行折成空格）。现有 `objects.test.ts` 与 SDK 场景 `10-eval-object` 的断言不变。
- 前台过滤：`agent.tools` 声明加 `foreground: true`（`points.ts` 的 schema、`tools.ts` 的 `#declaration` 透传、SDK 类型、`contributions.md`）。`agent.ts` 在 `forProfile` 的调用处按 `context.background` 或 `context.owner` 去掉这些工具，eval 说明、代码的全局对象与内核工具表用同一份结果。
- 按对象绑定：绑定加 `objects: {added, removed}`，`profileToolIds` 先展开对象（含以后新增的方法），再套方法级的增减；页面只给对象行，旧的方法级条目在动对象行时去掉。旧版本读到新字段的处理写进 `profile-settings.md` 的已知限制。
- Profile 页的对象行：名字、档位、说明、去掉与加回、恢复默认、计数、已卸载、没有 `eval` 时怎样显示，按静态稿定稿后写进 `profile-settings.md`。定位：行 `data-profile-tool-object="ui"`，去掉按钮沿用 `data-profile-tool-remove`。

### `packages/neuro-book/src/plugins/page-agent/`（新内置插件 `nbook.page-agent`）

- 接线：`src/manifest.ts` 的 `productPlugins`、`src/server/plugins.ts`、`src/web/plugins.ts`、`src/server/server.test.ts` 的插件列表、`vite.config.ts` 的 `optimizeDeps.include`（三个新依赖与用到的子路径）、locales、第三方许可清单核对。
- `shared/contracts.ts`：窗口合同 `nbook.page-agent/window`（provider client、callers `["server"]`）：`info()`、`snapshot`、`find`、`capture({token})`，以及订阅 `highlight`，载荷是判别联合 `installed`、`outcome`、`failed`（带码与 `details`）。输出 schema 写字符与条数上限作兜底，字节上限由窗口回复前按 UTF-8 量并截断。
- `backend/`：
  - 工具：`agent.evalObjects` 登记 `ui`；四个方法工具各声明 `global: {object: "ui", method}`、`defaultForAll`、`shared`。`snapshot`、`find`、`highlight` 为 read，`screenshot` 为 exec 并交判定对象。第 7 片之后加 `foreground` 与 `errors`。
  - 选窗口：`instances()` 按会话的作品筛选，再并发问 `info()`（每个 800 毫秒）。通道失败按 Spec 输出 14 换算。会话小表只在内存里，带条数上限。
  - 截图上传：路由 `PUT /api/nbook.page-agent/captures/<token>` 按 Spec 的截图状态表实现。凭证签发在审批之后、20 秒到期，调用的 signal 触发或插件停止时连同暂存一起作废。按流读取，超过 512 KB 得 413，作废或到期的凭证得 410；另做来源检查与类型、尺寸校验。
  - 高亮：先建好“只结算一次”的结局，再 `subscribe`。收到 `installed` 才调 `waitingForUser`；收到 `outcome` 或 `failed`，或 `onEnd` 按输出 14 换算后，就结算并 `release()`（任何结局都 release）。`timeout` 由服务端以注入时钟计；插件停止时把在等的高亮以 `window-gone` 结算。
- `web/`：
  - 浏览器入口随窗口启动激活，`info()` 只读焦点、可见性与最近一次真实输入的时刻，不碰引擎。
  - 引擎经 `.vue` 门面在空闲时预加载（后端 tsc 不检查 DOM，见 `packages/neuro-book/AGENTS.md`）。
  - 界面目录由三处拼出：设置门面、工作台目录服务、命令服务的 `list()` 与 `isEnabled()`；打分取自工作台的 `shared/`。
  - 宿主注入：文字表、主题变量映射、`reveal` 用 `closest("[data-hover-actions]")`。

## Spec 与文档改动（第 1 片，planned）

- `docs/specs/agent/page-agent.md`：已按审查改到第二版。
- `docs/specs/runtime/plugin-channel.md`：输出 7 补“服务端作订阅方时，目标成员的链路关闭即以 `target-gone` 结束、不重建”；输出 8 补“服务端插件调用时由路由本地回答，与成员经路由查到的相同”；验收补两例。
- `docs/specs/harness/runtime.md`：`waitingForUser`（嵌套调用结算时一定收回）；等用户期间仍占并发名额。
- `docs/specs/agent/eval.md`：输出 14 的“等用户应答”加上嵌套工具自报的等待；`ToolCallError.details` 只来自声明了 `errors` 的工具；文档签名带字段说明与失败码。
- `docs/specs/agent/contributions.md`：`agentTool` 的 `foreground` 与 `errors`。
- `docs/specs/agent/profile-settings.md`：对象行与绑定的 `objects`（对象行的界面规则在静态稿定稿后补）。
- `docs/specs/settings/settings-window.md`：公开的只读设置目录；`docs/specs/workbench/views.md`：界面目录读取服务、稳定名、悬停显示属性；`docs/specs/ui/agent-conversation-view.md`：消息列表的 skip 标记。
- 包与结构：根 `AGENTS.md` 结构图、`packages/AGENTS.md`、`docs/modules/monorepo-boundaries.md`（新包的 `private`、许可证与入口写法）。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| 1 | 上面的 Spec 与文档改动（planned） | `bun run docs:check`、`bun run governance:check` |
| 2 | 静态稿：说明框（亮暗两套、中英两种语言、普通页与小弹层；普通、带进度与下一步、提问中、目标滚出四种状态）与 Profile 页 `ui` 对象行；`@designer` 顾问；评审板交开发者，与第 3 到 6 片并行 | `nbdev artifact publish` 的解析结果 |
| 3 | nb-runtime：服务端列实例、服务端订阅窗口时的结束 | `bun test packages/nb-runtime/src/remote`；nb-runtime 的 typecheck |
| 4 | 拥有者：设置目录门面、工作台目录服务与打分移进 `shared/`、稳定名、悬停显示规则、消息列表的 skip（各自提交） | 各插件受影响的测试与 dom 测试、`bun test src/architecture.test.ts`、应用 typecheck |
| 5 | 核心第一段：`./api`、快照、引用、定位、`./attrs`；先量名字计算 | 包的 bun 单测、Playwright 夹具测试、typecheck |
| 6 | 插件第一段：接线、合同、窗口一侧、选窗口、`snapshot`、`find`、`screenshot` 与上传路由，贯通到真实应用；之后派第一段 e2e | 插件测试（真实服务端与窗口）、`architecture.test.ts`、应用 typecheck、`build:web`、一份主会话手写的最小贯通脚本 |
| 7 | agent 插件与 harness：失败详情与 `errors`、`tsType`、前台过滤、`waitingForUser`（各自提交） | agent 插件与 nb-harness 受影响的测试、SDK 场景 `10-eval-object`、两边 typecheck |
| 8 | 核心第二段：说明框（按定稿）、跟随、结局、键盘隔离、截图入口 | 包的 Playwright 夹具测试；变异检查 |
| 9 | 插件第二段：高亮订阅与等待、服务端计时、按对象绑定与 Profile 对象行；之后派第二段 e2e | 插件测试、应用 typecheck、三份构建后跑 `page-agent.e2e.ts` 与 `agent-profiles.e2e.ts` |
| 10 | 真实模型冒烟、开发服务上点一遍、文档收尾、逐条核对 Spec 后晋升 | `test:llm` 跑 `page-agent.llm.test.ts`；`docs:check`、`governance:check` |

第 2 片交开发者后就做第 3 片；第 8 片等第 2 片定稿；第 9 片依赖 3 到 8。

## 验收映射

| Spec | 覆盖 |
|---|---|
| `agent.page-agent` 输出 1、2、14 | 插件测试（按作品筛选、会话小表、焦点、最近输入、2 分钟、子会话、换算表逐行一例）；e2e 场景 2 |
| 输出 3、5 | 核心夹具测试；e2e 场景 5 |
| 输出 4 | 核心夹具测试（index 为 key 的列表反序、加载前缀、`rebound`）；e2e 场景 3 |
| 输出 6 | 拥有者的 dom 测试（属性在）；e2e 场景 1 |
| 输出 7 | 设置门面与工作台目录服务的单测；插件 web 的单测（目录拼装与路径）；e2e 场景 1 |
| 输出 8 | 插件测试（上传路由、凭证状态表的每一格、提交点、大小）；e2e 场景 4 |
| 输出 9、10 | 核心夹具测试（结局、`missed` 排除、跟随、重挂）；e2e 场景 6（真实弹层、键盘隔离） |
| 输出 11 | harness `invoke.test.ts`（等待计数、提供方撤回后收回、`exclusive` 排在后面）；插件测试（装上之前计时、服务端计时）；e2e 场景 7 |
| 输出 12 | 核心与插件单测（字节上限、`details`）；e2e 场景 5 |
| 输出 13 | agent 插件 `objects.test.ts`（用 `ui` 的真实 schema 生成文档快照） |
| 输出 15 | e2e 场景 8 |
| 输入与前置条件（前台过滤） | agent 插件测试（后台与 bot 会话的说明与全局对象里都没有）；e2e 场景 9 |
| 场景 1 到 9 | `packages/neuro-book/e2e/page-agent.e2e.ts` |
| 失败码表 | 各码在核心或插件测试里各有一例 |
| `plugin-channel` 输出 7、8 的新验收 | `nb-runtime/src/remote/routing.test.ts` |

## 验证

- **每片**：上表的命令；改了测试或 e2e 后重跑 typecheck。
- **开工前基线**：在起点上跑 `agent-profiles.e2e.ts`（第 9 片会改到它覆盖的页面）。
- **收口**：`bun run test:affected --since master`；`page-agent.e2e.ts` 与 `agent-profiles.e2e.ts` 各一次；`docs:check`、`governance:check`。
- **变异检查**（先提交再改，恢复用 `git show HEAD:<文件>`）：
  - 快照与引用：引用前缀、身份核对、跨层重找、转义、字节上限、命中检查跳过自己的节点。
  - 说明框：`missed` 的排除、不抢焦点、键盘隔离、挂进弹层与重挂。
  - 高亮与等待：订阅取消时撤高亮、服务端计时、`waitingForUser` 的收回（含提供方撤回）。
  - 服务端：订阅在成员断开时结束、按作品筛选、调用结束后拒收上传、前台过滤。
- **真实浏览器**：
  - 核心与应用 e2e 都在真实 Chrome；跟随与等待另有几条用例不减弱动效。
  - 暗色主题的截图对照由主会话看图；悬停显示与真实 Chrome 刷新时的订阅在第 9 片各补一条用例。
  - 第 10 片在开发服务上真实点一遍引导（开发构建的动态加载与过渡只有这里看得到）。
- **未验证边界**：多使用主体；桌面外壳的真实截图；菜单里的命令；不在悬停动作区里的悬停控件。

## 测试分工

- **主会话**：业务代码与跟设计绑在一起的单测（快照规则、引用、定位、结局判定、上传路由、选窗口、内核与 harness 的改动）；暗色主题看图、开发服务上点一遍、变异检查与最终验证。
- **Sonnet 子代理**：在自己的 worktree 里写，从 Work 分支开，只改测试、辅助函数与夹具页。
  - 第一段（第 6 片之后派）：核心夹具测试（输出 3 到 6）；应用 e2e 场景 2、3 的引用部分、4、5、8。
  - 第二段（第 9 片之后派）：核心夹具测试（输出 9、10 里与弹层无关的）；应用 e2e 场景 1、3 的高亮部分、6、7、9；Profile 对象行的用例。
- **双方照的可观察状态**：
  - 快照文本的行格式（Spec 输出 3）。
  - 引擎自己的节点都带 `data-nb-page-agent`：`callout`、`outline`、`next`、`skip`、`ask`（输入框）、`ask-submit`。说明框带 `data-nb-page-agent-target`（引用或 `target:key`）与 `data-step`；隐藏时带 `data-hidden`。
  - 说明框在 open shadow root 里，焦点在提问框时读 `shadowRoot.activeElement`。
  - 撤掉之后页面上没有 `[data-nb-page-agent]` 节点，也没有 `[data-nb-agent-reveal]` 属性。
  - Profile 对象行 `data-profile-tool-object="ui"`。

## 不做与风险

- 不做：第二批（t02）；安全边界；菜单进目录；截图叠编号；引导脚本；不在悬停动作区里的悬停控件。
- 风险：
  - 上游改动跨六处（nb-runtime、nb-harness、agent、设置、工作台、nb-agent-ui），每项单独提交、单独测；内核那处的测试用真实路由与链路。
  - 说明框挂进弹层依赖弹层的 DOM 与事件处理：命令面板、下拉、下拉菜单、设置窗口的用例放在应用 e2e，用真实组件。
  - 第一次调用的时限：浏览器入口随窗口激活、引擎空闲时预加载，e2e 场景 8 兜底。
  - 绑定存储加字段后，旧版本读新设置的行为写进已知限制。
  - token：冒烟时记请求数与输入 token，对照调研里薄接口的量级。
