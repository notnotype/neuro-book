---
schema: nbook.task/v2
taskId: t13-image-library
status: planned
updated: 2026-11-10
---

# 图片库与空间管理

## 目标与范围

这个 Task 负责：
- 生成记录与书里的副本；
- 内容快照与对账；
- 本机图片仓库 `user://images/`；
- 收藏与收藏夹；
- 书里的 `.image` 插图；
- 空间管理（上限、自动清理）；
- 图库页与检索条件（与 t08 的 Agent 检索工具共用）。

依据是提案 [图像生成第一版](../../../../../docs/proposals/image-generation-v1.md) 的第 1、6、7 节与 [ADR 0049](../../../../../docs/adr/0049-image-store-owns-generated-batches.md)。提案接受时把这一块从 t06 分出来（待定项 4）：t06 要等 t02 的后端实测，图片库不依赖后端的细节，可以先做。

合同：新写 `docs/specs/images/library.md`。

## 前置

- **对账：**与 t06 一起定。对账协议是仓库每行带“安装 id 加递增序号”，副本最后的序号就是游标。
- **缩略图的图片处理库：**技术选型在实施计划里做，候选是 sharp 与 WebAssembly 的 jsquash。
- **文件夹类型的渲染贡献点：**规范 `workspace/folder-kinds` 写了，代码里没有，按提案待定项 7 由本 Task 顺带补上。
- **三样平台能力：**记账与变更事件的排除贡献点；服务端代作者写入时带上发起者；仓库记录的追加写法。前两样要和 w00032 t13 一起定，即提案待定项 6。

## 写 Spec 时逐条定的机制

这些来自设计审查第 3 轮，方向写在提案“留给 `images/library` 的机制”一段里：
- 收进书里以后，引用由谁写；
- 仓库记录坏了怎么办；
- 副本在 Git 里被人改了怎么办；
- id 索引存在哪，`image.json` 的几个写者怎么协调；
- 同一张图属于几批；
- 别的机器生成的批次。

三轮审查的报告与处理在 [t03 的证据](../t03-core-contracts/evidences/design-review-round3.md)。

## 当前状态

2026-11-10 经 nbdev 新建，尚未开工。

## 下一步

等 t03 的 `images/prompt` 与 `images/recipes` 写完，再按 writing-specs 写 `images/library`。快照与生成记录的内容，要用到配方的形状。
