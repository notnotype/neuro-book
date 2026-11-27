/**
 * 消息视图段画在哪（`AgentMessages` 的 `placement`）：`rail` 送进侧轨给的两个元素（中段 `main`、底段 `foot`）；`edge` 画在视图自己的右边缘（浮动窗）；
 * `none` 不画。`width` 是此刻生效的宽（收着是窄列的宽），`tooNarrow` 时视图段的展开按钮给“窗口太窄”（请求展开被宿主拒了、仍放不下）。
 *
 * 两个元素写成 `object`，组件按 `instanceof HTMLElement` 收下（不是元素时当作 `none`）：这个入口也被应用里不带 DOM 类型的 tsc 读到
 * （插件入口动态导入 `@notnotype/nb-agent-ui/vue`），同工作台合同里视图段的位置。
 */
export type MessagesSegmentPlacement =
    | {readonly kind: "rail"; readonly main: object; readonly foot: object; readonly width: number; readonly tooNarrow?: boolean}
    | {readonly kind: "edge"; readonly width: number; readonly tooNarrow?: boolean}
    | {readonly kind: "none"};
