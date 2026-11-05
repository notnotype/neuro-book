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

## 下一步

按 `plan.md` 的切片实施。
