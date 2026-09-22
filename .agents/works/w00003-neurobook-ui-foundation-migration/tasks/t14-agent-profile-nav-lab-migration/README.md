---
schema: nbook.task/v2
taskId: t14-agent-profile-nav-lab-migration
---

# Agent Profile 导航的 Lab 迁移与 Product 排除核对

## 目标

按 [Work](../../README.md) 的 Lab-first 路线迁移 Agent Profile 导航相关组件，并核对 raw Product 构建不携带 Component Lab 资产。判定以 Product 产物为对象：禁止出现 `component-lab`、`AgentProfileNavListFixture`、`LabShell`、`data-lab-subject` 字面量，禁止命中 `/lab` 路由，也不得出现本机绝对路径。

## 任务产物

- [`evidences/product-exclusion-2026-09-04.json`](evidences/product-exclusion-2026-09-04.json)：`bun run --cwd packages/neuro-book nuxt:build:raw` 产物扫描结果，记录构建命令、产物根、禁止字面量与路由模式、绝对路径模式、`sourceRevision` 与 `sourceDirty`。

## 边界

- 证据对应 `HEAD + 当前工作区改动`（`sourceDirty: true`），不对应独立 revision；`scannedFiles`/`scannedBytes` 为 0，说明该次扫描没有真正扫到文件，不能当作 Product 排除通过的证据，需要重跑才有结论。
- Lab-ready、主页面接线与真实 UI 验收的现行判据见 Work README 的迁移路线与红分支规则。
- 本 Task 不授权产品实施、提交、push、合并、发布或浏览器人工验收。

## 说明

本 README 于 2026-09-22 补齐（原目录只有 `evidences/`，触发 `governance:check` 的“Work Task 缺少 README.md”）。内容只依据同目录证据与 Work 现行路线重建，不追补未留痕的执行叙事。
