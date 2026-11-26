---
schema: nbook.task/v2
taskId: t62-drag-edge-scroll-axes
status: planned
updated: 2026-11-26
---

# 拖动的边缘滚动：横向与按指针下的滚动容器

## 目标与范围

拖动会话的边缘滚动能横向滚、按指针此刻所在的滚动容器滚（多个标签条各自滚）；标签编组示例与工作台的标签条拖到两端会自己滚

合同：[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 输出 14 的 planned 改法、验收 7（planned）。计划见 [plan.md](plan.md)，探针在 [evidences/](evidences/)。

## 当前状态

2026-11-26 t61 发现拖动会话的边缘滚动只滚竖向、只认一个固定元素。计划由规划子代理起草（先跑探针），主会话核对定稿：`autoScroll` 改成按指针交候选容器、轴看计算样式；标签编组示例接上；工作台这次不接（实时布局冻结了标签条的量取、`unmoved`/`sticky` 假定指针不动内容不动，见计划“不做与风险”），记进 Work 的“后续”。待确认 5 条按推荐做。

## 下一步

派 coder 按切片 0、2 到 4 实施（与 t60 并行，文件不重叠；`api/vue.api.txt` 与 CHANGELOG 后合入的那个变基时重新生成、核对），主会话验收，切片 5 收口。
