---
schema: nbook.task/v2
taskId: t06-command-acceptance
role: reviewer
---

# 命令系统行为验收与独立审查

## 目标

对本批六个任务的真实行为做独立验收：不做实现，只验证证据。清单以计划 §验证 为准（`local://workbench-command-foundation-plan.md`），含隔离运行准备、真实浏览器闭环 1–9 与成功判据。

## 范围

1. 合同与边界：应用侧定向测试与 `typecheck` 结果核对；nb-ui 包门禁（test/typecheck/build:css/test:e2e/diff --check）。
2. 隔离运行：按计划 §隔离运行准备 在系统 Temp 新根初始化并起主 Lab 与 nb-ui playground（hub 管理），不得触碰用户级 State Root。
3. 浏览器闭环 1–9：按钮/面板/键位单入口、`:15` 真实光标移动、只读与无编辑器降级、agent 确认（批准/取消/discuss/plan）、五 tab 与刷新保持、四主题 × 双配色与 390px 计算样式、叠层 Escape/Tab/外点、`@` 与无前缀行为。
4. 独立接口审查：随机复核 §2 执行顺序与 §6 交接语义的实现偏差；发现缺陷回报 Leader，不现场改码。

## 验证

- 每条闭环记录真实观测（截图/计算样式/审计条目）与失败原文；未执行项显式列出。
- 结论为「通过/不通过/部分」并附证据路径。

## 边界

- 只读验收（除测试/临时根初始化）；不修产品代码；不 push/合并；不发布。

## 依赖

t05（及 t01–t04 全部完成）。
