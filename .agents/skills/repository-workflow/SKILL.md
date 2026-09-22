---
name: repository-workflow
description: 执行 NeuroBook 的 Git 分支、worktree、提交、PR、合并或发布操作时使用；普通编码不触发。
---

# 仓库操作

操作约束的唯一正文是 [仓库维护流程](../../../docs/standards/repository-workflow.md)。只读取当前操作对应的节，不把本技能变成每次编码的前置检查。

1. 明确这次要做的操作及授权。目标批准不等于 push、PR、合并或发布授权；未获授权时只提供拟操作。
2. 核对实际仓库、checkout、分支和相关已有修改。主工作区保持 master；不覆盖用户改动，不用 stash/reset 清场。worktree 按 [Work 登记](../../works/README.md#编号分配与记录位置) 创建或复用。
3. 提交时仅精确暂存本任务文件或 hunks，将独立变化拆成可审查的原子提交；采用仓库 Conventional Commit 约定。不使用全量暂存，不 force push 共享分支。
4. 按 [测试规范](../../../docs/testing/README.md#验证门禁) 复用仍有效的直接证据，不因准备提交另跑全套。PR、合并及 Project 状态按仓库流程处理，CI 或 Task 完成不能代替统一评审。
5. 仅发布操作加载 [发布合同](../../../scripts/release/AGENTS.md) 与 [项目状态](../../../PROJECT-STATUS.md)，命令从实际 package.json 查询，RELEASE.md 载荷与版本身份遵守发布合同，不在此复制命令或第二份发布清单。
6. 操作中断先核对哪些副作用已经发生，再从断点继续；发布需确认版本、提交与远端 Release 是否已存在，不能盲目重跑。报告实际 revision、执行结果和未授权动作，不把计划写成成功。

完成条件：已授权操作达到可观察结果，用户改动被保留，验证与发布身份可追溯。纯本地交付不要求自动提交或远端写入。
