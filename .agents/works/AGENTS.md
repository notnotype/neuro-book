# Work 与 Task Agent 指令

Work 与 Task 的身份、登记和快照规则见 [`README.md`](README.md)。本文件只定义执行动作：

1. 创建或恢复 current 工作先定位唯一 Work；新编号按 [`编号分配`](README.md#编号分配与记录位置) 协调并本地登记，不以远端提交为前置。已取得重大或长期 Issue 编号时写 `issueId: i<编号>`，否则为 `null`。
2. 每个 Work 直接包含至少一个 Task，按当前已知结果拆分；主 Agent 可直接实现或按独立边界委派，不要求正式角色或转交。
3. 读取 Work、指定 Task 快照与当前所需合同，再按问题取历史。隔离代码改动默认复用 `.worktree/<workId>`；恢复用 `governance:context` 核对身份，路径冲突停止，不覆盖或另建第二身份。
4. Task 正文是协作参考，不是机器权限或状态门禁。产品取舍、风险接受和受限动作仍由开发者决定；远端或不可逆动作仍需明确授权。
5. 更新 Task 唯一快照，记录真实改动、有效证据、未验证边界和下一步；历程与原始输出按需链接，不重复记账。只在真实结果明确后创建下一 Task。

`.agents/tasks/` 与 `packages/*/.agents/tasks/` 是 legacy archive；其中 `agentWorkflow` 仅用于历史 provenance，current Task 必须位于 Work 内。
