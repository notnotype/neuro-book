# t15 实施计划：面板界面打磨

编码子代理 2026-10-13 写，按[设计审查](evidences/design-review.txt)（0 阻断、7 重要、10 建议，全部采纳）改过一版。阶段 1 写细，阶段 2 到 4 写轮廓。下文“审查重要 1”“审查建议 5”等指设计审查报告的编号；“omp 重要 3”“ux-b F1”等指四份体验与代码审查报告的编号。设计审查的行号以它的“勘误（行号）”一节为准。

范围与决定以本目录的 [改动方案](design.md) 为准（含开发者定的 D1 到 D5）；任务见 [README](README.md)，开发者的试用建议见 [后续清单](../../followups.md)。依据的四份审查报告在本地 `.local/agent/works/w00022-dev-panel/tasks/t15-ui-polish/reports/`（`omp-frontend-review.md`、`ux-a.md`、`ux-b.md`、`ux-c.md`），截图在同目录的 `shots/`。

执行位置：集成分支 `feat/w00022-dev-panel`（worktree `.worktree/w00022-dev-panel`），已快进到 master `f85157526`。四份审查的基线是 `def03ea99`，此后 `packages/dev-panel/src/web/` 没有改动，报告里的行号仍然对得上。

## 计划前的核实（2026-10-13，只读）

- **四份报告的代码结论逐条按源码核对过**，结果写在阶段 1 各条的“根因”里。omp 有三处需要补充或修正：会话页的接管确认也没绑定目标，omp 没列出；文字发送有屏幕摘要挡着，只有按键完全没有保护；编辑页在途的保存回包也会写进新文件的草稿。设计审查另补出一处同类错位（页面实例随路由参数复用，见 1.9）。
- **xterm 6.0.0 的滚动条**：在 4490 的审查面板上实测（1440×900，`?pane=w4:p1`），ux-c 与 omp 说的各对一半：
  - `.xterm-viewport` 还在，是一个没有子节点的空 div。xterm.css 给了它 `overflow-y: scroll`，所以有一条 15px 的原生轨道（`offsetWidth` 1064、`clientWidth` 1049）。这就是 ux-c 量到的“恒占 15px”；
  - 真正滚动的是 xterm 自绘的 `.xterm-scrollable-element > .scrollbar.vertical`（宽 14px，不滚时带 `invisible` 类）。这是 omp 说的自绘条，颜色走 `ITheme` 的 `scrollbarSlider*`；
  - 两者都不改终端的测量：列数按 `.xterm` 的父元素量。现在 `scrollback: 0`，自绘条从不出现。

  因此阶段 2 的做法是：空 viewport 的原生轨道直接藏掉（`scrollbar-width: none`）；自绘条用 xterm 的主题色。D2 给终端加回滚之后要再实测一次，见“要先实测才能定的问题”。
- **Task 页正文右边的空白**（开发者第 2 条、ux-a S5）：按代码与截图核实成立。`app.css` 给 `.nbdev-markdown` 限了 `max-width: var(--reading-measure, 72ch)`，外面的卡片却随 `minmax(0,1fr)` 撑满。1440 宽时卡片约 740px、正文约 600px，屏幕越宽空白越多。文档页同理。阶段 3、4 改，见阶段 4 的“Task 页”。
- **产物页显示已答的内容**：不需要改服务端。`/api/artifact/...` 已经返回 `answers`（每份答复的值、时间、版本）与每题的 `answer`，`QuestionPanel` 也有折叠的“已答 N”。ux-b F4 看到空白，是因为 t11-notify/questions 的题已在后来的版本里取代，当前版本没有“已答”状态的题。界面加一段“提交过的答复”（按 `answers` 列出）就够，阶段 4 做。
- **首页按产物合并提问**：不需要改服务端。`overview.inbox` 的每条提问带 `workId`、`taskId`、`artifactId`，前端分组即可。

## 阶段 1：行为缺陷（不改外观）

omp 的阻断 1 与重要 3 到 9，加上设计审查补的“页面按路由参数重建”与新建页的模式切换，共十片（1.0 是测试环境）。阻断那一条会向错误的会话发按键，开发者正在用面板，所以这一阶段先做、先合入。只改行为，不改布局与样式；新出的提示先用现有的 `WriteNotice`、`LoadState`，阶段 3 再换成统一的反馈零件。

### 共同做法

**宿主逻辑收进组合函数。** 身份错位都出在页面里的异步状态迁移上，这些逻辑现在写在 `.vue` 的 `<script setup>` 里，测不到。改为收进 `src/web/host/` 下的普通 `.ts` 组合函数，页面只做接线：

- `host/session-console.ts`：`useSessionConsoleHost`。管会话页“当前目标”的身份、终端连接的作用域、读屏与读更早的输出、发文字、发按键、两步确认、接管小窗；
- `host/file-edit-session.ts`：`useFileEditSession`。管编辑页的路径身份、基线与草稿、保存、冲突与结果未知；
- `host/panel-data.ts`、`host/api.ts`、`host/terminal-socket.ts`：原地改。

组合函数不碰 `vue-router`、`window.matchMedia`、DOM。路由守卫、窄屏判断、模板仍在页面里；页面把 `selected`、`path` 这类响应式输入传进去。

**数据宿主要有产品里也用的收口入口**（审查重要 4）。`panel-data.ts` 是模块级单例：一条 `/ws`、订阅表、重连定时器、`started` 标志。现在重连定时器没存下来，也没有停止的办法。加 `stopPanelData()`：关掉 `/ws`、清掉重连定时器、复位 `started` 与重连计数、复位 `panelState`。外壳卸载时调它；登录失效时走同一套关连接与清定时器的逻辑（1.5）。测试在每个用例结束时也用它收口，不另加测试专用的复位导出。

**测试方法：bun test，加 Vue 真实的响应式与 `effectScope`。**

- 文件放在包的 `tests/` 下、以 `web-` 开头，例如 `tests/web-session-console.test.ts`，与现有的 `tests/terminal-input.test.ts` 一样直接导入 `src/web/host/*.ts`。
- **隔离运行**：bun test 默认所有测试文件共用一个模块注册表，`panel-data.ts` 的单例与遗留的定时器会串到别的文件（审查重要 4 用实验复现过）。包的 `test` 脚本改成 `bun test --isolate`（每个文件一份全局对象与模块注册表）。实施时先量全量耗时；明显变慢就只让 `tests/web-*.test.ts` 单独一段 `--isolate`，其余照旧。同一个文件里的用例之间，靠 `stopPanelData()` 与 `afterEach` 拆环境收口。
- 新增一个测试用的环境文件 `tests/web-env.ts`，用 `afterEach` 拆除，失败时也拆：
  - `globalThis.fetch`：记下每个请求，按用例给的表回外壳，可以挂起、延迟、回 401 或 503；
  - 假的 `WebSocket` 类：带 `CONNECTING`、`OPEN`、`CLOSING`、`CLOSED` 静态常量与 `readyState`（`terminal-socket.ts` 用 `WebSocket.OPEN` 判断能不能发）；记下实例；用例可以推消息、触发 `open` 与 `close`；
  - 最小的 `document`（`visibilityState`、`addEventListener`、给 CSRF 用的 `querySelector`）、`window`（`addEventListener`、`pagehide`）、`location`、`localStorage`。
  - **装的顺序**：vue 的 runtime-dom 在模块求值时就调 `document.createElement`，所以测试文件先静态导入 vue 与被测模块，环境只在用例里装（审查重要 4 第 3 点）。`web-env.ts` 的文件注释写明这条。
- 用例在 `effectScope().run(...)` 里调组合函数，改输入的 `ref`，`await nextTick()` 或等请求落定，再断言发出的请求与状态；结束时 `scope.stop()`、`stopPanelData()`。
- **测的是真实的那段代码**：被测的就是页面运行时调用的组合函数，以及它真实导入的 `api.ts`、`panel-data.ts`、`terminal-socket.ts`。替换掉的只有浏览器全局对象与服务端。没有测试专用的分支或导出，组合函数也不为测试加注入参数。
- **测不到的部分**：
  - 页面模板的接线：`:key` 放在哪一层、把 `readonly` 绑到编辑器、在哪里显示提示；
  - 真实 DOM、xterm 的渲染、真实的路由守卫与确认框。

  这些由浏览器验收覆盖，各条写明。审查重要 1 那类“key 放错层、连带重建插槽”的错误单元测试测不到，所以“接管中换会话 id”“同一终端换会话不重建终端”都写成了验收场景。

**浏览器验收：在 4490 上做。**
- 面板由集成分支的代码在同一个克隆上起，**必须沿用原来那份环境**，否则接管与按键的审计会写进开发者真实的 `~/.config/nbdev/audit.jsonl`：

  ```
  cd /dev/shm/nbdev-ui-review/repo && exec env -i HOME=$HOME PATH=$PATH TERM=xterm-256color LANG=en_GB.UTF-8 XDG_CONFIG_HOME=/dev/shm/nbdev-ui-review/xdg GH_CONFIG_DIR=$HOME/.config/gh HERDR_SOCKET_PATH=$HOME/.config/herdr/sessions/nbdev-ui-review/herdr.sock NBDEV_HERDR_BIN=/home/<user>/.local/bin/herdr NBDEV_GH_BIN=/home/<user>/.local/bin/gh NBDEV_GH_PREFIX=prox /usr/bin/bun <worktree>/packages/dev-panel/src/cli.ts panel serve --port 4490 --artifact-port 4491 > /dev/shm/nbdev-ui-review/logs/panel.log 2>&1
  ```

  用后台机制运行、记下 PID，验收完 SIGTERM 停掉。不加 `--no-build`，面板把集成分支的前端构建进 worktree 自己的 `dist/web`。登录用 review-env.md 的命令，`cli.ts` 换成 worktree 里的路径。
- Playwright 驱动本机 Chrome，去掉 `--hide-scrollbars`；同一时间只开一个浏览器，`TMPDIR` 与用户数据放 `/dev/shm`，用完删掉；脚本与截图放本地 `.local/agent/works/w00022-dev-panel/tasks/t15-ui-polish/accept/`。
- **造历史用路由的 push**（审查重要 3）：会话页选会话用的是 `router.replace`，站内也没有带 `?pane=` 的链接；从 Task 页进编辑页只造出 [Task 页, 编辑页]。所以需要“同一路由、相邻两条历史”的场景，一律经 `document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(...)` 依次 push，每步等页面就绪再继续。这只用于驱动验收。后退之后先断言 URL 与页面仍是预期的那一页，再断言要测的行为。原生确认框的 `page.on('dialog')` 要在 `goBack()` 之前挂上。
- **对命名会话 `nbdev-ui-review` 的 herdr 写调用已获同意**：再起一格假 Claude、改会话 id、往格里发按键。一律写成 `env -i HOME=$HOME PATH=$PATH TERM=xterm-256color /home/<user>/.local/bin/herdr --session nbdev-ui-review …`。
  - 现有那格假 Claude 是 `w4:p1`，用 `/dev/shm/nbdev-ui-review/fake/`；第二格另建 `/dev/shm/nbdev-ui-review/fake2/`，屏幕上写不同的标记。
  - 让新的一格成为 Claude 会话要用 `pane report-agent … --source herdr:claude --agent claude --agent-session-id <id>`（docs/herdr.md 的“会话身份”一节），单独 `report-agent-session` 不会进 agent.list。
  - 做完把多起的那一格关掉；记录里写明用过哪几条命令。默认 herdr 只做只读调用。
- 判断“有没有发出去”看三处：假 Claude 的输入日志（`fake/tui.log`、`fake2/tui.log`）、审计（`/dev/shm/nbdev-ui-review/xdg/nbdev/audit.jsonl`）、Playwright 记下的请求。
- 要靠推送触发重取的场景，改记录里有、页面上看得见的字段：Work 的目标（README 的“目标”一节或第一段，WorkCard 与 Work 页都显示它）。只改 README 的其它正文不进记录的指纹，不会推送（审查建议 3）。

### 1.0 测试环境与数据宿主的收口入口

- `tests/web-env.ts`（见共同做法）与一条冒烟用例；
- `panel-data.ts` 加 `stopPanelData()`，存下重连定时器；外壳 `App.vue` 卸载时调用；
- 包的 `test` 脚本加 `--isolate`（按实测定是全量还是只对 `web-` 一段）。

测试：`startPanelData()` 建一条假连接，`stopPanelData()` 之后连接已关、等过最短重连间隔（1 秒）没有新连接；再 `startPanelData()` 能重新建连。

### 1.1 阻断 1：会话页的两步确认没有绑定目标

**根因（核实成立，补两处）。**
- `SessionsPage.vue` 的 `sendPrompt`、`sendKey` 在执行时才读 `selected.value`。
- 两步确认存的回调是 `() => sendKey(key, true)`、`() => sendPrompt(text, digest)`，确认那一刻发给的是“现在选中的”，`expectedSession` 也取现在的，服务端的会话核对拦不住。
- 选中目标会在确认框打开期间变：
  - 推送更新了 `sessions`，这格 pane 换了会话（`/clear`、`--resume`、`/compact`）；
  - 用浏览器后退改了 `?pane=`；
  - 这格 pane 消失了。
- `pressKey` 先 `await readScreen()` 再开确认框，这段等待里目标变了也不查；确认框显示的屏幕可能已经属于别的会话，或者是空的。
- 补充一：**按键完全没有保护**。文字那一支有屏幕摘要挡着：服务端对新目标重新判定，摘要对不上就不发。只有新目标的判定原因与屏幕末尾都恰好相同时才会误发（例如同一格 `/clear` 之后屏幕一样）。
- 补充二：**接管确认同样没绑定目标**，omp 没列出。`confirmTakeover` 也在确认时读 `selected.value.sessionKey` 与 `terminal.value`，目标换了就接管新会话。服务端回 `need_confirm` 时开的“抢过来”小窗同样现读 `terminal` 与尺寸。
- 补充三（审查建议 4）：给 A 的发送在途时切到 B，A 的回包照样把 `resetKey` 加一，清掉开发者刚给 B 打的字。
- 通知的发送（`notify-actions.ts` 的 `deliver`）在确认回调里带着 `job` 与 `target`，已经绑定，不受影响。

**改法。**
- `useSessionConsoleHost({selected, terminalAvailable})`：
  - 目标身份记为 `{paneId, terminalId, sessionKey}`；
  - `sendPrompt(target, text, confirmScreen)`、`sendKey(target, key, confirmed)` 都显式带目标；
  - 确认框存一份 `{target, kind, ...}`。`confirmRun` 先比对目标是否与当前选中一致（三项都比），不一致就不发，给一条警告：“确认框打开期间目标变了（A → B），没有发送”。
- `watch` 目标身份，一变就：
  - 关掉会话页自己的确认框与接管小窗；
  - 清掉 `lastConflict`、屏幕、更早的输出与提示；
  - 作废在途的读屏与读历史：带序号，回来时三项身份都对上才写，不再只比 `paneId`。
- `pressKey` 在 `await readScreen()` 之后先核对目标没变，再开确认框，屏幕取这次读到的。
- 接管小窗记下发起时的目标；`need_confirm` 打开的“抢过来”小窗沿用发起接管时记下的目标与尺寸；确认时目标变了就不接管、给同样的提示。
- **输入框草稿按 pane 记**（决定点 2 的终稿）：
  - 换 pane 时经 `SessionConsole` 已有的 `resetKey` 清空；
  - 同一格换会话（`/compact`、`/clear`）时保留草稿，在输入框上方给一行“这格的会话换了（A → B），发出去会发给 B”；
  - 发送的回包只在目标仍等于当前选中时才加 `resetKey`；
  - 不给 `SessionConsole` 加 key：它的插槽里是实时终端，加 key 会连带重建终端（审查重要 1）。
- 会话页的确认改用组合函数自己的 `confirm`，不再借 `notifyActions.confirm`（通知那份留给通知）；页面上的 `ScreenConfirmDialog` 显示两者中开着的那一个。服务端的 `expectedSession` 照旧保留：客户端把目标绑在打开时之后，它仍能挡住“面板还没轮询到会话已换”的窗口。

**文件与文档。**
- `src/web/host/session-console.ts`（新）、`src/web/pages/SessionsPage.vue`、`src/web/host/notify-actions.ts`（只在需要时把 `ScreenConfirm` 类型导出给会话页复用）；
- `parts/ScreenConfirmDialog.md`、`parts/TakeoverDialog.md`：写明“确认针对打开时的目标，目标变了宿主会关掉它”；`parts/SessionConsole.md`：`resetKey` 由宿主在换 pane 时加一、同一格换会话时保留草稿，以及“会话换了”那一行的 prop；
- `docs/panel.md`：“通知与会话页”的两步确认一段加上“确认绑定打开时的目标（pane、终端、会话），目标变了自动取消并提示；输入框的草稿按 pane 保留”。

**测试（`tests/web-session-console.test.ts`）。**
- 选中 A，按 Enter 开确认（假 fetch 先回 A 的屏幕）→ 把 `selected` 改成同一 pane 的会话 B → `confirmRun()`：断言没有发出 `/keys` 请求，确认框关了，有“目标变了”的提示；
- 同一流程换成另一格 pane：断言同上；
- 文字的“仍然发送”：目标变了不发；
- 读屏挂起期间目标变了：回来的屏幕不写进状态，也不开确认框；
- 接管小窗打开期间目标变了：确认不调用接管；`need_confirm` 之后目标变了：“抢过来”不发出；
- 给 A 的发送在途时换到 B：A 的回包不加 `resetKey`；同一格换会话：`resetKey` 不变，“会话换了”那一行出现；
- 正常路径：目标不变时确认照常发出，请求里的 `paneId`、`expectedSession` 是打开时的那个。

**浏览器验收。**
- 需要两格 Agent 会话 A（`w4:p1`）与 B（新起的一格）。
- 场景一（换 pane）：用路由 push 依次打开 `?pane=B`、`?pane=A`，按 Enter，确认框出现后 `page.goBack()`。先断言 URL 是 `?pane=B`、仍在会话页；再断言确认框关闭、出现“目标变了”的提示；A、B 的假 Claude 日志都没有新的 `\r`；审计没有新的 `keys` 行。
- 场景二（同一格换会话）：打开 A，按 Esc 开确认框，对 A 运行 `pane report-agent-session` 换一个会话 id，等面板的轮询发现（有浏览器连着时 500 毫秒）。断言同上。
- 场景三（接管）：开“接管键盘”小窗，同样用场景一的办法换 pane。断言没有接管：审计没有 `takeover` 行，终端仍是“观看中”。
- 场景四（草稿）：在 A 的输入框打几个字，对 A 换会话 id：字还在、出现“这格的会话换了”；再换到 B：输入框空了。

### 1.2 omp 重要 3：换终端之后零件不重新订阅

**根因（核实成立）。**
- `TerminalView`、`TerminalTextView` 只在 `onMounted` 里 `source.subscribe`，没有 `watch`。
- 页面换目标时在同一个 `watch` 回调里先置 `null` 再赋新的 `terminal`，Vue 在同一轮里合并渲染，`v-if` 两次都为真，零件实例原地复用，只换了 `source` prop。
- 结果：画面停在旧终端，输入、resize、接管却经 `terminal.value` 发给新终端。

**改法。**
- 终端连接的作用域挪进 `useSessionConsoleHost`：每建一条连接（换 `paneId + terminalId`，或 1.5 的重新登录之后重建）就把一个连接序号加一。
- 页面给 `TerminalView`、`TerminalTextView` 加 `:key="连接序号"`。key 与 `source` 对象的生命期一一对应，“`source` 在实例的一生里不变”由构造保证，不另写 `watch`（决定点 3）。同一格换会话时连接不变，终端不重建（审查重要 1）。
  - 这里的“连接身份”比 `paneId + terminalId` 多一层：1.5 的重新登录会在同一个 `paneId + terminalId` 上重建连接，只按两者加 key 的话，视图会留在已经关掉的旧连接上。
- 不给 `SessionConsole` 加 key（见 1.1）。
- 两个终端零件的 `.md` 写明合同：“`source` 在实例的一生里不变；宿主换连接时用 key 重建”。
- 顺带：`TerminalTextView.md` 的标签补上 `env:timer`（200 毫秒的节流定时器，omp 已核对过的伴生声明遗漏）。

**文件与文档。** `src/web/pages/SessionsPage.vue`、`src/web/host/session-console.ts`、`parts/TerminalView.md`、`parts/TerminalTextView.md`。`docs/panel.md` 的“网页终端”一节加一句“换选中的 pane 或重建连接时终端视图整体重建；同一格换会话不重建”。

**测试。**
- 连接序号：同一终端换会话时不变、连接不重建；换 pane 时加一，旧作用域已停（旧的假 `WebSocket` 已关）、新建一条连接。
- key 有没有绑到模板上、绑在哪一层，单元测试测不到，由浏览器验收覆盖。

**浏览器验收。**
- 两格 Agent 会话 A、B 的假屏幕写不同的标记。
- 桌面：打开 A，等 `.xterm-rows` 出现 A 的标记，用路由 push 换到 `?pane=B`，2 秒内 `.xterm-rows` 是 B 的标记、不再有 A 的。接管 B 后打一个字：B 的日志有，A 的没有。
- 接管中换会话（审查重要 1）：接管 A，对 A 运行 `pane report-agent-session` 换会话 id，等轮询之后：仍是“你已接管键盘”，`.xterm-rows` 没被清空，`document.activeElement` 仍是 xterm 的 `.xterm-helper-textarea`，再打一个字仍进 A 的日志。
- 手机（390，触屏）：在文字视图里做同样的切换，比对 `aria-label="终端的当前屏幕（文字）"` 的文字。

### 1.9 页面按路由参数重建（审查重要 2）与新建页的模式切换（审查建议 9）

排在 1.2 之后、1.3 之前。

**根因（审查用实验核实）。**
- `App.vue` 的 `RouterView` 没有 key。Work、Task、产物三个带参数的路由在参数变化时复用同一个页面实例，只换 props。
- `useStatusChange` 的提示、待确认、上一次的请求挂在实例上，换参数时不清；端点与 `expectedHash` 在发送时现读。在 Task A 上改状态遇到等锁超时，提示带“重试”；开发者点去 Task B，再点“重试”，就以 B 的端点与 B 的哈希发出 A 上选的状态，在 master 上提交。
- 产物页同理：答复的“重试”现读 `data.value`，换到另一个产物后按 B 的版本发出 A 的答案。
- 新建页：提交在途时还能切“新建 Work / 新建 Task”，回包与“结果未知”的确认都按切换后的模式清表，清错表、留下已经提交过的那张，有领第二个号的风险。

**改法。**
- 外壳给 `RouterView` 里的页面加 key：`<RouterView v-slot="{Component, route}">` 里给 `<component>` 加 `:key`，取路由名加 params，**不含查询参数**（否则会话页的 `?pane=`、编辑页的 `?path=` 一变就整页重挂）。编辑页的 `?path=` 仍由 1.3 的组合函数处理。key 的拼法写成一个纯函数 `pageKey(route)`，放在 `host/routes.ts`。
- 新建页：提交在途时禁用模式切换；`submit` 开始时记下模式，回包与 `confirmUnknown` 都用记下的模式。

**文件与文档。** `src/web/App.vue`、`src/web/host/routes.ts`、`src/web/pages/NewPage.vue`；`docs/panel.md` 的“前端”一节加“页面按路由名与路径参数重建实例，查询参数变化不重建”。

**测试。**
- `pageKey`：同名不同 params 不等；只差 query 相等；params 的键序不影响。
- 页面按 key 重建的接线由浏览器验收覆盖；新建页的逻辑在 `.vue` 里，同样由浏览器验收覆盖。

**浏览器验收。**
- Task 页：用 `page.route` 把这次 `POST …/status` 改成 409 `lock_timeout`，出现带“重试”的提示后点左栏到同一 Work 的另一个 Task：提示不在、没有“重试”。
- 新建页：用 `page.route` 把新建 Work 的 `POST` 延迟 3 秒，期间模式切换是禁用的；放行后清掉的是 Work 表。

### 1.3 omp 重要 4：编辑页换文件之后草稿不换

**根因（核实成立，补一处）。**
- 改 `?path=` 经 `onBeforeRouteUpdate` 确认之后，`useResource` 先把 `data` 置 `null` 再取新文件。
- `watch(file.data)` 遇到 `dirty` 就返回；新文件到达时 `draft` 仍不等于旧的 `base.text`，`dirty` 仍为真，于是 `base`、`draft` 一直是 A 的。
- `mismatch`、`uncommitted`、`notice` 也不清。
- 补充（按审查建议 1 更正）：保存在途时 `base` 还没换，`dirty` 为真，两个路由守卫都会弹“有未保存的改动，离开会丢掉”。开发者点“确定离开”以为丢掉了，这次保存其实照常在 master 上提交；A 的回包回来时又会写进新文件 B 的状态。

**改法。**
- `useFileEditSession(path)`：
  - 内部用 `useResource` 取 `/api/files?path=`；
  - 状态带一个“会话代号”，`path` 变了就加一，同时清空 `base`、`draft`、`mismatch`、`uncommitted`、`notice`；
  - 新文件到达且代号对得上时建立基线；
  - `save()`、`loadMismatch()`、`checkAfterUnknown()` 开始时记下代号与路径，回来时代号变了就丢弃回包。只丢状态更新，写入本身照样发生。
- 保存在途时离开的处理见 1.4。“未保存不让走”仍由页面的路由守卫保证，组合函数只负责“允许离开之后不留旧状态”。

**文件与文档。** `src/web/host/file-edit-session.ts`（新）、`src/web/pages/EditPage.vue`；`docs/panel.md` 的“编辑页的未保存改动”加一句“换文件之后编辑器、基线与提示都换成新文件的；旧文件在途的回包不再改写编辑器”。

**测试（`tests/web-file-edit.test.ts`）。**
- A 载入后把草稿改成“A 改了”，路径改成 B，B 到达：`base` 与 `draft` 都是 B 的，`mismatch`、`notice` 为空；
- `loadMismatch` 挂起时路径改成 B，再放行：B 的状态不受影响；
- 同一个文件重取（`file.reload()`）且有未保存的改动时，草稿不被覆盖（保留原来的保护）。

**浏览器验收（克隆里的两份 README，写入只进克隆）。**
- 用路由 push 依次打开 `/edit?path=B`、`/edit?path=A`，在 A 里打字；
- 先挂上 `page.on('dialog')` 接受原生确认框，再 `page.goBack()`；
- 先断言 URL 是 B、仍在编辑页；再断言编辑框是 B 的原文，标题路径是 B，没有“未保存”徽标。

### 1.4 omp 重要 5：保存期间继续输入，成功回包会盖掉

**根因（核实成立）。** `FileEditor` 的 `readonly` 只看 `blocked`。保存在途时可以继续打字，成功后无条件 `draft = 回包文本`，新打的字丢掉，`dirty` 变假，离开也不再提示。

**改法。**
- 保存在途时编辑器只读（`readonly = blocked !== null || saving`），页面上的保存入口防重入（已有 `write.pending`）。不做“边保存边改”的合并（决定点 4）。
- 保存在途时**拒绝站内离开**（审查建议 1，主 Agent 定）：两个路由守卫在 `saving` 时直接返回 `false`，不弹框，给一行提示“正在保存，等它完成再离开”（等锁最长 30 秒）。关标签页与刷新仍走 `beforeunload`。
- 回包改写 `draft` 之前，再核对一次 `draft` 仍等于提交的文本：只读之下这条恒成立，留作保护，不另开分支。

**文件与文档。** `src/web/host/file-edit-session.ts`、`src/web/pages/EditPage.vue`；`parts/FileEditor.md` 的 `readonly` 说明加“保存在途时宿主也会置只读”；`docs/panel.md` 同一段加“保存在途时编辑器只读，站内离开被拒绝并提示”。

**测试。**
- 保存挂起时 `saving` 为真，组合函数给出的只读为真；
- 挂起期间直接改 `draft`（模拟绕过只读）再放行：草稿不被回包覆盖，`dirty` 仍为真；
- 保存挂起时路径改成 B（页面守卫在实际产品里会拒绝，这里直接改 `path` 模拟绕过）：A 的回包不写进 B 的状态，没有“已保存”的提示；
- 正常保存后草稿换成服务端写下的文本（README 的 `updated` 被改过的情形）。

**浏览器验收。**
- 用 `page.route` 把这次 `PUT /api/files` 延迟 3 秒再放行，模拟在等写锁；
- 点保存后，用 `focus` 加 `keyboard.type` 打几个字（不用 `fill`：它会一直等元素可编辑直到超时）：断言值没变、`textarea` 带 `readonly`；
- 同一个延迟期间点一次左栏：断言没有离开、出现“正在保存”的提示；
- 3 秒后显示“已保存”，编辑框是服务端文本，可以再打字。

### 1.5 omp 重要 6：写请求遇到 401 不进入全局的“要重新登录”

**根因（核实成立，补一处）。**
- 只有 `useResource`、`SearchPage` 的流式搜索、两处重连探测把 401 转成 `panelState.unauthorized`；
- `sendJson`、`useWrite` 与页面里直接的 `getJson`（读屏、读历史、编辑页取当前版本）都只给局部错误；
- 新建页的预览 401 被当成“预览问题”，不挡提交；
- 应用级的 `/ws` 重连定时器没有保存，没有停止入口（1.0 补上）。
- 补充：外壳在 `unauthorized` 时用 `v-if` 换掉整个界面，`RouterView` 被卸载。编辑页的草稿、答复表单里填了一半的答案会随之丢掉。改成写请求也触发之后，这条路径会更常走到。

**改法（决定点 1 的终稿：阻挡层，页面不卸载，恢复路径补全，见审查重要 5）。**
- `api.ts`：
  - 加一个认证失效的事件出口，例如 `onAuthLost(listener)`；
  - `readEnvelope` 与 `streamLines` **先按 `response.status` 判断 401**，再解析 JSON（回应不是 JSON 的 401 也算），触发事件，同时照常抛 `ApiError`，让调用方的局部说明仍然成立；
  - 只看状态码，不看文案。
- `panel-data.ts` 把认证当成一个有“代”的状态：
  - 失效：`unauthorized` 置真，关掉 `/ws`、取消重连定时器（与 `stopPanelData()` 同一套），推送不再触发重取；`useResource` 在 `unauthorized` 时不发请求，`reload()` 与补取都直接返回，于是 checkout 页每 10 秒的轮询这类自带定时器也停止打 401；
  - 重新登录：外壳的“我已重新登录”重探 `/api/meta`，通过就 `authEpoch` 加一、`unauthorized` 置假、重新连 `/ws`，并**显式全部重取**（不依赖 `hello` 的判定：同一个服务实例里失效再重登，`hello` 不会触发全部重取）；
  - 删掉 `useResource`、`probeBeforeReconnect` 里各自的 401 分支，改走同一个出口。
- `SearchPage`、`terminal-socket.ts` 的 401 分支同样改走这里。`terminal-socket` 收到全局失效时停止重连。
- 会话页：终端连接作用域的 `watch` 键带上 `authEpoch`，重新登录之后自动重建连接、只恢复观看（不自动重新接管）。
- 外壳：`unauthorized` 时页面保持挂载，盖一层阻挡交互的提示，写“登录已失效：在终端运行 nbdev panel open，用新链接登录（同一个浏览器里别的标签页也行），再点‘我已重新登录’”。

**文件与文档。** `src/web/host/api.ts`、`host/panel-data.ts`、`host/terminal-socket.ts`、`host/session-console.ts`、`pages/SearchPage.vue`、`App.vue`；`docs/panel.md`：
- “登录”与“数据宿主”两处改成“任何 `/api/*` 请求回 401（读、写、预览、探测、流式搜索）都进入登录失效状态：停止推送、重连与取数，页面保持挂载、盖一层提示；重新登录后点‘我已重新登录’，全部重取、会话页的终端重连（只恢复观看）”；
- “网页终端”的“连接与消息”加“重新登录后重建连接”。

**测试（`tests/web-panel-data.test.ts` 与 `tests/web-api.test.ts`）。**
- 假 fetch 对 `sendJson` 回一个合法的 401 外壳，经 `useWrite` 处理：`panelState.unauthorized` 为真，`useWrite` 仍拿到局部的失败；不是 JSON 的 401 同样触发；
- 失效之后假 `WebSocket` 已经 `close`，等过重连的最短间隔（1 秒）没有新建连接；再推一条消息，订阅了的资源不再发请求；`reload()` 不发请求；
- 同一实例里失效再重新登录：每个订阅了的资源各重取一次，新建了一条 `/ws`，`authEpoch` 加一；
- 会话页的终端作用域在 `authEpoch` 变化后重建（连接序号加一、新建一条终端连接）；
- 流式搜索的 401 同样触发。

**浏览器验收。**
- 打开编辑页打几个字，另一个标签页开会话页并接上终端，然后 `context.clearCookies()`；
- 在编辑页触发一次保存或在新建页触发一次预览：断言出现阻挡层，编辑框里的字还在；
- 推送连接已断开：Playwright 记下 `/ws` 的 close，之后没有新的 `/ws` 握手；checkout 页开着时 20 秒内没有新的 `/api/checkouts` 请求；
- 用 `nbdev panel open --print` 的链接在新标签页登录，回到原标签页点“我已重新登录”：阻挡层消失，编辑框里的字还在、可以保存；会话页的终端重新出画面。

### 1.6 omp 重要 7：连续推送时慢资源一直被中止

**根因（核实成立）。**
- 每次推送都直接 `load(true)`，开头 `controller?.abort()` 中止在途的请求，没有在途合并，推送间隔短于请求耗时就永远收不到数据；
- 外壳与首页各取一次 `/api/overview`；外壳订阅全部四块的 `/api/meta`，Work、Task、文档、编辑、产物、新建、会话七个页面各另有一份 `/api/meta`；
- 服务端 `records` 或 `sessions` 变了会接着重算 `activity`，一次改动常带来两条相邻的推送。

**改法。**
- `useResource` 只把**推送触发的重取**改为单飞（审查建议 2）：
  - 在途时再来推送，只记一个 `dirty`，不中止；
  - 在途的请求结束（成功或失败）后，`dirty` 为真就再取一次，最多补一次；
  - `unauthorized` 时不补取（1.5）。
- 显式 `reload()` 保持现在的“中止在途、立即重取”：调用点都在写入之后、重试按钮与 checkout 页 10 秒一次的轮询，要的是“比这次写入新的数据”，不能合并进写入之前发出的在途请求（编辑页最明显）。
- `path` 变了：中止在途、复位 `dirty`、立即重取；scope 销毁时中止。
- 保留“只接受最后一次请求、revision 不回退”的判断。
- 同一个地址在不同组件之间共用请求，本阶段不做（决定点 5）。

**文件与文档。** `src/web/host/panel-data.ts`；`docs/panel.md` 的“数据宿主”加“推送触发的重取单飞：在途时再有变化只记一笔，结束后至多再取一次；显式重取与地址变化照旧中止在途的请求”。

**测试。**
- 假 fetch 每次 80 毫秒才回，假 `WebSocket` 在 600 毫秒里每 30 毫秒推一条 `records` 变化：
  - 被中止的请求数为 0；
  - 推送期间至少接受 3 次数据；
  - 推送停下后恰好再取一次，最后的数据对应最后一次推送之后的状态。
- 在途请求挂起时调 `reload()`：旧请求被中止，旧回包不写进 `data`。
- `path` 变了：在途的请求被中止，新地址立即取；旧地址的回包不写进 `data`；之后不补取旧地址。
- 失败之后有 `dirty` 也照样补取一次。
- 单飞在途时来了 `hello`（实例变了）：旧实例的回包被接受（实例不同不算回退），随后补取一次拿到新实例的数据（审查重要 4 第 4 点）。

**浏览器验收。**
- 用 `page.route` 把 `/api/overview` 延迟 2 秒；
- 同时在克隆里每 700 毫秒改一次某个 Work 的目标（README 的“目标”一节）：只进克隆，不提交也会让 `records` 变；间隔大于 `records` 重算的去抖，小于请求耗时；
- 15 秒内：Playwright 记下的 `/api/overview` 请求里被中止的为 0，首页那张 Work 卡片的目标至少换过 3 次；
- 停止改动后 4 秒内卡片是最后一次改动的内容。

### 1.7 omp 重要 8：已有数据时重取失败，界面不提示

**根因（核实成立）。**
- `useResource` 在 `keepData` 时失败只设 `error`、保留 `data`；
- 订阅推送的 10 个页面都只在 `!data` 时显示 `LoadState`，所以这种状态完全不显示。这 10 个页面是首页、Work、Task、产物列表、产物、文档（树与正文两份资源）、会话、在跑、checkout、GitHub；
- 外壳顶栏的“数据 N 分钟前”只看 `meta.parts.records.at`，不代表当前页面这次刷新成功；`meta.parts.<块>.error`（后台重算失败）从不显示。

**改法。**
- `useResource` 加两项：`receivedAt`（最近一次接受数据的时刻）；`stale`（`data` 与 `error` 同时存在）。
- 新零件 `StaleNotice`（带同名 `.md`）：一行紧凑的提示，写“显示的是 N 前读到的内容；这次重取失败：<原因>”，加一个“重试”。
  - 404 写“已经找不到了（可能被删或改了名）”，不给重试，给“回到上一级”的链接（链接由页面给，决定点 6）。
- 这 10 个页面在标题下面放 `StaleNotice v-if="resource.stale"`。
  - 一页有几份资源时只显示主资源。
  - 编辑页不显示：它不订阅推送，只在保存时重取。
- 外壳：`meta.parts` 里有 `error` 的块，在顶栏下面给一行提示，写“后台重算 <块> 失败，显示的是上一份：<原因>”。阶段 2 再改成横幅。

**文件与文档。** `src/web/host/panel-data.ts`、`parts/StaleNotice.vue` 与 `.md`（新）、上面 10 个页面、`App.vue`；`docs/panel.md` 的“数据宿主”加“已有数据时重取失败：保留旧数据，页面写明是上次读到的并给重试；后台重算失败在顶栏写明”，“零件”列表加 `StaleNotice`。

**测试。**
- 先成功、再 503：`data` 保留，`error.status` 为 503，`stale` 为真，`receivedAt` 是第一次的时刻；
- 再成功：`stale` 为假；
- 首次就失败：`stale` 为假，仍由 `LoadState` 处理。

**浏览器验收。**
- Work 页先正常显示；用 `page.route` 让之后的 `/api/work/...` 回 503，再在克隆里改这个 Work 的目标，触发推送重取；
- 断言出现“显示的是上次读到的内容”与“重试”；
- 撤掉拦截后点“重试”，提示消失。
- 404 的情形：拦截改回 404，断言没有“重试”、有“回到上一级”。

### 1.8 omp 重要 9：后台标签页里第一次建终端，回到前台不会连上

**根因（核实成立）。**
- `connect()` 在 `document.visibilityState === "hidden"` 时直接返回，`status` 停在初始的 `"connecting"`；
- `visibilitychange` 回到前台时只在 `status === "paused"` 时连接，于是一直停在“连接中”；
- 正常的切后台走 `paused`，所以平常用不出这个问题。

**改法。**
- `connect()` 因为页面在后台而不连时，把 `status` 置为 `"paused"`。回到前台由现有的 `paused` 分支恢复，只恢复观看。
- 不改终止码不重连、`disposed` 不连接这两条合同。

**文件与文档。** `src/web/host/terminal-socket.ts`；`docs/panel.md` 的“连接与消息”加“在后台打开会话详情时先记为暂停，回到前台才连”。

**测试（`tests/web-terminal-socket.test.ts`）。**
- 假 `document` 初始 `hidden`，在 scope 里建 `useTerminalSocket`：没有新建 `WebSocket`，`status` 为 `paused`；
- 改为 `visible` 并派发 `visibilitychange`：新建了一条连接；
- 同样的流程在 scope 停掉之后：不连接；
- 回归：已连上时切后台再回来，照旧只恢复观看。

**浏览器验收。** 这是模拟：Playwright 不能真的把标签页放到后台而不失去控制，所以只能这样做，记录里写明。
- 在首页用 `page.evaluate` 把 `document.visibilityState` 改成 `hidden`（`Object.defineProperty`）并派发 `visibilitychange`；
- 再用路由 push 打开 `?pane=w4:p1`，让终端在“后台”建起来；
- 改回 `visible` 并派发事件：断言 3 秒内终端出画面（`.xterm-rows` 有假 Claude 的标记）。

### 切片、验证与合入

- 一片一个提交，次序：1.0、1.1、1.2、1.9、1.3、1.4、1.5、1.6、1.7、1.8。1.3 与 1.4 共用新的组合函数，1.3 在前。
- 每个提交都过包的 `typecheck`、`build:web` 与相关测试。阶段末按包的 `AGENTS.md` 的完成门禁跑全量：
  - 包里 `typecheck`、全量 `test`、`build:web`；
  - 根目录 `bun x vitest run --config scripts/vitest.config.ts scripts/ci/dev-panel-records.test.ts`；
  - 改到包内文档（`docs/panel.md`、零件的 `.md`）所以还要跑 `bun run governance:check` 与 `bun run docs:check`。
- 浏览器验收在阶段末统一做一遍（十片），截图与日志放本地 `accept/`。
- 合入：阶段 1 单独合入 `master`。合入后要重启常驻服务，重启前先问开发者（D5）。
- 禁止清单照旧：
  - 不按错误文案分支；没有静默的 `catch`；
  - 不为过测试放宽断言，不加测试专用的分支或导出；
  - 不删任务之外的代码；不跨包深导入。

## 阶段 2：外壳（轮廓）

| 片 | 内容 | 依赖 | 验收要点 |
|---|---|---|---|
| 2a 滚动条与滚动权 | `app.css` 一处声明细滚动条（`scrollbar-width: thin`，颜色由 `--text-muted` 派生，悬停加深，明暗跟主题）；`html` 不预留滚动条槽位；左栏的 Work 区、`main`、文档页两栏 `scrollbar-gutter: stable`；路由元信息声明“铺满”或“流式”，外壳据此决定 `main` 滚不滚。这一片只把文档页声明为“铺满”：会话页现在是一长列纵向堆叠，靠 `main` 滚动，它的“铺满”挪到阶段 4 改两栏的那一片（审查建议 6）。xterm 的空 `.xterm-viewport` 藏掉原生轨道，自绘条用 `ITheme.scrollbarSlider*`（`host/terminal-theme.ts`）。同步 `docs/panel.md`“前端”一节的“一页一个竖向滚动者”约定 | 无 | 去掉 `--hide-scrollbars` 截图：窗口右缘没有 15px 空带；同屏最多一条竖条加局部横条；短长数据切换时 `main` 的内容宽度不跳；接管终端的列数与改之前一致（只藏 viewport 的轨道）；会话页仍能滚到底 |
| 2b 导航零件 | 抽出 `parts/PanelNav.vue` 与 `.md`，桌面左栏与手机抽屉共用；上段固定（首页与收件箱、新建、资料、现场与计数），下段是可滚的 Work 树；按路由自动展开所属 Work、高亮当前项、滚进可视区；被截断的标题悬停显示全文；Work 树按 D4 只列进行中的与 30 天内更新过的未标 Work，其余收进“更多”。导航条目来自面板自己的小描述表，路由仍显式声明 | 2a（左栏的滚动所有者） | 900 高时首屏看得到“现场”；Task 页左栏高亮当前 Task；抽屉里有 Task 层且与桌面一致；Tab 次数明显减少 |
| 2c 可调宽度 | nb-ui `Splitter`（`@notnotype/nb-ui/components` 公开入口），见下面的接线细节；D4 的默认 300px、最小 200px、最大取 480px 与视口 40% 中较小的；拖到最小以下收起，另给收起按钮（决定点 8：完全收起，顶栏左侧给展开按钮）；窄屏用抽屉（断点见决定点 7），断点切换时 `RouterView` 不重挂 | 2b | 鼠标、键盘（方向键、Home、End、Esc 取消）都能调；刷新后恢复；窗口变窄时夹住、变宽时恢复用户要的宽度；拖到 360px 后等 20 秒（跨过外壳一次时钟重渲染）宽度不变；断点来回切换时编辑草稿与终端不丢 |
| 2d 顶栏 | 搜索框限宽，加 `/` 与 Ctrl+K 聚焦：焦点在可编辑元素上（输入框、`textarea`、`contenteditable`、xterm 的 `.xterm-helper-textarea`）时不处理，也不在捕获阶段 `preventDefault`（审查建议 6）；正常状态（herdr、推送、数据新旧）合成一个状态点，点开看详情；“代码已更新”“前端构建失败”“审计未开启”与阶段 1 的后台重算失败，改成顶栏下的一条横幅；“通知要处理”保持醒目 | 2a | 1920 宽时搜索框不拉满；正常时顶栏只剩搜索、状态点、通知、明暗；异常时横幅出现；接管中按 Ctrl+K 与 `/`：终端日志收到、搜索框没有获得焦点；编辑页的 `textarea` 里能打 `/` |
| 2e 可访问性小项 | “跳到主内容”；**只在路由名或 params 变化时**把焦点放到页标题，查询参数变化（会话页选会话、文档页选文档、以后的 `?peek=`）不移焦点（审查建议 6）；`document.title` 写成“页面名 · nbdev”；焦点环用 nb-ui 的焦点令牌；承载信息的灰字（表头、编号、元信息）改用 `--text-secondary` | 2b（导航结构定了再做跳转与焦点） | 第一次 Tab 出现“跳到主内容”；标签页标题随页变；在文档树里连续选几份文档，焦点留在树里；亮色下表头对比度不低于 4.5:1 |

先后：2a → 2b → 2c；2d、2e 在 2b 之后，可以并行。

**2c 接 `Splitter` 的接线细节**（审查建议 5）：
- 外壳现在的 grid 整体换掉，不是把 `Splitter` 塞进 grid 的一格：它的根与每块面板都裁切溢出，`main` 的滚动放在右侧面板里面的一层上，正合“一页一个竖向滚动者”；
- `panels` 用 `computed` 生成，不写模板里的字面量数组：未受控时 `panels` 换了一个对象，`Splitter` 就按 `defaultSizePx` 重新分配，而外壳每 15 秒因为时钟重渲染一次，字面量数组会每 15 秒把左栏弹回默认值；
- 左栏的 `defaultSizePx` 绑“用户要的宽度”这份 ref：从 `host/prefs.ts` 同步读（渲染前读到，免得刷新时先 300px 再跳），`gesture-end` 时更新这份 ref 再写 prefs；`maxSizePx` 取 `min(480, 视口 40%)`。这样重新分配是幂等的，窗口变窄时夹住、变宽时恢复；
- “收起”由宿主持有，经 `panels[].collapse.collapsed` 输入，`gesture-end` 的 `collapsed` 映射要回写，否则吸附收起之后下一次重新分配又展开；类型写成 `NonNullable<SplitterPanelConfig["collapse"]>`，不去导 nb-ui 内部的 `grid-types`；不碰 `useSashGesture`；
- 窄屏沿用同一个 `Splitter`、面板 id 不变（它按 id 用 `v-for` 渲染面板，插槽内容不重挂），只把 `sashSizes` 改为 0、左栏 `collapsed`、`disabled`，导航改由抽屉显示；
- iframe 的指针屏蔽不是必须（nb-ui 的手势在根上 `setPointerCapture`），保留也无害。

**两个断点各管什么**（决定点 7）：抽屉的断点从 `md`（768）改到 `lg`（1024），管“左栏是并排还是抽屉”。会话页的“手机”判定（`(max-width: 767px), (pointer: coarse)`）管“给不给接管、默认文字视图还是终端画面”，保持不变；不跟着改到 1024，否则 768 到 1024 宽的桌面窗口会失去接管。

风险：
- **原子类的层序**：nb-ui 的原子类不分层，面板的也不分层，靠加载顺序取胜（omp 建议 6）。新加的面板语义类一律 `nbdev-` 前缀，不给整份 nb-ui 的 CSS 包 `@layer`。
- 2a 把主应用 `app.vue` 末尾那份细滚动条的配方搬过来时，只用标准属性。Chrome 121 以后设了标准属性，`::-webkit-scrollbar` 就被忽略；thin 实际是 10 到 11px，不是 6px（ux-c 实测）。

## 阶段 3：页面骨架与共用零件（轮廓）

| 片 | 内容 | 依赖 | 验收要点 |
|---|---|---|---|
| 3a 语义类 | `app.css` 加少量 `nbdev-` 语义类：字号五档（页标题、区标题、正文、说明、标注）、区块间距、面层（`nbdev-surface`），替换散落的内联 `style` 与重复的 `bg-subtle` 提示块 | 阶段 2 | 各页字号与间距只剩五档、三档；内联 `style` 的条数明显下降（`grep` 计数前后对比） |
| 3b `PageShell` | 面包屑、标题、状态、右上操作槽，内容宽度分三档（阅读、列表、满铺），14 个页面都套；文档页、编辑页补页头。阅读档的卡片宽度跟着正文的阅读宽度走，修掉 Task 页、文档页正文右边的空白。阅读档的宽度怎么算，取决于速览面板是推开正文还是浮在上面（已定，见决定点 17：内容区宽于约 1100px 时并排，阅读档按推开之后的宽度算） | 3a、决定点 17 | 各页标题的顶边位置一致；Task 页、文档页卡片右边不再空一片；首页之外的页面都有可回上一级的面包屑 |
| 3c 反馈零件 | 结果（成功、失败、冲突、结果未知）与附注（警告）分两层：结果颜色只由结果决定、位置固定、不推动内容；附注缩进、可折叠；字段错误只报一次并锚到字段（含新建页提交期的 `details.field`，omp 建议 4）。替换 `WriteNotice` 的用法，阶段 1 的提示一并换过来 | 3a | 新建成功不再是橙色；编辑页的错误不再重复三遍、不推动编辑器 |
| 3d `LoadState` | 骨架屏变体（卡片、表格、详情）；把阶段 1 的 `StaleNotice` 收进来作为“旧数据”变体；404 与网络错误分开，404 给“回到上一级” | 3a、阶段 1 的 1.7 | 加载时左栏与主区不跳；对不存在的 Work 显示“找不到”和上一级链接，不给“重试” |
| 3e 截断零件 | 截断，悬停看全文，点击复制；长 id、路径、分支名都用它；数字用等宽数字 | 3a | checkout 页路径不再需要横向滚动才看得全；左栏与表格里的长标题能看全文 |
| 3f 两级操作 | 主要操作用 `Button`，次要操作用带文字的 ghost 按钮，不再用 11px 的灰字当按钮 | 3b | Work、Task、文档、会话页的入口都是按钮形态 |
| 3g 临时框收敛 | 现场页整页是临时内容，改为分区标题旁一个“临时”小徽标；虚线框只留给混在持久页里的临时片段（Task 页的“谁在动”）；会话页的“无主的运行”只留一个去“在跑”的入口 | 3b | 会话、在跑页不再整页虚线框 |

先后：3a → 3b，其余在 3b 之后可以并行；3c 要在阶段 4 的写入类页面之前。

风险：
- 14 个页面同时换骨架，改动面大，按页分提交，每个提交单独截图对比；
- 不要建通用页面框架或 `useApp` 那样的万能宿主（omp 建议 2、3），只做页头、分节与资源状态这几样。

### 阶段 3 的实施细节（编码子代理 2026-10-14 补）

新零件都放 `parts/`，带同名 `.md`，只经 `@notnotype/nb-ui` 的公开入口用 nb-ui 零件，不改 nb-ui、不改主应用。零件只做页头、分节、写入结果与资源状态这几样：不取数、不读路由、不建通用页面框架或万能宿主。

**3a 语义类**（`app.css`，都带 `nbdev-` 前缀，与面板的原子类一样不分层）：

| 类 | 内容 | 替换的是 |
|---|---|---|
| `nbdev-title` | 页标题：`--text-xl`、600 | 各页 h1 的 `font-size: var(--text-xl)` |
| `nbdev-heading` | 区标题（页面分节、侧栏小节、卡片小节）：`--text-md`、600 | h2 的 `--text-lg` 与没写字号的 `font-semibold` |
| `nbdev-body` | 正文：`--text-sm`、`--text-main`（把局部改回正文） | 少数显式写正文字号的地方 |
| `nbdev-note` | 说明：`--text-xs`、`--text-secondary` | `font-size: var(--text-xs)` 加 `--text-secondary` 的各种写法 |
| `nbdev-caption` | 标注：`--text-2xs`、`--text-secondary` | `--text-2xs` 的小字 |
| `nbdev-empty` | 空状态与占位：`--text-muted` | “没有”“未标”“—” 的 `color: var(--text-muted)` |
| `nbdev-warn`、`nbdev-danger` | 状态色文字：`--status-warning`、`--status-danger` | 对应的内联颜色 |
| `nbdev-stack-page`、`nbdev-stack`、`nbdev-stack-tight` | 竖排，间距三档：区与区之间 1.25rem、区内 0.5rem、列表项之间 0.25rem | `flex flex-col gap-5/gap-2/gap-1` 的各种组合 |
| `nbdev-surface` | 面层：`--panel-surface`、1px `--divider` 边框、`--radius-panel` | 九处 `background: var(--panel-surface); border: …` |
| `nbdev-hint` | 浅底提示块：`--bg-subtle`、`--radius-control`、小内边距、`--text-xs` | 编辑页等处重复的 `bg-subtle` 提示块 |
| `nbdev-num` | 等宽数字（`tabular-nums`） | 计数、版本号、行数 |

内联 `style` 只留真正随数据变的（比例条的宽度、状态色映射）与 iframe 的 `color-scheme`。验收按 `grep` 计数前后对比（基线：静态 241 处、绑定 18 处，`accept/phase3/style-count-before.txt`）。

**3b `PageShell`**：

```ts
interface PageShellProps {
    /** 面包屑，从外到内；最后一项是当前页，不必给 href；可选，默认 []（首页不给） */
    crumbs?: Array<{label: string; href?: string}>;
    /** 页标题（唯一的 h1）；必填。插槽 title 只换显示，读屏与换页挪焦点仍靠这个 h1 */
    title: string;
    /** 内容宽度：reading 按正文阅读宽度收、居中；list 最宽 90rem、居中；full 满铺；可选，默认 list */
    width?: "reading" | "list" | "full";
}
interface PageShellEmits {
    /** 面包屑的普通左键点击（零件已 preventDefault）；中键与带修饰键的交给浏览器 */
    (event: "navigate", href: string): void;
}
interface PageShellSlots {
    title?: () => unknown;    // 替换标题的显示（编辑页的等宽路径）
    status?: () => unknown;   // 标题前：状态徽章
    actions?: () => unknown;  // 标题行右侧：操作（3f 的两级操作）
    meta?: () => unknown;     // 标题下一行：编号、更新时间、来源
    feedback?: () => unknown; // 页头下：这一页的写入结果（3c）
    default?: () => unknown;  // 正文
}
```

- 页头（面包屑、标题行、meta、feedback）在数据到之前就渲染：标题先用编号或页面名，数据到了换成真标题，标题的顶边与高度不跳；各页的内边距与顶边都由它给，标题顶边位置一致。
- 阅读档：容器 `width: fit-content`、最大 100%、居中；页头 `contain: inline-size`，不撑宽容器。正文卡片用 `nbdev-reading-card`（字号取 `--reading-size`，宽度是 `--reading-measure` 加卡片内边距），卡片宽度就是正文的阅读宽度，右边不再空一片；有侧栏（Task 页）时容器宽度是卡片加侧栏。速览面板（决定点 17）推开正文时，容器跟着可用宽度收，不另算。
- 不支持：不取数、不读路由、不管加载与失败（3d 的 `LoadState`）、不管滚动（流式页面由 `main` 滚，铺满页面自己分栏）、不放速览面板（阶段 4）。
- 14 个页面都套：首页不给面包屑；文档页套在右边正文那一栏里（铺满型页面的左栏是文档树）；编辑页的面包屑按路径推出所属的 Work、Task；找不到的页面给“首页”。

**3c `WriteResult`**（替换 `WriteNotice`；`host/writes.ts` 的 `Notice` 改形状）：

```ts
type NoticeOutcome = "success" | "failure" | "conflict" | "unknown" | "info";
type Notice = {
    outcome: NoticeOutcome;   // 结果：颜色与图标只由它决定（成功绿、失败红、冲突与结果未知黄、提示用强调色，即 nb-ui Notification 的 info 色调；审查后改正）
    title: string;            // 一句话的结果
    message: string;          // 原因或下一步；与 title 重复时留空
    items: string[];          // 结果的明细（没锚到字段的问题、写入了没提交的路径），已与 message 去重
    notes: string[];          // 附注：服务端的警告；缩进、默认折叠，不改变结果的颜色
    retry: boolean;           // 只在确定什么都没写的失败给“重试”
};
interface WriteResultProps { notice: Notice }
interface WriteResultEmits { (event: "dismiss"): void; (event: "retry"): void }
```

- 不自己消失、不计时；位置由宿主放：有操作栏的页面（编辑页、新建页）放在操作栏里，出现时不推动编辑器与表单；其余放在 `PageShell` 的 `feedback` 插槽。
- 字段错误只报一次：`failureNotice` 多一个参数，表单能锚到的字段（新建页的 `details.problems[].field` 与 `details.field`）交给表单显示，结果里只写“表单里标出了 N 处”；锚不到的才进 `items`。
- 成功带警告不再变黄：`successNotice` 的结果是 success，警告进 `notes`。

**3d `LoadState`**（收进 `StaleNotice`，删掉后者）：

```ts
interface LoadStateProps {
    loading: boolean;                                   // 宿主已延时过的加载信号
    error?: {message: string; status?: number} | null;
    hasData?: boolean;                                  // 已有数据：error 只画一行“旧数据”提示（原 StaleNotice）；默认 false
    receivedAt?: string | null;                         // 旧数据是什么时候读到的
    label?: string;                                     // 加载说明，默认“正在读取”
    retryable?: boolean;                                // 默认 true
    upHref?: string | null;                             // 404 时“回到上一级”去哪里；没有就不给链接
    upLabel?: string;                                   // 默认“回到上一级”
}
interface LoadStateEmits { (event: "retry"): void; (event: "navigate", href: string): void }
```

- 四种形态：加载（转动的指示加说明）、找不到（404：说明加回上一级的链接，不给重试）、失败（原因加重试）、旧数据（一行提示，404 时同样不给重试）。没有数据时占一块固定的最小高度。
- 不做骨架屏：nb-ui 界面开发规范第 4.3 节第 8 条“不做骨架”（占位形状会暗示一个还不知道的结构），与阶段 3 表格里“骨架屏变体”冲突，以规范为准。“加载时不跳”改由页头先渲染、加载块占固定最小高度做到。
- 宿主用 `host/panel-data.ts` 新增的 `loadStateOf(resource)` 拿到前四个属性，页面只补 label 与上一级。

**3e `TruncatedText`**：

```ts
interface TruncatedTextProps {
    text: string;          // 全文；必填
    mono?: boolean;        // 等宽（路径、id、分支名、sha）；默认 false
    copyable?: boolean;    // 点击复制；默认 true。为 false 时只截断加悬停全文
}
```

- 单行截断，被截断时悬停或聚焦用 nb-ui `Tooltip` 显示全文；可复制时是一个按钮，点了复制全文，提示改成“已复制”。`env:clipboard` 是它自己的隐藏通道（配方偏离，理由写进 `.md`：复制是这个零件存在的目的，每个用到它的宿主各写一遍复制更乱）。
- 不支持：多行截断、可编辑、链接（链接里的长标题用 `Tooltip` 包链接，不用它）。

**3f `ActionLink`**：去别的页的操作（编辑 README、新建 Task、看文档、单独打开）是带图标与文字的链接，样子是 ghost 按钮：

```ts
interface ActionLinkProps { href: string; icon?: string; external?: boolean }
interface ActionLinkEmits { (event: "navigate", href: string): void }   // 普通左键点击；external 时不发，交给浏览器
```

- 用链接而不是 nb-ui `Button`：`Button` 只渲染 `<button>`，不能中键开新标签页、复制地址，面板的约定是去别的页的入口都是真实链接。主要操作（写入）仍是 nb-ui `Button`。

**3g 临时框收敛**：会话、在跑页整页是临时内容，分区标题旁放一个“临时”小徽标（`nbdev-ephemeral-tag`），不再整页虚线框；虚线框（`EphemeralFrame`）只留给混在持久页里的临时片段（Work 页的“现在谁在动”、Task 页的“谁在动”）；会话页的“无主的运行”只留一个去“在跑”的入口。

**提交的切法**：3a、3b、3c、3d、3e 与 3f 的零件各一个提交（3c 连同 `Notice` 改形状与各页换零件一起提交，接口变了不能分开）；14 个页面换骨架按页分提交，每个页面的提交里同时用上 3a 的语义类、3d、3e、3f 与 3g；最后一个提交删掉不再用的 `StaleNotice`、`WriteNotice`。

## 阶段 4：逐页改进

阶段 4 改动面大、几处要改服务端，分五批做，**每批单独审查、单独合入 `master`**，合入一批再开下一批（主 Agent 2026-10-14 定）。下面先是分批，再是第 1 批的细化；第 2 批起开工前再按同样的格式细化。“各页的内容”一节是原来的轮廓，各批引用它。

### 分批

| 批 | 内容 | 服务端改动 | 并入的后续清单条目 | 验收要点 |
|---|---|---|---|---|
| 1 | **产物页与收件箱**：多选题点了页面变空白；产物页分“待答、已答、之前几版的题、已取代与撤回”；“新”题标记；提交栏贴底；成功提示写答了什么；中间页面与右边表单各自滚动；iframe 抽成 `ArtifactFrame`；首页收件箱按产物合并 | 答复只收这一版里还能答的题（新错误码 `question_retired`）；`status` 的收件箱条目加 `artifactTitle` | 10-14 多选题空白；10-14 第二轮答复带了第一轮的旧题；10-14 产物有版本吗、v2 为什么还显示第一组题还能改；10-14 产物页联动滚动；10-13 收件箱一个产物出多条 | 见下面第 1 批 |
| 2 | **首页其余与 Work、Task 页、左栏的 Work 列表**：撞号写明原因与去处；Work 排序与卡片紧凑；Work 页 Task 行就地展开（同时最多 3 行）；Task 页状态只一处、速览面板（D1、决定点 10、17，用第 1 批的 `ArtifactFrame`）；左栏 Work 列表的状态色、角标、筛选与排列方式 | 收件箱的撞号条目带 `ids`（各个 id 与所在位置） | 10-13 Work 页就地展开；10-13 Task 页 Markdown 右边空白（3b 已改阅读档，这批复核）；10-13 在 Task 页点产物整页跳走；10-14 首页撞号看不到原因；10-14 左栏加颜色、图标；10-14 左栏按分类、优先级展示 | 见下面第 2 批 |
| 3 | **会话页**：左列表右详情两栏、铺满；终端定高；发送快捷键；接管时 `Ctrl+]` 退出（决定点 11）；D2 任意 pane 只读观看与往回翻 | D2：`/api/sessions` 列出非 Agent pane、`/ws/terminal` 只读观看、`takeover` 显式闸门、`pane.read` 进白名单 | 无 | 见“要改服务端的几处”的 D2 一行；假 Claude 与 omp 的 pane 上各按一次 `Ctrl+]` |
| 4 | **现场三页与文档页**：checkout 整行可点、“需要注意”同一种颜色、未跟踪计数与文件清单；文档页“渲染 / 与 master 的差异”切换、“只看有差异的”与 checkout 进网址、手机上树进抽屉、外站图片的处理 | checkout 未跟踪计数与 `/api/checkouts/:key/files`；`/api/docs/diff` | 推迟事项：文档页外站图片被 CSP 拦下 | 每个 checkout 各自超时；差异与文档树同口径 |
| 5 | **编辑页与搜索**：面包屑回 Task（阶段 3 已做，复核）、贴底操作栏加“放弃”与 Ctrl+S、站内离开用面板自己的确认框；搜索记录类命中放前、相关度排序、文件命中高亮、`.agents/tasks` 默认折叠 | 搜索排序若要服务端给相关度再定 | 无 | 路由守卫等异步确认的改法先试 |

### 第 1 批：产物页与收件箱（2026-10-14 细化）

#### 提问的领域模型与“旧题”

依据 `packages/dev-panel/docs/file-formats.md` 的“产物版本”“新版本的题表”“状态现算”与 `core/artifacts.ts` 的 `nextQuestions`：

- 产物每发布一次是一版（`versions/vN.json`），**最新一版带全部题**，被取代、撤回的也在；状态只看最新一版与答复。
- 每道题有 `since`（第一次出现的版本）、`origin`（`markup` 来自页面标记，`ask` 来自 `nbdev ask`）、`page`（题所在的页面）、`outcome`（`null` 活的，或 `withdrawn`、`superseded`）。
- 发新版时，上一版来自页面、这次页面里没有了的题：**没答过的**记为被本版取代；**已经答过的**保留为活的题，`page` 改成 `null`（`--keep` 保留的题 `page` 不变）。
- 答复是 `answers/<id>.json`，`values` 只含这次填的题，按答复针对的那一版校验；确认（ack）记会话采纳到哪一份答复，与界面无关。

所以开发者在 v2 看到的“第一组题”是第二种情形：**v1 的题、已答、v2 页面上已经没有（`origin` 为 `markup`、`page` 为 `null`、`outcome` 为 `null`）**。它们还活着，只是为了让答案留在题表里；现在的表单把它们当成“能答的题”，预填旧值、能改，看起来和本轮的题一样。下面把这种题叫“之前几版的题”。

- **显示**：放在“已答”下面单独一组“之前几版的题（这一版页面上已没有）N”，默认折叠，只读，写答案、针对哪一版、什么时候答的与说明，不给控件。
- **服务端**：`submitAnswer` 拒收这种题，新错误码 `question_retired`（退出码 3，HTTP 409，`details.questionId`），判据抽成 `core/questions.ts` 的一个纯函数，面板与核心共用。`answers record`（代录）同样受这条约束。`file-formats.md` 的“答复”与 `cli.md` 的错误码表同步。
- 旧题怎么进了第二轮答复（Agent 报的“缩进参考线”）：在 4490 上用 t86 review 的副本按键盘聚焦、Tab、方向键试过，计数不变，没有复现出控件自己触发；最可能是开发者在和本轮题混在一起的旧题上点了一下。上面两条改动对两种原因都有效。

#### 多选题点了页面变空白（开发者 10-14 报）

在 4490 上复现：把真实仓库 w00017 t86 review 产物的 v1 到 v3 与前两份答复复制进验收克隆（`t15-ui-polish/artifacts/t86-review`，克隆提交 `548524ef9`），在 v3 的多选题 `r3-filter-match` 上点第二个选项，右侧正文整块变空，只剩左栏。uxq 的多选题不复现，因为它的表单短、不用滚。

根因：nb-ui `CheckboxGroup` 的选项是 `label` 包一个 `sr-only` 的 `<input>`（`position: absolute`）。点选项时焦点给了这个 input。它的包含块不是会滚的 `main`，而是外面 nb-ui `Splitter` 那一格（`relative`、`overflow: hidden`）：`main` 滚了 4179px 也挪不动它，浏览器为了把它滚进视野，接着把 `overflow: hidden` 的那一格滚了 3785px，整页内容被推出视野。单选题的 `RadioGroup` 用的是 `button`，不受影响。

修法：滚动容器做绝对定位后代的包含块。`main` 与 `.nbdev-scroll-y` 加 `position: relative`，页面里自己开的滚动容器（文档页、产物页的两栏、checkout 表）也加 `relative`。补一条静态测试：扫 `src/web` 的模板，凡是开了滚动的元素（`overflow-*-auto`、`overflow-*-scroll`、`nbdev-scroll-y`，等宽预览块 `pre` 除外）都要带 `relative`，并核对 `app.css` 里 `.nbdev-scroll-y` 有 `position: relative`。浏览器验收里重放这次复现。不改 nb-ui（D3），nb-ui 侧的同类风险记一笔，交 nb-ui。

#### 改动

1. **多选题空白**：见上，一个提交，含测试。
2. **服务端：只收这一版里还能答的题**：见上，一个提交，补在核心测试“场景 2 与第 11 条”里（HTTP 按退出码统一映射成 409，不另测）。
3. **服务端：收件箱条目带产物标题**：`status` 的 `inbox[]` 问题条目加 `artifactTitle`（最新一版的 `title`，可能为 `null`），`cli.md` 同步。一个提交。
4. **`ArtifactFrame` 零件**：iframe 连同“页面是当前版本”那行说明抽成 `parts/ArtifactFrame.vue` 与同名 `.md`（`sandbox`、不给 `allow-same-origin`、亮色垫白底的理由写进 `.md`），产物页先用上，第 2 批的速览面板再用。
5. **产物页布局：两栏各自滚动**：路由元信息声明“铺满”；宽屏（`lg` 以上）时页头不动，左边 iframe 占满剩下的高度（iframe 自己滚），右边侧栏自己滚；窄屏时上下堆叠，整页由页面根滚动，仍只有一个竖向滚动者。`docs/panel.md` 的“滚动”与“加一个页面”同步。
6. **产物页侧栏分段**（`AnswerForm`、`QuestionPanel` 改造）：
   - **待答**：这一版里能答、还没答（含旧答复作废要重答）的题，给控件；必答在前；`since` 等于最新一版且不是 v1 的题标“新”；
   - **已答**：这一版里能答、已经答了的题，只读显示答案、针对哪一版、什么时候答的与说明，每题一个“改答”，点了才变成控件；
   - **之前几版的题**：见上，默认折叠，只读；
   - **已取代与撤回**：默认折叠，写明在哪一版、被什么取代；
   - **提交栏贴底**：侧栏滚动容器底部的 sticky 栏，写“已改 N 题 · 还有 M 道必答没答”与提交按钮；提交的结果也放在这一栏里（提交时人在底部，结果放顶上看不到）。
   - **成功提示写答了什么**：结果的明细逐题写“题目：答案”，提交号放在说明里。
   - 答案的文字（选项名、同意与不同意）抽成 `host/answers.ts` 的函数，表单、问题侧栏与成功提示共用。
7. **首页收件箱按产物合并**：同一产物的待答题合成一行，“产物标题（或 id）：N 道待答”，下面列前三道题的题目与“等 N 道”，提问的会话去重后列出；撞号不变。左栏“首页与收件箱”的数字仍是待答题数加撞号数（与原来一致）。`InboxList.md` 同步。

#### 验收（4490，证据 `accept/phase4/batch1/`）

- 多选题：t86-review 副本上点多选题的选项，页面不空白、正文与侧栏都在原位，点中的选项打勾；改前改后各一张截图。静态测试在改前的代码上失败、改后通过。
- 旧题：t86-review 副本的 v3 页面上，v1、v2 已答、页面上没有的题只在“之前几版的题”里，没有控件；用接口直接提交一道旧题，回 409 `question_retired`，克隆里没有新答复文件。
- 三段与“新”：待答、已答、之前几版的题、已取代与撤回分开；v3 新加的题标“新”；已答的题点“改答”才有控件。
- 提交栏：侧栏滚到最上面时提交栏仍在底部可见，写“已改 N 题 · 还有 M 道必答没答”；提交成功后结果在栏里，明细逐题写答了什么。在克隆里真提交一次。
- 各自滚动：1440 宽时滚动侧栏，iframe 的位置不变；滚动 iframe 里的页面，侧栏不动；页面根不滚。用 t86-review 与 uxq 各看一次；390 宽时上下堆叠、整页一个滚动者、没有横向溢出。
- 收件箱：uxq 与 t86-review 各合成一行，写待答题数；点进去到产物页。
- 明暗、390 与 1440 的截图：产物页、首页。

### 第 2 批：首页其余、Work 页、Task 页与左栏（2026-10-14 细化）

出处：design.md 阶段 4 的首页、Work 页、Task 页与 D1；终稿第 9、10、17 条；后续清单 10-13 的“Work 页就地展开”“Task 页 Markdown 右边空白”“Task 页点产物整页跳走”，10-14 的“首页撞号看不到原因”“左栏加颜色、图标”“左栏按分类、优先级展示”。

#### 改动

1. **服务端：收件箱的撞号带上各个 id 与位置**。`status` 的 `inbox[]` 里 `number_conflict` 现在只有 `label` 与 `live`，首页写不出原因。加 `ids`（与 `conflicts[]` 的元素同形：`{id, live, locations}`），`cli.md` 同步，测试补一项。向后兼容，只多字段。
2. **首页**：
   - 撞号一行写明原因：哪几个 id 用了同一个号、各在哪里（主工作区、哪个 worktree、哪个 ref），哪些只是改名或删除后留下的旧副本；给出去处：“怎么处理”链到 `.agents/works/README.md` 的处理办法（文档页），“正在发生”的标出来；
   - “等我”：收件箱上方加一行“通知要处理 N 条”（与顶栏同一个计数），链到会话页的通知；
   - Work 排序：有事等我的（有待答题）在前，其次进行中，再按最近更新；
   - 卡片紧凑：目标收到两行，内边距与间距收小。
3. **左栏的 Work 列表（只用现有数据）**：
   - 每个 Work 行：编号前一个状态色点（进行中、完成、搁置、未标、状态写坏各一种颜色，与 `StatusChip` 同色），行尾的角标：有待答题时“待答 N”（警告色），有会话在动时一个小图标；
   - “工作”标题旁加一个筛选框（按编号或标题，含“更多”里的 Work），和一个“排列”切换：编号（缺省，即现在的 D4 取舍）、最近更新、有事等我优先、按状态分组（进行中、未标在前；完成、搁置默认折叠）。排列方式记进偏好（`host/prefs.ts`），筛选不记；
   - 键盘与读屏：树仍是一个 Tab 停靠点；筛选框与切换在树外；分组标题不算树项。
4. **Work 页**：
   - 状态只显示一处：标题旁的状态徽标；状态切换改成一个“改状态”按钮，点了才出下拉与确认（`StatusSwitch` 改造，Task 页同用）；
   - Task 表就地展开（决定点 9）：每行前一个展开按钮，展开后在行下面显示“当前状态”“下一步”（取 README 这两节，渲染 Markdown）、产物（带待答数，点了去 Task 页并打开速览）、证据、谁在动。展开时才取这个 Task 的接口（`/api/task`），**同时最多 3 行**，展开第 4 行时收起最早展开的那行。取数在页面（宿主）里，用 3 个固定的资源槽，零件只显示；
   - nb-ui `Table` 不支持行展开（它的 `.md` 写明“由消费方组合”），Task 表改成自己的网格列表，列与现在相同；标题列加宽、单行截断（悬停看全文）；“当前情况”按行内 Markdown 渲染（新函数 `renderInlineMarkdown`，与 `renderMarkdown` 同一套清洗与链接改写）；为 0 的产物数、待答数淡化。
   - 取 README 的节：把 `readSection` 挪到一个不依赖 `yaml` 的核心纯模块，前端直接导入，不复制。
5. **Task 页**：
   - 状态只显示一处（同上）；正文卡片的阅读宽度在 1280、1440、1920 下复核（3b 已改）；
   - **速览面板**（D1、决定点 10、17）：侧栏里的产物、文档、Spec、证据（文件）点了不整页跳走，在速览面板里打开；中键与带修饰键照常在新标签页开完整页。状态写进网址 `?peek=`（`artifact/<id>`、`doc/<checkout>/<path>`、`evidence/<path>`，解析与拼写放在 `host/peek.ts`，有单元测试），用 `router.push`，后退就关；
   - 面板内容：产物显示 `ArtifactFrame`（说明“页面是当前版本（磁盘上的）”）加状态行（状态、待答数、版本）与“去答复”“打开完整页”，不放答复表单；文档与 Spec 显示渲染后的 Markdown 与“打开文档页”；证据文件用 `ArtifactFrame` 原样显示（产物来源上的地址，沙箱相同）；
   - 布局按决定点 17：内容区（`main`，不含左栏）宽于 1100px 时面板在右边并排、推开正文；窄于它时浮在正文上，正文上加一层半透明遮罩，点遮罩关闭；手机（390）整屏。面板固定在内容区里（`position: fixed`，按 `main` 的位置与大小放，正文照常由 `main` 滚），并排时给正文留出面板的宽度；
   - 打开时焦点到面板标题，有可见的“关闭”按钮；焦点在面板里（iframe 外）时 Esc 关闭；关闭后焦点回到打开它的那个链接；
   - 外壳零件 `PeekPanel`（标题、操作、关闭、正文插槽、三种布局）与同名 `.md`；取数在 Task 页。

#### 决定点 18：左栏按“分类”“优先级”展示（开发者已定：A，另开 Task）

Work 与 Task 的记录里现在没有分类和优先级：frontmatter 只有 `schema`、`id`、`issueId`、`status`、`updated`（见 `file-formats.md`）。只用现有数据能做的（状态色、待答角标、在动图标、筛选、按状态分组、按最近更新或有事等我排序）已列在上面第 3 条，照做。要按分类、优先级展示，得改记录格式，选项：

- A：Work README 的 frontmatter 加可选的 `category`（自由文字，例如“nb-ui”“dev-panel”“小说”）与 `priority`（`p0` 到 `p3`）；`nbdev work new` 加 `--category`、`--priority`，另给 `nbdev work set` 改这两项；治理检查与 `file-formats.md` 一起改；左栏多两种排列：按分类分组、按优先级排序；
- B：不改记录，分类按 Work 的 slug 前缀或标题关键词在面板里配置（存在本机偏好里），优先级不做；
- C：先不做分类与优先级，只用上面第 3 条。

推荐 A（真相源在记录里，命令行与面板一致），但它动记录格式与治理检查，范围超出 t15 的界面打磨，可能要单独一个 Task。

开发者 2026-10-14 定：选 A，另开一个 Task 做，t15 不等它。与后续清单里的“项目看板、排期”一起考虑。

#### 验收（4490，证据 `accept/phase4/batch2/`）

- 撞号：首页那一行写出两个 id 与各自的位置，“怎么处理”能打开 `.agents/works/README.md`；
- 首页：有待答题的 Work 卡片排在最前；卡片目标两行；有要处理的通知时首屏有那一行；
- 左栏：状态色点与 `StatusChip` 同色；有待答的 Work 有角标；筛选“w00022”只剩它，筛选标题关键词能找到“更多”里的 Work；四种排列切换后刷新还在；键盘方向键照旧；
- Work 页：状态只有一处；展开一行看到当前状态、下一步、产物、证据、谁在动；依次展开 4 行，第 1 行自动收起，网络里同时只有 3 个 Task 接口在订阅；“当前情况”里的链接渲染成链接；
- Task 页：状态只有一处；点产物、文档、Spec、证据都在面板里打开，网址带 `?peek=`，后退关闭、刷新还在、把网址贴进新标签页直接打开；中键开新标签页是完整页；1920 与 1440 并排、正文不窄于阅读宽度，1280 宽、左栏拖到 480 时变成浮层（有遮罩，点遮罩关），390 整屏；焦点到面板标题、Esc 关闭、关闭后焦点回到原来的链接；
- 明暗、390 与 1440 的截图：首页、Work 页（含展开）、Task 页（含速览）；速览另截 1280 与 1920。

### 第 3 批：会话页重新设计（2026-10-14 设计稿，等开发者确认后再实现）

开发者 10-14：会话页“有点丑”，尤其“屏幕与输入”第一次用时不知道那里能点，要重新设计。这一批分两步：先出设计稿给开发者看，确认后再实现。线框稿是静态 HTML（不是面板代码），截图在 `.local/agent/works/w00022-dev-panel/tasks/t15-ui-polish/accept/phase4/batch3/design/`：`desktop-1440-watch.png`（观看中，无标注）、`desktop-1440-watch-notes.png`（同一张带标注）、`desktop-1440-control.png`（接管中）、`desktop-1440-pane-readonly.png`（非 Agent 的 pane，只读）、`phone-390-list.png`、`phone-390-detail.png`；源文件 `wireframe.html`。

出处：
- design.md 阶段 4 的会话页（左列表右详情、选中高亮；终端定高，输入框、按键行、投递结果紧贴终端；写明发送快捷键；接管时固定的退出组合键）、D2（任意 pane 只读观看、能往回翻；发消息与接管只对 Agent 会话）；
- 终稿第 11 条（`Ctrl+]` 退出接管，“释放”仍是主要入口）、第 16 条（观看非 Agent 的 pane、读它的历史不写审计）；“要改服务端的几处”的 D2 一行（接管闸门显式要求 Agent 会话）；
- 阶段 2 的实测：xterm 自绘滑块宽 14px，盖住最后一列，加回滚后量列数先减掉（`TerminalView.md`）；
- 后续清单 10-14 的“会话页不好看、屏幕与输入不好发现，重新设计”“会话只显示成 `claude c38df555`，希望加标题”；
- ux-b 的 F2（非 Agent 的 pane 看不到、桌面没有往回翻）、F3（终端占满一屏、输入框在屏幕以下、选中项没高亮、没有发送快捷键提示）、F13（接管后没有固定的退出键、“接管中”与“观看中”的条差别太小）；ux-c 的 R4（终端高度等于窗口、滚轮被吞、输入区要滚才看到，建议会话页“铺满”）；ux-a 的 R4（“屏幕与输入”是 11px 小字、是进终端的唯一入口）、R5（会话页的“无主的运行”只留入口，3g 已做：会话页现在只有一行“N 个无主的运行 去‘在跑’看”）。

#### 页面结构

“铺满”页（路由 `layout: "fill"`）：页头（面包屑、标题“会话”、说明行写 herdr 的版本与推送状态）下面两栏，左列表、右详情，各自滚动，页面本身不滚。

- **左列表**（约 330px），自上而下：
  1. 通知一行：“通知 · N 条要处理”（没有要处理的写“通知”），点了右边显示通知（现在页面顶上的那一块搬进右栏，网址 `?view=notify`）；顶栏的“通知要处理”也链到这里；
  2. **Agent 会话**（本仓库，herdr 认得出会话的 pane 加持有租约或运行的会话）：每行是一整块可点的按钮形链接，选中的那行高亮（强调色底加边框）；排序：等确认、工作中、完成一轮、空闲、不在 herdr 里、已结束；
  3. **其它 pane（只读）**：本仓库里没有 Agent 会话的 pane（开发服务、构建日志、shell），点了只读观看；
  4. 底部：“N 个无主的运行 去‘在跑’看”（保留 3g 的入口）；“不在本仓库的会话 · N”默认折叠，只列出、不能打开（见决定点 20）。
- **列表行显示什么**：第一行状态点、标题、状态字（等确认、工作中、空闲、完成一轮、只看、已结束，颜色与状态点一致）；第二行 Agent、pane 号（等宽）、所属 Task（租约的徽标，多个就几个）、运行数，或“没有租约”。已结束的会话标题划掉，写“会话进程已退出”。非 Agent 的 pane 用虚线方块代替状态点；标题：这格里有登记过的运行（t14 的运行登记、无主的运行带 pane 号）时取它的命令（如“bun run dev（w00022-dev-panel）”），否则取“pane w2:p1”加前台目录名（herdr 不给前台进程名）；全屏程序注明“不能往回翻”。
- **右详情**，自上而下：
  1. 头：标题（h2）、状态徽标；说明行：Agent、pane、会话 id 的短号（点一下复制完整 id，`TruncatedText`）、租约的 Task（链到 Task 页）、运行数、标题的来源（“标题取自 Claude Code”）；
  2. **模式条**：观看中是浅底一行“👁 观看中 · 实时画面，只读；键盘在 herdr 那边”，右边主按钮“接管键盘”，旁边写“接管后按 Ctrl+] 退出”；接管中整条换成醒目的强调色实底“⌨ 你在接管键盘 · 你打的字直接进这一格”，右边“按 Ctrl+] 退出”与“释放”按钮（反白）。两种状态的差别一眼可见（F13）；
  3. **终端**：占满剩下的高度（`flex-1`，最小 16rem），带回滚（xterm `scrollback`，例如 5000 行），量列数时先减掉 14px 的滑块；滚轮在终端里滚终端，页面不滚（R4 的问题随“铺满”消失）；
  4. **输入区（贴在终端下面）**：投递结果一行（“已投递‘…’· 12 秒前 · 会话变成工作中”，取代现在漂在别处的 WriteResult）；能不能发的一行（“工作中：空闲之后才能发文字（不排队）；要打断用下面的 Esc”）；输入框（两行起、最多六行自动长高）与“发送”按钮，按钮上写 `Ctrl+Enter`，输入框里 Enter 换行、Ctrl+Enter（Mac 上 ⌘+Enter）发送；按键一行（↑、↓、Enter、Esc、Ctrl+C、Shift+Tab、y、n），要先确认的键带“确认”小标记，行尾一句“带‘确认’的键先给你看屏幕再发”。

#### 三种宽度

- **桌面**（内容区宽于约 1100px）：两栏如上，左栏 330px。
- **窄屏**（768px 到约 1100px，或左栏拖宽之后）：左栏收成约 260px，行里只留标题、状态与 pane 号，Task 徽标收进悬停；再窄（内容区小于约 900px）左栏收起，详情上方给一个“切换会话”下拉。用内容区宽度判断，与速览面板的决定点 17 同一个做法。
- **手机**（390）：两步。先是整屏列表（`phone-390-list.png`），点一行进整屏详情（`phone-390-detail.png`，网址带 `?pane=`，顶上“‹ 会话”回列表，后退也回列表）；详情默认文字视图（实时），可切“终端画面（只看）”；输入区贴底；按键一行横向滑动；手机上不给接管（沿用现在的规则）。

#### 详情区的几种状态

| 状态 | 模式条 | 终端 | 输入区 |
|---|---|---|---|
| Agent 会话，观看中 | 浅底“观看中”，主按钮“接管键盘”，写明 Ctrl+] | 实时、只读、可回滚 | 输入框与按键可用；工作中、等确认时输入框禁用并写原因，按键照常 |
| Agent 会话，发消息后 | 同上 | 同上 | 结果行写“已投递 … · 会话变成工作中”；失败写原因与“重试” |
| Agent 会话，接管中 | 强调色实底“你在接管键盘”，“按 Ctrl+] 退出”与“释放” | 键盘直通；`Ctrl+]` 由面板拦下、不发给这一格 | 输入框收起（直接在终端里打字），按键一行单击即发；写“15 分钟没有输入自动释放” |
| 另一个浏览器在接管 | 写“面板的另一个浏览器正在接管（几分钟前起）”，接管按钮换成“抢过来”（要确认，沿用现在的冲突流程） | 只读 | 输入框禁用 |
| 非 Agent 的 pane | 浅底“观看中 · 只读”，右边“更早的输出（1000 行）”；全屏程序时没有这个按钮，写“全屏程序，只能看当前屏” | 实时、只读 | 没有输入区与按键；一句“只读观看不写审计。要在这一格里操作，回 herdr” |
| 会话已结束（进程退出）或 pane 关了 | 灰底“会话已结束 · 几分钟前” | 留最后一屏（读得到的话），盖一层浅灰 | 没有输入区；租约写“待回收” |
| 没选任何会话 | — | — | 桌面右栏显示通知（有要处理的）或一句“在左边选一个会话：看它的屏幕、发消息或接管键盘”，见决定点 21 |

#### “屏幕与输入”怎么一眼看出能用

- 不再有单独的“屏幕与输入”小字按钮：**列表的每一行本身就是入口**（整行按钮形、悬停有底色、选中高亮），选中后右边直接是终端与输入区，同一屏里看得到、打得了字；
- 输入区始终贴在终端下面，不用滚；“发送”是主按钮，快捷键写在按钮上；
- 模式条把“现在是只读观看”写成一句话，并把“接管键盘”做成主按钮；接管中整条变色；
- 没选会话时右栏不空着，写明下一步（或按决定点 21 自动选中）。

#### 会话标题从哪里取（已查）

- **herdr 没有**：0.9.3 的 `pane list` 只有 `agent`、`agent_session`（会话 id）、`agent_status`、目录与滚动信息；`tab list` 的 `label` 是序号，`workspace list` 的 `label` 是工作区名（例如目录名）；`api schema`、`api snapshot` 里没有标题字段。
- **Claude Code 有**：`~/.claude/projects/<项目目录>/<会话 id>.jsonl` 里反复写 `{"type":"ai-title","aiTitle":"…"}`（自动起的标题，随对话更新）与 `{"type":"agent-name","agentName":"…"}`（命名过的会话）；也有用 `/rename` 写的 `custom-title`（本机的会话文件里没见到）。文件可能很大（实测一份 467 MB），只读末尾一段（例如最后 256 KB）里最后一条即可。优先级：`custom-title`、`agent-name`、`ai-title`。
- **Codex 有**：`~/.codex/session_index.jsonl` 每行 `{"id", "thread_name", "updated_at"}`，按会话 id 取最后一条。
- **omp 有**：会话文件第一行是 `{"type":"title","title":"…","source":"auto"}`（原地改写的定长头），读第一行即可。
- **取不到时**：用这个会话持有的租约的 Task（“w00022/t15 面板界面打磨”）；没有租约用现在的短号“claude c38df555”。详情的说明行写标题的来源，读者知道这是 Agent 起的名字，不是记录里的。
- 会话文件是本机的运行时数据，不入库；面板服务端只读、按（路径、大小、修改时间）缓存，不写审计。

#### 服务端要改什么

1. **会话标题**：`/api/sessions` 的 pane 与会话各带 `title: {text, source} | null`（`source`：`claude-custom`、`claude-agent-name`、`claude-ai-title`、`codex`、`omp`）；只读本机的会话文件，按文件大小与修改时间缓存；Claude Code 只读末尾一段；读不出就是 `null`，不报错（警告进日志）。
2. **D2 观看任意 pane**：`/api/sessions` 已经列出全部 pane（`agent` 为 `null` 的也在）；`/ws/terminal` 的 `open` 放开对 Agent 会话的要求，只允许观看本仓库里的 pane（范围见决定点 20）。**接管的闸门显式写**：`takeover` 先要求 `pane.agent !== null`、`keyOf(pane) !== null`、`typeof expectedSession === "string"`，否则回 `not_allowed`、不关连接、照常观看；`/api/sessions/:pane/prompt`、`/keys` 补测试钉住“非 Agent 的 pane 回拒”。
3. **往回翻**：Agent 会话用 xterm 的回滚（终端流本身带历史时）；非 Agent 的 pane 另给“更早的输出”：`pane.read`（`recent_unwrapped`，1000 行）加进 herdr 方法白名单（只读），接口沿用 omp 的 history；前台程序在备用屏（vim、less、htop、带 TUI 的开发服务）时不给，只给当前屏。先实测：`terminal session observe` 对非 Agent 的 pane 能不能用、0.9.3 上 `pane.read` 的参数与副作用、怎么判断备用屏；白名单变化同步 `docs/herdr.md` 与 `tests/delivery.test.ts`。
4. **不写审计**：观看非 Agent 的 pane、读它的历史都不写（终稿第 16 条）；`panel-terminal` 的 L3 测试钉住“审计里没有 takeover 行”。
5. **`Ctrl+]`** 不改服务端：终端零件在 xterm 的按键钩子里拦下 `Ctrl+]`，当成“释放”，不发给 pane。实施时在假 Claude 与 omp 的 pane 上各按一次，确认不被吞掉、也不触发别的动作。
6. **在跑页**：“无主的运行”“会话派出的运行”里的 pane 号做成链到 `/live/sessions?pane=…` 的链接（F2）。

#### 决定点（要开发者定）

- **决定点 19：会话标题从本机的 Agent 会话文件里读。** 推荐：读（Claude Code 的 `custom-title`、`agent-name`、`ai-title`，Codex 的 `session_index.jsonl`，omp 会话文件第一行），取不到用租约的 Task，再不行用短号。另一个选项：不读会话文件，只用租约的 Task 当标题（零风险，但没有租约的会话仍是短号）。
- **决定点 20：只读观看的范围。** 推荐：只看本仓库里的 pane（目录在主工作区或某个 worktree 里，与现在“本仓库”的判定相同）；不在本仓库的会话只列出、不能打开。另一个选项：herdr 里的任意 pane 都能只读观看（会把与本仓库无关的终端带进面板）。
- **决定点 21：没选会话时桌面右栏显示什么。** 推荐：自动选中最需要看的那个（等确认，其次工作中，再其次最近活动的），网址用 `replace` 写上 `?pane=`，不加历史；有要处理的通知时先显示通知。另一个选项：不自动选，右栏显示通知或一句引导。手机上都不自动进详情。
- **决定点 22：通知放在哪里。** 推荐：左列表最上面一行“通知 · N 条要处理”，点了在右栏显示（`?view=notify`），顶栏的“通知要处理”也链到这里。另一个选项：保持现在的页面顶部一块（铺满之后它会挤占终端的高度）。
- **决定点 23：Claude 会话的“更早的输出”。** 推荐：先只靠 xterm 回滚（观看开始之后的输出）；Claude 的完整历史在它的会话文件里，渲染对话记录是另一个功能，这一批不做。另一个选项：这一批顺带做“读会话文件里最近 N 条消息”的文字面板。
  - **实测与改定（2026-10-14，第 3 批实现审查第 6 条）**：xterm 回滚这条路走不通。herdr 0.9.3 的观察流在增量帧里按光标定位逐行改写整屏、不换行滚屏，xterm 攒不下回滚；Claude 在备用屏上，herdr 报的回滚（`max_offset_from_bottom`）是 0，`pane.read` 也只能读到当前屏。开发者定：这一批不承诺 Claude 会话在面板里往回翻。终端不开回滚；读不到更早输出的会话写“只能看当前屏；更早的输出去 herdr 里翻”；omp 与没有会话键的 pane 的“更早的输出”照旧。
- **定稿（2026-10-14）**：开发者定 19 读本机会话文件、20 只看本仓库的 pane、23 这一批只靠终端回滚；主 Agent 按推荐定 21（自动选中最需要看的那个）、22（通知放左列表最上面一行）。整体设计开发者先看截图再说，确认前不开工。开发者在产物 `sessions-design` v1 上答复（2026-10-14）：按设计稿实现（`sessions-design-go` = go）；同意 21 自动选中、22 通知放左列表最上面一行（两题都答“是”）；没有其它意见。

#### 验收（实现时细化）

列表与详情两栏、选中高亮；终端定高、输入区在一屏内；Ctrl+Enter 发送；接管时模式条变色、`Ctrl+]` 释放（假 Claude 与 omp 各一次）；非 Agent 的 pane 能只读观看、全屏程序不给往回翻、`takeover` 被拒且审计里没有记录；标题显示与来源；手机上列表到详情两步、后退回列表；明暗、390、1280、1440。

### 第 4 批：现场三页与文档页（2026-10-14 细化）

出处：design.md 阶段 4 的“现场三页”“文档页”；分批表第 4 批（未跟踪计数与 `/api/checkouts/:key/files`、`/api/docs/diff`，验收要点“每个 checkout 各自超时”“差异与文档树同口径”）；“要改服务端的几处”里后两行；终稿第 12 条；后续清单 10-14 的“分支、worktree、开发服务一一对应”，推迟事项“文档页外站图片被 CSP 拦下”。

#### 已查

- 未跟踪扫描的耗时：在真实仓库的 6 个 checkout 上只读地量了 `git status --porcelain=v1 -unormal`，32 到 63 毫秒（`-uno` 是 7 毫秒）；冷的那个两种都要 0.5 秒。开销可以接受，但每个 checkout 仍要各自限时。
- 文档树的“改动”口径（`readDocTree`）：checkout 里有的文件，看工作区未提交改动，没有再看 `master...HEAD`（三点 diff）。`A` 记新增，master 也有的记改动，`M`、`D` 记改动。master 有、这里没有的：分支删的记删去，否则记“master 才有”。
- 文档页现在“只看有差异的”是页面状态，刷新就丢；删去与“master 才有”的条目在树里不能点（`/api/docs/file` 只认这个 checkout 的文档树，打开会 404）。
- 外站图片：面板页的 CSP 是 `img-src 'self' data: <产物来源>`，Markdown 里 `https:` 的图片原样留着，被拦下、控制台报错。产物页的 iframe 由产物来源返回自己的 CSP（`sandbox …`），与面板页的 CSP 互不影响。
- 分支、worktree、开发服务的关系：Git 本身保证一个分支只检出在一个 worktree 上；开发服务按（checkout、package、script）登记与复用，同一个 checkout 可以有几个（例如面板与应用各一个）。checkout 页已有“在跑”一列；“在跑”页的服务只写 checkout 的目录名。

#### 改动

1. **服务端：checkout 的未提交分两个数，每个 checkout 各自限时，加文件清单接口**。
   - `CheckoutStatus` 的 `dirty` 换成 `tracked`（已跟踪的改动，含暂存）与 `untracked`（`-unormal`，未跟踪的目录算一条）；
   - 每个 checkout 的 git 调用限时 3 秒：`runGit` 加 `timeoutMs`，到点 SIGKILL，结果标 `timedOut`；超时的 checkout 给 `timedOut: true`、计数为 null（页面写“没算完”），不拖住整页，同样缓存 10 秒；
   - 新接口 `GET /api/checkouts/:key/files`：`git status --porcelain=v1 -z -unormal` 分成暂存、工作区、未跟踪三段，每段最多 300 条（`truncated`）；同样限时、只读（`--no-optional-locks`）、不缓存；key 不认识 404。
   - `docs/panel.md` 接口表与“现场”一节同步；`panel-live` 的 checkout 用例补未跟踪、文件清单与超时（超时用注入的极短限时与一个慢的 git 替身，或在测试里直接调 `CheckoutStatusCache` 给小的限时）。
2. **服务端：`GET /api/docs/diff?checkout=&path=`**，与文档树同口径（终稿第 12 条）：
   - 先算这个 checkout 的文档树（同一个 `readDocTree`），在 `changes` 里找这个路径，按它的类型出差异：
     - 新增、改动：`git diff <合并基点>` 加 `-- <路径>`，比的是工作区，含未提交；
     - 未跟踪的新文件：`git diff` 不列，整份当新增，由服务端拼成统一差异；
     - 删去：同第一条，`git diff <合并基点> -- <路径>` 出整份删除；
     - master 才有：`git show master:<路径>` 整份当新增，写明“分支分出之后 master 新增的”；
     - 不在 `changes` 里：回 `change: null`、空差异。
   - 合并基点是 `git merge-base master HEAD`，随回应给出它的短号；
   - 主工作区回 `change: null`；
   - 白名单：这个 checkout 的文档树、它的 `changes`、记录里的文档三者之并，其余 404；路径照常过现有的守卫，git 参数用 `--` 隔开路径，只读调用都带 `--no-optional-locks`；
   - 测试：在 fixture 里造出四种改动，逐个断言“树里标什么，差异接口就回什么类型、差异非空”，没改的回 null。
3. **checkout 页**：
   - 整行可点：第一格是真链接（键盘与中键照常），点行里别处也跳（nb-ui `Table` 的 `row-click`，点到行里的链接、按钮时不重复跳）。去哪：是某个 Task 的 `home` 或执行 worktree 时去那个 Task（有几个时取第一个，其余在格子里列出），否则去这个 checkout 的文档页；
   - 需要注意的状态用同一种颜色（警告色）：落后 master、有未提交（已跟踪或未跟踪）、有服务在跑；行首加一个同色的点，读屏写“需要注意：落后 3、未跟踪 2、1 个服务在跑”；
   - “未提交”一格写“改 N · 新 M”，是个按钮：点了在表格下面展开这个 checkout 的文件清单（暂存、工作区、未跟踪三段），网址带 `?files=<key>`，刷新还在；关闭按钮清掉；
   - 超时的写“没算完”（灰色，悬停说明）；
   - 一个 checkout 上有两个以上服务在跑时，“在跑”一格多一行提示“这个 checkout 上有 N 个服务”（只显示，见下面的“一一对应”）。
4. **“在跑”页**：经 nbdev 起的服务写 checkout 的 key 与分支，链到 checkout 页（`/live/checkouts?files=` 不带，只带 `#` 锚到那一行）；会话派出的运行沿用第 3 批的 pane 链接。
5. **文档页**：
   - 不是主工作区、这份文档在差异里时，页头给“渲染 / 与 master 的差异”切换（nb-ui `SegmentedControl`），网址 `?view=diff`；差异用现有的 `DiffView`，上面一行写基线（“合并基点 abc1234 → 工作区，含未提交”，master 才有的写“分支分出之后 master 新增的”）；
   - 删去与“master 才有”的条目在树里能点，直接进差异视图（这两种没有可渲染的文件）；
   - “只看有差异的”写进网址 `?changed=1`；所选 checkout 已在网址里；
   - 手机（窄于 768px）：文档树收进左侧抽屉（nb-ui `Drawer`），正文上方一个“文档树”按钮；选了文档就关抽屉；桌面不变。
6. **外站图片**：渲染 Markdown 时把 `http(s):` 的图片换成一个链接，写“外站图片：<alt 或文件名>（<域名>）”，新标签页打开原图。不放宽 CSP，理由有三：
   - 文档来自各个 worktree，Agent 写进去的外站图片一打开就发请求，会暴露“开发者在看”和本机地址；
   - 徽章这类图片在面板里没有信息量；
   - 不改 CSP 就不用核对它对其它页面的影响。产物页 iframe 的 CSP 由产物来源自己给，这里放不放宽都碰不到它；产物里的外站图片仍按产物沙箱的规则处理，这一批不动。
   - `data:` 图片照旧显示，仓库内的图片照旧改写到产物来源。
7. **分支、worktree、开发服务一一对应（后续清单 10-14）**：这一批只做显示，就是上面第 3、4 条：
   - checkout 页一行就是分支加 worktree，再加它上面的服务，几个服务时提示；
   - “在跑”页的服务链回它的 checkout 行。
   - 不动运行登记，也不改 `dev start` 的行为（例如“一个 worktree 只许一个开发服务”），所以没有决定点；要做的话另议。

#### 验收（4490，证据 `accept/phase4/batch4/`）

在 `/dev/shm/nbdev-ui-review/repo` 的克隆里造数据，不碰真实仓库的 worktree：

- 落后：在克隆的 master 上多提交一次；
- 未跟踪：在一个 worktree 里放两个新文件、一个新目录；
- 服务在跑：在一个 worktree 里用 `nbdev dev start`，起一个极小的脚本服务（`--ready-pattern`）。

逐条验：

- checkout 页：
  - 三种状态都是同一种颜色，行首有点；
  - 点行去 Task 或文档，中键开新标签页；
  - 点“未提交”展开文件清单，网址带 `?files=`，刷新还在；
  - 未跟踪的目录算一条；
- “在跑”页：服务链到它的 checkout 行；
- 文档页：
  - 改动、新增、删去、master 才有四种各打开一次差异视图，与树上的标记一致；
  - `?view=diff` 与 `?changed=1` 刷新还在；
  - 主工作区没有切换；
  - 390 上树在抽屉里，选了文档关抽屉；
- 外站图片：仓库根 README 的徽章显示成链接，控制台没有 CSP 报错；
- 明暗两套、390 与 1440 截图：checkout 页（含文件清单）、“在跑”页、文档页（渲染、差异、抽屉）。

### 第 5 批：编辑页与搜索（2026-10-14 细化）

出处：design.md 阶段 4 的“编辑页”“搜索”；分批表第 5 行（服务端改动“搜索排序若要服务端给相关度再定”，验收要点“路由守卫等异步确认的改法先试”）；“要先实测才能定的问题”第 3 条（编辑页的站内确认框）；ux-b F8、F9。后续清单没有标第 5 批的条目。

#### 已查

- 编辑页：
  - 面包屑（阶段 3）只认 Work 与 Task 的 README，Task 目录里的其它文件（文档类产物、`plan.md` 这类）落到“文档”；
  - 贴底操作栏（3c）已有“保存并提交”“放弃改动”与结果，没有快捷键；
  - 站内离开用 `window.confirm`，关标签页、刷新用 `beforeunload`。
- 搜索：
  - 记录类命中由服务端 `recordMatches` 先发、页面先显示，但顺序是遍历顺序（Work、它的 Task、产物……），并且服务端先截 50 条再发：命中多时最相关的可能被截掉，所以相关度要在服务端截之前排；
  - 文件命中按 checkout 分组，每组文件名命中在前、内容命中在后，没有高亮；
  - `.agents/tasks` 的历史和别的命中混在一起；
  - `/` 与 Ctrl+K 聚焦搜索框在 `host/shortcuts.ts`（阶段 2d），有单测。

#### 改动

1. **服务端：记录类命中按相关度排**（单独一个提交）。`core/search.ts` 加纯函数 `recordRelevance(match, q)`，`recordMatches` 在截 50 条之前按它稳定排序。分数从高到低：
   - 标题或编号与搜索词相同（编号也认短号，例如 `w00022`、`t15`）；
   - 标题以它开头；
   - 编号以它开头；
   - 标题包含它；
   - 编号包含它。
   同分时 Work、Task、产物、会话依次在前，再按原顺序。`nbdev find` 的顺序不动（它不截断，且有自己的输出合同）。单测钉住排序；`docs/panel.md` 的 `/api/search` 一行写明顺序。
2. **搜索页**：
   - 记录类命中照旧在最上面（服务端先发、已排好），标题与编号里的搜索词高亮；
   - 文件命中高亮：路径与内容里的搜索词（不分大小写）用 `<mark>` 标出，按文字切段渲染，不用 `v-html`；切段函数放 `host/highlight.ts`，有单测；
   - 每个 checkout 组里，`.agents/tasks/` 下的命中（历史 Task 记录）收进组尾一个默认折叠的“历史 Task 记录 N 条”，点开才列出；
   - `/` 快捷键浏览器里复核。
3. **编辑页**：
   - 面包屑：Task 目录下的任何文件都回到 Work 与 Task（不只 README），找不到时的出口同样；
   - 快捷键：Ctrl+S（Mac 上 ⌘+S）保存，按钮上写“保存并提交 Ctrl+S”（与会话页的发送按钮同一种写法）。页面挂载时在 `window` 上监听，输入法组字时不处理；能保存才保存，不能保存时仍拦下浏览器的“另存网页”，并在操作栏写原因；
   - 站内离开：`onBeforeRouteLeave` 与 `onBeforeRouteUpdate` 返回 Promise，等面板自己的确认框（nb-ui `AlertDialog`：“有未保存的改动，离开会丢掉” / 离开 / 留下）。确认就放行，取消、Esc、点遮罩都留下。确认框开着时又来一次导航，先把上一次当作“留下”结算。浏览器后退（popstate）被拦下时，vue-router 会把地址复原，实测核对；
   - 关标签页、刷新仍只能用原生的 `beforeunload`（浏览器不允许自定义）。

#### 验收（4490，证据 `accept/phase4/batch5/`）

- 编辑页（在克隆里编辑一份文档）：
  - Ctrl+S 保存成功，克隆里多一个提交；没改动时 Ctrl+S 不提交、浏览器也不弹“另存网页”；
  - 有未保存改动时点左栏跳走，弹面板自己的确认框：选“留下”还在编辑页、草稿还在；选“离开”跳走；
  - 浏览器后退同样弹框，选“留下”后地址复原成编辑页；
  - 面包屑：Task 目录里非 README 的文件回到 Task。
- 搜索：
  - 搜一个既是 Work 标题又散在很多 Task、文件里的词，记录类按相关度排；
  - 路径与内容的高亮；
  - `.agents/tasks` 的命中默认折叠、能展开；
  - 按 `/` 聚焦搜索框。
- 明暗两套、390 与 1440 截图：编辑页（含确认框）、搜索页。

### 各页的内容（原轮廓，各批引用）

按页切片，每页一个或几个提交，彼此基本独立；涉及服务端的单列在后面，**先于对应的前端片单独提交**，审查时能单独看安全面（审查建议 10）。

- **首页**（ux-b F5、ux-a S7、开发者第 4 条）：
  - 第一屏是“等我”：待答的提问按产物合并（前端分组即可）、要处理的通知、异常；
  - 撞号写明原因与去哪里处理；
  - Work 排序：有事等我的在前，其次进行中，再按最近更新；卡片改紧凑。
  - 验收：同一产物的三道题合成一行“uxq：3 道待答”；撞号能点到说明。
- **Work 页**（开发者第 1 条、ux-b F10、ux-a R6）：
  - Task 行可以就地展开，展开后是当前情况、下一步、产物、证据、谁在动；
  - 展开时按需取这个 Task 的接口（决定点 9）。Task 接口每次要跑一次 `git log` 与执行 checkout 的判定，展开的行又各是一份订阅推送的资源，所以**同时最多展开 3 行**，展开第 4 行时收起最早的那行；
  - 标题列加宽、单行截断；“当前情况”按行内 Markdown 渲染；为 0 的计数淡化。
- **Task 页**（开发者第 2、3 条）：
  - 状态只显示一处；正文卡片按阅读宽度（3b）；
  - 产物、证据、文档在侧边速览面板里打开（D1，`?peek=`，能后退、能分享，中键照样开新标签页）。面板里显示什么、怎么摆，见决定点 10 的终稿：
    - 文档与证据显示渲染后的内容；
    - 产物显示页面本身：沙箱 iframe，`sandbox` 与产物页相同；外加状态行（产物接口已有的 `state`、待答题数与版本）和“去答复”“打开完整页”，不放答复表单；
    - iframe 连同“页面是当前版本”那行说明抽成零件 `parts/ArtifactFrame.vue` 与同名 `.md`，产物页与速览面板共用（审查建议 8）：不给 `allow-same-origin`、亮色垫白底这几项理由都在它的 `.md` 里；
    - 打开速览时焦点放在面板标题，有可见的关闭按钮（iframe 里按 Esc 不会冒泡到面板外，不能只靠 Esc 关闭）；
    - 布局见决定点 10。
- **产物页**（ux-b F4、F12）：
  - 分“待答、已答（只读回看答案、时间、版本）、已取代”三段，已答按接口已有的 `answers` 列出；
  - 新加的题标“新”；提交栏固定在底部，写明“已改几题、还有几道必答”；
  - 成功提示写答了什么，不只给提交号；
  - iframe 换成 `ArtifactFrame`。
- **会话页**（ux-b F3、F13）：
  - 桌面改成左列表、右详情两栏，选中项高亮；终端定高，输入框、按键行、投递结果紧贴终端；这一片同时在路由元信息里把会话页声明为“铺满”（从 2a 挪过来）；
  - 写明发送快捷键；
  - 接管时给一个固定的退出组合键 `Ctrl+]`（决定点 11），写在提示条上，“释放”按钮仍是主要入口；实施时在假 Claude 与 omp 的 pane 上各按一次，确认不被吞掉、也不触发别的动作；
  - D2 的任意 pane 观看见下面的服务端改动。
- **现场三页**：
  - “无主的运行”在会话页只留入口（3g）；
  - checkout 整行可点（去它的 Task、文档）；
  - 落后、有改动、有服务在跑用同一种“需要注意”的颜色；
  - 未跟踪计数见下面的服务端改动。
- **文档页**：
  - 加“渲染 / 与 master 的差异”切换（服务端改动见下）；
  - “只看有差异的”与所选 checkout 写进网址；
  - 手机上把文档树收进抽屉。
- **编辑页**（ux-b F8）：
  - 面包屑能回到 Task；
  - 底部固定操作栏：保存并提交、放弃，支持 Ctrl+S；
  - 站内离开用面板自己的确认框，不用 `window.confirm`；路由守卫要等异步确认，改法要先试（见下一节）。
- **搜索**（ux-b F9）：
  - 记录类的命中放第一屏，按相关度排（标题命中先于正文命中）；
  - 文件命中高亮关键词；
  - `.agents/tasks` 的历史默认折叠。

### 要改服务端的几处

| 项 | 范围 | 风险与先决 |
|---|---|---|
| D2 观看任意 pane，并能往回翻 | `/api/sessions` 把本仓库里没有 Agent 会话的 pane 也列出来（现在只作为“无主的运行”的 pane 号出现），会话页给“只读观看”入口；`/ws/terminal` 的 `open` 放开对 Agent 会话的要求，只允许观看。**接管的服务端闸门要显式写**（审查重要 6）：现在挡住非 Agent pane 的只有 `open` 那一行，`takeover` 只比 `keyOf(pane) !== message.expectedSession`，没有会话的 pane 是 `null` 对 `null`，会放行。改为 `takeover` 先要求 `pane.agent !== null`、`keyOf(pane) !== null`、`typeof message.expectedSession === "string"`，否则回 `error`（例如 `not_allowed`），不关连接、照常观看；`input`、`key`、`resize` 本来就要求已在控制中。`/api/sessions/:pane/prompt`、`/keys` 的 `agent.get` 核对本来就要求有会话，补测试钉住“非 Agent 的 pane 回拒”。“往回翻”沿用现在给 omp 的“更早的输出”，读 1000 行做成文字面板：非 Agent 的 pane 读 `pane.read`（要加进 herdr 方法白名单，只读）；前台程序在备用屏时（vim、less、htop、带 TUI 的开发服务）**不给往回翻，只给当前屏**，Claude 也一样不给（审查建议 7）。**观看非 Agent 的 pane、读它的历史都不写审计**，与现行“观看不写审计”的合同一致（主 Agent 定）。 | 先实测：`terminal session observe` 对非 Agent 的 pane 能不能用；0.9.1 与 0.9.3 上 `pane.read` 的参数与副作用，实测矩阵加一格跑 vim 或 less 的 pane；怎么判断前台程序在备用屏。白名单变化同步 `docs/herdr.md` 与 `tests/delivery.test.ts` 钉住的清单。`panel-terminal` 的 L3 加：对非 Agent 的 pane 能观看；`takeover`（`expectedSession` 为 `null`、空串、伪造串）一律被拒；审计里没有 `takeover` 行 |
| checkout 的未跟踪计数与文件清单 | `status --porcelain` 由 `-uno` 改为分开计数：已跟踪改动、未跟踪（`-unormal`，未跟踪的目录算一条）；新接口 `GET /api/checkouts/:key/files`，列出暂存、工作区、未跟踪三段，条数上限；10 秒缓存照旧；沿用 `readOnly`（`--no-optional-locks`） | 未跟踪扫描在大 worktree 上可能慢：先对真实的 15 个 checkout 量耗时（t14 冷算 104 到 210 毫秒是 `-uno` 的数）。`checkoutsView` 现在等全部 checkout 算完才回，所以超时要**每个 checkout 各自计**，超时的那个给“未算”，不拖住整页 |
| 文档与 master 的差异视图 | 新接口 `GET /api/docs/diff?checkout=&path=`，**与文档树标“改动”同口径**（决定点 12 的终稿，审查重要 7）：分支改的文件，差异取“合并基点 → 工作区”（`git diff <merge-base master HEAD> -- <path>`，含未提交改动）；未跟踪的新文件整份当新增；`master_only` 的文件整份显示 master 的版本，写明“分支分出之后 master 新增的”；需要的话另给一个“与 master 当前比”的次要切换，不作缺省。前端用现有的 `DiffView` | 白名单不能照抄 `/api/docs/file` 的（删去的文件、`master_only` 的文件在这个 checkout 的文档树里不存在，会 404）：取“这个 checkout 的文档树 ∪ 这个 checkout 的 changes 列出的路径 ∪ 记录里的文档”，路径照常过现有的路径守卫；git 参数用 `--` 隔开路径，只读调用带 `--no-optional-locks` |
| 产物页显示已答的内容 | 核实后**不需要改服务端**：`answers` 已在接口里（见“计划前的核实”） | 无 |
| 答复只收这一版里还能答的题（第 1 批） | `submitAnswer` 拒收“之前几版的题”（`origin` 为 `markup`、`page` 为 `null`），`question_retired` | 代录同受约束；判据与面板共用一个纯函数 |
| 首页按产物合并提问 | 分组在前端按 `artifactId` 做；第 1 批另给收件箱条目加 `artifactTitle`，合并后的那一行能写产物标题 | `status --json` 多一个字段，向后兼容 |

## 要先实测才能定的问题

1. **xterm 的自绘滚动条**：D2 给终端加回滚之后，`ITheme.scrollbarSlider*` 的配色在明暗两套终端配色下是否可见、是否干扰选择。藏掉空 `.xterm-viewport` 的原生轨道之后，列数是否与现在一致。轨道本身已在计划前实测过。
2. **`Splitter` 放进外壳**（接线细节见 2c）：
   - 窄屏时保留同一个 `Splitter`（`sashSizes` 0、左栏收起、禁用），导航改由抽屉显示，`RouterView` 是否始终是同一个实例。验法：在编辑页打几个字、在会话页接上终端，把窗口在 1280 与 390 之间来回改，草稿与终端连接都还在；
   - 它的 `collapse` 配置能否表达 D4 的“拖到最小以下就收起”；
   - 拖到 360px 后等 20 秒，宽度不被外壳的时钟重渲染冲回默认值。
3. **编辑页的站内确认框**：`onBeforeRouteLeave` 返回 Promise 时，面板自己的确认框能否接管（nb-ui `Dialog` 的焦点与 Esc）；浏览器后退（popstate）场景下 vue-router 5 取消导航后地址栏是否复原。
4. **Task 页正文右边的空白**：已按代码与截图核实，是卡片宽度与 72ch 阅读宽度不一致（见“计划前的核实”）。3b 做完后在 1280、1440、1920 三个宽度截图确认。
5. **未跟踪文件扫描的耗时**：见服务端改动。
6. **D2 的 observe、`pane.read` 与备用屏**：见服务端改动。

## 决定点

### 终稿（主 Agent 2026-10-13 定）

1. **登录失效时**：页面保持挂载，盖一层阻挡交互的提示；恢复路径补全（重新登录后全部重取、会话页终端重连、失效期间不取数，checkout 页的轮询这类定时器随之停下）。见 1.5。
2. **会话输入框的草稿按 pane 记**：同一格换会话（`/compact`、`/clear`）时保留，并提示“会话换了”；切到别的 pane 才清空。清空用已有的 `resetKey`，不给 `SessionConsole` 加 key；终端按连接身份加 key；发给 A 的回包不清给 B 打的草稿。见 1.1、1.2。
3. **终端零件不加防御性的 `watch(source)`**：key 取连接序号，构造上保证 `source` 不变。
4. **保存在途时编辑器只读**，不做边保存边改。
5. **同一地址在不同组件之间共用请求**：本阶段不做，只做每个资源自己的单飞。
6. **重取遇到 404**：保留旧数据，提示“已经找不到了”，给“回到上一级”、不给重试。
7. **抽屉的断点改到 `lg`**；会话页的“手机”判定不变。见阶段 2。
8. **左栏收起时完全隐藏**，顶栏左侧给展开按钮，不做 48px 的图标栏。
9. **Work 页就地展开 Task 时按需取 Task 接口**，同时最多展开 3 行。见阶段 4。
10. **速览面板显示产物页面本身**（沙箱 iframe，与产物页共用 `ArtifactFrame` 零件），加状态行与“去答复”“打开完整页”，不放答复表单。面板的布局见第 17 条。
11. **接管时退出键盘用 `Ctrl+]`**，“释放”按钮仍是主要入口。
12. **文档差异的基线与文档树同口径**：合并基点到工作区（三点 diff），删去的与 `master_only` 的文件都能显示。见服务端改动。
13. **不引入组件挂载测试**：接线错误靠浏览器验收覆盖，“接管中换会话 id”“同一终端换会话不重建终端”已写成验收场景。
14. **页面按路由名与 params 重建实例，不含查询参数**。见 1.9。
15. **保存在途时拒绝站内离开**，提示“正在保存，等它完成”。见 1.4。
16. **观看非 Agent 的 pane、读它的历史不写审计**。见服务端改动。
17. **速览面板的布局**（开发者 2026-10-14 定，按编码子代理的推荐）：内容区（不含左栏）宽于约 1100px 时并排、推开正文；窄于它时浮在正文上（不推开，正文下面加一层半透明遮罩，点遮罩关闭）；手机上整屏。用内容区宽度而不是视口宽度判断，左栏拖宽时自动从并排切到浮层。审查建议 10 的背景：左栏默认 300、最大 480（D4），1280 宽时再推出一个 480 左右的面板，Task 页正文只剩约 500px，比阅读宽度还窄。

## 风险

- **阶段 1 改的是正在用的面板的核心路径**（发按键、接管、写入、登录）：每条都有 L3 加浏览器验收，合入前在 4490 上完整走一遍；合入后重启常驻服务要先问开发者。
- **测试的模块单例与定时器**：靠 `--isolate` 与产品里也用的 `stopPanelData()` 收口；不加测试专用的复位导出。
- **阶段 2、3 改动面大**：每片单独截图对比明暗、390 与 1440；不把信息排序的调整混进外壳改动。
- **主应用与 nb-ui**：本 Task 不改 nb-ui 与主应用（D3）。滚动条收进 nb-ui 已记在后续清单。

## 实施进度（编码子代理随做随记）

- 2026-10-13：计划写完，交主 Agent 与设计审查。
  - 计划前只读核对了源码。
  - 在 4490 的审查面板上只读实测了一次 xterm 的滚动条结构：登录后打开 `?pane=w4:p1`，没有发消息、没有按键；用一个浏览器，用完已关。
  - 没有改代码，没有提交。
- 2026-10-13：按设计审查改计划（全部采纳），加 1.0 与 1.9，决定点改成终稿。
- 2026-10-13：阶段 1 做完，在集成分支 `feat/w00022-dev-panel` 上，未 push。
  - 提交（`f85157526..86531ace4`，11 个）：`7a771f21e` 1.0、`ff4389d2c` 1.1、`111398508` 1.2、`79550850c` 1.9、`a21bcbe94` 1.3、`399b32cc9` 1.4、`6dcb50f03` 1.5、`082edf839` 1.6、`ac856d967` 1.7、`5128e7ae9` 1.8，以及验收发现问题后的修正 `86531ace4`（见下）。
  - 门禁（在 `5128e7ae9` 上跑）：
    - 包的 `typecheck`、`build:web` 通过；全量 `test` 369 过、0 失败、0 跳过，用时 6 分 29 秒，含 herdr L4 与 `--isolate` 下的前端宿主测试；
    - 根目录 `dev-panel-records` 在 Node 下 5 过；`governance:check`、`docs:check` 没有错误，警告都是存量，或是 worktree 里的记录比 master 旧，与本阶段无关；
    - `git diff --check` 干净。
    - `86531ace4` 只改 `NewPage.vue`，补跑了 `typecheck`、`build:web` 与 `git diff --check`。
  - 浏览器验收：在 4490 上用集成分支的代码起面板，40 条全部通过。会话 A 是 `w4:p1`，B 是另起的 `w5:p1`，两格都是假 Claude，屏幕上分别写着 AAA 与 BBB。
    - 1.1：四个场景都过。按 Enter 开确认后 goBack 到 B；按 Esc 开确认后在同一格换会话；开着接管小窗时 goBack。三种情况下确认框或小窗都自己关了，有“目标变了，没有发送”的提示；A、B 的假 Claude 日志没有新字节，审计没有新的 `keys` 或 `takeover` 行。草稿在同一格换会话时保留，并提示“这格的会话换了”；换到 B 时清空。
    - 1.2：桌面上换到 B，2 秒内终端只剩 B 的画面。接管 B 后打的字进了 B 的日志，没进 A 的。接管 A 时换会话 id：仍是“你已接管键盘”，画面没被清空，焦点仍在 xterm，再打的字仍进 A 的日志。390 触屏的文字视图同样在 2 秒内换成 B 的画面。
    - 1.9：Task 页注入 409 `lock_timeout`，出现带“重试”的提示后，从左栏去同一 Work 的另一个 Task，提示与“重试”都不在了。新建页把新建 Work 的 POST 挂起，期间“新建 Task”是禁用的，点了也不切换；放行后清空的是 Work 表，Task 表里预先填的标题还在。这一条用的是假回包，没有写仓库。
    - 1.3：在 A 里打字后 goBack，原生确认框问了一次。之后地址是 B、仍在编辑页，编辑框是 B 的原文，没有“未保存”。
    - 1.4：把 PUT 延迟 3 秒。期间编辑框带 `readonly`，打字不改变内容；点左栏不离开页面，提示“正在保存”。保存完成后编辑框是服务端的文本（`updated` 已经改过），可以继续打字。
    - 1.5：`clearCookies` 后在编辑页保存，出现阻挡层，打的字还在。`/ws` 关闭，之后没有再握手。会话页与 checkout 页随后也进入失效状态，checkout 页 20 秒内没有再请求 `/api/checkouts`。在新标签页登录后，回到各页点“我已重新登录”：阻挡层消失，编辑页的字还在、能保存，会话页的终端重新出画面。
    - 1.6：`/api/overview` 延迟 2 秒，每 700 毫秒改一次克隆里 w00022 的目标。15 秒里请求 18 次、中止 0 次，卡片换过 7 个版本；停下后 4 秒内卡片显示最后一版。
    - 1.7：Work 页注入 503 后，出现“显示的是刚刚读到的内容；这次重取失败：……”与“重试”，原来的数据还在；撤掉拦截点“重试”，提示消失。注入 404 后，提示没有“重试”，只有“回到首页”，点了回到首页。
    - 1.8：用 `defineProperty` 把页面置为后台，再打开会话详情：没有建终端连接。改回前台后 3 秒内终端出画面。
    - 证据在本地 `.local/agent/works/w00022-dev-panel/tasks/t15-ui-polish/accept/`：
      - 脚本 `accept.ts`；
      - 最终一轮的结果 `results.txt`，前几轮（含失败）的结果 `results-attempts.txt`；
      - 20 张截图；
      - 两次起面板的日志 `panel-run1.log`、`panel-run2.log`，以及 `run-full.log`。
    - 控制台只有两类报错：注入的 409、503、404，与 1.5 里预期的 401。
  - 验收发现并修正的问题：新建页的模式锁实际没有生效。nb-ui 的 `SegmentedControl` 没有整体的 `disabled`，`:disabled` 落到了根节点上，提交在途时仍能切到“新建 Task”。改为提交在途时按选项禁用另一项（`86531ace4`），重跑通过。这层接线在 `.vue` 里，单元测试测不到。
  - 偏离计划的地方：
    - 终端零件的 key 用这一条连接的序号（`host.connection`），没有用 paneId 加 terminalId：1.5 重新登录后，同一个终端也要重建连接；
    - `StaleNotice` 在首页、Work、Task 三页放在页面最上方，因为这三页的标题在数据块里面；其余页面放在标题下面。文档页的树与正文各放一条，两份都算主资源；
    - 1.7 顺带改了服务端 `state.ts`：重算从失败恢复时，即使内容没变也推一次。否则顶栏“后台重算失败”那一行要等别的变化才会消失；
    - 1.8 顺带改了测试环境：`useWebEnv(teardown)` 在拆环境之前收口。bun 按注册顺序跑 afterEach，写在 `useWebEnv()` 之后的 afterEach 会在环境拆掉之后才跑，停 scope 时已经碰不到 `document`；
    - 包的 `AGENTS.md` 没有改。建议回写“`bun test` 带 `--isolate`；前端宿主测试 `tests/web-*.ts` 用 `tsconfig.web-tests.json` 单独做类型检查”，要开发者批准后再写。
  - 没有验证到的地方：
    - 顶栏“后台重算某一块失败”那一行没有在浏览器里看过：造不出真实的重算失败，只有代码与类型检查；
    - 1.8 的后台是模拟出来的，原因见计划；
    - `StaleNotice` 里的“N 分钟前”只在重新渲染时更新，不会随时间自己走（未处理）。
  - 验收环境的收尾：
    - 4490 的面板已经 SIGTERM，浏览器已关，`/dev/shm/nbdev-t15-tmp` 与 cookie 文件已删；
    - herdr 命名会话 `nbdev-ui-review` 里另起的工作区 `w5`（格 `w5:p1`，假 Claude，文件在 `/dev/shm/nbdev-ui-review/fake2/`）留着。要关时运行 `herdr --session nbdev-ui-review workspace close w5`；
    - `w4:p1` 的会话 id 已改回 `71f9ae69-…`，屏幕文件已还原；
    - 克隆里多了 4 个“面板编辑 t16 README”提交，来自两轮 1.4 与 1.5 的保存；克隆的工作区是干净的。
  - 验收时踩到的坑：
    - herdr 换会话 id 要带比这一格已有值大的 `--seq`，否则静默丢弃；还要带 `--session-start-source clear`。herdr 不为这种变化推事件，面板靠有浏览器连着时的 500 毫秒轮询发现；
    - 有一轮在没有浏览器连着时改了会话 id，页面在面板第一次轮询之前读到了旧 id。读屏回 409 `session_changed`，“目标变了”的提示被这条覆盖。服务端的核对挡住了这次按键，没有发出去。
- 2026-10-13：阶段 1 实现审查（`.local/agent/works/w00022-dev-panel/tasks/t15-ui-polish/reports/impl-review-phase1.md`）的结论是 0 阻断、0 重要、5 条建议，可以合入。主 Agent 五条都采纳，合入前在集成分支上改完，一条一个提交，未 push：
  - 建议 1（`ef4f41d43`）：`readScreen` 把这一次读屏的结果交回调用方。按键的确认框读到了就用这一屏；没读到也照开（Esc、Ctrl+C 常在会话失控时用，不能因为读屏偶发失败就按不下去），说明里写出没读到的原因，以及框里是多久以前读到的画面。补了两条用例：没读到时写明旧画面，读到时用这一屏。
  - 建议 2（`d3ab3b617`）：发文字成功后按格（pane 加终端）清草稿，不按会话。发的是 `/clear`、回包前这格换了会话时，照样清空输入框并收起“会话换了”的提示。补了一条用例。
  - 建议 3（`ee976a269`）：给 A 的文字判定不可投时已经换了目标，不再问“仍然发送”，提示“没有发出去”，带 A 的 pane 号；换了格时附上原文，因为输入框已经清空。补了一条用例。
  - 建议 4（`0a1c02798`）：新建页切换模式时收起带“重试”的失败提示，“重试”不会提交另一张表。接线在 `NewPage.vue` 里，单元测试测不到，只跑了 `typecheck` 与 `build:web`。
  - 建议 5（`4dbbf8b16`）：重新登录时面板连不上，原因直接用原文，不再重复“连不上面板”的前缀。补了一条用例。
  - 文档同步：`docs/panel.md` 的会话页一段与外壳一段，`parts/SessionConsole.md` 的 `resetKey` 说明。
  - 验证：包的 `typecheck`、`build:web` 通过，`tests/web-*.test.ts` 6 个文件 37 过、0 失败，`git diff --check` 干净。按主 Agent 的要求，没有再跑全量测试，也没有再做浏览器验收。日志在 `.local/agent/works/w00022-dev-panel/tasks/t15-ui-polish/accept/gate-review-fixes.log`。
- 2026-10-14：阶段 1 合入 `master`，开发者授权。
  - 在临时 worktree 里 `merge --no-ff`，得到合并提交 `6e21cba2a`（集成分支 `4dbbf8b16`）；主工作区 `merge --ff-only` 快进过去。
  - 合并提交的 `packages/`、`scripts/` 与依赖清单和集成分支完全相同，全量 `test` 在集成分支的 `4dbbf8b16` 上跑：374 过、0 失败。
  - 依赖没有变，服务单元也没有变，只做了 `service:restart`；4400 回 200，前端构建与预热完成。
  - 临时 worktree `.worktree/w00022-merge` 与审查 worktree `.worktree/w00022-t15-review` 已删除。没有 push。
- 2026-10-14：按主 Agent 的转告，把“还要定的”速览面板布局移进终稿，记为第 17 条（开发者已定，按推荐）；阶段 3 表格里 3b 的依赖改指第 17 条。包的 `AGENTS.md` 不回写 `--isolate` 那两条（开发者定）。
- 2026-10-14：阶段 2（外壳）做完，在集成分支 `feat/w00022-dev-panel` 上，未 push。
  - 提交（`07550b3ad..5319aca19`，5 个，一片一个）：`814c4a936` 2a、`11d2492a9` 2b、`aa6fad6da` 2c、`d9038b372` 2d、`5319aca19` 2e。
  - 动手前的实测（脚本与输出在 `.local/agent/works/w00022-dev-panel/tasks/t15-ui-polish/accept/phase2/` 的 `probe1-xterm.ts`、`probe1.txt`、`probe2-splitter.ts`、`probe2.txt`）：
    - 第 1 条（xterm 的滚动条）：在会话页（1440×900，`w4:p1`）给空的 `.xterm-viewport` 加上 `scrollbar-width: none`，前后接管提议都是 163×32，列数不变；viewport 的 `offsetWidth − clientWidth` 从 15 变成 0。同一页另起一个带 1000 行回滚的探针终端（同一套暗色 token）：
      - 自绘滑块在暗色终端上看得见，悬停会加深；
      - 主题色写成 `color-mix()` 时 xterm 静默丢掉、退回缺省色（前景色的 20%），写成 8 位十六进制才生效；
      - 自绘条宽 14px，盖在终端右缘：按面板现在的算法（父元素宽度除以格宽，不减滚动条）量出的最后一列有一半在滑块下面，在最后一列上按下拖动选不中文字。现在 `scrollback: 0`，不受影响；阶段 4 给终端加回滚（D2）时，量列数要先减掉 14px。已写进 `TerminalView.md`。
    - 第 2 条（`Splitter` 放进外壳）：用原型（未提交）在 1280 宽量：
      - 窄屏沿用同一个 `Splitter`（sash 0、左栏收起、禁用）：编辑页在 390 与 1280 之间来回改两次，textarea 还是同一个元素、草稿在；会话页来回改两次，`/ws/terminal` 只握手一次；
      - `collapse` 能表达“拖到最小以下就收起”：最小 200、阈值 80 时拖到 x=100 收起（宽 0，读屏器读“已收起”），从收起处往外拖到 260 又展开；
      - 拖到 360 等 20 秒仍是 360；窗口 1100 时夹到 440，回到 1280 恢复 480；键盘方向键每步 10px，Esc 取消，Home、End 到上下限。
  - 门禁（在 `5319aca19` 上跑）：包的 `typecheck`、`build:web` 通过；全量 `test` 380 过、0 失败、0 跳过，用时 6 分 25 秒，含 herdr L4 与前端宿主测试；`git diff --check 07550b3ad..HEAD` 干净。另外跑了 `docs:check`、`governance:check`，没有错误，也没有与 dev-panel 有关的警告。
  - 浏览器验收：在 4490 上用集成分支的代码起面板，审查环境沿用，验收脚本是 `accept/phase2/accept.ts`。最终一轮在 `5319aca19` 的构建上把 2a 到 2e 连着跑完，48 条全过，控制台没有错误与警告。证据在 `accept/phase2/final/`：`results-all.txt`、38 张截图（每片明暗两套、390 与 1440；左栏另有 1280、1920）、面板日志与门禁日志。
    - 2a：
      - 窗口右缘没有空带（`innerWidth` 与 `clientWidth` 都是 1440）；首页、会话页的内容区各只有 main 一条竖向滚动条；
      - 长页（首页）与短页（在跑，不溢出）切换时，main 的内容宽度都是 1182；
      - 文档页 main 不滚，树与正文各自滚；390 宽时上下堆叠，由页面的根滚，没有横向溢出；
      - 会话页能滚到底；终端的空 viewport 不再画原生轨道；同一页里放回原生轨道再量，接管提议的列数相同（166×32）。
    - 2b：
      - 900 高时首屏看得到“现场”（GitHub 那一行底边在 360px）；
      - Task 页左栏高亮当前 Task，并且滚进了 Work 树的可视区，所属 Work 那一行是淡高亮；
      - 左栏 Tab 停靠点从约 53 个降到 10 个；Tab 进 Work 树时停在当前那一行，方向键上移、左键回到所属 Work；
      - 被截断的标题悬停显示全文；390 的抽屉里有 Task 层，当前 Task 的高亮与桌面一致。
    - 2c：
      - 缺省 300，分隔线的可读名是“调整 导航 与 正文 的宽度”；鼠标拖到 360、等 20 秒不变；
      - 方向键每步 10px、Esc 取消、Home 到 200、End 到 480；刷新后恢复 420；
      - 窗口 1030 时夹到 412，回到 1440 恢复 420；
      - 拖到最小以内收起，顶栏出现“展开左栏”，点了恢复 420；“收起左栏”收起之后刷新仍收起；
      - 在 1440、1280、800、390 之间来回改窗口：编辑页的 textarea 不重挂、草稿在，会话页终端只握手一次；
      - 390 时左栏宽 0、分隔线不可聚焦，顶栏是“打开导航”。
    - 2d：
      - 1920 宽时搜索框 576px；正常时顶栏只有搜索、通知、状态点、明暗四个控件，没有横幅；点状态点看到推送、herdr、数据三行；
      - 页面上按 `/` 与 Ctrl+K 都聚焦搜索框；
      - 改写 `/api/meta` 的回应造出异常时，四条横幅（代码已更新、构建失败、审计未开启、后台重算失败）都出现；herdr 不可用时状态点变黄、写出原因；
      - 接管中按 Ctrl+K 与 `/`：假 Claude 的日志收到 `\x0b` 与 `/`，焦点仍在 xterm；
      - 编辑页的 textarea 里能打 `/`；390 宽时顶栏不横向溢出。
    - 2e：
      - 第一次 Tab 是“跳到主内容”（出现在左上角），按下去焦点到页标题；
      - 从左栏换到 Task 页，焦点到新页面的标题，标签页标题从“开发者项目面板与本地／入库边界 · nbdev”变成“面板界面打磨 · nbdev”；
      - 亮色下表头对比度 6.02:1；在文档树里连续选三份文档，焦点一直留在树里；文档页的标签页标题带文件名；
      - 键盘聚焦左栏条目时有 2px 的焦点环；390 宽时第一次 Tab 也是“跳到主内容”。
  - 验收中发现并当场修掉的问题（都在对应片的提交里）：
    - 2b：当前行滚进可视区时先找到的是所属 Work 那一行，Task 行还在树外。改为先找当前页那一行。
    - 2e：
      - 打开面板时，路由从没有名字的起始位置第一次解析，也被当成换页，焦点被放到了页标题，第一次 Tab 不是“跳到主内容”。改为第一次解析不算换页；
      - 等标题出现的那 5 秒里，开发者点进了文档树，标题出现时又把焦点抢走。改为焦点已经挪到别处就不抢。
  - 偏离计划的地方：
    - 2a：
      - 改完之后，接管时的整体列数比改之前多 3 列（163 变 166）：`html` 不再预留 15px 槽位、main 的滚动条变细，内容区宽了 19px，这是预期的。计划的验收点“接管终端的列数与改之前一致”针对的是只藏 viewport 轨道这一项，所以改成同一页里放回轨道再量、两次相同；
      - 终端滑块的颜色拼成 8 位十六进制，新增 `host/terminal-colors.ts` 与 L1 测试。
    - 2b：
      - Work 树用 roving tabindex：展开按钮不进 Tab 顺序，键盘用左右键展开、收起；
      - 状态写坏的 Work 也收进“更多”；当前 Work 在“更多”里时，“更多”自动展开；
      - 截断提示用 nb-ui 的 `Tooltip`，只给真的被截断的行；
      - 品牌行保留为去首页的链接。
    - 2c：
      - 面板 id 用“导航”“正文”：`Splitter` 拿 id 拼分隔线的可读名；
      - “收起左栏”放在 `PanelNav` 新加的 `actions` 插槽里；收起与展开的阈值都是 80px，正文最小 360px。
    - 2d：
      - 状态点用 nb-ui 的 `Popover`；搜索框的快捷键写在占位文字里，并加了 `aria-keyshortcuts`；
      - “审计未开启”按计划改成常驻横幅：审计没初始化的机器上，这条会一直在，太吵的话可以改成可关掉；
      - 决定点 11 的 Ctrl+] 在阶段 4 做，2d 的快捷键不处理它。
    - 2e：
      - 换页时 main 回到顶上：main 在各页之间是同一个元素，以前上一页的滚动位置会带到下一页（从代码推断，没在改之前实测）；
      - 灰字改色挑了 33 处承载信息的（编号、元信息、计数、小节名、对话框里的标签），空状态、占位、“未标”、提示语不动；
      - 两张 nb-ui `Table` 加了 `nbdev-table`，表头改色。
  - 没有验证到的地方：
    - 只在 Chrome 上看了滚动条，Firefox、Safari 与 Windows 的经典滚动条没看；
    - 推送断开时状态点的样子没在浏览器里造（只造了 herdr 不可用）；
    - 1024 断点的边界（1023 与 1024）没有单独测，测的是 800、1030、1100；
    - 手机上从抽屉里点导航之后，焦点会不会到页标题没有验证：Reka 关抽屉时会把焦点还给“打开导航”，可能先于外壳挪焦点，那样外壳就不抢了；
    - 等页标题出现的路径只在 Task 页与文档页走过。
  - 与本阶段无关的观察：文档页渲染仓库根的 `README.md` 时，外站的徽章图片被面板的 CSP 拦下，控制台报错（`img-src` 只许本源与产物来源）。验收脚本改用别的文档绕开；要不要在 Markdown 改写时去掉外站图片，留给阶段 4 的文档页。
  - 验收环境的收尾：4490 的面板已经 SIGTERM，浏览器已关，`/dev/shm/nbdev-t15-tmp` 已删，克隆的工作区是干净的（阶段 2 没有写入）。herdr 命名会话里的 `w4:p1`、`w5:p1` 没动，会话 id 还是 `71f9ae69-…` 与 `bbbb0002-…`。
- 2026-10-14：阶段 2 实现审查（`evidences/impl-review-phase2.txt`）的结论是 0 阻断、2 重要、7 建议，另有一条委托的意见（审计横幅），修掉两条重要就能合入。主 Agent 全部采纳，在集成分支上改，未 push：
  - 重要 1（`db061d9cf`，验收中补了 `8794881ad`）：
    - 左栏收起或窄屏时，`<aside>` 加 `inert`，宽 0 的条目不再留在 Tab 顺序和读屏树里；
    - 点“收起左栏”后焦点交给“展开左栏”，点“展开左栏”后交给“收起左栏”；拖动分隔线收起时不挪焦点；
    - 验收发现收起后分隔线仍可聚焦，挡在“展开左栏”前面。改为收起时分隔线禁用，由顶栏按钮展开（决定点 8），收起后不能再从左缘拖出来。
  - 重要 2（`db061d9cf`）：Work 树只在当前页变了之后把当前行滚进可视区一次；那一行晚出现（数据刚到、所属 Work 刚展开）时等它出现再滚。推送带来新数据、展开别的 Work，都不再把树拽回当前行。
  - 建议 3（`db061d9cf`）：宿主在路由的 workId 变化时展开这个 Work，偏好里记成收起的也一样；在同一个 Work 里手动收起仍然有效。
  - 建议 4（`db061d9cf`）：当前 Work 在“更多”里时，“更多”只打开一次，之后能收起，`aria-expanded` 跟着变；展开后按钮文字是“收起 N 个”。
  - 建议 5（`db061d9cf`）：Work 树按 APG 的导航树标注：
    - 容器是 `tree`，名字取“工作”标题；Work 是第 1 层 `treeitem`，带 `aria-expanded`；Task 在 `group` 里，是第 2 层；
    - 展开按钮只给鼠标，加了 `aria-hidden`，展开状态只读一遍；“更多”挪到树外；
    - “一个 Tab 停靠点加方向键”保留；“工作”标题的 id 用 `useId` 拼，桌面与抽屉里各一份，不重复。
  - 建议 6（`ba83204ee`）：状态点的“数据”一行看外壳自己的三份数据（左栏与收件箱、面板状态、通知）。有一份重取失败，点就变黄，写出原因与显示的是什么时候读到的；`/api/meta` 第一次就失败时写“还没有读到过”。不按记录的年龄判断。
  - 建议 7（`db061d9cf`）：用 Esc、遮罩或关闭按钮关抽屉、路由没变时，等抽屉退场后焦点回到“打开导航”。从抽屉里换了页的，交给换页时挪到页标题的逻辑。
  - 建议 8（`dfc70ac32`）：
    - 页面名挪进路由元信息 `meta.title`，`PAGE_NAMES` 删了；
    - `docs/panel.md` 的“前端”加了“加一个页面”的清单：路由名与 `meta`、一个 `h1`、不再套一层竖向滚动、`NAV_GROUPS`、`pageTitle`；
    - `App.vue` 顶部注释改成 2d 之后的样子。
  - 建议 9（`dfc70ac32`）：`docs/panel.md` 的“滚动”写明例外：有上限高度的预览块可以自己滚。也写明三种槽位写法各自的原因，`app.css` 的注释说明为什么不用 nb-ui 的 `nb-ui-scrollbar-stable`。
  - 审计横幅（`ba83204ee`）：
    - `not_initialized` 的横幅给“知道了”，按“原因 + 审计文件路径”记进 `prefs.ts`，关掉后状态点详情里留一行“审计：未开启”，点不变黄；
    - `bad_owner`、`bad_mode`、`not_regular`、`unreadable` 的横幅常驻、不能关，状态点变黄。
  - 两处观感（`db061d9cf`）：
    - `PanelNav` 加 `inset` 属性，抽屉里传 false，不再叠两层左右内边距；
    - “工作”标题去掉负下边距，与树之间留 8px，树滚动后第一行不贴着标题。
  - 门禁（在 `8794881ad` 上）：包的 `typecheck`、`build:web` 通过；全量 `test` 380 过、0 失败、0 跳过；`git diff --check 5319aca19..HEAD` 干净。
  - 浏览器验收在 4490 上做，脚本是 `accept/phase2/review.ts`，证据在 `accept/phase2/review-fixes/`，21 条全过：
    - 重要 1：
      - 390 时前三个 Tab 停靠点依次是“跳到主内容”“打开导航”、搜索框，左栏 `inert`；
      - 收起之后前三个依次是“跳到主内容”“展开左栏”、搜索框；
      - 键盘按“收起左栏”，焦点到“展开左栏”，反过来也一样；拖动收起不挪焦点。
    - 重要 2：打开 Task 页时树滚到当前行（scrollTop 561）。翻到顶之后，在克隆里改目标造一次推送，3 秒后仍在顶上；在顶上展开另一个 Work，也不被拽回。
    - 建议 3：偏好写成 `{"w00022-dev-panel": false}` 再进 t15，左栏展开、t15 高亮，偏好被改成 true。
    - 建议 4：改写 overview 把 w00003 标成 done，再打开它的 Work 页：“更多”先打开、当前行在树里；点一下收起，`aria-expanded` 变成 false。
    - 建议 5：tree、第 1 层 22 项、第 2 层 16 项，Work 上有 `aria-expanded`，展开按钮都是 `aria-hidden`，“更多”在树外；可访问性快照存在 `r5-tree-aria-snapshot.txt`；方向键照旧。
    - 建议 6：`/api/meta` 一开始就回 500 时，状态点写“数据（面板状态）重取失败：…，还没有读到过”；正常之后让 `/api/overview` 回 500 再造推送，状态点写“数据（左栏与收件箱）重取失败：…，显示的是刚刚读到的”。
    - 建议 7 与审查要的补验：390 上按 Esc、点关闭按钮关抽屉之后，焦点都回到“打开导航”；从抽屉里点“产物”换页，焦点到新页面的标题“产物”。
    - 建议 8：在跑页的标签页标题是“在跑 · nbdev”，不存在的地址是“找不到这一页 · nbdev”。
    - 审计：
      - 注入 `not_initialized` 后能“知道了”，刷新也不再出现；状态点仍是“状态：正常”，详情里有“审计未开启”；
      - 换一个审计文件路径，横幅重新出现；
      - 注入 `bad_mode` 后横幅常驻、没有“知道了”，状态点变黄。
    - 观感：抽屉里的条目离抽屉左缘 41px（只剩抽屉自己那一层）；“工作”标题与树之间 8px。
    - 改了左栏的 DOM 之后，阶段 2 的验收脚本跟着改了三处选择器（树、展开按钮）。在同一个构建上重跑，48 条仍全过，结果在 `accept/phase2/final2/`。
  - 没有验证到的地方：
    - 没有用真的读屏器（NVDA、VoiceOver）听过 Work 树，只核对了角色、层级与可访问性快照；
    - r4、r6、审计这几条用的页面没挂控制台监听，注入的 500 不在控制台记录里，其余页面没有错误与警告。
  - 顺带发现：nb-ui `Drawer` 的关闭按钮没有可读名，读屏器读不出它是“关闭”（`Drawer.md` 已写明）。本 Task 不改 nb-ui（D3），记在这里，留给 nb-ui。
- 2026-10-14：同步 master，提交 `da076217c merge: 同步 master`。
  - 判断依据：主 Agent 给的判据 `git merge-base --is-ancestor chore/w00017-t85-master-merge master` 不成立，但 w00017 实际已经合入：
    - master 上的 `bc2081d8b merge: w00017 应用运行时与插件化重建合入 master`，第二个父提交是 w00017 的头 `e4cbd1248`；
    - `chore/w00017-t85-master-merge` 分支上的那个合并提交是 `c820d1660`，合的是同一个 `e4cbd1248`；
    - 两个合并提交的内容只差一份入库的审查报告。
    所以按“已经合入”处理。
  - 同步过程：
    - 合并没有冲突，`packages/dev-panel` 在合并里没有变化；
    - `prox bun install --frozen-lockfile` 通过；
    - 门禁重跑：`typecheck`、`build:web` 通过，全量 `test` 380 过、0 失败、0 跳过；合并提交 `git show --check` 干净。
  - 新 nb-ui 下的浏览器补验，脚本是 `accept/phase2/sync.ts`，证据在 `accept/phase2/review-fixes/after-sync/`：
    - 会话页的按键确认框明暗两套都有标题与屏幕，Esc 与“取消”都能关，没发出按键，关掉后焦点回到按键按钮；
    - 接管小窗能取消，确认后接管、打的字进了会话、能释放；
    - 左栏拖到 360、键盘左移到 350、收起再展开回到 350；
    - 新建页的分段控件能切换，`aria-checked` 正确。
    - 另外在同步后的构建上重跑了阶段 2 的 48 条与审查修正的 21 条，全过，控制台没有错误与警告。
  - 收尾：4490 的面板已 SIGTERM，浏览器已关，`/dev/shm/nbdev-t15-tmp` 已删，克隆是干净的；herdr 的 `w4:p1`、`w5:p1` 没动。
- 2026-10-14：阶段 2 合入 `master`，开发者授权。
  - 在临时 worktree 里 `merge --no-ff`，得到合并提交 `8423c09ed`（集成分支 `da076217c`，已含 w00017 合入后的 `master`）；主工作区 `merge --ff-only` 快进过去。
  - 合并提交的 `packages/`、`scripts/` 与依赖清单和集成分支相同；全量 `test` 在 `da076217c` 上由主 Agent 复跑：380 过、0 失败。
  - 主工作区 `bun install --frozen-lockfile` 没有变化；`service:restart` 后 4400 回 200，前端重新构建、预热完成。
  - 临时 worktree 与审查 worktree `.worktree/w00022-t15-review2` 已删除。没有 push。
  - 主 Agent 接受 `8794881ad` 的取舍：左栏收起后分隔线禁用，只能用顶栏的“展开左栏”展开。
- 2026-10-14：阶段 3（页面骨架与共用零件）做完，在集成分支 `feat/w00022-dev-panel` 上，未 push。w00017 重写 master 历史之后，本节之前记的提交号都已失效，要引用先按提交说明 `git log` 查新号。
  - 提交（`e80ca1fa2..b94ea7b11`，24 个，含暂停时的 `f282453cc` wip 与主 Agent 的同步 `73a14c144`）：
    - 零件与共用：`6e015ba9e` 3a 语义类、`2bd3487ee` 3b PageShell 与阅读卡片、`0d217bca4` 3c、`086a80dde` 3d、`2f40f61fc` 3e、3f 零件（TruncatedText、ActionLink）、`46ecebbb5` 删掉 StaleNotice；
    - 逐页换骨架，一页一个：`af4397ac1` 首页、`b2ffabc4c` Work、`ff81bd065` Task、`77962f157` 产物列表、`a4be29900` 产物页、`c94c63f3a` 文档页、`56de99a52` 会话页、`2ceca4ae3` 在跑、`816814c99` checkout、`654d964c0` GitHub、`9144b1cc0` 搜索、`e13a63582` 找不到的页面、`5be8fde35` 新建、`679cc4c09` 编辑；
    - 验收发现：`3273e5cc5`（标题顶边各页一致、区标题只剩一档、复制结果念给读屏器）、`b94ea7b11`（区标题用 `--text-lg`）。
  - 门禁（在 `b94ea7b11` 上）：包的 `typecheck`、`build:web` 通过；全量 `test` 386 过、0 失败、0 跳过，用时 6 分 26 秒；`git diff --check e80ca1fa2..HEAD` 干净。新增的测试：`tests/web-writes.test.ts`（写入结果的两层与字段锚点）、LoadState 的 `loadStateOf` 用例。日志在 `accept/phase3/gate-*.log`。
  - 内联 style：静态 241 处降到 13 处，绑定 18 处降到 15 处（`accept/phase3/style-count-before.txt`、`style-count-after.txt`；基线记的是重写前的旧号）。剩下的是宽度、栅格这类按数据算的值与 App.vue 外壳里的布局。
  - 浏览器验收：在 4490 上用集成分支的构建起面板，脚本是 `accept/phase3/accept.ts`，23 条全过，结果在 `accept/phase3/checks/results-all.txt`。改前、改后的截图各 64 张（14 页，明暗两套，390 与 1440；Task、文档页另有 1280 与 1920），在 `before/`、`after/`，脚本 `shots.ts`、页面清单 `pages.ts`。
    - 3a：各页页标题一档 19px、区标题一档 15px。
    - 3b：
      - 14 页的页标题顶边都在 101px，每页一个 `h1`；首页之外都有能回上一级的面包屑；
      - Task 页在 1280、1440、1920 下卡片右缘到正文右缘只剩内边距（25px），整页居中；文档页正文一栏就是阅读宽度、居中，右边不再空一片。
    - 3c：
      - 新建成功但带警告时，结果是成功的绿色，警告收在“附注 1 条”里，表单不移动；
      - 编辑页把 `taskId` 改掉，被拒的原因只出现一次，编辑器不被推下去。
    - 3d：加载时页头先出（标题先用编号），数据到了之后标题顶边与左栏都不跳；不存在的 Work 显示“找不到了”与“回到首页”，不给重试；网络错误且没有数据时给“重试”。
    - 3e：1440 下 checkout 页不必横向滚动；截断的路径悬停看全文，点一下复制全文，读屏器经 live 区念“已复制”；Task 表的长标题换行显示全文。
    - 3f：编辑 README、新建 Task、编辑、去“在跑”这些入口都是按钮形态，页头里不再有当按钮用的小字链接。
    - 3g：会话页、在跑页不再整页虚线框，临时的分区在标题旁带“临时”徽标；Task 页的“谁在动”仍是虚线框；会话页的“无主的运行”只留数目与去“在跑”的入口。
    - 控制台只有预期的报错：编辑页改 `taskId` 被拒的 400、不存在的 Work 的 404、注入的 503。
  - 验收发现并修掉的问题（`3273e5cc5`、`b94ea7b11`）：
    - 有标题行带按钮、有的不带，页标题顶边差几像素：PageShell 的标题行给了 `min-h-8`；
    - 首页没有面包屑，标题比别的页高：给一项“首页”；
    - 零件里的 `h2` 各写各的字号：统一用 `nbdev-heading`；
    - nb-ui 的主题 nbook 里 `--text-md` 与 `--text-sm` 都是 13px，区标题和正文一样大：改用 `--text-lg`；
    - nb-ui `Tooltip` 给读屏器的 `role=tooltip` 副本在打开时就定死了，“已复制”念不出来：TruncatedText 另加一个 `sr-only` 的 live 区。
  - 偏离计划的地方：
    - 3d 不做骨架屏，加载时先出页头与转圈（规范第 4.3 节第 8 条，主 Agent 已认可）；
    - 区标题用 `--text-lg`，计划写的是 md，原因见上；
    - 首页也给面包屑，只有一项“首页”；
    - 3c 的结果位置按页不同：编辑页放进贴底的操作栏 `.nbdev-edit-bar`（冲突的差异放在编辑器下面），新建页放在右栏顶上（带警告时用 `nbdev-surface-warn`），其余页面放在 PageShell 的 `feedback` 槽；产物页的答复结果仍在侧栏里，跟着答复表单；会话页的两条结果（通知、会话详情里的按键与文字）留在各自的分区里，贴着通知列表与终端（审查建议 9 补记）；
    - Notice 换成 `{outcome, title, message, items, notes, retry}`，`outcome` 分成功、失败、冲突、不确定、提示五种，字段问题用 `fieldProblems` 锚到表单；删掉了 WriteNotice 与 StaleNotice，旧数据提示收进 LoadState（`hasData`、`receivedAt`、`upHref`、`upLabel`）；
    - Task 表的长标题换行显示全文，没有截断；截断只用在路径、分支这类不能换行的值上；
    - 文档页只有正文一栏套阅读宽度（`nbdev-reading-column`），树仍贴左；标题取文档开头的 `h1`；
    - 编辑页的面包屑按文件路径推出所属的 Work 与 Task；
    - 表单字段的定义挪进 `host/create-fields.ts`，新建页与表单零件共用。
  - 验收环境：
    - w00017 重写历史之后，审查克隆 `/dev/shm/nbdev-ui-review/repo`（alternates 指向主仓库的 objects）丢了对象，记录重算失败。在原目录重建：旧 `.git` 移到 `/dev/shm/nbdev-ui-review/broken-git-20261014`，用 `git clone --shared --no-checkout` 得到新的 `.git` 放回，`reset --hard` 到新 master，`git clean -fd`（保留 `.worktree`、t16-ux-b-probe 与 t15 的产物），再提交 `e56a5fef7 test(env): 验收环境带回旧克隆里的测试记录`。旧的集成 worktree 挪到 `.worktree/old-w00022-dev-panel`（herdr `w2:p1` 的 shell 在里面），重新 `git worktree add .worktree/w00022-dev-panel`；
    - 所以改前截图拍在旧克隆上，数据和改后不同，前后只能比布局；
    - 4490 的面板已 SIGTERM，浏览器已关，`/dev/shm/nbdev-t15-tmp` 已删；herdr 的 `w4:p1`、`w5:p1` 没动；`broken-git-20261014` 与 `old-w00022-dev-panel` 留着，确认不用之后可删。
  - master 同步：`HEAD...master` 之间 master 新增的都是文档提交，`packages/`、`bun.lock`、`package.json` 没有差异，这次没有同步。
  - 没有验证到的地方：
    - 只看了 Chrome，没看 Firefox、Safari；
    - 没用真的读屏器听“已复制”与 LoadState 的状态，只核对了 live 区与角色；
    - 编辑页的 Ctrl+S 保存没做；
    - 慢网络下“页头先出、标题先用编号”只在 Work 页验过；
    - 截图前后数据不同，见上。
- 2026-10-14：阶段 3 实现审查（`evidences/impl-review-phase3.txt`）的结论是 0 阻断、2 重要、7 建议。主 Agent 九条都采纳，在集成分支上改，未 push。
  - 提交（`b94ea7b11..f86ecdc08`，8 个）：
    - 重要 1（`af820270c`）：文档页没选文档、加载、出错时，正文一栏缩成一条窄栏，数据到了再弹开。改为空状态、`LoadState` 与正文都放进同一个始终渲染的 `nbdev-reading-column`；`PageShell.md` 写明定宽的那块要在各种状态下都渲染。
    - 重要 2（`fa010c1e7`）：首页会话入口在 390 宽横向溢出。`ActionLink` 去掉不换行，最宽是所在的行、放不下就换行；`ActionLink.md` 同步。
    - 建议 3（`d85959bb8`）：`TruncatedText` 上写的 `class` 被 reka 的 `TooltipProvider` 吞掉，提交号成了正文色。Task 页与文档页改为外面包一层带类的 `span`；`TruncatedText.md` 写明 attrs 不生效与包一层的做法。
    - 建议 4（`c9c41f579`）：产物页答复被拒时原因报三遍。`failureNotice` 的锚点也认题号（`problems[].questionId`、`details.questionId`），产物页传入还能答的题；结果写“表单里标出了 N 处”，锚不到的题仍进明细。补了一条 `tests/web-writes.test.ts` 用例。
    - 建议 5、8（`400bb0f7a`）：
      - `LoadState` 加 `subject`，404 写“找不到”接上它（例如“找不到 w99999-not-there 这个 Work”），下一行“可能被删或改了名”，不再拼服务端的“找不到”；
      - “回到上一级”与旧数据那一行的链接改用 `ActionLink`（带返回图标）；
      - 文档页：checkout 已删、文档树 404 时，树、正文与面包屑都改去主工作区的文档 `/docs`；
      - 编辑页：找不到文件时，记录的 README 回到所属 Task 或 Work，其余文件回到文档页；页头的“看文档”等文件读到了再出，不再指向同一个 404；
      - Work、Task、产物页都传了 `subject`。
    - 建议 6（`9400106a1`）：新加 `nbdev-card-title`（正文字号、600 字重），用在 Work 卡片标题、“预览”、“会话详情”、产物侧栏的“通知”。`nbdev-heading` 只给页面分节；`panel.md` 写明各用在哪里。
    - 建议 7（`434625133`）：
      - `BranchNote`、`QuestionPanel` 改用 `nbdev-hint nbdev-hint-warn`（新加的警告底变体）；
      - 在几个 token 之间按状态选的 `:style` 改成 `:class`，新加 `nbdev-accent`；
      - 外壳一处一用的面层底色挪进 `App.vue` 的 scoped 样式；`EphemeralFrame`、`DiffView` 用 scoped 类。
      - 计数（`accept/phase3/style-count-review-before.txt`、`style-count-review-after.txt`，`style="` 与 `:style` 都统计并逐处列出）：静态 13 处降到 1 处，绑定 15 处降到 3 处。修正前的 15 处绑定里，纯常量 1 处，在几个 token 之间选 10 处，映射表取色 1 处，随数据算 2 处，与量尺寸共用常量 1 处。
      - 留下的三处各有注释：产物页 iframe 定死亮色底、Task 状态条每段的占比宽度与状态色、终端接管时与量列数共用的框高。
    - 建议 9（`f86ecdc08`）：
      - `WriteResult.md` 的“提示灰”改成实际的强调色（nb-ui `Notification` 的 `info`）；本计划 3c 的同一句也改了；
      - `writes.ts` 里“失败”的注释写明 `commit_failed`、`changed_after_write` 已写进工作区、没有提交也算失败，能否重试只看 `retry`；
      - `panel.md` 里“编辑页不放旧数据提示”改成“只在重新登录或重连之后的全部重取失败时出现”；
      - 阶段 3 偏离记录补上会话页写入结果的位置（留在通知与会话详情各自的分区里）。
  - 门禁（在 `f86ecdc08` 上）：包的 `typecheck`、`build:web` 通过；全量 `test` 387 过、0 失败、0 跳过，用时 6 分 26 秒；`git diff --check b94ea7b11..HEAD` 干净。日志在 `accept/phase3/review-fixes/gate-*.log`。
  - 浏览器验收：在 4490 上做，脚本是 `accept/phase3/review-fixes/review.ts`，15 条全过，结果在 `review-fixes/results-all.txt`，截图 14 张。
    - 重要 1：1440 宽，文档页没选文档、加载中（挂起 `/api/docs/file`）、出错（注入 503）、正文四种状态下，正文一栏都是 626px、标题左缘都在 721px，顶边 101px 不变。截图 `r1-docs-empty`、`r1-docs-loading`、`r1-docs-error`、`r1-docs-loaded`。
    - 重要 2：390 宽，改写 overview，让会话入口列出“6 个会话（工作中 2、空闲 1、受阻 1、完成一轮 1、不在 herdr 里 1），3 个无主的运行”。明暗两套下页面与 main 都不横向溢出，入口换成两行、右缘在 374px。截图 `r2-home-390-light`、`r2-home-390-dark`。
    - 建议 3：Task 页与文档页的提交号与日期同为次要色，与提交说明不同色。
    - 建议 4：注入 400 `invalid_answer`，原因只在 q5 下面出现一次，结果写“表单里标出了 1 处要改的地方”。截图 `r4-artifact-rejected`。
    - 建议 5：
      - `/docs?checkout=gone-checkout&path=AGENTS.md`：树写“找不到 gone-checkout 这个 checkout”，正文写“找不到 AGENTS.md 这份文档”，两处都给“去主工作区的文档”（`/docs`），面包屑“文档”也指 `/docs`；点了之后文档树能用；
      - 主工作区里不存在的文档回到 `/docs?checkout=main`；
      - 编辑页找不到普通文件时“回到文档”，找不到 Task README 时“回到 Task”，页头没有“看文档”。
      - 截图 `r5-docs-checkout-gone-1440`、`r5-docs-404-1440`、`r5-edit-404-1440`。
    - 建议 6：Work 卡片标题、“预览”、“会话详情”都是 13px、600 字重；首页“Work”、会话页“通知”这类分节仍是 15px。截图 `r6-home-cards-390`。
    - 建议 7：两份计数文件对得上；文档树选中行、顶栏底色、状态点、Task 页“谁在动”的虚线框与标签，计算出的颜色与原来的 token 一致。
    - 建议 8：
      - Work 404 写“找不到 w99999-not-there 这个 Work”，“找不到”只出现一次，“回到首页”是 `ActionLink`（截图 `r8-work-404-1440-light`、`r8-work-404-390-dark`）；
      - Work 页已有数据后再取回 404（在克隆里改 README 造一次推送，用完还原）：一行写“已经找不到 w00022-dev-panel 这个 Work 了”，表格还在，链接是 `ActionLink`（截图 `r8-work-stale-404-1440`）。
    - 回归：在同一个构建上重跑阶段 3 脚本的 3b、3c、3e、3f、3g，18 条全过，结果在 `review-fixes/regress/`。3a 的“区标题只有一档”与 3d 的“找不到了”这两条按这次的改动作废，由上面的建议 6、8 代替。另拍了改后的首页、Task、文档、会话、在跑、新建、产物页（`review-fixes/after/`，32 张），控制台没有错误与警告。
    - 控制台只有注入的 503、400 与 404。
  - 偏离：
    - 文档页的空状态、加载与找不到放进阅读栏后，字号跟着用阅读字号，比别的页的同类区块大一档；与 Task 页阅读卡片里的 `LoadState` 一致，没有再压回正文字号；
    - 文档树 404 的区块在左栏里竖向居中（`LoadState` 原有的 `flex-1`），没有改。
  - 没有验证到的地方：
    - 产物侧栏的“通知”标题要答复成功才出现，只从代码核对（同一个类）；
    - `LeaseChip`、`BranchNote`、`QuestionPanel` 的“要重新答”只在截图里看了有的那几处，没有逐个造数据；
    - 只看了 Chrome。
  - master 同步：master 到 `9e9d69fc6`，新增的都是文档提交，`packages/`、`bun.lock`、`package.json` 没有差异，没有同步。
  - 收尾：4490 的面板已 SIGTERM，浏览器已关，`/dev/shm/nbdev-t15-tmp` 已删，克隆是干净的；herdr 的 `w4:p1`、`w5:p1` 没动。
- 2026-10-14：阶段 3 合入 `master`，开发者授权。
  - 在临时 worktree 里 `merge --no-ff`，得到合并提交 `3adabdc02`（集成分支 `f86ecdc08`）；主工作区 `merge --ff-only` 快进过去。
  - 合并提交的 `packages/`、`scripts/` 与依赖清单和集成分支相同；全量 `test` 在 `f86ecdc08` 上由主 Agent 复跑：387 过、0 失败。
  - `bun install --frozen-lockfile` 没有变化；`service:restart` 后 4400 回 200，前端重新构建完成。
  - 审查 worktree `.worktree/w00022-t15-review3` 与临时 worktree 已删除。没有 push。
  - 开发者没有选“先修多选题”，多选题点了页面变空白的问题放到阶段 4 的产物页（[后续清单](../../followups.md)）。
- 2026-10-14：阶段 4 改成分五批（见“阶段 4”的“分批”），第 1 批（产物页与收件箱）细化后开工；后续清单里标着“t15 阶段 4 一并考虑”“t15 汇总时一并考虑”的条目、多选题空白与文档页外站图片已写上去向（第 1、2、4 批）。
- 2026-10-14：阶段 4 第 1 批（产物页与收件箱）做完，在集成分支 `feat/w00022-dev-panel` 上，未 push。
  - 提交（`ae389daaa..66cdf885f`，8 个）：
    - `4f094659d` 多选题空白：`main`、`.nbdev-scroll-y` 与页面里自己开的滚动容器（文档页三处、checkout 表、终端框）加 `relative`；新测试 `tests/web-scroll-containers.test.ts` 扫模板钉住，在改前的代码上失败（7 处缺 `relative`，`.nbdev-scroll-y` 没有 `position: relative`），改后通过；
    - `14456d462` 服务端：答复只收这一版里的题，之前几版的题报 `question_retired`（409，退出码 3）；判据是 `core/questions.ts` 的 `isRetiredFromPage`，面板与核心共用；补在核心测试“场景 2 与第 11 条”里；`file-formats.md`、`cli.md`、`panel.md` 同步；前端把它算进要重新取数的错误码；
    - `bb57bef23` 服务端：`status` 的收件箱条目加 `artifactTitle`，`cli.md` 同步，测试补一项；
    - `15633cce2` 服务端：新函数 `awaitsAnswer`，收件箱、产物的 `openRequired`、`answers --pending` 与 Task 收尾的提醒都不再算“之前几版的题”（这种题答复作废时状态是 `open`，但已经答不了）；
    - `b468d80e3` 零件 `ArtifactFrame`（iframe 加“页面是当前版本”的说明，沙箱、`no-referrer`、亮色白底的理由在 `.md` 里）；
    - `ba0449068` 产物页：路由声明“铺满”，宽屏两栏各自滚动、窄屏整页由页面根滚；侧栏分待答、已答（只读，点“改答”才给控件，可“取消改答”）、之前几版的题（只读、默认折叠）、已取代与撤回；“新”题标记；提交栏贴底，写“已改 N 题 · 还有 M 道必答没答”，结果放在栏里、逐题写答了什么。新文件 `host/answers.ts`（分组、答案文字、“新”的判定，`tests/web-answers.test.ts`）与零件 `QuestionControl`（从 `AnswerForm` 抽出的作答控件）；`AnswerForm`、`QuestionPanel` 与各自的 `.md`、`docs/panel.md` 的“滚动”与产物页一行同步；
    - `a5b91106f` 首页收件箱按产物合并：`host/inbox.ts` 的 `groupInbox`（`tests/web-inbox.test.ts`），`InboxList` 与 `.md` 同步；
    - `66cdf885f` 验收发现：成功提示的标题原来是“已提交 N 题”，下一行又是“已提交 <提交号>”，改成“答了 N 题”。
  - 门禁（在 `66cdf885f` 上）：包的 `typecheck`、`build:web` 通过；全量 `test` 393 过、0 失败、0 跳过，用时 6 分 32 秒；`git diff --check ae389daaa..HEAD` 干净；根目录 `dev-panel-records` 5 过；`docs:check` 通过。`governance:check` 没跑成：worktree 里有一个只剩被忽略的 `node_modules` 的旧目录 `packages/neuro-book-manager/`（`git ls-files` 为空，是以前装依赖留下的），检查在读它的 `package.json` 时就退出了，与本批无关，没有动它。日志在 `accept/phase4/batch1/gate-*.log`。
  - 复现与根因（`accept/phase4/batch1/`）：
    - 多选题：把真实仓库 w00017 t86 review 产物的 v1 到 v3 与前两份答复复制进验收克隆（`t15-ui-polish/artifacts/t86-review`，克隆提交 `548524ef9`），在 v3 的多选题上点第二个选项，正文整块变空（`repro2-after.png`）；探针显示外壳 `Splitter` 那一格（`overflow: hidden`）被滚了 3785px、`main` 被滚了 4179px，`sr-only` input 的 `offsetParent` 是那一格。改后同一操作那一格不再滚动，`offsetParent` 是 `main`（`repro-fixed/repro2-after.png`）。uxq 的多选题表单短、不用滚，所以不复现；
    - 旧题怎么进了第二轮答复：在 t86-review 副本上试了键盘聚焦、Tab、方向键，“提交 N 题”的计数都不变，没有复现出控件自己改值；最可能是在与本轮混在一起的旧题上点了一下。现在旧题不进表单、服务端拒收，两种原因都挡住。
  - 浏览器验收在 4490 上做，脚本是 `accept/phase4/batch1/accept.ts`，结果在 `final/results-*.txt`，15 条通过：
    - 多选题：t86-review 上点第二个选项，页头仍在 101px，没有 `overflow: hidden` 的元素被滚动，选项打勾；
    - 之前几版的题：表单里只剩 7 道 `r3-*`；“之前几版的题 26（这一版页面上已没有，只读）”展开后有“缩进参考线”、没有控件；用接口直接答 `indent-guides` 回 409 `question_retired`，克隆里没有新答复；
    - 分段：t86 v3 的 7 道待答都标“新”，另有“之前几版的题”“已取代与撤回”；uxq 分“待答”“已答”，已答只读、写“280px”“v5 答 · 15 小时前”，点“改答”出现 3 个单选、改了计入“提交 1 题”，“取消改答”回到“提交 0 题”；
    - 各自滚动：1440 宽时滚侧栏 573px，iframe 顶边不动（195px）、页面根与 `main` 都不滚；在 iframe 里滚，页面里的 `scrollY` 变了、侧栏不动；uxq 同样不滚、iframe 高 682px；390 宽上下堆叠，由页面根滚动、侧栏不自己滚，没有横向溢出；
    - 提交栏：滚到顶与滚到中间，栏的下边都贴着侧栏下边（差 1px），写“已改 0 题 · 还有 5 道必答没答”；
    - 收件箱：t86-review 合成一行“资源管理器打磨：配色、状态图标与搜索 5 道待答”，列三道题、写“等 5 道”；uxq 一行；撞号照旧；点那一行到产物页；
    - 真提交两次（克隆里多了两个提交 `e4fa13334`、`8e489b2fc`）：t86 的多选题选两项，结果在提交栏里写“过滤框匹配什么：文件名、展示名（内容文件夹的标题）”与提交号，答复文件只有这一题、针对 v3，这道题挪到“已答”；uxq 的确认题，结果写“答了 1 题 / 已提交 <提交号> / 新增的一题：同意”。第一次真提交的判定脚本把正则写错了（以为答案里带“（推荐）”），记成“失败”，按改正后的正则核对同一段文字通过，结果文件里写明了；提交没有重跑；
    - 截图：首页、t86-review、uxq，明暗、390 与 1440（`final/shot-*.png`，12 张），另有各条的截图。
    - 回归：在本批的构建上重跑阶段 3 的 3b、3c、3e、3f、3g 与审查修正的 r1、r3、r4、r5、r8，全过（`regress/`）；产物页标题顶边仍是 101px。
    - 控制台只有注入或预期的 409（旧题）、400（r4 注入）、404。
    - 前五条（多选、旧题、分段、滚动、收件箱）跑在改成功标题之前的构建上，与最后一个提交只差那一行文字；之后真提交改变了待答数，没有在最终构建上重跑这五条。
  - 偏离计划的地方：
    - 计划里的“产物页布局”与“侧栏分段”合成一个提交（`ba0449068`）：两者改的是同一份模板；
    - 多加了 `awaitsAnswer`（`15633cce2`）：之前几版的题答复作废时是 `open`，不改的话收件箱会列一道答不了的题；
    - 作答控件抽成零件 `QuestionControl`：待答与“改答”两处共用；
    - 提交栏贴底要求侧栏不留下内边距（sticky 按滚动容器的内边距框停，留了会露出一截内容），写进了 `AnswerForm.md`；
    - 左栏“首页与收件箱”的数字仍按题数算（与原来一致），首页“收件箱 N”也是题数加撞号数。
  - 没有验证到的地方：
    - `awaitsAnswer` 的情形（之前几版的题答复作废）没有造数据测，只从代码核对；
    - 只看了 Chrome；没用真的读屏器听分段与“新”；
    - `question_retired` 的 HTTP 映射没有单独测（按退出码统一映射，浏览器验收里看到了 409）。
  - 验收环境：克隆里多了 `548524ef9`（复制的 t86-review）与两次真提交；4490 的面板已 SIGTERM，浏览器已关，`/dev/shm/nbdev-t15-tmp` 已删；herdr 的 `w4:p1`、`w5:p1` 没动。
  - master 同步：master 仍是 `ae389daaa`，没有新提交，不用同步。
- 2026-10-14：第 1 批实现审查（`evidences/impl-review-phase4-batch1.txt`）的结论是 0 阻断、1 重要、9 建议；领域判定、服务端 409 与收件箱合并核实无误。主 Agent 十条全部采纳，在集成分支上改，未 push。
  - 提交（`66cdf885f..25f0361c0`，6 个）：
    - 建议 4（`eb783c0e7`，先做，免得后面的提交再改名）：“之前几版的题”在代码里统一叫 earlier，判据 `isRetiredFromPage` 改名 `isEarlierPageQuestion`，错误码 `question_retired` 改名 `question_earlier`（服务端、`cli.md`、`file-formats.md`、`panel.md` 一起改）；前端分组里“已取代与撤回”由 `retired` 改名 `closed`，与 `question_closed` 对上。发布输出里原有的 `retiredInPage`、警告 `retired_question_in_page`（已取代或撤回的题号又出现在页面里）是已有合同，没动。只改名，不改行为；
    - 重要 1（`7ceed3f07`）：表单不再在加载时预填已答的题；点“改答”时取现在的答案，提交时没改过取值（只写了说明）的题交现在的答案。两处共用 `host/answers.ts` 的 `editingValue` / `submittedValue`。用例补在 `tests/web-answers.test.ts`：先答多选、改答加一项，交的是原选项加新项；只写说明时交现在的答案。`AnswerForm.md` 的注意事项写明为什么不在加载时预填；
    - 建议 8、10（`f7b2e2f7b`）：对之前几版的题写 `--keep` 报 `keep_not_applicable`，提示“要重新问就放回页面”，`file-formats.md` 的题表规则同步；`core/artifacts.test.ts` 的 `--keep` 用例补这一情形，另加一条 `awaitsAnswer` 的用例（open 必答、选答、之前几版的题答复作废后、`ask` 登记的题，只有第一与最后算待答）；
    - 建议 3、9（`96383e1ae`）：`cli.md` 的收件箱、`--pending` 与警告 `open_questions` 三处改成“待答的必答题（`open`、必答、不是之前几版的题）”并链到“状态现算”；`panel.md` 的零件清单补 `ArtifactFrame`、`QuestionControl`；
    - 建议 2（`da323e3cd`）：`tests/web-scroll-containers.test.ts` 按元素扫，`:class` 里的字符串字面量与对象键也认；注释写明 scoped `<style>` 与 nb-ui 内部的滚动区扫不到。自检：把产物页侧栏的 `lg:overflow-y-auto` 挪进 `:class` 并去掉 `relative`，测试失败、报出这一处，还原后通过。nb-ui `FormCheckbox` 的 label 缺 `relative` 记进后续清单的“推迟事项”，去向“交 nb-ui”；
    - 建议 5、6、7（`25f0361c0`）：产物页“待答”标题写“必答 N · 选答 M”，首页收件箱的徽标改成“必答 N”（收件箱只收必答题），两边口径一致；“这份答复的通知”从侧栏顶上挪进贴底提交栏、放在结果下面，栏里的这一块限高 40vh、自己滚；`ArtifactFrame` 的说明改成宿主传的 `note`（缺省“页面是当前版本（磁盘上的）”，产物页传带“切换版本只切换题表”的整句），`versionNote` 去掉。相关 `.md` 与 `panel.md` 同步。
  - 门禁（在 `25f0361c0` 上）：包的 `typecheck`、`build:web` 通过；全量 `test` 395 过、0 失败、0 跳过，用时 6 分 37 秒；`git diff --check 66cdf885f..HEAD` 干净；`dev-panel-records` 5 过；`docs:check` 通过。日志在 `accept/phase4/batch1/review-fixes/gate-*.log`。
  - 浏览器验收在 4490 上做。为了让第 1 批的脚本按原来的数据跑，先把克隆重置回 `548524ef9`（丢掉第 1 批验收时的两次真提交）。
    - 回归：第 1 批脚本 `accept.ts` 全部重跑（结果在 `review-fixes/regress/`），15 条通过。两处判据随这次的改动更新：收件箱的期望文字由“5 道待答”改成“必答 5”；旧题的错误码由 `question_retired` 改成 `question_earlier`（第一次跑时这一条按旧码判成“失败”，改脚本后单独重跑“old”一组，通过）。其中真提交又做了两次（克隆提交 `bd6a75805`、`c7553bc46`），这次提交栏里能看到“通知”一块。
    - 逐条验（`review-fixes/review.ts`，结果 `review-fixes/results-review.txt`，5 条通过）：
      - 第 5 条：产物页“待答 必答 4 · 选答 2”，首页那一行“必答 4”；
      - 第 1 条：同一页里刚交了 `r3-marks` 的“要调整”，马上点“改答”，单选里选中的是“要调整”；多选题 `r3-filter-match`（已答 name、title）点“改答”时勾着原来两项，再勾“拼音”提交，答复文件是 `["name","title","pinyin"]`；再点“改答”只加说明、不碰选项，答复文件里取值仍是这三项、说明也在。这三次真提交是克隆提交 `400dac980`、`289975802`、`a7d20673b`；
      - 第 6 条：提交后“通知”在贴底提交栏里、在视野内（栏顶 636px、通知块底 823px，视口 900），侧栏别处没有第二份。截图 `r1-multi-editing.png`、`r6-notify-in-bar.png`。
    - 控制台只有预期的 409（直接调接口答旧题）。
  - 没有验证到的地方：第 1 条的“别处答了（代录、另一个标签页）再改答”没有在浏览器里造，与“刚交完再改答”走同一条取值路径；第 7 条只看了产物页的说明文字照旧，宿主传别的文字要到第 2 批速览面板才用上。
  - 后续清单：主 Agent 10-14 在“试用建议”末尾加的 4 行（左栏 Work 快速查找、首页撞号原因、分支与 worktree 与开发服务的对应、会话标题）没动，排第 2、3、4 批时并进去。
  - 收尾：4490 已 SIGTERM，浏览器已关，`/dev/shm/nbdev-t15-tmp` 已删；herdr 的 `w4:p1`、`w5:p1` 没动。master 是 `32d979fd3`（只多了审查报告），`packages/`、`bun.lock`、`package.json` 没有差异，不用同步。
- 2026-10-14：阶段 4 第 1 批合入 `master`（合并提交 `b976c54da`，集成分支 `25f0361c0`），开发者授权，并说 t15 后续各批都直接合入、重启，不用再问。
  - 全量 `test` 在 `25f0361c0` 上由主 Agent 复跑：395 过、0 失败；合并提交的代码与依赖清单和集成分支相同。
  - `bun install --frozen-lockfile` 没有变化；`service:restart` 后 4400 回 200，前端重新构建完成。审查 worktree 与临时 worktree 已删除。没有 push。
- 2026-10-14：阶段 4 第 2 批计划细化（见“第 2 批”一节），后续清单里标着第 2 批的 6 条已写上去向；“分类、优先级”要改记录格式，写成决定点 18，这一部分没做，等开发者定。
- 2026-10-14：阶段 4 第 2 批（首页其余、左栏、Work 页、Task 页与速览面板）做完，在集成分支上，未 push。
  - 提交（`4bd1aa473..984a289b8`，10 个）：
    - `274760e4d` 服务端：收件箱的撞号条目带 `ids`（各个 id、是否 live、位置），`cli.md` 同步，`tests/cli.test.ts` 场景 6 补一项；
    - `e3bff0565` 首页：撞号一行写明哪几个名字、各在哪里，旧副本标出来，“怎么处理”链到 `.agents/works/README.md`；收件箱上面一行“通知要处理 N 条”；Work 卡片有事等我的在前（`host/nav.ts` 的 `byAttention`，与左栏共用）；卡片目标两行、间距收小；
    - `6bd524835` 左栏：Work 行的状态色点（与 `StatusChip` 同色，未标空心）、待答角标、在动图标、状态的隐藏文字；筛选框（编号或标题，有筛选词时不收进“更多”）；排列方式（按编号、最近更新在前、有事等我在前、按状态分组），记进偏好；分组与排序在 `arrangeNavWorks`，`tests/nav.test.ts` 补三条；
    - `e4eb8256e` 状态只显示一处：`StatusSwitch` 平时是“改状态”按钮，点了才出下拉与确认；页头标题旁的 `StatusChip` 是唯一的状态显示（Work 页、Task 页）；
    - `b1e9f1caa` `readSection` 挪进无依赖的 `core/sections.ts`（`frontmatter.ts` 转出，调用方不变），前端直接导入；加 `renderInlineMarkdown`，`MarkdownView` 加 `inline`；
    - `2772c59cc` Work 页：Task 表改成能就地展开的网格（ARIA 表格角色；nb-ui `Table` 不做行展开）；展开显示当前状态、下一步、产物（带待答数）、证据、谁在动，产物与证据链到 Task 页的速览；3 个固定资源槽，展开第 4 行收起最早的那行（`host/task-expand.ts`，`tests/web-task-expand.test.ts`）；“当前情况”按行内 Markdown 渲染；为 0 的计数淡化；`?peek=` 的写法在 `host/peek.ts`（`tests/web-peek.test.ts`）；
    - `f377dd825` Task 页的速览面板：零件 `PeekPanel`（外框、标题焦点、关闭、Esc、三种摆法）；侧栏里的产物、文档、Spec、证据文件点了在面板里开，`?peek=` 能后退、刷新、分享，中键照样开完整页；产物显示 `ArtifactFrame` 加状态行与“去答复”“打开完整页”，文档渲染 Markdown，证据原样显示；内容区宽于 1100px 并排（正文让出面板宽度，Task 页改成一栏），窄于它浮层加遮罩，手机整屏；关闭时自己 push 的就后退、分享来的就替换，焦点回到打开它的链接；
    - 验收发现：`d655c77d9` 文档树原来没有 `.agents/works/README.md`，“怎么处理”打开是 404：文档树收进 `.agents/works` 根上的 `README.md` 与 `AGENTS.md`（字面路径，下面的记录不算），`panel-core` 测试补一项；`fee4e1661` 撞号的位置原来把所有 ref 都列出来（主工作区、worktree 的绝对路径、八个 ref），写短：worktree 只写目录名，ref 只列两个本地分支、其余记个数；`984a289b8` Work 页的 Task 表在 390 宽时横向滚动、展开内容三栏被切：手机上只留展开、Task、状态三列，展开内容一栏。
  - 门禁（在 `984a289b8` 上）：包的 `typecheck`、`build:web` 通过；全量 `test` 401 过、0 失败、0 跳过，用时 6 分 29 秒；`git diff --check 4bd1aa473..HEAD` 干净；`dev-panel-records` 5 过；`docs:check` 通过。日志在 `accept/phase4/batch2/gate-*.log`。
  - 浏览器验收在 4490 上做，脚本 `accept/phase4/batch2/accept.ts`，最终构建上一次跑完，28 条全过，结果 `final/results-all.txt`，控制台没有错误与警告：
    - 首页：撞号写出 `t05-component-lab`（主工作区、worktree w00022-dev-panel、已提交在 feat/w00022-dev-panel、master 等 8 个 ref）与 `t05-preview-retirement`（旧副本）；“怎么处理”打开“Agent Works”文档页；第一张卡片是有待答题的 w00022；卡片目标都不超过两行；收件箱上面有“通知要处理 1 条”；
    - 左栏：w00022 的色点与页头徽标同色（`rgb(0, 122, 255)`），角标 3、在动图标、隐藏文字“进行中”；筛“w00022”只剩它，筛“development workflow”找到“更多”里的 w00001；按状态分组有“进行中”“未标”两组，刷新后还在（克隆里没有完成、搁置的 Work，收起的组由单元测试钉住）；有事等我在前时 w00022 排第一；方向键照旧；
    - Work 页：状态一处，“改状态”点了才出下拉、取消收回；“当前情况”里 14 个链接、没有 `](` 源码；展开 t15 五块都在、7 个速览链接；依次展开 t15、t01、t02、t03 后只剩 t01 到 t03 展开，Task 接口各取一次；390 宽三列、展开一栏、不横向滚动；
    - Task 页：状态一处；点产物开面板、网址 `?peek=artifact/uxq`、焦点在面板标题、沙箱与产物页相同、没有答复表单；Esc 关闭、焦点回到链接；后退就关；文档渲染、刷新还开着、网址贴进新标签页直接打开、在那里点“关闭”替换掉 `?peek=`；证据 iframe 原样显示；中键开完整产物页、本页不开面板；
    - 摆法：1920（内容区 1609）、1440（1129）并排，正文卡片 626px、不被盖住；1440 左栏 480（949）与 1280（969）浮层、点遮罩关闭；390 整屏；都不横向溢出；
    - 截图：首页、Work 页（展开 t15）、Task 页（速览 uxq），明暗、390 与 1440（`final/shot-*.png`，12 张），摆法 5 张（`final/peek-layout-*.png`），另有撞号、左栏分组、Work 展开的截图。
    - 回归（`regress/`）：阶段 3 的 3b、3c、3f、3g 全过；3e 的“checkout 页不横向滚动”“截断路径复制”过，“Task 表的长标题换行显示全文”这一条按本批改动作废（标题改成单行截断、悬停的 `title` 看全文，计划写的）；第 1 批的“之前几版的题”“两栏各自滚动”过，“提交栏写‘还有 5 道必答没答’”一条因克隆里第 1 批审查修正时真提交过，现在是“还有 3 道”，位置判据照样贴底（875 对 876），不是回归。
  - 偏离计划的地方：
    - 状态只显示一处的做法：不是去掉徽标，而是把 `StatusSwitch` 平时收成“改状态”按钮（下拉不再一直显示现在的状态）；
    - 文档树收进 `.agents/works` 根上的两份入口（服务端改动，计划里没写，是“怎么处理”能打开的前提）；
    - 速览并排时 Task 页改成一栏：1440 宽时正文只剩约 680px，放不下阅读宽度的卡片加 22rem 侧栏；侧栏接在 README 下面；
    - README 正文里的站内链接照旧整页跳转，只有侧栏的产物、文档、Spec、证据走速览；证据目录不能速览（没有可显示的东西）；
    - 面板标题获得焦点时显示焦点环（程序挪焦点，沿用阶段 2e 页标题的做法）。
  - 没有验证到的地方：
    - 按状态分组时收起的组（完成、搁置）没在浏览器里看到：克隆里没有这两种 Work；
    - 速览面板在真的读屏器里怎么读；浮层与整屏标了 `aria-modal` 但没有把焦点困在面板里（Tab 能走出去）；
    - 只看了 Chrome。
  - 验收环境：克隆没有新写入（本批不写记录）；4490 已 SIGTERM，浏览器已关，`/dev/shm/nbdev-t15-tmp` 已删；herdr 的 `w4:p1`、`w5:p1` 没动。master 到 `ea95b1759`，只多了文档提交，不用同步。
- 2026-10-14：第 2 批实现审查（`evidences/impl-review-phase4-batch2.txt`）的结论是 0 阻断、4 重要、6 建议；开发者把决定点 18 定为 A、另开 Task。十条全部采纳，在集成分支上改，未 push。
  - 提交（`984a289b8..c0be6bed2`，7 个）：
    - 重要 1（`4d06a249c`）：`/api/work` 的每个 Task 带 `openRequired`（与 `/api/overview` 同一个函数 `taskOpenRequired`），前端 `TaskView` 去掉 work 接口不给的 `artifactCount`、`leaseCount`；`panel-server` 场景 1 补一项（`t01-board` 的待答是 2）；`panel.md` 接口表同步。问题在第 1 批之前就有，这批把 0 淡化后更显眼；
    - 重要 2（`83ef26088`，验收中补了 `c0be6bed2`）：`StatusSwitch` 点“改状态”后焦点给下拉；取消、写入成功收起时焦点原本在这块里就放回“改状态”。验收发现按“确认”后按钮进入加载、被禁用，焦点先掉到 body，于是零件记下“是在这里确认的”，写完收起照样放回；写失败时焦点还给下拉；
    - 重要 3、4，建议 5、6（`4b1eb1b74`，验收中补了 `7720e4b2f`）：
      - 浮层与整屏时正文 `PageShell` 加 `inert`；只有整屏是 `aria-modal`，浮层按非模态对话框读；归还焦点的 `watch` 改成 `flush: "post"`；
      - 层级：整屏速览由 `z-50` 改成 `z-40`；外壳登录失效的阻挡层由 `z-50` 提到 `NB_Z_INDEX.dialog + 40`（取 `@notnotype/nb-ui/theme` 的层级常量），压在速览、nb-ui 抽屉与对话框（包括按键确认框、接管小窗这类 nb-ui 对话框）之上，仍低于右下角的通知；`PeekPanel.md` 写了层级与“整屏时顶栏没设 inert”的不支持；
      - 没有打开它的链接时，关闭后焦点退回页标题（验收发现页标题本来不可聚焦，先给 `tabindex="-1"`，与外壳 `focusHeading` 一样）；
      - `?peek=evidence/…` 只认本 Task 列出的证据文件，不是的写“这个 Task 没有这份证据”；Task 数据或产物来源还没到时显示加载，不显示错误句；
    - 建议 7（`54093e9a2`）：`.agents/works` 根上的 `README.md`、`AGENTS.md` 按文档树的规则编辑（`kind: repo_doc`），不再被“记录目录里只能编辑……”拒绝；同一层别的文件仍拒；`panel-writes-core` 编辑白名单用例补两项；
    - 建议 8、9、10（`9da538aba`）：Task 表去掉 `aria-rowcount`、展开行的格子加 `aria-colspan`、展开按钮名固定为“t15 的详情”；左栏带组名的组包 `role="group"`（`aria-label` 是组名，看得见的组名 `aria-hidden`），在动与待答改用 `sr-only` 文字、图标与徽标 `aria-hidden`；`docs/panel.md` 的“外壳”“偏好”与“查询参数不重建”、`prefs.ts` 文件头补上排列方式、左栏新行为与 `?peek=`。
  - 门禁（在 `c0be6bed2` 上）：包的 `typecheck`、`build:web` 通过；全量 `test` 401 过、0 失败、0 跳过；`git diff --check 984a289b8..HEAD` 干净；`dev-panel-records` 5 过；`docs:check` 通过。日志在 `accept/phase4/batch2/review-fixes/gate-*.log`。
  - 浏览器验收在 4490 上做，脚本 `accept/phase4/batch2/review-fixes/review.ts`，11 条全过（`results-all.txt` 与 `results-r2.txt`、`results-r4.txt`，r2、r4 改脚本后单独重跑过）：
    - 第 1 条：Work 页 t15 行的“待答”是 3，与接口、各产物之和相同（截图 `r1-work-open-required.png`）；
    - 第 2 条：键盘按“改状态”，焦点到下拉（`aria-label` 改状态）；Tab 到“取消”按 Enter，焦点回到“改状态”；在 t16-ux-b-probe 上真改一次状态（进行中改成计划中）、确认写入成功后焦点在“改状态”，再改回进行中（克隆里多了改状态的提交，见下）；
    - 第 3 条：1280 浮层时正文带 `inert`、面板没有 `aria-modal`，从面板标题 Shift+Tab 两次都进不了正文；关闭后 `inert` 去掉、焦点回到“侧栏宽度方案”链接；1920 并排时正文不 `inert`、面板不是模态；390 整屏时是 `aria-modal`、正文 `inert`；
    - 第 4 条：390 宽、整屏速览开着，清掉 cookie、站内换一个速览触发 401：登录失效对话框在最上面，“我已重新登录”按钮在点击位置的最上层，焦点在对话框里（截图 `r4-auth-over-full-peek-390.png`）。原想顺带验“整屏速览上开抽屉”，但整屏速览盖住顶栏，点不到“打开导航”，两者不会同时出现，这一项去掉了；
    - 第 5 条：直接打开带 `?peek=` 的网址后按 Esc，焦点落在页标题 `h1`；
    - 第 6 条：刷新进本 Task 的证据，直接出 iframe，期间每 10 毫秒查一次，没出现过错误句；拿别的 Task 的文件当证据打开，写“这个 Task 没有这份证据”、没有 iframe。
    - 回归：第 2 批脚本 `accept.ts` 在同一构建上重跑，28 条全过（`review-fixes/regress/`），控制台没有错误；脚本里展开按钮的名字随第 8 条改成“t15 的详情”、在动图标改按类名找。
    - 控制台只有第 4 条预期的 401。
  - 验收环境：第 2 条在克隆里给 t16-ux-b-probe 改了两轮状态（两次跑，共 4 个提交，最后仍是进行中）；4490 已 SIGTERM，浏览器已关，`/dev/shm/nbdev-t15-tmp` 已删；herdr 的 `w4:p1`、`w5:p1` 没动。master 到 `6965d8203`，`packages/`、`bun.lock`、`package.json` 没有变化，不用同步。
  - 没有验证到的地方：nb-ui 的对话框（按键确认、接管小窗）开着时登录失效，没在浏览器里造，层级从代码核对；读屏器的实际读法（分组、详情按钮、`aria-colspan`）；只看了 Chrome。
- 2026-10-14：阶段 4 第 2 批合入 `master`（合并提交 `567723d19`，集成分支 `c0be6bed2`），按开发者的长期授权直接合入。
  - 全量 `test` 在 `c0be6bed2` 上由主 Agent 复跑：401 过、0 失败；合并提交的代码与依赖清单和集成分支相同。
  - `bun install --frozen-lockfile` 没有变化；`service:restart` 后 4400 回 200，前端重新构建完成。审查 worktree 与临时 worktree 已删除。没有 push。
- 2026-10-14：阶段 4 第 3 批（会话页）第一步出设计稿，没有改代码：计划见“第 3 批”一节，线框稿是静态 HTML，截图在 `accept/phase4/batch3/design/`（桌面 1440 的观看、接管、只读 pane，手机 390 的列表与详情）。查了会话标题的来源：herdr 没有；Claude Code 的会话文件有 `ai-title`、`agent-name`（与 `/rename` 的 `custom-title`），Codex 的 `session_index.jsonl` 有 `thread_name`，omp 会话文件第一行有 `title`。决定点 19 到 23 等开发者定，确认后再实现。
- 2026-10-14：阶段 4 第 3 批（会话页）按确认过的设计稿实现，在集成分支上、未 push。
  - 提交（`22f6c4e25..6628fc7e6`，5 个）：
    - 服务端（`22f6c4e25`、`9a5c5adef`）：观看放开到本仓库里的任意 pane；接管在 pane 没有 Agent、没有会话键或页面没带会话键时回 `not_allowed`、不关连接；文字与按键对非 Agent 的 pane 回 409 `not_found`，都不调 herdr、不写审计（`panel-terminal` 测试钉住）；新接口 `GET /api/panes/:pane/history`（`pane.read` 的 `recent_unwrapped` 最近 1000 行，白名单加 `pane.read`；Agent 的 pane 与回滚为 0 的回 `history_unavailable`）；`/api/sessions` 的 pane 带 `scrollback`。实测 herdr 0.9.3 的 `pane.read` 不改滚动位置；
    - 会话标题（`01dd34201`，决定点 19）：`src/server/session-titles.ts` 从本机 Claude Code（会话文件末尾 256KB 的 `custom-title`、`agent-name`、`ai-title`）、Codex（`session_index.jsonl` 的 `thread_name`）、omp（会话文件第一行的 `title`）读，按大小与修改时间缓存，读不出为 null；
    - “在跑”页（`361e288e2`）：无主的运行里 pane 号链到 `/live/sessions?pane=`；
    - 会话页（`6628fc7e6`）：路由 `layout: "fill"`，左列表（零件 `SessionList` 重写，行由 `host/sessions-list.ts` 算）、右详情；`TerminalView` 加模式条、Ctrl+] 退出接管（零件截下、不发给 pane）、回滚 5000 行（量列数与观看字号减掉 14px 滑块）、`readOnly` 与 `actions` 插槽，去掉接管时临时套的框高；`SessionConsole` 改成屏幕加贴底输入区（两行输入框、Ctrl+Enter 或 ⌘+Enter 发送、要确认的键带“确认”标记、`result` 插槽）；非 Agent 的 pane 只读观看加“更早的输出”；自动选中（桌面上什么都没选时，有要处理的通知先显示通知，否则按等确认、工作中排第一的会话，replace）；宽度按内容区：1100 以上左栏 330px、900 以上 260px、再窄“切换会话”下拉，手机列表与详情两屏、详情不要页头；顶栏与首页的通知链到 `?view=notify`。验收中发现非 Agent 的 pane 也去读屏（400），`host/session-console.ts` 在会话键为空时不读，`web-session-console` 补了用例。零件 `.md` 与 `docs/panel.md`（接口表、开放给谁、释放原因、会话页一行、铺满的页、内联 style 的名单）同步。
  - 门禁（在 `6628fc7e6` 的工作区上，提交前）：包的 `typecheck`、`build:web` 通过；全量 `test` 410 过、0 失败；`git diff --check` 干净；`dev-panel-records` 过；`docs:check` 通过。日志在 `accept/phase4/batch3/gate-*.log`。
  - 浏览器验收在 4490 上做，脚本 `accept/phase4/batch3/accept.ts`，39 条全过（`final/results.txt`，截图 `final/b3-*.png` 17 张），控制台没有错误：
    - 自动选中：从左栏进会话页显示通知，历史只多一条；把 `/api/notify` 的回包在浏览器里换成空的，选中列表里排第一的会话；
    - 观看：铺满（页面不滚，输入区贴在终端下面、在视口里）、模式条、按键的“确认”标记；Ctrl+Enter 发送，“已投递”在输入区里，会话变工作中后写明原因、发送不可用；
    - 接管：模式条换成实底，输入框收起，打字进 A；按 Ctrl+] 释放回观看，A 的日志里没有 0x1d（假 Claude 收到它会退出），审计有接管与释放；
    - 非 Agent 的 pane：`w2:p1` 只读、没有接管与输入，“更早的输出”读到第 1 行，不写审计；`w3:p1`（分页器）不给按钮；
    - `?pane=` 指向不在的 pane 写“不在了”、不改选；不在 herdr 里的会话不是链接；
    - 1000 宽左栏 260px、行里不写“没有租约”；880 宽收起左栏、下拉换到 B；390 不自动选、点行进详情（文字视图、不给接管、输入区在一屏内）、“‹ 会话”回列表；首页通知行与“在跑”页的 pane 号链接；暗色截图两张。
    - 回归：阶段 1 的 s1、s2、s8 用 `regress-stage1.ts`（`accept/accept.ts` 的副本，模式条文字改成“你在接管键盘”、A 的屏幕标记改成“上一轮的回复”）重跑，16 条全过（`regress/results.txt`）；控制台里的 409 `session_changed` 是场景本身造的换会话。
  - 与线框稿的差别：通知一行右边只有箭头，没写“查看”；手机详情里的文字视图按内容高（沿用 `TerminalTextView` 的 60vh 上限），不铺满到输入区；详情头的会话键截断显示、点一下复制全文，没有单独的复制图标。
  - 没有验证到的地方：真实会话文件里的标题只在单测里验过（验收环境的假 Claude 没有会话文件，列表里是短号）；“不在本仓库的会话”折叠与“已结束”的行（验收环境里没有）；阶段 1 的其它场景（s3 到 s7、s9）与会话页无关，没重跑；只看了 Chrome。
  - 验收环境：克隆没有新写入；A（`w4:p1`）收到了一条验收文字与按键 q（状态成了“完成一轮”），回归脚本照阶段 1 的做法把 A 的会话 id 报成了 `aaaa0004…`；4490 已 SIGTERM，浏览器已关，`/dev/shm/nbdev-t15-tmp` 已删。master 到 `e3cef2a66`，`packages/`、`bun.lock`、`package.json` 没有变化，不用同步。`governance:check` 仍因 worktree 里遗留的 `packages/neuro-book-manager/` 跑不成，没动。
- 2026-10-14：第 3 批实现审查（`evidences/impl-review-phase4-batch3.txt`）的结论是 0 阻断、6 重要、5 建议。第 1 到 5 条与第 7 到 11 条照改，第 6 条实测后停在“待定”（见下），在集成分支上改，未 push。
  - 提交（`6628fc7e6..535b80193`，5 个）：
    - `b59241f04`（重要 4、5 的服务端，建议 11）：
      - 接管闸门通过后用 pane 当前的会话键与 Agent 刷新连接记下的值，审计的意图、结果与释放行都记这个会话；`panel-terminal` 补了“看着 shell 时里面起了 Claude 再接管”的用例；
      - `/api/panes/:pane/history` 按会话键分：没有会话键的（含认出了 Agent 但没报会话的）按 pane 读，有会话键的回 `history_unavailable`；pane 不在回 404 `pane_not_found`（新错误码，退出码 5），不再借会话接口的 `session_changed`；
      - `panel.md` 的“开放给谁”改成实际的错误码（`session_changed`，`details.reason` 是 `not_found`），并写明之前调过只读的 `agent.get`；`cli.md` 的 `history_unavailable` 说明更新；`terminal-hub.ts` 的 `open` 注释改正；非 Agent pane 发文字、按键的用例改成整份审计为空；
    - `db633f1c1`（建议 7 到 10）：
      - Claude 会话文件末尾 256KB 没有标题行时往前加读，最多读到 4MB；还没有就沿用上次读到的（文件变短不沿用）；
      - 找不到的会话文件记 60 秒；
      - omp 的绝对路径只认 omp 会话目录里的文件，三种 Agent 都只读普通文件（FIFO 不再会挂住请求）；
      - `cached` 只把文件系统错误当成读不出，日志按“路径加错误码”去重。
      - `session-titles` 补了三条用例；`panel-server` 场景 1 改成先写会话文件再请求（找不到的会话会被记 60 秒）。
    - `e04157a77`（重要 5 的前端）：左列表按会话键分组，认出了 Agent 但没报会话的进“其它 pane”，标题写“codex（没有报会话）”；不在本仓库的也只列出。
    - `196b470f6`（重要 1、2、3）：
      - 观看字号按框的宽、高两向取较小值（行高按挂载时量出的格高与字号之比），按比例估的放不下就再小一号；到 5px 仍放不下时框里滚动并贴底；
      - `TerminalView` 的根 `overflow-hidden`，终端框去掉 `min-h-64`，屏幕快照的 `<pre>` 去掉 `min-h-24`；
      - 手机详情改用 `PageShell` 的新属性 `bare` 收起页头，不再在 `PageShell` 与 `div` 之间换根。
    - `535b80193`（建议 11）：“在跑”页会话派出的运行也写 pane 号并链到会话页。
  - 重要 6 的实测：xterm 攒不下回滚，`pane.read` 也读不到 Claude 的更早输出。
    - 证据一：在审查环境里抓 `herdr terminal session observe` 的帧（往 `w2:p1` 的 cat 里送 30 行）。增量帧用 `\e[行;列H` 逐行改写整屏，不用换行滚屏，所以 xterm 不进回滚。
    - 证据二：在浏览器里往 70×60 的 shell pane 再打 120 行，`.xterm-viewport` 可滚的高度仍是 0（`review-fixes/final/results.txt` 第 3 条）。
    - 证据三：开发者 herdr 里真实的 Claude pane（只读 `pane list`）`max_offset_from_bottom` 全是 0；omp 是 444，shell 有几千。Claude 在备用屏上，`pane.read` 读不到更早的输出，只能读当前屏；omp 可以，原有的 `/api/sessions/:pane/history` 已经在读。
    - 按开发者说的条件，第 6 条到这里停下，等开发者再定 Claude 会话怎么往回翻；代码没动（回滚 5000 行和 14px 滑块的扣减都留着）。`docs/panel.md` 与 `TerminalView.md` 里“能往回翻”的说法已经改成实测结果，标了待定。
  - 门禁（在 `535b80193` 的工作区上）：包的 `typecheck`、`build:web` 通过；全量 `test` 415 过、0 失败；`git diff --check` 干净；`dev-panel-records` 过；`docs:check` 通过。日志在 `accept/phase4/batch3/review-fixes/gate-*.log`。
  - 浏览器验收在 4490 上做，脚本 `accept/phase4/batch3/review-fixes/review.ts`，15 条全过（`final/results.txt`，截图 `final/rf-*.png`），控制台没有错误：
    - 窄而高：审查环境里从 `w3:p1` 往右分出 `w3:p2`，经一次短暂的 control 改成 70×60，里面跑 `seq`。1440×900 与 1000×800 下 60 行都在框里，最后一行（提示符）看得见，终端不压说明行。
    - 矮视口 1440×650：
      - 观看时终端不压输入区；5px 仍放不下，框里贴底；
      - 接管量出 109×11，xterm 正好 11 行、不用滚；
      - 其它 pane 打开“更早的输出”时，说明行不压终端。
    - 跨 768px：1000 → 700 → 1000，草稿都在；接管中来回两次，仍在接管、终端有画面。
    - shell 起假 Claude 再接管：在 `w3:p2` 里起第三个假 Claude 并报会话后，同一页换成 Agent 详情，终端连接没重建；接管、释放三行审计的 `sessionKey` 都是这个会话。
    - 回归：第 3 批的 `accept.ts` 39 条全过（`review-fixes/rerun-batch3/`）；阶段 1 的 s1、s2、s8 共 16 条全过（`review-fixes/rerun-stage1/`），控制台里的 409 `session_changed` 是场景本身造的。
  - 验收环境：
    - `w3:p2` 用完已关，`fake3/` 已删，4490 已 SIGTERM，浏览器已关；
    - 往 `w2:p1` 的 cat 里送过 30 行 `probe-line-*`，A 收到验收文字与按键 q、z，回归脚本把 A 的会话 id 报成了 `aaaa0004…`；
    - master 到 `3e55f78bc`，`packages/`、`bun.lock`、`package.json` 没有变化，不用同步。
  - 没有验证到的地方：矮视口下 5px 仍放不下时贴底，假 Claude 的内容在屏幕上半，贴底后看到的是空行（真实 Claude 的输入框在下面，从代码推断没有这个问题）；只看了 Chrome。
- 2026-10-14：第 3 批审查第 6 条收尾。开发者定这一批不承诺 Claude 会话在面板里往回翻；改在集成分支上，提交 `8ac72388d`，未 push。
  - 改了什么：
    - `TerminalView` 不开回滚（`scrollback: 0`），量列数与观看字号都不再给 14px 滑块让宽度；
    - `/api/sessions` 的 pane 加 `history`（`session`、`pane` 或 null）。判断写在 `src/server/delivery.ts` 的 `historySource`，`readHistory` 也用它：
      - 有会话键的，只有 omp 并且 herdr 报的回滚不是 0 才算读得到（omp 回滚为 0 时 `/api/sessions/:pane/history` 改回 409）；
      - 没有会话键的，看回滚是否大于 0；
    - 会话页据此判断：
      - 读不到时在观看的模式条、手机文字视图里写“只能看当前屏；更早的输出去 herdr 里翻”；
      - omp 的“更早的输出”按钮改看 `history`，shell 的按钮照旧；
    - `panel-terminal` 补了一条 `history` 各种情形的用例；
    - `docs/panel.md`、`TerminalView.md` 的“待定”改成定稿；决定点 23 补了实测与改定；`followups.md` 那条备注补了“Claude 会话在面板里往回翻只能靠它”。
  - 门禁（在 `8ac72388d` 的工作区上）：包的 `typecheck`、`build:web` 通过；全量 `test` 416 过、0 失败；`git diff --check` 干净；`dev-panel-records` 过；`docs:check` 通过（`review-fixes/gate2-*.log`）。
  - 浏览器验收在 4490 上做，脚本 `review-fixes/scrollback.ts`，7 条全过（`review-fixes/scrollback/`），控制台没有错误：
    - 接管列数：1440 下 111 列（去掉扣减前是 109），1000 下 101 列，都等于框里放得下的列数；最后一列在框里，不横向滚动，xterm 没有回滚；
    - Claude 类会话：A 的回滚是 0，1440、1000 的模式条与 390 的文字视图都写“只能看当前屏；更早的输出去 herdr 里翻”，手机上没有“更早的输出”按钮；
    - omp：审查环境里另开 `w3:p3`，先跑 `seq 1 300`，再起名为 omp 的假会话并报会话，回滚 264 行。桌面模式条不写那句提示；手机照旧有“更早的输出”，读到回滚里的行；
    - shell 的“更早的输出”由第 3 批脚本的 `w2:p1` 一条验。
  - 回归：
    - 第 3 批 `accept.ts` 39 条全过（`review-fixes/rerun2-batch3/`）；
    - 审查修正 `review.ts` 15 条全过（`review-fixes/rerun2-review/`）。窄而高的 pane 重开成 `w3:p4`，脚本加了环境变量 `TALL_PANE`；
    - 阶段 1 的 s1、s2、s8 共 16 条全过（`review-fixes/rerun2-stage1/`），控制台只有场景本身造的 409 `session_changed`。
  - 验收环境：`w3:p3`、`w3:p4` 用完已关，`fake-omp/`、`fake3/` 已删，herdr 审查会话回到 `w2:p1`、`w3:p1`、`w4:p1`、`w5:p1` 四格；4490 已 SIGTERM，浏览器已关。master 到 `bc1d95e8c`，`packages/`、`bun.lock`、`package.json` 没有变化，不用同步。
- 2026-10-14：阶段 4 第 3 批合入 `master`（合并提交 `285226f31`，集成分支 `8ac72388d`），按开发者的长期授权直接合入。
  - 全量 `test` 在 `8ac72388d` 上由主 Agent 复跑：416 过、0 失败。
  - 合入时 `master` 已带进别的会话的代码改动（w00017 t86 资源管理器，含 nb-ui 的菜单投影、`Dropdown`、`ContextMenu` 与 `bun.lock`），合并提交与集成分支在 `packages/` 下差 64 个文件；`bun install` 装了 1 个包。合入后在主工作区补跑面板的 `typecheck` 与全量 `test`，结果见下一条。教训：合入前要按合并结果、不是按集成分支判断“`packages/` 有没有变化”。
  - `service:restart` 后 4400 回 200，前端重新构建完成。审查 worktree 与临时 worktree 已删除。没有 push。
- 2026-10-14：阶段 4 第 4 批（现场三页与文档页）按上面“第 4 批”一节实现，集成分支先 `merge --ff-only master` 到 `d2dd0652f`。没有要开发者定的决定点。未 push。
  - 提交（`d2dd0652f..f1daeeb81`，3 个）：
    - `b9999889e` 服务端：
      - `runGit` 加 `timeoutMs`，到点 SIGKILL，结果标 `timedOut`；
      - checkout 状态改成 `tracked` 与 `untracked`（`status -z -unormal --no-renames`），每个 checkout 的 git 调用限时 3 秒，超时的标 `timedOut`、计数为 null；行里加 `tasks`（`home` 加目录名认出的 Task）；
      - 新接口 `/api/checkouts/:key/files`（暂存、工作区、未跟踪三段，每段 300 条）与 `/api/docs/diff`（`readDocDiff`：类型取自同一份 `readDocTree`，合并基点到工作区；未跟踪的新文件与 `master_only` 由服务端拼成整份新增）；
      - 测试：`panel-live` 补未跟踪计数、文件清单、404 与各自限时；`panel-server` 新用例造出新增（已提交与未跟踪）、改动、删去、`master_only` 四种，逐个核对树上的标记与差异接口同类型、差异非空，没改的为 null，白名单之外 404；
      - `docs/panel.md` 接口表与“现场”同步。
    - `1da0683b3` checkout 页与“在跑”页：
      - 整行可点：nb-ui `Table` 的 `row-click`；第一格是真链接，行里的链接与按钮自己处理点击、不冒泡；
      - 落后、有未提交、有服务在跑都用 `nbdev-warn`，行首同色的点，读屏写原因；
      - “改 N · 新 M”按钮展开文件清单（`?files=`）；
      - 列宽收紧，“执行 worktree 于”并进“它的 Task 与 Work”一列，1440 下不再横向滚动；
      - “在跑”页的服务链到 `?focus=<key>`，那一行有框并滚进视野（`ProcList` 加 `navigate` 事件）。
      - 与计划的差别：计划写“在跑”页的服务写 checkout 的 key 与分支，登记里没有分支，只写 key、链到 checkout 行，分支在那一行看。
    - `f1daeeb81` 文档页：
      - 左栏抽成零件 `DocsSidebar`（带 `.md`），桌面在左栏、手机在 nb-ui `Drawer`；
      - “渲染 / 与 master 的差异”切换用 nb-ui `SegmentedControl`（`?view=diff`），“只看有差异的”进网址（`?changed=1`）；
      - `DocTree` 的删去与“master 才有”条目能点，直接进差异；
      - 顺带修正 `DocTree` 给这两种条目找分组的办法（原来 `docs/specs/ui/x.md` 会被 `docs/README.md` 拉进“入口”）；
      - `markdown.ts` 把外站图片换成虚线框的链接，套在链接里的换成文字，样式 `nbdev-external-image` 在 `app.css`。
  - 门禁（在 `f1daeeb81` 的工作区上）：包的 `typecheck`、`build:web` 通过；全量 `test` 418 过、0 失败；`git diff --check` 干净；`dev-panel-records` 过；`docs:check` 通过（`accept/phase4/batch4/gate-*.log`）。
  - 实测：未跟踪扫描在真实仓库的 6 个 checkout 上是 32 到 63 毫秒，冷的那个 0.5 秒（只读量的，见“已查”）。
  - 浏览器验收在 4490 上做，脚本 `accept/phase4/batch4/accept.ts`，23 条全过（`final/results.txt`，截图 `final/b4-*.png`），控制台没有错误与警告。
    - checkout 页：
      - 三种需要注意的状态颜色相同（都是 `rgb(154, 91, 0)`），行首两个点，主工作区没有；
      - 未提交写“改 2 · 新 3”，未跟踪的目录算一条；
      - 文件清单三段，`?files=` 刷新还在；
      - 点没有 Task 的行去文档，点有 Task 的行去 Task，第一格是同一个地址的真链接；Ctrl 加点开新标签页。
    - “在跑”页：服务链到 checkout 行，那一行有框。
    - 文档页：
      - `?changed=1` 刷新还在；
      - 改动、新增（未跟踪）、删去、master 才有四种的差异都与树上的标记一致，后两种“渲染”不能选；
      - `?view=diff` 刷新还在；主工作区没有切换；
      - 390 上树在抽屉里，选了文档就关上，没有横向溢出。
    - 外站图片：仓库根 README 的 7 个徽章都成了占位（链接里的 6 个是文字，单独的 1 个是链接），没有外站的 `img`，也没有链接套链接。
    - 截图：明暗各一套，1440 与 390 都有，覆盖 checkout 页（含文件清单）、“在跑”页、文档页的渲染与差异、390 的抽屉。
  - 验收环境（`/dev/shm/nbdev-ui-review/repo` 的克隆，不碰真实仓库的 worktree）：
    - master 上多了一个提交（`docs/specs/ui/b4-later.md`）；
    - 新开 worktree `b4-service`（分支 `b4/service`，两个提交，放了极小的开发服务 `packages/tiny-dev`）与 `w00022-t15-b4probe`（分支 `b4/probe`）；
    - worktree `w00022-dev-panel` 里留着验收用的未提交改动（改 `nested-grid.md`、删 `component-lab-timeline.md`、新 `b4-draft.md`、`scratch-b4.txt`、`notes-b4/`）。这些留给审查用。
    - 开发服务已经 `dev stop`（是验收脚本自己起的，用了 `--force`），4490 已 SIGTERM，浏览器已关，`/dev/shm/nbdev-t15-tmp` 已删。
    - master 到 `a7ae9c0a4`，`packages/`、`bun.lock`、`package.json` 没有变化，不用同步。
  - 没有验证到的地方：
    - 超时的“没算完”只在单测里用 1 毫秒的限时造过，浏览器里没造出慢的 checkout；
    - 文件清单 300 条的截断没造；
    - 仓库内图片（例如 README 里 `./vitepress/...jpg`）不是这一批的范围，照旧不显示（只给 `.agents/works/` 下的图片改写到产物来源）；
    - 只看了 Chrome。
- 2026-10-14：第 4 批实现审查（`evidences/impl-review-phase4-batch4.txt`）的结论是 0 阻断、4 重要、6 建议。按主 Agent 的处理意见：除第 5 条外都改，在集成分支上改，未 push。
  - 提交（`f1daeeb81..460ef97c3`，3 个）：
    - `ca27fa192`（第 1、7 条）：
      - `markdown.ts` 把记号属性 `data-nbdev-external` 列进 `FORBID_ATTR`，作者写的先被去掉，只认清洗钩子写的；
      - 替换只接受解析得出、协议是 http 或 https 的地址；清洗改用 `RETURN_DOM_FRAGMENT`，替换在 DOMPurify 返回的同一棵 DOM 上做，只序列化一次；
      - `img` 的 `srcset` 与 `<picture><source>` 的 `srcset` 里有外站候选时去掉；
      - 新单测 `tests/web-markdown.test.ts`（jsdom、真的 DOMPurify 与 marked）：外站图片换链接、套在链接里的换文字、作者写的记号属性加 `javascript:` 不生效、`srcset` 与 `picture`、`data:` 与 `.agents/works/` 图片照旧；
      - 为此 dev-panel 加了两个开发依赖：`jsdom`（与根上同一个 `^29.1.1`）和 `@types/jsdom`（`^30`，没有 29 的版本）。`bun.lock` 有变化，合入后要 `bun install`。
    - `442479c83`（第 2、3、4、6、8 条）：
      - checkout 页不用 nb-ui `Table` 的 `row-click`（拿不到事件），改在表格外层判断：点在 `a`、`button`、`[role=button]` 上，带修饰键或不是左键，或松手时有选中的文字，都不跳；
      - `?focus=` 每个 key 只滚一次，之后的重取不再拉回；
      - 文档页下拉切 checkout 改走 `go({checkout})`，保留 `prefer`、`path`（和 `view`），与“别的分支也改了它”一致；
      - `DiffView` 加 `fill`：不限高、按行折行，由页面滚；文档页的差异用它，`DiffView.md` 与 `docs/panel.md` 同步。
    - `460ef97c3`（第 9、10 条）：
      - `core/checkouts.ts` 导出 `checkoutNamedForTask`，Task 执行 checkout 的第 2 条规则与 checkout 页的 `tasksOf` 都用它；
      - 限时用例改成一慢一快两个 checkout 同时算：慢的用 PATH 里的 git 替身，`exec sleep`；断言慢的 `timedOut`、快的有数、整次不到 3 秒；
      - `runGit` 的 `timeoutMs` 注释写明 git 派生的子进程占着管道时限时不生效（fsmonitor、子模块），本仓库没有这两样，不按进程组结束。
  - 不改第 5 条（树上标“改动”、差异却是空的两种情形：分支改过又在工作区改回、未跟踪文件与 master 后来加的同名）：两种都少见，收益小。
  - 门禁（在 `460ef97c3` 上）：包的 `typecheck`、`build:web` 通过；全量 `test` 421 过、0 失败；`git diff --check` 干净；`dev-panel-records` 过；`docs:check` 通过（`accept/phase4/batch4/review-fixes/gate-*.log`）。
  - 浏览器验收在 4490 上做，脚本 `accept/phase4/batch4/review-fixes/review.ts`，14 条全过（`review-fixes/final/`），控制台没有错误与警告：
    - 第 1、7 条：克隆的 worktree `b4-service` 里放了一份未跟踪的 `docs/specs/ui/b4-images.md`。打开后没有 `javascript:` 链接、没有记号属性，外站 `srcset` 与 `<source>` 都去掉，`data:` 图片照旧，`picture` 里的 logo 与普通徽章换成链接；
    - 第 2、8 条：
      - 点分支、HEAD 复制不跳；
      - Ctrl 加点、Shift 加点行里的非链接处都不跳，也不开新标签页；
      - 拖选“领先 · 落后”那一格的文字松手不跳；
      - 普通点击照常去文档；
    - 第 3 条：390 宽、带 `?focus=` 与文件清单，把页面滚到底、表格横向滚开，等过一轮 10 秒重取，位置没变；
    - 第 4 条：从 `prefer=w00022-dev-panel` 的主工作区文档下拉切到 `w00022-dev-panel`，`prefer` 与 `path` 都在，正文是那个 checkout 上的版本；
    - 第 6 条：删去的长文档的差异在 1440 与 390 下都不限高、不在框里滚、按行折行（截图 `rf-diff-*.png`）。
    - 回归：第 4 批的 `accept.ts` 23 条全过（`review-fixes/rerun-batch4/`）。因为复制按钮现在点了不跳，脚本里点行的位置从 HEAD 格换成“相对 master”格。
  - 验收环境：克隆的 `b4-service` 多了一份未跟踪的 `b4-images.md`；开发服务验完已经 `dev stop --force`（是验收自己起的），4490 已 SIGTERM，浏览器已关，`/dev/shm/nbdev-t15-tmp` 已删。master 到 `5702de26a`，`packages/`、`bun.lock`、`package.json` 没有变化，不用同步；集成分支自己多了上面两个开发依赖。
- 2026-10-14：阶段 4 第 4 批合入 `master`（合并提交 `23609bdc2`，集成分支 `460ef97c3`），按开发者的长期授权直接合入。合入前主 Agent 在 `460ef97c3` 上复跑门禁：typecheck、build:web 通过，全量测试 421 过、0 失败，`git diff --check` 干净；合并结果与集成分支在 `packages/`、`scripts/`、`package.json`、`bun.lock` 下没有差异，不用另测。合入后 `bun install --frozen-lockfile`（装上 `jsdom`、`@types/jsdom`），`service:restart` 重启 4400，回 200。
- 2026-10-14：阶段 4 第 5 批（编辑页与搜索）按上面“第 5 批”一节实现，没有要开发者定的决定点。集成分支从 `7cd983c9e` 起（master 同一处），未 push。
  - 提交（`7cd983c9e..b8c72ab3e`，3 个）：
    - `5706085f4` 服务端：
      - `core/search.ts` 加 `recordRelevance` 与 `rankRecordMatches`，`views.ts` 的 `recordMatches` 先按相关度稳定排、再截 50 条；
      - 短号只认 Work 与 Task 的编号段（`w00022`、`t15`）。实现时发现产物编号 `panel-review` 会被当成短号 `panel`，所以收窄了；
      - 单测 `src/core/search.test.ts`；`docs/panel.md` 的搜索一节写明顺序。`nbdev find` 的顺序没动。
    - `4e4ba70ac` 搜索页：
      - 新纯函数 `host/highlight.ts`（`highlightParts` 用原文上的正则切段，`snippetAround` 让内容片段从命中前 30 个字开始），单测 `tests/web-highlight.test.ts`；
      - 新零件 `HighlightText`（带 `.md`）用 `<mark class="nbdev-mark">` 标出搜索词，样式在 `app.css`，不用 `v-html`；
      - `SearchResults` 加 `q`，记录、文件名命中的路径、内容那一行都高亮；每组 `.agents/tasks/` 的命中收在组尾，默认折叠。
    - `b8c72ab3e` 编辑页：
      - 面包屑：Work 或 Task 目录里的任何文件都回到那个 Work、Task；
      - Ctrl+S（Mac 上 ⌘+S）：按钮上写着；不能保存时也拦下浏览器的“另存网页”，在操作栏写原因；对话框开着时不处理；
      - 站内离开：守卫返回 Promise，等 nb-ui 的 `AlertDialog`。实现时踩到一个先后：点“离开”时 reka 先发关闭、再发 `confirm`，关闭立刻按“留下”结算会把导航取消，所以关闭推到下一轮再结算，让 `confirm` 先结算。
  - 计划里“要先实测才能定的问题”第 3 条的结论：
    - `onBeforeRouteLeave` 返回 Promise 能等面板自己的确认框；
    - 浏览器后退被拦下时，vue-router 把地址复原成编辑页，草稿还在；
    - 关标签页、刷新仍是原生的 `beforeunload`。
  - 门禁（在 `b8c72ab3e` 上）：包的 `typecheck`、`build:web` 通过；全量 `test` 425 过、0 失败；`git diff --check` 干净；`dev-panel-records` 过；`docs:check` 通过（`accept/phase4/batch5/gate-*.log`）。
  - 浏览器验收在 4490 上做，脚本 `accept/phase4/batch5/accept.ts`，13 条全过（`final/results.txt`，截图 `final/b5-*.png`：编辑页、确认框与搜索页，明暗两套，1440 与 390），控制台没有错误与警告：
    - 编辑页：
      - 按钮写着 Ctrl+S；
      - 没改动时 Ctrl+S 不提交、不弹“另存网页”，操作栏写原因；有改动时 Ctrl+S 在克隆的 master 上提交一次；
      - 站内跳走弹面板自己的确认框，没有原生对话框：“留下”与 Esc 都留下、草稿还在；“离开”跳走；
      - 浏览器后退同样弹框，“留下”后地址复原、草稿还在；
      - Task 目录里的 `plan.md` 面包屑回到 Task；
    - 搜索：
      - `/` 聚焦搜索框；
      - 搜“面板”，记录类命中的相关度分数不降，且不止一档（1、1、1、1、3……）；
      - 搜索词高亮几百处，都是搜索词本身；
      - `.agents/tasks` 的命中折叠时 0 条，展开后列出。
  - 验收环境：克隆 master 上多了几次编辑 `docs/specs/ui/workbench-shell.md` 的提交（脚本每跑一次 Ctrl+S 那条，就提交一次）。4490 已 SIGTERM，浏览器已关，`/dev/shm/nbdev-t15-tmp` 已删。master 仍在 `7cd983c9e`，`packages/`、`bun.lock`、`package.json` 没有变化，不用同步。
  - 没有验证到的地方：Mac 上的 ⌘+S（只在 Linux 的 Chrome 上按了 Ctrl+S）；只看了 Chrome。
- 2026-10-14：第 5 批两份实现审查的处理。前端（Sonnet，`evidences/impl-review-phase4-batch5-ui.txt`）重要 2、建议 8；服务端（omp，`impl-review-phase4-batch5-server.txt`）重要 1。都按主 Agent 的处理意见改了，在集成分支上，未 push。jsdom 依赖、`tests/web-markdown.test.ts`、dev-panel 的 `package.json` 与 `bun.lock` 由另一个子代理在别的分支上处理，这一轮没碰。
  - 提交（`b8c72ab3e..8de4f4d92`，2 个）：
    - `016c44674` 服务端，审查第 1 条：
      - 短号只在 `kind` 是 work 或 task 时提取，产物、会话只按完整编号比；
      - “先排再截 50 条”抽成纯函数 `topRecordMatches`，`recordMatches` 调它；
      - 单测补“`t15-review`、`w00022-report` 排不过标题以搜索词开头的 Work”与“51 个产物加 1 个 Work 时 Work 留在 50 条里”。
    - `8de4f4d92` 前端，审查第 1 到 10 条：
      - 离开确认框：
        - 另设 `leaveOpen`，`confirm`、`cancel` 各自结算，`@closed` 兜住 Esc，不再用 `setTimeout(0)`；
        - 留下时焦点回到打开框之前的元素，没有（或已不在页面上）就回到编辑框；
        - 页面注册 `router.beforeEach`：回到这一页同一个文件的导航（后退之后再前进）会取消框在等的那一次，这时按“留下”结算并关框；
        - 连按两次后退的错位写进 `docs/panel.md` 的已知限制；文档改成“Esc 算留下，点遮罩不会关”。
      - Ctrl+S：保存在途、按住重复、对话框开着时都不处理，不再写“正在保存”；提示放进常驻的 `role="status"` 容器。
      - `snippetAround`：用 `Intl.Segmenter` 按字素数前导字数，起点不会落在代理对或组合符号中间；`tests/web-highlight.test.ts` 补用例。
      - 第 7 条实测属实，而且原因不止前导字数：
        - 旧构建在 390 宽下搜“决定点”，199 行内容命中里 129 行看不见；只把前导改成 6 个字还有 117 行看不见；
        - 截图看出主因是内容那一行（`min-w-0 flex-1`）挤在长路径旁边，只剩几个字宽；
        - 改成内容行至少 16rem、放不下就换到路径下面独占一行，窄屏前导 6 个字、宽屏 30 个字，之后 0 行看不见（`review-fixes/final/probe-snippet-*.json`、`.png`）。
      - 搜索页记下 `searchedQ`（开始搜时才换），作为 `SearchResults` 的 `q` 与 `key`：换词时历史收起，去抖期间旧结果不按新词高亮。
      - `SearchResults.md` 的标签改成 `["state:local"]`；`up` 的注释与实现一致；`app.css` 里 `.nbdev-pre` 的注释搬回它前面。
  - 门禁（在 `8de4f4d92` 上）：
    - 包的 `typecheck`、`build:web` 通过；
    - 全量 `test` 428 条里 427 过、1 失败。失败的是 `web-build.test.ts`：全量负载下 vite 的构建慢，stderr 多了一段 `PLUGIN_TIMINGS` 提示，与这次改动无关；单独重跑 1 过（`review-fixes/gate-test-rerun-web-build.log`）；
    - `git diff --check` 干净；`dev-panel-records` 过；`docs:check` 通过。
  - 浏览器验收在 4490 上做，脚本 `accept/phase4/batch5/review-fixes/review.ts`，10 条全过加 2 条记录（`review-fixes/final/results.txt`），控制台没有错误与警告：
    - 留下与 Esc 之后，焦点回到打开框之前的左栏链接；后退触发、打开前焦点不在任何元素上时，回到编辑框；
    - 后退一次（框开着）再前进：框关上，还在编辑页，草稿还在；之后再点左栏，框照常弹，“离开”照常跳走；
    - 记录连按两次后退的实际行为：这次选“留下”还在编辑页；选“离开”时地址是 `/docs`、页面却是首页，就是已知限制里写的错位；
    - 连按三次 Ctrl+S：保存一次，结束后操作栏没有残留提示；
    - 搜索：展开历史之后换词，去抖期间旧结果仍按旧词高亮；新结果出来后历史收起，高亮是新词。
    - 回归：第 5 批的 `accept.ts` 13 条全过（`review-fixes/rerun-batch5/`）。
  - 验收环境：克隆 master 上又多了几次编辑 `workbench-shell.md` 的提交（Ctrl+S 用例）；4490 已 SIGTERM，浏览器已关，`/dev/shm/nbdev-t15-tmp` 已删。master 到 `a54340499`，`packages/`、`bun.lock`、`package.json` 没有变化，不用同步。
- 2026-10-14：合入第 5 批前处理两个不稳定的测试。集成分支此前已由主 Agent 合入 master（`256f5e99d`，含 jsdom 的修复）。未 push。
  - `tests/web-build.test.ts`（`80e3b50f7`）：
    - 原因：全量负载下 vite 构建变慢，rolldown 往 stderr 打 `[PLUGIN_TIMINGS] Your build spent significant time in plugins` 的性能建议，“stderr 为空”的断言就不成立；构建本身没有问题；
    - 查证：vite 8.1.4 的 `build.rolldownOptions` 是 rolldown 1.1.5 的 `InputOptions`（去掉 input、logLevel、output），其中 `checks?: ChecksOptions` 有 `pluginTimings?: boolean`（缺省 true，见 `rolldown/dist/shared/define-config-*.d.mts`）；
    - 改法：`vite.config.ts` 加 `build.rolldownOptions.checks.pluginTimings: false`，写明理由；断言没动；
    - 核对：
      - 改前同时跑 6 个构建，2 个打出这段提示；改后同时跑 8 个，0 个；
      - 新旧配置的构建产物 `diff -r` 完全相同；
      - `bun run build:web` 没有这段提示。
  - `tests/artifacts-cli.test.ts`（没有提交）：
    - 这个文件里没有用例之间共用的状态：每条用例新建自己的临时根与仓库；`closers` 与 `cleanupFixtures` 在 `afterEach` 里清；`process.env` 只在模块加载时改一次。
    - 场景 5 里没有固定时长的等待：命令行调用的限时是 60 秒，git 提交走 nbdev 自己的写事务。
    - 后面 6 条在 3 到 9 毫秒内失败：这么短只够跑到建临时根（在系统临时目录下 `mkdtemp`、写标记文件）或 `git init`。用 bun 1.4.2 试过，`afterEach` 抛错不会连带后面的用例失败，所以是同一个外部条件让它们各自在第一步就失败。
    - 最可能的原因是 `/tmp` 的用户配额，没有拿到当时的错误文字，算推断：
      - `/tmp` 是带 `usrquota` 的 tmpfs，这个用户的硬上限 6.12 GiB，现在已用 5.83 GiB，余量约 295 MB（`quotactl_fd` 读的；`df` 的空闲量不反映用户配额）。本机所有会话共用这份配额，大头是 `/tmp/claude-1000`（4.2G）、`/tmp/nbook-t20`（880M）、`/tmp/node-compile-cache`（596M）；
      - 测试的临时根缺省就在 `/tmp/neuro-book/agent`；
      - 全量测试一边跑一边每 0.2 秒采样配额，这套测试自己在 `/tmp` 的峰值只多用约 1 MB。所以多半是同一时刻别的会话把配额用到了顶，这套测试碰巧在那一刻建临时根；
      - 旁证：`/tmp/neuro-book/agent` 里留着一个 08:07 的 `dev-panel-cli-close-reopen-*`，里面的 `.git` 缺 `config`，就是 `git init` 写到一半失败的样子（不是 14:25 那一次留下的）。
    - 复现：在默认 `/tmp` 上连跑三次全量（第三次边跑边采样），都是 428 过、0 失败，没能复现。没有删任何目录，包括本会话的 scratchpad（177 MB，主 Agent 也在用）。
    - 建议：跑门禁时把 `TMPDIR` 指到配额余量大的地方（`/dev/shm` 同样 6.12 GiB 上限，现在只用了 0.74 GiB），或者由开发者清 `/tmp` 里不用的东西。
  - 门禁（在 `80e3b50f7` 上，默认 `/tmp`）：包的 `typecheck`、`build:web` 通过；全量 `test` 连跑三次都是 428 过、0 失败；`git diff --check 256f5e99d` 干净（日志在 `accept/phase4/batch5/flaky/`）。
- 2026-10-14：jsdom 的类型冲突修复合入 `master`（合并提交 `2da7a03a8`，分支 `fix/w00022-jsdom-types` 的 `1b3d31157`）。第 4 批审查第 1 条补单测时给面板加的 `@types/jsdom` 经 vitest 的 `import 'jsdom'` 把 DOM lib 带进 neuro-book 的类型检查，报 5 个错误；改成保留 jsdom 运行时、去掉 `@types/jsdom`、测试旁放最小声明 `tests/web-jsdom.d.ts`。没换 happy-dom：它的 `Node.prototype.nodeName` 是空串、NodeIterator 在当前节点被删后停下，跑不对 DOMPurify。`bun install` 不删锁文件里没有了的包，主工作区与集成分支 worktree 的 `node_modules/@types/jsdom`、`@types/tough-cookie` 手动删掉；别的会话自己装过依赖的 worktree 同样要删。
- 2026-10-14：阶段 4 第 5 批合入 `master`（合并提交 `66bb8a5fe`，集成分支 `80e3b50f7`），按开发者的长期授权直接合入。审查按开发者当天改的分工：前端交 Sonnet（`evidences/impl-review-phase4-batch5-ui.txt`，重要 2、建议 8），服务端交 omp（`evidences/impl-review-phase4-batch5-server.txt`，重要 1）。合入前在 `80e3b50f7` 上复跑门禁（临时目录指到 `/dev/shm`）：typecheck、build:web 通过、构建不再打插件耗时提示，全量测试 428 过、0 失败。合并结果带进了别的会话的 nb-ui 滚动条与 neuro-book workbench 改动（`packages/` 下 32 个文件），主 Agent 这次先快进了才发现，随后在合并后的 master 上补跑面板 typecheck、build:web 与全量测试（428 过、0 失败），再 `service:restart` 重启 4400，回 200。阶段 4 五批全部合入。
