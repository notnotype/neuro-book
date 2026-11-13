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
- 询问期间挡输入：页面挂载根加 HTML `inert`，再在 `window` 上用捕获阶段的键盘监听拦下快捷键；不自己写焦点陷阱。nb-ui 的对话框经 Teleport 挂在 `body` 下，不在挂载根里，不受 `inert` 影响。
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

- 新文件 `src/shared/desktop-bridge.ts`：事件名 `nbook-desktop`；壳到页面 `{type: "close-query", generation, reason: "window" | "quit"} | {type: "close-end", generation}`；页面到壳 `{type: "close-ack", generation} | {type: "close-answer", generation, answer: "allow" | "deny"}`；`parseShellMessage(detail)` 校验形状；`findDesktopBridge(global)` 在有 `__electrobunSendToHost` 时返回 `{send(message), listen(handler) → stop}`，普通浏览器返回 null。
- `desktop/src/bun/index.ts` 改用这个模块的类型与常量（只换类型与事件名，行为不变）。

### 浏览器宿主：接下询问

- `src/shared/host.ts` 加 `windowCloseKey: ServiceKey<WindowClose>`，`WindowClose = {participate(participant: CloseParticipant): () => void}`，`CloseParticipant = (request: {reason: CloseReason; signal: AbortSignal}) => Promise<"allow" | "deny">`。`window.ts` 的本地能力表加 `{id: "window.close", key: windowCloseKey, ...}`；没有桥时照常可登记、不会被调用。
- 新文件 `src/web/host/close-query.ts`，不依赖 Vue 与 DOM：`createCloseQuery({bridge, participants, state: () => WindowState, fetchWork, prompts, layer, report})`。
  - 收到 `close-query`：先结束上一次（同一窗口新询问到来时），立即 `send(close-ack)`，`layer.show()`，建这一次的 `AbortController`。
  - 依次：
    1. 窗口 `ready` 时按登记顺序调参与方，任一 `deny` 就停；抛错（不是因为 abort）写诊断 `browser-host.close.participant-failed`，再经 `prompts.ask({kind: "participant-failed", reason})` 问“仍然关闭 / 取消”。
    2. 窗口是失败页、带 `rescued` 时，`prompts.ask({kind: "rescued-lost", count})`。
    3. 原因是 `quit` 时，不论窗口状态都 `fetchWork()`：有项、有 `failed` 或取不到时 `prompts.ask({kind: "work", items, uncertain})`。
    4. 都过了就 `send(close-answer allow)`，否则 `deny`。
  - 每次 `await` 之后先核对这次是否已结束；结束（`close-end`、新询问）时 abort、`prompts.dismiss()`、`layer.hide()`，不再回答。以 `deny` 结束时撤层；以 `allow` 结束时层保留到窗口关掉。
  - `prompts` 的问法都带 `signal`，返回 `"close" | "cancel"`。
- `src/web/host/connection.ts` 的 `Connection` 加 `work(signal)`：`GET /api/runtime/work`，按 TypeBox 校验，失败抛错。
- 界面：新组件 `src/web/CloseLayer.vue` 与同名 `.md`，在 `mount.ts` 里作为独立的 Vue 根常驻挂载（带 `withText`），不随工作台与宿主页切换卸载。
  - 显示“正在关闭”的半透明层，`layer.show()` 时给其它挂载根设 `inert`，并在 `window` 上挂捕获阶段的 `keydown` 拦截：目标不在对话框里的按键 `preventDefault` 与 `stopPropagation`。
  - 宿主自己的三种询问用 nb-ui `Dialog`，缺省焦点在“取消”。
  - 工作项按窗口语言显示 `DisplayText`；`uncertain` 时多一行“无法确认是否有工作在跑”。
  - 文案进宿主的消息目录（`src/web/locales`）。
- `boot.ts` 只在 `findDesktopBridge` 返回非 null 时建询问控制器。

### 编辑器：参与方

- `src/plugins/editor/web/area.ts` 加 `closeWindow(signal): Promise<"allow" | "deny">`。
  1. 先结算全部视图输入（同 `needsLeaveConfirm` 的 `documents.settle`），再等在途保存。
  2. 按 `needsSettle`（dirty、未裁决输入、写不出）找文档，加上有冲突的；没有就 `allow`。
  3. 自动保存开着时，对 `savesOnClose` 为真的都保存一次并等完成，然后从第 1 步重来一次；还有剩下的才询问。
  4. 询问用新的 `windowDialog` 状态，与关标签的 `dialog` 分开：列出至多 5 个文件与“另有 N 个”，保存失败的写原因；有写不出的文档时不给“全部保存”。“全部保存”调 `saveAll()` 后从第 1 步重来，仍有失败就把对话框换成失败说明（失败的文件与原因，只有“知道了”），关掉后 `deny`。“不保存”直接 `allow`，不动文档；“取消”为 `deny`。
  5. `signal` abort 时收起对话框，不再发起新的保存，已发出的照常完成，返回值不再被采用。
- `src/plugins/editor/web/plugin.ts`：`windowCloseKey` 设为可选依赖，解析到时登记参与方，`context.signal` abort 时撤下。
- `EditorHost.vue` 渲染 `windowDialog`，复用关标签对话框的写法，文案键 `windowCloseDialog.*`。

### 工作台通知：`onClose`

- nb-ui `useNotification.ts` 的输入加 `onDismiss?: () => void`，只在用户点弹出那条的关闭按钮时调用，`NotificationStack.vue` 的 `@dismiss` 处调用；同名 `.md` 补一行。
- `src/plugins/workbench/shared/contracts.ts` 的 `NotificationInput` 加 `onClose?: () => void`。`notifications.ts` 在弹出关闭与中心的 `remove(id)` 两处调用，先到的那次之后不再调用；点动作、`dismiss()`、按时消失都不调用；抛错写诊断。

## Spec 与文档改动

- 实现后把 browser-host 输出 9 到 11、场景 15，server-host 的“在跑的工作”，editor 输出 66、场景 45、46，sessions 输出 20，background-tasks 输出 17，notifications 输出 18、场景 11 的 `(planned)` 去掉，并补实现合同与证据。
- server-host 实现合同写 `running-work.ts`、IPC 的两种信封、`ProjectManager.work`；browser-host 实现合同写 `close-query.ts`、`desktop-bridge.ts`、`CloseLayer.vue`。
- 待确认清单加：
  - “全部保存”失败后的失败说明是一个只有“知道了”的对话框，关掉后才回答 `deny`；
  - 询问期间用 `inert` 加键盘拦截挡输入。

## 切片

1. **服务端在跑的工作**：`running-work.ts`、能力与路由、项目一侧与 IPC、`ProjectManager.work`。提交。
   验证：`bun test src/server/running-work.test.ts src/server/server-projects.test.ts src/server/projects/manager.test.ts`。
2. **登记方**：`nbook.agent`、`nbook.tasks` 的登记与文案。提交。
   验证：两个插件的后端测试。
3. **桥与页面的询问**：`desktop-bridge.ts`、`windowCloseKey`、`close-query.ts`、`Connection.work`、`CloseLayer.vue`、`mount.ts` 与 `boot.ts` 的接线、壳的适配层改用共用类型。提交。
   验证：`bun test src/web/host/close-query.test.ts src/web/host/window.test.ts`、`CloseLayer.dom.test.ts`、`e2e/desktop-close.e2e.ts` 中宿主部分。
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
| browser-host 输出 9、10 | `close-query.test.ts`（真实 `createBrowserWindow` 与测试插件；桥与提问用测试实现，按 `desktop-bridge.ts` 的形状）：登记顺序、`deny` 停下、抛错的提问、`rescued`、`quit` 取工作与“无法确认”、`close-end` 与新询问的收口、结束后不回答 |
| browser-host 输出 10 的层与对话框 | `CloseLayer.dom.test.ts`：层显示时挂载根 `inert`、快捷键被拦、对话框可操作 |
| browser-host 场景 15 | `e2e/desktop-close.e2e.ts`（真实浏览器与服务端，`addInitScript` 装一个记录消息的 `__electrobunSendToHost` 当作壳，派发 `nbook-desktop` 事件） |
| editor 输出 66、场景 45、46 | `e2e/desktop-close.e2e.ts` 的编辑器部分；`area` 的单元测试覆盖自动保存后重查与失败说明 |
| notifications 输出 18、场景 11 | `notifications.dom.test.ts`（弹出的关闭、动作、按时消失）与 `WorkbenchNotificationsView.dom.test.ts`（中心的“移除”、只进中心的那条） |
| desktop-shell 场景 5、6、7 | pc-notype 上的安装包手工验收，记进证据（UI 自动化读文字，不截屏） |

## 验证

- 每片跑上面列的测试；收口跑 `bun run test:affected`。
- e2e 合入前跑一次：`e2e/desktop-close.e2e.ts`（新增）、`e2e/editor-autosave.e2e.ts`、`e2e/browser-host.e2e.ts`，共 3 个。实施中只重跑改到的那个文件。
- Windows：pc-notype 恢复后重建安装包，按 desktop-shell 场景 5、6、7 操作。
- 未验证边界：macOS、Linux；WebView2 自己开的弹出窗口（t08 的已知限制）。

## 不做与风险

- 不做更新提示（t10）；不做壳一侧的改动（t08 已有），只换共用类型。
- 风险：`inert` 加捕获键盘拦截可能漏掉编辑内核自己在 `document` 上挂的监听。由 `CloseLayer.dom.test.ts` 与 e2e“询问期间在正文里打字不生效”兜底，e2e 用真实的 Monaco。
- 风险：项目子进程里现在可能没有插件登记工作，项目一侧只由测试插件验证；以后真有插件登记时要补它自己的测试。
