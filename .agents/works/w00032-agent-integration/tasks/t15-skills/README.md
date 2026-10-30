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

第二轮（开发者 2026-10-30）：

2. Skill 参数、“带参数调用就自动执行脚本”（Claude Code 的 `` !`命令` ``）先不做，以后再考虑。
3. 字段：收 Agent Skills 标准的 6 个字段，标准之外只收一个 `when_to_use`，正式写法改为连字符 `when-to-use`，读取时也认 `when_to_use`（`allowed-tools` 只解析、不生效，放行走 t06）。其余扩展字段都不收，第一版所有 Skill 的表现固定为：模型不能自己启用（相当于 `disable-model-invocation: true`，说明不进提示词）、用户能用 `$` 触发（`user-invocable: true`）、不隐藏；没有参数，不做 `paths`/`globs`、`context: fork`、`model`、`hooks`。Profile 的 Skill 白名单只决定在这个 Profile 里能 `$` 哪些 Skill（t14 第 16 条“推荐的 Skill 进提示词”第一版用不上）。
4. 依赖第一版只支持 Bun（`package.json` 加 `bun.lock`）；Python（uv、虚拟环境）与系统程序只检测、只报告，不代替用户安装，用户可以让 Agent 帮忙装，以后有需要再说。
5. 应用自己判断 Skill 是否初始化好；`nbook` 命令行提供初始化命令，Agent 也能经命令行初始化，与用户在界面上初始化是同一件事；Agent 不主动初始化，只在用户要求时做。
6. 更新与市场参照 Claude Code 的插件市场，另开 [t25](../t25-plugin-marketplace/README.md) 讨论。

先调研再定的：字段全表、Skill 参数与“带参数自动执行脚本”、依赖（Python、Node、Bun）、更新与 Skill 市场。调研：[各家的 Skill](../../research/2026-10-30-skill-survey.md)。

## 当前状态

讨论中（2026-10-30）：第二轮定了字段、参数、依赖范围与初始化方式；初始化标记的形状与插件 Skill 的构建时打包待讨论。

## 下一步

调研汇总写进 Work 的 `research/`，再逐条讨论。
