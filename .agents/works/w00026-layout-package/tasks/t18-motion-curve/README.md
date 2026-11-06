---
schema: nbook.task/v2
taskId: t18-motion-curve
status: planned
updated: 2026-11-06
---

# 全应用的动效向布局曲线看齐

## 目标与范围

开发者 2026-11-06：“我发现目前 grid 布局工具的这个动画曲线非常丝滑，NeuroBook 其他地方也用这种动画曲线。例如：tab 切换，ActivityBar 的 tab 切换，文件资源管理等等（开一个 task，后续再派子代理做迁移）”。

规范已改（[设计语言](../../../../../../packages/nb-ui/docs/design-language.md) 的“缓动”、[`ui-development-spec.md`](../../../../../../packages/nb-ui/docs/ui-development-spec.md) 第 7 条）：看得出在动的都用 `--ease-layout`。这个 Task 做迁移。

要向它看齐的：标签切换（`Tabs`、`SegmentedControl` 的指示线）、活动栏切换、文件资源管理器（`ExplorerRow`、`ExplorerTree` 的展开与选中）、`Tree`、内容换页（`styles.css` 的 `.nb-ui-switch-*`）、浮层展开。旧应用不动。

合同：动效的规范在设计语言，不改行为合同；Spec 里写死时长的条目（例如 `workbench/views.md` 输出 12 的淡入淡出）不在范围内。

## 当前状态

只记下了，尚未开工。等 [t07](../t07-single-tree/README.md) 的片 7a 合入再做：活动栏组件在那一片换成 `WorkbenchToolStrip`，面板头的标签带也是新的。

现状（2026-11-06，master）：`--ease-standard` 有 134 处消费，nb-ui 36 个文件、neuro-book 15 个、nb-agent-ui 10 个、nb-layout 4 个、nb-form 与测试支持各 1 个。四个主题各自覆盖它，取值不同（nbook、macos 是 `0.25, 0.1, 0.25, 1`，editorial 是 `0.2, 0, 0, 1`，aurora 是 `0.2, 0.6, 0.2, 1`）。

## 迁移时要注意

- **时长要一起试，不能只换曲线。** 这条曲线四分之一时长走完 78%，一半时长走完 97%。标签指示线现在是 180ms 的 `--motion-base`，只换曲线的话 45ms 走完八成，看着是跳过去的，开发者觉得顺很可能有 470ms 这个时长的份。每一类取哪一档，在 Lab 里并排试，交开发者定。
- **退场不换。** 这条曲线配淡出的退场看着像直接关掉（t15 的教训，对话框收回为此单独用 `--ease-dialog-leave`）。菜单、弹层的退场逐个看。
- **只变颜色、透明度的状态反馈**（悬停变色）换不换看不出差别。优先把它们也换掉，好让 `--ease-standard` 整个退役，主题里的覆盖一起删；有说不通的再留。
- `--motion-layout`、`--motion-dialog` 这些令牌在系统减少动态效果时都归零（`tokens.css`），新加令牌要跟着加进去。
- 手势跟手的（拖分隔线、滚动条滑块）没有过渡，不在范围。

## 下一步

1. 按动效的种类给 134 处分类（位移与形变、内容换页、浮层入场、退场、只变颜色），每类一行写方案。
2. 在 Lab 里做标签、活动栏、资源管理器三处的对比，开发者试完定时长。
3. 派子代理（`coder`，Sonnet：改动机械，但界面观感要判断）按类迁移；主会话审 diff、跑受影响的 e2e。动效的 e2e 按“测动画的用例开回动画”的写法，读真实的计算样式。
