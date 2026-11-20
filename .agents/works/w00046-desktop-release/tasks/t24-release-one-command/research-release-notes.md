# Release 说明由谁写（2026-11-20 调研）

开发者问：Release 说明是 git push 的时候记，还是在 Actions 里用 Agent 写；看看 omp 是怎么做的。

## 现状

[ADR 0053](../../../../../docs/adr/0053-release-stages-and-changelog.md) 定的是“推送时记”：改了用户看得到的行为，在同一个提交里往 `packages/neuro-book/CHANGELOG.md` 的 `## [Unreleased]` 补一条（写法见发布手册的“写变更记录”）。`release:prepare` 把它定稿成版本段，发布流水线的门禁由这一段生成 Release 说明，生成不了就停在一切远端写入之前。写条目的通常是做这次改动的 Agent。

问题：一个版本周期里同一个功能先加、再修它自己的 bug、再改名，条目会出现中间状态；条目由几十个 Task 各自写，口径不齐。

## omp（can1357/oh-my-pi）的做法

读的是本机的 `~/CodeRepository/oh-my-pi`（2026-11-01 的提交 1c291b8）。

- 也是推送时记：AGENTS.md 的“Changelog”一节要求用户看得到的改动在 `packages/*/CHANGELOG.md` 的 `[Unreleased]` 下写一行，格式、分类与我们几乎相同；审查时不挑格式，发版脚本跑 `fix-changelogs` 统一归一。
- 发版前可选整理：`bun run gen:changelog`（`scripts/rewrite-changelog.ts`）在本机把每个包的整段 `[Unreleased]` 交给一个小模型（缺省 gpt-5.6-luna，失败按回退链换），要它只留下最终发布出去的行为，按分类交回结构化的条目，脚本在本地渲染 Markdown，只替换 `[Unreleased]` 这一段；有 `--dry-run` 与 `--check`。改完由人看 diff 再提交。
- 一条命令发版：`bun run release <版本|patch|minor|canary>`（`scripts/release.ts`）做预检、改版本、定稿变更记录、提交、打标签，用 `git push --atomic` 把 main 与标签一次推上去，再盯 CI。canary 版本带 `-canary.N` 后缀，不定稿变更记录。
- Actions 里不用模型写说明：`release_github` 作业跑 `scripts/ci-release-notes.ts`，把各包变更记录里本次的段落汇总（连同没发出 Release 的“静默标签”的段落），再由 `softprops/action-gh-release` 的 `generate_release_notes: true` 在下面附上 GitHub 自动生成的 PR 列表。

## 在 Actions 里用 Agent 写的现成方案

- [github/copilot-release-notes](https://theresanaiforthat.com/company/github/repository/copilot-release-notes/)：GitHub 官方的 action，用 Copilot CLI 按两个引用之间的 PR 生成说明。
- [GitHub Agentic Workflows](https://github.github.com/gh-aw/blog/2026-01-13-meet-the-workflows-operations-release/) 的 Changeset 工作流：分析上次发布以来的提交，定版本号，开 PR 改变更记录（它报告的 PR 合入率 22/28）。
- [jdx/communique](https://github.com/jdx/communique/wiki)：读提交与 PR，让模型看相关文件与 diff、核对链接，替换 Release 正文；可以用 Claude。
- 通用的 `anthropics/claude-code-action` 也能做，要自己写提示词。

对本仓库的不合适之处：

1. 我们几乎不走 PR（Task 在 worktree 里做完直接合入 master），按 PR 生成的工具没有材料；按提交与 diff 生成，提交里大量是 Task 记录、审查与内部重构，模型要从 500 多个提交里猜哪些用户看得到。
2. 在 Actions 里生成的说明发布前没人看；我们的门禁要求说明在任何远端写入之前就定下。
3. 要把模型的密钥放进仓库的 Actions secrets，发布流水线多一个外部依赖和一个会失败的环节。

## 结论与推荐

保留“推送时记”，Release 说明仍由门禁从变更记录生成；加 omp 那样的本机整理步骤作可选项：`bun run release` 在 `release:prepare` 之前，把 `[Unreleased]` 交给模型（经 omp 或 claude 命令行）合并同一周期里的反复、按用户视角改写，打出 diff 等开发者确认再继续。不在 Actions 里用 Agent 写说明。

这一版（0.15.0）还没有整理脚本：`[Unreleased]` 由主会话发版前通读一遍。要不要做整理脚本交开发者决定。

开发者提到的 magpie：在网上没有找到一个叫 magpie、做 Release 说明的项目（搜到的同名项目有 Apache Magpie 安全 Agent、AMD ROCm 的 Magpie、akshaykrishh/magpie），本机也没有这个仓库，要开发者给个链接。
