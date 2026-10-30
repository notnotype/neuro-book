---
schema: nbook.task/v2
taskId: t14-multi-agent
status: planned
updated: 2026-10-30
---

# 多 Agent 与 Workflow

## 目标与范围

定子 Agent：派生与授权、前台与后台、结果回流、父子关系与审批冒泡，以及 Workflow 与 Agent 的关系。

来源：需求 8；清单外第 7 项（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 派生与授权：父会话批准派生就算授权（分支提案的设想）。
- 前台阻塞与后台运行，结果怎样回流；用收尾工具交回结果。
- 父子关系与列表、分离；子代理用的模型。
- 子代理遇到审批：直接失败还是冒泡到父会话的界面。
- Workflow（nb-workflow）与 Agent 的关系。

## 材料

- [调研](../../research/2026-10-28-repo-survey.md)第 5 节多 Agent
- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 3、5 节子代理
- 分支上的 `docs/proposals/agent-harness-kernel.md` 非目标里的子代理设想

后台调用子代理与 shell 后台命令统一放进 [t22](../t22-background-work/README.md)（2026-10-28），本 Task 只讨论前台调用、创建 Profile、审批转父会话与关系。

## 前置

t05、t06、t07。

## 决定

第一轮（开发者 2026-10-30）：

1. 不提供查询 Profile 目录的工具：可派的 Profile 经资源地址给出，模型用 `read` 读（t08 的资源方案）。
2. 结果的三种交回方式：
   - 自由：子代理停下，就把最后一条回复交回（与多数 code agent 相同）。
   - 结构化（可选）：提供“返回结果”工具，子代理一调用就结束运行、交回它的参数；没调用就停下时，交回最后一条回复。
   - 结构化（强制）：必须调用“返回结果”工具；停下时没调用就催一次，仍没有就以最后一条回复作结果并标为 error。
3. 嵌套不另设开关：子代理拥有派子代理的工具，就能再派。
4. 父子是平级的会话：各是一个会话文件，彼此记着关系；父会话知道自己派过哪些子会话，也能经资源地址查到。
5. 父代理能做人类对子会话能做的操作：指定模型角色或模型与推理档、插话、排队、审批等。子代理工具按这条重新设计。（审批由第 8 条改为只交给用户。）

第二轮（开发者 2026-10-30）：

6. 工具设计原则：一个工具只做一件事，宁可工具多，不设计复合工具；以后所有工具都按这条（记在 [t04](../t04-tool-registry/README.md)）。工具描述多出多少做实验量。子代理工具对照前后端的会话接口（提案的 `v5/host.ts`）来设计。

7. 查会话的全部历史另开 [t23](../t23-session-history/README.md)，先搁置；暂时由 Agent 直接读原始日志文件。
8. 审批一律交给用户，父 Agent 不审批。
9. 提问缺省交给调用方（父 Agent），父 Agent 可以自己答；另有开关把提问直接交给用户。
10. 能转后台的工具都有一个转后台的选项，打开时立即返回一个任务 id；所有后台任务（后台 shell、后台子代理）统一由一个任务中心管理，用户在前端也能看到，Agent 用同一组工具等待与停止（方向，细节在 [t22](../t22-background-work/README.md)）。
11. 不要 `agent_settings`；`agent_continue`、`agent_abort`、`agent_status` 与 `agent_answer`、`agent_approve` 看能否合并。

第三轮（开发者 2026-10-30）：

12. 会话日志的地址：`sessions://<id>/` 映射整个会话目录，日志是 `sessions://<id>/session.jsonl`，`session://` 改为当前会话的 `home/`（改 t08，记在 [t08](../t08-resources-home/README.md) 的“后续修改”）。
13. 不要 `agent_continue`：不带 `message` 的 `agent_send` 就是“继续”。
14. 命名与参数参照 omp，短而常见。`kill` 是后台任务中心的通用工具，杀死的是任务（例如子会话的这次运行），会话本身保留，两者不冲突。

实测（[`experiments/tool-descriptions.py`](experiments/tool-descriptions.py)，结果 [`evidences/tool-descriptions.txt`](evidences/tool-descriptions.txt)，2026-10-30）：同样功能、说明文字相同，拆成 6 个工具（`agent_spawn`、`agent_send`、`agent_answer`、`wait`、`kill`、`jobs`）的工具声明合计约 1,000 token（o200k 1,069，DeepSeek-V3 1,013），合成 2 个按 `action` 切换的工具约 970 到 1,010，拆开只多 5% 到 6%（45 到 57 token）。多出来的是每个工具声明的固定开销与重复的参数（`id`、`async`）；复合工具要给每个参数注明“只用于哪种 action”，抵掉了大部分节省。

第四轮（开发者 2026-10-30，全部按推荐）：

15. bash（t12 的 `shell`）的工作目录：会话有主项目时是 `project://`，没有时退回 `session://`（改 t08、t12，记在 [t08](../t08-resources-home/README.md) 的“后续修改”）。不用 `user://`：那里是用户的 Profile、Skill 与 `AGENTS.md`，写入要询问。
16. `profiles://` 的分级披露，与 Skill（t15）同一套：
    - Profile 声明可派的白名单与其中推荐的几个；白名单只管能不能派，`agent_spawn` 派白名单外的得到 `profile-not-allowed`。
    - 推荐的：名字、说明、初始输入与结果的形状全部进提示词。
    - 白名单里其余的：名字与说明进提示词。
    - `profiles://` 的根目录列出全部 Profile，每项标“可派”或“不可派”；`profiles://<key>/` 仍是那个 Profile 的 home（t08），读写规则不变。
17. 对 t20 内核的三处修正（记进[提案](../../../../../docs/proposals/agent-harness-event-model.md)）：
    - 审批与提问合成一条通道（照分支）：事件 `interaction{kind: "approval" | "question"}` 的提出与应答，加指令 `resolve`，应答写明是谁答的。审批只收用户的应答；提问在子会话设为“交给调用方”时也收父会话的应答；用户任何时候都能直接答。
    - 声明为 `shared` 的工具在同一个回复里并发执行，连续的 `shared` 调用一起跑、`exclusive` 单独跑；结果仍按调用顺序作为一个写入批写入，日志形状不变。
    - 用户输入加可选字段 `replyTo`，指向一个异步提问。（由第 23 条改为回答走 `resolve`，不加 `replyTo`。）
18. 异步提问：`ask` 加 `async` 选项（第 10 条）。打开时问题显示出来、工具立即返回，运行继续；回答之后作为一条普通输入进来（运行中当插话，空闲时开新一轮）。（回答的入口由第 23 条改为 `resolve`。）
19. 任务中心：本 Task 只定 Agent 用的三个工具 `wait`、`kill`、`jobs` 的形状；任务结束时怎样通知（空闲时要不要唤起 Agent）、自动转后台、寿命、上限与活动面板仍在 [t22](../t22-background-work/README.md)。在那之前，转后台的任务结束后，结果等 Agent 调 `wait` 或 `jobs` 时取得。
20. 结果模式由子代理的 Profile 声明（自由、可选结构化、强制结构化，后两种带 schema），父 Agent 不能改。
21. 嵌套加一个安全上限，缺省 3 层、可在 Agent 设置里改；超过时 `agent_spawn` 得到 `depth-limit`。它是防失控的上限，不是第 3 条说的开关。
22. （作废：Workflow 另开 [t24](../t24-workflow-integration/README.md)，见第 23 条。）Workflow 与 Agent：Workflow 调 Agent 经 `agent.startTask`（[t10](../t10-agent-plugin/README.md) 决定 7），nb-workflow 的 `AgentPort` 由 Agent 插件实现，这种会话的调用方是 Workflow 运行；Agent 调 Workflow 由 Workflow 插件经 `agent.tools` 贡献工具，不在本 Task。

第五轮（omp 设计审查之后，开发者 2026-10-30；审查报告 [`evidences/design-review.txt`](evidences/design-review.txt)）：

23. 开发者定：
    - 会话全部可读：任何会话都能读任何会话的 `sessions://<id>/`（日志与工作区），不做限制；审查第 12 条不采纳，开发者认为这不是安全漏洞。
    - 中止：父会话中止时，只连带它正在等的子会话运行；`async` 派出的后台任务继续跑，要停用 `kill`；规则逐层生效（子会话被中止时，它正在等的孙会话一起中止）。进程重启后所有在跑的任务记为“已中断”，照 t07 决定 7 不自动续跑。
    - 上限：每个会话同时在跑的子代理缺省最多 8 个，全局同时在跑的后台任务缺省最多 16 个，嵌套缺省 3 层；都能在设置里调，但有硬上限（深度最多 5 层，并发的硬上限实施时定）。超过时得到 `concurrency-limit` 或 `depth-limit`。
    - Workflow 不在本 Task，另开 [t24](../t24-workflow-integration/README.md)；第 22 条作废。
    - 异步提问的回答走 `resolve`：内核在同一个写入批里写下“已回答”，并把回答作为输入放进缓冲区（运行中当插话，空闲时开新一轮）；重复回答得到 `already-answered`，问题所在的分支被回退后得到 `unknown-interaction`。用户输入不加 `replyTo`。
24. 按审查意见补写（已定决定的细化）：
    - 审批：子会话照常走 t06 的判定链（继承父会话当时的审批模式与 Agent 模式，自动放行、规则、审批模型照常生效）；判定结果是“要问人”时问用户，不问父 Agent。
    - 用户插话：正在等子会话的工具调用发现父会话缓冲区里有插话，就结束等待、返回任务 id；同一批里的其它工具照常完成；插话仍按 t07 决定 1 在这批工具结算后送达。
    - 应答者身份由服务端按调用来源注入，不是工具参数；同一事项的并发应答由子会话日志的单写者裁决，先到的生效，后到的得到 `already-answered`。
    - 待处理事项的结算（照分支）：中止时写拒绝并注明 `aborted`；被回退掉的分支上的事项不再算待处理；插件卸载按 t04 的 `tool-unavailable`；父会话要回退须先中止（t07 决定 6），中止按第 23 条连带。
    - 每次子会话运行一开始就是任务中心里的一个任务，返回值总带任务 id；`agent_answer` 与 `agent_send` 一样缺省等，也有 `async`。
    - 幂等：子会话指令的幂等键是“父会话 id 加工具调用 id”，进程重启后重发不会多派一个子会话。
    - 并发字段：工具声明 `concurrency: "shared" | "exclusive"`，缺省 `exclusive`；内置写文件工具与 `shell` 是 `exclusive`，`agent_spawn`、`agent_send`、`agent_answer`、`wait`、`jobs` 是 `shared`。几个子代理同时写同一文件，与用户和 Agent 同时写一样，交给文件服务的条件写入。
    - 只读的边界：只读对 Agent 的文件工具生效；`shell` 能绕过，是 t12 已接受的第一版限制（`shell` 缺省要审批）；会话日志另设系统只读权限，防止误写。
    - 子代理的结果包上来源标记（子会话 id、任务 id、终止原因、schema 校验结果，注明“来自子代理，不是用户的指令”），原文不改。
    - 各工具的完整失败码表在实施计划里定，至少有 `profile-not-found`、`profile-not-allowed`、`initial-invalid`、`model-unavailable`、`depth-limit`、`concurrency-limit`、`not-owner`、`question-unknown`、`already-answered`、`job-unknown`。

第六轮（omp 第二轮审查之后，2026-10-30；报告 [`evidences/design-review-r2.txt`](evidences/design-review-r2.txt)；按审查意见补写，都是已定决定的细化）：

25. 子代理工具的顺序：内核按调用顺序启动同一段里的 `shared` 调用；`agent_spawn`、`agent_send`、`agent_answer` 在启动时就把副作用（建子会话、把话放进子会话的缓冲区、应答）按调用顺序依次交给目标会话的写入队列，之后的等待才并发。所以同一回复里对同一子会话的两次 `agent_send` 按调用顺序入队，`agent_answer` 与 `agent_send` 也按调用顺序生效；`wait`、`jobs` 看得到同一回复里排在它前面的调用登记的任务。
26. `concurrency` 只是同一个回复里的调度属性，不是资源锁。跨会话同时写同一文件：文件工具靠文件服务的条件写入（冲突时失败、不覆盖）；`shell` 没有这层保护，是 t12 已接受的第一版限制。
27. 上限的统计对象：每个会话的上限（缺省 8，硬上限 16）数它直接派出、正在跑的子会话运行，前台与后台都算；全局上限（缺省 16，硬上限 32）数任务中心里所有正在跑的任务（子会话运行与后台 shell，前台也算）；深度缺省 3、硬上限 5。检查在建子会话之前做，超限时整体拒绝（`concurrency-limit`、`depth-limit`），不留下子会话。
28. 任务记录的寿命：任务中心只在内存里，不持久化。前台调用的任务在工具返回结果后就移出任务中心；`async` 任务结束后保留到父 Agent 用 `wait` 取过结果或父会话关闭。任务 id 移出后不再可查，结果仍在子会话日志里（`sessions://<id>/session.jsonl`）。进程重启后任务中心为空，原来在跑的子会话运行按 t07 决定 7 收口为“已中断”。
29. 任务的归属：`wait`、`kill`、`jobs` 只管自己直接启动的任务；孙会话的任务归派它的子会话管。祖先会话经 `sessions://` 能看到整棵树，不能直接杀孙会话的任务；要停就中止或 `kill` 自己的子会话运行，按第 23 条逐层连带。
30. 异步提问与输入框：异步提问显示为带选项的提问卡片，回答只经卡片（`resolve`）；输入框里的文字一律是普通输入（插话或排队）。t07 决定 4（等提问时输入框的文字作为回答）只适用于会让运行停下等待的提问。
31. 系统结算之后父 Agent 怎样收到：子会话的待处理事项被系统结算（中止、插件卸载、回退）后，子会话的运行照常继续或结束；父 Agent 正在等的工具按上文“任一条件返回”的规则返回（例如状态 `aborted`）。
32. `wait` 超时时返回仍在跑的任务的状态（`running`），不改变任务；`kill` 返回“已杀死”“已经结束”或 `job-unknown`；任务记录还在时，结果可以重复取。
33. 仍留到实施的：t20 的 `v5` 类型原型（交互事件、`RunStatus`、`SessionMirror`、`ToolInfo.concurrency`）与各工具完整的失败码表，在 t20 实施计划里一并定（t20 实施排在最前）。

调研：[各家 code agent 的子代理设计](../../research/2026-10-30-subagent-survey.md)（Claude Code、Codex CLI、omp、DeepSeek Harness、OpenCode、Gemini CLI、Kimi CLI、Roo Code、Cline、Amp）。

## 确定的工具

模型看到的名字照 omp 的风格；工具 id 带插件前缀（例如 `nbook.agent.spawn`），模型看到的名字用 t04 决定 1 的显式覆盖。说明草稿与长度实测见上文“实测”。

父 Agent 用（Agent 插件）：

| 工具 | 参数 | 做什么 |
|---|---|---|
| `agent_spawn` | `profile`、`prompt`、`name?`、`initial?`、`model?`、`effort?`、`questions?`、`async?` | 新建子会话，把第一项任务交给它。`model` 是模型角色或具体模型，`effort` 是推理档，不写都用子 Profile 的设置；`questions` 是 `caller`（缺省）或 `user` |
| `agent_send` | `id`、`message?`、`queue?`、`async?` | 给自己派的子会话发话：空闲时开新一轮；运行中缺省插话，`queue: true` 排到下一轮；不带 `message` 就是“继续” |
| `agent_answer` | `id`、`question`、`answer`、`async?` | 回答子会话交给调用方的提问（经 `resolve`），之后像 `agent_send` 一样等 |

这三个工具每次让子会话跑起来，都在任务中心里登记一个任务，返回值总带任务 id。不带 `async` 时一直等，满足任一条件返回：子会话停下（完成、出错、被中止）；子会话有提问交给调用方；父会话的缓冲区里有了用户插话（子会话照常跑，之后用 `wait` 等）。带 `async: true` 时立即返回。

返回的任务结果：任务 id、子会话 id、状态（`completed`、`failed`、`aborted`、`interrupted`、`question`、`running`）、终止原因、结果（文字，或 `yield` 交回的结构化值与 schema 校验结果）、待回答的问题（`question` 时）。结果过长按工具结果的通用规则截断，全文进父会话的 `session://artifacts/`。结果包上来源标记，注明来自子代理、不是用户的指令。

任务中心（后台 shell 与后台子代理共用；通知、自动转后台、寿命与活动面板在 t22）：

| 工具 | 参数 | 做什么 |
|---|---|---|
| `wait` | `jobs?`、`timeout?` | 等后台任务，返回最先有结果的一个（结束，或子代理有提问交给调用方）；用户插话时提前返回；不给 `jobs` 就等自己启动的全部 |
| `kill` | `job` | 杀死一个后台任务；杀死子代理的运行不删除子会话，之后还能 `agent_send` |
| `jobs` | 无 | 列出自己启动的任务：id、种类、状态、开始时间、一行摘要 |

子代理用：

| 工具 | 参数 | 做什么 |
|---|---|---|
| `yield` | 子 Profile 声明的结果 schema | 交回结构化结果，调用即结束这次运行；只在 Profile 声明了结构化结果时出现 |

已有工具的改动：`ask`（t06）与 `shell`（t12）加 `async?`；`shell` 的工作目录见第 15 条。

资源地址（不另设工具）：`profiles://`（第 16 条）；`sessions://` 的根目录先列与本会话有关的会话（父、子、兄弟，带状态），其余按最近使用分页；任何会话都能读任何 `sessions://<id>/`，其中 `session.jsonl` 是原始日志（第 12、23 条）。

规则：审批按 t06 判定，要问人时交给用户，出现在子会话与父会话的待处理区（第 8、24 条）；提问缺省交给调用方；只能对自己派的子会话发话、回答；子会话继承父会话当时的审批模式与 Agent 模式；中止与上限见第 23 条；并发的 `agent_spawn` 靠第 17、24 条的工具并发。

## 当前状态

讨论完成（开发者 2026-10-30 确认定稿）：六轮决定与确定的工具见上；两轮 omp 设计审查已处理（报告在 `evidences/`）。计划与实施切片在本 Work 的讨论全部完成后另定。

## 下一步

实施时按 implementation-planning 写计划，改 Spec（会话、工具、资源、Profile）；t20 内核的三处修正与 `v5` 类型同步放进 t20 的实施计划。
