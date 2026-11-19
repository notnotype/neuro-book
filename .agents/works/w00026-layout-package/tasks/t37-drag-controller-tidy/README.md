---
schema: nbook.task/v2
taskId: t37-drag-controller-tidy
status: active
updated: 2026-11-19
---

# 整理拖动控制器，纯的部分抽进库

## 目标与范围

按提案第一档第 6 项（手感引擎分两步的第一步）：按 t26 design-09、10 把每场拖动的状态收进一个对象、判定拆成纯函数、补单元测试；卡片的缩放与追赶、帧调度、卡片坐标换算抽进 nb-layout；工作台手感不变

合同：
- 工作台的行为合同不变，判据是 [`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 38 一族的 e2e 与 Lab 场景对照基线不变。
- 抽进库的两样写成 [`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 输出 20（拖动卡片）、21（帧循环），先标 planned。

## 当前状态

2026-11-19 计划第 2 稿（[`plan.md`](plan.md)）：设计审查一轮处理完（见下文“设计审查”），开始实施。第 1 稿先按 advisor 的意见补了几处：
- 每片要跑的 e2e；
- `run` 的寿命写成“下一次拿起前一定换掉”；
- `collapseSource` 返回假时的完整分支；
- 几何测试的期望值手算、不和实现共用一个式子；
- 两条输出先写进 Spec；
- “卡片位置的换算”的读法记进待确认清单。

worktree `.worktree/w00026-t37-drag-tidy`（分支 `w00026/t37-drag-tidy`）已开，未改动。

只读盘点：[`evidences/inventory.txt`](evidences/inventory.txt)。基线：master 上 `workbench-live-drag`、`workbench-dnd`、`workbench-float` 共 76 条全过。

## 设计审查

Claude Sonnet（`claude -p`），一轮，8 条：重要 5、建议 3、阻断 0（[`evidences/design-review.txt`](evidences/design-review.txt)）。都成立，按审查改成计划第 2 稿：

| # | 发现 | 处理 |
|---|---|---|
| 1 | 每场对象收场后置 `null`，逼出 `refusalAtEnd` 这条新交接，落在没有 e2e 的路径上 | 成立。`run` 不再可空：收场时换成空闲的一份，只带着最后一次判定给 `onEnd`。`refusalAtEnd`、键盘的例外、`nextTick` 比对、`dropFor` 多传的缓存参数都去掉 |
| 2 | `collapseSource` 返回 `boolean` 的论证不成立：返回假时预览按候选摆、几何没收起，仍不一致 | 成立。接口不改，早退留着、写注释。审查说早退走不到，我核对后认为 `removeTab` 那一支走得到（拖动中用快捷键关掉来源、指针不动、帧还在跑，从代码推断），所以不改成抛错 |
| 3 | 第 2、3 片改到 `fileDrop` 读的几何，选的 e2e 不含资源树拖文件 | 成立。第 2、3 片与收口加 `files-explorer.e2e.ts:550`、`:876` |
| 4 | 帧循环的合同缺：`frame` 抛错后、`running` 的语义、`elapsed` 夹 0、`wake` 监听的次序 | 成立。四处都写进计划与 Spec 输出 21，`running` 删掉 |
| 5 | 卡片对退化输入没有定义，零尺寸的 `from` 会让帧循环永不停；“拿起那一帧不缩”不准 | 成立。宽或高不是正数当 `null`，`elapsed` 不是有限数或为负按 0，补测试；Spec 改成“第一次 `step` 不按时间逼近” |
| 6 | `DragCard` 把内部记账做成公开字段；README 一行不够用 | 成立。改成一张卡片一个对象（`createDragCard(...).step`），另写 `drag-card.md` 带例子 |
| 7 | `strip-sort.ts` 搬的是读写 DOM 的代码，与“量 DOM 的不拆”矛盾 | 成立。不开这个文件，只把位移的算术 `sortedOffset` 放进 `drag-geometry.ts` |
| 8 | `held` 里的 `Judgement` 是两个来源拼的，读者会误会 | 成立。`held` 平铺（今天的形状），注释写明 `drop` 取宿主传来的 |

对待确认两条：审查同意按 `origin` 参数做卡片的换算，要求写明空位的换算第三方仍要自己写一行（已补进清单）；新增导出的形状等这一轮改完再算定下（已按第 2 稿改名）。

## 实施记录

worktree `w00026-t37-drag-tidy`（分支 `w00026/t37-drag-tidy`）：

| 片 | 提交 | 内容 | 验证 |
|---|---|---|---|
| 1 | `1b0abef4b` | 删 `sourceCollapsed`（改读 `beforeCollapse`）与没有调用方的 `LiveDrag.origin`；`collapseSource` 的早退写明为什么可以不管 | 类型检查、`live-drag.test.ts` 24 条；e2e 与第 2 片一起跑 |
| 2 | `b9bdb2d05` | 每场一个 `DragRun`：拿起时新建，收场换成空闲的一份；`dropAt` 与 `resolveDrop` 带回 `Judgement`（落点、是否被拒绝、编辑器的拒绝），`overRejected`、`editorRefusal` 两个 `let` 去掉；14 个 `let` 剩 1 个 `run` | e2e：`workbench-live-drag`、`workbench-dnd`、`workbench-float`、`files-explorer.e2e.ts:550`、`:876`，78 条全过（4.5 分钟，负载 4.6） |
| 3 | `8109e92ab` | `drag-geometry.ts`（收起后的几何、入口条补位、抓点、标签下标、整窗矩形、排序位移）与 `drag-keyboard.ts`（键盘停靠点）拆成纯函数；`layout-drag.ts` 从 1134 行到 953 行；`drag-geometry.test.ts` 14 条、`drag-keyboard.test.ts` 7 条 | 同上一组 e2e 78 条全过；变异：头高跟着下沿走时 2 条变红 |
| 4 | `1f51d1904` | nb-layout 加 `createDragCard`、`createFrameLoop` 与短文档 `src/drag-card.md`，入口与 README 的对照表各加一行；`live-drag.ts` 改用它们，闭包里的 `let` 从 20 个到 12 个 | `drag-card.test.ts` 8 条、`frame-loop.test.ts` 7 条、`exports.test.ts`、`readme.test.ts` 通过；变异 4 处（拿起那帧也逼近、不按间隔写尺寸、帧循环不 `finally`、零尺寸当可用）都变红；`live-drag.test.ts` 不改断言 24 条通过；e2e（实时布局、拖放、每帧开销）67 条里 66 条过，挂的那条见下一行；性能对照与基线一致（[`evidences/perf.txt`](evidences/perf.txt)） |
| 测试修正 | `7a7a4b071` | `workbench-drag-cost.e2e.ts:157`（按住不动不排动画帧）先等预览换成来源收起，再等过渡结束 | 这条在分支起点 `b28277e7b` 上 3 次挂 2 次、第 3 片上 3 次挂 2 次，不是本 Task 引入的。探针抓到多出来的那一帧是布局过渡收尾时分隔线对齐排的（`useGridMotion` 的 `onSettled`）：原来的等待在候选还没稳定时就过了，预览后来才换、布局才动。改后 5 次全过 |

## 收口验证

master（`ac4d9f6ee`）已并进分支（`e4571be6d`，没有冲突；master 的 27 个提交没碰本 Task 的代码与依赖）。在合并后的分支上：

- nb-layout、应用的类型检查通过；nb-layout 单元测试 392 条全过。
- 工作台插件的单元测试 563 条过、3 条挂：活动栏底部条目、页面浮层、条目注册表的“同 id 的两条一起被拒”，是 master 上已知的原有失败（别的 Work 带进来的），与本 Task 无关。
- e2e 8 个文件 194 条全过（13.8 分钟，负载 3.1）：`workbench-live-drag`、`workbench-dnd`、`workbench-float`、`workbench-drag-cost`、`editor-area`、`workbench-containers`、`lab-drag-session`、`files-explorer.e2e.ts:550`、`:876`。

## 实现审查

Claude Sonnet（`claude -p`），一轮，5 条，都是建议（阻断 0、重要 0）（[`evidences/impl-review.txt`](evidences/impl-review.txt)）。审查者逐帧、逐返回点对照 `b28277e7b`，没有发现行为回归；它的变异检查请求没获批，“删掉后仍通过”是读代码推断的。都成立，修正在 `2c40fcc9b`：

| # | 发现 | 处理 |
|---|---|---|
| 1 | `drag-card.md` 的例子没有 `session.flush()`，与下文的次序要求矛盾；没设指针初值 | 例子在 `frame` 开头 `flush`，写明拿起时先把指针设成按下的点 |
| 2 | `start()` 撤掉已排帧没有用例 | 补“排着帧时再 `start`，只剩新排的一帧” |
| 3 | 几何测试有几处没断言：横向入口条的平移与补位、整窗的 y 夹取与不夹、`wholeInTree`、排序位移的几个夹取；“布局一致”只比了 id | 补这几条（横向入口条用一份新的布局：侧栏收走时整条左移 340、最后一个入口没了时组末端补 32，都按投影的矩形手算）；一致性用例改成比每块叶的矩形 |
| 4 | 卡片测试的期望和实现用同一个式子；没测选项、`Infinity` 宽、目标中途变化 | 期望改成手算的常数（600、563、532、506 等）；补目标中途变、宽为 `Infinity`、`tauMs` 三条。手算时发现 `stillPx` 按逼近之前的值判，`tauMs` 很小时也要第二帧才取终点，和原来一致，用例照此写 |
| 5 | 用 `idleRun` 构造进行中的一场读起来别扭；`sortedOffset` 与文件头不符 | 加 `freshRun`；`drag-geometry.ts` 文件头写上排序的位移 |

修正后：两个包的类型检查、相关单元测试（nb-layout 28 条、应用 50 条）、`workbench-live-drag.e2e.ts` 23 条通过。

## 合入

master 并进分支（`6cc707752`），master 快进到它，2026-11-19 合入；worktree 与分支已删。

## 下一步

晋升 `ui/layout-drag` 输出 20、21：去掉 planned、补实现入口与合同测试，晋升前换模型逐句核对。
