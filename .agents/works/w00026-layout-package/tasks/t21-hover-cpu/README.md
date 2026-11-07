---
schema: nbook.task/v2
taskId: t21-hover-cpu
status: active
updated: 2026-11-07
---

# 不按键划过界面时 CPU 高

## 目标与范围

开发者 2026-11-07 观察到鼠标快速划过界面时 CPU 从 1% 飙到 50%，要开 Task 查清原因并降下来。

行为合同不变，只降开销。

## 当前状态

只有线索，还没定位，也没动代码。

t20 的结论是“没有单一原因”，那次只看了耗时。按调用方分解（400 次移动，开发服务，无头 Chrome，同 [t22 的证据](../t22-drag-frame/evidences/frame-cost.txt)）后：

- 样式重算一共约 423ms，其中分隔线的 `snap` 占 235ms（42 次强制重算，平均 78 个元素），超过一半。没按键划过时它不该跑。
- 没验证的猜测：Vue 每次更新都重新调用 `SashHandle` 的函数 ref（`setSeamRef`、`setLineRef`），它们都调 `snapHost.schedule()`，于是所有分隔线都重新量一遍。
- `useSashGesture` 的 `hitTargets` 64 次强制重算，共约 29ms，次数多但不贵。
- 帧自己的重算约 140ms，每次平均 26 个元素。

无头环境量不到 GPU 进程与合成。开发者量到 50%、这里主线程约 13%，差额在哪还不知道。

## 下一步

先验证 `snap` 的触发来源并修掉；再请开发者录一段 Chrome Performance 看 GPU 与合成。和 t22 改同几个文件（`NestedGrid.vue`、`SashHandle.vue`），排在 t22 切片 1 之后，不并行。
