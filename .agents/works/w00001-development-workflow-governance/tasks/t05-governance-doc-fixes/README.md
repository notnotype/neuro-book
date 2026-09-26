---
schema: nbook.task/v2
taskId: t05-governance-doc-fixes
---

# 治理审查机械性文档修正

## 目标与范围

开发者 2026-09-24 批准：把治理审查中无需取舍的文档错误直接改正。行为合同未变：只改 Agent 入口、贡献指南与索引文案。

已处理：WF-001（贡献指南根级命令不存在）、WF-004（贡献指南把 legacy `.agents/tasks/` 当入口）、WF-005（发布规则未定义的 H3）、AC-002（Plan 引用不存在的 `.agents/roles/`）、AC-003/AC-004（`neuro-agent-harness` 冻结状态与退役 role）、AC-005/DOC-L1（包清单与 workspace 数量）、AC-006（包测试运行器）、AC-007（主题登记处与产品主题数）、DOC-M1（活跃提案列出 rejected 提案）。

实现与验证完成；已本地提交 `32dd1036`，未执行 push、PR 或合并。

## 有效证据

| 验证 | 结果 |
|---|---|
| `bun run docs:check` | failures 空，6414 files |
| `bun run governance:check` | failures、warnings 均空 |
| `packages/**/AGENTS.md`、`scripts/release/AGENTS.md`、`.claude/agents/Plan.md` 不在 `docs:check` 范围，脚本逐个核对相对链接目标 | 全部存在；`#1-事实源` 与 `ui-development-spec.md` 的 `## 1. 事实源` 对应 |
