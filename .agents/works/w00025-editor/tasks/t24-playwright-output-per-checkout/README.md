---
schema: nbook.task/v2
taskId: t24-playwright-output-per-checkout
status: planned
updated: 2026-11-16
---

# Playwright 输出目录按检出分开

## 目标与范围

e2e/playwright.config.ts 的 outputDir 是各 worktree 共用的系统临时目录 neuro-book/playwright/neuro-book：一个会话开跑会清掉另一个会话失败用例的 trace 与错误现场（t17 收口时碰到，失败现场没看成），--last-failed 读的失败清单也共用。按检出（主工作区或 worktree 的目录名）分开，并更新 docs/testing 里提到这个目录的地方。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-16 经 nbdev 新建，尚未开工。

## 下一步

待补充。
