---
schema: nbook.task/v2
taskId: t10-setting-schema
status: planned
updated: 2026-10-31
---

# 设定类型与 schema 演进

## 目标与范围

定“设定类型”（人物、地点、势力、物品、规则……）的 schema 写在哪、用什么写、谁能改，以及改了 schema 以后已有数据怎么办。

合同：讨论 Task，只定设计，行为合同未变；定稿后的 Spec 改动在实施时另定。

前置：t09。

## 要讨论的问题

1. 写法：JSON Schema 加 `x-form` 提示（nb-form 直接用，不执行代码，Agent 能生成），还是旧版的 Zod TS（单文件、不能 import 是痛点）。
2. 放在哪：项目里（`lorebook.content/<类型>/schema.json`）、模板里、插件里；三层覆盖（内置、插件、用户、项目）要不要。
3. 内置哪些类型、各有哪些字段；用户自定义类型与自定义字段的上限。
4. 演进：加字段、改名、改类型、删字段时已有文件怎么处理（旧版不做版本化与迁移）；校验失败的旧文件怎么显示。
5. Agent 生成或修改 schema：走 nb-form 的 `policy: "agent"` 检查；Agent 改 schema 要不要审批。
6. 哪些字段会随剧情变化（接 t05），引用别的设定的字段怎么声明（接 t03）。

材料：[`ui/forms.md`](../../../../../docs/specs/ui/forms.md)；[调研：二、四、五节](../../research/2026-10-31-repo-survey.md)。

## 当前状态

2026-10-31 由 t01 问题发现建为草稿，尚未讨论。

## 下一步

按 Work README 的讨论顺序轮到时讨论；讨论定的事写进本 README 的“当前状态”。
