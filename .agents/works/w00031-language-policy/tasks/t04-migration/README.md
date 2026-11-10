---
schema: nbook.task/v2
taskId: t04-migration
status: planned
updated: 2026-11-10
---

# 错误与诊断迁移

## 目标与范围

按 t03 的切片执行：失败说明改成按码本地化，开发诊断改英文。每片同时改消费者、持久化兼容读取和测试（按码或结构断言）；`test:affected` 只用来挑测试，不当作完整性证明。

粗估规模（2026-10-27 grep，排除清单外的非测试源码约 1387 个文件、20.7 万行）：带中文的 `new XxxError` 约 1035 处，日志与诊断约 211 处，`reason`、`message`、`detail` 字段约 791 处（有重叠）；测试里断言中文的约 369 个文件。工期等 t03 切片后重估。

已知的坑（2026-10-27 Haiku 实验发现，主会话核实；见 [w00028 t03 证据](../../../w00028-i18n/tasks/t03-shared-packages-migration/evidences/haiku-experiment.txt)）：旧应用 `packages/neuro-book-legacy/server/workspace-history/project-history.ts:527` 按 nb-history 的中文文案“游标未初始化”分支，nb-history 的诊断改英文前要先给这种情况一个稳定码或子类（旧应用只读，改它要开发者授权）；nb-history 测试里 8 处 `expect(...).rejects` 没有 await，断言从未生效，迁移时一并补上。

不在本 Task：现有英文工具说明与命令 `description` 的语言（等 t05）。

合同：按 t03 列出的 Spec，起点是 [`runtime/diagnostics.md`](../../../../../docs/specs/runtime/diagnostics.md) 与 t03 的清单。

## 范围修订（2026-11-10）

失败投影（码与参数、主文案、详情）按错误域拆到 t03、t06–t12（Work README 第 13 条），本 Task 只管开发诊断改英文。做法按开发者 2026-11-10 的决定：不做一次性全量翻译；新写的诊断必须英文，碰到哪个文件改哪个文件，`governance:check` 对新增的中文诊断构造告警（本 Task 实现这条机检）；需要全量时再单独排期。另外接 t03 计划列给本 Task 的：B1（包装分支保留 `Error.cause`）、B2（命令行插件日志并入诊断边界）、M7 兜底 catch 的剩余部分、nb-ui `GridResult` 与 nb-markdown 的中文抛错。

## 当前状态

2026-10-27 建，暂不开工。开工前要有 t02 的通道矩阵与 t03 的切片设计。

## 下一步

t03 定稿后修订本 Task 的范围与切片。
