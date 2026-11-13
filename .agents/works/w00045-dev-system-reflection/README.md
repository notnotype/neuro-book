---
schema: nbook.work/v1
workId: w00045-dev-system-reflection
issueId: null
status: active
updated: 2026-11-12
---

# 开发体系反思

## 目标

把 NeuroBook 的开发体系（入口规则、文档分层、Work 与 Task、验证门禁、Skill、机检与工具）逐层提取成与技术栈无关的项目模板；提取的过程同时是对这套体系的反思，问题与改进候选记在这里。

## 范围与授权

- 范围：模板的提取与反思记录。模板在仓库外的本机目录 `~/CodeRepository/agent-project-template/`（独立的 Git 仓库，尚未提交）。
- 不做：反思里给 NeuroBook 的修改建议，开发者挑中的另建 Task 再改。
- 授权：开发者 2026-11-12 要求提取模板、一层层来，每层确认后再决定下一层；同日要求把反思记成本 Work。

## 分层

| 层 | 内容 | 状态 |
|---|---|---|
| 1 骨架 | 入口、文档真相源分层、Work 与 Task、编码测试 Git 与授权基线 | 已做（t01） |
| 2 方法 | 仓库内 Skill | 已做（t01） |
| 3 机检 | 文档与 Work 检查、测试写法检查、按改动选测试 | 未开工，要先定技术栈 |
| 4 工具 | 领号与状态命令行、产物与答复面板、worktree 工具 | 未开工 |
| 5 领域 | UI 与设计评审、Lab、真实模型测试、发布等 | 界面规范、`design-review` 与语言、脚本等规范已做（t01）；Lab、真实模型测试、发布未开工 |

## Task

- [t01 提取项目模板第 1、2 层与反思](tasks/t01-template-extraction/README.md)：第 1、2 层已提取，反思 22 条见 [reflection.md](tasks/t01-template-extraction/reflection.md)
- [t02 让模板成为通用治理的上游](tasks/t02-template-as-upstream/README.md)：计划中，未开工
