---
schema: nbook.task/v2
taskId: t62-drag-edge-scroll-axes
status: planned
updated: 2026-11-26
---

# 拖动的边缘滚动：横向与按指针下的滚动容器

## 目标与范围

拖动会话的边缘滚动能横向滚、按指针此刻所在的滚动容器滚（多个标签条各自滚）；标签编组示例与工作台的标签条拖到两端会自己滚

合同：[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 输出 14、验收 7。计划见 [plan.md](plan.md)，探针在 [evidences/](evidences/)。

## 结果

2026-11-26 完成，coder 子代理按切片 0、2 到 4 实施，主会话审 diff、两次变基后复跑并合入 master，Spec 收口（`ui/layout-drag` 输出 14 换成新规则、输入类型块、验收 7、Smoke 加 `tabbed-panels.e2e.ts`）：

- 核心（`drag-gesture.ts`）：`edgeScrollStep` 加 `axis`（`"y"` 与原来逐点相同），新增 `edgeScrollPlan`：两个轴各从里到外挑第一个合格的容器（这个轴让滚、这个方向有余量、指针在另一轴范围内、离这一端不到 `edgePx` 或已越过），同时挑中就一起滚；“先发布再滚”与滚动中松手那一段不变。
- 适配层（`drag-session.ts`）：`autoScroll` 改成 `containers({point, top})`，去掉 `element`（CHANGELOG 不兼容一条）；轴看计算样式的 `overflow-x`/`overflow-y`，不看尺寸（`overflow: hidden` 的元素照样能被程序滚，资源树就是）；滚动用 `scrollBy({behavior: "instant"})`（`scroll-behavior: smooth` 下赋值读回还是旧值）。
- 调用方：资源树与 Lab 的 `DragSessionScene` 交 `() => [element]`；标签编组示例只交指针下那条标签条（交全部会让左边那条也滚，变异证实）。示例 README 删掉“拖到两端不滚”的限制。
- 工作台这次不接（Work 的“后续”记了原因与草稿条目的出处）。
- 用例：`drag-gesture.test.ts` 横向同构、角上两个轴、同一容器两轴、候选每帧现取、余量为 0 不调 `scrollBy`；`drag-session.dom.test.ts` 四条（`containers` 的参数、`overflow-x: auto` 滚而 `hidden` 不滚、空数组不滚）；`tabbed-panels.e2e.ts:118` 指针挪出边缘带（加 `scrollLeft` 不变），`:170` 对应验收 7。
- 变异检查五项都失败（去掉余量检查、hidden 也算能滚、`a() || b()` 短路、示例交全部标签条、指针放回边缘带）；最后一项失败在前一步的落点断言，`scrollLeft` 不变那句否定断言没被单独证明。
- 验证：coder 跑了 nb-layout 单测与 dom、typecheck、`api:check`、示例 typecheck 与构建，应用 typecheck、SDK 快照（没变）、资源树 dom，`governance:check`、`docs:check`；e2e：`tabbed-panels` 16 条全过；应用清单（`lab-drag-session` 整份、`files-explorer:545`、`:1011`、`editor-area:929`）首轮 20 过、3 条 Lab 没就绪（负载 9.7），单独重跑都过；基线里 `lab-drag-session` 有 10 条同因失败（负载升到 23），那一半基线没有对照作用。主会话变基后复跑 nb-layout 测试、typecheck、`api:check`、应用 typecheck 与资源树 dom，都过。
- 没验证：从右到左排版、横向滚动中途松手的 e2e（只有核心单测）、触摸、`smooth`（只有探针）。
