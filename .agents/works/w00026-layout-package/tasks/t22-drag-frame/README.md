---
schema: nbook.task/v2
taskId: t22-drag-frame
status: active
updated: 2026-11-07
---

# 拖动重整：跟手的东西不走渲染，标签条都能实时布局

## 目标与范围

开发者 2026-11-07 试用 t20 后的四条：让出的位置不画卡片；样式重算要降到刷新率；一拖动就缩成卡片且可配置；标签条排序受手感设置控制，活动栏和别的标签组也实时布局。代码不要再修修补补。

合同：[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 38 要改，见 [`plan.md`](plan.md)。

## 当前状态

五个切片都已提交在分支 `feat/w00026-t22-drag-frame`，实现审查进行中，没合入。

计划开发者看过要点（2026-11-07）：让出的位置、卡片时机按推荐；活动栏与别的面板的标签条走同一条逻辑，指针上去就被吸收，别的面板这条优先级最低，难实现可以禁用。吸收做出来了，没有禁用。

每帧样式重算（[`evidences/frame-cost.txt`](evidences/frame-cost.txt) 最后一节，无头 Chrome 60Hz）：拖视图 5.2 到 1.33，布局 0.69 到 0.17；拖编辑器标签 3.8 到 1.24；拖窗 0.99，布局 0；指针不动 0。扫描路线一直在换落点，多出的 0.33 来自换落点时的重排；候选不变的阶段由 `workbench-drag-cost` 判定。真实 144Hz 的数字要开发者用 DevTools 复测。

验证：`test:affected --since master --typecheck` 只有 nb-agent-ui、nb-story 的类型检查失败，这两包本分支没动，主工作区同样报错（nb-story 1 条，nb-agent-ui 2 条）。e2e：`workbench-live-drag`、`workbench-drag-cost`、`workbench-dnd`、`workbench-views`、`editor-area`、`workbench-float`、`files-explorer` 通过；`lab-scenes` 失败 1 项，是主题编辑器场景 `ThemeEditor/scene-full`、`icons` 的素材地址 404（fixture 用假哈希，w00041 t16 引入），开发服务 4217 的 master 上同样 404，不是本 Task 引入。`docs:check`、`governance:check` 无失败。

诊断：拖视图时每帧 5.2 次样式重算、0.69 次布局，拖编辑器标签 3.8 次（[`evidences/frame-cost.txt`](evidences/frame-cost.txt)，脚本 [`scripts/diag-drag-frame.mjs`](scripts/diag-drag-frame.mjs)）。主因是卡片矩形每帧经属性穿过 NestedGrid，所有面板头跟着重渲染，`TransitionGroup` 每次都量。t20 的 `drag-cost.txt` 里 `RecalcStyleCount` 已经是每次移动 5.5 次，当时只看了耗时，漏了次数。

设计审查（一个 Sonnet，[`evidences/plan-review.txt`](evidences/plan-review.txt)，15 条：重要 8、建议 7）的处理：

| 条 | 判定 | 处理 |
|---|---|---|
| 1 每帧先写后读 | 成立，改 | `tick` 第一步 `session.flush()`，判定先于写；我原来的“pointermove 只读”写错了 |
| 2 `displayKey` 冻住反馈 | 成立，改 | 不要这个选项，发布不改；工作台自己让落点对象身份稳定 |
| 3 `Tooltip` 根是 Fragment，`TransitionGroup` 不动 | 成立，改 | 条目包普通 `div` |
| 4 去重没定义重置 | 不再适用 | 手势不去重 |
| 5 拿掉 `point` 的缺口 | 不再适用 | `point` 留着；只取其中的建议：`activate` 带坐标，删常驻监听 |
| 6 判据要加前提 | 成立，改 | Spec 与 e2e 都按阶段，候选稳定、过渡结束之后才断言 |
| 7 几何失效与滚动 | 部分成立 | 实时布局不重量，不会振荡；落点指示每次量，行为不变；溢出时差一点写进风险 |
| 8 吸收后“来源面板”、拿起矩形、`inPlace` | 成立，改 | 两档写成表，来源面板固定；拿起矩形用 `geometry` 不读 DOM；判据写清 |
| 9 写样式的目标与命名 | 成立，改 | `:scope >`；窗用 `translate` 属性，全部内容元素；改名 `placeLifted`、`placeFloat` |
| 10 言过其实，缺删除清单 | 成立，改 | 加删除清单；`presentDrag` 只说它做的事 |
| 11 Spec 漏项、指示手感退化 | 成立，改 | 指示手感不再冻结，所以输出 25、32 不改；补验收 22 第三句 |
| 12 活动栏多面板时占位对不上 | 成立，接受 | 罕见，结果对，写进风险 |
| 13 量取时机、文件拖动的寿命 | 部分成立 | 两步量取保留；文件拖动每次量，没有寿命问题 |
| 14 Trellis 按预览文档判定 | 成立，不做 | 另一个行为取舍，交付时告诉开发者 |
| 15 待确认与测试缺口 | 成立，改 | 补用例；“吸收时目标显示来源”交付时点明 |

## 下一步

处理实现审查，合入 master。
