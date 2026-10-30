---
schema: nbook.task/v2
taskId: t15-skills
status: planned
updated: 2026-10-30
---

# Skill 规范与目录

## 目标与范围

定产品 Skill 的格式与目录层次、带 package.json 与脚本的 Skill 怎样装依赖（bun、uv），以及加载与触发方式。

来源：需求 13（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 格式：`SKILL.md` 加 frontmatter（name、description 必填）。
- 目录层次：内置、用户、项目、插件贡献；要不要兼容读 `~/.claude/skills`、`~/.agents/skills`。
- 带 package.json 与脚本的 Skill：bun 的依赖什么时候装、装在哪；uv 用脚本内联依赖。
- 加载与触发：目录列出、`$` 触发、`skill://`。
- 信任：按现有约定默认信任作者。

## 材料

- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 3、5、6 节
- [`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md)
- 旧应用 `packages/neuro-book-legacy/assets/reference/agent/skill-package.md`

## 前置

t05、t08、t10。

## 决定

第一轮（开发者 2026-10-30）：

1. 用户用 `$` 触发 Skill（旧应用的做法），不只靠 `/`。

先调研再定的：字段全表、Skill 参数与“带参数自动执行脚本”、依赖（Python、Node、Bun）、更新与 Skill 市场。调研：[各家的 Skill](../../research/2026-10-30-skill-survey.md)。

## 当前状态

讨论中（2026-10-30）：调研完成，按调研给出字段、参数、依赖、更新与市场的方案，待开发者讨论。

## 下一步

调研汇总写进 Work 的 `research/`，再逐条讨论。
