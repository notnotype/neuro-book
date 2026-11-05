---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: plot.decisions
owners:
  - plot 插件
---

# 剧情：决策的守卫与检查、章的写作指示

## 目标与非目标

作者定下的“为什么这样写”与给写手的约束，要在写作时被遵守、写完后被检查；每章的写作要求要进写手的上下文。决策本身（状态、作者来源、挂的对象）由内核存（[`canon.model`](../canon/model.md) 输出 31 到 33）；本能力定义剧情插件在它上面加的守卫、决策的检查、“涉及本章的决策”，以及章的写作指示怎样被读进来、怎样检查。

不承诺：

- 写作指示的文件、版本与并发：随项目布局与写作流程另行定义；本能力只消费“章的写作指示快照”（输入）。
- 文字约束的自动判定：由窄问题问（[`plot.checks`](checks.md)）。
- 写正文前的拦截与“照写”的交互：由写作任务另行定义；本能力给出拦截所需的视图（输出 6）。

## 术语与参与者

- **守卫**：挂在已定决策上的标注，由程序检查：地址守卫（某个地址在章的范围里不准取某些值）、读者守卫（某章之前读者对某个知识点不得到某个程度）。
- **涉及本章的决策**：挂的对象与本章涉及的条目（[`canon.model`](../canon/model.md) 输出 20）相交、挂在本章上，或范围包含本章的决策。
- **章的写作指示快照**：某一章的写作指示在某个版本上的内容。

## 输入与前置条件

| 登记 | 内容 |
|---|---|
| 标注种类 `plot.guard.address`（版本 1），挂在决策上 | `{at: 地址, notIn: 值的列表, from?: 章, to?: 章, lines?: 世界线 id 的列表}`，`refs` 是 `at.entry`（条目）与 `lines[]`（`kind: line`，世界线）；`lines` 没给时是所有存在的线 |
| 标注种类 `plot.guard.reader`（版本 1），挂在决策上 | `{point: 知识点, atMost: "unaware" | "suspects", until: 章}`：`until` 这一章之前（不含），读者对这个知识点的程度不超过 `atMost`；`refs` 是 `point`（`targets` 为“知识点”） |

本能力登记的诊断（都是版本 1，`label` 用表里的名字）：

| 诊断 | 名字 | 级别 | 稳定键 |
|---|---|---|---|
| `plot.decision.addressGuardViolated` | 违反了地址守卫 | `pending` | `objects`：[决策, 让它违反的那条变更（范围开头就违反时没有这一项）]；`line` |
| `plot.decision.readerGuardViolated` | 违反了读者守卫 | `pending` | `objects`：[决策]；`telling`（第一处让它超过的讲述） |
| `plot.decision.constraintViolated` | 违反了已定的约束 | `pending` | `objects`：[决策]；`range`（那一章） |
| `plot.decision.decidedInText` | 写死了未定的事 | `pending` | `objects`：[决策]；`range`（那一章） |
| `plot.decision.overdue` | 到期没定 | `pending` | `objects`：[决策] |
| `plot.decision.dangling` | 悬空 | `hint` | `objects`：[决策] |
| `plot.instruction.povAbsent` | 视角人物不在场 | `hint` | `objects`：[视角人物]；`range`（那一章） |
| `plot.instruction.flashbackMismatch` | 补叙的安放对不上 | `hint` | `range`（那一章） |
| `plot.instruction.repeated` | 写作指示反复出现 | `hint` | `range`（第一章到最后一章） |

**章的写作指示快照**（宿主给出；字段都可选）：`{chapter, version, readerChange, pov, povMode: "first" | "limited" | "omniscient", timeMode: "follow" | {parallel: 章} | {flashback: 安放}, tone, opening, ending, avoid: 文字的列表, other}`，分别是读完这一章读者该有什么变化、视角人物（条目引用）、视角方式、章的时间方式（承接、与某章同时、补叙某处安放的事）、语气、开场、结尾、不写的、其他。

## 输出与可观察行为

1. **只查已定的。** 守卫与约束只对状态为已定的决策检查；待定、被取代、放弃的不查。
2. **地址守卫**（诊断 `plot.decision.addressGuardViolated`，级别 `pending`）：在守卫的 `lines` 里的每一条线上、各按那条线的视图（[`canon.worldlines`](../canon/worldlines.md)），在守卫的章的范围里（没给的端不限），从范围开头的值起、到范围里每一条套上的剧情变更之后，地址的值在 `notIn` 里就违反；每条线各自报。实际模式与按计划模式各算一份，按计划模式的结果在计划模式的待处理里。值不完整时不判，记“无法检查”。
3. **读者守卫**（诊断 `plot.decision.readerGuardViolated`，级别 `pending`）：`until` 之前的每个讲述位置上，读者的程度（[`plot.knowledge`](knowledge.md) 输出 6）超过 `atMost` 就违反；第一处让它超过的讲述记在键里；读者守卫不分线。试读报出的“提前泄底”附上相关的读者守卫（[`plot.checks`](checks.md)）。
4. **约束与未定的事**（诊断 `plot.decision.constraintViolated`、`plot.decision.decidedInText`，级别 `pending`）：由窄问题的写作指示层报出（[`plot.checks`](checks.md) 输出 5）：涉及本章、已定决策的文字约束被正文违反；涉及本章、待定决策的事被正文写死了。
5. **到期没定与悬空**：
   - `plot.decision.overdue`（级别 `pending`）：待定的决策 `due` 是第 N 章，活页夹里最新一章不早于第 N 章；
   - `plot.decision.dangling`（级别 `hint`）：已定的决策挂的对象全部是已删除的条目、已撤销的剧情变更或被取代、放弃的决策。
6. **开写前的视图。** 给出写第 N 章之前要作者看的：`due` 不晚于第 N 章的待定决策、涉及第 N 章的 `plot.goal.premiseChanged`（[`plot.goals`](goals.md)）与本章计划会触发的地址守卫违反（按计划模式）。拦不拦、作者选“照写”怎么记，由写作任务定。
7. **涉及本章的决策。** 读取视图：第 N 章涉及的决策，已定的在前、按挂的对象排；每条带结论、理由（没给时“作者没说理由”）、约束与守卫。泄底、穿帮、违反写作指示的诊断，都附上挂在同一个知识点、条目或本章上的决策。
8. **写作指示的检查**（级别 `hint`）：
   - `plot.instruction.povAbsent`：指示的视角人物在本章没有任何一条剧情变更里在场；
   - `plot.instruction.flashbackMismatch`：时间方式是补叙某处安放，而本章安放的剧情变更不在那处安放附近（不在同一章、也不在前史里它的前后）；
   - `plot.instruction.repeated`：同一句“不写的”或“其他”连续出现在 3 章以上的快照里，建议升成决策。
9. **剧情线上的写作指示。** 挂在剧情线条目上的已定决策，对这条剧情线上有剧情变更的每一章都算“涉及本章的决策”。
10. **快照的版本。** 简报与窄问题记下它们用的写作指示快照的版本（[`plot.brief`](brief.md)）；快照变了以后，用旧版本做的检查结果标“写作指示已变”。

## 状态与转换

- 守卫是决策上的标注，随决策的状态生效与失效（输出 1）；检查与视图在读取时算出。

## 副作用与数据

- 守卫存在决策的标注里；写作指示快照不存进世界。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `plot.decision.addressGuardViolated`、`plot.decision.readerGuardViolated` | 待处理：违反了已定决策的守卫 | 改记录或正文；或作者带来源改、重新打开这条决策 |
| `plot.decision.constraintViolated`、`plot.decision.decidedInText` | 待处理：正文违反了文字约束、写死了未定的事 | 改正文，或请作者定 |
| `plot.decision.overdue` | 待处理：到期没定 | 请作者定，或改到期章 |
| `plot.decision.dangling`、`plot.instruction.*` | 提示 | 看提示 |

## 边界与兼容

- 公开接口：两种守卫标注的声明、写作指示快照的输入形状、诊断的 id 与键、视图的结果形状。
- 插件停用时，守卫照常存在决策上、只读，检查不可用；决策本身照常可用（内核）。

## 验收与 Smoke

1. **地址守卫。** 已定决策“第 30 章之前星瑕的身份不暴露”带地址守卫：`{at: 星瑕.身份.公开, notIn: [true], to: 第 30 章}`。第 18 章一条计划把它设成真：按计划模式的待处理里有一条违反，实际模式里没有；记账写成已写变更以后，实际模式里也有。
2. **读者守卫。** 已定决策带读者守卫：`{point: 管家是凶手, atMost: suspects, until: 第 20 章}`。第 12 章一处 `explicit` 揭示：违反，键指向那处讲述；改成 `hint` 后消失。
3. **到期没定。** 待定决策“哥哥的秘密在哪一章揭开”到期第 15 章：活页夹到第 15 章时进待处理，开写第 15 章的视图里有它。
4. **写作指示。** 第 6 章指示的视角人物是星瑾，本章的剧情变更里她都不在场：提示 `plot.instruction.povAbsent`。

Smoke：不适用——由剧情插件的包测试覆盖。

## 证据

- 批准依据：作者视角的世界引擎：剧情侧（第一版）（`docs/proposals/world-engine-plot-side.md`）第四部分第 11 节；ADR 0041（`docs/adr/0041-world-engine-kernel-mechanisms-plot-plugin-semantics.md`）；开发者 2026-11-04 定决策与章级写作指示五条。
