# t06 计划：bot 的主对话（内核与服务端）

## Context

- **为什么做**：w00043 第一步“能聊”要一个常驻在 NeuroBook 里的 bot，和用户在一条不断的主对话里聊下去（[bot 提案](../../../../../docs/proposals/neurobot.md)第四节第 3–5、7 小节）。t14 已经把缓冲区与宿主发出者做进内核；这里补主对话需要的会话归属、持有、发话一并结算，以及 `nbook.bots` 插件本身。界面在 [t15](../t15-messages-view/README.md)。
- **依据**：
  - Spec（本 Task 写的 planned 句子）：[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 78、111，验收 16；[`harness/session.md`](../../../../../docs/specs/harness/session.md) 的会话头与输出 25；[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md) 输出 23–27，验收 6；新建 [`bots/bots.md`](../../../../../docs/specs/bots/bots.md)、[`bots/main-conversation.md`](../../../../../docs/specs/bots/main-conversation.md)。
  - runtime 输出 4、108 里已有的 planned 句子“宿主能接着跑 `owner` 归它的会话里的运行”，随本 Task 实现。
- **开发者已定**（Task README 决定 1–5，2026-11-19）：
  - 拆出 t15；
  - 缺省 bot 用新建的内置岗位 Profile，星璃的人设作为预设的 `persona`；
  - 重启后自动接着跑不做；
  - 等用户的期限、`expired`、`expired-run` 放到第一版之后，`settlePending` 照做，bot 设置分区先不建；
  - 打开预算 2 秒，重新装配耗时不量。
- **调研**：[evidences/survey.md](evidences/survey.md)。
- **工作方式**：
  - 代码在 Work 的 worktree `.worktree/w00043-neurobot`（分支 `feat/w00043-neurobot`），开工前先把 master 并进分支；
  - 主会话写代码；
  - 计划与 Spec 先交开发者看要点，再做后端设计审查（omp）；
  - 实现后后端实现审查（omp）。

## 技术选型

无通用问题：没有新依赖。贡献点、插件存储、远程合同、诊断都用仓库现成的机制。

## 关键设计

### `packages/nb-harness/src/kernel/`：会话头 `owner` 与 `settlePending`

- **会话头**：
  - `api/events.ts` 的 `SessionHeader` 加 `owner?: {plugin: string; id: string}`；
  - `api/host.ts` 的 `CreateSessionOptions` 加同名可选项；
  - `log/validate.ts` 校验两段都是 1–128 个字符；
  - `session/session.ts` 的 `createSession` 照写，`forkSession` 不复制；
  - `log/index-file.ts` 的索引条目照抄（`SessionIndexEntry.owner`），旧索引读作没有。
- **`ToolSessionContext.owner`**：`api/host.ts` 加字段，`session/session.ts:123` 的 `context()` 从会话头取。
- **宿主接着跑有归属的会话里的运行**（runtime 输出 4、108 的 planned 句子）：`run/permissions.ts` 的 `canContinue` 收会话头，宿主发出者在 `header.owner.plugin === issuer.source.plugin` 时也能接着跑。
- **`settlePending`**（输出 111）：
  - `CommandMap["send"]["args"]` 加 `settlePending?: "deny"`；`run/commands.ts` 的 `send` 受理时，发出者不是用户得 `not-allowed`。
  - 在受理的回调里收集 `core.leafState.kernel.pending` 中不是异步的事项，写 `interactionResolved{decision: "deny", by: 用户, note: "用户发了新消息"}`，与这条话的草稿同批。
  - 认领等待者照 `run/interaction.ts` 的 `resolveCommand`：放在回调的最后一步，前面的检查都通过之后再认领；`written` 里叫醒；认领了却没写下时以 `aborted` 叫醒。
  - 把“认领一个同步事项并以给定的结算叫醒”抽成 `Interactions` 上的一个方法，`resolve` 与 `send` 共用，不各写一份。
  - 中止之后到的应答交回的 `already-answered` 现在写死 `aborted`，不动。
- 不变量：同一事项只会有一条 `interactionResolved`（认领与中止时的摘除都是同步的）；结算与新话同一个写入批。

### `packages/nb-harness/src/kit/sessions/table.ts`：持有与按会话拒绝指令

- `hold(id): Promise<{ok: true; value: {release(): void}} | {ok: false; code: string}>`：
  - 复用 `#acquire`、`#release`；
  - 打开失败把 `#open` 的码交回，不抛错（现在查询类会抛 `SessionUnavailable`）；
  - `release` 可以重复调、只生效一次；
  - 表停止之后调 `release` 什么都不做。
- `SessionTableOptions.refuse?: (header: SessionHeader, command: string) => string | null`：`view()` 的指令在进内核之前调它，得到码就交回 `{ok: false, code}`，不进内核。
  - 放在 kit：远程层与 `agentKey` 都经 `view()`，在这里拦截只有一处。
  - 规则由宿主给，kit 不认识 `owner` 的含义。

### `packages/neuro-book/src/plugins/agent/`：门面、列表与拒绝

- `shared/contracts.ts`：门面的 `create` 现在直接用内核的 `CreateSessionOptions`，改成门面自己的类型（内核选项去掉 `owner`，再加 `owner?: {id: string}`）；`AgentService` 加 `hold(sessionId)`；码 `owned-session` 进远程合同的失败码表（`shared/remote.ts`），`send` 的参数加 `settlePending`（`argsMatchKernel` 编译期对照）。
- `backend/agent.ts`：
  - **`agentFacade`**：`create` 把 `owner` 盖章成 `{plugin, id}`，没给就不写；`hold` 按门面登记，门面作废（调用方停止，`onRevoke` 的现有路径）时放掉它的全部持有。
  - **内部的 `createSession`**：照传 `owner`。
  - **`list`**：去掉有归属的条目，以及 `relations.rootOf(id)` 有归属的条目；有归属的 id 从同一份索引里取。远程 `list` 走同一个函数。
  - **`refuse`**：`header.owner !== undefined` 且指令是 `rewind`、`switchBranch`、`archive` 时得 `owned-session`。
- 远程 `create` 的参数 schema 已经不收 `owner`（`additionalProperties: false`），只补测试。

### `packages/neuro-book/src/plugins/bots/`：新内置插件 `nbook.bots`

目录照 `nbook.stickers`：

- `plugin.ts`（描述）；
- `shared/`：`contracts.ts`（预设声明 schema、远程合同 `nbook.bots/bots`、状态形状）与 `text.ts`；
- `backend/`：
  - `plugin.ts`：入口；
  - `presets.ts`：贡献点 `bots.presets` 与校验；
  - `store.ts`：bot 记录，用 `defineRecord`；
  - `create.ts`：建 bot 的步骤；
  - `main.ts`：`ensureMain`、持有、状态与指标；
  - `profile.tsx`：岗位 Profile；
- `builtin/lyra/`：`persona.md`、`avatar.webp`；
- `locales/`；
- `bots.test.ts`。

- **贡献点**（bots 输出 1）：照 `stickers.packs` 的声明与校验写。
  - 内置预设的文件用 `packageRootOf` 找（同 `stickers/backend/builtin-root.ts`），第三方用 `packages.directory`。
  - 校验路径越界与大小，不合的写诊断、不登记。
- **缺省预设与岗位 Profile**（输出 2、3）：
  - 岗位 Profile `nbook.bots.companion` 经 `agent.profiles` 交出。工具清单沿用主创的：在 `agent/shared/` 导出主创的工具常量，不复制一份。系统提示词只写岗位。
  - 人设 `persona.md` 先用 `brand/mascot/guide/01-persona.md` 的摘要，t09 换成 w00050 的定稿。
  - 头像用 `brand/mascot/gallery/portraits/` 里一张，裁成 256×256 的 webp。
- **后台任务**（输出 4，main-conversation 输出 2）：
  - `activate` 交回之前排一个任务，用 `clock.schedule(…, 0)` 或在激活交回后的微任务里起。这个任务不等 `nbook.agent` 的会话，只在激活交回之后才调 `agentKey`，所以不会等自己的激活成环（survey 的“插件平台”一节）。
  - 任务的内容：读记录 → 没有 bot 就建 → 对已有主对话的 bot 调 `hold`。
  - 用 `context.onStop` 停掉它，放掉全部持有，先于 `nbook.agent` 停（消费方先停，`close-plan.ts`）。
- **建 bot**（输出 5）：复制文件，最后写记录；记录写下之前重来时覆盖目录里的文件。撞名加后缀只看已写下的记录。
- **`ensureMain`**（main-conversation 输出 1）：
  - 每个 bot 一把内存里的串行锁（Promise 链）；
  - `agentKey.create({profile, owner: {id: botId}, id: "bot-<id>"})`，得 `session-exists` 时取快照核对 `header.owner`；
  - 然后走同一个“持有”函数。门面的 `create` 用的是内核的 `CreateSessionOptions`，已经收 `id`。
- **持有与状态**（main-conversation 输出 2、3）：
  - `hold` 失败得 `session-busy` 时用注入时钟每 5 秒重试，别的码记 `failed`；
  - 持有成功后读快照，只读时记 `read-only{code}`；
  - 状态变化推 `botsChanged`。
- **指标**（main-conversation 输出 6）：持有前后取 `clock.now()` 算耗时，事件数取快照的最后一条 `seq`，写 `bots.main-opened`；超过 2,000 毫秒另写 `bots.main-open-slow`。
- **`restoreProfile`**（输出 4）：以用户身份 `changeProfile(记录里的 profile)`；之后重读快照更新状态。
- **封闭名单**：
  - 登记：`src/manifest.ts`、`src/server/plugins.ts`、`src/web/plugins.ts`（浏览器入口只为远程调用方，没有界面）、`plugins/plugins/shared/builtin-names.ts` 与两份目录、`builtin-names.test.ts` 的旧表；
  - 顺手把漏登记的 `nbook.stickers` 补进显示名表：这是 master 上 `builtin-names.test.ts` 失败的原因，和本 Task 改同一张表；
  - 没有命令，不改 `COMMAND_DOMAINS`。

## Spec 与文档改动

- 已写（planned，与本计划同一个提交）：见 Context 的列表、注册表两行、提案的决策记录一行。
- 实施中：各 Spec 补实现合同与证据；`agent/sessions.md` 的 planned 句子有测试守住后去掉标记；两份新 Spec 实现后逐句核对再晋升。
- `server.test.ts` 若有固定的插件名单要加 `nbook.bots`（survey 第 5 节）。

## 切片

| 片 | 内容（关键设计的节） | 提交边界 | 自跑验证 |
|---|---|---|---|
| 0 | 把 master 并进 `feat/w00043-neurobot`，`bun install` | 合并提交 | `git status` 无冲突 |
| 1 | 内核：会话头 `owner`、索引、fork、`ToolSessionContext.owner`、宿主接着跑有归属的会话、`settlePending` | 内核行为，缺省不变 | nb-harness `bun test`；nb-harness、neuro-book `typecheck` |
| 2 | kit 的 `hold` 与 `refuse`；`nbook.agent` 的门面、列表、`owned-session`、远程 `send` 的 `settlePending` | 服务层 | 同上，加 neuro-book `bun test src/plugins/agent` |
| 3 | `nbook.bots`：贡献点、缺省预设与岗位 Profile、记录、建 bot、后台任务、`ensureMain`、持有与状态、指标、`restoreProfile`、封闭名单 | 新插件 | 同上，加 `bun test src/plugins/bots`、`builtin-names.test.ts`；最后 `bun run test:affected --typecheck` |
| — | 后端实现审查（omp） | | |

每片先写对应条目的测试、看它按旧行为失败，再实现。

## 验收映射

| Spec 编号 | 覆盖 |
|---|---|
| session 输出 25、会话头 | nb-harness `session/session.test.ts`（建、重开、fork 不继承、旧会话头）、`log/index-file` 的用例（照抄与旧索引） |
| runtime 输出 78 | `session/session.test.ts`：工具拿到的上下文带 `owner`，fork 的不带 |
| runtime 输出 4、108（宿主接着跑有归属的会话） | `run/buffer.test.ts` 的权限表加两格：宿主对 `owner` 归自己的会话 `start` 成功，别的插件得 `not-allowed` |
| runtime 输出 111，验收 16 | `run/interaction.test.ts`：两个审批加一个嵌套提问一并结算、同批写下；非用户得 `not-allowed`；`empty-input` 时不结算；没有待处理时等于普通 `send`；重发同一个 `commandId` |
| sessions 输出 23 | `tasks.test.ts`“按调用方盖章”：插件建的会话头 `owner.plugin` 是调用方；远程 `create` 带 `owner` 得 `invalid-input`（`sessions.test.ts`） |
| sessions 输出 24 | `agent.test.ts`：持有期间推过 30 秒不关、`release` 之后关；`session-busy`（另一个进程拿着锁，照现有的锁用例造）交回码；门面作废时放掉 |
| sessions 输出 25 | `sessions.test.ts`：远程 `list` 不列有归属的会话与它的子会话；`activity`、`running()` 照样有 |
| sessions 输出 26，验收 6 | `sessions.test.ts` 与 `tasks.test.ts`：远程与门面视图的 `rewind`、`switchBranch`、`archive` 得 `owned-session`、日志不变；子会话不受限 |
| sessions 输出 27 | `sessions.test.ts`：远程 `send` 带 `settlePending` 结算等审批的事项 |
| bots 输出 1–8，验收 1、2 | `bots/bots.test.ts`：真实 `nbook.agent` 与内核（`agentWorld` 加 `nbook.bots`），第三方预设用测试插件；建到一半被杀用“写记录之前抛错”的注入点不行，改成预先放好 bot 目录、不写记录，再启动 |
| main-conversation 输出 1–6，验收 1–3 | 同上：并发 `ensureMain`、`owner-mismatch`（预先建一个同 id 不归它的会话）、`session-busy` 重试（注入时钟推 5 秒）、只读与 `restoreProfile`、诊断 |
| 显示名表 | `builtin-names.test.ts`（顺带修好 `nbook.stickers` 漏登记） |

## 验证

- 每片：上表的单元与合同测试、两个包的 `typecheck`。
- 收口：在 worktree 里跑 `bun run test:affected --typecheck`，结果与 master 对照，原有的失败另记。
- 真实进程：起一次开发服务（`nbdev dev start`，后台），确认首次启动建出 `lyra`，远程 `list` 交回 `ready`；记下 `bots.main-opened` 的耗时。
- e2e：本 Task 没有界面，不跑 e2e；`agent-conversation.e2e.ts` 不受影响（会话列表只多过滤有归属的）。
- 未验证的边界：
  - 长会话的打开预算只在真实的长日志上才有意义；第一版只记录，不造 10 万条事件的夹具；
  - 第三方插件的预设要等插件安装（`runtime/plugin-install.md`）落地后才能端到端装上。现在只用测试插件经 `agentWorld` 登记。

## 不做与风险

- 不做：
  - 重启后自动接着跑；
  - 等用户的期限、`expired`、`expired-run`；
  - bot 设置分区；
  - `bots://` 方案与写授权、人设与记忆进提示词（t09）；
  - 界面、未读、有归属的会话打开到 bot 视图（t15）。
- 风险：
  - **后台任务与停止的先后**：停止发生在任务还在 `create` 或 `hold` 的半路时，后到的持有要立即放掉。测试：停止时让 `hold` 挂着（打开会话的扩展激活挂住，照 `agent.test.ts` 现有的停止用例），停止后断言没有残留的引用、会话按 `interrupted` 关闭。
  - **`settlePending` 与中止同时到**：中止先摘掉等待者时 `send` 认领不到。这时这条话照常受理、只结算还能认领的，测试里造“运行正在中止时带 `settlePending` 发话”。
