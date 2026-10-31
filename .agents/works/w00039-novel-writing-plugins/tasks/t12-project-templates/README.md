---
schema: nbook.task/v2
taskId: t12-project-templates
status: planned
updated: 2026-10-31
---

# 项目模板

## 目标与范围

定新建作品时的模板：模板里有什么、谁提供、怎么选、用户能不能自己做模板。现在新建只写 `.nbook/project.json`，没有模板。

合同：讨论 Task，只定设计，行为合同未变；定稿后的 Spec 改动在实施时另定。

前置：t10、t11。

## 要讨论的问题

1. 模板的内容：目录骨架、清单、设定类型的 schema、示例条目、推荐启用的插件、项目级 Agent 指令。
2. 谁提供：内置、插件贡献、用户另存（放 `user://templates/`）、以后从市场装（接 w00038）。
3. 内置几种：空白、长篇网文、短篇、同人、剧本？按题材（修仙、都市、推理）分要不要。
4. 新建对话框里怎么选、预览；新建后能否再套用另一个模板的部分内容（例如只加一组设定类型）。
5. 模板升级：模板改了，用它建的旧作品要不要跟着改（倾向不改，只提示）。
6. `nbook project create`（w00032 t16）要不要带 `--template`。

材料：[`runtime/projects.md` 第 14 条](../../../../../docs/specs/runtime/projects.md)；[书架](../../../../../docs/proposals/bookshelf.md)。

## 当前状态

2026-10-31 由 t01 问题发现建为草稿，尚未讨论。

## 下一步

按 Work README 的讨论顺序轮到时讨论；讨论定的事写进本 README 的“当前状态”。
