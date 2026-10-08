/**
 * 面板的位置、对齐、隐藏、收起与最大化：取值域、默认值与判定（docs/specs/ui/workbench-shell.md 输出 2、7）。
 *
 * 纯模块：几何（`layout.ts`）、工作台 store、命令与外壳组件共用这一份取值域与判定，不各写字面量。两条规则在它们之间
 * 必须一致：
 * - 对齐只对水平位置有意义：左右面板只有一种跨度，保存值留着（改回水平位置时再生效），几何与命令可用性按“不适用”处理；
 * - 最大化只在左右位置或“水平且居中”可用；最大化只在内存，不落盘。
 */

export const PANEL_POSITIONS = ["bottom", "top", "left", "right"] as const;

export type PanelPosition = (typeof PANEL_POSITIONS)[number];

export const PANEL_ALIGNMENTS = ["center", "left", "right", "justify"] as const;

export type PanelAlignment = (typeof PANEL_ALIGNMENTS)[number];

/** 会落盘的面板状态（`views-customizations` 的面板字段组）。 */
export interface PanelPreferences {
    readonly position: PanelPosition;
    readonly alignment: PanelAlignment;
    readonly hidden: boolean;
    readonly collapsed: boolean;
}

/** 外壳组件接收的完整状态：比落盘多一个只在内存的 `maximized`。 */
export interface PanelState extends PanelPreferences {
    readonly maximized: boolean;
}

/** 没有记录时的默认：底部居中、显示、展开。 */
export const PANEL_DEFAULTS: PanelPreferences = {position: "bottom", alignment: "center", hidden: false, collapsed: false};

/** 水平位置（顶部、底部）：跨度、32px 标题头收起与高度轴手势只在这两个位置上成立。 */
export function isHorizontalPanelPosition(position: PanelPosition): boolean {
    return position === "top" || position === "bottom";
}

/** 最大化可用：左右位置可用；水平位置只有居中可用（其余对齐要先切回居中）。 */
export function panelMaximizable(position: PanelPosition, alignment: PanelAlignment): boolean {
    return !isHorizontalPanelPosition(position) || alignment === "center";
}
