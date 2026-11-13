# t09 计划：关闭前询问（页面与壳）

## Context

t08 的壳已经会拦下关窗、按代次问页面、3 秒没接下就弹“没有响应”，但页面一侧还不回答，所以在 Windows 上每次关窗都要走“强制关闭”。本 Task 做页面一侧：浏览器宿主接下询问、盖“正在关闭”层、按顺序问参与方、关最后一个窗口时取服务端“在跑的工作”提示，编辑器作为第一个参与方结算保存；另加工作台通知的 `onClose`（t10 的更新提示要用它分清“以后”）。

依据（都已在 t06 写进 Spec，标 planned）：

- [`runtime/browser-host`](../../../../../docs/specs/runtime/browser-host.md) 输出 9 到 11、状态表“桌面壳的关闭前询问”、场景 15；
- [`runtime/server-host`](../../../../../docs/specs/runtime/server-host.md) 的“在跑的工作”；
- [`workbench/editor`](../../../../../docs/specs/workbench/editor.md) 输出 66、场景 45、46；
- [`agent/sessions`](../../../../../docs/specs/agent/sessions.md) 输出 20、[`workbench/background-tasks`](../../../../../docs/specs/workbench/background-tasks.md) 输出 17；
- [`workbench/notifications`](../../../../../docs/specs/workbench/notifications.md) 输出 18、场景 11；
- [`runtime/desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 输出 13 到 16、场景 5、6、7（t08 留下的联合验收）。

提案 [desktop-distribution](../../../../../docs/proposals/desktop-distribution.md) 4.3、ADR 0051 已接受。t06 的待确认条目（编辑器询问的按钮、在跑的工作由服务端汇总、询问期间盖层）照 Spec 做。

工作方式：autonomous-delivery；代码在 Work 分支 `feat/w00046-desktop-release`。

## 技术选型

- 页面与壳的桥：沿用 t08 的 Electrobun 事件桥（壳 `executeJavascript` 派发 `nbook-desktop` 事件，页面经 `window.__electrobunSendToHost` 回消息），不另引库。消息形状抽成共用模块，壳与页面都用它，免得两边各写一份。
- 询问期间挡输入（设计审查第 1、2 条）：“正在关闭”层本身是一个 nb-ui 模态 `Dialog`（只有状态文字，`closeOnEsc`、`closeOnOverlay` 为假），由 reka 的焦点锁与 `body` 指针锁挡指针与焦点，层级用 `useModalLayer` 的打开顺序，参与方之后开的对话框自然叠在它上面，不新登记 z-index；层打开前把 `body` 下已有的子节点（工作台、已开着的菜单与命令面板，它们的 z-index 高于模态）设 `inert`，撤层时只撤自己设的。键盘另用一个在 `window` 捕获阶段、启动时最早注册的拦截器（早于工作台键位 `WorkbenchCommandHost.vue:57`），见“浏览器宿主”。否决只靠挂载根 `inert`：传送到 `body` 的浮层管不到，工作台键位在同一目标同一阶段先注册。
- 对话框：nb-ui `Dialog`，与编辑器关标签的询问（`EditorHost.vue`）同一种用法。
- 项目子进程取工作：在现有的 IPC 信封上加一对请求与应答，不经插件的远程合同；理由是这是宿主自己的事，不该依赖某个插件提供远程服务。

## 关键设计

### 服务端：在跑的工作

- `src/shared/host.ts` 加 `runningWorkKey: ServiceKey<RunningWork>`，`RunningWork = {register(reporter: () => ReadonlyArray<{text: DisplayText}>): () => void}`。服务端与项目两个位置都提供。
- 新文件 `src/server/running-work.ts`：`createRunningWork(report)` 返回 `{provision, collect()}`。`provision` 用 nb-runtime 的 `perConsumer`（同 `projects/manager.ts:364` 的写法），按消费者身份记下插件 id，消费者释放时撤下它的全部登记。`collect()` 同步调用每个登记方，返回 `{items: [{plugin, text}], failed: [plugin]}`；抛错的进 `failed` 并写诊断 `runtime.work.reporter-failed`。
- `src/server/start.ts`：`capabilities` 加 `{id: "host.running-work", key: runningWorkKey, create: () => work.provision}`；`hostRoutes` 加 `GET /work`（完整路径 `/api/runtime/work`）。处理：先 `collect()` 服务端的，再向项目管理器要项目的，合成 `{items: [{plugin, project, text}], failed: [{plugin, project}]}`。`DisplayText` 原样编码（字符串或文字引用），页面按窗口语言显示。准入与 503 由 nb-host 的宿主路由已有的门负责，不另写。
- 项目一侧：`src/project/start.ts` 的 `capabilities` 加同一个键，用同一个 `createRunningWork`。IPC 信封（`src/server/projects/ipc.ts`）加 `{t: "work-query", id}`（服务端到子进程）与 `{t: "work", id, items, failed}`（子进程到服务端）；`parseEnvelope` 校验形状。
- `src/server/projects/manager.ts`：`ProjectManager.work(): Promise<{items, failed}>`。只问 `running`（状态 `available`）的子进程，`idle-grace`、`stopping` 与启动中的不问、不唤醒；每个子进程 5 秒没应答就把这个项目记进 `failed`（`plugin` 为 null）并写诊断；应答按 `id` 配对，子进程在等待中退出也落到 `failed`。计时用管理器已注入的时钟。
- 登记方：
  - `nbook.agent`（`src/plugins/agent/backend/plugin.ts`）：根会话中在跑或在等用户的（含 `background: true` 的后台会话）各报一项“Agent 会话「<标题>」正在运行”或“…在等你处理”；`JobCenter.live()` 的每件报一项，写命令或子代理名。现成的 `sessions.activity()` 不含后台会话，实施时在句柄表上补一个含后台会话的查询（`nb-harness` 的 `kit/sessions/table.ts`），不改 `activity()` 的现有语义。
  - `nbook.tasks`（`src/plugins/tasks/backend/plugin.ts`）：`running` 表里每件报一项，写标题。
  - 文案进各插件的消息目录（`zh-CN` 与 `en-US`）。

### 页面与壳之间的桥

- 新文件 `src/shared/desktop-bridge.ts`：`CloseReason = "window" | "quit"`（`src/desktop/windows.ts` 与 `shared/host.ts` 都改为引用它，第 13 条）；事件名 `nbook-desktop`；壳到页面 `{type: "close-query", generation, reason} | {type: "close-end", generation}`；页面到壳 `{type: "close-ack", generation} | {type: "close-answer", generation, answer: "allow" | "deny"}`；两个方向各一个校验 `parseShellMessage`、`parsePageMessage`，两端的测试共用同一份夹具。
- `createDesktopBridge(global)`：总是监听 `nbook-desktop` 事件（普通浏览器里不会有），发送时才取 `__electrobunSendToHost`，取不到写诊断 `browser-host.close.no-bridge`（第 7 条：预加载脚本也是调用时才取，不能在启动时判定一次）。
- `desktop/src/bun/index.ts` 改用这个模块的类型、常量与 `parsePageMessage`（行为不变）。`src/shared` 的架构检查（`architecture.test.ts`）不允许时，按检查结果换位置。

### 浏览器宿主：接下询问

- `src/shared/host.ts` 加 `windowCloseKey: ServiceKey<WindowClose>`，`WindowClose = {participate(participant: CloseParticipant): () => void}`，`CloseParticipant = (request: {reason: CloseReason; signal: AbortSignal}) => Promise<"allow" | "deny">`。
- 参与方表放在 `createBrowserWindow` 的闭包里，跨 `boot()` 重试稳定（第 3 条）；能力表加 `{id: "window.close", key: windowCloseKey, ...}` 引用它；`BrowserWindow` 加只读的 `closeParticipants()`。入口停止时它的登记随 `release` 撤下。
- 新文件 `src/web/host/close-query.ts`，不依赖 Vue 与 DOM：`createCloseQuery({bridge, window: BrowserWindow, fetchWork, prompts, layer, report, clock})`。在 `boot.ts` 里建窗口之后、`await start()` 之前建立，启动中（加载页）来的询问也立即 ack（第 3 条）。
  - 收到 `close-query`：同一窗口有上一次时先按结束处理；立即 `send(close-ack)`；`layer.show()`；建这一次的 `AbortController`。迟到的 `close-end`（代次不符）忽略。
  - 依次：
    1. 窗口 `ready` 时按登记顺序调参与方，前一个完成才调下一个，任一 `deny` 就停。抛错（不是因为 abort）时写诊断 `browser-host.close.participant-failed`，经 `prompts.ask({kind: "participant-failed", reason})` 问“仍然关闭 / 取消”；选“仍然关闭”就接着调下一个参与方（第 11 条）。
    2. 窗口是失败页、带 `rescued` 时，`prompts.ask({kind: "rescued-lost", paths})`，列出文件路径（第 11 条）。
    3. 原因是 `quit` 时，不论窗口状态都 `fetchWork()`，8 秒取不到按“取不到”处理（服务端取项目工作自己的上限是 5 秒，页面要比它长才收得到服务端汇总的 `failed`，第 11 条）。有项、有 `failed` 或取不到时 `prompts.ask({kind: "work", items, uncertain})`。
    4. 都过了就 `send(close-answer allow)`，否则 `deny`。
  - 询问中途窗口离开 `ready`（服务端重启、项目已关闭，第 4 条）：控制器经 `onChange` 得知，abort 正在调用的参与方，改从第 2 步接着走，不整次取消。
  - 每次 `await` 之后先核对这次是否已结束。结束（`close-end`、新询问）时 abort、`prompts.dismiss()`、撤层、恢复焦点，不再回答。
  - 以 `deny` 结束时撤层并恢复焦点：`layer.show()` 时记下 `document.activeElement`，撤层时 `focus({preventScroll: true})`，元素已不在就交给工作台的缺省焦点（第 8 条）。
  - 以 `allow` 结束时层保留，等窗口关掉。壳会在 `window` 的 `allow` 之后以 `quit` 再问一次（desktop-shell 输出 16）：这时层还在、其间没有输入，控制器不再调参与方，直接从第 2 步接着走（第 10 条；Spec 补一句）。`allow` 之后 10 秒窗口仍没关掉、也没有新询问：撤层、写诊断 `browser-host.close.not-closed`，页面恢复可用（第 10 条，兜底壳没关成窗口的情形）。
  - `prompts` 的问法都带 `signal`，返回 `"close" | "cancel"`。
- 键盘拦截器：在 `createCloseQuery` 里注册到 `window` 的 `keydown` 捕获阶段，早于工作台键位。询问进行中，目标在打开的对话框（`[role="dialog"]`、`[role="alertdialog"]`）里、且键是 Tab、Enter、空格、Escape、方向键之一时放行；其余一律 `preventDefault` 与 `stopImmediatePropagation`（第 1 条：对话框里按 Ctrl+S、Ctrl+W、Ctrl+P 也要拦）。
- `src/web/host/connection.ts` 的 `Connection` 加 `work(signal)`：`GET /api/runtime/work`，按 TypeBox 校验，失败抛错。
- 界面：新组件 `src/web/CloseLayer.vue` 与同名 `.md`。在 `boot.ts` 里与控制器一起、早于 `mountWindowUi` 挂成独立的 Vue 根（带 `withText`），挂到 `body` 下，常驻，不随工作台、宿主页切换卸载；加载页阶段也能显示（第 3 条）。
  - 层是模态 `Dialog`，文字“正在关闭…”。打开前给 `body` 下已有子节点（除自己的根）设 `inert`。
  - 宿主自己的三种询问也用 nb-ui `Dialog`，在层之后打开，缺省焦点在“取消”。
  - 工作项按窗口语言显示 `DisplayText`；`uncertain` 时多一行“无法确认是否有工作在跑”。
  - 文案进宿主的消息目录（`src/web/locales`）。

### 编辑器：参与方

- `src/plugins/editor/web/area.ts` 加 `closeWindow(signal): Promise<"allow" | "deny">`。
  1. 先收掉关标签的旧询问：`answerDialog?.("cancel")`，进行中的 `closeOne` 与批量关闭随之返回取消，不会在窗口询问期间执行“不保存”的还原（第 5 条）。
  2. 结算全部视图输入（`documents.settle`）；对 `saving` 为真的文档调 `documents.save` 排队，等它们完成（第 5 条：`area` 没有别的等保存的接口）。
  3. 文档集合取 `openDocuments` 中 `needsSaving` 为真的（与状态栏未保存条目、输出 26 同一判据），加上有冲突的（第 9 条）；没有就 `allow`。
  4. 自动保存开着时，对 `savesOnClose` 为真的都保存一次并等完成，再从第 2 步重来一次；还有剩下的才询问。
  5. 询问用新的 `windowDialog` 状态：列出至多 5 个文件与“另有 N 个”，保存失败的写原因。文件名、“另有 N 个”与失败原因复用状态栏未保存条目的文字（`status-items.ts` 的 `status.*` 键与 `saveProblem.detail`，第 9 条）。有写不出或有冲突的文档时不给“全部保存”（冲突的保存必定失败，覆盖要用户自己去那份文档上做；第 9 条，Spec 补一句）。
  6. “全部保存”调 `saveAll()` 后从第 2 步重来；仍有失败就把对话框换成失败说明（失败的文件与原因，只有“知道了”），关掉后 `deny`。“不保存”直接 `allow`，不动文档；“取消”为 `deny`。
  7. `signal` abort 或 `dispose()` 时收起对话框，未定的询问按 `deny` 结算（结果不再被采用），不再发起新的保存，已发出的照常完成（第 4 条）。
- `src/plugins/editor/web/plugin.ts`：`windowCloseKey` 设为可选依赖，解析到时登记参与方，`context.signal` abort 时撤下。参与方回答 `allow` 时置“关闭已同意”，`beforeunload` 看到它就不请求离开确认；`deny` 与 abort 时复位（第 12 条：防 WebView 在原生关窗时仍触发卸载确认）。
- `EditorHost.vue` 渲染 `windowDialog`，复用关标签对话框的写法，文案键 `windowCloseDialog.*`。

### 工作台通知：`onClose`

- nb-ui `useNotification.ts` 的输入加 `onDismiss?: () => void`，只在用户点弹出那条的关闭按钮时调用：`NotificationStack.vue` 的 `@dismiss` 改为 `try { onDismiss() } finally { remove() }`，抛错不挡移除（第 6 条）。补丁类型 `NotificationPatch` 去掉 `onDismiss`，更新不能换掉它。同名 `.md` 补一行。
- `src/plugins/workbench/shared/contracts.ts` 的 `NotificationInput` 加 `onClose?: () => void`，`NotificationHandle.update` 的补丁类型去掉它。`notifications.ts` 为每条通知存一个“已回告”标记（按通知 id，独立于会被清理的 `queued` 映射）。调用 `onClose` 的有三处：弹出的关闭、中心的“移除”、中心的“全部清除”。“按时消失”之后在中心点“移除”也算用户关闭；超过 `CENTER_LIMIT` 被挤出的不算。点动作、`dismiss()`、按时消失本身都不调用。抛错写诊断（第 6 条；Spec 输出 18 补这三句）。

## Spec 与文档改动

- 实现后把 browser-host 输出 9 到 11、场景 15，server-host 的“在跑的工作”，editor 输出 66、场景 45、46，sessions 输出 20，background-tasks 输出 17，notifications 输出 18、场景 11 的 `(planned)` 去掉，并补实现合同与证据。
- server-host 实现合同写 `running-work.ts`、IPC 的两种信封、`ProjectManager.work`；browser-host 实现合同写 `close-query.ts`、`desktop-bridge.ts`、`CloseLayer.vue`。
- Spec 补充（实施第一片之前写进主工作区的 Spec）：
  - browser-host 输出 10：`allow` 之后层一直没撤又来了新询问（壳以 `quit` 重问）时不再调用参与方；参与方抛错选“仍然关闭”后接着问下一个；`allow` 之后 10 秒窗口没关掉就撤层；
  - editor 输出 66：有冲突的文档与写不出的一样不给“全部保存”；
  - notifications 输出 18：中心的“全部清除”算用户关闭，按时消失之后的“移除”算用户关闭，挤出不算。
- 待确认清单加：
  - “全部保存”失败后的失败说明是一个只有“知道了”的对话框，关掉后才回答 `deny`；
  - 上面三条 Spec 补充；
  - 询问期间的挡输入做法：层是模态对话框，`body` 下已有节点设 `inert`，键盘拦截器最早注册。

## 切片

1. **服务端在跑的工作**：`running-work.ts`、能力与路由、项目一侧与 IPC、`ProjectManager.work`。提交。
   验证：`bun test src/server/running-work.test.ts src/server/server-projects.test.ts src/server/projects/manager.test.ts`。
2. **登记方**：`nbook.agent`、`nbook.tasks` 的登记与文案。提交。
   验证：两个插件的后端测试。
3. **桥与页面的询问**：`desktop-bridge.ts`、`windowCloseKey`、`close-query.ts`、`Connection.work`、`CloseLayer.vue`、`mount.ts` 与 `boot.ts` 的接线、壳的适配层改用共用类型。提交。
   验证：`bun test src/shared/desktop-bridge.test.ts src/web/host/close-query.test.ts src/web/host/window.test.ts src/desktop`、`e2e/desktop-close.e2e.ts` 中宿主部分。
4. **编辑器参与方**：`area.ts`、`plugin.ts`、`EditorHost.vue`。提交。
   验证：编辑区的单元测试与 `e2e/desktop-close.e2e.ts` 中编辑器部分。
5. **通知 `onClose`**：nb-ui 与工作台。提交。
   验证：nb-ui 通知测试、`notifications.dom.test.ts`、`WorkbenchNotificationsView.dom.test.ts`。
6. **Spec 与证据；Windows 联合验收**：用新载荷在 pc-notype 上重建安装包，跑 desktop-shell 场景 5、6、7 与 t08 剩下的项。提交。

## 验收映射

| Spec 编号 | 覆盖 |
|---|---|
| server-host 在跑的工作 | `running-work.test.ts`（同进程，真实认领的服务端加测试插件：登记、撤下、抛错进 `failed`、503）；`server-projects.test.ts`（真实项目子进程：项目登记的工作、5 秒取不到、宽限期中不唤醒） |
| sessions 输出 20 | `agent` 后端测试：运行中、在等用户、后台会话、空闲会话的后台命令 |
| background-tasks 输出 17 | `tasks` 后端测试 |
| browser-host 输出 9、10 | `close-query.test.ts`（真实 `createBrowserWindow` 与测试插件；桥与提问用测试实现，按 `desktop-bridge.ts` 的形状与共用夹具）：登记顺序、`deny` 停下、抛错后“仍然关闭”接着问下一个、`rescued` 列路径、`quit` 取工作、取不到与 8 秒超时的“无法确认”、`close-end` 与新询问的收口、迟到的 `close-end` 忽略、结束后不回答、`start()` 未完成时来询问立即 ack、询问中途服务端重启改走失败页一支、`allow` 后以 `quit` 重问不再调参与方、`allow` 后 10 秒没关撤层、参与方永不 settle 时 `close-end` 能收口 |
| browser-host 输出 10 的层、对话框与挡输入 | `e2e/desktop-close.e2e.ts`（真实浏览器；happy-dom 的 `inert` 没有阻断行为，不用 dom 测试判它）：询问前先开命令面板，询问中它不可点；焦点在参与方对话框里按 Ctrl+P、Ctrl+W、Ctrl+S 不触发命令；点被层盖住的编辑区没有反应；Escape 能关参与方的对话框；`deny` 后焦点回到正文、能直接打字 |
| 共用桥的形状 | `src/shared/desktop-bridge.test.ts`；壳一侧 `bun test src/desktop` 照常过 |
| browser-host 场景 15 | `e2e/desktop-close.e2e.ts`（真实浏览器与服务端，`addInitScript` 装一个记录消息的 `__electrobunSendToHost` 当作壳，派发 `nbook-desktop` 事件） |
| editor 输出 66、场景 45、46 | `e2e/desktop-close.e2e.ts` 的编辑器部分；`area` 的单元测试：自动保存后重查、失败说明、冲突与写不出时没有“全部保存”、关标签对话框开着时来窗口询问（旧框收掉、文档不被还原）、`dispose` 时未定的询问按 `deny` 结算 |
| notifications 输出 18、场景 11 | `notifications.dom.test.ts`（弹出的关闭、动作、按时消失、`onClose` 抛错仍移除）与 `WorkbenchNotificationsView.dom.test.ts`（中心的“移除”、“全部清除”、按时消失后再移除、只进中心的那条） |
| desktop-shell 场景 5、6、7 | pc-notype 上的安装包手工验收，记进证据（UI 自动化读文字，不截屏） |

## 验证

- 每片跑上面列的测试；收口跑 `bun run test:affected`。
- e2e 合入前跑一次：`e2e/desktop-close.e2e.ts`（新增）、`e2e/editor-autosave.e2e.ts`、`e2e/browser-host.e2e.ts`，共 3 个。实施中只重跑改到的那个文件。
- Windows：pc-notype 恢复后重建安装包，按 desktop-shell 场景 5、6、7 操作；另记两项探针：页面脚本运行时 `typeof window.__electrobunSendToHost`，`allow` 之后窗口关掉时有没有触发 `beforeunload`（第 7、12 条）。
- 未验证边界：macOS、Linux；WebView2 自己开的弹出窗口（t08 的已知限制）。

## 不做与风险

- 不做更新提示（t10）；不做壳一侧的改动（t08 已有），只换共用类型。
- 风险：编辑内核在自己元素上挂的监听。层是模态、焦点被锁在对话框里，正文拿不到焦点；由 e2e 的“点被层盖住的编辑区没有反应”“对话框里按快捷键不触发”兜底，e2e 用真实的 Monaco 与 Markdown 编辑器。不以“在正文里打字不生效”判，那条在焦点被移走后必然通过（第 7 条）。
- 风险：`inert` 触发的焦点移走可能让控件发出 `leave`，自动保存的“失焦时”模式在询问开始时存一次。这与关窗要做的保存方向一致，不拦。
- 风险：项目子进程里现在可能没有插件登记工作，项目一侧只由测试插件验证；以后真有插件登记时要补它自己的测试。
