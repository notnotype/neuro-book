---
schema: nbook.task/v2
taskId: t08-shared-token-check
status: done
updated: 2026-11-04
---

# 样式 token 机检收进 test-support 共用

## 目标与范围

nb-ui 的 token-consumption 规则照导入边界检查的做法收进 neuro-book-test-support，nb-ui 与 nb-agent-ui（以后的前端包）共用规则与带理由的豁免清单；来源：w00019 t10 复盘第 8 条，开发者 2026-10-22 批准，未开工

合同：行为合同未变（仓库的测试工具）。

## 当前状态

2026-10-22 经 nbdev 新建；2026-11-04 开发者同意做，当天完成，合入 master `f51fe1a20`（实现 `f8792a441`）。

- 规则移到 `@notnotype/neuro-book-test-support/style-tokens`，各包只写扫描目录、带理由的豁免与声明来源。规则统一取两份里更准的写法：时长放过关掉动效的 `0s`，颜色放过后面还连着字符的片段。
- 接入 nb-ui、nb-agent-ui，并多接了 nb-form（18 个组件，没有违规）。nb-agent-ui 多了原来只有 nb-ui 才有的规则（圆角之外的材质、字号类型提示、字重写法、字面字号的方括号写法），没有新增违规。
- 新增死条目检查：豁免不再命中代码就报（原来只查文件还在不在）。查出 nb-ui 的 `Skeleton`、`Notification` 两条圆角豁免早已不命中，已删。`Checkbox` 的 `#000000` 补了理由。
- 没有接入的包，规则命中数（2026-11-04 量，未逐条核实是否属实）：nb-markdown 7（都是写死时长）、nb-story 22（字重写法 20、圆角 2）、dev-panel 1（颜色）、neuro-book 55（字号 22、颜色 21、时长 7、内联材质 4、圆角 1）。它们要接入得先清这些，不在本 Task 范围。
- 验证：test-support 单测 28 过、1 跳过；把一段各规则都违反的写法塞进 nb-ui、nb-agent-ui 的组件，nb-ui 10 条规则全部报错；nb-agent-ui 9 条报错，时长规则因为那个文件有豁免而不报，符合预期；还原后全过。`test:affected --since master --typecheck` 只剩 nb-story 两项：类型检查是原有的 `qa-service.ts:548`；`bun test` 在并行负载下失败，单独重跑 669 条全过。低风险的测试工具，没有另派审查。

## 下一步

无。
