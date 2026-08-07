# Post-merge Reliability Hardening

> 本 Task 承接 Task 140/141 对 #64、#61、#59、#63、#65 合并后的审查与浏览器验收，关闭已确认的配置、恢复、持久化、跨平台和窄屏问题。

## Relative documents refs

- [Task 140 PR review and release gates](../140-pr-review-and-release-gates/README.md)
- [Task 141 merged PR browser acceptance](../141-merged-pr-browser-acceptance/README.md)
- [Task 111 Workflow integration](../111-workflow-agent-integration/README.md)
- [Task 130 desktop application foundation](../130-desktop-application-foundation/README.md)

## Goal

修复审查确认的运行时 P1/P2，补齐 Job 终态结果的跨进程持久化与可靠结果回流，完成 Source Dev Cache Root、Profile 窄屏布局和浏览器验收收口。focused tests、typecheck、全仓测试、浏览器和正式发布门禁分别记录，未完成的 Product 多平台门禁继续归 Task 130。

## Decisions

- retrieval、researcher、summarizer、memory.curator 继承全局默认模型，不增加静默 fallback。
- Source Dev 只迁出 Cache Root，State Root 保持当前 checkout。
- 持久化 Job 终态、完整结果、Session/usage 摘要与回流状态；Workflow 图、journal、逐步时间线和 pending ask 继续由当前进程拥有。
- 进程重启时 active Job 转为 `interrupted`，不续跑旧 Workflow；已完成 Job 的结果继续可查询，Run 细节不可用时不得把终态降级为 `interrupted`。
- #47 不合并，只移植关联 Session 缺失的最小降级合同。
- Job 历史不设置猜测性自动过期；用户通过“清除已结束”显式删除。
- 当前 Workspace 的四个目标 Profile 已经使用 `modelKey: null` 继承全局默认模型；本 Task 只做真实无 model 调用复核，不再修改配置。
- 2026-08-07 只读复查确认先前列出的 8 个历史测试实体已经不存在；本 Task 不执行数据删除，不重置 SQLite sequence。

## Implementation Walkthrough

### 2026-08-06：retrieval Git Bash 路径枚举

- 将内置 retrieval 的固定元数据清单命令改为 `rg --files -g 'index.md' | workspace node parse --stdin --ndjson`，避免 MSYS 把正则中的裸 `/` 改写成 Git 安装路径。
- Profile 测试同时断言新命令存在、旧命令消失。
- bash focused test 执行与 Profile 完全相同的真实命令，并验证 NDJSON 中包含目标节点路径与标题，不再用不含 `/` 的替代正则冒充覆盖。

### 2026-08-07：收紧重启持久化和清理边界

- 重启可靠性目标收窄为“Job 终态和结果不丢失”。完整 Workflow Run 历史和断点续跑需要持久脚本、参数、锁、Project 上下文和重放语义，不进入本轮。
- Workspace 配置已恢复为继承全局默认模型，不增加运行时静默 fallback。
- 先前报告中的 8 个历史测试实体已不存在；不再安排删除或 sequence 重置。

## Verification

- `bun run test -- server/agent/profiles/leader-assets-profile.test.ts -t "retrieval profile 使用 Git Bash 安全的路径枚举提示"`：1 passed / 14 skipped。
- `bun run test -- server/agent/tools/file-tools.test.ts -t "retrieval 的 index.md 清单命令可在真实 bash 中执行"`：1 passed / 48 skipped；测试通过 Harness 的真实 bash 工具执行完整命令。
- `bun run typecheck`：退出码 0。
- `git diff --check`：退出码 0。

## TODO / Follow-ups

- [ ] 修复停止失败用户提示。
- [ ] 修复主 Session / 关联 Session 恢复语义与重复 recovery。
- [ ] 实现持久化 Agent Job 终态、完整结果和可靠回流；保留 Workflow 进程内观察边界。
- [ ] 调整 Source Dev Cache Root 与 Profile 窄屏布局。
- [ ] 复核 retrieval、researcher、summarizer 的真实默认模型调用和 memory.curator 的静态继承配置。
- [ ] 完成 Task 141 遗留浏览器场景和最终整体门禁。
