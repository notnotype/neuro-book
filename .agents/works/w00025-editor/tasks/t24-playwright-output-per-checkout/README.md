---
schema: nbook.task/v2
taskId: t24-playwright-output-per-checkout
status: done
updated: 2026-11-16
---

# Playwright 输出目录按检出分开

## 目标与范围

e2e/playwright.config.ts 的 outputDir 是各 worktree 共用的系统临时目录 neuro-book/playwright/neuro-book：一个会话开跑会清掉另一个会话失败用例的 trace 与错误现场（t17 收口时碰到，失败现场没看成），--last-failed 读的失败清单也共用。按检出（主工作区或 worktree 的目录名）分开，并更新 docs/testing 里提到这个目录的地方。

合同：行为合同未变（测试基础设施：Playwright 输出目录的位置）；`docs/testing/README.md` 的验证门禁补了一条。

## 当前状态

2026-11-16 经 nbdev 新建。2026-11-17 开发者说“可以先做 t24”，同日做完并合入 master（`89bf62f67`，worktree 与分支已删，不 push）：`neuro-book-test-support/src/paths.ts` 加 `resolveAgentPlaywrightRoot(套件, 包目录)`，输出目录是 `<Agent 临时根>/playwright/<套件>/<检出名>/`，检出名是检出目录名（截到 24 个字符）加整条路径的哈希前 8 位，检出根按“往上找第一个有 `.git` 的目录”判（主工作区是目录、worktree 是文件）；`neuro-book` 与 `nb-story` 两份 Playwright 配置都改用它（nb-story 是同样的写法，一并改）。测试 `packages/neuro-book/e2e/playwright-output.test.ts` 6 条（检出根、检出名、最终路径），4 个变异都被抓住；真实的 Playwright 里放一个临时的失败用例核对：`.last-run.json` 落在本检出的目录里，`--last-failed` 只重跑了这 1 条。没有做正式审查：只改测试基础设施的目录位置，不碰产品代码。

## 下一步

本 Task 完成。已知：同一个检出里每次开跑仍会清空自己的目录（Playwright 的行为），要留的失败现场先拷走；别的会话如果还没变基到这次提交，仍用旧的共用目录 `playwright/neuro-book`，变基后才分开。
