# Work 与 Task Agent 指令

Work 与 Task 的身份、登记和快照规则见 [`README.md`](README.md)。本文件只定义执行动作：

1. 创建或恢复 current 工作先定位唯一 Work；新编号经 `nbdev work new`、`nbdev task new` 领取（[`编号分配`](README.md#编号分配与记录位置)），它在主工作区建记录并提交，不以远端提交为前置。已取得重大或长期 Issue 编号时写 `issueId: i<编号>`，否则为 `null`。
2. 每个 Work 直接包含至少一个 Task，按当前已知结果拆分；主 Agent 可直接实现或按独立边界委派，不要求正式角色或转交。
3. 读取 Work、指定 Task 快照与当前所需合同，再按问题取历史；记录只读写主工作区的那一份（[记录只放主工作区](README.md#记录只放主工作区)）。代码改动通常一个 Work 一条分支、一个 worktree，验证也在 Work 分支上做（[创建与执行](README.md#创建与执行)）；恢复用 `governance:context` 核对身份，路径冲突停止，不覆盖或另建第二身份。改状态用 `nbdev task status`、`nbdev work status`（`nbook.work/v1` 与 `nbook.task/v2` 的完成状态取值为 `done` 而非 `completed`，手工编辑快照 frontmatter 时须与 CLI 枚举一致）；记录还在分支上维护的 Work 照旧在原处改。
4. Task 正文是协作参考，不是机器权限或状态门禁。产品取舍、风险接受和受限动作仍由开发者决定；远端或不可逆动作仍需明确授权。
5. 更新 Task 唯一快照，记录真实改动、有效证据、未验证边界和下一步；历程与原始输出按需链接，不重复记账。要入库的命令输出存为 `.txt`：仓库 `.gitignore` 忽略 `*.log`，写成 `.log` 的证据不会被提交。开发者确认要做的后续工作可以先建 Task 记下目标与来源、标明未开工，开工时按当时的结果修订（见 [`README.md`](README.md#创建与执行)）。

`.agents/tasks/` 与 `packages/*/.agents/tasks/` 是 legacy archive；其中 `agentWorkflow` 仅用于历史 provenance，current Task 必须位于 Work 内。
