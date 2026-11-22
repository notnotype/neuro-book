---
schema: nbook.task/v2
taskId: t47-build-pipeline
status: planned
updated: 2026-11-22
---

# 编译产物流水线与发布脚本的第三条通道

## 目标与范围

nb-layout 出编译产物（ESM、类型声明、style.css）、发布脚本加“独立版本的生成包”通道、MIT 许可证与第三方声明按包判断（ADR 0054 第 5、6 条，提案“第二档：发布流水线”“MIT：要处理的事实”）；nb-story 的网页构建改读编译产物。发到 npm 由开发者执行。形状按 t43 的核实与 nb-story 的接入定。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 输入

- [t43](../t43-tier2-verification/README.md) 的“给 t47 的输入”：出声明沿用 `rolldown-plugin-dts`、声明不可复现、`style.css` 与 `sideEffects`、`lab-sources` 不发、产物去注释、Trellis 核对已完成。
- [t46](../t46-english-default-text/README.md)：建 nb-layout 的变更记录时，“不兼容的改动”写没有注入时的缺省语言从 zh-CN 改成 en-US；新增 `layoutCatalogTranslate`（`./text`）。

## 当前状态

2026-11-22 经 nbdev 新建，尚未开工。

## 下一步

待补充。
