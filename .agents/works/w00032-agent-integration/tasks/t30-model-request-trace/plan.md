# t30 计划：模型请求记录与查看器

第 3 稿：按三份设计审查（omp、界面、整体）修订，处理见 `evidences/design-review-handling.txt`。

## Context

开发者 2026-11-06 要求新应用也有旧应用的 trace：查看所有模型 API 请求的地方。2026-11-15 开工，先出界面静态稿，两轮评审定稿（[README](README.md) 决定 1 到 14，[评审板](artifacts/review/index.html)）；旧应用的行为与逐项取舍见[参照清单](legacy-survey.md)。

现状：内核每次请求写 `modelStarted`，只记请求的哈希，不存请求全文；会话标题在一个后台会话里生成，子代理也是会话，所以除了 `complete()`，每次请求都对得上会话与请求序号。

合同：新写 [`agent/request-trace.md`](../../../../../docs/specs/agent/request-trace.md)（planned）；[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 89、[`harness/models.md`](../../../../../docs/specs/harness/models.md) 输出 20 两条 planned；[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“顶栏”补常驻规则（Spec 早写了顶栏动作，没实现）。

开发者已定：编辑区的一页，三个入口；列表每条两行，按会话的轮分组；概览常驻、六页；筛选常驻一行；全文查找；窄时来回切换；消息页用大纲；组件放进 nb-agent-ui；缺省开着记录并存原始请求体；按天数保留、缺省 14 天；请求头记不记是设置、缺省关；查找第一版逐条扫；nb-story 问答不记；新请求进列表的规则（决定 14）。

工作方式：代码在 `.worktree/w00032-t30-request-trace`（分支 `feat/w00032-t30-request-trace`）；主会话自己写；Spec 与 Task 记录在主工作区。

## 技术选型

| 问题 | 选用 | 理由；否决了什么 |
|---|---|---|
| 存放 | 状态根下单独一个目录：按天的追加式索引加按内容寻址的内容文件 | 主视图是跨会话按时间看，`complete()` 没有会话，单一目录最简单；同一会话的请求一次比一次多几条消息，整份存（旧应用的做法）每会话约 10 MB、扫 1 万条要读几 GB。否决放进会话目录：全局列表要读全部会话的索引，`complete()` 另要一处；删会话落地时再评估。否决 SQLite：写一次、按天删，用不上查询，14 天清理还要 `VACUUM` |
| 全文查找 | 服务端逐条扫去重后的内容，文字按哈希缓存 | 去重后的文字量与会话日志同级。FTS5 不是退路：本机实测中文两字词搜不到（缺省分词把连续汉字当一个词，trigram 要三字），退路是自建二元组索引（另开 Task） |
| 线上事实 | 适配器已有的 `fetch` 包装 | 每次 HTTP 尝试一处拿全地址、请求头、请求体、响应状态与头；pi-ai 的 `onResponse` 在 anthropic、bedrock、gemini-cli、ollama 里都不调（核实计数 0），anthropic 把 `fetch` 传给 SDK。走不了 `fetch` 的（Bedrock SDK、Codex WebSocket）退回 `onPayload` |
| 估 token | 内核的 `estimateTokens`（`kernel/compaction/compact.ts`） | 与压缩、上下文检查器同一个口径 |
| 差异 | nb-ui 的 `DiffView` | 已有 |

不做的两个方向（整体审查核过）：按需从会话日志重算过去的请求——日志里没有原始请求体、头、状态、第一块内容的时刻，`complete()` 不写日志，规范化请求又依赖当时的槽与扩展代码，升级后算出来的与当时发的不同；做成 OpenTelemetry 数据——查看器仍要自己写，本机单用户用不上它的后端，以后要导出时多接一个观察者即可。

## 关键设计

### nb-harness 内核：调用说明（`src/kernel/api/model.ts`、`src/kernel/run/model-call.ts`）

`ModelResolution.call` 加第四个可选参数：

```ts
export interface ModelCallMeta {
    readonly session?: string;
    readonly request?: number;
    /** `modelStarted.hash`：记录与日志对账。 */
    readonly hash?: string;
    /** 没有用户输入的轮（继续运行、事件开的轮）不给 `input`。 */
    readonly turn?: {readonly id: string; readonly index: number; readonly input?: string};
    readonly modifiedBy?: readonly {readonly extension: string; readonly fields: readonly string[]}[];
    /** 宿主包在端口外面时塞进来；适配器把线上事实交给它。 */
    readonly observe?: ModelWireObserver;
}
export interface ModelWireObserver {
    /** 每次 HTTP 尝试结束时调一次（成功拿到响应头或网络错误）；值里的配置密钥原值已换成 `[REDACTED]`。 */
    attempt?(wire: {
        readonly url: string;
        readonly headers: Readonly<Record<string, string>>;
        readonly body: string | null;
        readonly startedAt: number;
        readonly response?: {readonly status: number; readonly headers: Readonly<Record<string, string>>};
        readonly error?: string;
    }): void;
    /** 不经 HTTP 的传输只有请求体（`onPayload` 交的，序列化之后）。 */
    payload?(body: string): void;
    /** 第一块内容（文字、思考或工具调用参数的第一个增量）。 */
    firstContent?(): void;
}
```

- `callModel` 的 `terminal` 在写 `modelStarted` 之后、调 `resolution.call` 时给出说明；`turn` 取历史状态的当前轮（`kernel/state/history.ts` 的 `current`、`starts`），键是轮 id，序号只供显示；轮外（手动压缩）不给。
- 顺带修 `modifiedBy` 的串用（现有缺陷）：现在整次 `callModel` 共用一个数组，拦截层调两次 `next` 时第二次带上第一次的来源。改为每次 `next` 带自己那一支的来源，`terminal` 用它写 `modelStarted` 与说明；补串行两次、并发两次两个场景。
- `complete()` 不给说明。第四个参数可选，三参数的实现方（nb-story 的旧端口、测试替身）类型上兼容。

### nb-harness 适配器：线上事实（`src/kernel/model/omp.ts`）

- 已有的 `fetch` 包装（`counted`）每次被调时：头取 `input` 是 `Request` 时它的头，再叠上 `init.headers`（`Headers`、数组、对象都规整成对象）；请求体取 `init.body` 是字符串时的原文（流与表单给 `null`）；地址取最终的 URL。拿到 `Response` 或 `fetch` 抛错时交一次 `attempt`（适配器内部重试的每一次都交，pi-ai 的 429 重试在包装里面）。
- 交出之前把配置密钥原值换成 `[REDACTED]`：用 models.md 输出 5 错误文字遮盖的同一个函数。
- 第一块内容：在第一次调 `onDelta` 时调 `firstContent`，与首事件看门狗（`firstEvent.seen()`）分开；没有内容的失败不调。
- `fetch` 没被调用（Bedrock SDK、Codex WebSocket）：退回 `options.onPayload`，立刻序列化交 `payload`，没有头与状态。
- 观察者的回调包 `try`，抛错写进适配器已有的诊断出口，不影响请求；回调不改请求、不等它。
- 图片不在适配器里处理，记录器统一换（见下）。

### nb-harness 宿主套件：记录器（新目录 `src/kit/requests/`，新子路径 `./kit/requests`）

- 模块头写“尚未稳定，下次发布不必一起出”。
- `traceModelPort(port, recorder): ModelPort`：`resolve` 原样交回，成功时把 `call` 包一层：开始时 `recorder.start(meta, request)`，把观察者接到这条记录，结束时 `finish(response, timing)`；中止与抛错都结算。`recorder.enabled()` 为假时直接调原来的 `call`。
- `RequestRecorder`：
  - 目录（只写在模块头）：`index/<YYYY-MM-DD>.jsonl`、`blobs/<前两位>/<sha256>.json`（一条消息、一段系统提示词、一个工具声明、一份回复；轮的那段话只在索引行里留开头）、`payloads/<id>.json.gz`、`format.json`（版本 1）。
  - 写入协议：索引是事件行 `{v: 1, seq, id, kind: "start" | "attempt" | "end" | "pruned", …}`，读的时候按 `id` 折叠（`end` 之后的状态以 `end` 为准，`attempt` 依次累加）；一条请求的后续行都写进它 `start` 所在那天的文件。内容文件与请求体先写临时文件再改名，并且在引用它的那一行之前写完，与那一行在同一个串行任务里；所以已经落盘的行引用的内容都在。读到末尾的半行跳过。
  - `start` 要等那一行写完才交回，然后才调适配器；写失败时交回“没有记录”，请求照发，诊断 `agent.requests.write-failed`。已知内容的哈希留在内存里，同一段内容只写一次。
  - 图片：请求与回复里的全部图片块，算哈希、写内容之前换成 `{kind: "image", mime, bytes, hash}`；原始请求体里的 base64 同一个函数换。
  - 头与地址的遮盖（适配器已经换掉了密钥原值）：头的名单同旧应用 `sanitizeResponseHeaders`，只把值换成 `[REDACTED]`、保留名字，请求头与响应头同一个函数；地址的查询参数按 Spec 输出 5 的名单；请求头只在 `requestTraceHeaders` 开着时记。
  - 只有一个写者：宿主进程；写入串行；写失败经 `report` 出诊断，不抛给调用方。
  - 打开时把没有 `end` 的记录补一行 `end{status: "interrupted"}`；补到一半崩溃时下次重算重补，折叠时重复的 `end` 无害。
  - `sweep(days)`：删过期的天文件与对应的请求体，再删没有记录引用的内容；原始请求体合计超过 1 GB 时从最旧的删起，记录本身留着。`clear({session?})` 同样；都跳过进行中的，清扫与写入在同一个串行队列里。
  - 重发：同一会话里与前一条的内容哈希列表全同，记 `resend` 与第几次。
  - 读：
    - `list(query)`：筛选（会话、用途、状态、模型、时间）、排序、分页（每页 100 条，游标），带合计与筛选候选（会话带标题待宿主补、模型、各自条数）；
    - `search(query, filters, cursor?)`：逐条扫，每条请求给出命中的逐处位置（页、消息序号、块、偏移）与各页计数，列表的处数与详情的共几处都用它；查找范围不含原始请求体。分段扫、段间让出事件循环，不挡模型调用；一次最多扫 3 秒或 200 条命中，扫不完交回 `truncated` 与接着扫的游标；带 `AbortSignal`，新的查找作废旧的；
    - `read(id)`：大纲级详情——每条消息的角色、预览、token、内容哈希、工具调用的名字与参数摘要，系统提示词与工具声明也给哈希；
    - `content(hash)`：一段内容的全文；
    - `payload(id)`：原始请求体；
    - `usage()`：目录占用；
    - `onChange(listener)`：推 `added`、`settled`、`removed`（清空与清理）三种，带单调的 `seq`；`list` 的每一页带它对应的 `seq`。
- 不认识版本的天文件跳过、不删。

### 应用后端（`packages/neuro-book/src/plugins/agent/backend/`）

- `agent.ts`：建 `RequestRecorder({root: <stateRoot>/agent/requests, …})`，把 `options.models.port(…)` 包进 `traceModelPort`；会话表、标题、子代理都用包过的端口。启动时 `sweep`，之后每天一次（按注入的时钟）。
- 设置（`shared/settings.ts`）：新的一节 `nbook.agent.requests`（图标 `i-lucide-activity`，分类 `ai`），四项见 Spec 的设置表。
- 远程服务 `nbook.agent/requests`（`shared/requests.ts` 合同、`backend/requests.ts` 实现）：`list`、`search`、`read`、`content`、`payload`、`usage`、`clear`，事件 `changed`（带 `seq`，重连后用远程层的 `onResync` 重新取列表）；先订阅再取。列表行与筛选候选由后端补会话标题；后台标题会话的所属：对会话表里的全部会话正向算 `titleSessionId`（套件已导出）建反查表，不反解哈希，算不到的单独一组。
- 设置四项的缺省逐项写进 schema 并由合同测试锁住：`requestTrace` 开、`requestTracePayload` 开、`requestTraceDays` 14、`requestTraceHeaders` 关。

### nb-agent-ui 核心（`src/request-trace.ts`，`.` 入口）

纯函数与视图类型，不碰远程，不导入 nb-harness：

- 记录的输入类型按结构声明（同 `src/harness.ts` 的做法），新的 `request-trace.contract.test.ts` 用 nb-harness（开发依赖）的真实记录核对形状；`toRequestRows`、`toRequestDetail` 把记录换成视图。两个应用都只写远程层。
- `groupRequests(rows)`：键是（会话、轮 id），相邻同键成组；轮外的请求单独一组“轮外”；组头带开始时间，回退后同序号的两轮靠时间区分。
- `outline(detail, previous?)`：消息行（角色、预览、token、工具名与参数、结果对应的调用）、按轮分段、相同前缀的长度（逐条比内容哈希）、新加的从哪条起；只出结构，工具的友好名在渲染层取。
- `compareRequests(a, b)`：先按首尾哈希对齐，中间不同的一段整体当替换；前缀很短、后者开头是摘要时判为“历史被压缩”；系统提示词、工具、参数各自是否变了与最早变化的位置。
- 命中只高亮服务端给的位置，不自己算。

### nb-agent-ui 渲染层（`src/vue/requests/`）

- 受管组件 `AgentRequestTrace.vue`（从 `./vue` 导出，同名 `.md`）。属性与事件：

```ts
type AgentRequestTraceProps = {
    rows: RequestRowView[];
    list: {state: "loading" | "ready" | "error"; more: boolean; error?: Text};
    facets: {sessions: {id: string; title: string; count: number}[]; models: {id: string; count: number}[]};
    totals: {count: number; input: number; cacheHit: number | null; cost: number | null};
    /** 筛选、排序、查找词；受控，改了发 update:query（组件里输入词去抖之后才发）。 */
    query: RequestQuery;
    /** 有新请求但没有插进列表（决定 14）。 */
    pending: number;
    selected: string | null;
    detail: {state: "idle" | "loading" | "missing" | "error"} | {state: "ready"; value: RequestDetailView};
    compare: {candidates: {id: string; label: string}[]; base: string | null; detail: RequestDetailView | null};
    contents: ReadonlyMap<string, ContentView>;
    payload: {state: "idle" | "loading" | "missing" | "error"} | {state: "ready"; text: string};
    matches: RequestMatchesView | null;
    now: number;
    registry: AgentViewRegistry;
    enabled: boolean;
};
type RequestTraceAction =
    | {type: "request.select"; id: string}
    | {type: "request.more"}
    | {type: "request.refresh"}
    | {type: "request.retry"}
    | {type: "request.compare-base"; id: string}
    | {type: "request.load-content"; hash: string}
    | {type: "request.load-payload"; id: string}
    | {type: "request.clear"; scope: "session" | "all"}
    | {type: "request.open-session"; session: string}
    | {type: "request.open-settings"}
    | {type: "request.copy"; id: string};
```

- 内部零件各带 `.md`，经 `./lab` 给 Lab：`AgentRequestList`、`AgentRequestDetail`（概览与六页）、`AgentRequestOutline`、`AgentRequestCompare`、`AgentRequestJson`、`AgentRequestFindBar`。各 `.md` 声明 `state:inject`（翻译端口）；监听都挂在组件根上，不声明 `env:global`。
- 交互规则：
  - 查找词：输入法组字结束后去抖 300 毫秒才发 `update:query`；`#N` 精确时结果顶上多一行“跳到 #N”，同时照常查字面。
  - 新请求（决定 14）由宿主决定插不插：组件只显示 `pending` 的“有 N 条新请求”。
  - 键盘：列表是 `listbox`，上下键、回车；详情新一次旧一次 Alt+上下；查找条回车、Shift+回车、Esc；Ctrl/⌘+F 只在焦点在本页时聚焦查找框。
  - 窄时切换：阈值是两栏最小宽度之和（列表 300 加详情 460），带 16px 迟滞；带选中进入窄态显示详情，否则显示列表；来回穿过阈值保留选中与列表滚动位置；窄时筛选条在条内横向滚动，选中的条件保持可见。
  - JSON 页按逻辑行编号，超长行折行，超过 2 万字的先显示前一段与“显示全部”。
- 对话视图的顶栏动作（`AgentConversationView.vue`）：实现 `action` 目标、`when`、`badge` 与常驻规则（`pinnable` 为真的按 `order` 取前两个常驻顶栏，其余进溢出菜单，原始视图固定最后）；溢出项 id 加 `header:` 前缀；`panel` 目标在注册表构造时拒绝，面板实现前不能登记。
- `AssistantMessageView` 加可选 `request`：适配器（`kernel-transcript.ts`）只在路径上有同号 `modelStarted` 时给，拦截链直接给的回复没有。
- 消息目录：先改 `locales.test.ts`：迁移时的旧表冻结，新键只核对中英键集合与占位符一致。

### 应用前端（`packages/neuro-book/src/plugins/agent/web/`）

- 请求页的状态仓 `requests-page.ts` 建在插件作用域（同 `hostAt` 的做法）：持有查询、选中、已加载的页、内容缓存（按哈希的小 LRU）、比较对象；订阅 `changed`，丢掉 `seq` 不大于当前列表的事件，同一条按最新状态合并；对 `read` 与 `search` 按序号丢弃过期响应，远程能中止就中止。
  - 新请求按决定 14：按时间排、没有查找词、列表在顶部时插入（是否进当前筛选由摘要行判断），否则累加 `pending`；`settled` 只改行内内容不重排；选中项被筛掉时详情保留。
  - 打开时没有指定请求就选中最新一条。
- 编辑区页面 `nbook.agent.requests`（图标 `i-lucide-activity`）：组件挂载时读状态仓，卸载时只释放订阅；关页时状态仓复位。
- 命令 `nbook.agent.open-requests`（参数 `sessionId?`、`request?`）：先写状态仓再 `nbook.editor.open-page`；没有参数时沿用现有查询，页面新开时从全部开始；`request` 不在已加载的页里时直接 `read`。
- 对话里的两个入口在 `web/plugin.ts` 的 `createAgentViewRegistry` 里加一个贡献：顶栏动作“查看模型请求”（`when` 有会话，`pinnable: false`）；回复的消息操作“查看这次请求”（`appliesTo` 看 `message.request`，挂在每轮的结果消息上）。`session-host.ts` 的 `run()` 在穷举的 `switch` 之前把 `nbook.agent:` 开头的动作交给 agent 插件，补上会话 id。
- 插件自己的消息目录：命令、页面标题、设置节，中英两份。

## Spec 与文档改动

- 已改（本稿同一提交）：`docs/specs/agent/request-trace.md`（三份审查的改动，编号重排：记录 1–12、查看器 13–26，场景 1–6）；`harness/runtime.md` 输出 89、`harness/models.md` 输出 20；`ui/agent-conversation-view.md` 的“顶栏”常驻规则与验收 36。
- 实施时改：`ui/agent-conversation-view.md` 第 20、90、93 行的组件清单与非目标（Trace Viewer）。
- `packages/nb-agent-ui/AGENTS.md`（受管组件数）、`README.md`、`src/vue/AgentConversationView.md`（去掉“顶栏动作未实现”）、`docs/modules/monorepo-boundaries.md` 的 nb-agent-ui 一行。
- `docs/specs/harness/host-kit.md`：套件的块清单加“请求记录器”，链接 `agent/request-trace.md`。

## 切片

先出一个能用的纵向最小版，再补，最后抛光；每片单独提交。

1. **内核、适配器与记录器**：调用说明、`fetch` 包装的线上事实、`kit/requests` 的写入、`list`、`read`、`content`、`payload`、清理。验证：nb-harness `bun test src/kernel`（模型调用）、`bun test src/kit/requests`、`tests/models.test.ts`（本机端点）、`typecheck`。
2. **应用后端**：设置、接线、远程服务（不含 `search`）、启动清理。验证：`backend/requests.test.ts`、`typecheck`。
3. **最小页面**：nb-agent-ui 核心的映射与分组、列表（会话、用途、状态三个筛选）、详情（概览、消息平铺、系统提示词、工具、原始请求体、响应）、应用的状态仓、编辑区页面与命令入口。验证：nb-agent-ui `bun run test`、`typecheck`；Lab 场景；开发服务里接本机端点看一遍。
4. **大纲、查找与入口**：`search` 与命中位置、查找条、大纲与相同前缀、和上一次比较、顶栏动作与回复的入口、`AssistantMessageView.request`。验证同上，加 `e2e/agent-request-trace.e2e.ts` 的场景 1、2、4、6。
5. **抛光**：模型与时间筛选、排序、新请求的插入与提示、窄时切换、清空、`#N`、有命中的筛选、键盘、英文场景与 390 宽、占用显示。验证：Lab e2e（行高、插入、窄时切换）、e2e 场景 5 与命令两次。

## 验收映射

| Spec 编号 | 覆盖 |
|---|---|
| `agent.request-trace` 输出 1、2、3、4、8、12 | `kit/requests/recorder.test.ts`（真端口替身、真目录；图片替换后目录里搜不到 base64） |
| 输出 5、6 | `recorder.test.ts`（遮盖名单、请求头开关、1 GB 上限用小上限测）；`tests/models.test.ts`（本机端点：每次尝试的地址、头与体、429 后成功两次尝试、密钥原值被换掉、第一块内容） |
| 输出 7 与副作用节“不出现半条记录” | `recorder.test.ts` 的子进程用例：在写 `start`、内容、`end` 之间各结束一次进程，重开读回 |
| 输出 9、10、11 | `recorder.test.ts`（只读目录、设置开关、注入时钟） |
| 输出 13、26 | e2e：命令连执行两次只有一个页签、筛选与选中已换；`request` 不在已加载页；没有记录时的文字 |
| 输出 14、19、21 | `src/request-trace.test.ts`（分组含轮外与同序号不同 id；大纲前缀；比较的末尾追加、中间插入、压缩三例） |
| 输出 15 | Lab e2e：列表在顶部时插入、滚下去时显示提示，可见行的位置不变、选中不变；`requests-page` 的事件合并测试（`seq` 边界两侧、重连） |
| 输出 16、17、18、20、22、24、25 | `backend/requests.test.ts`（查找、命中位置、截断与续扫、作废、清空）加 nb-agent-ui 的 `*.dom.test.ts`（筛选、查找条、空状态、确认、长行） |
| 输出 23 | Lab e2e：拖窄拖宽 |
| 场景 1、2、4、5、6 | `e2e/agent-request-trace.e2e.ts` |
| 场景 3 | `backend/requests.test.ts` 的子进程用例 |
| `harness.runtime` 输出 89 | 内核模型调用的测试：说明里的序号与哈希等于 `modelStarted` 的；`modifiedBy` 的串行两次、并发两次 |
| `harness.models` 输出 20 | `tests/models.test.ts` |
| `ui.agent-conversation-view` 验收 36 | `AgentConversationView.dom.test.ts` |

## 验证

- 每片自跑上面的命令；收口跑受影响的测试、新 e2e 与 Lab e2e 的新场景，不跑全量。
- 真实浏览器：开发服务里接本机 OpenAI 兼容端点，发两轮带工具调用的对话，看分组、大纲前缀、查找、比较、窄时切换；截图用亮色。
- 性能（数字进证据）：合成 1 万条记录、去重后约 50 MB 文字；服务端 `list` 的 p95 100 毫秒内、`search` 1 秒内；数据到达到首行渲染 200 毫秒内；冷启动单列。
- 未验证：真实服务商的线上事实（本机端点只测 OpenAI 兼容格式，Anthropic 走 `fetch` 包装是读代码得出的）；Windows 上的目录、改名与清理。

## 不做与风险

- nb-story 的问答不记，迁到新内核（t31）之后自然有。
- 原始请求体不做元素级去重，靠 1 GB 上限兜底；记录本身只按天数清理。
- 查找是逐条扫，有时间与条数上限：达不到性能目标就改建二元组索引（另开 Task）。
- 遮盖只认配置的密钥原值与固定名单（Spec 不承诺里写明）：请求头因此缺省关。
- 顶栏动作的 `panel` 目标与用户自己钉住不做。
- 公开接口的新增：nb-harness 的 `./kit/requests` 与 `call` 的可选参数（标“尚未稳定”）；nb-agent-ui 的 `AgentRequestTrace`、核心的请求视图类型、`AssistantMessageView.request`。两个包都随 nb-story 发布（ADR 0029），下次发布前要定要不要一起出。
