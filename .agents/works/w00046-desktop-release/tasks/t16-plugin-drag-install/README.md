---
schema: nbook.task/v2
taskId: t16-plugin-drag-install
status: active
updated: 2026-11-16
---

# 拖拽安装插件

## 目标与范围

把插件的构建目录拖到插件页安装：上传到暂存区、预览、确认安装；修改 runtime/plugin-install

合同：[`runtime.plugin-install`](../../../../../docs/specs/runtime/plugin-install.md) 加第二种安装输入“上传的文件夹”与上传暂存区（条目级 planned）。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-15 经 nbdev 新建。2026-11-16 写好计划，设计审查三轮（Opus）：第 1 轮 17 条、第 2 轮 14 条（r3 改成一个请求传整个文件夹）、第 3 轮 11 条仍有 2 条高级，都在 nb-host（Bun 请求体缺省上限 128 MiB；nb-host 转交请求会把整个请求体收进内存）。按 autonomous-delivery 停下等开发者，建议见 [design-review-r3-proposal](evidences/design-review-r3-proposal.md)。

## 下一步

开发者定上限与 nb-host 转交的改法后写计划 r4、开工。
