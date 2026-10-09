---
schema: nbook.task/v2
taskId: t67-workbench-shell-dnd
---

# NeuroBook v2 外壳三：拖放

## 目标与范围

按 [外壳设计稿](../../../../../docs/proposals/workbench-shell-abstractions.md)（2026-10-07 `accepted`）第 11 节的外壳三：视图与容器两类拖动源、Switcher 插入位、容器内容的边缘并入与空 Part 整区三类落点；自建容器 `custom:<UUID>`、整组并入、半区按来源比例分配；键盘拖放；拖影与落点反馈；“移动到”菜单补上新建容器。之后是第 6 步 Files。

实施计划：[plan.md](plan.md)。

行为合同（本 Task 修订）：[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 外壳三。

## 前置

外壳二 [t66](../t66-workbench-shell-views/README.md)。

## 当前状态

- 2026-10-08 计划起草，按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 交三个 omp 审查（对照 Spec 与旧应用、意图与多窗口不变量、可实现性与测试）；14 条意见按推荐并入计划（见计划“审查处理”），拖放的保存冲突政策记入[待确认清单](../../pending-confirmations.md)。下一步 S0。
- S0（Spec）：输出 24 的“新建容器（在 X）”、自建容器记录项的形状、半区写在意图单位、保存边界的冲突政策、`commands.md` 的 `newContainerIn`。
- S1（模型）：自建容器 `custom:<UUID>`、按字段的补丁与唯一的应用边界（`views/patch.ts`：目标重建、涉及容器收口、半区并入前提）、四种意图与半区、剩余区；`dnd-model.test.ts` 14 例与真实 Storage 的两窗口冲突两例，变异检查。
- S2（判定）：`views/drop.ts` 纯函数，行为表逐行 11 例，变异检查 21 处全部杀死。
- S3：`move-view` 的 `newContainerIn` 与菜单、无参选择的“新建容器（在 X）”；nb-ui `Tabs` 的逐项 `attrs`；右栏标签带与面板导航区常驻、空正文填满（“将视图拖动到此处显示”）。e2e 暴露 t66 一条用例在取消第二步前没等它打开，已改为等可观察状态。
- S4（会话）：改判为自写拖放会话，不引入 `@dnd-kit`（理由见计划 Context，记入待确认清单）。组件只写 DOM 标记，`views/drop-dom.ts` 读可见几何与命中，`views/drag-session.ts` 处理指针（6px、触摸 200ms）与键盘键表、只提交显示过的动作、吞掉拖动末尾的点击；`WorkbenchDragFeedback` 画拖影与落点。实现中修正：按下的 `:active` 缩放让源变小（拖动中撤掉；`scale` 与 `transform` 同写会被 CSS 压缩并掉）、键盘放下先还焦点后提交导致焦点落空、Tab 区域按文档顺序面板排在右栏前（改按 Part 顺序）。没有用上的 `Tabs` 的 `tabRef` 与 `keyboardDisabled` 撤掉。
- S5（e2e）：`e2e/workbench-dnd.e2e.ts` 13 例，连跑三次 39 例全过；对会话做两处变异（不吞点击、按键不拦截）均被抓到；全量 e2e 93 例通过。截图 `evidences/shots/`：产品页拖动中的插入线与半区（1440×900）。Lab 舞台截图拍不到传送到 body 的覆盖层，没有作证据。
