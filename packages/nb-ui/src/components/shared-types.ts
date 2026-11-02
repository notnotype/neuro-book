/**
 * 组件之间共用的取值词表。各组件只声明自己能渲染的子集（`type InputSize = Extract<ControlSize, "sm" | "md">`），
 * 不另写字面量：同一个意思只有一个名字，`default` 与 `md`、`error` 与 `danger` 这类同义写法不再出现。
 * 规则见 `docs/ui-development-spec.md` 的“取值词表”一节。
 */

/** 控件尺寸档。面板宽度（例如 `DialogSize`）是另一套刻度，不用它。 */
export type ControlSize = "2xs" | "xs" | "sm" | "md" | "lg";

/** 语调：颜色传达的语义。`neutral` 是不带语义的缺省档；组件不渲染的档不进它的类型。 */
export type Tone = "neutral" | "accent" | "info" | "success" | "warning" | "danger";

export type Orientation = "horizontal" | "vertical";

/** 浮层相对锚点的方位与对齐。 */
export type Side = "top" | "right" | "bottom" | "left";
export type Align = "start" | "center" | "end";
