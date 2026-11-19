---
schema: nbook.task/v2
taskId: t06-main-conversation
status: active
updated: 2026-11-19
---

# bot 的主对话（`nbook.bots`）

## 目标与范围

[bot 提案](../../../../../docs/proposals/neurobot.md)第四节第 3–5、7 小节与第 10 小节的对话部分，只做内核与服务端（2026-11-19 开发者把原范围拆成两个，界面移到 [t15](../t15-messages-view/README.md)）：
- `nbook.bots` 插件骨架：预设贡献点与缺省预设（含内置岗位 Profile）、首次启动建 bot、bot 记录、封闭名单（显示名）；
- 主对话：`ensureMain`（id 由 bot id 定，`session-exists` 时核对 `owner`）、激活后持有（`agentKey.hold` 与失败码）、会话头 `owner` 与 `ToolSessionContext.owner`（按调用方盖章）、列表不列有归属的会话及其后代、`owned-session` 拒绝改写历史、Profile 解析不到、长会话的服务端指标（重启后自动接着跑搁置，见决定 3）；
- 等用户：`send` 的 `settlePending`（期限、`expired`、`expired-run` 放到第一版之后，见决定 4）。

合同：新建 `docs/specs/bots/bots.md`、`docs/specs/bots/main-conversation.md`；改 [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)、[`harness/session.md`](../../../../../docs/specs/harness/session.md)、[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md)、[`agent/subagents.md`](../../../../../docs/specs/agent/subagents.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)（命令域）。

依赖：t14（缓冲区与宿主发出者，已完成）。

来源：w00043 的 [Task 规划](../../README.md#task-规划)（2026-11-18 按已接受的 [bot 提案](../../../../../docs/proposals/neurobot.md) 与 [缓冲区提案](../../../../../docs/proposals/agent-input-buffer-states.md) 重排）；2026-11-19 拆出 t15。

## 当前状态

2026-11-10 经 nbdev 新建；2026-11-18 改成在 NeuroBook 里做，原始记录不做；2026-11-19 开工。

开工调研（只读，三位 Haiku 子代理）见 [evidences/survey.md](evidences/survey.md)。

决定：

1. 拆分（开发者 2026-11-19，选“拆成两个”）：t06 只做内核与服务端，界面成 [t15](../t15-messages-view/README.md)，并入 t07。有归属的会话从活动条等处打开时转到 bot 视图，这件事只在浏览器一侧，归 t15。
2. 缺省 bot 的 Profile（开发者 2026-11-19，选“新建内置岗位 Profile”）：新增一个内置 Profile，用主创的工具加 `shell`，系统提示词只写岗位。星璃的人设文本作为缺省预设的 `persona` 文件，建 bot 时复制进 bot 目录；人设与记忆怎样进提示词归 t09。t06 做完时，bot 的对话还没有星璃的口吻。
3. 重启后以宿主身份自动接着跑（提案第四节第 5 小节）：开发者 2026-11-19 答“这个行为先搁置，先不做 nbook.bots 自动接着跑”。不做。runtime 输出 4、108 里“宿主能接着跑 `owner` 归它的会话里的运行”的 planned 句子也留着不实现：自动接续搁置后它没有调用方，范围还要和 `resume`、`release` 分清（设计审查第 14 条）。
4. 等用户的期限（`expired`、`expired-run`，提案第四节第 7 小节）：开发者 2026-11-19 问“这里为什么要有期限，第一版可以先不设期限”。主 Agent 的说明：
   - 期限来自开发者 2026-11-10 的决定（Work 决策记录：“30 分钟没人理由内核按过期结算”），防的是无人值守的周期任务（t10）在用户不在时停在审批上，后面到点的任务都排在它后面。
   - 期限放到第一版之后：t06 不做期限、`expired` 与 `expired-run`，bot 设置分区随之没有设置项、先不建。做 t10 时周期任务确实卡住，再加回来。
   - `send` 的 `settlePending` 照做：用户在聊天里直接回话靠它结算挂着的审批。
5. 长会话的预算（开发者 2026-11-19，选推荐）：打开主对话 2 秒以内，记事件数与打开耗时，超出写警告诊断；重新装配的耗时第一版不量，要给内核加出口，放进路线。

进展（分支 `feat/w00043-neurobot`）：

| 片 | 提交 | 验证 |
|---|---|---|
| 0 把 master 并进分支 | 快进到 a36f27c01 | `bun install` |
| 1 内核：会话头 `owner` 与只读会话头、`settlePending` 与共用的认领 | 34c941664 | nb-harness 全包 901 条通过，nb-harness、nb-agent-ui、neuro-book 类型检查通过。变异检查 3 处：建会话的重查、`releaseClaims` 交还、嵌套事项的结算，都抓到 |

实施中发现：

- `waitRun` 的原有竞态：日志写坏时 `onBroken` 只结算当时已在等的调用方，落在它之后、运行循环收尾之前的 `waitRun` 永远不结算。第 1 片的 `sendCommand` 多一个微任务后，“写失败”的现有用例稳定落进这个窗口。改成句柄已坏时直接交回 `log-broken` 的结果。
- `ctx.ask` 把 `interrupted` 交成 `unavailable{declined}`（原有行为），关闭时交还的回归因此断言日志里的结算，不断言工具拿到的码。
- `send` 带 `settlePending` 时，受理路径里有输入拦截这一步 await，测试里的关闭落不进“认领之后、写下之前”的窗口。交还的逻辑由 `resolve` 的回归守住（变异抓到），`send` 那条只作“关闭后没有悬空事项”的行为检查。

## 下一步

第 2 片：kit 的 `hold`、`header`、`refuse`，`nbook.agent` 的门面、列表、`owned-session`。
