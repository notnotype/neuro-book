# 实施计划：第一批 `ui`（快照、界面目录、截图与引导）

## Context

- 为什么做：让应用内的 Agent 看懂用户当前的 NeuroBook 窗口，并能一步步高亮控件教用户操作（w00032 t16 的需求，w00033 的目标）。
- 依据：[t01 设计稿](../t01-design/design.md)第四稿（实验后修订）、[t01 的决定 1 到 19](../t01-design/README.md)、Spec [`agent/page-agent.md`](../../../../../docs/specs/agent/page-agent.md)（planned，本计划第 1 片补齐相关 Spec 的 planned 条目）、[开工前的实验](../t01-design/evidences/)。
- 已定：全局对象 `ui`，方法 `snapshot`、`find`、`screenshot`、`highlight`；不做动作（t02）、不做安全边界（决定 10）；eval 审批两层不改（决定 13）；不做指令，名字两层（决定 14）；引导的下一步、进度、跳过、提问、`missed`（决定 15、16）；界面目录不收菜单（决定 19）。
- 工作方式：Work 分支 `feat/w00033-page-agent`、worktree `.worktree/w00033-page-agent`；每片一个提交；大型任务按“测试与业务并行”，e2e 交 Sonnet 子代理在自己的 worktree 写（见“测试分工”）。

## 技术选型

| 问题 | 选用 | 否决 |
|---|---|---|
| 可访问名 | `dom-accessibility-api`（MIT，Testing Library 在用），新依赖进 `nb-page-agent` | 照抄 Playwright 的 `roleUtils`（依赖其内部模块） |
| 说明框定位 | `@floating-ui/dom`（MIT），新依赖进 `nb-page-agent` | 自写定位（翻转、避让边界要重写一遍） |
| 截图 | `@zumer/snapdom`（MIT），新依赖进 `nb-page-agent`，第一次截图时动态加载 | modern-screenshot、html-to-image（实验 1：慢 10 倍以上、弹层缺失） |
| 目录搜索 | 复用工作台命令面板现有的跨语言子序列打分（抽成可调用的函数） | 新写分词匹配 |
| 参数与返回 | TypeBox（仓库已用） | — |
| 真实浏览器测试 | Playwright（仓库已用，照 nb-layout 的 `e2e/`） | happy-dom（布局、命中检查、`popover` 都不真实） |

## 关键设计

### `packages/nb-runtime/src/remote/`（router.ts、node.ts）

- 服务端节点（上游是路由）调 `instances()`：由路由本地回答同一份成员目录，不再得 `target-gone`。
- 服务端节点向成员发起的订阅：成员链路关闭时以 `onEnd(target-gone)` 结束，与经路由转发的订阅一致（实验 7 情形 3、5）。
- 不变量：现有经路由的订阅与窗口作订阅方的重建语义不变。补 `routing.test.ts` 用例（实验 7 的 `harness.ts` 可作起点）。

### `packages/nb-harness/src/kernel/`（api/tool.ts、run/tools.ts、run/control.ts）

- `ToolContext.waitingForUser<T>(promise: Promise<T>): Promise<T>`：嵌套调用里，promise 未结算期间向父工具报 `onWaiting(true)`，结算或调用被取消时报 `false`，只报一次；顶层调用里是透传（顶层本就不计时）。
- 工具声明 `foreground?: true`：后台会话的工具表与 eval 对象里没有它；后台会话的代码调它得 `unknown-tool`（与没装同样）。
- 不变量：`onWaiting` 计数成对；取消早于或晚于 promise 结算都只收回一次。

### `packages/neuro-book/src/plugins/agent/`

- `backend/eval/kernel-entry.ts`、`backend/eval/tool.ts`：工具失败的 `details` 经 `replyOf` 交给代码里的 `ToolCallError.details`（JSON、至多 8 KB，超了丢掉并在文字里说明）。
- `backend/eval/objects.ts` 的 `tsType`：打印字段说明（JSDoc 注释）、可选、缺省；签名换行缩进。
- 工具绑定按 eval 对象开关：Profile 设置里存被关掉的对象名（不存方法 id，之后新增的方法跟随对象）；`profileToolIds` 按对象过滤；Profile 页（`web/profile-view.ts`、`profile-page.ts`）把同一对象的方法显示成一行开关。
- 对话视图根元素标 `data-nb-agent="skip"`（`ConversationHost.vue`、`MessagesHost.vue`）。

### `packages/neuro-book/src/plugins/settings/`

- 设置窗口的数据源（`web/window-source.ts` 的 `sections()`、`settings()`）给出一个公开的只读服务键（放进 `shared/contracts.ts`），其他插件可读全部分节与设置声明（标题与说明按界面语言）。

### `packages/neuro-book/src/plugins/workbench/`

- 视图当前位置的只读服务：给出视图 id → 所在容器、容器入口的标识（`data-tool-view` 的值）、是否可见。
- 悬停样式（`web/components/hover-actions.css`）加 `[data-hover-actions][data-nb-agent-reveal]` 时不透明；属性由页面引擎在高亮期间加、撤时去掉。

### `packages/nb-page-agent/`（新包）

- 布局照 `nb-flock` 的包写法（`exports` 指 `src`），入口：`.`（引擎）、`./api`（TypeBox schema，无 DOM）、`./attrs`（`nbTarget`）。依赖只有 `dom-accessibility-api`、`@floating-ui/dom`、`@zumer/snapdom`、`typebox`。登记进根 `AGENTS.md` 的结构图、`packages/AGENTS.md` 与 `docs/modules/monorepo-boundaries.md` 的当前布局，并按 Module 合同写 README（Owner、Interface、依赖方向、验证命令）。
- `src/api/`：四个方法的参数与返回、失败码、`details` 形状；由它派生工具的 `parameters`、`returns` 与窗口合同的输入输出（对象形状）。
- `src/snapshot/`：可见性（累乘不透明度、`faint`）、命中检查（中心退四角，分清被盖住与滚出）、层（角色认层根、命中判先后）、列表摘要、主名、转义、预算（估算 token，按优先级截断）、字节上限；跳过 `data-nb-agent="skip"` 与自己的节点。
- `src/refs.ts`：加载前缀、单调发号、身份核对、同层重找。
- `src/locate.ts`：扁平定位的校验与匹配；稳定名的读取（`data-nb-target`、`data-nb-key`，以及宿主给的映射表）。
- `src/guide/`：描边框与说明框（`popover="manual"`，挂进最上层弹层的子树，没有弹层时挂 body；`adoptedStyleSheets`；按钮在 `pointerdown`、`mousedown` 取消默认）；跟随（`ResizeObserver`、捕获滚动、DOM 变化、动画期间逐帧）；结局判定（`click` 与 `pointerup` 用 `closest`、Enter 与空格、`missed` 的排除条件）；目标滚出时隐藏；减弱动效。
- `src/capture.ts`：snapdom 重画、缩放、WebP（不支持时 JPEG）编码与大小上限；`annotate` 叠编号。
- `e2e/`：自带夹具页（原生与 ARIA 控件、shadow root、遮挡层、嵌套滚动、以 index 为 key 的列表、弹层样机），Playwright 用 `/usr/bin/google-chrome-stable`。

### `packages/neuro-book/src/plugins/page-agent/`（新内置插件 `nbook.page-agent`）

- `shared/contracts.ts`：窗口合同 `nbook.page-agent/window`（provider client、callers `["server"]`）：`info()`、`snapshot`、`find`、`capture({token})`、订阅 `highlight` 推结局事件；输出 schema 写字节与条数上限。
- `backend/`：`agent.evalObjects` 登记 `ui`；四个方法工具（`global: {object: "ui"}`，`shared`、`foreground`，`snapshot`、`find`、`highlight` 为 read，`screenshot` 为 exec 并交判定对象）；选窗口（`instances()` 加 `info()`，会话小表带条数上限）；截图上传路由 `PUT /api/nbook.page-agent/captures/<token>`（来源检查、类型、尺寸、字节，凭证一次性、绑定调用与窗口、15 秒）；高亮用订阅等结局，装上后 `waitingForUser`，取消时 `release()`。
- `web/`：每个窗口登记窗口合同的实现；懒加载引擎；界面目录（命令服务 `list()`、`isEnabled()`，设置的公开数据源，工作台视图位置服务，命令面板的打分函数）；标识映射表（设计稿“定位”一节的表）；跟踪最近一次真实输入的时刻与焦点、可见性。
- 进主创与临时帮手的可选工具（`builtin/profiles/main.ts`、`adhoc.ts`）；主创提示词里 eval 一节提一句 `ui`。

## Spec 与文档改动（第 1 片，planned）

- `docs/specs/agent/page-agent.md`：已建（planned）。
- `docs/specs/runtime/plugin-channel.md`：输出 7、8 的文字不变；验收补“服务端插件列实例”“服务端订阅的窗口断开”两例。
- `docs/specs/harness/runtime.md`：嵌套调用的“等用户”标记一条（planned）；工具声明 `foreground` 一条（planned）。
- `docs/specs/agent/eval.md`：输出 14 的“等用户应答”加上嵌套工具自报的等待（planned）；失败时 `ToolCallError` 带 `details`（planned）；文档签名带字段说明（planned）。
- `docs/specs/agent/contributions.md`：`agentTool` 的 `foreground`（planned）。
- `docs/specs/agent/profile-settings.md`：工具绑定按 eval 对象开关、页面上显示成一行（planned）。
- 设置与工作台的 Spec：公开的设置目录读取接口、视图位置读取接口、悬停样式的显示属性（各一条 planned）。
- 包与结构：根 `AGENTS.md` 结构图、`packages/AGENTS.md`、`docs/modules/monorepo-boundaries.md`。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| 1 | 上面的 Spec 与文档改动（planned） | `bun run docs:check`、`bun run governance:check` |
| 2 | nb-runtime：服务端 `instances()`、服务端订阅在成员断开时结束 | `bun test packages/nb-runtime/src/remote`；nb-runtime 的 typecheck |
| 3 | nb-harness：`waitingForUser`、`foreground` | nb-harness 受影响的测试（`run/invoke.test.ts` 加用例）与 typecheck |
| 4 | agent 插件：`ToolCallError.details`、`tsType`、按对象开关与 Profile 页一行、对话视图 `skip` | agent 插件受影响的测试与 dom 测试、应用 typecheck；Profile 页另跑覆盖它的 e2e |
| 5 | 设置的公开目录接口、工作台的视图位置服务与悬停显示属性 | 两个插件受影响的测试、应用 typecheck |
| 6 | `nb-page-agent` 核心：api、快照、引用、定位、`nbTarget` | 包的 bun 单测、Playwright 夹具测试、typecheck |
| 7 | `nb-page-agent` 核心：引导（说明框、跟随、结局）与截图 | 同上；变异检查（见“验证”） |
| 8 | `nbook.page-agent` 插件：合同、窗口实现、界面目录、选窗口、方法工具、订阅等待、截图上传；进 Profile | 插件测试（真实服务端与窗口）、应用 typecheck、三份构建后跑 `page-agent.e2e.ts`、Lab 真实组件场景 |
| 9 | 真实模型冒烟、文档收尾、逐条核对 Spec 后晋升 | `test:llm` 跑 `page-agent.llm.test.ts`；`docs:check`、`governance:check` |

第 2、3 片互不依赖；第 6、7 片只依赖第 1 片；第 8 片依赖 2 到 7。

## 验收映射

| Spec | 覆盖 |
|---|---|
| `agent.page-agent` 输出 1、2 | 插件测试（选窗口：会话小表、焦点、最近输入、2 分钟、子会话）；e2e 场景 2 |
| 输出 3、5、6 | 核心的 Playwright 夹具测试；Lab 真实组件场景 |
| 输出 4 | 核心夹具测试（index 为 key 的列表反序、加载前缀）；e2e 场景 3 |
| 输出 7 | 插件 web 的单测（目录拼装与路径）；e2e 场景 1 |
| 输出 8 | 插件测试（上传路由、凭证、提交点、大小）；e2e 场景 4 |
| 输出 9、10 | 核心夹具测试（结局、`missed` 排除、不抢焦点、挂进弹层）；e2e 场景 6 |
| 输出 11 | harness `invoke.test.ts`（等待计数）；插件测试（高亮期间单元不计时）；e2e 场景 7 |
| 输出 12 | 核心与插件单测（字节上限、`details`）；e2e 场景 5 |
| 输出 13 | agent 插件 `objects.test.ts`（用 `ui` 的真实 schema 生成文档快照） |
| 场景 1 到 7 | `packages/neuro-book/e2e/page-agent.e2e.ts` |
| 失败码表 | 各码在核心或插件测试里各有一例 |
| `plugin-channel` 输出 7、8 的新验收 | `nb-runtime/src/remote/routing.test.ts` |

## 验证

- **每片**：上表的命令；改了测试或 e2e 后重跑 typecheck。
- **收口**：`bun run test:affected --since master`；`page-agent.e2e.ts` 与 Profile 页、工作台受影响的 e2e 各一次（合入前清单，开工前在起点上跑一遍记基线）；`docs:check`、`governance:check`。
- **变异检查**（先提交再改，恢复用 `git show HEAD:<文件>`）：引用前缀、身份核对、跨层重找、转义、字节上限、忽略自己的节点、`missed` 的排除、按钮不抢焦点、说明框挂进弹层、订阅取消时撤高亮、`waitingForUser` 的成对收回、服务端订阅在成员断开时结束。
- **真实浏览器**：核心与应用 e2e 都在真实 Chromium；另开一份不减弱动效的配置跑跟随与等待。实验之后没验证的三项（暗色主题、悬停显示属性、真实 Chrome 刷新时的订阅）在第 7、8 片各补一条用例。
- **未验证边界**：多使用主体；桌面外壳的真实截图；菜单里的命令。

## 测试分工

- 主会话：第 1 到 8 片的业务代码与跟设计绑在一起的单测（快照规则、引用、定位、结局判定、上传路由、选窗口、内核与 harness 的改动）；最终验证与变异检查。
- Sonnet 子代理（自己的 worktree，从 Work 分支开，只改测试、辅助函数与 Lab 场景）：
  - 第一段（第 6 片之后派）：核心包的 Playwright 夹具页与用例（Spec 输出 3 到 6、9、10）。
  - 第二段（第 8 片之后派）：Lab 真实组件场景与 `page-agent.e2e.ts`（场景 1 到 7）。
- 双方照的可观察状态：快照文本的行格式（Spec 输出 3 的例子）；说明框元素带 `data-nb-page-agent="callout"`，里面的按钮 `data-nb-page-agent="next"`、`"skip"`，提问框 `data-nb-page-agent="ask"`；描边框 `data-nb-page-agent="outline"`；引擎自己的节点都带 `data-nb-page-agent`。

## 不做与风险

- 不做：第二批（t02）；安全边界；菜单进目录；引导脚本。
- 风险：
  - 上游改动跨五个包（nb-runtime、nb-harness、agent、设置、工作台），每项单独提交、单独测；内核那两处的测试用真实路由与链路。
  - 说明框挂进弹层依赖弹层的 DOM 结构：Lab 真实组件场景里覆盖命令面板、下拉、右键菜单、设置窗口。
  - 界面目录依赖现有标记：映射表与“改主题”“打开资源管理器”的路径进 e2e，标记改名时测试会报。
  - token：冒烟时记请求数与输入 token，对照调研里薄接口的量级。
