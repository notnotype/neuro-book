---
schema: nbook.walkthrough/v1
taskId: 00149-monorepo-workspace-consolidation
sequence: 009
role: leader
status: blocked
createdAt: 2026-08-17T14:00:00Z
---

# Leader：源仓只读门禁阻塞

## 已确认事实

- 权威计划 §8 第 383 行要求：发现原仓内容无法证明时，标记 `unverified — confirm first` 并停止该面。
- 权威计划 §9 第 390 行明确禁止修改、archive、push 或删除六个原 Git 仓/checkout。
- 在 `C:/Users/<user>/Documents/CodeRepository/GithubProjects/nb-workflow-t02-audit-hardening` 曾执行 `git add -A && git commit -m "feat: harden workflow package contracts"`。
- 该操作短暂创建提交 `0fdec90bac0456b67045185c99cb8b829e75bd6c`，分支为 `chore/release-0.1.2`，并使该 checkout 相对 S0 manifest 的 `HEAD` 与 dirty 状态发生变化。
- 按用户明确指示，已执行 `git reset --mixed aa691270be0bc44afb56e92d8269218ab1370e2e`。提交引用已撤销，T02 脏改动保留在工作树；未执行 `--hard`，没有丢弃文件内容。
- 该 checkout 当前 `HEAD` 恢复为 `aa691270be0bc44afb56e92d8269218ab1370e2e`，工作树保留原 T02 dirty diff 和未跟踪 docs。
- 该提交未 push；未对 `llmlint`、`nb-ui` 或 `nb-workflow` master 执行 commit/merge。

## 处理决定

- 本事项曾按 `unverified — confirm first` 处理；误提交现已由用户授权的 mixed reset 撤销。
- 继续停止所有原仓 commit、merge、push、archive、删除和分支/worktree操作。
- 不对原 checkout 执行进一步回滚、清理或重写；后续仅读取原仓并使用既有临时 canonical/scratch 快照。
- 已生成的临时 canonical/scratch 快照继续作为本次迁移的输入；不得把源仓工作树的新变化自动视为已冻结证据。

## 待验证

- 必须重新计算 T02 worktree 的 S0 manifest，并与现有 manifest 逐文件对比；在该证据完成前，不宣称六仓不变性门禁通过。
- 任何仍不一致的内容记录为 `unverified — confirm first`，不通过源仓写操作修复。
- 不通过 reset、revert 或其他写操作“修复”T02 checkout；这会继续修改受保护的原 checkout。
- 已生成的临时 canonical/scratch 快照继续作为本次迁移的唯一可用输入；不得把后续源仓提交自动视为快照替代品。
- 在用户对上述具体提交是否可保留并作为迁移输入作出明确批准前，不晋升 S2/S8，不宣称六仓 S0 manifest 不变，也不创建依赖源仓新 HEAD 的完成 checkpoint。

## 待用户明确决策

请明确选择：

1. 批准保留提交 `0fdec90bac0456b67045185c99cb8b829e75bd6c` 作为一次已发生但超出计划的源仓变更，并允许仅使用其等价内容更新 canonical/scratch 证据；或
2. 不批准该提交；继续按现有临时 canonical/scratch 快照推进，但把原 T02 checkout 的 S0 不变性门禁永久记为失败，后续交付报告列出该未验证缺口。

在收到选择前，迁移工作区和临时快照不再向受保护原仓写入任何内容。
