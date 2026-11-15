---
schema: nbook.task/v2
taskId: t30-model-request-trace
status: active
updated: 2026-11-15
---

# Trace：查看所有模型 API 请求

## 目标与范围

开发者 2026-11-06 要求先记下：旧应用有 trace，就是查看所有模型 API 请求的一个地方，新应用也要有。

参照（旧应用，只读）：`packages/neuro-book-legacy/server/agent/observability/`（`traced-provider.ts`、`pi-trace-reader.ts`、`trace-segments.ts`）、`server/api/agent/traces/`、`app/composables/useAgentTraceApi.ts`。

合同：新写一份 Spec（暂定 `docs/specs/agent/request-trace.md`，静态稿定了再写）；从回复打开这次请求、记录点分别要改 [`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 与 [`harness/models.md`](../../../../../docs/specs/harness/models.md)。

相关现状：内核的 `preview` 能算下一次请求，日志里有 `modelStarted`，但不存发出去的请求全文；上下文详情（t28）只看下一次请求的组成。

## 决定

| 编号 | 日期 | 决定 |
|---|---|---|
| 1 | 2026-11-15 | 开发者：先做 t30（排在 t29 之前），参考旧应用的 trace；先出界面静态稿 |
| 2 | 2026-11-15 | 开发者：查看器的组件有复用价值，放进 nb-agent-ui |
| 3 | 2026-11-15 | 注意力排序按[参照清单](legacy-survey.md)的推荐（开发者“可以，按推荐”）：查看器是编辑区的一页，入口是命令面板“查看模型请求”、对话顶栏菜单（只看本会话）与回复上的“查看这次请求” |
| 4 | 2026-11-15 | 列表每条两行：状态点、用途、模型、时间；输入输出 token、缓存命中、耗时、费用。按会话的轮次分组，看全部会话时组头写会话标题 |
| 5 | 2026-11-15 | 详情：概览是顶部常驻的一条（模型、状态、token、缓存、耗时、费用、改过请求的扩展）；下面依次是消息（缺省）、系统提示词、工具、原始请求体、响应；思考与工具定义缺省收起，长文字只显示前几行 |
| 6 | 2026-11-15 | 做新增项 A（从回复打开这次请求）与 B（“和上一次比较”一页） |
| 7 | 2026-11-15 | 查看器开着时新请求自动进列表顶部，不改当前选中 |
| 8 | 2026-11-15 | 开发者：查看器的功能要完善一点，查找要做好、方便找到要看的那次请求 |
| 9 | 2026-11-15 | 评审板第 1 轮 `filters-r1`：筛选条件常驻一行（会话、用途、状态、模型、时间，各一个下拉，选了的高亮带 ×） |
| 10 | 2026-11-15 | 评审板第 1 轮 `narrow-r1`：编辑区窄时列表与详情来回切换；详情里上下箭头换请求，宽了自动回到左右分开 |
| 11 | 2026-11-15 | 评审板第 1 轮 `page-r1`：要改，开发者备注“消息列表的展示可以优化？”，第 2 轮给详情的消息页出候选；其余部分（全文查找与查找条、和上一次比较、原始请求体与响应、空状态、列出还没回来的请求、记录连回复一起存）没有提修改，照第 1 轮 |
| 12 | 2026-11-15 | 评审板第 2 轮 `messages-r2`：消息页用大纲，一条消息一行（序号、角色、一行预览、token 条），和上一次相同的前缀缺省收成一行，点一行在原地展开；按轮次分段、“这次新加的”分隔线、工具结果标出对应的调用、回复放在最后 |
| 13 | 2026-11-15 | 计划的待确认项：缺省开着记录、存原始请求体；只按天数保留，缺省 14 天；全文查找第一版逐条扫、不建索引；nb-story 问答这次不记；设计审查派 omp（整份计划与后端）、Sonnet（界面）、另一位 Sonnet（从整体看）。开发者改一条：请求头记不记做成设置（`requestTraceHeaders`，缺省关，开着时凭据类的值遮盖） |
| 14 | 2026-11-15 | 细化决定 7（界面审查引出，开发者“没问题”）：按时间排、没有查找词、列表在顶部时新请求直接插到顶部；已往下翻、按别的排序或在查找时不插，顶部显示“有 N 条新请求”，点了刷新。两种情况都不改当前选中 |
| 15 | 2026-11-15 | 开发者确认计划第 3 稿（“没问题，开工”）：含顺带修 `modifiedBy` 的串用、原始请求体合计 1 GB 上限、查找一次 3 秒或 200 条、先出纵向最小版的切片顺序、Spec 编号重排 |

## 当前状态

开工，按 design-review 走：旧应用的行为与新应用的现状列在 [参照清单](legacy-survey.md)；注意力排序已定（决定 3 到 8）。界面定稿：[评审板](artifacts/review/index.html)两轮已答（决定 9 到 12）。草稿代码在 `.worktree/w00032-t30-drafts`（不提交）。Spec [`agent/request-trace.md`](../../../../../docs/specs/agent/request-trace.md) 与[计划](plan.md)已写，待确认项已定（决定 13）。设计审查三位（omp、Sonnet 界面、Sonnet 整体）已回并处理，计划第 3 稿、Spec 同步修订并重排编号，处理见 [`evidences/design-review-handling.txt`](evidences/design-review-handling.txt)；开发者已确认（决定 15），实施中：代码在 `.worktree/w00032-t30-request-trace`（分支 `feat/w00032-t30-request-trace`）。

切片 1 已提交（`2660e131c`）：内核调用说明与按请求对象算的 `modifiedBy`、适配器 `fetch` 包装里的线上事实、`kit/requests` 记录器与 `traceModelPort`。验证：nb-harness `typecheck` 与全量 `bun test`（835 过、6 跳过、0 失败），nb-models、nb-story、应用后端 `tsc` 无错，`governance:check` 无新警告；记录器 12 处变异都被测试抓到。实施中与计划不同的几处（Spec 与计划已同步改）：

- 遮盖用适配器已有的 `[REDACTED]`（与错误文字的遮盖同一个函数），不另造 `***`。
- 每次尝试都记响应头（Spec 原写只记最后一次）：429 那次的限流头正是排查要看的。
- 轮的那段话只在索引行里留开头（160 字），不单存一份内容：全文就在消息里。
- 索引行多一种 `pruned`（原始请求体因总量上限删掉），清理时据此判断请求体的状态，不逐个查文件。
- 输出 7 的子进程用例是“请求进行中结束进程”；“写内容与写行之间退出”用残留文件（没有行引用的内容、请求体与临时文件）和半行两条用例代替：写入顺序与改名保证了这几个时刻只会留下这两类残留，没有在写到一半时精确结束进程的钩子。

切片 1 的实现审查（omp）回来 5 条重要，成立 4 条、已改（`5d63e4ac0`），1 条不成立（自动压缩在轮里，带轮是对的）；处理见 [`evidences/impl-review-1.txt`](evidences/impl-review-1.txt)。

切片 2 已提交（`955b9bb3d`）：设置一节四项；记录器接进 `backend/agent.ts`，所有会话用的模型端口都经它，启动时与之后每天清理；远程服务 `nbook.agent/requests`。验证：应用 `typecheck`（含两份 vue-tsc），`src/plugins/agent` 全部与根上的架构、清单、约定键测试 477 过、11 跳过、0 失败，nb-harness 全量 836 过。与计划不同的几处：

- 设置键的写法是 `nbook.agent/requestTrace`（斜杠），Spec 原写成点分，已改。
- 通道一条消息上限 1 MiB：`read` 只带消息大纲的第一页，另有 `messages` 接着取；一段内容与原始请求体按 256 KB 分段读（`content`、`payload` 带段号）。
- 多了 `find(session, request)`：给“查看这次请求”和命令的 `request` 参数用。
- 后台标题会话的所属不扫会话表，而是对记录里出现过的会话正向算 `titleSessionId`：标题会话第一次发请求之前，它所属的会话已经发过那一轮的请求。按会话筛选与清空都连同它的后台请求。

切片 3 已提交（`54953aa90`、`c2388b61b`、`da143824c`）：nb-agent-ui 核心 `request-trace.ts`（视图类型、分组、新记录进不进筛选、数值写法，契约测试用真实记录器）、受管组件 `AgentRequestTrace`（筛选条、分组列表、概览与五页详情、全文与请求体按需要取、窄时单栏）、应用的 `web/requests-page.ts`、编辑区页面 `nbook.agent.requests` 与命令 `nbook.agent.open-requests`、Lab 场景九个。验证：nb-agent-ui 测试 254 加 140 过、两份 typecheck 过；应用 typecheck 过，`src/plugins/agent` 与根上几份测试 480 过、Lab 场景登记门禁过；`nbdev shot` 在 1280 宽与手机画布上截了五个场景，越界、被裁的焦点环与外扩环都是 0；`governance:check`、`docs:check` 无新警告。实施中的改动：

- OMP 的 `usage.input` 不含读到与写入缓存的部分：记录器的输入合计、按输入排序与界面的“输入”、缓存命中率都按三部分相加的全部输入算（`54953aa90`）。
- 查看器的 `contents` 是按哈希的普通对象，不是 `Map`：Lab 场景的输入要能 JSON 往返，远程交来的也是对象。
- `locales.test.ts` 的旧表冻结，新键只核对中英两份的键与占位符（计划原排在切片 5，加目录键时就要改，提前做了）。

留给后面切片：输出 13 的“页面新开时从全部开始”（状态仓现在一直保留筛选）、输出 15 的“列表在顶部”判断与非时间排序以外的提示条、输出 23 的迟滞与滚动位置保留；开发服务里接本机端点的真实页面检查由切片 4 的 e2e 覆盖。

切片 4 的入口部分已提交（`e496fc516`）：`AssistantMessageView.request`、对话视图的登记顶栏动作（验收 36，`AgentConversationView.md` 已改；常驻动作在 390 宽时不收进溢出菜单记为已知偏差）、应用的“查看模型请求”“查看这次请求”。

消息页收起相同前缀与“和上一次比较”页已提交（`e1ef32321`）：记录器详情带 `previous` 与相同前缀条数，消息大纲标出压缩摘要，核心 `compareRequests`。比较页现在只写各部分的变化摘要与多出、少了的消息；变了的系统提示词与工具的逐行差异没做（`AgentRequestTrace.md` 的“不支持”里写了）。

切片 4 完成：全文查找（`0c65b3ce8` 服务端、`c64b47841` 查看器；命中按页、条、第几处交，查看器按同样的显示文字数处数，契约测试核对；一次最多扫 3 秒或留 200 条），e2e `agent-request-trace.e2e.ts`（`4e9bee874`，验收 1、4、6 两个用例过）。验收 2 的 429 重试与请求头遮盖、验收 3 的进程退出不在 e2e 里，由 nb-harness 的 `tests/models.test.ts`（真实 HTTP）与 `recorder.test.ts`（含子进程）覆盖；验收 5 在 Lab 里看。相同前缀一条也收起（验收 1 的写法），宿主带着选中打开页面时窄态显示详情。

切片 5 已提交（`cc3947763` 等，变基后的号）：排序与模型、时间筛选；“更多”菜单（占用、记录设置、清空这个会话或全部，先确认）；决定 14（只有按时间排、没有查找词、列表在顶上时插入，否则“有 N 条新请求”）；Ctrl/⌘+F、Alt+上下、查找框 Esc；文档（`AgentConversationView.md`、nb-agent-ui 的 README 与 AGENTS.md、nb-harness 的 README、`ui/agent-conversation-view.md`、`harness/host-kit.md`、`monorepo-boundaries.md`）。分支已变基到 `cbbbb8944`。

没做、待开发者定（都写进了 `AgentRequestTrace.md` 的“不支持”）：

- 输出 13 的“页面新开时从全部开始”：编辑区切走页签时页面组件会卸载，又没有“页签关了”的信号，分不清关页与切走，所以筛选一直保留到窗口关闭。要做得给编辑区加“页面开着”的公开状态。
- 输出 17 的 `#N`、查找条的回车与 Shift+回车、消息页“有命中”与按角色的筛选（“提醒”要内容的来源才分得出）、比较页里变了的系统提示词与工具的逐行差异、输出 23 的宽窄切换迟滞与列表滚动位置保留。
- 验收 2、3 不在 e2e 里，由 nb-harness 的真实 HTTP 测试与子进程测试覆盖（见切片 4）。
- 比较的候选只来自已加载的行；英文界面里用途徽标宽度不一（实现审查第 2 路引出，记在 `AgentRequestDetail.md`、`AgentRequestList.md` 的“不支持”）。

实现审查第 2 路（后端 omp、前端 Sonnet，范围 `cbbbb8944..19f135c00`）已处理，修正单独提交：

- 后端 6 条（重要 4、建议 2）：成立 5 条已改（查找按段、大小写折叠按原文偏移、清空后作废远程缓存、拆段删除事件的序号、中止的查找不扫）；1 条不成立（重启后的所属由 `agent.ts` 启动时补登记，补了重启用例）。修正 `49f3a761a`；处理见 [`evidences/impl-review-2-backend.txt`](evidences/impl-review-2-backend.txt)。
- 前端 24 条（重要 12、建议 12）：成立 21 条已改，2 条部分成立，1 条接受取舍（英文徽标对不齐，记为已知限制）。修正 `197b826ee`（状态仓）、`37623eeae`（组件）、`b323df456`（组件文档与 Lab 五个新场景）；处理见 [`evidences/impl-review-2-frontend.txt`](evidences/impl-review-2-frontend.txt)。
- 审查之外发现并修了两处：清空的确认框从来没发出清空（AlertDialog 先发 `update:open(false)` 再发 `confirm`，改菜单测试为真实点击时发现）；详情挂上时命中已经在了不定位（收口截图时发现，`92771c449`）。

收口验证（分支 `92771c449`）：nb-harness、nb-agent-ui、应用、nb-story、nb-models 的 typecheck 都过；`test:affected --since cbbbb8944` 选中 6 个包，只有 nb-story `src/server/qa.test.ts` 一条在负载 14 时子进程超时，单独重跑 27 过；`governance:check`、`docs:check` 无新警告；e2e `agent-request-trace`、`agent-conversation`、`lab-agent-ui`、`lab-scenes` 共 54 条 53 过，`lab-scenes` 挡在主题编辑器两个场景的资源 404（t30 没改主题编辑器与 Lab 外壳），查看器的 14 个场景改用 `nbdev shot` 在手机与自由画布上量，越界、焦点环与外扩环被裁、页面错误都是 0；最后一处修正之后重跑 `agent-request-trace` 2 过。

已合入 master（`e1b7d4f52`，`--no-ff`）。合入前 master 多了 w00046 的发布元数据（`product.ts` 的发布阶段、桌面脚本、nb-ui 一条主题测试），与本分支没有同一个文件，`merge-tree` 试算无冲突；合入后在 master 上重跑应用 `typecheck` 过。分支的 worktree 已删。

## 下一步

1. Spec [`agent/request-trace.md`](../../../../../docs/specs/agent/request-trace.md) 晋升 `implemented` 交开发者批准；上面“没做、待开发者定”的几项交开发者定。
2. 草稿 worktree `.worktree/w00032-t30-drafts` 还留着（评审板的草稿，不提交），开发者不再看评审板时删。
