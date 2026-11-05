---
schema: nbook.task/v2
taskId: t05-drag-session
status: planned
updated: 2026-11-05
---

# 手势会话与落点登记

## 目标与范围

把工作台、编辑器标签、资源树三份拖动手势抽成 nb-layout 里的一份会话，取消规则统一（现在工作台那份不监听 lostpointercapture）；落点改成统一登记，取代资源树读 data-editor-group 标记；反馈做成可替换。行为按 Spec 不变，走样的取消规则按 Spec 改统一。

合同：[`ui/layout-drag.md`](../../../../../docs/specs/ui/layout-drag.md)（新建）；[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 外壳三、[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 35 与 55、[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md) 的“拖动”按它改。计划：[`plan.md`](plan.md)。

## 当前状态

开发者 2026-11-05 确认计划要点（“可以，没问题”）。设计审查（Sonnet，[报告](evidences/design-review.txt)）13 条，阻断 1、重要 3、建议 9，已改进 Spec 与计划：

| 条 | 处理 |
|---|---|
| 1 触摸时隐式捕获的 `lostpointercapture` 冒泡到根，拖动被取消 | 成立（真实 Chrome 复现）。只认 `target === root`，加触摸验收 |
| 2 边缘滚动中松手被失去捕获取消 | 成立（复现），现有 bug。松手后这段忽略失去捕获，加验收 |
| 3 `hoverDrag` 走默认 `watch` 会晚于 `commit`，放下静默不写 | 成立（读代码）。用 `flush: "sync"`，不改控制器：`transfer.test.ts` 经公开接口测它，审查者建议的 `dropDrag(over, shown)` 要改这批测试，收益不抵 |
| 4 松手丢了之后无按键起拖 | 成立（复现）。`buttons` 为 0 放弃，捕获没拿到按丢失算 |
| 5 还焦点的时序计划与 Spec 矛盾 | 成立。状态机按结束方式决定，Spec 写清三种 |
| 6 滚动的范围没写 | 成立。统一成根内；窗口尺寸变化三处都重判（树原来没有，表里记为变化） |
| 7 测试层选错 | 成立。加 Lab 场景与 `lab-drag-session.e2e.ts`，切片 1 就进真实浏览器；输出 17 改成能判定的说法 |
| 8 `defineDropKind` 在 `./vue` 会把 Vue 层带进 `shared` | 成立。移到核心入口 |
| 9 登记表的前提 | 部分成立。种类按 `id` 比较，Spec 写明只给内置插件；`Symbol.for` 全局互通是过度防御，不做 |
| 10 收场顺序 | 部分成立。`state` 先置空，`flyBack` 用 `last`；每步包 `try/finally` 不做，回调都是自己的代码 |
| 11 t07、t08 要返工 | 部分成立。Spec 标明过渡形态；接口不预留，后加的选项都是增量，不动三个宿主 |
| 12 接口太多 | 成立。去掉 `A`、`actionOf`、`sameAction`，换成 `actionKey`；`top` 不进状态机；`activate` 返回布尔 |
| 13 几处约束没带过来 | 成立。keyup、`blur` 不加捕获、第一次发布的坐标、`nb-layout/AGENTS.md` 都补上 |

实现审查（Sonnet，[报告](evidences/impl-review.txt)）11 条，都是建议级，对照旧实现没有发现回归：

| 条 | 处理 |
|---|---|
| 1 放下中的守卫没有测试 | 成立。`move`、`withdraw` 各补一条；`resized` 的守卫本来多余（已排着那一帧），删掉 |
| 2 `workbench-dnd.e2e.ts` 的捕获断言查错了元素 | 成立。改查外壳根；Lab 的取消用例都加上捕获已释放 |
| 3 外壳没测松手时的 click | 成立。加用例：取消后回到标题上松手不收起，并用没过门槛的点击做对照 |
| 4 核心入口多导出 | 成立。收窄到 Spec 列的，`DragState` 从 `./vue` 出 |
| 5 过门槛那一下多判定一次 | 成立。拿起已发布，只排边缘滚动 |
| 6 连发空格的守卫是空操作 | 成立。删掉，连同 `repeat` 字段 |
| 7 `capture` 吞所有 `DOMException` | 成立。只收 `NotFoundError`、`InvalidStateError`，其余抛出 |
| 8 注释与同名文档没跟上 | 成立。都补上 |
| 9 小问题 | `hit` 别名、导入顺序已改。`Hovered.action` 与 `props.drag.action` 两份来源不改：前者是放下比较的快照，后者是控制器写回的显示状态，`transfer.test.ts` 经控制器公开接口测它；加了注释 |
| 10 每帧 `elementsFromPoint` | 不改。没有实测的代价，工作台原来就这么用，只留一条路径 |
| 11 Lab 触摸用例失败时不收口 | 成立。改用 `test.use({hasTouch: true})` |

审查者没有证据的一项自己量了（真实 Chrome，外壳拖活动条目）：拖动中来源 `:active` 为真、`scale` 被样式撤回 1、宽 38px，光标 `grabbing`，捕获在外壳根上；松手后都复原。

验证中一个教训：`setPointerCapture` 与 `releasePointerCapture` 都在下一个指针事件时才生效。过门槛后不再动就释放，捕获根本没生效，也就不会派发 `lostpointercapture`；用例靠 Chrome 在布局变化后补发的移动碰巧通过，负载高时失败。用例已改成先动一下再释放，单条重复 8 遍通过。

## 下一步

按 `plan.md` 的切片实施。
