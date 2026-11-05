---
schema: nbook.task/v2
taskId: t04-package-split
status: active
updated: 2026-11-05
---

# 拆包：nb-layout（不改行为）

## 目标与范围

新建 packages/nb-layout，按 t01 决定 10 搬走布局件，使用方（24 个文件）一次改完，nb-ui 不重导出；Lab 场景、e2e 与验收页、locales 跟着走；登记 monorepo-boundaries，更新 ADR 0029 的发布清单。不改任何行为。新包不读全局 window、document。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

已合入 master（2026-11-05）。计划见 [`plan.md`](plan.md)。

- **做了**：新建 `packages/nb-layout`（核心纯 TS，Vue 层依赖 nb-ui，样式从原子类换成 scoped CSS，文字走自己的目录）；应用的 20 个文件、SDK、Lab 改用新包；nb-ui 删掉入口 `./layout`、`./grid`，暂留冻结的 Splitter 与分隔线核心；NestedGrid 的真实浏览器验收并进 Lab（`lab-nested-grid.e2e.ts`，子代理做，主会话审过）。
- **验证**：`nb-layout` 136 + 103 项，`nb-ui` 528 项，应用 bun 与 Vitest 全过（bun 的 3 项失败是登记没跟上，已修）；typecheck 过；浏览器 146 项：外壳、拖放、视图、编辑器、资源树、Lab。`lab-scenes` 第一次有 1 项超时（负载 19.7，别的会话也在跑 e2e），单独重跑通过。工作台页面与落点覆盖层的外观和计算样式人工核对过。
- **和计划的差异**：`nb-ui` 里依赖已删模块的 `sash-drag.test.ts`、`grid-splitter.test.ts` 删了（代码冻结，测试在 `nb-layout` 那份）。`lab-nested-grid` 里 macos 主题改配 nbook 的亮暗配色，因为 Lab 只装 nbook 配色。Lab 的 `NestedGrid` 场景登记的是占位输入，数据页签改了不起作用（类型要求必填 `node`、`layout`）。
- **没做**：可维护性与 API 形状审查放到 t06 之后，那时 API 才是真正的形状。nb-story 的类型错误（`qa-service.ts:548`）master 上本来就有，不是这次引入的。

## 下一步

t05。
