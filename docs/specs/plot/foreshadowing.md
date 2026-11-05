---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: plot.foreshadowing
owners:
  - plot 插件
---

# 剧情：伏笔

## 目标与非目标

作者要知道伏笔埋在哪、多久没提、打算在哪回收，写完一章后知道有没有没埋就回收、计划的节点漏写、回收以后又埋、依赖的物件被动过。本能力定义伏笔条目、讲述上的节点、由节点算出的阶段、计划的节点与兑现的继承、悬念与答案知识点的连接、伏笔的检查与账本。读者读到哪按讲述算（[`canon.model`](../canon/model.md) 输出 26、27）。

不承诺：

- 自动发现新伏笔、像伏笔的句子：伏笔由作者或记账建。
- 泄底的判断：由试读做（[`plot.checks`](checks.md)）。
- 给写手的伏笔信息：见 [`plot.brief`](brief.md)。

## 术语与参与者

- **伏笔**：种类为“伏笔”的条目，带 `plot.foreshadow`。名字写“许了读者什么”，主文字写打算怎么回收。
- **节点**：讲述上的 `plot.node` 标注：埋下（`plant`）、呼应（`echo`）、误导（`mislead`）、部分回收（`partial`）、回收（`payoff`），可以带给写手的指示。
- **阶段**：未埋、已埋、呼应中、部分回收、已回收；由节点算出，不存。
- **悬念**：种类为 `mystery` 的伏笔，连着答案知识点。

## 输入与前置条件

| 登记 | 内容 |
|---|---|
| Component `plot.foreshadow`，命名空间 `fs` | `种类`（enum：`setupPayoff` 埋设回收、`mystery` 悬念、`prophecy` 预言、`motif` 意象）；`重要程度`（enum：`main`、`side`、`minor`）；`意图`（enum：`active` 进行、`dropped` 放弃）；`答案`（ref，`targets` 为“知识点”，悬念用）；`物件`（以引用为键的列表：依赖的物件，例如那座钟）；`参考间隔`（number，章数） |
| 标注种类 `plot.node`（版本 1），挂在讲述上 | `{foreshadow: 伏笔, role: "plant" | "echo" | "mislead" | "partial" | "payoff", note?: 给写手的指示}`，`refs` 是 `foreshadow`（`targets` 为“伏笔”） |

本能力登记的诊断（都是版本 1，`label` 用表里的名字；节点所在的讲述记在键的 `telling` 里；按读者那一边算的不带 `line`，按线视图算的带）：

| 诊断 | 名字 | 级别 | 稳定键 |
|---|---|---|---|
| `plot.fs.payoffBeforePlant` | 没埋就回收 | `pending` | `objects`：[伏笔]；`telling`（那个回收节点） |
| `plot.fs.plannedNodeMissing` | 计划的节点没写 | `pending` | `objects`：[伏笔, 计划]；`line` |
| `plot.fs.replantAfterPayoff` | 回收以后又埋 | `pending` | `objects`：[伏笔]；`telling`（那个埋下节点） |
| `plot.fs.noPayoffPlanned` | 没排回收 | `hint` | `objects`：[伏笔]；`line` |
| `plot.fs.longSilence` | 太久没提 | `hint` | `objects`：[伏笔] |
| `plot.fs.droppedButPlanted` | 放弃了还留着 | `hint` | `objects`：[伏笔] |
| `plot.fs.orphanHint` | 没有悬念认领的暗示 | `hint` | `objects`：[知识点]；`telling` |
| `plot.fs.objectTouched` | 物件在回收之前被动过（记了变更） | `hint` | `objects`：[伏笔, 物件, 那条变更]；`line` |
| `plot.fs.objectTouchedInText` | 正文里动了物件、世界里没记 | `hint` | `objects`：[伏笔, 物件]；`line`；`range`（那一章）；`detail`（原句的 SHA-256） |
| `plot.fs.sharedAnswer` | 几个悬念同一个答案 | `hint` | `objects`：[知识点] |
| `plot.fs.nodeWithoutTelling` | 继承的节点没有位置 | `hint` | `objects`：[伏笔, 那条已写变更]；`line` |
| `plot.fs.payoffWithoutReveal` | 悬念回收了却没揭示答案 | `hint` | `objects`：[伏笔]；`telling` |

## 输出与可观察行为

1. **节点的位置。** 节点的位置是它所在讲述的发生点（章、段）。只有生效的正文讲述上的节点算数（[`canon.model`](../canon/model.md) 输出 26）；细纲、消息等讲述上的节点是计划的节点（输出 4），不进阶段。
2. **阶段。** 在讲述位置 P 上，一个伏笔的阶段由 P 上读过的节点算：没有节点是未埋；有埋下是已埋；埋下之后有呼应或误导是呼应中；有部分回收是部分回收；有回收是已回收。按这个顺序取最高的一级，误导算呼应，后来的呼应不把阶段往回拉。意图为放弃时，已埋以上的显示“放弃（已埋）”，未埋的显示“放弃”。重写删掉了回收的那句，回收的节点不再生效，阶段退回去。
3. **悬念与答案。** 悬念的 `答案` 指向知识点 K 时，生效讲述上指向 K 的揭示标注（[`plot.knowledge`](knowledge.md) 的 `plot.reveal`）也算这个悬念的节点：`hint` 算呼应，`explicit` 算回收，位置是那处讲述。一个知识点被几个悬念的答案指向时，几个悬念都算，并给提示 `plot.fs.sharedAnswer`。
4. **计划的节点与继承。** 计划的讲述（细纲）上的节点是计划的节点，按计划的安放所在的章计。兑现这个计划的已写变更（`fulfills`），在它自己的讲述上没有同一个伏笔的节点时，继承计划的节点：位置是这条已写变更第一处生效的正文讲述；它没有生效的正文讲述时，继承的节点没有位置、不算数，并给提示 `plot.fs.nodeWithoutTelling`。
5. **只看本线。** 伏笔的计划、兑现与节点按世界线视图取（[`canon.worldlines`](../canon/worldlines.md)）；读者那一边的阶段按活页夹正文算，不分线（同一 Spec 输出 13）。
6. **进待处理的检查**（诊断，级别 `pending`）：
   - `plot.fs.payoffBeforePlant`：一个伏笔的回收（或部分回收）节点之前没有埋下的节点；
   - `plot.fs.plannedNodeMissing`：一条带伏笔节点的计划安放在第 N 章，第 N 章已经有已写的剧情变更，而到第 N 章末尾这条计划仍未兑现，或兑现了但第 N 章里没有这个伏笔的节点；
   - `plot.fs.replantAfterPayoff`：已回收以后又有埋下的节点。
7. **只提示的检查**（诊断，级别 `hint`）：
   - `plot.fs.noPayoffPlanned`：已埋、没回收，也没有带回收节点的计划；
   - `plot.fs.longSilence`：已埋、没回收，从最后一个节点到最新一章超过参考间隔（没设时按重要程度：`main` 30 章、`side` 20 章、`minor` 10 章；缺省值，用样本书量过以后再定）；
   - `plot.fs.droppedButPlanted`：意图为放弃，正文里还有生效的埋下节点；
   - `plot.fs.orphanHint`：一处 `hint` 的揭示指向的知识点没有任何悬念的答案指向它；
   - `plot.fs.objectTouched`：伏笔已埋、没回收期间，有一条生效、套上的剧情变更的补丁改了 `物件` 里某个条目的状态（钟被拨了）；`plot.fs.objectTouchedInText`：窄问题报出正文里动了它，而那一章没有这样的变更（[`plot.checks`](checks.md)）；
   - `plot.fs.sharedAnswer`、`plot.fs.nodeWithoutTelling`：输出 3、4；
   - `plot.fs.payoffWithoutReveal`：悬念的回收节点（已写的，或计划的）所在的那一章，没有对它答案的 `explicit` 揭示。回收节点本身不让读者知道答案：读者的知情只按揭示算（[`plot.knowledge`](knowledge.md) 输出 6），给写手的内容见 [`plot.brief`](brief.md) 输出 8。
8. **账本。** 读取视图：每个伏笔的阶段、全部节点（种类、章与段、给写手的指示）、计划的节点与它们的章、最后一次被提到的章、依赖的物件与它们最近一次被改的变更；可以按阶段、重要程度、意图、章的范围筛。

## 状态与转换

- 阶段、继承的节点、账本都在读取时算出，没有自己的状态；意图只由修订改变。

## 副作用与数据

- 伏笔条目、节点标注存在世界里，随修订写进世界日志；阶段与账本不存。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `plot.fs.payoffBeforePlant` | 待处理：没埋就回收 | 在前面补埋下的节点，或改这个节点的种类 |
| `plot.fs.plannedNodeMissing` | 待处理：计划的节点那一章写完了却没有 | 补写、补标，或改计划 |
| `plot.fs.replantAfterPayoff` | 待处理：回收以后又埋 | 改节点的种类，或建一个新伏笔 |
| 输出 7 的各项 | 提示 | 看提示，作者可以标“有意为之”（[`canon.model`](../canon/model.md) 输出 35） |

## 边界与兼容

- 公开接口：Component 与标注的声明、诊断的 id 与键、账本的结果形状。
- 插件停用时，伏笔条目与节点照常存着、只读；阶段、检查与账本不可用。

## 验收与 Smoke

1. **钟。** 伏笔“那座钟慢了一刻”（埋设回收，物件是那座钟）：第 3 章埋下，第 7 章呼应，第 15 章计划回收。第 10 章一条变更改了钟的状态（拨回正点）：提示 `plot.fs.objectTouched`。第 15 章写完、没有回收节点：`plot.fs.plannedNodeMissing`；补上以后阶段是已回收。作者改稿删掉第 15 章那句：阶段退回呼应中，`plot.fs.plannedNodeMissing` 回来。
2. **悬念与答案。** 悬念“谁杀了男爵”的答案是知识点“管家是凶手”：第 5 章一处 `hint` 的揭示让阶段到呼应中，第 20 章 `explicit` 的揭示让它已回收；同一知识点又被另一个悬念指向：两个都算，提示 `plot.fs.sharedAnswer`。
3. **继承。** 第 9 章计划“提一次那封信”带伏笔“信”的呼应节点；记账写的已写变更兑现它、自己没标节点：节点继承到它在第 9 章第一处正文讲述上。
4. **没埋就回收。** 一个伏笔第一个节点是回收：`plot.fs.payoffBeforePlant`。

Smoke：不适用——由剧情插件的包测试覆盖。

## 证据

- 批准依据：作者视角的世界引擎：剧情侧（第一版）（`docs/proposals/world-engine-plot-side.md`）第四部分第 9 节；ADR 0041（`docs/adr/0041-world-engine-kernel-mechanisms-plot-plugin-semantics.md`）、ADR 0043（`docs/adr/0043-world-engine-placement-and-telling-orders.md`）；开发者 2026-11-04 定伏笔四条。
