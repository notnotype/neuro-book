# t06 计划：bot 的主对话（内核与服务端）

第 2 稿（2026-11-19）：按设计审查第一轮的处理修订，见 [evidences/design-review-disposition.md](evidences/design-review-disposition.md)。

## Context

- **为什么做**：w00043 第一步“能聊”要一个常驻在 NeuroBook 里的 bot，和用户在一条不断的主对话里聊下去（[bot 提案](../../../../../docs/proposals/neurobot.md)第四节第 3–5、7 小节）。t14 已经把缓冲区与宿主发出者做进内核；这里补主对话需要的会话归属、持有、读会话头、发话一并结算，以及 `nbook.bots` 插件本身。界面在 [t15](../t15-messages-view/README.md)。
- **依据**（本 Task 写的 planned 句子）：
  - [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 78、111，验收 16，“目标与非目标”里两条；
  - [`harness/session.md`](../../../../../docs/specs/harness/session.md) 的会话头、输出 25、26、两条已知限制、失败码 `invalid-owner`；
  - [`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md) 输出 23–28，验收 6；
  - 新建 [`bots/bots.md`](../../../../../docs/specs/bots/bots.md)、[`bots/main-conversation.md`](../../../../../docs/specs/bots/main-conversation.md)。
  - runtime 输出 4、108 里“宿主能接着跑 `owner` 归它的会话里的运行”的 planned 句子，这次不实现（自动接续搁置后没有调用方，审查第 14 条）。
- **开发者已定**（Task README 决定 1–5，2026-11-19）：
  - 拆出 t15；
  - 缺省 bot 用新建的内置岗位 Profile，星璃的人设作为预设的 `persona`；
  - 重启后自动接着跑不做；
  - 等用户的期限、`expired`、`expired-run` 放到第一版之后，`settlePending` 照做，bot 设置分区先不建；
  - 打开预算 2 秒，重新装配耗时不量；
  - 第 1 稿的要点开发者答“没问题”。第 2 稿改了的地方要再给开发者看。
- **调研与探针**：
  - [evidences/survey.md](evidences/survey.md)；
  - 设计审查的探针 [evidences/design-review-probes/](evidences/design-review-probes/)，其中 `own-published-probe` 是主 Agent 跑的。
- **工作方式**：
  - 代码在 Work 的 worktree `.worktree/w00043-neurobot`（分支 `feat/w00043-neurobot`），开工前先把 master 并进分支；
  - 主会话写代码；
  - 实现后做后端实现审查（omp）。

## 技术选型

无通用问题：没有新依赖。贡献点、插件存储、远程合同、诊断、打包白名单都用仓库现成的机制。

## 关键设计

### `packages/nb-harness/src/kernel/`：会话头 `owner`、读会话头、`settlePending`

- **会话头**：
  - `api/events.ts` 的 `SessionHeader` 加 `owner?: {plugin: string; id: string}`；`api/host.ts` 的 `CreateSessionOptions` 加同名可选项。
  - **校验**：一个函数，`log/validate.ts` 读日志时用、建会话时也用。规则：两段各 1–128 个字符，限 `[A-Za-z0-9._-]`。建会话时不合，在解析 Profile 与写会话头之前交回 `invalid-owner`（审查第 24 条）。
  - `session/session.ts` 的 `createSession` 照写，`forkSession` 不复制。
  - `log/index-file.ts` 的索引条目照抄（`SessionIndexEntry.owner`），旧索引读作没有。
- **会话头冻结**：会话头在建与读的地方冻结（`Object.freeze`，含 `owner` 与 `caller`），快照交出的就是冻结的对象，`ToolSessionContext` 同样冻结（审查第 9 条）。
- **`ToolSessionContext.owner`**：`api/host.ts` 加字段，`session/session.ts:123` 的 `context()` 从会话头取。NeuroBook 审批预览自己拼的上下文（`agent/backend/remote.ts` 的 `approvalPreview`）补上 `background` 与 `owner`（审查第 28 条）。
- **读会话头**（session 输出 26）：
  - `LogStore` 加 `header(id)`：不取锁、不修复，只读 `session.jsonl` 的第一行并照日志的规则校验；
  - 内核的宿主（`AgentHost`）照它交出 `header(id)`；
  - 内存存储同样实现。会话头建后不变，读到的就是权威值。
- **建会话的存在性检查**（审查第 26 条）：`jsonl-store.ts` 的 `create` 在拿到锁之后再查一次日志在不在，在就得 `session-exists`、不改动。
- **`settlePending`**（输出 111）：
  - **参数**：`CommandMap["send"]["args"]` 加 `settlePending?: "deny"`；`run/commands.ts` 的 `send` 在 `decide` 里判发出者，不是用户得 `not-allowed`。重放仍在 `decide` 之前，不比较发出者（审查第 23 条）。
  - **结算**：在受理的回调里收集 `core.leafState.kernel.pending` 中不是异步的事项，写 `interactionResolved{decision: "deny", by: 用户, note: "用户发了新消息"}`，与这条话的草稿同批。
  - **认领**：`Interactions` 加 `claim(id)` 的升级版，交回 `{wake(resolution), giveBack()}`，`resolve` 与 `send` 共用：
    - 在回调最后一步认领，前面的检查都通过之后才做；
    - `written` 里 `wake`；
    - 受理批没写下时 `giveBack`：把这次等待交还给发起它的调用，由它照中止的那一支写 `aborted` 或 `interrupted`，不留悬空的事项（审查第 11 条，`resolve` 同受益）。
  - **不变量**：同一事项只会有一条 `interactionResolved`；结算与新话同一个写入批。
  - **已知限制**（审查第 2 条）：受理批写下、反应批写失败时，等待者被以 `aborted` 叫醒，与日志不一致；runtime 的“目标与非目标”写明。
- **不做**：只读打开不恢复、只有会话头的半成品日志（审查第 6、7 条），记进 session.md 的已知限制，另建跟进。

### `packages/nb-harness/src/kit/sessions/table.ts`：持有、读会话头、按会话拒绝指令

- **`hold(id)`**：交回 `Promise<{ok: true; value: {release(): void}} | {ok: false; code: string}>`。
  - 复用 `#acquire`、`#release`；
  - 打开失败把 `#open` 的码交回，不抛错；
  - `release` 可以重复调、只生效一次；表停止之后调 `release` 什么都不做；
  - 表停止期间到的 `hold` 得 `unavailable`；
  - 打开在表停止之后才交回时，立即放掉、交回 `unavailable`。
- **`header(id)`**：会话开着时用句柄里冻结的会话头，没开时经宿主的 `header(id)` 读，不打开会话。
- **`SessionTableOptions.refuse?: (header: SessionHeader, command: CommandName) => "owned-session" | null`**：
  - `view()` 的指令在进内核之前调它，用的是 `header(id)` 拿到的会话头，冷会话不打开（审查第 22 条补充）；
  - 得到码就交回 `{ok: false, code}`，不进内核；
  - 码的类型写进三个受限指令的结果类型，不用强转；
  - 放在 kit：远程层与 `agentKey` 都经 `view()`，拦截只有一处；规则由宿主给，kit 不认识 `owner` 的含义。

### `packages/neuro-book/src/plugins/agent/`：门面、列表与拒绝

- **`shared/contracts.ts`**：
  - 门面的 `create` 改用门面自己的选项类型：内核选项去掉 `owner`，加 `owner?: {id: string}`；
  - `AgentService` 加 `hold(sessionId)`、`header(sessionId)`；
  - 码 `owned-session`、`invalid-owner` 进远程合同的失败码表（`shared/remote.ts`）；
  - `send` 的参数加 `settlePending`（`argsMatchKernel` 编译期对照）。
- **`backend/agent.ts`**：
  - **`agentFacade`**：
    - `create` 把 `owner` 盖章成 `{plugin, id}`，没给就不写；
    - 盖章的发出者冻结（含 `source`）；
    - 门面有一个“已作废”的标记：作废之后交出的视图与 `as` 派生的视图调用都抛 `ServiceRevokedError`（审查第 17 条）；
    - `hold` 按门面登记，作废时放掉全部，作废之后才交回的持有立即放掉。
  - **内部的 `createSession`**：照传 `owner`。
  - **`list`**：
    - 先取全部索引（含后台、归档），算出有归属的根；
    - 再按 `relations.rootOf(id)` 去掉有归属的根与它们的后代；
    - 最后应用调用方的筛选（审查第 8 条）；
    - 远程 `list` 走同一个函数；
    - 关系表断链沿用现状，sessions.md 写成已知限制。
  - **`refuse`**：`header.owner !== undefined` 且指令是 `rewind`、`switchBranch`、`archive` 时得 `owned-session`。
- 远程 `create` 的参数 schema 已经不收 `owner`（`additionalProperties: false`），只补测试。

### `packages/neuro-book/src/plugins/bots/`：新内置插件 `nbook.bots`

目录照 `nbook.stickers`：

- `plugin.ts`：描述；
- `shared/`：
  - `contracts.ts`：预设声明 schema、远程合同 `nbook.bots/bots`、持有状态的形状；
  - `text.ts`；
- `backend/`：
  - `plugin.ts`：入口；
  - `presets.ts`：贡献点 `bots.presets` 与接收方；
  - `store.ts`：bot 记录，用 `defineRecord`；
  - `create.ts`：建 bot；
  - `main.ts`：`ensureMain`、持有、状态与指标；
  - `profile.tsx`：岗位 Profile；
  - `builtin-root.ts`：内置资源的查找；
- `builtin/lyra/`：`persona.md`、`avatar.webp`；
- `locales/`；
- `bots.test.ts`。

- **贡献点与接收方**（bots 输出 1）：
  - 点的 schema 交给平台校验，重复 id 照平台规则两份都不接受，声明里没有冗余的 `id`；
  - 接收方在 `published` 里核对文件，记进“可用的预设”表，不合的写 `bots.preset-invalid`：
    - 内置的用 `builtin-root.ts`，照 `stickers/backend/builtin-root.ts` 的 `packageRootOf`；
    - 第三方的经平台的插件包查询，按相对路径找文件，不拼字符串；
    - 平台现在只有按目录查询（`packages.directory`），要加一个按相对路径查文件的查询，复用 `entryInside`（审查第 21 条）；
  - 撤回时从表里拿掉。
- **打包**（审查第 13 条）：`builtin/lyra/` 照内置表情包进 `scripts/pack-app.ts` 的白名单与相对查找，`pack-app.test.ts` 的解包测试核对两份文件可读。
- **缺省预设与岗位 Profile**（输出 2、3）：
  - 岗位 Profile `nbook.bots.companion` 经 `agent.profiles` 交出。工具清单与模式扩展沿用主创：在 `agent/shared/` 或 `agent/backend/builtin/profiles/` 导出主创的工具常量与 `modesExtensions`，不复制一份。`shell` 照主创可选（审查第 19 条）。系统提示词只写岗位。
  - 人设 `persona.md` 先用 `brand/mascot/guide/01-persona.md` 的摘要，t09 换成 w00050 的定稿。
  - 头像用 `brand/mascot/gallery/portraits/` 里一张，裁成 256×256 的 webp。头像怎样给浏览器归 t15（审查第 4 条）。
- **后台任务**（bots 输出 4、“时序与寿命”，main-conversation 输出 2）：
  - **起点**：接收方的 `published` 收到 `nbook.bots.lyra`（自己的缺省预设）且文件核对通过时，开始后台任务（审查第 5 条）。主 Agent 的探针证实：那时它交出的岗位 Profile 已能解析，`agentKey.create` 能完成、不成环。缺省预设核对不通过时写 `bots.default-preset-missing`。
  - **内容**：
    1. 读记录（读不懂时写 `bots.record-unreadable`、停下）；
    2. 没有 bot 就建；
    3. 对每个 bot 读会话头，归属对就 `hold`。
  - **停止**（审查第 12 条）：
    - 激活时拿到的 `context.signal` 一触发，就同步封住：不再开始新的步骤、不再排重试；
    - `onStop` 等在途的一步结束，再放掉全部持有；
    - 在途的 `hold` 在信号之后才交回时立即放掉。
- **建 bot**（输出 5，审查第 10、21 条）：
  - 缺省 bot 的 id 固定是 `lyra`；
  - 先复制进 `<状态根>/user/bots/.staging-<随机>/`，再改名成 `<id>/`，最后写记录、读回确认；
  - 启动时 `<id>/` 在、记录不在，就补写记录；`.staging-*` 删掉；
  - 记录保存的结果不确定时，以重读为准。
- **`ensureMain`**（main-conversation 输出 1，审查第 3、20 条）：
  - 每个 bot 一把内存里的串行锁（Promise 链）；
  - 已持有就交回；
  - 否则先 `header("bot-<id>")`：
    - 在、归属对 → `hold`；
    - 在、归属不对 → `owner-mismatch`；
    - `session-not-found` → `create({profile, owner: {id}, id})`，得 `session-exists` 回到读会话头；
    - 别的码原样交回。
  - 门面的 `create` 用的是内核的 `CreateSessionOptions`，已经收 `id`。
- **持有状态**（main-conversation 输出 3，审查第 15、27 条）：
  - 只有 `none`、`opening`、`held`、`failed{code}`，变化推 `botsChanged`；
  - 不报只读与损坏：那由会话自己的快照与帧说明。
- **持有的重试与指标**（main-conversation 输出 2、6）：
  - `session-busy` 时用注入时钟每 5 秒重试，重试的等待不算进耗时；
  - 冷打开的耗时用 `clock.now()` 量，从调 `hold` 到它交回；
  - 事件数取快照的 `head`；
  - 写 `bots.main-opened`，超过 2,000 毫秒另写 `bots.main-open-slow`。
- **Profile 解析不到**：持有照样成功；用户经现有的远程 `changeProfile`（带 `commandId`）换 Profile，不另开 `restoreProfile`（审查第 22 条）。
- **封闭名单**：
  - 登记：`src/manifest.ts`、`src/server/plugins.ts`、`src/web/plugins.ts`（浏览器入口只为远程调用方，没有界面）、`plugins/plugins/shared/builtin-names.ts` 与两份目录、`builtin-names.test.ts` 的旧表；
  - 顺手把漏登记的 `nbook.stickers` 补进显示名表：这是 master 上 `builtin-names.test.ts` 失败的原因，和本 Task 改同一张表；
  - 没有命令，不改 `COMMAND_DOMAINS`。

## Spec 与文档改动

- 已写（planned）：见 Context 的列表、注册表两行、提案的决策记录一行。第 2 稿的修订与本计划同一个提交。
- 实施中：各 Spec 补实现合同与证据；`agent/sessions.md` 的 planned 句子有测试守住后去掉标记；两份新 Spec 实现后逐句核对再晋升。
- `server.test.ts` 若有固定的插件名单要加 `nbook.bots`（survey 第 5 节）。
- 跟进：审查第 2、6、7 条（内核原有的窄窗口缺陷）与关系表断链，建在哪个 Work 待开发者定。

## 切片

| 片 | 内容（关键设计的节） | 提交边界 | 自跑验证 |
|---|---|---|---|
| 0 | 把 master 并进 `feat/w00043-neurobot`，`bun install` | 合并提交 | `git status` 无冲突 |
| 1 | 内核：会话头 `owner` 与校验、冻结、索引、fork、`ToolSessionContext.owner`、读会话头、建会话的存在性检查、`settlePending` 与共用的认领 | 内核行为，缺省不变 | nb-harness `bun test`；nb-harness、neuro-book `typecheck` |
| 2 | kit 的 `hold`、`header`、`refuse`；`nbook.agent` 的门面（盖章、冻结、作废）、列表、`owned-session`、远程 `send` 的 `settlePending`、审批预览的上下文 | 服务层 | 同上，加 neuro-book `bun test src/plugins/agent` |
| 3 | `nbook.bots`：贡献点与接收方、按相对路径查文件、打包、缺省预设与岗位 Profile、记录、建 bot、后台任务与停止、`ensureMain`、持有状态与指标、封闭名单 | 新插件 | 同上，加 `bun test src/plugins/bots`、`builtin-names.test.ts`、`pack-app.test.ts`；最后 `bun run test:affected --typecheck` |
| — | 后端实现审查（omp） | | |

每片先写对应条目的测试、看它按旧行为失败，再实现。

## 验收映射

| Spec 编号 | 覆盖 |
|---|---|
| session 输出 25、会话头 | nb-harness `session/session.test.ts`：建、重开、fork 不继承、旧会话头、`invalid-owner`（空、129 个字符、非法字符，建后不落盘）、快照里的会话头改不动；`log/index-file` 的用例：照抄与旧索引 |
| session 输出 26 | `log/store.test.ts`（JSONL 与内存）：别的进程持有锁时也读得到；不在、第一行坏、`format` 不认识三个码；不修复尾部 |
| 建会话的存在性检查 | `log/store.test.ts`：照审查者的 `held-storage-probes` 写，晚到的建会话拿到锁后得 `session-exists`、先前的日志字节不变 |
| runtime 输出 78 | `session/session.test.ts`：工具拿到的上下文带 `owner`，fork 的不带 |
| runtime 输出 111，验收 16 | `run/interaction.test.ts`。验收 16 的夹具照审查者 `kernel-probes` 的做法：同一个 `shared` 段里两次改参复审加一个嵌套同步提问。另覆盖：多项初审一并结算；非用户得 `not-allowed`；`empty-input`、`input-rejected` 时都不结算、事项还在；没有待处理时等于普通 `send`；重发同一个 `commandId`；受理批因会话关闭没写下时事项由中止那一方结算 |
| sessions 输出 23 | `tasks.test.ts`“按调用方盖章”：插件建的会话头 `owner.plugin` 是调用方、`invalid-owner`、发出者改不动；`sessions.test.ts`：远程 `create` 带 `owner` 得 `invalid-input` |
| sessions 输出 24 | `agent.test.ts`：持有期间推过 30 秒不关、`release` 之后关；`session-busy`（照现有的锁用例造）交回码；只停调用方插件：持有放掉、旧视图与 `as` 派生的视图抛 `ServiceRevokedError`；打开挂住时停调用方，交回后立即放掉 |
| sessions 输出 25 | `sessions.test.ts`：有归属且是后台的根、它的前台子会话都不列；`activity`、`running()` 照样有 |
| sessions 输出 26，验收 6 | `sessions.test.ts` 与 `tasks.test.ts`：远程与门面视图的 `rewind`、`switchBranch`、`archive` 得 `owned-session`。冷会话（有没收口的运行）拒绝前后日志字节一致、没有打开；子会话不受限 |
| sessions 输出 27、28 | `sessions.test.ts`：远程 `send` 带 `settlePending` 结算等审批的事项；`agent.test.ts`：门面的 `header` 冷会话不打开 |
| bots 输出 1–8，验收 1 | `bots/bots.test.ts`，真实 `nbook.agent` 与内核（`agentWorld` 加 `nbook.bots`）：首启建 `lyra`；改名之后、写记录之前的现场（预先放好 `<id>/`、不写记录）补写；`.staging-*` 清掉；记录读不懂不重建；岗位 Profile 真调 `switch-mode` 得合法结果 |
| bots 验收 1 的安装包形态 | `pack-app.test.ts`：解出的 `server/` 里找得到两份文件 |
| bots 验收 2 | 照 `cli.test.ts` 的安装夹具装一个带两个预设的第三方插件，走启动集合、`PluginPackages` 与真实宿主 |
| main-conversation 输出 1–6，验收 1–4 | `bots/bots.test.ts`：并发 `ensureMain`；`owner-mismatch`（预先建一个同 id、带没收口运行的不归它的会话，字节不变）；`session-busy` 重试（注入时钟推 5 秒）；Profile 解析不到时持有成功；冷打开超过 2,000 毫秒的告警（注入时钟）；停止信号之后不再重试、不留引用 |
| 显示名表 | `builtin-names.test.ts`（顺带修好 `nbook.stickers` 漏登记） |

## 验证

- 每片：上表的单元与合同测试、两个包的 `typecheck`。
- 收口：在 worktree 里跑 `bun run test:affected --typecheck`，结果与 master 对照，原有的失败另记。
- 真实进程：起一次开发服务（`nbdev dev start`，后台），用全新的状态根确认首次启动建出 `lyra`、状态 `none`；经远程 `ensureMain` 后 `held`，记下 `bots.main-opened` 的耗时。
- e2e：本 Task 没有界面，不跑 e2e；`agent-conversation.e2e.ts` 不受影响（会话列表只多过滤有归属的）。
- 未验证的边界：长会话的打开预算只在真实的长日志上才有意义；第一版只记录，不造 10 万条事件的夹具。

## 不做与风险

- 不做：
  - 重启后自动接着跑，以及宿主接着跑有归属的会话的权限；
  - 等用户的期限、`expired`、`expired-run`；
  - bot 设置分区；
  - `restoreProfile`（用现有的 `changeProfile`）；
  - 头像的取法、界面、未读、有归属的会话打开到 bot 视图（t15）；
  - `bots://` 方案与写授权、人设与记忆进提示词（t09）；
  - 内核原有的三个窄窗口缺陷（审查第 2、6、7 条，写进 Spec 的已知限制）。
- 风险：
  - **`settlePending` 与中止同时到**：中止先摘掉等待者时 `send` 认领不到，这时这条话照常受理、只结算还能认领的；测试里造“运行正在中止时带 `settlePending` 发话”。
  - **按相对路径查文件的新查询**：改平台的插件包接口（`plugin-platform/backend/packages.ts`），要照现有 `directory` 的测试补用例。
