---
schema: nbook.task/v2
taskId: t38-status-line-sorting
status: active
updated: 2026-11-18
---

# 状态栏设置的后续：模式提醒可关、复选框对齐、拖动排序做成共用的实时布局

## 目标与范围

[t37](../t37-status-line-customization/README.md) 交付后开发者 2026-11-18 提的三点，原话：

1. “状态栏中全部放行这个提示为什么我关不了”
2. “设置界面中，单选按钮没有和文字对齐”
3. “你这种拖拽排序是否推荐做成组件，或者做成 Composable？我现在就能看出几个问题：右边这一组的无法拖拽到左边这一组；拖动手感做成实时布局的哪一种；底部边框这种设计是 AI slop。可以先在 nbdev 上设计一下，我调整确认后再改代码”

先出评审板，定了再写 Spec 与计划、再改代码。合同：[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 15、45、46，[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“状态栏”；拖动的手感参照 [`ui/workbench-layout.md`](../../../../../docs/specs/ui/workbench-layout.md) 输出 38 的“标签条上”与“卡片”。

## 查到的现状

- **全部放行关不掉**：t29 评审板第 1 轮定了“提醒类总显示”，那一轮的推荐只写了“提醒类的项总会显示”，没有写理由（t29 记录与评审板里都没有）。“计划模式”这类非默认模式标记与“全部放行”警告被归进了提醒，和“等你批准”“断线”同类；可它们是用户自己选的持续状态，输入框工具栏上已有（全部放行是红色），状态栏是第二遍。
- **没对齐的是 nb-ui 的单选组**：`RadioGroup` 的圆点 20px 加 `mt-0.5`，标签行高是 `leading-snug`（约 19px），圆点中线比文字低约 1.5px（3 倍截图量过），所有用单选组的设置页都有。草稿里改成把圆点放进高 `1lh` 的盒子里居中，截图对过。状态栏设置页的复选框本身是对齐的，但每行的把手与上移下移按钮对的是两行字的中间。
- **拖动**：设置页手写的是浏览器原生拖放，只在同一侧排序，落点画成行上下沿的线；原生拖放只能画浏览器的半透明拖影，做不了实时布局，也不支持触摸与键盘。nb-layout 已有拖动手势状态机与 DOM 会话（门槛、指针捕获、Esc 与失焦取消、键盘拿起），工作台标签条里排序的判定（被拖的标签盖过邻居一半邻居就让开）也在那里；2026-10-09 的选型决定拖动手势自写，不引入 dnd-kit（[`workbench-shell-abstractions.md`](../../../../../docs/proposals/workbench-shell-abstractions.md) 的决策记录）。
- **能换边以后**：设置要记每项在哪一边（现在一侧由目录定），左边窄时的规则也要定：现在左边只截断，放了数据项会把提醒挤掉。

## 评审

评审板 [`artifacts/review/`](artifacts/review/index.html)，第 1 轮四题：`mode-flags`（模式标记怎么处理）、`drag-feel`（两种实时布局，板上有能直接拖的原型）、`narrow-rule`（换边后窄时先收哪些）、`sortable-form`（composable 还是组件）；单选组对齐、行内控件对齐标题行、删落点线列为直接修。草稿 worktree `.worktree/w00032-t38-drafts`（分支 `t38/drafts`，不合并），里面只有单选组的对齐试改。

## 决定

| 编号 | 日期 | 决定 |
|---|---|---|

## 当前状态

2026-11-18 评审板第 1 轮已发布，等开发者答复。

## 下一步

读答复、记决定；定稿后写 Spec 改动与 `plan.md`，再在新的 Task worktree 里实现。
