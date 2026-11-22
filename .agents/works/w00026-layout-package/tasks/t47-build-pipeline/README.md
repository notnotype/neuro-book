---
schema: nbook.task/v2
taskId: t47-build-pipeline
status: active
updated: 2026-11-22
---

# 编译产物流水线与发布脚本的第三条通道

## 目标与范围

nb-layout 出编译产物（ESM、类型声明、style.css）、发布脚本加“独立版本的生成包”通道、MIT 许可证与第三方声明按包判断（ADR 0054 第 5、6 条，提案“第二档：发布流水线”“MIT：要处理的事实”）；nb-story 的网页构建改读编译产物。发到 npm 由开发者执行。形状按 t43 的核实与 nb-story 的接入定。

合同：[`story/cli-skill`](../../../../../docs/specs/story/cli-skill.md) 输出 19（网页包比源码旧的提示）补一句范围：读编译产物的工作区包记它的源文件；nb-layout 的行为合同（`ui/nested-grid` 等）不变。发布形态按 ADR 0054 第 6 条，写在包 README 与[发布手册](../../../../../docs/standards/releasing.md)。

## 输入

- [t43](../t43-tier2-verification/README.md) 的“给 t47 的输入”：出声明沿用 `rolldown-plugin-dts`、声明不可复现、`style.css` 与 `sideEffects`、`lab-sources` 不发、产物去注释、Trellis 核对已完成。
- [t46](../t46-english-default-text/README.md)：建 nb-layout 的变更记录时，“不兼容的改动”写没有注入时的缺省语言从 zh-CN 改成 en-US；新增 `layoutCatalogTranslate`（`./text`）。

## 当前状态

2026-11-22：[计划](plan.md)第 1 稿，开工前跑了两个探针（[证据](evidences/probes.txt)）：声明文件按 t43 的做法每次构建不同、tarball 跟着变，改成先 `vue-tsc` 一次出全部声明再打包后稳定；nb-story 的 `frame`、`side-by-side`、`viewer` e2e 跑在压缩产物加显式 `style.css` 上。第 1 轮设计审查（omp `--model @review`，阻断 2、重要 3、建议 4，[证据](evidences/design-review.txt)）除第 1 条（t47 之前就如此，补一句进发布手册）都成立，[计划](plan.md)改到第 2 稿，不再开第 2 轮，开始实施。

## 下一步

按计划第 2 稿的六个切片实施（worktree `.worktree/w00026-t47-build-pipeline`）→ 实现审查（omp）。
