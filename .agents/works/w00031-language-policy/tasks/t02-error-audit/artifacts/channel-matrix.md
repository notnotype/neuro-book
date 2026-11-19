# w00031 t02 通道矩阵（后端与前端分区报告合并稿）

## 0. 头部

- 源码基线：`65d9daea06616b8fc8459bc7ef9cb2132cee25ed`（detached worktree `/home/<user>/CodeRepository/neuro-book/.worktree/audit-w00031-t02`），两份报告同一基线。
- 出处：后端分区报告 `/tmp/w00031-review/t02-audit/report-backend.md`（omp，下称“后端报告”，通道 ID 前缀 `B-`，错误域 ID 无前缀）；前端分区报告 `/tmp/w00031-review/t02-audit/report-frontend.md`（Sonnet，下称“前端报告”，通道 ID 前缀 `FC-`，错误域 ID 前缀 `fe.` 或 `x.`）。
- 另有“主会话补查”两处（两份报告都没盘），在第 3 节末尾以 `MC-01`、`MC-02` 补入通道总表。
- 合并日期：2026-10-27。
- 合并原则：只整理，不新增结论；两份报告原文里的位置（文件:行）与结论照抄；两边说法不一致处标“不一致”并列原话，不裁决；后端与前端对同一对象的追溯，在对方报告里没有追到的，不当作已证实。
- 路径写法：沿用各自报告原文。后端报告里 `nb-runtime:` 表示 `packages/nb-runtime/`，`nbook:` 表示 `packages/neuro-book/`（后端报告 1.1 表的无前缀 `src/...` 属 nb-runtime，1.2 表的“应用/”属 neuro-book）；其余路径相对 `packages/`。前端报告路径相对 `packages/`，`nbook/…` 是 `packages/neuro-book/src/…` 的别名，写成 `plugins/...`、`web/...` 的是 `packages/neuro-book/src/` 下的相对路径。
- 后端报告的追加更正（其 2.7、3.4、5.4 节）优先于其前表；前端报告的附录 A 优先于其正文。下表已按更正后的说法写入，被更正的旧说法不再写。
- 两边口径：后端报告 41 个错误域、64 条通道（`B-`）；前端报告 34 个错误域、57 条通道（`FC-01` 到 `FC-57`，其中 53 到 57 在附录）。合并后见各节。

## 1. 阅读指引

- 第 2 节错误域总表：同一个域两边都有的合成一行，两边 ID 都列；只有一边有的，另一边列写“—”。
- 第 3 节通道总表：按错误域分组。后端写生产、前端写消费的同一条通道合成一行；只有一边有的单列一行。
- 第 4 节必查表：每项给对应通道 ID 与状态（通道 ID／无／Spec 规划、未实现／未追到／不一致／对侧已追到）。
- 第 5 节计数：两边口径不同，并列不相加。
- 第 6 节给 t03 的问题清单；第 7 节未追到汇总；第 8 节自我更正、局限与随机抽样。

## 2. 错误域总表

列：合并域（后端 ID／前端 ID）｜命名空间与拥有者｜类型或 schema 与 Spec｜版本｜码的字段路径与取值来源｜参数字段路径｜重名码｜控制流语义。单元格里的“后：”“前：”表示该说法来自哪份报告；一边没写的不补。

### 2.1 两边都有的域

| 合并域（后端／前端） | 命名空间与拥有者 | 类型或 schema 与 Spec | 版本 | 码的字段路径与取值来源 | 参数字段路径 | 重名码 | 控制流语义 |
|---|---|---|---|---|---|---|---|
| 握手（`remote.handshake`／`x.remote.connect`、`fe.window.connect`、`fe.window.state`） | 后：nb-runtime；前：nb-runtime 远程节点、应用宿主（浏览器窗口） | `RejectFrame`、`RemoteConnectResult`（nb-runtime:`src/remote/protocol.ts:238-246`、`src/remote/node.ts:159-163,338-384`）；前：`WindowState` 失败分支 `web/host/window.ts:47-63`、`FirstConnectResult`／`RemoteSessionState`／`Attempt` `web/host/remote-session.ts:22-46`；Spec `runtime/plugin-channel.md`、`runtime/server-host.md`、`runtime/browser-host.md` | wire 4，hello.wire 与 reject 形状跨版本固定（protocol.ts:14-21）；前：`fe.window.*` 无 | 后：reject `.reason/.message` 同名进 connect；原因 `wire-version/stopping/role/duplicate-instance/project-unavailable/project-gone/server-restarted/disconnected`。前：`x.remote.connect` 的 `reason` 四种（`wire-version/server-restarted/project-gone/project-unavailable`，`node.ts:365,417,1163-1164`、`router.ts:55,174,197,203`）；`state.status` 六种（`window.ts:47`）；`failure` 三种 | 后：绑定参数藏在 message；前：无，只有 `reason: string`、`rescued[].{path,text,note}` | 后：与远程结果 `.code` 不同；前：`incompatible` 同时是 `fe.window.connect.failure` 取值，`project-gone`／`project-unavailable` 与 `x.remote.connect.reason` 同名 | 后：server-restarted／project-gone 终态，普通 disconnected 可重连；前：`connection-failed`／`project-unavailable` 可原地重试，其余要刷新（`window.ts:47`、`FailurePage.vue:24-45`），首连把三者折成 `connection-failed`（`remote-session.ts:169-174`），无“取消” |
| 命令结果（`commands.result`／`x.commands.result`） | nbook.commands | `CommandResult/CommandFailure`（nbook:`src/plugins/commands/shared/contracts.ts:26-43`）；Spec `workbench/commands.md` | 远程 `nbook.commands/remote` 1（shared/contracts.ts:159-179）；结果本身无 | `.code` 九个：`unknown-command/unavailable/invalid-args/not-exposed/read-only/confirmation-required/denied/execution-error/stale-target`；前：远程结果里 `code` 是 `Type.String()`（contracts.ts:161） | `.reason` 只有字符串；审计 `.result` | 与 remote.route 的 denied／unavailable 重名；前：与 `fe.files.result`、`x.settings.write`、`x.storage.record` 重名 | 后：Agent 只读／确认拦截与执行错误不同，stale-target 不通知，取消选择可返回成功 null；前：取消快速选择返回 `{ok:true,value:null}`（`workbench/web/commands/panel-commands.ts:109-110`），与成功不可区分，无“结果未知” |
| 设置写入（`settings.write`／`x.settings.write`） | nbook.settings | `SettingWriteResult/LayerTextWrite`（nbook:`src/shared/settings.ts:344-365`、`src/plugins/settings/shared/layers.ts:26-43`）；Spec `settings/configuration.md`、`settings-window.md` | 后：user/project 远程合同 2（shared/contracts.ts:128-131）；前：无 | `.code` 表 shared/settings.ts:345-361；远程 `.code=settings-failed`、`.detail.{code,detail,position?}`；前：十种 `denied/undeclared/invalid-value/layer-not-allowed/no-project/layer-invalid/write-failed/unavailable/unknown-outcome/read-failed` 与整份写入的码 | `.detail`；整份文本写入另带 `position`（layers.ts:43） | denied／unavailable／unknown-outcome 与路由码重名所以包一层；前：与 `x.commands.result`、`x.storage.record` 重名 | 写结果未知必须保留；`unknown-outcome` 有单独文字（`setting-text.ts:29`）；`conflict` 有交互（`SettingsFileView.vue:358`） |
| 设置层快照（`settings.layer`／`x.settings.layer`） | nbook.settings | `LayerSnapshot/LayerContent/LayerInspection`（nbook:`src/plugins/settings/shared/contracts.ts:76-91`、`layers.ts:45-64`、`src/shared/settings.ts:369-376`；前：`layer-text.ts:32-35`） | 远程合同 2；revision `{boot,seq}` 不是错误 schema 版本；前：无 | `.status=invalid`；`.problems[].reason=invalid-value/layer-not-allowed`；**invalid 的 reason 是中文原因，不是稳定码** | `.detail/.reason?/.position?/.path?`；前：`position:{line,column}`、`reason`、`detail` 均中文句子（`layer-text.ts:99-135`） | 前：无 | invalid 保留上一份有效 values；unavailable／absent 不等于 invalid；前：状态型拒绝，层无效时写入一律被拒（`layer-invalid`） |
| 文件结果（`files.result`／`fe.files.result`，含监视结束 `fe.files.watch-end`） | nbook.files | 后：`nbook:src/plugins/files/shared/contracts.ts:72-77,98-169,294-301`；前：`FilesResult<T>` 同文件 :295-297，`FILES_FAILURES` `files/shared/failures.ts:6-25`；Spec `workspace/files.md`、`resources.md`、`folder-kinds.md` | user/project 5（contracts.ts:233-235）、preview 1（267-278）；前：远程服务合同版本（未展开） | 后：业务码表 `errors` :103-121 与 `failures.ts`；前：18 个业务码加路由层 `RemoteFailureCode`（`files/web/client.ts:307-313`），前端自造 `invalid-address`、`too-large`（client.ts:71,271,292,299）；监视结束 `WatchMessage {kind:"ended",reason:string}`（contracts.ts:224） | `.detail.{detail,current?}`→客户端 `.detail/.current`；批量 `.items[].{status,code,detail,partial?,manifests?}`、`.manifests[].{path,status,detail}`、`.truncated`；`.manifest.{status,detail}`；`cause?: RemoteCause` | conflict／busy／too-large 跨域重名；前：unavailable／denied／unknown-outcome 来自路由层 | 单项 failed／cancelled／not-run／skipped 分开；文件已改而清单未改仍可为成功值带问题；监视结束不是写失败，`reason` 是裸字符串（路由失败码、内核 onEnd 原因或提供者原因） |
| 插件安装与管理（`plugins.install`／`x.plugins.manage`） | 插件平台 + nbook.plugins | nbook:`src/plugin-platform/shared/types.ts:141-169`；Spec `runtime/plugin-install.md` | 后：nbook.plugins/registry 合同 **4**（`plugins/plugins/shared/contracts.ts:21-34`，登记表 `nbook.plugins/v1`、wire 4、合同 4 是不同层）；前：无 | `.code` 安装／管理两组（types.ts:149-165）；前：十个业务码 `manifest-invalid/incompatible-engine/already-installed/uninstall-pending/path-rejected/entry-missing/copy-failed/registry-failed/not-installed/builtin-fixed` | 本地 `.detail/.problems?`，远程 `.detail.{detail,problems?}`；前：`ManifestFailureDetail.problems/detail/key/message/stage/reason` | manifest-invalid／entry-missing 与 notLoaded 重名但语义不同 | 降级与阻塞预览是确认信息，不等于失败；`unknown-outcome` 来自路由层，页面写“已重新读取”（`PluginsPage.vue:107-108`） |
| 插件状态与入口（`plugins.state`／`x.plugins.manage` 的 `notLoaded`／`fe.plugins.entry-state`） | 插件平台；nb-runtime `EntryState` | `NotLoaded/PluginProblem/BlockedPlugin`（nbook:`types.ts:20-77,109-121`）；前：`EntryState.blocked/failure` 的投影（`settings/web/sections.ts:32-37,52-56`、`workbench/web/views/registry.ts:27-30,49-52`） | 后：无独立问题 schema 版本；前：无 | `.notLoaded.{code,detail}`；`.problems[].kind` 分 entry-failed(`stage/reason/message`)、entry-blocked(`reason/key`)、contribution-rejected(`reason/detail`)；前：`notLoaded.code` 五个 `manifest-invalid/entry-missing/unreadable/incompatible-engine/safe-mode`；投递种类 `entry-blocked/entry-failed/entry-stopped/entry-not-activatable/declared/available` | blocked `.range/.service`；前：`blocked.key`、`failure.error.message` | 前：`manifest-invalid/incompatible-engine/entry-missing` 同时是 failure 码与 notLoaded.code | safe-mode 是中性未加载；pending upgrade 不是已生效；前：失败可“重试入口”（`window-plugins.ts:47-55`） |
| 项目与书架（`projects.result`／`x.projects`） | nbook.projects 与宿主 projects | nbook:`src/shared/projects.ts:25-40,67-104,128-136`；前：`plugins/projects/shared/contracts.ts`；Spec `runtime/projects.md`、`workbench/bookshelf.md` | nbook.projects/projects 3、stats 1（shared/contracts.ts:176-177,270-272）；前：书架目录有 `version-changed` 乐观并发码 | 本地 `.reason/.detail/.cause?/.field?/.path?/.state?`；远程包装 `register-failed.detail.reason`（projects/shared/contracts.ts:158-258）；前：`register-failed/invalid-parent/invalid-metadata/project-running/version-changed/unknown-project` 等（`projects/web/messages.ts:97-117`、`shelf-page.ts:310-419`） | 前：`detail:{field,reason,detail,path}`（`shelf-page.ts:314`） | write-failed／conflict／unknown-project 跨域重名；前：unavailable／denied／unknown-outcome 同名 | 新建目录已成功而登记失败有 path，不应投影成完全没创建；前：`unknown-outcome` 有单独文字与对账（`shelf-page.ts:354,388,413`） |
| 封面 HTTP（`http.cover`／`fe.projects.cover-http`） | nbook.projects 封面 | 后：`nbook:src/plugins/projects/backend/cover-routes.ts:42,60-89,115-144`；前：`CoverTransportResult` `projects/web/shelf-page.ts:59`、`plugins/projects/web/plugin.ts:195-219`；Spec `runtime/projects.md` | HTTP JSON，无版本 | 后：`{code,detail}`，`no-cover/too-large/invalid-upload/unsupported-type/write-failed` 或宿主项目 reason；前：服务端错误体 `code`，没有时是 HTTP 状态字符串；前端自造 `network` | `detail`（服务端错误体或 statusText 或异常消息） | 与 http.host 的 `{error:{...}}` 不同；前：`network` 无重名 | 404 no-cover 是内容缺席；消费者不可只读 error.message |
| 存储记录（`storage.result`／`x.storage.record`） | nbook.storage | `StorageFailed/RecordSnapshot/UpdateResult`（nbook:`src/shared/storage.ts:138-177`，前写 :139-158）；Spec `storage/persistence.md` | 后：user/project 远程合同 1（`storage/shared/contracts.ts:39-65`）；记录 descriptor.version 独立；前：记录自带 `version`，读出 `unsupported-version` | `.code` 表 storage.ts:139-154（前：14 个）；远程 `.code=storage-failed`、`.detail.{code,detail}`；快照 `.status=corrupt/unsupported-version/error`（前：另有 `missing`），error 才有 `.code`；订阅 `.onEnd(reason)` | `.detail`；前：`StorageFailedDetail.{status,revision,detail}`（storage/shared/contracts.ts:42） | 前：`conflict/unavailable/denied/busy/no-project/unknown-outcome` 与 `x.commands.result`、`fe.files.result`、`x.settings.write` 重名 | corrupt／unsupported-version 是保护态，不是空值；update 原样返回；unknown-outcome 不重试；remote→storage 折算丢原 cause、拼进 detail；前：损坏记录“受保护：按默认显示、修改不保存”（`layout-store.ts:105`） |
| 存储持久化投影（`store.persistence`／`fe.workbench.layout-problem`） | 共享 store；工作台布局记录 | 后：`StoreClosedError/StoreStoppedError/FieldProblem/SaveState`（nbook:`src/shared/store/persisted.ts:28,70-97`、`store.ts:79`、`problem.ts:6-17`）；Spec `docs/specs/state/store.md`；前：`LayoutProblem` `workbench/web/state/layout-store.ts:99-107` | 后：进程内派生态，无独立错误版本；前：无 | 后：`.failure`／`.save.code`、`.save.state=failed/unknown`；投影 `.kind=unread/protected/unsaved`、`.code`，本地新增 `change-threw`；前：`kind` `unsaved/unread`，`code` 是 `x.storage.record` 的码或快照 `status` | 无 | 同 `x.storage.record` | 丢弃 storage detail 仅留码；unknown 单独保存待核实 intent；protected 不允许普通提交；前：用户可“重试/放弃”（`WorkbenchStatusBar.vue:83-86`） |
| Agent 运行错误（`harness.run`＋`session.log`／`fe.agent.transcript`） | nb-harness、nb-session；nb-agent-ui 适配器 | 后：`RunError/TurnResult/CompleteResult`（`packages/nb-harness/src/run-result.ts:9-39`）；`SessionEntry`（`packages/nb-session/src/entries.ts:23-28,53-88,133-184`）；前：`run_end.error.kind` 映射 `nb-agent-ui/src/harness.ts:104-111,282-285`、`TranscriptProblem` :25-28；Spec `agent/harness.md`、`ui/agent-conversation-view.md` | 后：TS 无版本，写入 run_end.error；会话日志**无 format/schema 版本字段**；前：无 | 后：`.error.{kind,status,message}`，kind=network/rate_limit/auth/quota/context_overflow/provider/local；`.stopReason=stop/finished/length/error/aborted`；前：`kind` 七个，不认识的按 `local` | 后：`agent_message.message` 原样 JSON（工具 details 与 assistant.errorMessage）、`run_end.{stopReason,error}`、旧 `tool_result.{isError,text}`；前：无 | 前：`quota/auth/rate_limit` 与 `x.story.ingest-stop.errorKind` 同一词表 | 取消 aborted、长度截断 length、成功 finished 与 error 独立；前：`aborted` 是“已停止”不当失败（`harness.ts:272-279`），`retryable` 由码决定；后：首个坏行之后为中断尾，append 拒绝直到 repair（`jsonl-log.ts:12-27,73-81`） |
| 工具结果（`tools.result`／FC-40 无独立域） | nb-harness／OMP，工具实现各自拥有 | 后：`packages/nb-harness/src/tools/bridge.ts:15-20,41-79`、`src/tools/registry.ts`（ToolImpl）；前：无独立域，取 `toolResult` content 文本（`harness.ts:229-235`、事件 `result.content` :365-369） | 工具声明随 session_snapshot 固化；结果无统一版本 | 后：`.isError/.content[].text/.details`；撤回 `.details.{code:plugin-unavailable,tool,interrupted}` | 前：`details` 另存 `result.details`（harness.ts:234,369） | `tool_unavailable`（装配错误）与 `plugin-unavailable`（执行结果）不合并 | 第三方实现结果或抛错经 OMP，nb-harness 不统一补 code |
| 剧情问答记录（`story.qa.run`／`x.story.qa-record`） | nb-story | 后：`QaTurnSchema/QaRunView/QaFrame`（`packages/nb-story/src/contract/qa-record.ts:39-59`、`contract.ts:773-781`）；前：`QaFailureSchema {code,kind?,message}` `qa-record.ts:42`、`QaRunView.saved {ok:false,reason,message?}` `contract.ts:587`、`logProblem` `nb-story/src/core/qa-records.ts:273,327,387`；Spec `story/qa.md` | 后：QA JSON 读取兼容旧单轮、旧会话文件名；Profile story-qa 4（`qa/story-qa.profile.tsx:17`）；前：记录有 schema（`qa-records.ts:387-397` 校验） | 后：`.result.error/.turns[].error.{code,kind?,message}`；model_failed／no_answer（`engine.ts:322-350`）；前：`code` model_failed／no_answer；`kind` 同 `fe.agent.transcript`；`saved.reason` conflict／book_not_found 等 | 后：`.saved` 单独记录保存成败；SSE snapshot/log/event/ended | 无 | answered／failed／interrupted 分开（`record-messages.ts:15-17`）；保存失败不能改报模型失败；`log.ok=false.problem` 与 `continuable.ok=false.reason` 是状态槽，不在 error 外壳 |
| 剧情抽取停止（`story.ingest`／`x.story.ingest-stop`） | nb-story | 后：`ModelError/ModelAborted/IngestBadReply`（`packages/nb-story/src/ingest/model.ts:21,51-71`、`chapter.ts:28-32`、`job.ts:120-124`）；前：`IngestStatusView.stopReason` `contract.ts:495`、`web/host/ingest.ts:31-50`；Spec `story/ingest.md` | 后：Worker JSON 消息与持久进度；前：无 | 后：运行 outcome `.kind=failed,.code,.errorKind?,.message`；前：`stopReason.kind` user／exited／failed；`code`（如 `ingest_bad_reply`）；`errorKind` 同 agent 词表 | 后：`.kind/.status/.retryAfterMs`；前：`message` | model_failed 与 QA 同名但归属 ingest | stopped 不当 failed；手动停下、进程退出、失败分开 |
| 剧情 HTTP／查询（`story.query`＋`story.qa.setup`／`x.story.rpc`） | nb-story | 后：`StoryError/StoryOutcome`（`packages/nb-story/src/core/errors.ts:7-65`、`api.ts:40`）、`QaError`（`qa/errors.ts:7-16`）；前：`StoryCallError {code,message,candidates}` `nb-story/src/web/host/client.ts:32-41`、服务端体 `server/http.ts:96-145,237-261`；Spec `story/queries.md`、`story/qa.md` | 后：未来 nb-story/queries 远程合同 1；独立 CLI/HTTP 无统一错误版本；前：无 | 后：`.error.{code,message,candidates?}`（core/errors.ts:7-25）；`qa_unconfigured/qa_config_write_failed/config_conflict/full_read_unavailable/qa_not_continuable/qa_busy`；前：`StoryErrorCode`、`QaErrorCode` 加前端造的 `network` 及 `internal/invalid_params/unauthorized` | `candidates[]`（`.id/.label/.note`） | invalid_params 是领域校验，不能与 remote invalid-input 直接合并 | 前：`AbortError` 原样抛出供丢弃（client.ts:116-117）；开始前抛错，运行后写问答轮结果 |
| nbdev 错误（`nbdev.error`／`x.nbdev.envelope`、`x.nbdev.text-rules`、`x.nbdev.terminal`） | dev-panel | 后：`NbdevError/Warning/ErrorEntry`（`packages/dev-panel/src/core/errors.ts:5-119`、`cli/output.ts:22-32`）；前：`Envelope.errors[{code,message,details}]` `dev-panel/src/web/host/api.ts:8-9`、服务端 `server/serve.ts:123`；`controlCharProblem/titleProblem/validateAnswerValue` `core/text-rules.ts:14-26`、`core/questions.ts:83-99`；终端帧 `server/terminal-hub.ts:298`；合同 docs/cli.md | 每条 CLI outcome 自己的 schema（如 nbdev.cli/v1）；HTTP `{errors:[]}` 无错误版本；前：`schema` 字段（`PANEL_API_SCHEMA`） | `.code` 全表 core/errors.ts:5-96；JSON `.errors[].{code,message,details?}`；warnings 同形；前：另有前端造的 `network/http_error/internal`（api.ts:74,84,88）；共用校验无码，返回中文句子或 `null`；终端 `code: string`（取值未逐个追） | `.details`、Error.cause；前：`details.{field,problems[],screenDigest}` | 无（code 全表属 nbdev，不是产品错误注册表） | 退出 1/2/3/4/5 区分运行／用法／需决定冲突／超时中断／不存在；warning 不代表失败；前：`lock_timeout/warming_up/commit_failed/changed_after_write` 区分“没写”“写了没提交”“结果未知”（`writes.ts:30-41`）；终端 `released/need_confirm/error` 三种帧分开 |
| 诊断记录（`diagnostics.store`／`fe.diagnostics.browser`） | nb-runtime | 后：`DiagnosticsError/RecordReceipt/DiagnosticsStatus/DiagnosticRecord`（nb-runtime:`src/diagnostics/contracts.ts:22-65,101-119,181-193`）；前：浏览器出口 `plugins/diagnostics/web/console-exporter.ts:36,60`；Spec `runtime/diagnostics.md` | 后：进程内无版本，文件出口另列（JSONL 行无 schema 版本）；前：记录是否带版本**未追到** | 后：`.code=closed/already-attached/close-incomplete`；收据 `.reason=stopping/closed/invalid-input`；降级 `.degraded.{reason,detail}`；记录 `.event/.message/.data/.error`；前：`event`（英文点分名）、`level`，`message` 多为中文 | `.detail`、Error.cause；前：`data`、`error`、`source` | `closed/invalid-input` 与远程／设置等重名 | record 永不抛，出口降级不等于拒绝记录；shutdown 失败抛 close-incomplete；前：告警与错误级别 |

### 2.2 只有后端有的域

| 后端 ID | 命名空间与拥有者 | 类型或 schema 与 Spec | 版本 | 码的字段路径与取值来源 | 参数字段路径 | 重名码 | 控制流语义 |
|---|---|---|---|---|---|---|---|
| `runtime.lifecycle` | nb-runtime | `LifecycleStateError`、`LifecycleFailure`（`src/lifecycle/contracts.ts:45-65,310-331`）；Spec `runtime/lifecycle.md` | 进程内 TS，无错误 schema 版本 | 异常没有 `code`；`name` | `instanceId/scopeId/phase/action`；失败记录 `stage/attempt/resourceId/error.{name,message}` | — | `closed` 是阶段而非通用失败码；获取失败、释放失败、关闭未完成分开，未完成不等于 closed |
| `runtime.services` | nb-runtime | `ServiceRevokedError`、装配诊断（`src/services/per-consumer.ts:25-39`、`contracts.ts` 的 `AssemblyDiagnostic`）；Spec `runtime/services.md` | 进程内，无独立错误版本 | `.reason = released/provider-stopped` | `.key/.consumer` | 与插件、应用的 `reason` 不是同一域 | 作废门面抛错，不是业务失败结果 |
| `runtime.application` | nb-runtime | `StartupFailure/GateOutcome/StartupResult/AdmissionResult/StopResult`（`src/application/contracts.ts:115-165`）；Spec `runtime/application.md` | 进程内，无独立错误版本 | `.failures[].{category,required,source,stage,reason,error}`；门禁 `.reason/.error`；接纳 `.reason = startup-failed/stopping/closed` | — | — | available 仍可有非必需失败；failed 与 stopped 分开；stop incomplete 保留收口报告，不能当成功 |
| `runtime.plugins` | nb-runtime | 登记、激活、贡献校验、诊断、`PluginStateError`（`src/plugins/contracts.ts:252-339,357-386,438-452,500-515`）；Spec `runtime/plugins.md` | 进程内，无独立错误版本 | `.rejections[].reason/detail`；`.stage/.reason/.error`；`.validation.reason/detail` | `plugin/entry/generation/key/path/capability/contribution` | `missing-service/denied` 等必须带域 | 激活 failed、stopped、cancelled、rejected 独立；贡献 pending(unknown-point) 不是 rejected |
| `runtime.manifest` | nb-runtime | `ManifestReadResult/ManifestProblem`（`src/plugin-manifest/schema.ts:163-171`）；Spec `runtime/plugin-manifest.md` | 清单自身 schema，问题列表无版本 | `.status = invalid`，`.problems[].{path,message}`，没有逐条稳定码 | — | — | 清单字段问题仅文字；安装另包成 `manifest-invalid`；不能把问题 message 当错误码 |
| `remote.route` | nb-runtime | `RemoteFailure/RemoteCallError/RemoteDiagnostic`（`src/remote/protocol.ts:27-83`、`src/remote/result.ts:12-34`）；Spec `runtime/plugin-channel.md` | wire 4；业务合同另有 version | `.code = invalid-input/denied/target-gone/unavailable/not-provided/version-changed/timeout/cancelled/unknown-outcome/provider-error`；`.cause = target-gone/timeout/cancelled/disconnected/activation-cycle` | `.detail`；异常 `.failure` 原样保留 | 与 commands／settings／storage 的 denied、unavailable、unknown-outcome 等重名 | 写请求已发出后中断为 unknown-outcome，**不能投影成确定失败或自动重试**；cause 是传输阶段枚举，不是 Error.cause |
| `remote.business` | 各远程合同拥有者 | `RemoteMethodSpec.errors[code]`、`RemoteResultFor`（`src/remote/contract.ts:163-165,208-210,315-337`） | 每份合同 `.version` + wire 4 | `outcome.code`、`outcome.detail` 按该方法 errors 的 schema；不接受与路由层重名的业务码 | `outcome.detail` | — | node 双侧校验；未声明码或不合 schema 的 detail 改成 provider-error（node.ts:689-710,867-879） |
| `plugins.code` | 通用插件平台 | `PluginCodeError/ModuleNotShared`（nbook:`src/plugin-platform/shared/plugin-code-error.ts:12-47`）；Spec `runtime/plugin-code-loading.md` | 进程内错误，无版本 | `.code=code-load-failed/code-shape/code-threw/module-not-shared` | `.plugin/.entry/.url`；标准 Error.cause；detail 只拼进 `.message` | — | 经 runtime.plugins 投影为 activation-threw + error.name/message，专有码与参数不再独立；服务端与浏览器两套装载器共用 |
| `http.host` | nbook.http + RPC listener + plugin-files | nbook:`src/plugins/http/backend/admission.ts:22-32`、`dispatch.ts:75-144,221-222`、`src/server/rpc/listener.ts:45-46`；Spec `runtime/server-host.md` | HTTP JSON 无 schema／version | 常见 `{error:{code,message}}`；准入 startup-failed／stopping；分发 not-found／plugin-unavailable／internal-error／misdirected-host／origin-not-allowed；文件子路由另有 code | — | — | stopping 是阶段拒绝；HTTP 状态与 code 同时有意义；不是所有插件路由都用这个外壳 |
| `host.process` | 服务端／项目宿主 | `ServerConfigError/ServerStartupError/ServerAssemblyError/ProjectConfigError`、`ProjectEnvelope`（nbook:`src/server/config.ts:32-40`、`start.ts:126-138`、`process.ts:117-128`、`src/project/config.ts:19`、`src/server/projects/ipc.ts:18-29`） | IPC JSON 信封无版本；其中远程帧仍 wire 4 | config `.code`；项目 config `.variable`；启动 `.status/.failures`→摘要 `.causes[].{source,reason,message}`；IPC `{t:started,status:failed,detail}` | — | — | 启动被停止与启动 failed 分开；IPC detail 合并后信息少于原始 StartupFailure；退出码另承载收口成败 |
| `cli.nbook` | 应用作者／用户 CLI | `CliFailure`（nbook:`src/cli/output.ts:7-17`、`main.ts:108-148`）；Spec `runtime/cli.md` | `--json` 无 schema／version | `.code/.message/.exitCode/.fields`→顶层 `{ok:false,code,message,...fields}`；码来源 `src/cli/main.ts`、`start.ts`、`plugin.ts`、`state-root.ts` | `.fields` | 同名 usage／startup-failed／confirmation-required 不等于其它域 | 退出 2 用法／需确认，1 失败；人类 stderr 与 JSON stdout 分开 |
| `profile.contract` | nb-profile | `ProfileError`（`packages/nb-profile/src/define.ts:12-21`）；Spec `agent/harness.md` | Profile manifest.version 是上下文兼容版本，不是错误版本 | `.code=profile_invalid/invalid_initial` | `.details:string[]` | 与 harness 同名码通过显式包装继承（harness.ts:84-86） | details 外面再包 `{details}` |
| `harness.contract` | nb-harness | `HarnessError`（`packages/nb-harness/src/errors.ts:6-24`）；Spec `agent/harness.md` | 进程内；会话工具快照精确比对 | `.code=tool_unavailable/tool_name_conflict/invalid_initial/profile_invalid/session_incompatible/session_busy/session_closed/profile_has_tools` | `.details`；无 Error.cause 选项 | — | 合同错误抛出，模型运行期失败不抛；session_incompatible 不等于坏日志，旧消息／工具说明不一致也会拒绝恢复 |
| `story.ingest-check`（后端 2.7 补录） | nb-story | `Issue/IssueSubject`（`packages/nb-story/src/ingest/compile.ts:24-38`）、`SchemaProblem/Problem`（`draft-schema.ts:263-284`、`draft-tools.ts:24-26`） | 无独立错误 schema 版本 | `.issues[].{level,chapter,code,message,records?,missing?,name?,mention?,link?,questionUpdate?}`；细分码来源 compile.ts 的 issue 调用 | 同左 | — | 给抽取模型改稿的领域问题，不等同模型传输失败 `story.ingest` |
| `workflow.run` | nb-workflow | `WorkflowRunState/RunView`（`packages/nb-workflow/src/types.ts:190,354-396`） | Run revision 是 CAS；definition.version／manifestHash 是工作流定义身份；无错误 schema 版本 | `.status=running/waiting/completed/failed/cancelled`；`.error?:string`；`.logs:string[]` | — | — | failed 字符串丢错误类型／码／参数；waiting 由 SuspendSignal，cancelled 由 WorkflowCancelledError 或 abortRequested；不能当通用异常 |
| `workflow.control` | nb-workflow | backend／activities／children／definitions／events／signals／timers／values 的 Error 子类及 `WorkflowPersistenceError`（`src/backend.ts:11-35`、`runner-run-store.ts:26-38` 及其余同名类文件） | TS 进程内合同，无统一错误版本 | 主要靠 `.name/instanceof` | runId／revision／reference／idempotencyKey／missing 等；WorkflowPersistenceError 保留 Error.cause | — | 控制失败直接 reject，不写成 run.status=failed；后端保存失败 poison 本地投影；所有冲突类不是一个码 |
| `history.error` | nb-history | `HistoryError/HistoryInboxMutationError/TextDiffResult`（`packages/nb-history/src/types.ts:111-112,153-181`）；包 docs/README.md | SQLite 数据，错误无版本 | HistoryError 无 code；收件箱 `.code=missing/stale`；diff `{available:false,reason:before-missing/after-missing/binary}` | — | 此 missing 与 Storage missing 不同 | 快照不可用正常返回，restore／revert 无快照抛错 |
| `memory.failure` | nb-memory | 未定义专属 Error 类／码（`packages/nb-memory/src/index.ts:183`、`core/state-store.ts:42`、`subject-registry.ts:85,110,207`、`ports/sqlite-index-store.ts:299,359`） | JSONL／SQLite 存领域数据，无失败 schema | 普通 `Error.message`；降级 `.skippedChunks/.skippedResolveBatches`、planner `.degraded` | — | 不是 tools.result | 失败文字未保留到降级结果，计数／布尔可观察但无错误原因 |
| `process.ownership` | owned-process | `OwnedProcessError/OwnedProcessCompletion`（`packages/owned-process/src/types.ts:4-17,48-58`） | 子监督进程有私有消息协议，无错误 schema 版本 | `.stage/.osError?`、Error.cause；完成 `.exitCode/.signal/.terminationReason?` | — | — | timeout／abort／cancel／shutdown／startup-failure／host-disconnect 是主动终止原因，不等于异常；自然非零退出不是 OwnedProcessError |
| `snapshot.failure` | file-snapshot-cache | `SnapshotClosedError/SnapshotUnstableError/SnapshotEntryDiagnostics`（`packages/file-snapshot-cache/src/types.ts:62-79,117-130`） | 进程内，无持久错误版本 | `.name`；unstable `.keyId/.attempts`；诊断 `.lastBuildError/.lastBuildFailedAt/.watcherError` | — | — | read reject 与诊断状态分开；缓存可继续保留旧 snapshot；“文字有界”只适用 lastBuildError，watcherError 原样 message（后端更正） |
| `sdk.author` | 插件 SDK 作者 CLI／构建 | `PluginBuildError/PluginCreateError/UsageError`（nbook:`plugin-sdk/cli.ts:21,75-96`、`src/plugin-platform/build/build-plugin.ts:112-124`）；Spec `runtime/plugin-api.md` | nbooke 无 JSON 输出／版本外壳 | build `.summary/.problems[].{path,message}`、Error.cause；CLI 按类／Node `ERR_PARSE_ARGS_*`／syscall 分类 | — | 不等同应用 nbook CLI | build／create 错退出 1；用法 2；third-party／Node message 原样 |

### 2.3 只有前端有的域

前端报告读法：`fe.` 表示合同的类型定义落在前端分区，`x.` 表示合同在对侧、前端只是消费者或再包装者（本节只含 `fe.` 与没有后端对应域的项）。

| 前端 ID | 命名空间与拥有者 | 类型或 schema 与 Spec | 版本 | 码的字段路径与取值来源 | 参数字段路径 | 重名码 | 控制流语义 |
|---|---|---|---|---|---|---|---|
| `fe.web.connection` | 应用宿主（引导与 RPC 端口） | `ConnectionError`（`web/host/connection.ts:12-26`）；Spec `runtime/browser-host.md` | 无 | 没有码；`status: number \| null`（HTTP 状态） | HTTP 错误体 `{error:{code}}` 的 `code` 拼进消息字符串（`connection.ts:79,89-97`） | 无 | 只有“失败”；抛错 |
| `fe.editor.action` | 编辑器 | `ActionResult`、`BatchCloseResult`、`OpenResult`（`plugins/editor/web/area.ts:62-68`）；Spec `workbench/editor.md` | 无 | 没有码，只有 `ok:false` + `reason: string`（约 50 个返回点，`area.ts:531-907`） | `BatchCloseResult.closed: number` | 经 `fromAction` 变成命令的 `unavailable`（`editor/web/commands.ts:118,137-138`） | 失败、取消、未变化只能读 `reason` 文字区分（`area.ts:642-643,683,693`） |
| `fe.editor.document` | 编辑器文档存储 | `SaveResult`、`BlockedInput`、条目 `failure`（`editor/web/documents/store.ts:39,70-88`）；Spec `workbench/editor.md` | 无 | 本域自有 `closed/unresolved/unrepresentable/conflict/ended/not-ready/exists`（store.ts:552-570），其余透传 `fe.files.result` 的码与 `unknown-outcome` | `detail?: string`；`BlockedInput.{from,to,index,excerpt}`；`reason`（编解码器内部说法，界面不显示，store.ts:72-76） | `conflict/unknown-outcome/not-found` 与 `fe.files.result` 同名同义；`exists` 由 `conflict` 改名（store.ts:570） | `unknown-outcome` 单独处理（`EditorGroup.vue:187`）；`ended` 是订阅结束不是写失败 |
| `fe.explorer.notice` | 资源管理器 | `Notice`、`NameError`、`ReportResult`、`UnavailableReason`（`explorer/web/controller.ts:48-53,143`）；Spec `workbench/files-explorer.md` | 无 | `Notice.kind`：`editor-missing/open-failed/failed/manifest`；`failed.code` 是 `fe.files.result` 的码或自造 `document-unsettled`（controller.ts:677）、`failed`（:569）；`UnavailableReason` 九个（`feedback-text.ts:91-101`）；`ReportResult.status`：`declined/done/failed/skipped/not-run/cancelled` | `Notice.failed.{action,address,code,detail}`；`manifest.issues[].{path,detail}` | busy／conflict／not-found 与 `fe.files.result` 同名同义 | 失败、取消（cancelled、declined）、跳过、未运行在 `ReportResult.status` 分开；`unknown-outcome` 有单独文字 |
| `fe.preview.denial` | HTML 预览、图片查看 | `PreviewDenial`（`html-preview/web/access.ts:10`；`ImageViewer.vue:20`） | 无 | `no-project/closed/unreachable`（预览）；`no-project/failed`（图片） | 无 | `no-project` 与 `x.storage.record`、`x.settings.write` 重名 | 失败 |
| `fe.markdown.unrepresentable` | nb-markdown 编解码 | `{ok:false, code:"unrepresentable", from, to, reason, fallback}`（`nb-markdown/src/language/codec/write.ts:42-51,745`）；异常类 `Unrepresentable`（`syntax/types.ts`） | 无 | `code: "unrepresentable"`（唯一） | `from`、`to`；`reason` 中文内部说法（界面不显示） | 无 | 失败（输入不进正文，不能保存） |
| `fe.form.issue` | nb-form | `FormIssue {path,code,params,message?}`（`nb-form/src/validate.ts:25-103`；码表 `nb-form/src/vue/messages.ts:61-141,195-260`）；Spec `ui/forms.md` | 无 | `required/type/not-in-choices/schema-error` 等 Ajv 关键字风格的码 | `params.{limit,key,type,value,at,detail,…}` | 无 | 只有“不合格”；`FormWidgetError.code` 是 `builtin-name/duplicate-name`（调用方代码错，`vue/widgets.ts:43-48`） |
| `fe.ui.grid` | nb-ui 嵌套栅格 | `GridResult`、`GridResizeResult`（`nb-ui/src/components/layout/grid-types.ts:167-196`）；Spec `ui/nested-grid.md` | 栅格快照有版本（`grid-snapshot.ts`，未展开） | 没有码，`reason: string`（中文） | 无 | 无 | 失败；只进诊断（`WorkbenchShellLayout.vue:107-119`、`workbench/web/plugin.ts:136-140`） |
| `fe.ui.theme-install` | nb-ui 主题装载 | `NbThemeInstallError {themeId,reason}`（`nb-ui/src/theme/theme-loader.ts:36-50`） | 无 | `reason`：`duplicate-id/host-version/unsafe-svg-defs` 等（theme-loader.ts:36-37） | `themeId` | 无 | 抛错；装载发生在模块顶层（`neuro-book/src/ui/theme/product-themes.ts:17`） |
| `fe.sdk.define` | 应用 SDK | 定义期 `TypeError`（`neuro-book/src/sdk/plugin.ts:70-71,234,274`、`sdk/command-helpers.ts:34-57`） | 无 | 无码 | 无 | 无 | 抛给插件作者，不进界面 |
| `fe.lab.*` | 组件 Lab | 开发场景夹具里自造的 `{ok:false}` 与 `throw`（`neuro-book/src/plugins/lab/web/**`） | 无 | 无 | 无 | 无 | 不是产品通道 |
| `fe.examples.*` | 插件 SDK 示例 | `storage-failed/unknown-item/already-running/not-running/stopped`（`plugin-sdk/examples/plugins/*/shared/contracts.ts`、`backend/plugin.ts`） | 示例合同带 `version` | 各示例自有；`StorageFailed {code,detail}` | `detail.code` 透传 `x.storage.record` | 无 | 失败；`stopped` 是“被停止”不是失败 |

### 2.4 主会话补查补入的域

| 来源 | 说明 |
|---|---|
| 主会话补查 MC-01 | `packages/neuro-book/src/plugins/projects/project/` 的统计逻辑，约 20 条诊断（`record(` 共 22 处，含定义）：消息中文、带稳定 `event`（`projects.stats.*`），只进诊断，不显示给用户。无独立错误合同，不单列错误域。例：`stats-tracker.ts:209、418、447、463` |
| 主会话补查 MC-02 | 各插件 `testing/`（explorer、files、settings、storage）是测试场地辅助代码，抛中文错误，只在测试里出现。无独立错误合同，不单列错误域。 |

### 2.5 域表里两边版本说法不同的项（原话并列，不裁决）

| 域 | 后端原话 | 前端原话 |
|---|---|---|
| 设置写入 | user/project 远程合同 **2** | 版本：无 |
| 设置层快照 | 远程合同 2；revision `{boot,seq}` 不是错误 schema 版本 | 版本：无 |
| 插件安装与管理 | 远程合同 **4**（`plugins/plugins/shared/contracts.ts:21-34`） | 版本：无 |
| 存储记录 | user/project 远程合同 **1**；记录 descriptor.version 独立 | 记录自带 `version`，读出 `unsupported-version` |
| 命令结果 | 远程 `nbook.commands/remote` **1**；结果本身无 | 远程服务 `nbook.commands/remote` version 1；结果本身无 |
| 握手原因取值 | reject 原因八种（含 `stopping/role/duplicate-instance/disconnected`） | `x.remote.connect.reason` 四种（`wire-version/server-restarted/project-gone/project-unavailable`） |

## 3. 通道总表

列：合并通道｜后端 ID｜前端 ID｜生产者（文件:行）｜逐跳转换（文件:行；保留、改名、包裹、截断、丢失）｜消费者（文件:行）｜现语言；显示给用户；进模型｜持久化；旧数据；备注。同一单元格里“后：”“前：”标明来源。前端报告对所有 FC 通道都写“进模型：无、持久化：否”，除非下表另写。

### 3.1 诊断与内核

| 合并通道 | 后端 ID | 前端 ID | 生产者 | 逐跳转换 | 消费者 | 语言；用户；模型 | 持久化；旧数据；备注 |
|---|---|---|---|---|---|---|---|
| 诊断查询 | `B-DIAG-QUERY` | —（前端必查 1b：无） | 后：`packages/nb-runtime/src/diagnostics/store.ts:340-414` 机制事件转 record；`packages/neuro-book/src/server/start.ts:182-184` 把 RemoteDiagnostic 放 data | 后：store.ts:252-273 message 脱敏截断、data 收敛、error 序列化；redaction.ts:18-23,67-80（message 4000、栈 12000、数组 50、对象 80、深度 6），Error 仅 name/message/stack/cause，**不保留自定义 code**；store.ts:288-294 淘汰有界缓冲 | 后：`diagnostics/plugin.ts:78-80` 服务转发；store.ts:130-161 查询；调用见 diagnostics.test.ts:78-85、commands/plugin.test.ts:176；**产品诊断查询 UI/HTTP 消费者：未追到** | 中英混合（机制 message 中文，reason 英文，第三方原文）；用户：无已追到产品显示；模型：无 | 仅本实例内存，不扫描日志（store.ts:1-6,130-161）；无旧数据重建、无版本 |
| 诊断 JSONL | `B-DIAG-JSONL` | —（前端必查 1c：无） | 后：上行 record + `plugins/diagnostics/backend/plugin.ts:46-59` console 桥（原 console 仍执行） | 后：store.ts:297-309 串行 exporter.write，失败标 degraded；`jsonl-exporter.ts:161-179` 保留 timestamp/level/event/message/error，origin 改名包进 `data.$source`，**sequence 丢失**；log-writer.ts:94-109 追加、轮转 | 后：`log-writer.ts:14,35-41,109` 文件；消费旧文件的产品 reader：无 | 中文与第三方英文混合；用户：开发者读日志；模型：未追到自动注入 | `server-current.jsonl` 与 `server-<时间>-<pid>-<token>.jsonl`，无行 schema 版本；旧行留盘按普通 JSONL 读，不迁移；不是 session JSONL |
| 诊断降级兜底 | `B-DIAG-FALLBACK` | — | 后：store.ts:186-197,305-318 出口缺失／失效／写失败后 error／fatal | 后：`jsonl-exporter.ts:229-238` 仅保留 timestamp/level/event/message/origin，包 `{diagnostic:...}`，**data/error/sequence 丢失**；jsonl-exporter.ts:94-98 释放锁失败直接 stderr | 后：stderr；项目 stderr 再经 `server/projects/manager.ts:516-518` 加行前缀转发 | 中英混合；用户：终端／日志操作者；模型：未追到 | 自身不保证落盘；降级前已排队而失败的记录只在内存 |
| 浏览器诊断记录 | — | `FC-32`（并含 `FC-05`、`FC-19`、`FC-34`） | 前：40 处 `.record({level…})`；FC-05 `remote-session.ts:103,149,155`（`onRetryFailed`）；FC-19 `editor/web/plugin.ts:116,121,125,150,154,169,193,217`；FC-34 `markdown/web/syntax-catalog.ts:30,89-92`、`markdown/web/plugin.ts:72-76` | 前：保留；`console-exporter.ts:36` 写成 `` `${timestamp} [${level}] ${event}: ${message}` `` 加整条记录对象，出口不可用时 :60 兜底；FC-05 `window.ts:212` 记 `browser-host.reconnect.failed`，`data.reason` 原文；FC-34 保留 `code`（`InactiveCode`）进 `data.code`，去重键 `id`+`code`（syntax-catalog.ts:90） | 前：浏览器控制台；`DiagnosticsStore` 内存 | 中文（20）／表达式（20）；FC-05 `level: info`；用户：否（只在开发者工具）；模型：无 | 否（控制台）；`diagnostics/web/plugin.ts:1-4` 明确不桥接 console；没有浏览器到服务端转送（未发现） |
| 紧急输出 | `B-HOST-EMERGENCY` | `FC-33` | 后：`nb-runtime/src/diagnostics/store.ts:421-430` 包装；`neuro-book/src/server/host.ts:124-132` beforeStop 异常；前：`window.ts:~257` `recordingEmergency` | 后：recordingEmergency 保留 reason 作 record.message、detail 放 data；`server/start.ts:311-318` 启动转 reportStartupFailure、停止直接 fatal JSON；:414-415 另补启动失败原因；`project/start.ts:148-156` 同样输出；前：JSON 串写 `console.error` | 后：`server/process.ts:28-42,47-62,168-169` stderr JSON；项目 output 走 manager.ts:516-518；前：控制台 | 后：中文为主，第三方英文可混；用户：开发诊断；模型：未追到。前：取决于报告 | stderr 紧急 JSON 无版本，不要求诊断 store 已存在；配置／状态根失败发生在 store 之前 |
| 握手 reject → 连接结果 → 失败页 | `B-REMOTE-HANDSHAKE` | `FC-03`、`FC-04` | 后：`nb-runtime/src/remote/protocol.ts:299-307`、`router.ts:170-204`、`manager.ts:343-351`；前：`protocol.ts:307`、`router.ts:174,197,203`、`node.ts:417,1163-1164` | 后：router.ts:284-286,319-320 句子原样放 reject.message；node.ts:348-370→RemoteConnectResult；server-restarted／project-gone 被终态常量替换；`remote-session.ts:82-86,159-174` message 改名 reason，普通失败拼 `reason:message`；`window.ts:217-218` 入 WindowState。前：`remote-session.ts:82-85` 四种已知 reason 折成 kind 并把 message 放进 reason，未知 reason 写 `` `${reason}：${message}` ``（:86），首连再把 server-restarted／project-gone 折成 connection-failed（:169-174）；FC-04 `remote-session.ts:92,114`，`onState(kind,reason)`，`offline` 只改 connection 字段不带文字（`window.ts:199-211`） | 后：`web/FailurePage.vue:30-41,68-69` 直接画 reason；`project/start.ts:115-118` 把连接结果包 Error 缩成 `started.detail`。前：`window.ts:218`→`FailurePage.vue:69` | 中文为主，未知 reason 时混合；用户：是；模型：无。FC-04 终态时是，离线只是状态点 | wire 4，reject 形状跨版本固定；不持久化；旧 peer 由 wire 拒绝，不迁移帧；前端备注：与决策 2“跨进程只传码、结构化参数”相比 message 是句子 |
| 远程路由结果 | `B-REMOTE-ROUTE` | `FC-14`、`FC-15`、`FC-20`、`FC-25`、`FC-26`、`FC-28`、`FC-31` 各自消费路由层码（前端必查 2c） | 后：`node.ts:489-519,595-605,787-852`；`router.ts:383-431`；`peer.ts:143-161` | 后：protocol.ts:68-83 按 dispatched/effect/cause 计算码；peer.ts:178-184,337-350 取消／超时／断开结算；router.ts:458-459 原样转发；node.ts:689-710 校验输出／业务 detail；peer.ts:281-283 编码不了结果改 provider-error | 后：各 remote client；`nb-runtime/src/remote/result.ts:15-25,32-34` orThrow 包 RemoteCallError，保留 `.failure`，仅字符串 detail 拼进中文 message | 中英混合（TypeBox 英文 + 中文标签／句子）；用户：取决于业务投影；模型：仅已追到特定工具桥时 | wire 4；不持久化；写发出后 timeout／cancel／disconnect = unknown-outcome；Error.cause 不替代远程 cause |
| 远程业务 detail | `B-REMOTE-BUSINESS` | 前：必查 2d 列 `FC-14`、`FC-15`、`FC-20`、`FC-25`、`FC-26`、`FC-28`、`FC-30` | 后：各合同 provider 返回 `ctx.fail/ok:false`，如 `settings/backend/owner-link.ts:71-72`、`storage/backend/owner.ts:52` | 后：node.ts:867-879 按 errors[code] 校验 detail，合法保留 code/detail，非法变 provider-error；router.ts:459 原样；node.ts:699-710 消费侧再核对 | 后：`settings/shared/remote-link.ts:99-141`、`storage/shared/remote-route.ts:52-69`；files/web 客户端与 plugins 页 | 中文 detail 为主，外部错误／校验混英文；用户：是；模型：仅领域工具另列 | wire 4 + 每份业务合同 version；无旧结果存储；closed schema 变化不能无版本假设兼容 |
| 订阅结束 | `B-REMOTE-END` | 前：`FC-16`（文件监视结束） | 后：`peer.ts:315-325`；`node.ts:882-946`；`peer.ts:337-350`；前：`files/web/client.ts:213-214,224,229` | 后：`router.ts:487-505` 保留 event，**disconnected 改名 target-gone**；node.ts:1041-1049 非本地 disconnected 暂不 onEnd、等重连；node.ts:424-437 终态 onEnd(reason)；未接受订阅的 ended 在 peer.ts:236-244 改为 unavailable/detail；`store/persisted.ts:258-260` 将 reason 当 code 保存。前：保留 reason 字符串，监听者各收一份 | 后：`storage/shared/remote-route.ts:39-42`、`settings/shared/remote-link.ts:28-31`。前：编辑器 `documents/store.ts:247-249,439-440`→`EditorGroup.vue:183`（`ended` 双语框架 `{reason}` 原样）；资源管理器 `explorer/web/tree/model.ts:210-221`→`FilesExplorerView.vue:92,156` | 稳定英文 reason（部分可任意字符串）；前：混合（码或英文原因串配双语框架）；用户：是，状态投影；模型：未追到 | 不持久化；wire 4；**结束原因和建立失败不是同一个字段**；前：`reason` 是裸字符串没有枚举 |
| 贡献与清单校验拒绝 | `B-PLUGIN-VALIDATION` | `FC-25`（拒绝原因展示端） | 后：应用 `commands/shared/registry.ts:123-137`、`http/backend/dispatch.ts:23-27`；`nb-runtime/src/plugin-manifest/schema.ts:163-171`；前：对侧 `plugin-platform/shared/problems.ts:14-33` | 后：`nb-runtime/plugins/host.ts:878-894` prefix/schema/custom validate 或抛错摘要→`.validation.reason=invalid-declaration,.detail`；`lifecycle/scope.ts:69-84` 错误只留 name/message；`problems.ts:14-33` 原样 reason/detail/message 到 PluginProblem | 后：`plugins/plugins/backend/plugin.ts:43-47`、`inventory.ts:311-321`→远程 list；`PluginsPage.vue:191-200,435-437`、`settings/web/sections.ts:53-55`。前：`PluginsPage.vue:188-200`（`REJECTED_REASON` 四个码加原样 `detail`）、:157-159 `windowPlugins.problems()` | 中文、TypeBox 英文、插件自带文字混合；用户：是；模型：未追到 | 运行状态不持久化；清单原文件留盘、问题启动重算；rejected reason 码保留，具体 schema／custom 规则无结构码 |

### 3.2 命令、设置、插件、存储

| 合并通道 | 后端 ID | 前端 ID | 生产者 | 逐跳转换 | 消费者 | 语言；用户；模型 | 持久化；旧数据；备注 |
|---|---|---|---|---|---|---|---|
| 命令失败结果与通知 | `B-COMMAND-RESULT`、`B-COMMAND-NOTICE` | `FC-09` | 后：`commands/shared/registry.ts:296-358`（未登记、参数、when、Agent 只读／确认、执行异常），`shared/plugin.ts:88-94`；额外 `settings/shared/contracts.ts:168-177` 把 SettingsFailure 映射为命令码。前：对侧 `registry.ts:177,259,268,300,312,331,335,348,351,355,358`；前端 `workbench/web/commands/view-commands.ts:104-203`、`panel-commands.ts`、`part-commands.ts`、`open-commands.ts:40,47`、`app-commands.ts:53`、`editor/web/commands.ts:118,137-138`、`explorer/web/commands.ts:109`、`projects/web/open-project.ts:54-77`、`settings/web/settings-window.ts:727-728`、`html-preview/web/plugin.ts:126` | 后：registry.ts:331,348,358 **异常只取 message、丢 code/cause/参数**；:355-356 非法命令码折 execution-error；:278-295 保留 result 到审计事件；shared/plugin.ts:119-141 远程 **outer ok:true,value:{ok:false,code,reason}**。`failure-notice.ts:17,23-29` 仅 invalid-args/execution-error/unavailable/unknown-command/denied，reason **原样当 message**；`WorkbenchCommandHost.vue:34-38` 转 notify。前：`failureNotice` 把 `failure.reason` 原样放进通知 message（`failure-notice.ts:26-30`），只有 `NOTIFIED` 五个码弹通知；快捷键入口先 `report(new Error(…reason))`（`keymap.ts:102`），面板入口 `WorkbenchCommandHost.vue:46` 补同一句进诊断 | 后（最终绘制）：`workbench/web/notifications.ts:42-50` message 原样入队→`components/WorkbenchNotifications.vue:17`→`nb-ui/src/components/feedback/NotificationStack.vue:52-58`→`Notification.vue:59-60` 原样插值，locale 只改 title。前：同链 `notifications.ts`→`Notification.vue:60`、`NotificationStack.vue:58`。后：`CommandService.execute`；测试调用 `src/server/testing/test-plugins.ts:148-149`；**生产的模型命令工具消费者：未追到** | 大多中文；when reason 可按 locale 出中／英；前：同一字段下写死中文、按显示语言的双语、公开状态求值本地化三种（见前端 N0.2）；通知标题双语；用户：是（警告通知，自动消失）；模型：无（本通知否） | 结果与审计 listener 自身不落盘；异常诊断走 `B-DIAG-JSONL`；Spec 规划的全量命令审计持久化未见实现；stale-target 不弹；前：`invalid-args` 的 reason 夹着校验失败字段说明（registry.ts:312） |
| 命令不可用原因（禁用提示） | —（`B-COMMAND-RESULT` 注：when reason 可按 locale） | `FC-10` | 前：`commands/shared/registry.ts:188-201,264-270`；公开状态 reason 在 `commands/shared/plugin.ts:59-67` 按显示语言求值（声明 `workbench/web/state/public-state.ts:19-27`、`editor/web/state.ts:19-39`、`html-preview/web/plugin.ts:43`） | 前：`LocalizedText` 求值时用当前显示语言取字符串（不留双语）；多个键的原因以“；”连接（registry.ts:201） | 前：`workbench/web/titlebar/titlebar-source.ts:95,153`、`editor/web/tab-menu.ts:113`、`editor/web/title-actions.ts:88`、`workbench/web/components/WorkbenchShell.vue:133`（title 提示） | 双语（按显示语言）；键未登记时中文（`context-keys.ts:39`）；用户：是（悬停提示）；模型：无 | 否；语言切换后已缓存字符串不会重取：**未验证** |
| 资源管理器“打开失败” | — | `FC-11` | 前：`explorer/web/controller.ts:350`（执行 `nbook.editor.open` 失败） | 前：保留 reason；`unknown-command` 另归 `editor-missing` | 前：`explorer/web/feedback-text.ts:48-51` `openFailed` 双语框架，`{reason}` 填命令 reason | 混合；用户：是；模型：无 | 否；命令 reason 语言见命令失败行 |
| 书架命令失败 | — | `FC-12` | 前：`projects/web/plugin.ts:136`（`` `${code}：${reason}` ``） | 前：码与句子拼成一串 | 前：`projects/web/shelf-page.ts:423` 通知 `commandFailed` | 混合；用户：是；模型：无 | 否；把码当文案一部分显示 |
| 编辑器动作结果 | — | `FC-13` | 前：`editor/web/area.ts:531-907`（约 50 个返回点，中文句子） | 前：`fromAction` 一律归 `unavailable`（`editor/web/commands.ts:137-138`）；`refusal()` 把“当前视图／目标组”拼进句子（area.ts:510） | 前：命令通道（命令失败行）；`tab-menu.ts:42,99,150`、`editor/web/plugin.ts:154,169,193,217` 记诊断；`EditorGroup.vue:143` | 中文（少数英文码，如 `result.code` 直接当 reason：area.ts:890,895,907）；用户：经命令通道；模型：无 | 否；失败、取消、位置没变全靠句子 |
| 设置写入失败 | `B-SETTINGS-WRITE` | `FC-20` | 后：`settings/shared/layers.ts:119-142`；`backend/layer-owner.ts:198-249`。前：对侧 `settings/shared/layers.ts:120-142`、`settings/backend/*`（未逐个追）；前端 `settings/web/window-source.ts:82-85`（`no-project`，中文 detail） | 后：`backend/owner-link.ts:67-77` 包 `settings-failed.detail.{code,detail,position?}`；`shared/remote-link.ts:99-141` 路由 invalid-input→invalid-value、provider-error→write-failed、其它→unavailable，原路由 cause **变成句子**；`shared/instance.ts:249-260`。前：`ui/settings/SettingsRow.vue:130` 发 `write-failed {action,code,detail}`→`settings-window.ts:801,811`→`notifyFailure`（:454-466）：`settingsFailureText(code,detail,locale)` 把七个码换成双语句子，其余写 `码：detail` | 后：`src/ui/settings/setting-text.ts:24-45`（write-failed／invalid-value／default 仍插 detail）；`settings/web/settings-window.ts:460-466,800-811`；`SettingsFileView.vue:240-249,357`。前：workbench 通知（`options.notify`，settings-window.ts:463,466） | 中文 detail + 中英外壳；前：双语（回退时混合）；用户：是；模型：无 | 设置文件存实际 JSONC 文本，不存失败消息；diagnostics `settings.write` 记录 code；合同 2；旧文件重新解析，不迁移错误文本；unknown-outcome 有专门用户说明；前：这是第二处按码取文案 |
| 设置文件视图保存失败 | `B-SETTINGS-WRITE`、`B-SETTINGS-INVALID` | `FC-21` | 后：`settings/shared/layer-text.ts:101-135`；前：对侧 `layer-text.ts:99-135`（语法错误文字来自 `PARSE_ERRORS`）、`layers.ts:43` | 前：`invalid-text` 把 detail 与 `position.line/column` 拼进双语框架（`SettingsFileView.vue:61,240-241`）；其余码走 `settingsFailureText`（:249,275） | 后：`SettingsFileView.vue:240-249,338-339,357` 显示。前：`SettingsFileView.vue:350-358`；标题区 `SettingsWindow.vue:91-96`、`SettingsSectionHeading.vue:75` | 混合；用户：是；模型：无 | 设置文件本身是用户数据，文字不落盘；位置已结构化但 reason 句子仍中文 |
| 设置层 invalid 快照 | `B-SETTINGS-INVALID` | `FC-22` | 后：`settings/shared/layer-text.ts:101-135` 将 jsonc-parser 枚举**先译中文**，根类型／重复键亦中文；`backend/layer-file.ts:46-52` 读取失败。前：对侧 `layer-text.ts:99-135`、`layers.ts:54-63,93` | 后：`layer-text.ts:121-122` 拼“第 N 行”；`backend/layer-owner.ts:142-164` invalid 保留上次 values/problems；`owner-link.ts:47-52,76-77` snapshot 原样；`remote-link.ts:108-111` 冻结保留；`instance.ts:292-293` 层状态保留 reason/position/path，单项 inspect（`instance.ts:218-219`）**只留 detail/value**。前：保留 reason、detail、position（`settings-window.ts:505`） | 后：`settings/web/settings-window.ts:503-507`→`SettingsWindow.vue:90-93` `reason ?? detail`；`SettingsFileView.vue:124-125,338-339` 读失败 detail。前：`SettingsWindow.vue:91-96`→层警告与提示 | 中文；前：混合；用户：是；模型：无 | invalid 是内存快照，不单独落盘；坏 JSONC 文件保留原样；打开／重载重算；读取失败没有 parse reason/position，不能都按语法错误投影；写入一律被拒（状态型拒绝） |
| 插件入口交付状态（设置页、视图、插件页） | `B-PLUGIN-CODE-BROWSER`（消费侧提及 `sections.ts:53-55`、`SettingsPageFrame.vue:81-90`） | `FC-23`、`FC-24`、（`FC-25` 的入口部分） | 前：对侧 nb-runtime `EntryState`；前端 `settings/web/sections.ts:52-56,113-126,141-152,195-196`；`workbench/web/views/registry.ts:49-52,89-100,139-140`；`choices.ts:52-55` | 前：`entryReason` 取 `blocked.reason：blocked.key` 或 `failure.error.message` 或 `failure.reason` 或 `status`（四份拷贝：`sections.ts:52-56`、`choices.ts:52-55`、`views/registry.ts:49-52`、对侧 `plugin-platform/shared/problems.ts:31` 写进 `PluginProblem.message`） | 前：`settings/web/components/SettingsPageFrame.vue:81-87` 双语框架 `{reason}`；`choices.ts:144-149,177-178`；`WorkbenchViewFrame.vue:97-108`；视图加载失败 `WorkbenchViewInstances.vue:138`（`error.message`）；`PluginsPage.vue:197` | 混合；用户：是；模型：无 | 否；FC-23 内含 `触发 X 被拒（reason）` 中文拼接（`sections.ts:150,152`） |
| 插件安装、管理、未加载 | `B-PLUGINS-INSTALL`、`B-PLUGINS-NOTLOADED` | `FC-25` | 后：`plugin-platform/backend/version-dir.ts:50-75`、`nb-runtime/plugin-manifest/read.ts:46-75,95-99,170`、`inventory.ts:190-191,233-235,275-282`；`plugin-platform/backend/startup.ts:280-302`（safe-mode/manifest-invalid/incompatible-engine/entry-missing/unreadable）、:137-147。前：对侧 `plugin-platform/backend/inventory.ts`、`problems.ts:14-33`（`message: state.failure.error?.message`） | 后：version-dir.ts:68-73 `.problems[].{path,message}` **压成字符串列表**、detail 只带首条与余数；`plugins/plugins/backend/plugin.ts:21-29,43-47` 包 detail 对象；远程 `nbook.plugins/registry` 4；`inventory.ts:138-139,311-321` 保留 notLoaded；`server/start.ts:401-405` 发布到实例状态。前：`FAILURE_TEXT` 表为每个业务码给双语句子（`PluginsPage.vue:96-108`），`DETAIL_CODES` 才附服务端 detail（:111）；`notLoaded.detail` 直接显示（:435）；`problemLine` 把激活错误 message、拒绝 detail 原样接上（:197-200） | 后：`PluginsPage.vue:208-215`、:92-111、:81-86,191-200,430-437；`src/cli/plugin.ts:91-93,120-123`。前：`PluginsPage.vue:405,414,435,437` | 中文 + TypeBox／第三方英文；前：混合；用户：是；模型：CLI 被外部 Agent 调用时可见，自动上下文接线未追到 | `nbook.plugins/v1` 登记表只存版本／启停／pending，不存失败；notLoaded 为每次启动快照；坏表拒绝写；前：第三处按码取文案；`detail` 与 `problems[]` 原样露出 |
| 服务端插件代码装载 | `B-PLUGIN-CODE-SERVER` | —（前端必查 5d 未追到，见第 7 节） | 后：`plugin-platform/backend/loader.ts:103-139` | 后：`PluginCodeError`（shared/plugin-code-error.ts:22-29）拼 code/插件／入口／url 到 message、部分路径保留 cause；`runtime/lifecycle/scope.ts:69-84` **摘要只 name/message，code/url/cause 丢失**；`problems.ts:30-31` 只取 message | 后：inventory→plugins list→`PluginsPage.vue:191-200,437`；`plugins.diagnostic` 诊断；`loader.test.ts:106-108,162-163` 用 message 包含码断言 | 中文 + 第三方英文；用户：是；模型：未追到 | 不单独持久化，诊断 JSONL 留摘要 |
| 浏览器插件代码装载 | `B-PLUGIN-CODE-BROWSER` | —（前端必查 5d 未追到）；前端相关 `FC-06`（启动失败入口拼接）、`FC-36` | 后：`plugin-platform/web/plugin-code.ts:194-206,233-250` | 后：:219-220 LoadFailure→PluginCodeError；:246-247 工厂抛错**只拼 message，没传 cause**（hostModules 分支 :234 有 cause）；之后同上摘要；`web/host/window-plugins.ts:49-55` retry 失败取 error.message／reason | 后：`PluginsPage.vue:157-159,191-200,437`；`settings/web/sections.ts:53-55`／`SettingsPageFrame.vue:81-90` | 中文 + 浏览器／插件英文；用户：是；模型：未追到 | 无持久化，浏览器 diagnostics console 保留当时文字 |
| Storage 损坏、版本、写失败 | `B-STORAGE-STATE` | `FC-26`、`FC-27` | 后：`storage/backend/partition.ts:314-329`（corrupt/unsupported-version）、:361-366（busy/io-error）、:299-300（库格式不支持）。前：对侧存储提供者；前端 `layout-store.ts:99-107`；`storage/web/plugin.ts:35`（`no-project`，中文 detail） | 后：`owner.ts:88-90` read 的错误放**成功远程值** `{status:error,code,detail}`；写失败 owner.ts:52 包 storage-failed；`shared/remote-route.ts:26-30,52-69` 拆包／折算；`shared/facade.ts:74-81`；`src/shared/storage.ts:201-215` update 保护态原样返回。前：保存失败→`unsaved`，读不出来或 corrupt／unsupported-version→`unread` | 后：`src/shared/store/persisted.ts:246-277,387-399` **detail 丢失，仅 code/状态留下**；`problem.ts:14-17`；`explorer/web/components/FilesExplorerView.vue:95-98`、`editor/web/session.ts:85-87`。前：`WorkbenchStatusBar.vue:55-72`：`REASONS` 表只覆盖 `unavailable/conflict/unknown-outcome/io-error/corrupt/unsupported-version/provider-stopped` 七个，其余码（`storage.ts:139-154` 另有 `invalid-value/too-large/protected/originals-full/definition-conflict/no-client/no-project/invalid-resource/denied/busy`）显示裸码 | 中文 detail／SQLite 原文混合；前：双语，回退为英文裸码；用户：是；模型：未追到 | 分区 SQLite `meta.format=1`（partition.ts:25,212-215）；records.version 为插件记录版本，坏原文留 records；reset 前把原件进 originals（241-249）；不支持库格式→io-error，不改库；无错误文案迁移器；前：布局记录落盘、文字不落盘；第四处按码取文案；FC-27 调用方的用户可见去处未追到 |
| Storage 订阅结束与服务释放 | `B-STORAGE-END` | —（前端必查 7b 未追到；见第 4 节不一致） | 后：`storage/backend/owner.ts:134-138` provider-stopped；`shared/facade.ts:116-129` released；远程终态见订阅结束行 | 后：`remote-route.ts:39-42` 保留 onEnd；facade.ts:84-90 至多一次；`persisted.ts:258-260,292-295` 把 reason 写 failure.code、暂停队首；detail 不存在 | 后：`shared/store/problem.ts:14-17`；`explorer/web/components/FilesExplorerView.vue:95-98`；`explorer/web/preferences.ts:85-87` reopen／retry | 英文码；用户：是，间接状态；模型：未追到 | 不落错误文字；订阅结束不是损坏，不应给重置按钮来“修复” |
| Store 保存失败 | `B-STORE-FAILURE` | `FC-26`（布局投影） | 后：`src/shared/store/persisted.ts:351-352,374-405`；`store.ts` 的 StoreStoppedError | 后：error→diagnostics report，状态只留 save.state/code；problem.ts:14-17 读取优先、保护次之、未保存最后；unknown 保留 pending.value/expect 核对，非 failed 的别名 | 后：`FilesExplorerView.vue:95-98`、`preferences.ts:85-87`；Editor session 就绪消费者 | 中文异常 + 英文码；用户：是；模型：未追到 | 只是进程内投影，无独立持久错误；存储版本如 Storage 行 |
| 项目与书架业务 | `B-PROJECTS-BUSINESS` | `FC-28`、`FC-29` | 后：`server/projects/manager.ts:275-330`；`plugins/projects/backend/plugin.ts`。前：对侧 `plugins/projects/backend/*`（未逐个追）；合同 `projects/shared/contracts.ts:162,203-244`；`projects/web/browse.ts:20-29` | 后：`projects/shared/contracts.ts:158-258` register-failed 包 `.detail.reason/.detail.detail`；`projects/web/messages.ts:113-115` 未认识的码用同一 code/detail 给两种语言；`shelf-page.ts:314-341` 对部分成功／unknown-outcome 核对。前：`failureReason` 码表（`messages.ts:97-117`，七个码，其余 `码：detail`）；register-failed 的 reason 走 `FAILURES` 表（`messages.ts:39-48`）；`invalid-metadata`／`write-failed` 把 `detail.detail` 填进 `createInvalid`、`createWriteFailed`（`shelf-page.ts:314-325,350-352`）；FC-29 `failureReason`→`LocalizedText`→`localize` 成字符串再塞进 `{ok:false,message}` | 后：`shelf-page.ts:318-327,350-361,370-378`；`components/BookshelfHost.vue:112-113,150-151`；`browse.ts:26-29`→`PathPickerDialog.vue:99-100`。前：`shelf-page.ts`→通知与表单字段旁（BookshelfHost.vue）；`PathPickerDialog.vue` | 中英外壳 + 中文 detail；前：混合；FC-29 双语；用户：是；模型：未追到 | 项目登记与身份文件存领域数据，无错误文案；旧文件读取失败是 registry-invalid／identity-invalid；部分目录已创建的失败带 path；前：第五处按码取文案；FC-29 在生产处已本地化成字符串，换语言要重取 |
| 封面 HTTP | `B-HTTP-COVER` | `FC-30` | 后：`projects/backend/cover-routes.ts:42,60-89,115-122,143-144`，含 bodyLimit 中间件 :70-73 | 后：顶层 `{code,detail}`；上传解析／文件写失败把外部 message 拼进 detail；`projects/web/plugin.ts:196-198,205-217` 读顶层并保留，网络异常另归 network；`shelf-page.ts:159,262` 交 failureReason。前：保留服务端 `{code,detail}`，无 body 时用 HTTP 状态与 statusText，网络错误造 `network`（`projects/web/plugin.ts:195-219`） | 后：`shelf-page.ts:350-361,370-378`；`BookshelfHost.vue:112-113,150-151`。前：`shelf-page.ts:370-371`（`result.detail === "" ? result.code : result.detail`） | 中文 detail + 中英外壳；用户：是；模型：否 | 无持久错误；GET no-cover 是内容缺席；前：服务端错误体生产者在 `src/server/*`，前端标未追到（后端已追到本行） |
| HTTP 宿主错误体 | `B-HTTP-HOST` | —（前端必查 9c 未追到） | 后：`plugins/http/backend/admission.ts:22-32`；`dispatch.ts:75-78,87,95,102,110,117,127,133,144` | 后：dispatch.ts:221-222 统一 `{error:{code,message}}`；异常原文进 reportError，用户体只给固定中文；:181-218 包装正文并释放票据；`server/rpc/listener.ts:45-46` 升级拒绝体 | 后：HTTP 调用者；封面 fetch 消费者 `projects/web/plugin.ts:196-198` 只读顶层 code/detail，**读不到这个 error 外壳**；其它通用错误体的产品 reader 未追到 | 中文；用户：经具体 HTTP reader，封面路径丢正文后只剩状态；模型：无自动接线 | 无错误体版本／持久化；状态码 421/403/503/404/500 与 code 一起有意义；插件自己的路由可返回不同形状 |
| 文件业务（单项、批量、清单） | `B-FILES-BUSINESS` | `FC-14`、`FC-15`、`FC-17`、`FC-18` | 后：`plugins/files/backend/files-service.ts:73-94,149-178`。前：对侧提供者（`plugins/files/backend/*`，未逐个追）；前端 `files/web/client.ts:71,271,292,299,307-313`；`controller.ts:478`；FC-17 `editor/web/components/EditorBreadcrumbs.vue:72-75`；FC-18 `editor/web/pages.ts:37`、`MonacoControl.vue:271`、`markdown/web/plugin.ts:42` | 后：files-service.ts:74-75 OS cause 只进 diagnose，安全 detail 包对象；`files/web/client.ts:307-313` 业务 `.detail.detail` **展平**、路由 cause 保留；`editor/web/documents/store.ts:307-319,593-602` 改为 DocumentProblem，unknown-outcome 记快照核对。前：`store.ts:308-318,570,602-610` 把 code/detail 存进 `failure`、`saveProblem`；资源管理器 `codes` 表把七个码换成双语说明，不认识的写 `` `${code}：${detail}` ``（`feedback-text.ts:27-44`），命名冲突归 conflict，其余当 `NameError.detail`（`controller.ts:509`）；FC-17 成功／失败联合，失败时 reason 当菜单项文字；FC-18 保留异常 message | 后：`EditorGroup.vue:186-198,326-327`；`explorer/web/controller.ts:456-478`→`feedback-text.ts:52-55,80-81`；`ExplorerRow.vue:111-113` tooltip。前：`EditorGroup.vue:183-198`（`not-text`、`unknown-outcome` 单独文字，其余 `detail \|\| code` 填进双语框架 `openFailed/saveFailed/ended`）、:143 回给命令层；`ExplorerFeedback.vue`、`ExplorerRow.vue`、`FilesExplorerView.vue`；`EditorBreadcrumbs.vue:127`；`pageFailed` 双语框架 | 中文安全说明 + 第三方诊断英文（不返回 OS 原文）；前：混合；用户：是；模型：未追到 | wire 4 + 业务 v5；不存失败；批量 partial/manifests/truncated 在成功值里也是失败文字通道；前：FC-15 是仓库里最接近“按码取文案”的一处；FC-17 的 `BreadcrumbListing` 实现未追到；FC-18 无独立域 |
| 文件原始字节与预览 HTTP | `B-FILES-RAW-HTTP` | `FC-31` | 后：`plugins/files/backend/raw-route.ts:137-146,170-190,211-242`。前：`html-preview/web/plugin.ts:88-98`、`image-viewer/web/components/ImageViewer.vue:59,77,123` | 后：raw-route.ts:66-68 把未在特定状态表中的码**统一 not-found／404**，detail 改名 message；预览 open 失败 :230-235 统一 not-found；`{error:{code,message}}`。前：路由失败码折成三个 `denial`；日志另记 `申请预览令牌失败：${code}`（`plugin.ts:91`） | 后：`ImageViewer.vue:55-59,85-91` **不读 JSON 失败体**，按 HTTP 状态取双语文案；:119-124 网络异常才原样插 error.message。前：`HtmlPreview.vue:20`、`ImageViewer.vue:20` 双语表 | 中文安全 detail；前：双语；用户：是；模型：否 | 不存错误，token 不落盘；安全隐藏的 not-found 是有意折算 |

### 3.3 宿主进程、CLI、脚本

| 合并通道 | 后端 ID | 前端 ID | 生产者 | 逐跳转换 | 消费者 | 语言；用户；模型 | 持久化；旧数据；备注 |
|---|---|---|---|---|---|---|---|
| 项目子进程启动与 IPC | `B-PROJECT-IPC` | —（前端必查 8：无） | 后：`packages/neuro-book/src/project/start.ts:115-118,148-156`；`src/server/projects/ipc.ts:18-29` | 后：ipc.ts:34-50 校验 started，failed 只保留 detail；manager.ts:531-538 转 started promise；:457-463 再包普通 Error 并附强制停止说明，原失败 stage/code/结构参数不进入信封；`nb-runtime/src/application/children.ts:244-255` create 异常先摘 message，再 :151-152 返回 create-failed/detail；`manager.ts:237-238` 原 reason/detail 返回 acquire 调用方；window bind 通过 reject.message 进入握手行 | 后：manager.ts 的创建调用方；`manager.ts:482,534,550-566` 诊断；应用启动失败到紧急输出行；业务 acquire 失败进入项目业务行 | 中文为主；用户：间接；模型：未追到 | Bun IPC serialization=json，无控制信封版本；不存失败；wire 4 只约束 frame 内部，不约束 started.detail；不存在“把所有项目创建失败都当业务远程 error 帧”的保证 |
| 项目子进程输出转发 | `B-PROJECT-OUTPUT` | — | 后：子进程 stdout/stderr；`server/projects/manager.ts:489-504` 设 pipe | 后：manager.ts:144-157 TextDecoder 解码、按行切分、每行加 `[project 名#代次]`，尾部补 LF；:516-518 分两路转发，异常记 project.output.failed；不解析 JSON、不抽取错误码 | 后：process.stdout/stderr（manager.ts:516）或注入 output；最终 CLI 操作者／外层收集器 | 混合，子进程原文；用户：开发终端；模型：不自动注入 | 不保证自身落盘；转发后的行不再是裸 JSONL，不能直接当诊断或会话行解析 |
| nbook CLI 输出 | `B-CLI-NBOOK` | —（前端必查 16a：无） | 后：`neuro-book/src/cli/main.ts:108-128,135-148`、`plugin.ts:89-93`；`output.ts:8-17` CliFailure | 后：main.ts 按 CommanderError.code 分支，原文只提取引号内参数／建议；`output.ts:32-36` JSON stdout `{ok:false,code,message,...fields}`，人类 stderr `nbook：message`；fields 原样展开；未知异常 main.ts:146 原样抛出 | 后：CLI 操作者、脚本；无产品 UI 消费者；JSON 可供外部 Agent；仓库内自动读回模型未追到 | 人类与 JSON 都中文为主，第三方混英文；用户：是；模型：外部调用可见 | 无 schema／version，无自动存储；start 可透传服务退出码，stderr hint 即使 `--json` 仍有 |
| CLI 插件日志 | `B-CLI-PLUGIN-LOG` | — | 后：`neuro-book/src/cli/plugin.ts:52-64` 独立 recorder | 后：:57 **绕开 runtime diagnostics store**，展开 DiagnosticInput，Error 压成 name/message，不带 stack/cause/code，不做 store 的脱敏／有界收敛；:59-61 串行 mkdir/appendFile，失败只 output.hint 中文提示 | 后：`<stateRoot>/logs/cli.jsonl`；hint 经 output.ts:33 stderr；产品日志 reader 未追到 | 中文／第三方原文混合；用户：开发终端／读日志；模型：无自动接线 | JSONL，无行 schema、无轮转或旧读迁移；不能用诊断 JSONL 的安全与兼容结论套它 |
| 作者 CLI 构建与脚手架 | `B-CLI-SDK` | —（前端必查 16a：无；`FC-36` 为定义期错误，另行） | 后：`neuro-book/src/plugin-platform/build/build-plugin.ts:112-124`；`plugin-sdk/cli.ts:32,58,74`；create-plugin | 后：cli.ts:75-94 按 PluginBuildError/PluginCreateError/UsageError/Node code/syscall 分类；build summary 后逐条列 problems.path/message；非已知异常重新抛；:63 警告走 stderr | 后：`nbooke` 作者 CLI 的 console.error；:17-19,24 帮助到 stdout；无 `--json` 实现 | 中文 + Node/Bun/构建器英文；用户：作者；模型：外部调用可见 | 无持久化或错误 schema |
| 开发服务端宿主 | `B-DEV-HOST` | — | 后：`neuro-book/src/server/dev/frontend.ts:75-79`；`backend-process.ts:97-101`；`sample.ts:45,71,81,95-98,227-228` | 后：前端代理回 `{error:{code:backend-unavailable/stopping,message}}`；样例失败**将取消与一般失败都压到 reason:string**，报告行 `[dev] sample-failed ...`；`nbdev/dev/dev-ops.ts:44-45` 再发 DevEvent；`server/development-main.ts:19-20` console.log；`dev-panel/src/dev/ready.ts:77-105` 解析英文状态前缀、保留后面的 reason；`dev/sample.ts:43-46,55-61,101-122` | 后：HTTP 读者同宿主错误体行；`cli/dev-commands.ts:34-40,161` 人读或 NDJSON | 中文；用户：开发者；模型：外部调用可见 | 开发服务输出由 nbdev `.log` 收集；不属于产品诊断 schema；只按 `[dev] sample-failed` 稳定标记分支，不按中文原因分支；样例取消码只剩句子 |
| 脚本证据 | `B-SCRIPT-EVIDENCE` | — | 后：`neuro-book/scripts/page-shot.ts:349-351,372-379`；`scripts/check-dist.ts:130-134`；`pack-app.ts:65-87,170-178`；`smoke-server.ts:335` | 后：page-shot.ts:384 写 report.json（`.error/.problems[]/.hostReason`，messageOf 展平异常）；:405 人类 stderr 只错误首行；`dev-panel/src/dev/shot.ts:55-66` 收 stderr 最后 4000 字符再取末 10 行包 shot_failed，details 保留 exitCode/outDir/files；smoke JSON schema=`nbook.smoke/server/v1` | 后：`dev-panel/src/dev/shot.ts` 运行 page-shot；开发者／Task 证据读者 | 中文 + 浏览器／构建器英文；用户：开发者；模型：Agent 读证据可见，不自动恢复模型上下文 | 运行者指定目录 report.json／failure.png；Task 证据按普通文件保留，无错误码迁移；后端只读未运行 |

### 3.4 工具、Agent、会话、剧情

| 合并通道 | 后端 ID | 前端 ID | 生产者 | 逐跳转换 | 消费者 | 语言；用户；模型 | 持久化；旧数据；备注 |
|---|---|---|---|---|---|---|---|
| 内置工具失败 | `B-TOOLS-BUILTIN` | `FC-40`（前端不区分三类） | 后：`nb-harness/src/tools/read.ts:46-47,106-109,138-143`；`edit.ts:37-45,111-137` | 后：builtin.ts:38-59 登记；edit.ts:125-131 **保留 OMP outcome.text/isError/files/warnings**，未捕获异常直接向外；bridge.ts:41-79 仅透传／竞态撤回，不统一补码。前：`isError` 为真时 `error = text`；`details` 另存 `result.details`（`nb-agent-ui/src/harness.ts:229-235,365-369`） | 后：OMP Agent，之后 `harness.ts:259-295` 入 agent_message 与事件；`nb-agent-ui/src/harness.ts:205-238,277-286`。前：`vue/tools/AgentToolDetail.vue:33`（原文，details 在 :58-60 以 JSON 显示）；`AgentRawView.vue:154` | 本地包装中文，原生编辑引擎英文原样；前：OMP 原生英文、领域工具中文；用户：工具卡；模型：是（前端：本通道文字本来就是给模型读的） | 经会话 JSONL；无统一 details.code；前：日志是权威；用户看到的是模型读到的同一段文字，无按码取文案层 |
| 领域工具失败 | `B-TOOLS-DOMAIN` | `FC-40` | 后：`nb-story/src/qa/tools.ts:101-114,137-143` | 后：tools.ts:72-74 只 `{content:[{text}],isError?}`；查询 **code/candidates 展成文字、丢独立结构码**，answer 问题只有字符串；chapter_limit 被有意当普通结果而非 isError；engine.ts:313-314 登记 | 后：`harness.ts:216-232/282-295` 已写历史；QA 进度 `engine.ts:364-368`；工具卡经 SSE／权威日志 | 中文（与 CLI formatResult 共用）；用户：是；模型：是 | 经会话 JSONL + QA 记录；当前领域工具失败无 details.code |
| 中性拒绝（章数上限）的投影 | `B-TOOLS-REFUSED-PROJECTION` | —（前端报告未列；后端追到的消费者在前端分区文件 `nb-story/src/web/qa/tools.ts`） | 后：`nb-story/src/qa/read-ledger.ts:90-96` 给 chapter_limit + 中文 reason；`qa/tools.ts:105-107` **丢 code，isError=false** | 后：tool text 经完整日志／临时事件；`nb-story/src/web/qa/tools.ts:20-22` **按 `result.text.startsWith("没有读：")` 分支**；:30,37 决定摘要与章数 | 后：同文件 readSummary／chaptersPhrase（:25-44）；问答工具卡 | 中文；用户：是；模型：模型仍读中文正常结果 | 随会话 JSONL；旧文字前缀是当前回放行为依赖 |
| 第三方工具与撤回 | `B-TOOLS-THIRDPARTY` | `FC-40` | 后：`nb-harness/src/tools/registry.ts:11-55`；撤回由 `bridge.ts:17-19` 生产 | 后：bridge.ts:50-79 透传实现结果／异常；撤回给 `.details.{code:plugin-unavailable,tool,interrupted}`，中止执行信号，迟到结果舍弃；harness.ts:272-280 对不可 JSON 化的工具消息改 local 运行失败 | 后：OMP Agent；日志／事件消费者同上；第三方异常转工具结果的细节在外部 OMP 包，**本仓库源码中的转换实现未追到** | 实现自定；撤回中文；用户：工具卡；模型：是 | 可 JSON 化的 message 原样入会话；工具声明快照按 exact 相等恢复，改 description 也可能 session_incompatible |
| 运行结果 → 会话 JSONL → 界面 | `B-HARNESS-RUN`、`B-SESSION-JSONL`（`B-HARNESS-COMPLETE` 不在这条链上，见下一行） | `FC-39` | 后：`nb-harness/src/harness.ts:146-156,228-235,272-296,328-370`；`run-result.ts:50-63`；`nb-session/src/entries.ts:53-74,124-129`；`complete.ts:27-34,41-50,67-79`。前：对侧 nb-session 日志 `run_end.error.kind` | 后：harness.ts:259-264 在事件／归类／落日志前遮盖密钥；run-result.ts 按状态／flags 分 kind，不按 message；:310-324 形成 TurnResult，run_end 写失败**把原错误压进新 local.message**；`jsonl-log.ts:73-84` 编号／时间戳后 JSON.stringify；`entries.ts:136-184` 读时仅外层形状校验；`jsonl-log.ts:12-27,75-76,99-107` 坏行／中断尾／repair；complete() 不写 session.log，ProfileError→HarnessError 保留 code/message、details 再包。前：`kind`→消息键（`nb-agent-ui/src/harness.ts:104-111`），`error.message` 与其它字段丢失；`retryable` 由 kind 决定 | 后：`nb-story/qa/engine.ts:341-353`→model_failed/no_answer/answered/interrupted；`nb-agent-ui/src/harness.ts:261-285`（run_end 归类文案，kind→ERROR_KEYS→agentText；日志工具结果 :215-236 保留 message.details）。complete() 实际出口：`nb-story/src/cli/config.ts:295-313`、`server/qa-service.ts:521-535`→`web/shell/SettingsPage.vue:288-290,398-400`（归 B-HARNESS-RUN，内存日志不落盘；**complete() 产品消费者未追到**）。前：`AgentTurnBlock.vue:170`（`data-error` 段落）、`AgentRawView.vue:160` | 中文默认诊断 + 第三方原文；前：双语（`messages.ts:189-195`、`389-395`）；用户：经 UI 本地化或 QA 降级；模型：agent_message 原样恢复，run_end 不直接进模型 | `<root>/<sessionId>.jsonl`，无 format/schema 版本；旧 message／tool_call／tool_result 可读，缺 session_snapshot 不能 harness 续跑；前：日志是权威，旧日志 kind 不认识按 `local`；与决策 2 一致；`problems()` 无产品调用方（`harness.ts:25-28,141-142`）；前端 FC-41 宿主给的历史加载失败：仓库内无产品生产者，`vue/AgentConversationView.vue:265` |
| `complete()` 库调用 | `B-HARNESS-COMPLETE` | — | 后：`nb-harness/src/complete.ts:27-34,41-50,67-79` | 不写会话日志；`ProfileError → HarnessError` 是合同事实 | 产品消费者未追到（后端终轮更正：`nb-story/src/qa/probe.ts` 用的是 `createHarness`/`harness.turn`，归 `B-HARNESS-RUN`） | 合并核对时据实现审查第 1 条拆出 |
| SSE、权威日志补发、QA 实时 | `B-AGENT-SSE`、`B-AGENT-LOG-REPLAY` | `FC-45` | 后：`harness.ts:259-264,399-404`；`nb-story/src/qa/engine.ts:360-368,249-260,317`。前：对侧 SSE 帧 `QaFrame`（`nb-story/src/contract/contract.ts:777-781`） | 后：`qa/web-events.ts:25-45` 仅 assistant message、工具 start/end；工具 end 只留文字、**截到 500 字，丢 details**；`server/qa-service.ts:149-172` 合并／节流 message_update；`server/http.ts:175-182` `data:` 帧，慢订阅关闭；qa-service.ts:175-179 projection 后发 log，:566-576 重连 snapshot 带未保存 entries，:187 保存成功清内存 entries，`qa.get` :379-388 从权威 JSONL 补发（`nb-harness/sse.ts:42-58` 不是该 HTTP 路径）。前：`web/host/client.ts:55-100` 解析；snapshot／log 帧条目喂 `applyLogEntry`，event 帧喂 `applyEvent`（`source.ts:172-200`）；日志为准，晚到事件不覆盖（`harness.ts:359`） | 后：`nb-story/src/web/host/client.ts:79-99`；`nb-agent-ui/src/harness.ts:277-286`；`web/qa/source.ts:184-195,242-247`、:127 日志不可用走 messagesFromRecord。前：转录适配器→助手运行出错行、工具失败行；`run.saved`→`QaPage.vue:472` | 中文／英文／模型原文混合；前：同助手运行行；`saved.reason` 码被本地换成三种中文句子，其余写 `message ?? reason`；用户：是；模型：SSE 副本不回灌，日志恢复后 agent_message 是上下文源 | SSE 无独立版本，不持久化；QA 会话日志文件 + record.log.file/sha256；**SSE 丢 details 不能证明权威结果也丢码**；前：帧内容来自落盘的会话日志；订阅断开按 1、2、4…15 秒退避重取 |
| QA 记录与降级回放 | `B-QA-RECORD` | `FC-46` | 后：`nb-story/src/qa/engine.ts:322,341-353,396-419`。前：对侧 `nb-story/src/core/qa-records.ts:71`（`error{code,kind?,message}`）、`qa/engine.ts:322,345,350`（message 中英混合：`${what}：${error.message}`、`error.message`、中文固定句） | 后：`core/qa-records.ts:169-207` 新文件发布日志再发布 JSON record；保存失败不覆盖轮结果；`server/qa-service.ts:192-196` 映射 `.saved.{ok,reason,message?}`；:379-388 读 JSONL；`qa-records.ts:266-276` 日志缺失／坏摘要给 `.problem`。前：丢失，`record-messages.ts:28` 只取 `turn.error?.message ?? "这一轮失败了"`，code／kind 丢掉；`logProblem` 另显示（`qa/source.ts:247`） | 后：正常回放走 SSE／日志补发行；降级 `web/qa/record-messages.ts:17,28` **只消费 error.message，丢 code/kind**；`QaPage.vue:470-472` saved.ok=false 时按少数 reason 映射，write_failed 等回退 `saved.message`／原 reason；:157 损坏记录显示 problem；:346-347 开始失败直接 error.message。前：`AgentTurnBlock.vue:170` | 中文 + Provider 原文；前：混合（持久化 message 可能是英文原错）；用户：是；模型：record.error 不进上下文，续问另读日志 | `<book>/qa/<id>.json`，日志 `<id>.<轮数>-<随机>.session.jsonl`；无显式记录版本；`qa-records.ts:361-397` 兼容旧单轮并包装成 turns[0]，旧日志名 `<id>.session.jsonl`；坏 JSON／字段返回 broken；前：message 随记录存盘（`QaFailureSchema` `qa-record.ts:42`），旧记录只有 message 仍要能读，新增码字段不能破坏 `qa-records.ts:387-397` 校验；与实时路径显示不同 |
| 剧情 HTTP 与页面 | `B-STORY-HTTP` | `FC-43`、`FC-44`、`FC-48` | 后：`core/errors.ts` 的 StoryError；`server/qa-service.ts:552-563`、`ingest-service.ts:154-163` 摘 code/message。前：对侧 `nb-story/src/server/http.ts:96-145,237-261`、`qa-service.ts:562`、`ingest-service.ts:162`；FC-44 `web/qa/source.ts:226-233`；FC-48 `shell/ProviderDialog.vue:129-144,202`、`shell/SettingsPage.vue:73,267-290` | 后：`server/http.ts:111-145` 根据 code 选 HTTP 状态，**顶层 `{code,message,candidates?}`**；unexpected error 诊断后固定 internal 中文；:237-262 会话／路由／顶层异常另生产文本。前：`client.ts:120-123` 变成 `StoryCallError`，网络失败前端造 `network`（:118）；FC-44 `{code,message}` 存进 `state.error`；FC-48 中文框架加异常消息 | 后：`nb-story/src/web/host/client.ts:115-123`→StoryCallError 保留 code/message/candidates；各页面直接 error.message；QA 运行失败还可藏在成功 qa.get 值内。前：46 处 `…message` 绑定到 `PageState/PagedList.error`（`pages/*.vue`、`shell/*.vue`，另 `SearchBox.vue:73`、`BookShell.vue:43`、`LibraryPage.vue:74`）；按码特殊处理只有 `entity_not_found/entity_ambiguous`（`QaPage.vue:75`）、`book_not_found`（`BookShell.vue:38`）、`DrawerCard.vue:74`、`IngestPage.vue:119,156`、`ImportPage.vue:179,217-219`、`SettingsPage.vue:267`；`QaPage.vue:290`（`load-error`，`message ?? "读不到这个对话"`） | 中文 + 校验／外部英文；前：中文，网页没有消息目录，整个应用只有中文；用户：是；模型：CLI Skill／领域工具另行 | 不持久化响应体；独立 HTTP 不走 future nb-story/queries remote contract，不误套 `{error:{...}}` |
| 抽取状态与停止 | `B-INGEST-STATE` | `FC-47` | 后：`nb-story/src/ingest/job.ts:119-129`；`worker.ts:59-62`。前：对侧 `contract.ts:495`；`server/ingest-service.ts:162` | 后：runner.ts:138-154 Worker outcome 原样或 stopRequested 将 failed→stopped；:129 复制 `.code/errorKind/message` 到 stopReason；store.ts:58,176-178 写 state；status.ts:143-145 无锁却 state.running→exited；runner.ts:111-113,131-133 写状态失败只 console.error；`job.ts:243-250` usage.error 保存 `attempt.error?.message ?? null`。前：`web/host/ingest.ts:31-50` 把 kind 与 errorKind 换成中文文案和“下一步” | 后：CLI `ingest.ts:281-286`→fail；server ingest.status→网页抽取界面 `web/shell/IngestPage.vue:209-214`（status.stopReason.message）、:135-156 动作错误取 StoryCallError.message。前：`IngestPage.vue:213` 另显示 stopReason.message 原文 | 中文 + 模型／本机英文；前：中文；用户：是；模型：状态文件不回灌 | `<library>/.ingest/<id>/state.json`（`core/library.ts:140-141`、`ingest/store.ts:89-90`；进度文件无 schema 校验），`usage.jsonl`、`activity.jsonl` 无错误版本，坏行跳过；`activity.jsonl` chapter-end.outcome 是 committed/stopped/failed 枚举；前：有码有本地化，仍并排露出原文 message |
| 抽取校验清单 | `B-INGEST-CHECKLIST` | — | 后：`nb-story/src/ingest/compile.ts:69-79,124-162`；`draft-schema.ts:276-284`；`draft-tools.ts:148-165` | 后：chapter.ts:211-230 **Issue→Problem→message 字符串清单**，reviewTask 后 callModel（:124-136,218）；`job.ts:159` 只取 remaining.message，:173 join 成 IngestBadReply；:178-179 将章节 problems 写 ExtractionData；`status.ts:152-158` 进度投影不带章节 problems；`chapter.ts:112-119` 仅取本章 error、secret-missing warning 与 records 关联本章的全图 error；其它 warning 可由 job.ts 展平保存，不默认进入下一次修复请求 | 后：抽取模型请求；坏回复失败后经抽取状态行；数据文件读者；`IngestPage.vue:46-53,225-227` 不把这组问题画成界面失败 | 中文规则／第三方校验英文；用户：文件读者；模型：是（实际 prompt 输入） | `<book>/extraction-<版本>.json`（`core/library.ts:9-10`；job.ts:178-179）；问题文字原样，未见逐条码迁移；不能把中文 issue 批量替换成英文诊断 |

### 3.5 nbdev

| 合并通道 | 后端 ID | 前端 ID | 生产者 | 逐跳转换 | 消费者 | 语言；用户；模型 | 持久化；旧数据；备注 |
|---|---|---|---|---|---|---|---|
| nbdev CLI 输出 | `B-NBDEV-CLI` | —（前端必查 16b：无） | 后：`dev-panel/src/core/errors.ts:5-119`；`cli/main.ts:283-307` | 后：`cli/output.ts:25-32` 未知错误栈先写 stderr 再包 internal（cause 进程内保留、JSON 丢）；:99-124 JSON `schema/ok/data/warnings/errors[]` 保留 code/message/details；人类 stderr 列明细至多 20，JSON 不截；Node parseArgs 原文在 main.ts:294 包 usage | 后：nbdev CLI 操作者／脚本；开发 Agent 可直接调用 | 中文为主，Node／外部英文；用户：开发者；模型：CLI 操作者为 Agent 时可见 | 普通结果不自动落盘；schema 随命令（nbdev.cli/v1）；目标是英文 CLI + 中文面板 |
| nbdev HTTP errors[] | `B-NBDEV-HTTP` | `FC-49`、`FC-50` | 后：`dev-panel/src/server/writes.ts:36-38,79-100,291-298`；`serve.ts:149-151`。前：`serve.ts:123`、`core/errors.ts:102-118`；FC-50 `web/host/panel-data.ts:235-241` | 后：writes.ts:295 原 NbdevError→`{code,message,details}`，unknown 记栈后固定 internal；serve.ts:122-124 包 `errors[]`，附 schema/instance/revisions；`web/host/api.ts:38-48` 只取首错→ApiError，保留 details/data/warnings。前：`api.ts:43-48` 变成 `ApiError {status,code,message,details,data,warnings}`；网络失败前端造 `network`（:74）；FC-50 `confirmRelogin` 把 401 换成固定中文（:136） | 后：`web/host/writes.ts:26-41` 按码／状态选动作但多分支仍直接 message；:104-108 取 details.problems；:139-145→Notice；`parts/LoadState.vue:43,55`；`parts/CreatePreview.vue:20-21`。前：`writes.ts:20-41`（`describeFailure` 按 `lock_timeout/warming_up/commit_failed/changed_after_write/uncommitted_changes/hash_mismatch` 改写，`status===400` 与其余用 error.message）→`failureNotice`（:100-145）→`WriteResult.vue`；`status-change.ts:45`、`file-edit-session.ts:100-118`；FC-50 `LoadState.vue:43,55`、`App.vue:308,342` | 中文 + 外部原文；用户：面板开发者；模型：HTTP 副本不自动注入 | 不持久化响应；Panel API schema 与命令 schema 独立；`serve.ts:351-355` 安全中间件另回 plain text，前端变 bad_response；前：面板整体保持中文（ADR 0034 后果表）；`writes.ts:132,137` 用 `failure.message` 相等与 `includes` 去重（按文案分支，见前端附录 A.1） |
| nbdev 共用校验 | `B-NBDEV-VALIDATION` | `FC-51` | 后：`dev-panel/src/core/text-rules.ts:14-37`；`questions.ts:54-98`。前：对侧 `core/text-rules.ts:14-26`、`core/questions.ts:83-99`；前端 `NewTaskForm.vue:22-23` 自写一条 | 后：`core/operations.ts:130-133,166-167`→assert；:308-309 预览收成 `{field,code,message}`；`artifact-ops.ts:620-623` 把原因 join 入 invalid_answer；HTTP／CLI 原样消费；浏览器**直接导入** text-rules／questions，不经 HTTP。前：句子直接显示 | 后：`web/parts/AnswerForm.vue:78-86,129`；`NewPage.vue:124`→`CreatePreview.vue:21`。前：`AnswerForm.vue:78-86`、`NewTaskForm.vue`、`NewWorkForm.vue` | 中文；用户：是；模型：CLI 可见 | 校验失败本身无存储；命令行抛 `NbdevError`（`assertTitle`，`text-rules.ts:28-31`）与网页共用同一批句子；文案与 code／参数未分离 |
| nbdev 终端 WebSocket | `B-NBDEV-TERMINAL` | `FC-52` | 后：`dev-panel/src/server/terminal-hub.ts:95-105,269-271,297-314,343-347`。前：`terminal-hub.ts:298` | 后：普通错误 `{t:error,code,message}`；关闭错误 WebSocket code+reason，不是 HTTP errors[]；`web/host/terminal-socket.ts:105-107` 原样存 notice；`session-console.ts:290-293` 转 Notice。前：保留 code、message 转字符串；取值未逐个追 | 后：`web/host/session-console.ts:291`、网页终端与会话控制面板。前：终端面板（`session-console.ts:289-291`） | 中文 + herdr 原文；用户：开发者；模型：错误控制帧不自动注入 | 错误帧不落盘；动作审计另走审计行；WS close reason 与 HTTP 消息是两个读取路径 |
| nbdev 搜索流错误 | `B-NBDEV-SEARCH` | —（前端报告未列） | 后：`dev-panel/src/server/serve.ts:291-307` | 后：:306 诊断原 message，:307 NDJSON `{type:error,message:固定中文}`，**不含稳定码／HTTP errors[]**；:304 aborted／truncated 另属正常结束信息 | 后：`web/pages/SearchPage.vue:55-61` 直接 message；get/search NDJSON reader | 中文；用户：是；模型：CLI find 为结构化成功值可带 checkout.error | 不持久化；server log 经 panel-commands.ts:54 带时间戳 stderr，外层 systemd 可收 journal |
| nbdev 通知记录 | `B-NBDEV-NOTIFY` | — | 后：`dev-panel/src/core/notify.ts:20-44`；`herdr/client.ts:7-16` | 后：notify.ts:194-206 独占写 `{schema:nbdev.notify/v1,...code,message,result}`；:214-235 旧读校验 schema、坏文件跳过带 warning，缺 askerKey 用 sessionKey | 后：`web/host/notify-actions.ts:31-32` 不认识的失败原样显示 message／code，uncertain 专门说明勿重发；通知面板 | 中文／英文混合；用户：开发者；模型：成功答复通知才是独立提示词，失败记录非自动上下文 | `.local/agent/run/notify/*.json`，schema nbdev.notify/v1；只有 intent 没 result 按 uncertain，不等于 failed，不重发 |
| nbdev 审计与开发服务流 | `B-NBDEV-AUDIT`、`B-NBDEV-DEV-STREAM` | — | 后：`core/audit.ts:74-83,97-104`、`server/writes.ts:146-178`；`dev/dev-ops.ts:37-45,310,412-430,466-469` | 后：audit.append 写前核权限／可用性，失败 NbdevError；JSON 行含 schema/at/instance/actionId/phase/action/device/target/detail，detail 为调用方结构；`cli/dev-commands.ts:161-162` JSON 模式一事件一行；`output.ts:111-116` 流结束 warnings 写 stderr；`dev-ops.ts:240-263` 服务 stdout/stderr 直接落文件、登记 logPath；sample_failed.reason 是句子 | 后：audit.jsonl 的开发者／审计工具（旧审计自动展示 reader 未追到）；nbdev dev start 操作者；`dev-commands.ts:188` 展示 state/reason/logPath | detail 可含中文／外部文字；英文 event + 中文 reason／原服务输出；用户：开发者；模型：调用方可见 | `${XDG_CONFIG_HOME:-~/.config}/nbdev/audit.jsonl`，AUDIT_SCHEMA／AUDIT_INIT_SCHEMA；Task 日志 `.local/agent/works/<W>/tasks/<T>/logs/<run>.log`；ProcRecord 有 PROC_SCHEMA；NDJSON 事件无独立错误版本；not_ready 不代表进程失败 |
| Task 证据与测试断言 | `B-TASK-EVIDENCE`、`B-TEST-ASSERTIONS` | 前：必查 19（20 个测试文件候选，命令 C6） | 后：`dev-panel/src/core/task-detail.ts:41-59,81-106`；测试：`neuro-book/src/plugin-platform/backend/loader.test.ts:108,163,176,182`、`nb-harness/tests/read-tool.test.ts:53-54,65-68,77-85`、`nb-session/tests/session-log.test.ts:182,193-195`、`dev-panel/src/core/questions.test.ts:60`；OMP 原生编辑 `tests/edit-tool.test.ts:80,109`、`packages/nb-harness/docs/omp-capabilities.md:107-111,141` | 后：TaskDetail 保留 evidence name/path/size 不解析正文；`server/serve.ts:397-419` 守卫后 Bun.file 原样回字节；README 由 `task-detail.ts:32-38,101` 返回；`TaskPage.vue:47-51` 去 frontmatter／一级标题后渲染。测试用 message 含码／中文片段、toThrow regex 验证路径 | 后：`dev-panel/src/web/pages/TaskPage.vue:239-243,284-286`（“证据文件，原样显示”）、:191 MarkdownView；测试 runner／CI 读者。前：20 个文件在 reason／message／detail 断言里写中文字面量：`nb-agent-ui/src/harness.test.ts`、`harness.contract.test.ts`、`process-summary.test.ts`，`nb-ui/src/components/layout/grid.test.ts`，`nb-story/src/web/qa/turn-transcripts.test.ts`，`neuro-book/src/web/host/window.test.ts`，`plugins/workbench/web/commands/{panel,part,view}-commands.test.ts`，`plugins/workbench/web/views/registry.test.ts`，`plugins/settings/web/{choices,sections}.test.ts` 等 | 内容原语言；中文测试名／中文本地错误／英文原生文本；用户：开发者；模型：Agent 主动读文件才可见 | Task `evidences/` 普通文件，无强制错误 schema；测试本次未运行；前：候选数，未逐个核实断言对象；前端测试与辅助文件 237 个（正文 234 作废） |

### 3.6 基础库与旁路（只有后端有）

| 合并通道 | 后端 ID | 生产者 | 逐跳转换 | 消费者 | 语言；用户；模型 | 持久化；旧数据；备注 |
|---|---|---|---|---|---|---|
| Profile 合同 | `B-PROFILE-CONTRACT` | `nb-profile/src/define.ts:52,71,108-130`；`loader.ts:15-18`；`jsx-runtime.ts:36`；`nodes.ts:81` | `nb-harness/src/harness.ts:84-86,99-103` 只对 ProfileError 换 HarnessError，保留 code/message，details 包入 `.details.details`；QA 续问恢复捕获 HarnessError 改 qa_not_continuable（engine.ts:334-337） | 包调用方；QA 开始失败经剧情 HTTP／CLI | 中文 + TypeBox 英文；用户：经 CLI／HTTP；模型：建立前失败，不直接进上下文 | 不存失败；Profile manifest.version 与 session_snapshot 身份兼容性相关，不是错误版本 |
| nbstory CLI | `B-CLI-STORY` | `nb-story/src/core/api.ts:208-220`；`cli/ask.ts:67-70,107-131`；`ingest.ts:69-78,281-286`；`qa.ts:51-58` | 查询 main.ts:147-154 原 error→`{ok:false,error}` 或中文 + NEXT_STEP；ask 中断→cancelled／130、问答失败→4、领域→1；ingest stopped→cancelled；`program.ts:185-189` 解析错误仍直接 stderr，**并非所有 --json 失败都有 JSON** | CLI 操作者／脚本；`nb-story/skill/SKILL.md:20` 教模型读取 `{error:{code,message}}`；`qa/tools.ts:12-13,120` 与 CLI formatResult 共用格式器 | 中文说明 + 外部英文；用户：是；模型：Skill 使用与领域工具是明确通道 | CLI 不单独存错误；JSON 无统一错误版本；CLI 人类／模型／JSON 三个读者须分别定合同 |
| Workflow 状态 | `B-WORKFLOW-STATE` | `nb-workflow/src/runner-execution.ts:156-175` 普通错误变 failed／error:string，SuspendSignal→waiting，WorkflowCancelledError→cancelled；runner.ts:365 | `run-record.ts:54-77,108-136` 原样复制 error/logs；`runner-run-store.ts:120-147` 串行 saveRun+CAS；:167-200 hydrate 原样读 error；**异常的 name/code/cause/参数在 reduceExecutionError 丢失** | `WorkflowRunner.view/loadView/listStored`（runner.ts:381-395）；示例 `demo/guide.mjs:85-94,181-195`（读 result/journal/status/pendingWaits；没查到显示 Run.error 的位置，后端 5.4 更正）；新应用 src 无 nb-workflow 生产导入 | 中英混合；用户：宿主决定；模型：不自动注入 | `backend.ts:109-158` 自带 MemoryWorkflowBackend，状态只在内存；**磁盘 durable backend：无**；不能写成已有磁盘 Run 数据 |
| Workflow 控制 | `B-WORKFLOW-CONTROL` | `nb-workflow/src/runner.ts:233-257,285-325,419-455`；各专门 Error 类 | 控制 Promise 直接 reject，不改成 run.failed；`runner-run-store.ts:140-147` 保存失败包 WorkflowPersistenceError，Error.cause 保留，投影 poisoned；`runtime-events.ts:32-37` 另有 control_error 的 error:string | `demo/guide.mjs:439-459` 按类判断后拼 name/message 展示（含基础设施 Promise 拒绝，后端 5.4 更正）；包 API 调用方；主应用生产消费者：无 | 普通控制诊断中文，专门 backend／port 错误多为英文；用户：CLI 演示／宿主；模型：无 | 控制异常不持久化；control_error 是事件，不保证落盘 |
| History 异常 | `B-HISTORY-ERROR` | `nb-history/src/paths.ts:11-14`、`rows.ts:59,70-92,126-167`、`workspace-history.ts:123-145,271-279,589,642,781,894` | 普通 HistoryError 只有 name/message；条件变更专类 :253-259,608-626 保留 missing/stale | `nb-history/scripts/demo.ts:41-44,49-57,100`；新应用／nb-story／dev-panel 源码没有 nb-history 导入；旧应用消费者不属于盘点范围 | 中文（`types.ts:168` 显式写“message 面向宿主开发者(中文)”）；用户：示例终端／外部宿主；模型：无 | SQLite 存操作、快照、接受位点，不存 HistoryError；错误无版本／旧读机制 |
| History 不可用 | `B-HISTORY-UNAVAILABLE` | `nb-history/src/workspace-history.ts:372-377,391-409` diffSide 缺快照／二进制→available:false | `types.ts:153-165` 保留 reason=before-missing/after-missing/binary | `scripts/demo.ts:57-61` 仅 available 时展示 diff，未展示不可用原因；产品 UI 消费者：无 | 英文 reason，无句子；用户：此示例不显示；模型：否 | 结果不落错误记录；快照 body 是否可用由保留策略决定 |
| Memory 降级 | `B-MEMORY-FAILURE` | `nb-memory/src/index.ts:183`、`core/state-store.ts:42`、`subject-registry.ts:85,110,207`、`ports/sqlite-index-store.ts:299,359` | `ingest/extract.ts:109-122` **吞错误仅 skippedChunks++**；`retrieval/llm-planner.ts:78-89` 只 degraded=true；`index.ts:198-199,258` 汇总计数，原异常无下游 | nb-memory 公共 API 调用方；新应用／nb-story／dev-panel 源码无 nb-memory 导入 | 中文异常；提示词中文；用户：宿主决定；模型：失败原因不再投递 | JSONL／SQLite 保存领域数据，不保存这些错误；实际 catch 没日志，原因丢失（后端更正“日志后降级”的旧推断） |
| 受管子进程 | `B-OWNED-PROCESS` | `owned-process/src/index.ts:23`；`posix-adapter.ts:109-144,153-166`；`windows-adapter.ts:118-160,171-177` | 私有监督消息 kind:error 的 stage/message（Windows 另 osError）→OwnedProcessError；POSIX :164-172 监督器退出再结算；completion 保留 exitCode/signal/terminationReason | 返回 OwnedProcessLease 的包调用方；新应用／nb-story／dev-panel 源码无导入；当前项目 manager 用 Bun.spawn，不是此机制 | 中文适配器／英文原系统消息混合；用户：开发者调用方；模型：无 | 不持久化，无错误版本；监督 IPC 不占目标 stdout/stderr |
| 文件快照缓存 | `B-SNAPSHOT-FAILURE` | `file-snapshot-cache/src/snapshot-cache.ts:251-260,395-396,502` | :410-416 构建失败计数、boundedDiagnosticError 生成 name:message 并重新 throw 原错；:648-660 定长截断，丢 cause／自定义字段；:322-325,337-343 watcher **直接留 message，未同样截断**；:385-390 后台 catch 依赖下次 read 观察 | :204-245 diagnostics() 调用方；新应用／nb-story／dev-panel 源码无包导入；read 调用方拿原异常 | 包自写异常英文，builder／watcher 任意；用户：宿主决定；模型：否 | 内存状态，无错误持久化／旧读；lastBuildError 与 watcherError 有不同有界性 |

### 3.7 只有前端有的通道

| 前端 ID | 错误域 | 生产者 | 逐跳转换 | 消费者 | 语言；用户；模型 | 持久化；备注 |
|---|---|---|---|---|---|---|
| `FC-01` 引导与 RPC 端口连不上 | `fe.web.connection`、`fe.window.state` | `web/host/connection.ts:54,65,77,79,83,93`（`ConnectionError`） | 包裹：`describe(error)` 取 message（`window.ts:426`），丢 `status`（`window.ts:167-168`）；HTTP 错误体 code 拼进消息串（`connection.ts:79,89-97`） | `window.ts:167-168` 设 connection-failed；`FailurePage.vue:31,69` | 中文；用户：是（失败页 reason 行）；模型：无 | 无（内存）；标题与提示 `FailurePage.vue:24-45` 写死，没有语言入口 |
| `FC-02` 引导集合被拒 | `fe.window.state` | `web/host/window.ts:355-392`（`BootstrapRejected`，十条中文句子） | 保留 kind；`window.ts:177-179` 把 error.message 当 reason | `FailurePage.vue:34-37,69` | 中文；用户：是；模型：无 | 无；kind 是 incompatible 或 startup-failed |
| `FC-06` 启动失败 | `fe.window.state` | `window.ts:150,152,245,276,297`（抛 Error，中文）；:297 拼接 `failure.source：failure.error?.message ?? failure.reason`，多条以“；”连接 | 包裹：catch 在 `window.ts:300-304` 同时记诊断（`browser-host.startup.failed`，message 固定中文，error 带原异常）和设 startup-failed（`reason: describe(error)`） | `FailurePage.vue:36-37,69`；诊断出口 | 混合：中文框架加各入口抛出的原文；用户：是（原异常消息直接露出）；模型：无 | 否；`failure.error.message` 是插件作者抛的字符串，语言不受控 |
| `FC-07` 抢救的未保存正文 | `fe.window.state` | `editor/web/documents/store.ts:23,842`（`LOST_FORMAT` 写死中文） | `window.ts:430-` `createRescue` 收集；终态时挂 `state.rescued` | `FailurePage.vue:74-85` | 中文；用户：是（note 行）；模型：无 | 否；页面在设置服务与语言配置之前就可能显示 |
| `FC-08` 首次导航失败 | `fe.window.state` | `web/mount.ts:48-51`（页面模块加载失败） | `error.message` 直接做 reason | `FailurePage.vue` | 取决于原异常（多为英文加载错误）；用户：是；模型：无 | 否；`main.ts:9-13` 的 `await bootWindowUi` 本身没有 catch：`boot.ts:32` 的 `throw new Error("index.html 缺少 #app")` 与 mount 之前的异常不经失败页（**未验证实际表现**） |
| `FC-35` 栅格拒绝 | `fe.ui.grid` | `nb-ui/src/components/layout/grid.ts`（34 处）、`useGridLayout.ts`、`useSashGesture.ts` | 保留：`WorkbenchShellLayout.vue:107-119` 把 reason 收进 `gestureIssues`（最近 3 到 4 条）→DOM 属性 `data-layout-diagnostics`；布局投影 `issues` 在 `workbench/web/plugin.ts:136-140` 记诊断 | DOM 属性、诊断 | 中文；用户：否（属性只给测试与开发者）；模型：无 | 栅格快照有版本（`grid-snapshot.ts:23,42`），读旧快照失败 `ok:false`（:84） |
| `FC-36` SDK 定义期错误 | `fe.sdk.define` | `neuro-book/src/sdk/plugin.ts:70-71,234,274`、`command-helpers.ts:34-57` | 抛 `TypeError`（中文） | 插件作者；展示去处（插件代码装载失败）在对侧 `plugin-platform`，**未追到** | 中文；用户：取决于对侧；模型：无 | 否；示例插件与模板教作者读这些消息 |
| `FC-37` 主题装载失败 | `fe.ui.theme-install` | `nb-ui/src/theme/theme-loader.ts:72-220`；`semver-range.ts:65-95` | 包裹：消息固定为 `` 主题 "id" 装载失败（reason）：message `` | `neuro-book/src/ui/theme/product-themes.ts:17` 模块顶层调用，未被 `mount.ts:44-51` 接住（该 catch 只包 `router.isReady`） | 中文；用户：取决于 main.ts 之外的捕获，**未追到**；模型：无 | 否；构建时已知主题，运行中不会触发 |
| `FC-38` 表单校验问题 | `fe.form.issue` | `nb-form/src/validate.ts:99-104,127-240` | 保留 `FormIssue {path,code,params,message?}`；`schema-error` 的 `params.detail` 带异常原文但界面不显示（`messages.ts:195-229`） | `nb-form/src/vue/messages.ts:229` `issueText`（message 优先，否则按码表；中英各一份） | 双语（zh-CN／en-US，其它语言取英文）；用户：是；模型：无 | 否；仓库里“码加参数、界面取文案”的完整样板 |
| `FC-42` 编解码写不出 | `fe.markdown.unrepresentable` | `nb-markdown/src/language/codec/render/*.ts`、`syntax/*/write.ts`（`throw new Unrepresentable("中文")`，共 9 处）→`codec/write.ts:745` | 转换：异常变 `{ok:false,code:"unrepresentable",from,to,reason,fallback}` | `editor/web/documents/store.ts:72-79,555,789` 存 BlockedInput；`EditorGroup.vue:171-172` 用自己的双语句子，reason 不显示 | 中文（只供诊断）；用户：否（界面用 index、excerpt 另写句子）；模型：无 | 否；“诊断文字不进界面”的正确样板 |
| `FC-53` 示例业务失败 `storage-failed` | `fe.examples.*` | `plugin-sdk/examples/plugins/focus/shared/contracts.ts:56,68-70,83-85`；`notes/shared/contracts.ts:46,65-66,84`；生产 `notes/backend/plugin.ts:52-54,72` | 合同声明 `{code,detail}`，后端把 Storage 的 code 与 detail 包进 detail（嵌套），前端按 code 分支 | 示例前端 | detail 来自 Storage 提供者，语言取决于对侧；跨进程：是 | — |
| `FC-54` 示例同步提前结束 | `fe.examples.*` | `notes/web/plugin.ts:55-68` | 订阅 `onEnd(reason)` 经 `first.resolve(reason)` 变成 `{ok:false,code:"unavailable",detail:` 同步在拿到第一份列表之前结束：${ended}` `}` | 示例前端 | 中文；跨进程：否 | — |
| `FC-55` 示例命令失败 | `fe.examples.*` | `focus/web/plugin.ts:54`；`focus/web/focus-store.ts:105-127` | `problem` 字符串（含 `与服务端的同步结束了：${reason}`）经 `{ok:false,code:"execution-error",reason:problem}` 变成命令失败 | 命令通道 | 中文；跨进程：否 | — |
| `FC-56` 示例后端抛错 | `fe.examples.*` | `notes/backend/plugin.ts:155,165` | `throw new Error(` 打不开 ${owner} 的笔记：${opened.detail.code}` `)` 等，把码拼进中文句子 | 示例 | 中文；跨进程：否 | — |
| `FC-57` 示例公开键 `reason`（双语） | `fe.examples.*` | `counter/shared/contracts.ts:73-77` | 键声明里的 `reason: {"zh-CN","en-US"}`，命令面板在键为 false 时显示 | 命令面板 | 中英并存；跨进程：否 | 前端附录：`counter` 是示例里唯一符合方向的写法 |

### 3.8 主会话补查补入的通道

| 通道 | 来源 | 位置 | 内容 | 语言；用户；持久化 |
|---|---|---|---|---|
| `MC-01` 项目统计诊断 | 主会话补查（两份报告都没盘） | `packages/neuro-book/src/plugins/projects/project/` 的统计逻辑，如 `stats-tracker.ts:209、418、447、463` | 约 20 条诊断（`record(` 共 22 处，含定义），带稳定 `event`（`projects.stats.*`），经 `diagnostics.record` 进诊断 | 中文消息；只进诊断，不显示给用户；落盘走诊断 JSONL 行 |
| `MC-02` 插件 `testing/` 辅助 | 主会话补查（两份报告都没盘） | 各插件 `testing/`：explorer、files、settings、storage | 测试场地辅助代码，抛中文错误 | 中文；只在测试里出现；不显示给用户 |

## 4. 必查表

读法：按前端报告的编号（1a 到 19）排列，补入后端报告里有、前端编号没有的项（编号加 `+`）。“对应通道 ID”列出后端与前端的通道；“状态”只用：通道 ID（有通道）／无／Spec 规划、未实现／未追到／对侧已追到／不一致。两边说法一致的写“一致”并只列一份原话；不一致的列两边原话，不裁决。“无”前端多为“前端分区里没有”，后端的“无”是“在本次基线与盘点范围内没有”，两者范围不同，已在备注标出。

| 项 | 必查项 | 对应通道 ID | 状态 | 备注或两边原话 |
|---|---|---|---|---|
| 1a | 诊断事件（记录） | 后：`B-DIAG-QUERY`、`B-DIAG-JSONL`；前：`FC-32`、`FC-19`、`FC-34`、`FC-05` | 通道 ID | 一致；记录类型在 `nb-runtime/src/diagnostics`；前端 `message` 中文 20 处、表达式 20 处，`event` 全为英文点分名 |
| 1b | 诊断查询 | 后：`B-DIAG-QUERY`；前：— | **未追到**（裁决见 9.3） | 后端：“产品诊断查询 UI/HTTP 消费者：未追到……应用/src 检索 `diagnostics.query/store.query/diagnostics.status` 命中测试，没找到生产查询页；不等同查询功能不存在”。前端：“无：前端文件清单里没有调用 `query`、`snapshot`、`recent` 的代码（命令 C1）；规格要求浏览器用有界内存缓冲提供查询（`docs/specs/runtime/diagnostics.md` 第 55–57 行），能力在提供者里，前端没有消费者” |
| 1c | JSONL 日志 | 后：`B-DIAG-JSONL`、`B-DIAG-FALLBACK`；前：—（浏览器出口只写 console） | 通道 ID（前端侧：无） | 一致；前端“无：浏览器出口只写 console，规格明说不要求落盘（`diagnostics.md` 第 19、55 行；`console-exporter.ts:36`）”；后端日志写入 `log-writer.ts`、`jsonl-exporter.ts` |
| 1d | 紧急输出 | 后：`B-HOST-EMERGENCY`、`B-DIAG-FALLBACK`；前：`FC-33`、`FC-32`（兜底 `console-exporter.ts:60`） | 通道 ID | 一致 |
| 2a | 握手 `reject` | `B-REMOTE-HANDSHAKE`；`FC-03` | 通道 ID | 一致；帧 schema `nb-runtime/src/remote/protocol.ts:246` |
| 2b | 连接结果 | `B-REMOTE-HANDSHAKE`；`FC-03`、`FC-04` | 通道 ID | 一致；`RemoteConnectResult` `nb-runtime/src/remote/node.ts:163` |
| 2c | 远程路由失败 | 后：`B-REMOTE-ROUTE`、`B-REMOTE-END`；前：`FC-14`、`FC-15`、`FC-20`、`FC-25`、`FC-26`、`FC-28`、`FC-31` | 通道 ID | 前端“码表与 detail：`nb-runtime/src/remote/contract.ts`（未逐码展开，见后端报告）” |
| 2d | 业务 detail | 后：`B-REMOTE-BUSINESS`、`B-SETTINGS-WRITE`、`B-STORAGE-STATE`、`B-PROJECTS-BUSINESS`、`B-FILES-BUSINESS`、`B-PLUGINS-INSTALL`；前：`FC-14`、`FC-15`、`FC-20`、`FC-25`、`FC-26`、`FC-28`、`FC-30` | 通道 ID | 前端：各域直接把 detail 当句子显示或拼接（前端发现 4） |
| 3a | 命令失败结果 | 后：`B-COMMAND-RESULT`；前：`FC-09`、`FC-11`、`FC-12`、`FC-13` | 通道 ID | 一致 |
| 3b | 命令失败通知 | 后：`B-COMMAND-NOTICE`；前：`FC-09`（`failure-notice.ts`、`WorkbenchCommandHost.vue`、`keymap.ts`、`palette-host.ts`） | 通道 ID | 一致；后端已追到 `nb-ui` 的 `Notification.vue:59-60` |
| 3c | 命令不可用原因（`isEnabled`） | 前：`FC-10`；后：`B-COMMAND-RESULT` 备注“when reason 可按当时 locale 出中/英” | 通道 ID | 后端无单列通道 |
| 3d | 命令执行审计事件（`onDidExecute`） | 后：`B-COMMAND-RESULT`（审计 listener）；前：—（仅 Lab） | 无（产品订阅者） | 前端：“仅 Lab：`plugins/lab/web/fixtures/command-scene/lab-command-scene.ts:146-156`；产品代码里无订阅者（命令 C2）；发布者 `commands/shared/registry.ts:369`”。后端：“结果与审计 listener 自身不落盘……Spec 规划的全量命令审计持久化未见实现”。两句说的是订阅者与持久化两个方面，未见冲突 |
| 3e | 跨实例命令执行结果 | 后：`B-COMMAND-RESULT`；前：— | 无（前端：调用者只有测试插件） | 前端：“无：浏览器侧提供者 `commands/shared/plugin.ts:119-155`；调用者只有 `server/testing/test-plugins.ts:148-149`（测试插件）（命令 C3）；结果的 `code` 在远程合同里放宽成 `Type.String()`（`contracts.ts:161`）”；后端同一测试调用位置一致 |
| 3f+ | 模型命令工具接线 | 后：`B-COMMAND-RESULT` | **Spec 规划、未实现** | 后端：“本分区未发现生产命令 ToolImpl……CommandDeclaration.description/expose 已有合同（`commands/shared/contracts.ts:53-85`），实际 execute Agent 来源仅测试/调用方接口”；前端未列此项 |
| 4 | 贡献与清单校验的拒绝原因 | 后：`B-PLUGIN-VALIDATION`、`B-PLUGINS-INSTALL`、`B-CLI-SDK`；前：`FC-25`（展示端 `REJECTED_REASON`） | 通道 ID | 前端：清单校验在 `nb-runtime` 与 `neuro-book/src/manifest.ts`（后端）；后端：ManifestProblem.path/message；`version-dir.ts:68-73` 展平，`build-plugin.ts:565,609` 原问题交 PluginBuildError |
| 5a | 插件安装、升级失败 | 后：`B-PLUGINS-INSTALL`、`B-CLI-NBOOK`；前：`FC-25`（`FAILURE_TEXT` 表） | 通道 ID | 码：`plugin-platform/shared/types.ts:167-169` |
| 5b | 启动未加载的状态（`notLoaded`） | 后：`B-PLUGINS-NOTLOADED`；前：`FC-25`（`NOT_LOADED` 表 + 原样 detail，`PluginsPage.vue:80-90,435`） | 通道 ID | 一致 |
| 5c | 入口 blocked／failed／stopped | 前：`FC-23`、`FC-24`、`FC-25`；后：`B-PLUGIN-CODE-BROWSER`（消费侧）、`B-PLUGINS-NOTLOADED` | 通道 ID | 状态来自 nb-runtime `EntryState` |
| 5d | 浏览器插件代码装载失败（`code-load-failed`、`module-not-shared`） | 后：`B-PLUGIN-CODE-BROWSER`；前：— | **对侧已追到** | 前端：“未追到：计划把装载失败划给后端分区；前端只见 `window.ts:276-298` 的拼接入口与 `plugins/web/…` 的展示；`createPluginCodeHost` 的错误类别没有在前端文件清单里”。后端已追到生产者 `plugin-platform/web/plugin-code.ts:194-206,233-250` 与消费 `PluginsPage.vue` |
| 5e+ | 服务端插件代码装载错误 | 后：`B-PLUGIN-CODE-SERVER` | 通道 ID | 前端未列此项 |
| 6a | 设置层 `invalid` 快照 | 后：`B-SETTINGS-INVALID`；前：`FC-22` | 通道 ID | 一致 |
| 6b | 设置文件校验与保存拒绝 | 后：`B-SETTINGS-WRITE`、`B-SETTINGS-INVALID`；前：`FC-21` | 通道 ID | 一致 |
| 6c | 设置写入失败 | 后：`B-SETTINGS-WRITE`；前：`FC-20` | 通道 ID | 一致 |
| 7a | Storage 记录损坏、版本不支持 | 后：`B-STORAGE-STATE`；前：`FC-26`、`FC-27` | 通道 ID | 一致 |
| 7b | Storage 订阅结束 | 后：`B-STORAGE-END`（含 `B-REMOTE-END`）；前：— | **直接订阅：前端分区无；下游状态投影：`B-STORAGE-END` 已追到**（裁决见 9.3） | 前端：“未追到：前端文件清单里没有调用 Storage 订阅的结束回调（命令 C4）；文件监视的结束是另一回事（`FC-16`）”，并注“C4 的结果是‘前端没有订阅 Storage 的结束事件’，不等于规格没要求”。后端：消费者列 `shared/store/problem.ts:14-17`、`explorer/web/components/FilesExplorerView.vue:95-98`、`explorer/web/preferences.ts:85-87`（reopen／retry），这三处按前端分区口径在 `explorer/web/` 下 |
| 7c | Storage 写失败 | 后：`B-STORAGE-STATE`、`B-STORE-FAILURE`；前：`FC-26`（布局）、`FC-53`（示例 `storage-failed`，notes／focus） | 通道 ID | 一致 |
| 8a | 项目子进程启动 | 后：`B-PROJECT-IPC`；前：— | 通道 ID（前端：无） | 前端：“无：前端清单里没有 `child_process`、`spawn`、`owned-process`、`IPC` 命中（命令 C5）；窗口只在握手阶段见到‘打开项目失败’（`FC-03`、`FC-28`）” |
| 8b | 项目 IPC 传输 | 后：`B-PROJECT-IPC`、`B-REMOTE-ROUTE` | 通道 ID | 同上 |
| 8c | 项目输出转发 | 后：`B-PROJECT-OUTPUT` | 通道 ID | 同上 |
| 9a | HTTP 错误体（引导） | 前：`FC-01`（`connection.ts:79,89-97`）；后：`B-HTTP-HOST` | 通道 ID | 前端：服务端 `neuro-book/src/server/*` |
| 9b | HTTP 错误体（封面、nbstory、nbdev） | 后：`B-HTTP-COVER`、`B-STORY-HTTP`、`B-NBDEV-HTTP`；前：`FC-30`、`FC-43`、`FC-49` | 通道 ID | 一致 |
| 9c | HTTP 中间件的错误 | 后：`B-HTTP-HOST`（准入、dispatch）、`B-HTTP-COVER`（bodyLimit :70-73）、`B-NBDEV-HTTP`（`serve.ts:351-355` plain text 旁路）；前：— | **对侧已追到** | 前端：“未追到：前端只见 401（`nb-story/src/web/host/client.ts:121`、`dev-panel/src/web/host/panel-data.ts:136`）与 5xx 的通用文字；中间件本身在后端”。后端同时记：通用 `error.message` 的统一 reader 未追到（见第 7 节） |
| 10 | 工具结果（内置、领域、第三方桥接） | 后：`B-TOOLS-BUILTIN`、`B-TOOLS-DOMAIN`、`B-TOOLS-THIRDPARTY`、`B-TOOLS-REFUSED-PROJECTION`；前：`FC-40`（前端不区分三类） | 通道 ID | 第三方异常转工具结果的外部 OMP 内部实现，后端标未追到（见第 7 节） |
| 11a | 运行中的 Agent 事件与 SSE | 后：`B-AGENT-SSE`；前：`FC-45`、`FC-39` | 通道 ID | 前端：`QaFrame` `nb-story/src/contract/contract.ts:777-781` |
| 11b | 权威日志补发 | 后：`B-AGENT-LOG-REPLAY`；前：`FC-45` | 通道 ID | 前端：`harness.ts:359` 日志优先于晚到的事件 |
| 11c | QA 降级回放 | 后：`B-QA-RECORD`；前：`FC-46` | 通道 ID | 一致（两边都指出降级只用 `error.message`） |
| 12 | 会话 JSONL（`agent_message`、`run_end.error`） | 后：`B-SESSION-JSONL`、`B-HARNESS-RUN`；前：`FC-39`、`FC-40`（消费，`harness.ts:173-300`） | 通道 ID | 前端不写会话 JSONL，写入在 `nb-session` |
| 13 | QA 记录 | 后：`B-QA-RECORD`；前：`FC-46`（消费） | 通道 ID | 前端：`QaFailureSchema` 的 code、kind 前端丢弃 |
| 14 | Workflow 的 Run 状态与控制失败 | 后：`B-WORKFLOW-STATE`、`B-WORKFLOW-CONTROL`；前：— | 通道 ID（前端：无） | 前端：“无：前端清单里没有 `nb-workflow` 命中（命令 C5）”；后端：“磁盘 durable backend：无（自带只有 MemoryWorkflowBackend）”，主应用生产消费者无 |
| 15 | History 的异常与不可用结果 | 后：`B-HISTORY-ERROR`、`B-HISTORY-UNAVAILABLE`（并含 `B-MEMORY-FAILURE`）；前：— | 通道 ID（前端：无） | 前端：“无：前端清单里没有 `nb-history`、`nb-memory` 命中（命令 C5）”；后端：新应用生产集成无 |
| 16a | CLI 给人看的输出与 `--json`（应用 `src/cli`） | 后：`B-CLI-NBOOK`、`B-CLI-PLUGIN-LOG`；前：— | 通道 ID（前端：无） | 前端：前端分区没有命令行入口 |
| 16b | nbstory 的 CLI 输出 | 后：`B-CLI-STORY` | 通道 ID | 前端归在 16a 一并写“无” |
| 16c | plugin-sdk 作者 CLI | 后：`B-CLI-SDK` | 通道 ID（`--json`：无） | 后端：“`--json`：无，构建问题 path/message 人类 stderr” |
| 16d | nbdev CLI 的输出 | 后：`B-NBDEV-CLI`、`B-NBDEV-DEV-STREAM`；前：— | 通道 ID（前端：无） | 前端：命令行在 `dev-panel/src/cli`，后端分区；与网页共用的校验见 17b |
| 17a | nbdev HTTP `errors[].message` | 后：`B-NBDEV-HTTP`；前：`FC-49`、`FC-50` | 通道 ID | 一致 |
| 17b | nbdev 共用的校验函数 | 后：`B-NBDEV-VALIDATION`；前：`FC-51` | 通道 ID | 一致；`core/text-rules.ts:14-44`、`core/questions.ts:83-99` |
| 17c+ | nbdev 的 WebSocket、搜索流、通知、审计 | 后：`B-NBDEV-TERMINAL`、`B-NBDEV-SEARCH`、`B-NBDEV-NOTIFY`、`B-NBDEV-AUDIT`；前：`FC-52`（终端） | 通道 ID | 前端报告未列搜索流、通知、审计 |
| 18 | 界面直接显示 `message`／`reason`／`detail` 的位置 | 后：`B-COMMAND-NOTICE`、`B-SETTINGS-INVALID`、`B-HTTP-COVER`、`B-PLUGINS-NOTLOADED`、`B-QA-RECORD`、`B-INGEST-STATE`、`B-NBDEV-HTTP`；前：`FC-01`、`02`、`03`、`04`、`06`、`08`、`09`、`10`、`11`、`12`、`14`、`15`、`16`、`17`、`18`、`20` 至 `25`、`26`、`28`、`30`、`39` 至 `41`、`43` 至 `52` | 通道 ID | 前端另有 94 个模板汇点（48 个插值加 46 个绑定），逐文件清单在 `lab-frontend/count-out.txt` |
| 19a | Task 证据 | 后：`B-TASK-EVIDENCE`、`B-SCRIPT-EVIDENCE`；前：— | 通道 ID | 前端：“任务证据（`evidences/`、`artifacts/`）由主会话合并时处理，本分区未读” |
| 19b | 测试断言 | 后：`B-TEST-ASSERTIONS`；前：20 个测试文件候选（命令 C6） | 通道 ID | 前端 C6 为候选，未逐个核实；后端未运行测试 |
| 20+ | 项目统计诊断（主会话补查） | `MC-01` | 通道 ID | 两份报告都没盘 |
| 21+ | 插件 `testing/` 辅助（主会话补查） | `MC-02` | 通道 ID | 两份报告都没盘 |

### 4.1 必查表小结

- 合并时两边说法不一致的有 2 项（1b 诊断查询，7b Storage 订阅结束），原话如上；裁决见 9.3，状态已改。
- 状态为“Spec 规划、未实现”的项：1 项（3f 模型命令工具接线）。
- 状态为“对侧已追到”的项：2 项（5d、9c），前端原标“未追到”。
- 状态为“无”或前端侧“无”的项：3d、3e，以及前端对 1c、8、14、15、16 各项的“无”；后端侧对应项均有通道 ID，两边范围不同，不是冲突。
- 必查表里最终没有写“未追到”的项；仍未追到的对象见第 7 节。

## 5. 计数

两边口径不同，下列数字并列，不相加，也不互相换算。

### 5.1 基线与单位

| 项 | 后端报告 | 前端报告 |
|---|---|---|
| 基线提交 | `65d9daea06616b8fc8459bc7ef9cb2132cee25ed` | 同左 |
| 文件集 | 947 个已跟踪文件（含代码、文档、Skill、配置、测试、模板）；代码文件 813（ts/tsx/js/jsx/mjs/cjs/vue）；排除测试／fixture 后 493 | 1125 个 `.ts/.vue/.tsx` 文件；非测试 888（373 个 `.vue`，515 个 `.ts`）；测试、辅助与类型检查文件 237（含 3 个 `*.typecheck.ts`） |
| 计数单位 | “含中文字符串的调用边界候选”：最近祖先 CallExpression／NewExpression，去重键 `file:line:column` | “汇点”：`throw new X`、自定义错误类、`.record({level…})`、`console.warn/error`、含 `ok:false` 的对象字面量、`catch` 子句，模板里直接显示 `.message/.reason/.detail/.error` 的位置；去重键文件路径加语法位置 |
| 跨行与变量拼接 | TypeScript AST，模板／拼接跨行归最近调用；不展开变量、不跟踪跨函数数据流 | AST 不看行，跨行字面量、模板、`+` 拼接一个汇点；变量无字面量片段记 `expr`；函数调用整个表达式按 `expr` 记，不读参数 |
| 排除 | 扫描器以 TS/TSX 模式处理，Vue SFC 仅 `plugin-sdk/template/web/HelloView.vue` 有 40 条解析诊断，不计为产品错误，不宣称完整覆盖 SFC；不统计 Markdown／JSON 配置文字量 | 不含 `.md/.css/.json`；`{zh-CN,en-US}` 双语条目（877 行候选）不在汇点里；`describe(error)` 一类辅助函数的调用点不另数 |
| 复现命令 | `node /tmp/w00031-review/t02-audit/lab-backend/count-backend.mjs`、`classify-backend.mjs`、`check-audit.mjs`（附件在 `lab-backend/`） | 原始匹配 `bash /tmp/w00031-review/t02-audit/lab-frontend/raw.sh`；汇点 `cd /tmp/w00031-review/t02-audit/lab-frontend && bun count.ts <worktree>/packages files.txt`，再 `python3 classify.py`（附件在 `lab-frontend/`） |

### 5.2 原始匹配数（候选）

| 后端 | 数量 |
|---|---:|
| 非测试代码文件内含汉字的行 | 12,610 |
| 汉字字符（Unicode Han 匹配数） | 268,505 |
| 含中文字符串的调用边界候选 | 2,400（1,547 个 call，853 个 new；分布 275 个文件） |
| 候选片段（StringLiteral／NoSubstitutionTemplate／TemplateExpression） | 2,842 |
| 无调用祖先的含汉字 AST 节点 | 1,358（176 个文件） |
| Error 基类候选声明 | 75（74 个不同类名） |
| scripts／demo／docs 中的调用候选 | 268（2,400 的子集） |
| 按行范围的疑似包含对 | 111 对、涉及 156 个调用（后端更正：早期“88 对”口径不一致，作废；不能从 2,400 扣除） |

| 前端（888 个非测试文件上逐模式 `grep -E \| wc -l`，数的是行） | 行数 |
|---|---:|
| `throw new ` | 108 |
| `new [A-Za-z]*Error(` | 103 |
| `.record(` | 42 |
| `ok: ?false` | 284 |
| `\bcatch\b` | 165 |
| `\.message\b` | 230 |
| `\.reason\b` | 161 |
| `\.detail\b` | 124 |
| `console.(warn\|error)` | 52 |
| `"?zh-CN"?:`（双语条目所在行，含界面文字） | 877 |

前端注：原始匹配数与汇点数对不上，因为 `ok:false` 含类型声明与联合类型、同一行多个、测试夹具返回类型；`.message` 含 `props.message`、`event.message`、`issue.message`（Ajv）等。

### 5.3 分类数

后端（互斥，按调用所造文字的主要用途；2,342 个进入四类，58 个无法分类；405 条有限规则给出分类或边界原因）：

| 包 | 非测试代码文件 | 原始含汉字行 | 调用候选 | 诊断 | 用户文案 | 提示词 | 领域内容 | 无法分类 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| dev-panel | 79 | 2278 | 635 | 91 | 519 | 0 | 0 | 25 |
| file-snapshot-cache | 5 | 60 | 0 | 0 | 0 | 0 | 0 | 0 |
| nb-harness | 20 | 279 | 58 | 49 | 0 | 9 | 0 | 0 |
| nb-history | 12 | 326 | 63 | 33 | 18 | 0 | 12 | 0 |
| nb-memory | 18 | 786 | 25 | 13 | 0 | 9 | 3 | 0 |
| nb-profile | 7 | 47 | 12 | 12 | 0 | 0 | 0 | 0 |
| nb-runtime | 44 | 1358 | 177 | 177 | 0 | 0 | 0 | 0 |
| nb-session | 4 | 30 | 4 | 4 | 0 | 0 | 0 | 0 |
| nb-story | 83 | 2688 | 587 | 158 | 217 | 153 | 57 | 2 |
| nb-workflow | 36 | 401 | 109 | 26 | 68 | 1 | 11 | 3 |
| neuro-book | 178 | 4270 | 705 | 407 | 269 | 0 | 1 | 28 |
| owned-process | 7 | 87 | 25 | 25 | 0 | 0 | 0 | 0 |
| **总计** | **493** | **12610** | **2400** | **995** | **1091** | **172** | **84** | **58** |

后端无法分类 58 个的原因组：U01 20、U02 4、U03 1、U04 2、U05 3、U06 7、U07 5、U08 9、U09 7（说明见后端报告 4.2）；分布 24 个文件，运行源码／声明 41、演示 3、脚本／验收 14。268 个 scripts／demo／docs 调用子集中：诊断 141、用户文案 85、提示词 1、领域内容 24、无法分类 17。

前端（汇点总数 678：文字汇点 440、`catch` 144、模板显示汇点 94）：

| 汇点种类 | zh | en | expr | 无文字 | 合计 |
|---|---:|---:|---:|---:|---:|
| `throw new *Error` | 60 | 5 | 9 | 0 | 74 |
| `throw new` 自定义 | 29 | 2 | 3 | 0 | 34 |
| `class … extends *Error` | 2 | 0 | 5 | 1 | 8 |
| `diagnostics.record({level})` | 20 | 0 | 20 | 0 | 40 |
| `console.warn\|error` | 25 | 4 | 18 | 0 | 47 |
| `{ok:false}`（无文字属性） | — | — | — | 17 | 17 |
| `{ok:false}+code`（无文字属性） | — | — | — | 15 | 15 |
| `{ok:false}+code+detail` | 19 | 0 | 13 | 0 | 32 |
| `{ok:false}+code+reason` | 18 | 1 | 24 | 0 | 43 |
| `{ok:false}+reason` | 83 | 7 | 22 | 0 | 112 |
| `{ok:false}+message` | 1 | 0 | 18 | 0 | 19 |
| `catch`（有处理 139、空体 5） | — | — | — | 144 | 144 |
| 模板插值显示 `.message/.reason/.detail/.error` | — | — | — | 48 | 48 |
| 模板绑定 `:error/:message/:title/:text` 到 `…message/reason/detail` | — | — | — | 46 | 46 |

| 前端区域 | 诊断 | 用户文案（结果字段里的句子） | 透传（语言取决于上游） | 码或无文字 | 夹具与示例 | 合计 | 其中诊断进入界面 | 模板显示汇点 | catch |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| app:plugin-sdk/examples | 0 | 0 | 0 | 0 | 16 | 16 | 0 | 0 | 0 |
| app:plugins/*/web | 39 | 55 | 64 | 22 | 0 | 180 | 0 | 13 | 24 |
| app:plugins/lab（开发场景） | 0 | 0 | 0 | 0 | 58 | 58 | 0 | 2 | 11 |
| app:src/sdk | 7 | 0 | 0 | 0 | 0 | 7 | 0 | 0 | 0 |
| app:src/ui | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 2 |
| app:src/web | 29 | 0 | 3 | 0 | 0 | 32 | 21 | 1 | 19 |
| dev-panel/src/web | 18 | 0 | 1 | 3 | 0 | 22 | 0 | 16 | 30 |
| nb-agent-ui | 10 | 0 | 0 | 0 | 0 | 10 | 0 | 19 | 2 |
| nb-form | 4 | 0 | 0 | 5 | 0 | 9 | 0 | 0 | 9 |
| nb-markdown | 13 | 0 | 0 | 1 | 0 | 14 | 0 | 0 | 7 |
| nb-story/src/web | 25 | 0 | 1 | 0 | 0 | 26 | 0 | 37 | 31 |
| nb-ui | 64 | 0 | 0 | 1 | 0 | 65 | 0 | 6 | 9 |
| **合计** | **210** | **55** | **69** | **32** | **74** | **440** | **21** | **94** | **144** |

- 前端注：“提示词”“领域内容”两类在前端分区为 0；“无法分类”对应“透传”69 个（其中 `app:plugins/*/web` 64 个）；“用户文案”只数结果字段里的句子，`{zh-CN,en-US}` 目录属界面文字迁移（w00028），不计；“其中诊断进入界面”21 个是 `BootstrapRejected`、`ConnectionError`、`window.ts` 与 `boot.ts` 里的 `throw`（对应 `FC-01`、`FC-02`、`FC-06`）。
- 两边分类名称不同：后端为“诊断／用户文案／提示词／领域内容／无法分类”，前端为“诊断／用户文案（结果字段里的句子）／透传／码或无文字／夹具与示例”。两边的“用户文案”含义也不同（后端含 x-form、声明标题、帮助等，前端只数结果字段），故不并列求和。

### 5.4 码到文案表（前端 4.4，单位：一张表一个，括号为条目数）

| 表 | 位置 | 条目 |
|---|---|---|
| 设置写入失败 | `neuro-book/src/ui/settings/setting-text.ts:22-46` | 7 |
| 插件管理失败 | `plugins/plugins/web/components/PluginsPage.vue:96-108` | 13 |
| 插件未加载 | `PluginsPage.vue:80-90` | 5 |
| 入口受阻原因 | `PluginsPage.vue:179-186` | 6 |
| 贡献被拒原因 | `PluginsPage.vue:188-193` | 4 |
| 升级受阻原因 | `PluginsPage.vue:121-126` | 4 |
| 状态栏存储原因 | `plugins/workbench/web/components/WorkbenchStatusBar.vue:55-64` | 7（对 14 个存储码缺 10 个） |
| 资源管理器失败码 | `plugins/explorer/web/feedback-text.ts:27-35` | 7 |
| 资源管理器动作名 | `feedback-text.ts:12-25` | 12 |
| 资源管理器不可用原因 | `feedback-text.ts:91-101` | 9 |
| 项目登记失败 | `plugins/projects/web/messages.ts:39-50`（`FAILURES`） | 未逐条数 |
| 项目与书架失败码 | `projects/web/messages.ts:97-117` | 9 个码 |
| 预览拒绝 | `plugins/html-preview/web/components/HtmlPreview.vue:19-22` | 3 |
| 图片查看拒绝 | `plugins/image-viewer/web/components/ImageViewer.vue:20` | 未逐条数 |
| 助手运行出错 | `nb-agent-ui/src/messages.ts:189-195`、`389-395` | 7（中英各一份） |
| 表单校验码 | `nb-form/src/vue/messages.ts:61-141,195-260` | 29（中文 `codes`；英文同数） |
| 抽取停下原因 | `nb-story/src/web/host/ingest.ts:31-39` | 7 |
| 未保存的原因 | `nb-story/src/web/pages/QaPage.vue:472` | 2（内联在模板表达式里） |

### 5.5 其它并列数字

| 项 | 后端 | 前端 |
|---|---|---|
| 错误域 | 41（1.1 九个、1.2 十四个、1.3 十七个，加补录 `story.ingest-check`） | 34 |
| 通道 | 64 个不同 ID | 57（`FC-01` 至 `FC-52`，附录 `FC-53` 至 `FC-57`） |
| 必查表 | 3.1 共 64 行 | 42 行（1a 至 19 含细分） |
| 发现 | 12 条（阻断 0、重要 10、建议 2；必须先定 7、迁移时注意 5） | 15 条 |
| 测试文件中文断言候选 | 引用测试 4 个文件的措辞绑定（`B-TEST-ASSERTIONS`） | 237 个测试与辅助文件中 20 个（命令 C6，候选未核实） |
| 脚本／中间产物 | `lab-backend/` | `lab-frontend/` |

## 6. 给 t03 的问题清单

分级规则：后端报告把 F01 至 F07 列为“t03 必须先定”，F08 至 F12 列为“迁移时注意”；前端报告 15 条正文没有显式分级，每条小节都写“为什么要先定”，且前端自己写明排序是“先写必须在 t03 设计前定下的，再写迁移时要注意的”。本清单按两边各自的原话归级：后端有分级的按后端；前端条目按其“为什么要先定”归“必须先定”。同一个问题两边级别不同的，放在较高一级并标“级别两边不同”，不裁决。编号 M 为本清单编号。每条保留位置、现象、建议。

### 6.1 必须先定

#### M1 命令失败只有一句 `reason`，既给用户看又进诊断

- 来源：前端发现 1；后端 F01（命令通知部分）。
- 位置：`neuro-book/src/plugins/commands/shared/contracts.ts:26-37`（`CommandFailureCode` 九个码加 `reason: string`）；`workbench/web/commands/failure-notice.ts:23-29`；`keymap.ts:102`；`WorkbenchCommandHost.vue:34-48`；对侧 `commands/shared/registry.ts:177,259,268,300-358`；`nb-ui` 的 `Notification.vue:59-60`。
- 现象：`reason` 是整句话，用户入口原样放进通知。同一字段里有三种语言来源：写死中文（`registry.ts` 八处、`view-commands.ts:104-203`、`editor/web/area.ts` 约 50 处、`open-commands.ts:40,47`）、按显示语言的双语（`app-commands.ts:53`、`panel-commands.ts`、`part-commands.ts`）、公开状态求值时本地化（`commands/shared/plugin.ts:59-67`）。远程合同里结果的 `code` 放宽成 `Type.String()`（`contracts.ts:161`）。后端：命令只本地化标题，正文直接 reason；locale 只改 title。`keymap.ts:102` 把 reason 拼进 Error 记诊断，`failure-notice.ts:29` 又显示给用户，两边要的语言相反。
- 建议：前端：失败带稳定 `code` 和 `params`，`reason` 删掉或只留英文诊断，文案由命令所属插件命名空间出。后端：分域确定拥有者、稳定码、可用参数、安全 detail 与未知码通用说明；同步迁移实际主说明消费者；保留 `NOTIFIED` 白名单与 stale-target 不通知；`denied/unavailable/invalid-input` 跨域重名，不能拿裸 code 做全局消息键。

#### M2 窗口失败页与握手 message：在语言体系建立之前显示，reason 全是中文句子

- 来源：前端发现 3；后端 F01（握手部分）。
- 位置：`neuro-book/src/web/FailurePage.vue:24-45,69`；`web/host/window.ts:167-168,297,300-304,355-392`；`web/host/connection.ts:54,65,77,79,83`；`web/host/remote-session.ts:82-86,92,114,159-174`；`web/mount.ts:48-51`；对侧 `nb-runtime/src/remote/node.ts:1163-1164`、`router.ts:174,197,203`、`protocol.ts:307`。
- 现象：`WindowState` 六种失败状态都带整句 reason，来自五条路；失败页没有语言入口，也没有任何一处在引导完成前读取显示语言。后端：握手 message 改名 reason 后直接显示。
- 建议：前端：失败页只依赖 `WindowState` 状态码和少量固定文案，`reason` 作为英文诊断详情，不当主文案；握手帧 message 改英文，保留已有稳定 reason 码；要先定失败页用什么语言、怎么得到它（如跟随浏览器语言或两种都显示）；同时定 `RemoteConnectResult.message` 与 reject 帧 message 是诊断还是展示文字。后端：同 M1。

#### M3 `detail` 既是诊断又是展示文字，各域各自处理

- 来源：前端发现 4；后端 F01（设置 invalid 先译中文再当 reason、Story 保留 HTTP message 供页面直接显示，部分相关）。
- 位置：`FilesResult.detail`（`files/shared/contracts.ts:295-297`；`EditorGroup.vue:143,187,198`、`explorer/web/feedback-text.ts:27-44`、`controller.ts:509`）；设置 `setting-text.ts:22-46`；插件 `PluginsPage.vue:96-108,435`；Storage `WorkbenchStatusBar.vue:55-72`；项目 `projects/web/messages.ts:39-50,97-117`；前端自造 detail `files/web/client.ts:71,271,292,299`、`storage/web/plugin.ts:35`；后端 `settings/shared/layer-text.ts:101-135`、`nb-story/src/web/host/client.ts:120-123`。
- 现象：约八个域把后端 detail 当句子显示或拼接；路由层失败的 detail 在 `client.ts:307-313` 退回码或 `码（cause）`；码表对不认识的码写 `码：detail`，因此 detail 的语言就是用户看到的语言。（前端附录 A.1：原写的 `settings/web/settings-window.ts` 相关位置没有逐行核实，已核实的前端自造 detail 只有 `client.ts:71,271,292,299` 与 `storage/web/plugin.ts:35`。）
- 建议：前端：约定 detail 一律英文诊断，界面只在“详情”折叠里显示，码表覆盖不到的写通用文案加码。后端：见 M1。

#### M4 “结果未知”在命令层丢失，只剩一个 reason 字符串

- 来源：前端发现 2；后端 F10（相关，级别为迁移时注意，见 6.2 B3）。
- 位置：`editor/web/area.ts:62-68`（`ActionResult` 只有 reason）、`area.ts:884-910`（save 返回 `reason: result.code`；overwrite／saveAll 返回 `result.code` 或 `地址：code`）、`editor/web/commands.ts:118,137-138`（`fromAction` 一律折成 unavailable）；对侧 `files/shared/failures.ts` 的 `unknown-outcome`；`EditorGroup.vue:143,183-198` 单独处理了它。
- 现象：文件层区分“没写成”和“结果未知”，编辑器组按码处理；但经命令（保存、全部保存）走时码被当 reason 文字，命令层归入 unavailable，用户看到的是英文码或半句中文，无法与“没保存”区分。取消、保存失败、位置没变也靠 reason 文字区分（`area.ts:642-643,683,693`）。
- 建议：`ActionResult` 加 `code`，`fromAction` 按码映射命令失败码；`unknown-outcome` 要么成为命令失败码，要么保留在通知的 code 字段里。

#### M5 临时事件、权威日志与 QA 降级是三种投影，降级回放丢掉 `code`、`kind`

- 来源：前端发现 5；后端 F04。
- 位置：前端 `nb-story/src/web/qa/record-messages.ts:17,28`；对侧 `nb-story/src/contract/qa-record.ts:42`、`core/qa-records.ts:71,273,327,387`、`qa/engine.ts:322,345,350`；后端 `nb-story/src/qa/web-events.ts:19-45`、`server/qa-service.ts:175-179,379-388,566-576`、`web/qa/source.ts:127,184-195,242-247`、`nb-agent-ui/src/harness.ts:215-236,261-285,352-369`。
- 现象：QA SSE 工具结果截到 500 字且去掉 details；完整日志保留工具 details，前端适配器也能消费。正常日志 run_end 按 kind 本地化；日志不可用时 `record-messages` 只保留 `error.message`，直接变界面正文。持久化的 message 成了跨版本、跨语言的展示文字（语言取决于写入时的版本）。
- 建议：前端：回放用 `code`/`kind` 查消息键，message 只作未知码的兜底详情；要先定记录里 message 的语言（英文诊断）和回放是否按 code／kind 重新投影。后端：分开约定临时事件允许丢什么、日志权威字段、record 降级需要哪些稳定字段及未知／旧值回退；三条读路得到相同失败语义，不强制相同载荷或取消截断；把临时截断误判成权威数据丢失会导致不必要的持久格式迁移。

#### M6 入口与插件失败：`entryReason` 四份拷贝，插件专有码在生命周期摘要处丢失

- 来源：前端发现 6；后端 F02。
- 位置：前端 `settings/web/sections.ts:52-56`、`settings/web/choices.ts:52-55`、`workbench/web/views/registry.ts:49-52`，对侧 `plugin-platform/shared/problems.ts:31`；展示 `SettingsPageFrame.vue:81-87`、`WorkbenchViewFrame.vue:97-102`、`PluginsPage.vue:197`。后端 `neuro-book/src/plugin-platform/shared/plugin-code-error.ts:14-29`；`nb-runtime/src/lifecycle/scope.ts:69-84`、`src/plugins/host.ts:1122-1123`；`problems.ts:14-16,30-31`；`PluginsPage.vue:195-200,437`。
- 现象：同一函数写了四份，输出是 `${blocked.reason}：${blocked.key}`（英文码接中文冒号）、`failure.error.message`（插件抛出的原文）或 `failure.reason`；对侧那份写进 `PluginProblem.message`。后端：`PluginCodeError` 原有 code／plugin／entry／url，进入 FailureError 后只留 name／message；贡献验证仅留 invalid-declaration／detail，ManifestProblem 只有 path／message；UI 对 entry-failed 只能拼 message。
- 建议：前端：抽一个入口状态到消息键的函数，放在拥有 `EntryState` 的包，插件抛出的原文只作详情（ADR 要求用 `Error.cause`）。后端：t03 在摘要之前确定域拥有者如何提供安全的失败投影，明确哪些码／参数允许跨边界；不建任意异常字段透传器，不靠 message 还原结构；生命周期摘要有不携带资源值／凭据的安全目的。

#### M7 兜底 catch 按 `String(error)`／`error.message` 往上传

- 来源：前端发现 7。
- 位置：`error instanceof Error ? error.message : String(error)` 共 49 处、分布在 39 个文件（前端文件清单 grep 该字面量）；例 `remote-session.ts:187-189`（`describe`）、`window.ts:167-168`、`mount.ts:48-51`、`writes.ts:25`。
- 现象：兜底把第三方异常或自家中文 Error 的消息当 reason 往上传，最终在失败页、通知、面板里显示；第三方错误（浏览器的 `Failed to fetch`、`TypeError`）以英文原样出现在用户界面。
- 建议：t03 先给兜底规则（如“未知异常显示通用文案加类别，原文进诊断”）；提供统一 `describeUnknown(error)`，返回 `{code: "unexpected", cause}`，原文进诊断。

#### M8 nbdev：面板按文字分支，且直接复用命令行的中文校验函数

- 来源：前端发现 8（含附录 A.1 勘误）；后端 F05。
- 位置：前端 `dev-panel/src/web/host/writes.ts:137`（`failure.message.includes(path)` 决定是否追加“已写入、未提交”）、`:30-41`、`:125-135`（`listed` 逐条用 `problem.reason ?? problem.message` 与 `failure.message` 比较去重）；`AnswerForm.vue:4-5,78-86`、`NewTaskForm.vue:4-5,22-23` 直接 import `core/text-rules.ts:14-44`、`core/questions.ts:83-99`；对侧 `server/serve.ts:123`、`core/errors.ts:102-118`。后端 `core/text-rules.ts:14-37`、`core/questions.ts:54-98`；`web/parts/AnswerForm.vue:78-86,129`；`cli/output.ts:25-32,99-124`；`server/writes.ts:291-298`；`server/serve.ts:291-307`。
- 现象：校验函数返回 string／null，浏览器直接 import 并显示；服务侧再把同样的 reason join 到 NbdevError；CLI 和 HTTP 序列化同一个 message，面板 ApiError 取首错；终端 WS／搜索 NDJSON／元数据内 warning 不走同一 HTTP 外壳。前端勘误：把“message 改了措辞仍能匹配”的说法作废，改成英文或改文案后去重与补充提示的行为都会变；`details.writtenPaths` 已在 `writes.ts:27` 取出，可直接用。
- 建议：前端：校验函数改成返回 `{code,params}`，网页和 CLI 各自投影；`writes.ts:137` 改读 `writtenPaths`；要先定它是否属于“产品用户可见文字”。后端：先定共用校验的 code+参数合同、CLI 与面板各自的投影边界、warning／成功值内问题及多错处理；保留 nbdev 自有 `errors[]` 合同，不套产品统一错误对象；不能靠翻译一个 NbdevError 构造函数实现。

#### M9 nb-story 网页：没有语言策略，46 处绑定 `error.message`

- 来源：前端发现 9；后端 F01（Story 部分）。
- 位置：`nb-story/src/web/host/client.ts:32-41,115-123`（`StoryCallError`）、`qa/source.ts:171-247`、`host/ingest.ts:31-50`（七个停下原因，唯一的码表）、`pages/QaPage.vue:290,472`、`pages/*.vue`、`shell/*.vue`。
- 现象：服务端错误体 `{code,message,candidates}` 变成 `StoryCallError`，页面把 message 绑到 `PageState/PagedList.error`；只有抽取停下原因有码表；`candidates` 是结构化建议，被拼进文字里。
- 建议：先定 nb-story 的归属（跟随宿主语言，或自己单语）；然后 `StoryCallError` 保留 `code`，页面按码查表。nb-story 有独立包边界和独立命令行（nbstory），网页消息与命令行输出的关系要先定。

#### M10 共用组件的消息表机制不统一

- 来源：前端发现 10。
- 位置：`nb-agent-ui/src/messages.ts:189-195,389-395`（中英各一份，七个出错类别）、`nb-form/src/vue/messages.ts:61-141,195-260`（29 个码，中英各一份）、`nb-markdown/src/codec/write.ts:42-51,745`（`Unrepresentable`，无展示文字）、`nb-ui/src/components/layout/grid.ts`／`grid-types.ts:167-196`（`GridResult`）、`theme/theme-loader.ts:22-50`（`NbThemeInstallError`）。
- 现象：nb-agent-ui 与 nb-form 已有“码到文案”表并支持中英，语言由宿主传入；nb-markdown 与 nb-ui 把失败做成结构化结果，不带文案。四个包四种做法。
- 建议：以 nb-form 的 `FormIssue {path,code,params}` 加包内消息表为基线；t03 要决定“拥有者命名空间加码”的消息键放共享包还是由宿主注册。

#### M11 工具失败文字：同一份文字两个读者，领域工具没有独立 code，中性拒绝靠中文前缀

- 来源：前端发现 11；后端 F03。
- 位置：前端 `nb-agent-ui/src/harness.ts:229-235,365-369`、`vue/tools/AgentToolDetail.vue:33,58-60`、`AgentTurnBlock.vue:170`、`AgentRawView.vue:154,160`。后端 `nb-story/src/qa/read-ledger.ts:90-96`、`qa/tools.ts:72-74,105-114,137-143`；`nb-story/src/web/qa/tools.ts:20-44`。
- 现象：前端：工具结果失败时把 content 文本当 `call.error` 显示，该文字同时进入模型上下文；`run_end.error.kind` 只映射七个消息键，忽略 `error.message`（`harness.ts:104-111,282-285`）；助手消息上的 `errorMessage` 前端不读。后端：query 的 code／candidates 展平成 content.text，answer 校验只回字符串；`chapter_limit` 原有 code 在工具输出丢失，且 isError=false；`readRefused` 按 `result.text.startsWith("没有读：")` 判断，`chaptersPhrase` 据此排除没读章节；修改文字或语言会改变工具卡摘要与已读章数。
- 建议：前端：工具结果失败带 `code`（已有 `details` 可承载），界面优先按码，content 文本作详情。后端：同时定义失败和中性拒绝的领域结果参数、`details.code` 及 UI 读取口径，明确旧日志无 code 时的读取策略；章数上限仍是正常拒绝，不要通过把 isError 改 true 规避。

#### M12 线协议、业务合同、控制 IPC 与磁盘格式不是同一个版本边界

- 来源：后端 F06。
- 位置：`nb-runtime/src/remote/protocol.ts:14-21`、`node.ts:699-710,867-879`；`neuro-book/src/server/projects/ipc.ts:18-29`；`src/plugins/plugins/shared/contracts.ts:21-34`；`src/plugins/http/backend/dispatch.ts:221-222`；`src/plugins/projects/web/plugin.ts:196-198`。
- 现象：wire 4 约束远程帧语义，每个 errors／detail 又有闭合业务 schema；项目 started failed 信封只有 detail，无独立版本；HTTP 另有宿主 error 外壳、封面顶层 code／detail、nbstory 顶层 code／message、nbdev `errors[]`，不能互读；封面 reader 对宿主外壳实际丢正文，只剩 status／statusText。
- 建议：t03 逐域写清受影响 schema／帧／控制信封、版本与旧消费者拒绝／回退方式；保持四种 HTTP 合同的拥有者与用途；raw route 的安全 not-found 折叠继续保留，不能为显全码泄漏保护路径。

#### M13 旧错误文字、旧会话可读与旧会话可续跑是不同问题

- 来源：后端 F07（前端发现 5 的持久化 message 部分相关，见 M5）。
- 位置：`nb-session/src/entries.ts:133-184`、`jsonl-log.ts:12-27,73-84,99-107`；`nb-harness/src/harness.ts:110-121`、`tools/effective.ts:115-141`；`nb-story/src/core/qa-records.ts:169-207,266-276,361-397`；`ingest/job.ts:243-250`；`dev-panel/src/core/notify.ts:214-235`。
- 现象：session 无格式版本，旧条目外层可解析但无 session_snapshot 不能恢复；工具声明按 exact 比对，description 改动也会拒绝；QA 支持旧单轮与旧日志名，当前日志和 record 还有哈希配对；ingest `usage.error` 保存 message 无 kind／status；通知／审计／进程记录各有 schema，Task evidence 原字节显示。
- 建议：t03 明确每种旧读的保留、未知码与无结构字段回退；日志可浏览与可继续分别验收；保持历史原字节，不批量改写 QA／session／Task 证据；Profile／工具声明语言变化按既有版本与质量合同另定，不借诊断迁移顺带改提示词。

#### M14 `problems()` 没有产品调用方，状态栏存储码表缺 10 个码

- 来源：前端发现 12。
- 位置：`nb-agent-ui/src/harness.ts:25-28,141-142`；`workbench/web/components/WorkbenchStatusBar.vue:55-72`（7 个码，对 14 个存储码）；`neuro-book/src/shared/storage.ts:139-154`。
- 现象：适配器暴露问题列表，仓库里没有调用方；状态栏存储码表只覆盖 7 个，其余直接显示码。
- 建议：给 `problems()` 找到展示位或删掉；存储码表补齐并用类型保证穷举；迁移时容易被当作“已覆盖”，在 t03 计划里单列。

#### M15 分区缺口：`projects/project/` 与 `plugins/*/testing/`

- 来源：前端发现 13（及附录 A.1 补充）；主会话已补查。
- 位置：`neuro-book/src/plugins/projects/project/`（`plugin.ts`、`stats-tracker.ts`、`stats-writer.ts`）；`explorer/testing`、`files/testing`、`settings/testing`、`storage/testing`。
- 现象：按“`web/` 目录加指定包”划分前端时，这两处既不是 `web/` 也不明确属后端；前端未盘点，也没有读目录内容。
- 建议：前端：t02 汇总时指定归属。处理状态：主会话补查已补入 `MC-01`、`MC-02`（见第 3.8 节）。

#### M16 示例插件的失败写法是教学材料，需随规范一起改

- 来源：前端发现 14（含附录 A.1 位置更正）。
- 位置：`neuro-book/plugin-sdk/examples/plugins/{focus,notes,counter,snippets}`；`focus/web/plugin.ts:54`、`focus/web/focus-store.ts:105-127`、`notes/web/plugin.ts:68`、`notes/backend/plugin.ts:52-54,72,155,165`、`counter/shared/contracts.ts:73-77`（`FC-53` 至 `FC-57`）。
- 现象：示例里直接 `throw new Error("中文句子")` 或把 reason 写成中文，是第三方作者会照抄的写法；`counter` 已是中英双语 reason，是示例里唯一符合方向的写法。
- 建议：把示例改动列为 t03 的验收项（AGENTS.md 规定示例注释随场景测试一起改）。

#### M17 测试断言里的中文字面量会随迁移整批失败，不能机械重钉为英文（级别两边不同）

- 来源：前端发现 15（“为什么要先定”）；后端 F11（列在 5.2 迁移时注意，严重程度“建议”）。
- 位置：前端 20 个文件（命令 C6，候选未逐个核实）：见 3.5 节“Task 证据与测试断言”行；后端 `neuro-book/src/plugin-platform/backend/loader.test.ts:108,163,176,182`；`nb-harness/tests/read-tool.test.ts:53-54,65-68,77-85`；`nb-session/tests/session-log.test.ts:182,193-195`；`dev-panel/src/core/questions.test.ts:60`；OMP 原生编辑文本 `packages/nb-harness/docs/omp-capabilities.md:107-111,141`。
- 现象：在 reason／message／detail 断言行写中文字面量，迁移到码加消息键后会失败；其中 Error.message 包含码是插件摘要结构不足的症状；OMP 原生编辑文本有明确上游训练合同，不能与自写诊断措辞混为一类。
- 建议：前端：迁移时同步把断言改成码，不是改成新文案；t03 的验收需要区分“测试写错了”和“行为变了”。后端：t04 删除无合同理由的内部措辞断言，以稳定码、状态、可观察磁盘／恢复行为验收，原生工具文本例外保持；不通过跳过或放宽断言掩盖缺失的结构投影。

### 6.2 迁移时注意

#### B1 有些包装分支没有 `Error.cause`，不能靠新英文 message 恢复原始诊断

- 来源：后端 F08（建议）。
- 位置：`neuro-book/src/plugin-platform/web/plugin-code.ts:233-247`；`src/server/projects/ipc.ts:18-29`；`nb-workflow/src/runner-execution.ts:156-175`。
- 现象：浏览器 hostModules 包装保留 cause，但工厂 code-threw／module-not-shared 只取 error.message（:234 与 :246-247 两个分支）；跨项目 `started.detail` 也是摘要；Workflow `Run.error` 只剩 string。
- 建议：在拥有真实 Error 的进程内包装点保留标准 cause；跨边界决定安全结构投影，不传 stack／原始值给用户；t04 区分“原始外错保留”和“本项目诊断英文”，不翻译第三方原文。

#### B2 CLI 插件日志绕开诊断 store；迁移单一出口会漏路径

- 来源：后端 F09。
- 位置：`neuro-book/src/cli/plugin.ts:52-64`；`nb-runtime/src/diagnostics/store.ts:252-261`、`redaction.ts:67-80`；`neuro-book/src/plugins/diagnostics/backend/jsonl-exporter.ts:161-179,229-238`。
- 现象：CLI 自己 JSON.stringify DiagnosticInput 写 `cli.jsonl`，Error 只 name／message，无 store 的脱敏／大小约束；主诊断 store 保留安全 error.cause，但不保留 Error.code；JSONL 丢 sequence，最小 stderr 再丢 data／error。静态暴露路径，未证明发生过真实凭据泄漏。
- 建议：t03／t04 把 CLI recorder 与 stderr 兜底纳入诊断边界，明确安全字段／限制和可检索码的位置；不趁本次盘点重构日志；不要为保留 cause／码而扩大用户可见负载。

#### B3 状态拒绝、取消与结果未知不能在文案目录里合并成“失败，可重试”

- 来源：后端 F10；前端发现 2（M4）相关。
- 位置：`nb-runtime/src/remote/protocol.ts:63-83`；`neuro-book/src/shared/store/persisted.ts:377-405`；`src/plugins/storage/backend/partition.ts:294-300`；`dev-panel/src/core/notify.ts:20-28`；`nb-workflow/src/runner-execution.ts:156-175`；`owned-process/src/types.ts:4-18,48-58`；`nb-story/src/ingest/runner.ts:138-154`。
- 现象：已发出写请求中断是 unknown-outcome；store 留 pending value／expect；corrupt／unsupported-version 是记录保护态，而不支持分区库格式报 io-error；通知 uncertain 可能已送达，不能重发；workflow waiting／cancelled 与 failed 分开；自然非零进程退出是 completion；抽取 stopRequested 将 failed 映为 stopped。
- 建议：每个域的投影合同和验收分别保留失败／取消／中性拒绝／未知结果／保护态；文案不得承诺未写入或安全重试；不统一 `retryable=true`，不因中文相似合码。

#### B4 未接产品的基础库仍有独立失败语义，不虚构持久化与迁移消费者

- 来源：后端 F12（建议）。
- 位置：`nb-workflow/src/backend.ts:39-59`、`runner-run-store.ts:120-147`；`nb-history/src/types.ts:153-181`；`nb-memory/src/ingest/extract.ts:109-122`、`retrieval/llm-planner.ts:78-89`；`file-snapshot-cache/src/snapshot-cache.ts:324,340,410-416`。
- 现象：Workflow 有 durable 端口合同但自带 backend 只有 memory；History SQLite 保存操作／快照而非异常；Memory 降级只留计数／布尔，异常没先记日志；snapshot 的 lastBuildError 截断而 watcherError 不同。在 neuro-book／nb-story／dev-panel 的 src 范围搜索五个包名没有生产 import（负证据，不否定外部或未来集成）。
- 建议：t03 分“库公开合同”和“已接产品出口”，只对真实记录格式讨论旧读；缺失诊断原因是单独可观察性决定，不在语言迁移中顺带加重试／日志／新存储。

### 6.3 清单小结

- 必须先定：17 条（M1 至 M17）。其中来自后端“必须先定”F01 至 F07 的：M1、M2、M3（F01 部分）、M5（F04）、M6（F02）、M8（F05）、M9（F01 部分）、M11（F03）、M12（F06）、M13（F07），共覆盖 F01 至 F07 全部七条；只来自前端的：M4、M7、M10、M14、M15、M16、M17（M17 另有后端 F11，级别两边不同）。
- 迁移时注意：4 条（B1 至 B4，分别来自后端 F08、F09、F10、F12）；后端 F11 因级别两边不同已归入 M17。
- 合并前总数：后端 12 条、前端 15 条；合并后 21 条，其中重复合成的见各条“来源”。
- 后端 5.3 列出的“未发现问题的方面”（remote 对已发出写请求保留 unknown-outcome；Harness Provider 分类按 status／flags 而非 message；QA 保存成败独立于模型轮结果；nb-session 中断尾拒绝 append、repair 显式执行；Storage 保护态不当作 absent；OMP 原生编辑错误保留英文有记录依据）见后端报告 5.3，均为静态结论。

## 7. 未追到汇总

来源：前端报告附录 A.3（10 项）；后端报告 3.3 表（4 项“未追到”、1 项“无法分类”）与 3.4 终轮更正（1 项）。“对侧已追到”指对侧报告在代码里追到了这一项，写对侧的通道 ID；对侧位置在本合并稿里只引用对侧报告原话，没有重新回代码核实。

### 7.1 逐项汇总

| # | 来源 | 未追到的对象 | 对侧报告有没有追到 | 结论 |
|---|---|---|---|---|
| 1 | 前端 A.3-1 | `fe.diagnostics.browser`：记录是否带版本 | 后端 `diagnostics.store` 版本栏：“进程内无版本，文件出口另列”；`B-DIAG-QUERY`：“无旧数据重建、无版本”；`B-DIAG-JSONL`：“无行 schema 版本”（后端说的是服务端记录，浏览器出口未单独写） | **对侧已追到** `B-DIAG-QUERY`、`B-DIAG-JSONL`（范围为同一 `DiagnosticRecord` 类型的服务端侧；浏览器出口的版本后端未单独写） |
| 2 | 前端 A.3-2 | `FC-17` 面包屑目录读取：具体实现文件（`BreadcrumbListing` 的实现） | 后端无对应 | 留着 |
| 3 | 前端 A.3-3 | `FC-27` 项目未绑定的存储：调用方的处理 | 后端 `B-STORAGE-STATE` 只追到存储提供者与 `explorer`／`editor` 的状态消费，未写 `no-project` 调用方 | 留着 |
| 4 | 前端 A.3-4 | `FC-30` 封面上传：服务端错误体生产者（`src/server/*`） | 后端 `B-HTTP-COVER`（`cover-routes.ts:42,60-89,115-122,143-144`）、`B-HTTP-HOST` | **对侧已追到** `B-HTTP-COVER`、`B-HTTP-HOST` |
| 5 | 前端 A.3-5 | `FC-36` SDK 定义期错误：展示去处（对侧 `plugin-platform`） | 后端 `B-PLUGIN-CODE-SERVER`、`B-PLUGIN-CODE-BROWSER` 追到装载失败到 `PluginsPage.vue`，但没有写明 `sdk/plugin.ts` 的定义期 `TypeError` 对应其中哪一条 | 留着（后端有相邻通道，未明确对应） |
| 6 | 前端 A.3-6 | `FC-37` 主题装载失败：`main.ts` 之外的捕获 | 后端无对应 | 留着 |
| 7 | 前端 A.3-7 | `FC-47` 抽取停下：状态落盘位置 | 后端 `B-INGEST-STATE`：`<library>/.ingest/<id>/state.json`（`core/library.ts:140-141`、`ingest/store.ts:89-90`） | **对侧已追到** `B-INGEST-STATE` |
| 8 | 前端 A.3-8（必查 5d） | 浏览器插件代码装载失败（`code-load-failed`、`module-not-shared`） | 后端 `B-PLUGIN-CODE-BROWSER` | **对侧已追到** `B-PLUGIN-CODE-BROWSER` |
| 9 | 前端 A.3-9（必查 7b） | Storage 订阅结束 | 后端 `B-STORAGE-END` 追到 | **对侧已追到** `B-STORAGE-END`；同时是必查表“不一致”项（前端原话与后端消费者位置，见第 4 节 7b） |
| 10 | 前端 A.3-10（必查 9c） | HTTP 中间件的错误 | 后端 `B-HTTP-HOST`、`B-HTTP-COVER`（bodyLimit）、`B-NBDEV-HTTP`（`serve.ts:351-355`） | **对侧已追到** `B-HTTP-HOST`、`B-HTTP-COVER`、`B-NBDEV-HTTP` |
| 11 | 后端 3.3-1 | 诊断查询的产品 UI／HTTP reader | 前端必查 1b：“无：前端文件清单里没有调用 `query`、`snapshot`、`recent` 的代码（命令 C1）”——是前端范围内的“无命中”，不是追到了 reader | 留着；后端要求“合并主会话可核前端是否有动态消费”，前端只有静态命令 C1 的结果；两边在必查 1b 标“不一致” |
| 12 | 后端 3.3-2 | 通用 HTTP error 外壳的统一 reader | 前端必查 9b 列 `FC-30`、`FC-43`、`FC-49` 各自 reader，未列 `{error:{code,message}}` 外壳的 reader | 留着 |
| 13 | 后端 3.3-3 | 第三方工具抛错→OMP toolResult 的外部内部实现（`@oh-my-pi/pi-agent-core` 18.2.5，worktree 中 node_modules 不可读） | 前端无对应 | 留着 |
| 14 | 后端 3.3-4 | nbdev `audit.jsonl` 历史消费 UI | 前端无对应 | 留着 |
| 15 | 后端 3.4 | `complete()` 的产品消费者 | 前端：“前端清单里没有 `nb-harness` 的运行时调用，只有类型与目录读取”，无 complete 消费者 | 留着 |

后端 3.3 第五行“计数中多读者、嵌套回调或非调用文字”标为“无法分类（不是漏掉必查通道）”，不是未追到，不计入上表；见第 5 节后端无法分类 58 个。

### 7.2 汇总数

- 两边“未追到”项合计 15 项（前端 10、后端 5）。
- 其中“对侧已追到”6 项（#1、#4、#7、#8、#9、#10）。
- 合并时仍未追到 9 项（#2、#3、#5、#6、#11、#12、#13、#14、#15）；主会话补追到 #2（见 9.4），其余 8 项交 t03（见 9.5）。
- 其中 #11 在必查表标“不一致”。

### 7.3 报告里另外标注了“未逐个追”“未验证”“未逐条数”的对象（不计入上面的项数）

| 来源 | 对象 |
|---|---|
| 前端 `FC-14` | 对侧提供者 `plugins/files/backend/*`“未逐个追”（后端 `B-FILES-BUSINESS` 追到了 `files-service.ts`） |
| 前端 `FC-20` | 对侧 `settings/backend/*`“未逐个追”（后端 `B-SETTINGS-WRITE` 追到了 `layer-owner.ts`、`owner-link.ts`） |
| 前端 `FC-28` | 对侧 `plugins/projects/backend/*`“未逐个追”（后端 `B-PROJECTS-BUSINESS`） |
| 前端 `x.nbdev.terminal`、`FC-52` | 终端帧 `code` 取值“未逐个追”（后端 `B-NBDEV-TERMINAL` 追到 `terminal-hub.ts:95-105,269-271,297-314,343-347`） |
| 前端 `FC-08` | `main.ts` 没有 catch 时的实际表现“未验证” |
| 前端 `FC-10` | 语言切换后已缓存字符串不会重取“未验证” |
| 前端 `fe.ui.grid` | 栅格快照版本“未展开” |
| 前端 4.4 | “项目登记失败”“图片查看拒绝”两张码表的条目数“未逐条数” |
| 前端必查 19 | 20 个测试文件的断言对象“未逐个核实”（候选） |
| 后端各通道“模型：未追到” | `B-DIAG-JSONL`、`B-DIAG-FALLBACK`、`B-HOST-EMERGENCY`、`B-REMOTE-HANDSHAKE`、`B-REMOTE-ROUTE`（仅特定工具桥）、`B-PLUGIN-VALIDATION`、`B-PLUGINS-INSTALL`（CLI 自动上下文接线）、`B-PLUGINS-NOTLOADED`、`B-PLUGIN-CODE-SERVER`、`B-PLUGIN-CODE-BROWSER`、`B-SETTINGS-WRITE`、`B-STORAGE-STATE`、`B-STORAGE-END`、`B-STORE-FAILURE`、`B-PROJECT-IPC`、`B-PROJECTS-BUSINESS`、`B-FILES-BUSINESS`、`B-REMOTE-END`、`B-COMMAND-RESULT`（生产的模型命令工具消费者） |
| 主会话补查 | `MC-01`、`MC-02` 是主会话给的位置，本合并稿未回代码重新核对（`MC-01` 的“约 15 条”与 `projects/project/` 目录里 `record(` 命中行数的核对见第 8.5 节） |

## 8. 两边的自我更正、局限与随机抽样结果

原样汇总各报告自己写下的更正、局限与抽样。未改写其结论。

### 8.1 前端报告

自我更正（附录 A.1，附录与正文冲突以附录为准）：

1. 发现 8 的描述不准确：`dev-panel/src/web/host/writes.ts:137` 的 `failure.message.includes(path)` 是对 message 做子串匹配，决定是否补一条“已写入、未提交：路径”；`:125-135` 一带的 `listed` 逐条用 `problem.reason ?? problem.message` 与 `failure.message` 比较去重，同样是文字比较。“如果 message 改了措辞仍能匹配”的说法作废：改成英文或改了文案后，去重与补充提示的行为都会变。`details.writtenPaths` 已在 `writes.ts:27` 取出，可以直接用。严重度不变。
2. 发现 4 的位置里“`settings/web/settings-window.ts` 相关”写得含糊，没有逐行核实；前端自造 detail 的已核实位置只有 `files/web/client.ts:71,271,292,299` 与 `storage/web/plugin.ts:35`。
3. 发现 14 的位置不准确，改为示例插件里失败文字的四种写法，见 `FC-53` 至 `FC-57`；`counter` 已是中英双语 reason，是示例里唯一符合方向的写法。
4. 发现 13 补充核实：`projects/project/` 下有 `plugin.ts`、`stats-tracker.ts`、`stats-writer.ts`；`explorer/testing`、`files/testing`、`settings/testing`、`storage/testing` 四个目录存在；前端没有读这几个目录里的内容，不能说它们有或没有失败文字。
5. 第 3 节第 18 行和第 4 节写的“其中 234 个测试与辅助文件”与第 4.5 节的 237 个不一致：以 237 个（含 3 个 `*.typecheck.ts`）为准。
6. 报告头：第 0 节是过程中逐条追加的核实笔记，第 1 到 5 节是按计划格式整理的正文，两者冲突以第 1 到 5 节为准。

局限（前端原话汇总）：

- 路径约定、计数口径：计数单位是汇点不是行；双语 `{zh-CN,en-US}` 条目、`describe(error)` 类辅助函数不在汇点里；“用户文案”只数结果字段里的句子，界面文字目录（877 行候选）属 w00028，没有计入。
- 原始匹配数与 AST 汇点数对不上（类型声明、同行多个、与错误无关的 `.message`）。
- “无”的核对命令 C1 至 C6 在第 3 节末；C4 的结果是“前端没有订阅 Storage 的结束事件”，不等于规格没要求；C6 为候选数，没有逐个核实断言对象。
- 前端分区没有一条通道把失败文字写进模型上下文，也没有一条把失败文字落盘（落盘发生在对侧）；“提示词”“领域内容”在前端分区为 0。
- 对侧位置标明“已追到文件:行”，但对侧提供者多处“未逐个追”（见 7.3）。
- Task 证据（`evidences/`、`artifacts/`）本分区未读，交主会话合并时处理。
- 第 2.1 节 FC-08 的 `main.ts` 无 catch 实际表现“未验证”；`FC-10` 缓存字符串是否随语言切换“未验证”。
- `count.ts` 借用主工作区 `node_modules` 里的 `typescript` 与 `@vue/compiler-sfc`，不在 worktree 里安装任何东西。
- 报告写明“每条的‘现象’都回到了代码；没有跑过运行时的写‘从代码推断’”。

随机抽样：前端报告没有写随机抽样结果。后端报告 3.2 写明“前端分区五行与合并总表由主会话负责，不在此虚报已完成”；计划写明“每个分区再随机抽 5 行”。因此前端 5 行的抽样**未在两份报告中出现**，需主会话补做。

### 8.2 后端报告

自我更正与追加更正（其 2.7、3.4、5.4 节，优先于前表）：

1. `B-COMMAND-NOTICE` 已追到最终绘制：`notifications.ts:42-50`→`WorkbenchNotifications.vue:17`→`nb-ui` `NotificationStack.vue:52-58`→`Notification.vue:59-60`；locale 只改 title，原因正文没翻译。
2. `B-AGENT-LOG-REPLAY` 的确切接合：`qa-service.ts:97-99` projection 只处理全读首轮原文；`web/qa/source.ts:184-195,242-247` snapshot／log 应用 entries，event 才 applyEvent；:127 日志不可用走 messagesFromRecord。
3. `B-HARNESS-RUN`、`B-AGENT-SSE`、`B-SESSION-JSONL` 前表的 nb-agent-ui 行号以更正为准：日志工具结果 `nb-agent-ui/src/harness.ts:215-236` 保留 `message.details`；run_end 归类文案 :261-285；此前 `245-274` 覆盖 usage 与取消分支，不能单凭该范围声称包含完整错误本地化。
4. `B-QA-RECORD` 保存失败显示：`QaPage.vue:470-472`，:157 损坏记录显示 problem，:346-347 开始失败直接 error.message。
5. `B-INGEST-STATE` 的实际路径是 `<library>/.ingest/<id>/state.json`（更正前表漏点）；失败文字显示 `IngestPage.vue:209-214`；动作错误 :135-156。
6. `B-PROJECT-IPC` 完整结果路径补齐（`children.ts:244-255`、:151-152、`manager.ts:237-238`）；不存在“把所有项目创建失败都当业务远程 error 帧”的保证。
7. `B-FILES-RAW-HTTP` 已追到消费者：`ImageViewer.vue:55-59,85-91` 不读 JSON 失败体，按 HTTP 状态取双语文案；:119-124 网络异常才原样插 error.message。
8. `B-SCRIPT-EVIDENCE` 截图失败包装：`dev-panel/src/dev/shot.ts:55-66` 收 stderr 最后 4000 字符再取末 10 行包 shot_failed，不是整个 report.json 转发。
9. `snapshot.failure` 域表“文字有界”只适用 lastBuildError；watcherError 原样 message（:324,340）。
10. 路径歧义说明：1.1 表仅写 `src/...` 的路径均属 nb-runtime；1.2 的应用路径属 neuro-book；表中其他跨包位置写完整包路径。
11. `B-HARNESS-COMPLETE`（3.4）：nb-story 的 probe 不是 `complete()` 的消费者，实际使用 `createHarness`、`createMemorySessionLog`、`harness.turn`；其两个出口是 `cli/config.ts:295-313` 与 `server/qa-service.ts:521-535`→`web/shell/SettingsPage.vue:288-290,398-400`；归 `B-HARNESS-RUN`；complete() 产品消费者未追到。
12. `B-INGEST-CHECKLIST`（3.4）：不是所有 warning 都进入模型；`chapter.ts:112-119` 仅取本章 error、`secret-missing` warning 及 records 关联本章的全图 error；其它 warning 可由 `job.ts:159,178-179` 展平后保存，并非默认进入下一次修复请求；`draft-tools.ts:413-486` 的整理 dropped 经 `chapter.ts:303-309`→`job.ts:164,178-179` 保存，没有查到再交模型的接线；前表“章节 problems 由 CLI 直接读”不作已证实消费者（`status.ts:152-158` 不返回该字段）。
13. `B-INGEST-STATE`（3.4）：`usage.jsonl` 的 `.error` 不是 kind 或归类字符串，实际 `job.ts:243-250` 保存 `attempt.error?.message ?? null`；`activity.jsonl` 的 chapter-end.outcome 才是 committed／stopped／failed 枚举。
14. `plugins.install` 远程合同版本精确为 4（`plugins/plugins/shared/contracts.ts:21-34`）；登记表 `nbook.plugins/v1`、wire 4、合同 version 4 是不同层次。
15. `PluginsPage.vue` 完整路径统一为 `packages/neuro-book/src/plugins/plugins/web/components/PluginsPage.vue`；`B-TEST-ASSERTIONS` 的 OMP 能力文档完整路径为 `packages/nb-harness/docs/omp-capabilities.md:107-111,141`。
16. “无错误历史 reader”的表述仅指本次限定源码范围未找到专用产品 reader；开发者自行读 JSONL／Task 证据与外部消费者不在否定范围。
17. 5.4：`B-WORKFLOW-STATE` 的 `demo/guide.mjs:435-443` 观察的是基础设施 Promise 拒绝，应归 `B-WORKFLOW-CONTROL`；RunView／状态示例消费者改看 `demo/guide.mjs:85-94,181-195`，没有查到示例显示 Run.error 的位置。
18. 5.4：F01 至 F10 的 `src/...` 简写路径归属的逐条说明（F01 至 F10 各自的包前缀）。
19. 计数更正（4.2）：4.1 引用的早期“88 对”不能作为最终证据，终轮为 111 对、涉及 156 个调用，仅为按行的疑似包含。
20. 核查过程（5.4）：两次 lab 脚本失败均已修正——一次 file+line 同行调用分类冲突改为精确 key；一次结构核查误把生产者列当错误域列；一次报告追加调用在工具执行前断开，重新读报告锚点后继续，仅追加一次；它们不是产品失败，不进入错误条目计数。

局限（后端原话汇总）：

- 只读静态盘点：不安装、不跑测试或开发服务、不修改仓库；“静态代码核实，不是运行验证”；语言描述的是基线现状，不把迁移前的中文诊断直接当作新增违规；没有迁移器时不推断旧数据能读。
- 计数：扫描器只读 Git 已跟踪文件；不遍历依赖、未跟踪文件；不跨前端文件计数；不执行代码、不展开变量、不跟踪跨函数数据流；静态 message 目录、中文 `PARSE_ERRORS` 常量表、Markdown Skill／rules 不因没有调用祖先而得到候选；调用表达式覆盖回调时文字可能在回调里；Vue SFC 仅有 `HelloView.vue` 的 40 条解析诊断，不宣称完整覆盖 SFC；不统计全 Markdown／JSON 配置文字量；不覆盖纯英文错误、动态第三方实现、Vue 模板语法；`file-snapshot-cache` 的 0 候选不等于 0 错误；“计数用于检索与估计分布，不能替代 41 个错误域／64 条通道的迁移验收”。
- 第三方 OMP 18.2.5 内部 throw→toolResult 超出可读源码；产品诊断页、通用 HTTP reader、审计历史 UI 没有实际接线证据。
- `bun run docs:check`、`bun run governance:check` 未运行；未 commit／push／stash／切分支。
- 复盘回写建议 R1（未获批准，不改规范）：“调用点按 file:line:column 或 AST 起点标识；同一行有多个调用时不用 file:line 单独分派分类；跨回调的外层构造单列混合用途原因”，目标位置“若 t02 方法被保留为后续规范，写入该方法的原真相源”。
- 报告结构自检：五个二级节顺序一致，41 域、64 个唯一通道，未定义域／通道引用均为 0；2,400 个调用 key 唯一；58 个保留项均有原因；Markdown 表格 17 张列数一致；旧报告前缀 SHA-256 未变（该前缀证明只覆盖恢复后的追加）。

定向核对与随机抽样（后端 3.2、3.5）：

- 定向核对：命令通知、SSE／日志／QA 降级、nbdev 共用校验、握手、设置 invalid、Storage 保护态，均已从生产者追到实际消费者；证据是源码，不是运行截图。
- 后端随机抽样 5 条：固定 seed `65d9daea06616b8fc8459bc7ef9cb2132cee25ed/backend`，对 `seed + "/" + ID` 取 SHA-256、按 hex 升序选前五，候选全集为第二节 64 个不同通道 ID；脚本与全集在 `lab-backend/check-audit.mjs`、`sample-channels.json`。

| 样本 | 字段路径与生产者 | 每跳与实际消费者 | 抽查结论 |
|---|---|---|---|
| `B-HTTP-HOST` | `plugins/http/backend/dispatch.ts:75-78,95-144` 的状态／code／message；:221-222 `{error:{code,message}}` | 异常交 reportError，公开体固定安全文案；`projects/web/plugin.ts:196-198,205-215` 读顶层 code／detail，宿主拒绝走状态／statusText 回退；`shelf-page.ts:370-371` 把剩余 detail／code 入通知；未发现统一错误体 reader | HTTP 体不持久化；核实了形状不一致导致正文不可用，没有把响应可收到误写成用户已看到正文 |
| `B-REMOTE-HANDSHAKE` | `nb-runtime/src/remote/router.ts:284-286,319-327` reject.reason／message；`protocol.ts:14-21` wire 4 | `node.ts:348-370` 接收、终态替换；`remote-session.ts:82-86,159-174` 保留／拼接 message 并改名 reason；`window.ts:215-218`→`FailurePage.vue:30-41,68-69` 原样插值 | 不持久化握手；wire 版本约束与业务合同版本分开；失败正文仍由底层生产 |
| `B-PLUGIN-CODE-BROWSER` | `plugin-platform/web/plugin-code.ts:194-206,219-220,233-250`；PluginCodeError.code／plugin／entry／url／message | `nb-runtime/src/plugins/host.ts:1122-1123`→`lifecycle/scope.ts:69-84` 仅 name／message；`problems.ts:30-31` 仅 message；`window-plugins.ts:49-55` retry 原样取 message；`PluginsPage.vue:157-159,195-200,437` | 问题是当前实例态，不单独落盘；工厂 throw 分支 :246-247 未传 cause，hostModules 分支 :234 有 cause |
| `B-PLUGIN-VALIDATION` | `nb-runtime/src/plugins/host.ts:878-894` invalid-declaration／detail | `problems.ts:14-16`→`backend/inventory.ts:309-323`；`plugins/plugins/backend/plugin.ts:43-47` list 经远程；`PluginsPage.vue:195-200,437` 本地化外壳、原样 detail | 运行校验问题不落盘；顶层 rejection reason 不等于逐条校验码 |
| `B-DEV-HOST` | HTTP：`server/dev/frontend.ts:75-79`；样例：`server/dev/sample.ts:217-228` report(string) | `server/development-main.ts:19-20` console.log→开发日志；`dev-panel/src/dev/ready.ts:77-105` 解析英文状态前缀、保留后面的 reason；`dev/sample.ts:43-46,55-61,101-122`→`dev-ops.ts:44-45` DevEvent→`cli/dev-commands.ts:34-40,161` | 只按 `[dev] sample-failed` 稳定标记分支，不是按中文原因分支；sample 失败不等于后端服务未就绪 |

后端报告结尾：“后端五条均完成源码抽查。前端五条及全分区合并验收不属于本文件的已完成声明。”

### 8.3 计划里要求的合并时核对：本合并稿的状态

- 定向核对高风险链路（命令失败通知、SSE 与权威日志与 QA 降级、nbdev 共用校验、远程握手、状态型拒绝）：后端报告写明已逐跳到代码；前端报告没有写独立的定向核对结果。本合并稿是整理，没有重新回代码核对。
- 随机抽样：后端 5 条见上；前端 5 条未出现在报告里；主会话“每个分区再随机抽 5 行”的 10 个样本，目前只有 5 个有结果。
- 补漏：对照必查表的“未追到”，见第 7 节。
- 计划完成判据中“合并后没有剩下‘未追到’”：当前仍有 9 项，原因见第 7 节；计划允许“追不到的写明原因并交 t03”。

### 8.4 主会话补查

- 范围：`projects/project/` 的统计逻辑与各插件 `testing/`，原因：前端发现 13 指出两个分区都未盘（前端按计划字面划分，后端范围也不含）。
- 内容：见 `MC-01`、`MC-02`。

### 8.5 合并时顺手核对的一处计数（只记事实）

- `MC-01`：主会话口径“约 15 条诊断”；合并时在基线 worktree 对 `packages/neuro-book/src/plugins/projects/project/` 运行 `grep -c 'record('`，`stats-tracker.ts` 10 行、`stats-writer.ts` 10 行、`plugin.ts` 2 行（各含 `record(` 调用与定义行）；`stats-tracker.ts:209、418、447、463`、`stats-writer.ts:65,85,89,104,110,124,127,130`、`plugin.ts:70` 的 `record({level…,event:"projects.stats.*"…})` 消息均为中文。此数字未改写主会话口径，只是记下。
- `MC-02`：在基线 worktree 对 `explorer/testing/world.ts`、`files/testing/scene.ts`、`files/testing/tap.ts`、`settings/testing/world.ts`、`settings/testing/standalone.ts`、`storage/testing/world.ts` 抽查，`throw new Error` 带中文字面量的有 explorer（`world.ts:88,97`）、files（`scene.ts:54,59`）、settings（`world.ts:76,102,121,144,154`）、storage（`world.ts:64,100,122,131`）。

## 9. 主会话合并核对（2026-10-27）

### 9.1 定向核对的高风险链路

回到基线代码逐跳确认，都属实：

| 链路 | 核对位置 |
|---|---|
| 命令失败通知以 `reason` 当正文 | `workbench/web/commands/failure-notice.ts:23-29` |
| 编辑器失败：中文句子与裸码混在 `reason`，经 `fromAction` 一律归 `unavailable` | `editor/web/area.ts:886-907`、`editor/web/commands.ts:137-138` |
| 问答记录降级只用 `error.message` | `nb-story/src/web/qa/record-messages.ts:17,28` |
| 领域工具靠中文前缀“没有读：”判断章数上限 | `nb-story/src/qa/read-ledger.ts:95`、`nb-story/src/web/qa/tools.ts:20-22` |
| nbdev 面板直接 import 共用校验，返回中文 | `dev-panel/src/web/parts/AnswerForm.vue:4-5,78`、`dev-panel/src/core/text-rules.ts:14-20` |
| 握手 `message` 原样进失败页 | `neuro-book/src/web/host/remote-session.ts:82-86`、`web/FailurePage.vue:31` |
| 设置解析先把错误码译成中文再当原因 | `settings/shared/layer-text.ts:101-104` |

| Storage 保护态：`corrupt`、`unsupported-version` 带中文 detail，界面只显示状态码 | `storage/backend/partition.ts:144,319-328` → `shared/store/problem.ts:16` → `explorer/web/components/FilesExplorerView.vue:97` → `explorer/web/messages.ts:34`（双语文案，`{reason}` 填状态码）；中文 detail 不进界面 |

这 8 条都由主会话回到基线代码逐跳核对过（Storage 保护态一条是实现审查后补核的）。

### 9.2 前端随机抽样（种子 20261027，从 `report-frontend.md` 的 FC 行里抽 5 行）

| 样本 | 核对 | 结果 |
|---|---|---|
| FC-10 命令不可用原因 | `commands/shared/registry.ts:201` 以“；”连接多个原因 | 属实 |
| FC-04 重连状态 | `web/host/window.ts:203-206` 在线、离线只改 `connection` | 属实 |
| FC-52 终端错误帧 | `dev-panel/src/server/terminal-hub.ts:298` 发 `{t:"error", code, message}`，`terminal-socket.ts:105-107` 转字符串 | 属实 |
| FC-09 命令失败通知 | `workbench/web/commands/view-commands.ts:104-105` 返回 `reason` | 属实 |
| FC-13 编辑器动作结果 | `editor/web/area.ts:510` 的 `refusal()` 把“当前视图/目标组”拼进句子 | 属实 |

加上后端报告 3.5 的 5 条，共 10 个样本，都属实。

### 9.3 两处“不一致”的裁决

- **1b 诊断查询**：在 `neuro-book/src` 的 `plugins/diagnostics`、`web`、`ui`、`server` 的非测试代码里，没有找到对诊断查询（`query`、`status`）的静态调用；前端文件清单也没有。查询服务在 `nb-runtime/src/diagnostics/contracts.ts:121-127` 存在，但这只能证明“在已检索的范围里没有静态消费者”，不能排除 HTTP reader 或间接调用。状态定为**未追到**，交 t03（见 9.5）。
- **7b Storage 订阅结束**：两边说的是同一条链路上的不同两跳，并不冲突。前端分区确实没有直接订阅 Storage 的 `onEnd`；后端追到的是共享 Store 在 `shared/store/persisted.ts:251-273` 订阅并把结束原因写进失败状态，再由 `shared/store/problem.ts:15` 投影成 `unread`，`explorer/web/components/FilesExplorerView.vue:95-98` 只显示传进来的 `problem.code`。t03 要设计的是“Storage `onEnd` → 共享 Store 的失败状态 → 资源管理器的问题提示”这条跨分区投影；`FilesExplorerView` 不是 Storage 的订阅者。

### 9.4 补追到的未追到项

- 前端 FC-17 面包屑目录读取：实现是 `editor/web/components/EditorGroup.vue:141` 的 `listCrumb`。
- 后端 3.3-2 只追到一个特例：`neuro-book/src/web/host/connection.ts:89-96` 是浏览器引导连接专用的读取，只取 `body.error.code` 拼在连接失败说明后面。通用 HTTP 错误外壳的统一读取仍未追到（见 9.5）。

### 9.5 仍未追到、交给 t03 的项

第 7 节剩下的其余项：诊断查询的 UI 或 HTTP 读取方（第 7 节 #11，见 9.3）、通用 HTTP 错误外壳的统一读取方（#12，见 9.4）、FC-27 项目未绑定存储的调用方、FC-36 SDK 定义期错误的展示去处、FC-37 主题装载失败在 `main.ts` 之外的捕获、第三方工具抛错在 OMP 内部的转换（依赖源码不在基线 worktree 里）、nbdev `audit.jsonl` 的历史消费界面、`complete()` 的产品消费者。共 8 项。前两项关系到未知 HTTP 失败形状的回退与读取方的归属，t03 设计失败投影时要先定；其余不在“必须先定”的链路上，t03 设计到对应错误域时再追。

### 9.6 更正

主会话补查的 MC-01（第 2、3 节已直接改成最终数字）：`projects/project/` 里 `record(` 共 22 处（含定义），诊断约 20 条，不是“约 15 条”。

### 9.7 实现审查的处理

omp 实现审查（`evidences/impl-review-omp.txt`）有效 6 条，都已直接改进正文：拆出 `B-HARNESS-COMPLETE`（第 3 节）；统一 MC-01 的条数（第 2、3 节）；1b 改回“未追到”、7b 改成“直接订阅无、下游投影已追到”（第 4 节与 9.3）；9.4 改为“只追到引导专用的读取”；9.5 补上漏交的两项；9.1 补核 Storage 保护态。审查另外按哈希抽了 5 条“必须先定”（M17、M2、M15、M3、M10），都与基线相符。
