# t30 计划：模型请求记录与查看器

## Context

开发者 2026-11-06 要求新应用也有旧应用的 trace：查看所有模型 API 请求的地方。2026-11-15 开工，先出界面静态稿，两轮评审定稿（[README](README.md) 决定 1 到 12，[评审板](artifacts/review/index.html)）；旧应用的行为与逐项取舍见[参照清单](legacy-survey.md)。

现状：内核每次请求写 `modelStarted`，只记请求的哈希，不存请求全文；会话标题在一个后台会话里生成，子代理也是会话，所以除了 `complete()`，每次请求都对得上会话与请求序号。

合同：新写 [`agent/request-trace.md`](../../../../../docs/specs/agent/request-trace.md)（planned）；[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 89、[`harness/models.md`](../../../../../docs/specs/harness/models.md) 输出 20 两条 planned。对话顶栏的登记动作在 [`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 里已经写了（“顶栏动作”），只是没实现，这次补上。

开发者已定：编辑区的一页，三个入口；列表每条两行，按会话的轮分组；概览常驻、六页；筛选常驻一行；全文查找；窄时来回切换；消息页用大纲；组件放进 nb-agent-ui。

工作方式：代码在 `.worktree/w00032-t30-request-trace`（分支 `feat/w00032-t30-request-trace`）；主会话自己写；Spec 与 Task 记录在主工作区。

## 技术选型

| 问题 | 选用 | 理由；否决了什么 |
|---|---|---|
| 存放 | 自己的目录：按天的追加式索引加按内容寻址的内容文件 | 同一会话的请求一次比一次多几条消息，整份存会按条数平方涨；会话日志已经这样存大块内容（`blobs/`）。否决 SQLite：记录是写一次、按天删，用不上查询；否决把记录放进会话目录：会话的 `blobs/` 有自己的清理，混放会互相误删 |
| 全文查找 | 服务端逐条扫去重后的内容，文字按哈希缓存 | 去重后的文字量与会话日志同级。否决 SQLite FTS5：仓库里没有在用，要验证 Bun 各平台的 SQLite 带不带 FTS5，第一版不值得；性能目标见“验证”，达不到再加索引 |
| 估 token | 内核的 `estimateTokens`（`kernel/compaction/compact.ts`） | 与压缩、上下文检查器同一个口径 |
| 差异 | nb-ui 的 `DiffView` | 已有 |

## 关键设计

### nb-harness 内核：调用说明（`src/kernel/api/model.ts`、`src/kernel/run/model-call.ts`）

`ModelResolution.call` 加第四个可选参数：

```ts
export interface ModelCallMeta {
    readonly session?: string;
    readonly request?: number;
    readonly turn?: {readonly id: string; readonly index: number; readonly input: string};
    readonly modifiedBy?: readonly {readonly extension: string; readonly fields: readonly string[]}[];
    /** 宿主包在端口外面时塞进来；适配器把线上事实交给它。 */
    readonly observe?: ModelWireObserver;
}
export interface ModelWireObserver {
    payload?(body: JsonValue): void;
    /** 第一次 HTTP 尝试实际发出的头（原值）；遮盖由记录器做。 */
    requestHeaders?(headers: Readonly<Record<string, string>>): void;
    response?(info: {readonly status: number; readonly headers: Readonly<Record<string, string>>}): void;
    firstEvent?(): void;
}
```

- `callModel` 的 `terminal` 在写 `modelStarted` 之后、调 `resolution.call` 时给出 `{session: core.header.id, request: number, turn, modifiedBy}`。`turn` 取历史状态的当前轮（`kernel/state/history.ts` 的 `current`、`starts`），序号是 `starts` 的长度；不在轮里（压缩在轮外触发）时不给。
- `complete()` 不给说明。不认识第四个参数的端口照常工作，所以 nb-story 的旧端口、测试替身不用改。

### nb-harness 适配器：线上事实（`src/kernel/model/omp.ts`）

- `options.onPayload`：把请求体交给 `meta.observe.payload`，图片的 base64 换成 `{type, mime, bytes}`；返回 `undefined`，不改请求。
- 已有的 `fetch` 包装（数重发次数的 `counted`）：第一次调用时把 `init.headers` 交给 `requestHeaders`。
- `options.onResponse`：交 `status` 与 `headers`。
- 循环里第一个非 `start` 事件时调 `firstEvent`（`firstEvent.seen()` 那里已经有这个时刻）。
- 观察者的回调包 `try`，抛错写进适配器已有的诊断出口，不影响请求。

### nb-harness 宿主套件：记录器（新目录 `src/kit/requests/`，新子路径 `./kit/requests`）

- `traceModelPort(port, recorder): ModelPort`：`resolve` 原样交回，成功时把 `call` 包一层：开始时 `recorder.start(meta, request)`，把 `observe` 接到这条记录，结束时 `finish(response, timing)`；中止与抛错都结算。设置关着（`recorder.enabled()` 为假）时直接调原来的 `call`。
- `RequestRecorder`：
  - 目录（只写在模块头，不进 Spec）：`index/<YYYY-MM-DD>.jsonl`（每条请求一行 `start`、一行 `end`，后者覆盖前者）、`blobs/<前两位>/<sha256>.json`（一条消息、一段系统提示词、一个工具声明、一份回复）、`payloads/<id>.json.gz`、`format.json`（版本 1）。
  - 只有一个写者：宿主进程。写入串行；写失败经 `report` 出诊断，不抛给调用方（Spec 输出 9）。
  - 打开时把没有 `end` 的记录补一行 `end{status: "interrupted"}`（输出 7）。
  - `sweep(days)`：删过期的天文件与对应的请求体，再删没有任何记录引用的内容（输出 11）；`clear({session?})` 同样，跳过进行中的。
  - 重发：同一会话里与前一条的内容哈希列表全同，记 `resend` 与第几次（输出 8）。
  - 头的遮盖：名单同旧应用 `sanitizeResponseHeaders`，但只把值换成 `***`、保留名字，请求头与响应头同一个函数；请求头只在 `requestTraceHeaders` 开着时记（输出 5）。
  - 读：`list(query)`（筛选、排序、分页游标，带合计）、`search(query, filters)`（逐条扫，命中片段与处数）、`read(id)`（引用展开成内容）、`payload(id)`；`onChange(listener)` 推新增与结算的摘要行。
- 不认识版本的天文件跳过、不删（Spec 副作用节）。

### 应用后端（`packages/neuro-book/src/plugins/agent/backend/`）

- `agent.ts`：建 `RequestRecorder({root: <stateRoot>/agent/requests, …})`，把 `options.models.port(…)` 包进 `traceModelPort`；会话表、标题、子代理都用包过的端口。启动时 `sweep`，之后每天一次（按注入的时钟）。
- 设置（`shared/settings.ts`）：新的一节 `nbook.agent.requests`（图标 `i-lucide-activity`，分类 `ai`），四项 `requestTrace`、`requestTracePayload`、`requestTraceDays`、`requestTraceHeaders`（缺省关），记录器每次读当前值。
- 远程服务 `nbook.agent/requests`（`shared/requests.ts` 合同、`backend/requests.ts` 实现）：`list`、`search`、`read`、`payload`、`clear`，事件 `changed`；先订阅再取（同 `shared/remote.ts` 的约定）。列表行由后端补上会话标题；后台会话（标题）按会话头找到所属会话。

### nb-agent-ui 核心（`src/request-trace.ts`，`.` 入口）

纯函数与视图类型，不碰远程：

- `RequestRowView`、`RequestDetailView`、`RequestQuery`（筛选、排序、查找词）。
- `groupRequests(rows)`：相邻同会话同轮成组（输出 13）。
- `outline(detail, previous?)`：消息行（角色、预览、token、工具调用的友好名、结果对应的调用）、按轮分段、相同前缀的长度（逐条比内容哈希）、新加的从哪条起（输出 18）。工具友好名复用 `builtin-tools.ts` 的工具格式表。
- `compareRequests(a, b)`：系统、工具、消息、参数各自的变化与最早变化的位置（输出 20）。
- `findMatches(detail, query)`：各页命中数、逐处位置（输出 19）。

### nb-agent-ui 渲染层（`src/vue/requests/`）

- 受管组件 `AgentRequestTrace.vue`（从 `./vue` 导出，同名 `.md`）：工具条（查找框、常驻筛选条、排序、更多），列表，详情；自己量宽度，放不下两栏时来回切换（输出 22）。数据经 props 给，操作经 `action` 事件交回（`select`、`query`、`load-payload`、`clear`、`open-session`、`open-settings`、`copy`）。
- 内部零件各带 `.md`：`AgentRequestList`、`AgentRequestDetail`（概览与六页）、`AgentRequestOutline`、`AgentRequestCompare`、`AgentRequestJson`、`AgentRequestFindBar`。
- 界面文字进本包消息目录（中英两份）。Lab 场景在应用的 `lab/web/fixtures/nb-agent-ui/requests.scenes.ts`，数据照草稿的样本。
- 对话视图补上登记的顶栏动作：没有钉住的进溢出菜单（`AgentConversationView.vue` 的 `overflowItems`），点了发出它的 action。

### 应用前端（`packages/neuro-book/src/plugins/agent/web/`）

- 编辑区页面 `nbook.agent.requests`（图标 `i-lucide-activity`）与它的宿主 `requests-page.ts`：订阅 `changed`、调远程、持有筛选与选中，把数据交给 `AgentRequestTrace`。
- 命令 `nbook.agent.open-requests`（参数 `sessionId?`、`request?`）：打开或激活这一页，再把筛选与选中交给页面宿主（同 `FOCUS_SESSION_COMMAND` 的做法）。
- 对话里的两个入口：顶栏动作“查看模型请求”（`nbook.agent:open-requests`）；回复的消息操作“查看这次请求”（`appliesTo` 看这条回复在日志里有没有 `request`）。`session-host.ts` 现在丢掉插件动作（`run()` 的 `default`），改为把 `nbook.agent:` 开头的动作交给 agent 插件自己处理；回复的条目 id 经会话日志换成请求序号。

## Spec 与文档改动

- 新 `docs/specs/agent/request-trace.md`（已起草）；注册表加一行（已加）。
- `harness/runtime.md` 输出 89、`harness/models.md` 输出 20（已起草）。
- `packages/nb-agent-ui/src/vue/AgentConversationView.md`：去掉“顶栏动作未实现”。
- `docs/specs/harness/host-kit.md`：套件的块清单里加“请求记录器”一行，链接 `agent/request-trace.md`。

## 切片

1. **内核与适配器**（内核调用说明、适配器线上事实）：`kernel/api/model.ts`、`run/model-call.ts`、`model/omp.ts`。验证：nb-harness 的 `bun test src/kernel` 里模型调用与 `tests/models.test.ts`（本机端点）、`typecheck`。
2. **记录器**（`src/kit/requests/`）：验证 `bun test src/kit/requests`、`typecheck`；一个测量脚本：合成 1 万条记录，查一次的耗时。
3. **应用后端**：设置、接线、远程服务、清理。验证：agent 后端的远程测试（`backend/requests.test.ts`）与 `typecheck`。
4. **nb-agent-ui**：核心、零件、顶栏动作、Lab 场景、消息目录。验证：nb-agent-ui `bun run test`、`typecheck`；Lab e2e 新场景。
5. **应用前端与入口**：页面、命令、两个入口、动作路由。验证：`e2e/agent-request-trace.e2e.ts`（新建）、受影响的 agent web 测试。

每片单独提交；第 1、2 片可以先合在一个提交范围里做实现审查，后端与界面分开审。

## 验收映射

| Spec 编号 | 覆盖 |
|---|---|
| `agent.request-trace` 输出 1、2、3、4、8 | `kit/requests/recorder.test.ts`（真端口替身、真目录） |
| 输出 5、6 | `kit/requests/recorder.test.ts`（遮盖名单、请求头开关）；`tests/models.test.ts`（本机端点：请求体、发出的请求头含鉴权头、状态与响应头、首个事件） |
| 输出 7 | `kit/requests/recorder.test.ts`（关掉再打开同一目录） |
| 输出 9、10、11 | `kit/requests/recorder.test.ts`（只读目录、设置开关、注入时钟） |
| 输出 12、14、15、16、17、21、23、24、25 | `backend/requests.test.ts` 加 nb-agent-ui 的 `*.dom.test.ts` |
| 输出 13、18、19、20 | `src/request-trace.test.ts`（分组、大纲、比较、查找） |
| 输出 22 | Lab e2e：拖窄拖宽 |
| 场景 1、2、4、5 | `e2e/agent-request-trace.e2e.ts` |
| 场景 3 | `backend/requests.test.ts` 的子进程用例 |
| `harness.runtime` 输出 89 | 内核模型调用的测试：说明里的序号与 `modelStarted` 一致 |
| `harness.models` 输出 20 | `tests/models.test.ts` |

## 验证

- 每片自跑上面的命令；收口跑受影响的测试与新 e2e、Lab e2e 的新场景，不跑全量。
- 真实浏览器：开发服务里接本机 OpenAI 兼容端点，发两轮带工具调用的对话，看页面的分组、大纲前缀、查找、比较、窄时切换；截图用亮色。
- 性能：1 万条合成记录、去重后约 50 MB 文字，查一次 1 秒内；列表首屏 300 毫秒内。数字写进证据。
- 未验证：真实服务商的原始请求体形状（只测本机端点与 OpenAI 兼容格式）；Windows 上的目录与清理。

## 不做与风险

- nb-story 的问答不记，迁到新内核（t31）之后自然有。
- 不做按大小的上限，只按天数；用量很大时目录会大，页面“更多”菜单里先不显示占用。
- 查找是逐条扫：记录很多时会慢，达不到性能目标就改建索引（另开 Task）。
- 内核接口加参数：所有 `ModelResolution` 的实现方（nb-models、nb-story 的旧端口、测试替身）都要能接受第四个参数；只是多一个可选参数，类型上兼容。
- nb-harness 随 nb-story 发布到 npm（ADR 0029）：新子路径 `./kit/requests` 与 `call` 的可选参数是公开接口的新增，下次发布时一起出。
