---
schema: nbook.task/v2
taskId: t37-write-foundation
status: active
updated: 2026-11-19
---

# 写入底座：作者与 Agent 都能改设定

## 目标与范围

作者在界面里、Agent 用工具都能读写设定的全部数据：各种字段、列表与元素、引用、图片、语义档、主文字的块、Component 的加与去、条目的名字与位置。都走同一条发布通道、留改动记录、可还原。设定视图空着时有明显的新建入口。

来由：开发者 2026-11-19 看过 t31 第二批第一期后定的方向（[Work README](../../README.md) 决定表同日）：作者与 Agent 都能改数据最重要；先把底座做好，再做通一个闭环（候选是人物 Component 的设定）；UI 打磨排到最后。人物的闭环不在本 Task，底座做完再定。

合同：

- 改 [`canon/revisions.md`](../../../../../docs/specs/canon/revisions.md)（一次改几处）、[`canon/project.md`](../../../../../docs/specs/canon/project.md)（远程方法）、[`canon/author-ui.md`](../../../../../docs/specs/canon/author-ui.md)（各种字段的改法、空状态）；
- 新建 `canon/agent-tools.md`。

计划：[`plan.md`](plan.md)。

## 当前状态

- 2026-11-19 新建。主会话核实现状：Agent 一侧什么都没有；作者只能就地改四种标量字段。
- 计划第 1 稿与独立设计（Sonnet，[`evidences/independent-design.txt`](evidences/independent-design.txt)）对照后定稿，交设计审查：后端 omp 11 条（阻断 5），前端 Sonnet 15 条（重要 11），全部成立，[处理](evidences/design-review-resolution.txt)后改成第 2 稿。后端的五条阻断改动了内核的核心规则，第 2 稿的后端部分再交 omp 审一轮；前端的处理照审查建议落地，不再开设计审查。

## 下一步

1. 后端第二轮设计审查期间先做 F4（nb-ui `SearchSelect` 的远程模式、`EntryPicker`、`ImageInput`），它只依赖现有接口。
2. 第二轮处理完后照切片 F1 到 F7 实施。
3. 底座合入后，和开发者定人物 Component 闭环的范围。
