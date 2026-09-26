---
schema: nbook.work/v1
workId: w00001-development-workflow-governance
issueId: null
---

# Development Workflow Governance

维护 current Work/Task、开发技能与协作规则，保留 legacy Task 历史 provenance。

2026-09-21 开发者批准协作精简计划：正式角色退役、专项技能与最小充分验证、本地 Work 登记和 Task 当前快照。当前执行见 [t03](tasks/t03-agent-workflow-slimdown/README.md)，执行 checkout 为 `.worktree/w00001-development-workflow-governance`，不授权提交或远端动作。

2026-09-22 主线接手：开发者授权提交与合并，精简 diff 提交为 `bb0c8bdf`，合并到 master 为 `836979cd`，已推送 origin/master（`docs:check`、`governance:check` 仅余既有 t14 缺 README 一项、`tsc -p scripts/tsconfig.json` 通过）。执行 checkout 已移除，补丁与未跟踪文件备份在 `%TEMP%/neuro-book/cleanup-20260922/`。

2026-09-24 开发者批准 `docs:check` 校验链接锚点，见 [t04](tasks/t04-docs-anchor-check/README.md)；执行 checkout 为 `.worktree/w00001-development-workflow-governance`，分支 `feat/w00001-docs-anchor-check`，授权本地提交，不授权远端动作。

2026-09-24 开发者批准治理审查的机械性文档修正，见 [t05](tasks/t05-governance-doc-fixes/README.md)，已本地提交 `32dd1036`，未授权远端动作。

2026-09-24 开发者批准文档门禁、UI 验收和 Work 生命周期治理改进，见 [t06](tasks/t06-documentation-gates-and-ui-governance/README.md)；继续使用同一 checkout 与分支，远端动作未授权。
已收尾：`master` 上的合入提交 `836979cd`（技能与协作精简）、`1ec1a8b8`（Lab 显式契约与治理文档）、`1b677f77`（AgentSidebar fixture 修复）、`5c8f11cf`（nb-harness 包规则）、`cb584e08`（最终证据快照）、`f2c80d98`（Work/Task provenance 收口）和 `2128fcd3`（清理授权记录）。治理 worktree `.worktree/w00001-development-workflow-governance` 与本地分支 `feat/w00001-docs-anchor-check` 已按授权删除；主树中其他 Work、用户改动和远端分支未触碰。
