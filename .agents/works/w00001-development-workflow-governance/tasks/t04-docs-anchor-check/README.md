---
schema: nbook.task/v2
taskId: t04-docs-anchor-check
---

# docs:check 校验链接锚点

## 目标与范围

开发者 2026-09-24 批准：让 `bun run docs:check` 校验活跃文档链接中的 `#锚点`。行为合同未变：只扩展文档治理检查，不改产品行为。

非目标：扩大活跃文档范围、current Task 检查范围修正（审查发现 DOC-H1，待开发者拍板）。

## 当前状态

实现与聚焦验证完成；开发者 2026-09-24 授权本地提交到下述分支，不授权 push、PR 或合并。

- checkout：`.worktree/w00001-development-workflow-governance`；branch：`feat/w00001-docs-anchor-check`；基线 `0afe7c69`。
- `scripts/ci/check-documentation.ts`：仓库文档按 `github-slugger`（新增 devDependency `^2.0.0`）计算标题锚点；`vitepress/locales/**` 页面按 VitePress 默认 slugify 与 `{#自定义-id}` 计算；HTML `id`/`name` 均视为锚点；VitePress 站内绝对路径（`/x`、`/en/x`）带锚点时解析到 locale 页面。
- VitePress slugify 未公开导出，脚本内复刻 `vitepress@2.0.0-alpha.18` 的实现，升级时需复核。
- [`docs/README.md`](../../../../../docs/README.md) 生命周期节补充锚点规则。

## 有效证据

| 验证 | 结果 |
|---|---|
| `bun x vitest run --config scripts/vitest.config.ts scripts/ci/check-documentation.test.ts` | 18 例通过（新增 GitHub 规则与 VitePress 规则两例） |
| `bun run docs:check`（本 worktree） | failures 空，6413 files |
| `bun scripts/ci/check-documentation.ts --repo-root ../..`（主工作区，含他人未提交改动） | failures 空，6435 files；存量 50 个锚点链接均有效 |
| `bun x tsc --noEmit -p scripts/tsconfig.json` | 失败，均在 `packages/neuro-book/server/{database/prisma.ts,utils/auth.ts}`：新 worktree 缺 Prisma 生成物；`auth.ts` 缺 Nuxt 自动导入在主工作区同样复现（既有基线）。`scripts/ci/check-documentation*` 无诊断 |
| `bun run governance:check`（本 worktree） | failures、warnings 均空 |

未运行 `docs:build`。
