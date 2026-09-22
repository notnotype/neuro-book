---
schema: nbook.task/v2
taskId: t01-inline-ai-send-owner-fix
---

# 修复 Inline AI 发送 owner 与打开 Session 聊天

## 目标

修复 Issue #227：0.10.x 上 Inline AI 发送在 Agent 面板挂载/未挂载两种状态下都不发起请求；「打开 Session 聊天」无反应。

## 修改范围

已落地（分支 `fix/w00014-inline-ai-send-owner` 的实现提交；迁移前的临时状态与编排顺序见缺口 1 的记录）：

1. `app/pages/index.vue` — `InlinePromptOwner` 去掉 `surface` 字段；`captureInlinePromptOwner()`/`acceptsInlinePromptOwner()` 改用 `inlineEditorAgent.operationScopeKey.value`（约 207-224）。
2. `app/pages/index.vue` — `sendInlineEditorPrompt()` 发送调用恢复两实参（约 1080-1082），不再传 `owner.operationKey`。
3. `app/pages/index.vue` — `openInlineEditorSessionChat()` 改为 `inlineEditorAgent.openSession()` + `showAgentSession(result.value.sessionId)`，删除 `agentSessionPanelOpen = true`、`owner.surface.openInlineEditorSession()` 与其 `failed` 分支（约 1146-1159）。
4. `app/pages/index.vue` — 删除 `watch([inlinePromptAvailable, agentSurfaceRef], …refreshInlineEditorSessions…)`；scope watcher 数据源换成 `inlineEditorAgent.operationScopeKey`（约 1186-1191）。
5. `app/composables/useInlineEditorAgentController.ts` — `captureOperation()` 去掉 `expectedOperationKey` 形参（约 224-226）；`sendPrompt()` 去掉第三个形参（约 408-412）。
6. `app/components/novel-ide/agent/AgentChatSurface.vue` — `defineExpose` 移除已死的 `inlineOperationScopeKey`（约 3781-3786）。

## 验证

- `bun run --cwd packages/neuro-book test -- useInlineEditorAgentController` → 1 file / 1 test 通过（每步后各跑一次）。
- `bun run --cwd packages/neuro-book typecheck` → 退出码 0，0 条 `error TS`。
- 隔离状态根 + dev server(3010) + Chrome 自动化：面板关闭时发送 → `POST /api/agent/sessions/1/invocations` 200；面板打开时发送同样 200；点击「打开 Session 聊天」→ Agent 面板挂载（`[data-agent-panel]` 0→1）并 `GET /api/agent/sessions/1?view=recovery`。
- 原始证据与分析见 `walkthroughs/001-leader-2026-09-14-inline-ai-send-owner-fix.md` 与 `evidences/2026-09-14-inline-ai-send-owner-verification.md`。

自审（code-review-and-quality 五轴）结论：**Approve**，无 Critical/Required 项；缺口见下节。

## 未完成与缺口

1. **治理顺序：登记、迁移、分支 push 与 PR 均已完成，等待 review / 合并**——登记提交 `5c4fccfc` 已推送 `origin/master`；实现 worktree `.worktree/w00014-issue-227-inline-ai-send-owner` 与分支 `fix/w00014-inline-ai-send-owner` 已建；原主工作区未提交的 3 个源码文件与 `walkthroughs/`、`evidences/` 已在分支提交，主工作区副本已删除。**当前遗留**：分支已 push 并开 PR **#235**（https://github.com/notnotype/neuro-book/pull/235 ，合并需用 merge commit、不要 squash），待 review/合并；Task 缺口 8（Spec）与 9（组件文档）仍阻塞 Task 关闭。以下两段是该链路的编排顺序与历史取证（**均已解决**，保留以便回溯）。
   迁移顺序（**已按此执行**）：① 仅暂存 `.agents/works/w00014-issue-227-inline-ai-send-owner/**` 的登记文件提交；② 推送该提交进入远端 `master`；③ 从该基线创建 `.worktree/w00014-issue-227-inline-ai-send-owner` + `fix/w00014-inline-ai-send-owner`；④ 把源码改动与 `walkthroughs/`、`evidences/` 移入该分支提交，并从主工作区删除副本。**注意**：正式分支名是 `fix/w00014-inline-ai-send-owner`（按根规则 `{type}/{refs}-{slug}`，refs 用 Work 编号），早期计划里写的 `fix/i227-…` 是笔误。
   **已完成（2026-09-14）**：开发者指示把主工作区 `master` 与 `origin/master` 对齐后，本条链路已执行完毕——① 主工作区 `master` 从 `0dba865f` 对齐到 `origin/master`（`26244cf1`；本地原为 PR 合并前的同题副本历史，对齐前本地历史保存在 `refs/backup/i227-local-master`）；11 个"纯分叉"文件取上游内容，全部未提交改动（他人 WIP 与本次修复）逐一保留，2 个同时带他人改动的 w00009 文件未动；② 登记提交 `5c4fccfc`（仅 Work + Task 正文，86 行）已推送 `origin/master`；③ 实现 worktree `.worktree/w00014-issue-227-inline-ai-send-owner` + 分支 `fix/w00014-inline-ai-send-owner` 已从该基线创建；④ 3 个源码文件与 `walkthroughs/`、`evidences/` 已迁入该分支，主工作区副本已删除。**遗留**：合并状态与 Spec/组件文档缺口见本节首段与 Task 缺口 8/9。
   **历史取证（2026-09-14 `git fetch` 后，已解决）**：`git rev-list --left-right --count origin/master...HEAD` = `12  8`——本地 `master` 与 `origin/master` 已分叉：远端经 PR #230/#231 合并了同题的另一套历史（远端 `dbfb17ff` ↔ 本地 `10358f2b`、远端 `26244cf1` ↔ 本地 `0dba865f`），且 `git diff --stat origin/master HEAD` 有 13 个文件的内容差异（`git diff --name-status` 全名单：`.agents/works/w00009|w00013` 的记录/证据 3 个、`packages/neuro-book/server/{app-logs,plugins,runtime}` 6 个、`scripts/{build,deploy,release}` 4 个，+116/−292；**`packages/neuro-book/app/**` 与 `shared/**` 两侧完全一致**——本次改动的 3 个文件及其前端依赖同内容，差异属 Issue 228/229 的 server/脚本工作；不得把该 diff 概括为"内容等价"，也不得在未核对依赖的情况下默认两侧可互换）。因此登记提交**无法 fast-forward 推送**；按仓库规则不得强推、不得在主工作区（含他人未提交改动）rebase 或合并。**状态：该阻塞已解决**——开发者指示把主工作区 `master` 与 `origin/master` 对齐，随后按上述顺序执行完毕（对齐前的本地历史保存在 `refs/backup/i227-local-master`）。
2. **冷启动 create 分支未在浏览器复验**：隔离状态根中 inline session 已存在，故未观察到「无 session 时 `POST /api/agent/sessions` 创建 → 再 invoke」这一条完整链路（`sendPrompt` → `ensureSession` 的 create 分支代码本次未改动；先前排查已验证同类 `POST /api/agent/sessions` 200）。
3. **真实模型成功运行未验证**：本机隔离状态根未启用模型，invoke 返回 `status:"error"`（`模型未启用或不存在`），据此产生 live panel 与「打开 Session 聊天」入口；真实 Provider/Model 运行需单独授权。
4. **缺少自动化回归测试**：该缺陷是页面 wiring 级、只有端到端可观测；现有 `product:browser-smoke` 只验证 Product 首屏挂载与 `/api/app/version`，未覆盖交互流。可行方案（未执行）：在其基础上增加「打开项目 → 展开 Inline AI → 发送 → 断言 `POST /api/agent/sessions/:id/invocations`」，需要新的交互层 E2E 支撑，属独立排期决策。
5. **surface inline 机制成为孤儿/重复实现（不是可证明的死代码）**：`AgentChatSurface` 的 `inlineEditorSessions`/`inlineEditorSessionId(Identity)`/`ensureInlineEditorSession`/`loadInlineEditorSession`/`sendInlineEditorPrompt`/`openInlineEditorSession`/`refreshInlineEditorSessions`/`inlineEditorStream`/`handleInlineEditorInvokeResult` 及其 `defineExpose` 字段在修复后**没有外部入口**。精确边界：修复前页面消费的是 surface 的 `openInlineEditorSession`、`refreshInlineEditorSessions`、`inlineOperationScopeKey`（以及主会话的 `ensureSessionReady`/`selectSession`）；**发送**一直走 controller 的 `sendPrompt`，页面从未调用 surface 的 `sendInlineEditorPrompt`——该实现（含其内部 `captureInlineSurfaceOperation(expectedOperationKey)` 形参）很可能在本 patch **之前**就已无调用方（其自身模板也不调用，全仓检索只剩定义）。其内部调用图仍自洽可运行（如 `handleInlineEditorInvokeResult` → `refreshInlineEditorSessions`），并与 controller 构成同一能力的第二份实现，属收敛对象而非可安全删除的死代码；`showAgentSession()` 走 controller 主会话路径，不经过它。是否删除/合并由后续 Task 决定，删除前需确认。
6. **浏览器记忆双格式遗留**：surface 写 schema-2 JSON、controller 写纯数字，共用 `agent:inline-editor-session:<scope>`；修复后页面路径只走 controller，旧值会回落为列表首项，未做迁移。
7. **Agent 模式布局当前 UI 不可达（代码仍在，不是不存在）**：`layoutMode`、`isAgentMode`、`toggleAgentLayoutMode()`（`index.vue` 约 366/1414/1502/1514/1527 行）与 Agent 模式侧栏 `AgentModeSessionSidebar` 都还在，但 `toggleAgentLayoutMode` 在页面上**没有调用方/事件入口**，因此切不到 Agent 模式。本次改动只是不再从「打开 Session 聊天」写 `agentSessionPanelOpen`（那是 #47 引入的唯一写入点）。
8. **Spec 缺口未闭合（阻塞 Task 关闭）**：本次改变了 Inline AI Prompt Bar 的可观察行为，而 `docs/specs/README.md` 的 Bug 流要求「现有材料能推出唯一行为、但 Spec 没写：在 Task 内补齐合同」「既有未记录行为可以先修代码，但同一 Task 完成前必须补齐或更新 `implemented` Spec」。当前行为落点是用户文档 [`vitepress/locales/zh-Hans/core/markdown-studio.md#inline-ai`](../../../../../vitepress/locales/zh-Hans/core/markdown-studio.md)（已承诺「Inline AI 不占用主会话，发送后不会自动弹开右侧 Agent 面板」，正是本次修复恢复的设计）；`docs/specs/README.md`「规范缺口」已把「Markdown Studio 与编辑工作台」登记为 P1 待迁移域（证据：该用户文档、历史 editor plan、`shared/editor-workbench.ts`），`packages/neuro-book/assets/reference/agent/profile-routing.md` 只是 profile 职责地图、不是 UI 行为合同。
   本次**未**新建 capability Spec：该域迁移尚未开始，且 `docs/specs/README.md` 的「Reference 迁移合同」要求每个待迁域一次性完成正文分类、投影、合同测试与入口切换——单方先建一份 capability 文件会产生第二份可独立修改的正文，违反「每项功能只有一个当前真相源」。因此登记为缺口，按上述 P1 优先级排期并由后续 owner 补齐 `implemented` behavior Spec（九个固定章节 + `nbook.spec/v1` frontmatter + README 注册表条目）。
   **决策（2026-09-14，开发者本会话）**：按 `docs/specs/README.md`「规范缺口」表给该域登记的 **P1 优先级**排期迁移，由后续明确的 owner 补齐 `implemented` 合同；本 Work 不新建正文。**注意**：该表只登记优先级、现有证据与缺口，**当前并不存在可转交的迁移 workstream 或 owner**——需要新建 Task（必要时含 Work）承载后才能推进。决策来源为开发者消息「可以交给 P1 迁移」。缺口 8 因此从"待决策"变为"按 P1 优先级排期，尚无 owner"，仍**阻塞本 Task 关闭**（`docs/specs/README.md` 的 Bug 流要求同一 Task 补齐 `implemented` 合同；本 Work 记录的是开发者已接受的推迟，迁移落地时需回到本 Task 收口）。
9. **组件文档缺失（按 `docs/standards/code/components.md` 属「待声明」）**：本次修改了 `AgentChatSurface.vue`，但该组件没有同名 `AgentChatSurface.md`（全仓不存在），也没有能力标签 frontmatter。`app/**` 下组件同名文档整体缺失（全仓仅 `app/utils/theme/README.md` 一份 md），仓库内也没有对应的自查脚本；该规范只报告、不阻断构建。本 Task 未补文档，不把组件规范合规写成已闭合。
10. **窄屏未验证**：`docs/standards/code/frontend.md` 要求前端改动说明桌面与窄屏影响，本次只有桌面 1280×720 的真实页面证据，未跑 390×844（Prompt Bar / 面板的窄屏行为未知）。
11. **超长文件待拆分（既有，非本次引入）**：`index.vue`（2852 行）与 `AgentChatSurface.vue`（4454 行）都远超 `frontend.md` 的「`.vue` 达到或超过 800 行是硬审查线」；本次改动净减少代码、未新增职责，拆分仍待办。

## 边界

不执行远端 Issue/Project/PR 写入、push、合并、发布、部署、真实 Provider/Model 或数据删除；这些与 Work 登记提交都需开发者单独授权。Task 结果类型是实现，canonical role 登记为 `tasker`；本次实现与验证由 Leader 在开发者本会话直接授权下执行（偏离 `.agents/roles/leader/AGENTS.md`「Leader 不实现业务代码」的分工），记录在案以便后续按 role 派发。

**身份变更留痕（按 `.agents/roles/tasker/AGENTS.md`「不得修改 Work 或 Task 身份来掩盖偏差」）**：本 Task README 首次写入时为 `role: leader`，复核后改为 `tasker`，理由是 Task 结果类型为「实现」、与同类 Issue Task（w00010/w00011/w00013 的 t01）一致；**该改名不是流程补救**，不代表实现主体已变成 Tasker。真实历史：实际执行者 Leader（开发者本会话直接指令「执行计划」，等价于授权 Leader 直接实现）；原始登记 role `leader`；当前 canonical role `tasker`；授权来源为开发者本会话消息，非角色合同推导。治理报告与任何后续恢复流程以本条映射为准。

**受限动作与后续 Task（逐项，不因本记录而视为已授权或已放弃）**：

- 下列动作性质上均需开发者**逐项授权**（已执行/未授权见下方留痕）：登记提交、push 到远端 `master`、实现 worktree/branch 创建与迁移、Issue #227 远端回帖、真实 Provider/Model 验证。
- 属**后续 Task**（不需远端授权，但要新 Task 承载，不能视为已排除）：`AgentChatSurface` inline 孤儿/重复实现收敛或删除（缺口 5）、组件同名文档与能力标签补齐（缺口 9）、`docs/specs` 行为合同补齐（缺口 8）、自动化回归测试（缺口 4）、窄屏 390×844 验证（缺口 10）、超长 `.vue` 拆分（缺口 11）。

**已执行的远端写入（均有授权）**：① 2026-09-14 在 Issue #227 回帖记录根因、影响版本、修复与验证（授权来源：开发者消息「开 issue 记录」）→ https://github.com/notnotype/neuro-book/issues/227#issuecomment-5661161293 ；② 登记提交 `5c4fccfc` push 到 `origin/master`（授权来源：开发者选择「把主工作区 master 与 origin/master 对齐，之后按治理顺序继续」）；③ 实现分支 `fix/w00014-inline-ai-send-owner` push + PR **#235** 创建（授权来源：开发者消息「1. b」）。**仍未授权**：合并、发布/部署、真实 Provider/Model。
