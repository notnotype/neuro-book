# Post-merge Reliability Hardening

> 本 Task 承接 Task 140/141 对 #64、#61、#59、#63、#65 合并后的审查与浏览器验收，关闭已确认的配置、恢复、持久化、跨平台和窄屏问题。

## Relative documents refs

- [Task 140 PR review and release gates](../140-pr-review-and-release-gates/README.md)
- [Task 141 merged PR browser acceptance](../141-merged-pr-browser-acceptance/README.md)
- [Task 111 Workflow integration](../111-workflow-agent-integration/README.md)
- [Task 130 desktop application foundation](../130-desktop-application-foundation/README.md)

## Goal

修复审查确认的运行时 P1/P2，补齐 Job/Workflow 重启后的历史查询与可靠结果回流，完成模型配置、Source Dev Cache Root、历史测试数据和浏览器验收收口。focused tests、typecheck、全仓测试、浏览器和正式发布门禁分别记录，未完成的 Product 多平台门禁继续归 Task 130。

## Decisions

- retrieval、researcher、summarizer、memory.curator 继承全局默认模型，不增加静默 fallback。
- Source Dev 只迁出 Cache Root，State Root 保持当前 checkout。
- Job 和 Workflow Run 持久化历史；进程重启时 active Run 转为只读 `interrupted`，不续跑旧脚本。
- #47 不合并，只移植关联 Session 缺失的最小降级合同。
- Job 历史不设置猜测性自动过期；用户通过“清除已结束”显式删除。
- 清理已确认的 8 个历史测试实体，不重置 SQLite sequence，不删除 Session、trace 或旧 Job 审计。

## Implementation Walkthrough

### 2026-08-06：retrieval Git Bash 路径枚举

- 将内置 retrieval 的固定元数据清单命令改为 `rg --files -g 'index.md' | workspace node parse --stdin --ndjson`，避免 MSYS 把正则中的裸 `/` 改写成 Git 安装路径。
- Profile 测试同时断言新命令存在、旧命令消失。
- bash focused test 执行与 Profile 完全相同的真实命令，并验证 NDJSON 中包含目标节点路径与标题，不再用不含 `/` 的替代正则冒充覆盖。

## Verification

- `bun run test -- server/agent/profiles/leader-assets-profile.test.ts -t "retrieval profile 使用 Git Bash 安全的路径枚举提示"`：1 passed / 14 skipped。
- `bun run test -- server/agent/tools/file-tools.test.ts -t "retrieval 的 index.md 清单命令可在真实 bash 中执行"`：1 passed / 48 skipped；测试通过 Harness 的真实 bash 工具执行完整命令。
- `bun run typecheck`：退出码 0。
- `git diff --check`：退出码 0。

## TODO / Follow-ups

- [ ] 修复停止失败用户提示。
- [ ] 修复主 Session / 关联 Session 恢复语义与重复 recovery。
- [ ] 实现持久化 Agent Job 历史、可靠回流和 Workflow Run 历史。
- [ ] 调整 Source Dev Cache Root 与 Profile 窄屏布局。
- [ ] 调整四个 Profile 模型配置并清理 8 个历史测试实体。
- [ ] 完成 Task 141 遗留浏览器场景和最终整体门禁。
