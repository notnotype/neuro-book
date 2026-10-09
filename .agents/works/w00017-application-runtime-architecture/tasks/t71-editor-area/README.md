---
schema: nbook.task/v2
taskId: t71-editor-area
---

# NeuroBook v2 Files 竖切四：编辑器区

## 目标与范围

第 6 步 Files 竖切的第四片（分解见 [t68 的计划](../t68-files-resource-layer/plan.md#第-6-步分解)）：主页面的编辑器区。新插件 `nbook.editor` 贡献编辑器槽，编辑组与标签（preview / permanent、向右与向下拆分、会话恢复），文档模型（打开引用、dirty、按基线保存、冲突裁决、外部修改与改名重绑定），Markdown 富文本（Tiptap，项目方言往返）与源码（Monaco）两种编辑器，乐观切换与 800 ms 进度条，资源管理器在复制、移动、删除前对未保存文档的结算。

实施计划：[plan.md](plan.md)。

行为合同：[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md) 的“文档与体验”“打开与切换”、[`workspace/files.md`](../../../../../docs/specs/workspace/files.md) 的“读取与保存”、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md) 的编辑器命令，以及本 Task 新写的 `workbench/editor.md`。

## 前置

Files 竖切三 [t70](../t70-files-explorer/README.md)。

## 当前状态

- 2026-10-09 计划起草；三个 omp 计划审查（对照参考实现、架构与不变量、可测性）共 27 条发现（阻断 3 条：删除后丢弃与保留的矛盾、保存换掉冻结令牌、生产 e2e 没有制造慢读的接缝），全部核实成立并入计划，报告见 `evidences/plan-review-*.txt`，取舍记入待确认清单。
- 2026-10-09 S0 新 Spec `workbench/editor.md`（25 条输出、11 个验收场景），files、files-explorer、commands、workbench-shell、browser-host 随之修订。
- 2026-10-09 S1 工作台的编辑器槽贡献点 `workbench.editor-area`（取 `order` 最小的一个，其余记诊断；面板最大化时 `visible` 为假、不重挂）；Files 保存回执带替换前后的目录项身份（远程合同版本 3，经链接保存时没有）。变异 7 个杀死 6 个，存活的一个等价（内核本来就拒绝撤回句柄的实现），已简化掉多余的查找。
