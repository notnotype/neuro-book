/**
 * Panel 的位置 / 对齐 / 显隐 / 收起 / 最大化：枚举、默认值与判定。
 *
 * 纯模块：不 import Vue / Storage / Store。几何（`layout.ts`）、持久化（`view-placements*.ts`）、
 * 命令目录（`workbench-shell-commands.ts`）与纯布局组件都消费同一份取值域与判定，
 * 谁都不再各写一份字面量。
 *
 * 两条规则值得单独写在这里，因为它们在四个消费者之间必须一致：
 * - **对齐只对水平位置有意义**：左右 Panel 只有一种跨度，保存值留着（改回水平时再生效），
 *   但几何与命令可用性一律按「不适用」处理；
 * - **最大化只在「左右位置」或「水平 + 居中」可用**：其余水平对齐要求先切回居中；
 *   最大化是宿主内存里的瞬时状态，不落盘。
 */
export const SHELL_PANEL_POSITIONS = ["bottom", "top", "left", "right"] as const;

export type ShellPanelPosition = (typeof SHELL_PANEL_POSITIONS)[number];

export const SHELL_PANEL_ALIGNMENTS = ["center", "left", "right", "justify"] as const;

export type ShellPanelAlignment = (typeof SHELL_PANEL_ALIGNMENTS)[number];

/** 取值域成员表：静态字面量用 Record（不建 Set）。 */
const POSITIONS: Record<string, true> = Object.fromEntries(SHELL_PANEL_POSITIONS.map((id) => [id, true]));

const ALIGNMENTS: Record<string, true> = Object.fromEntries(SHELL_PANEL_ALIGNMENTS.map((id) => [id, true]));

/** 缺字段时的产品默认：底部居中、可见、展开。 */
export const SHELL_PANEL_DEFAULTS = {
    position: "bottom",
    alignment: "center",
    hidden: false,
    collapsed: false,
} as const satisfies WorkbenchPanelPreferences;

/** 会落盘的 Panel 状态（`workbench.views/customizations`）。 */
export type WorkbenchPanelPreferences = Readonly<{
    position: ShellPanelPosition;
    alignment: ShellPanelAlignment;
    hidden: boolean;
    collapsed: boolean;
}>;

/** 纯布局组件接收的完整状态：比落盘多一个瞬时的 `maximized`（只在宿主内存里）。 */
export type WorkbenchPanelState = WorkbenchPanelPreferences & Readonly<{maximized: boolean}>;

export function isShellPanelPosition(value: unknown): value is ShellPanelPosition {
    return typeof value === "string" && POSITIONS[value] === true;
}

export function isShellPanelAlignment(value: unknown): value is ShellPanelAlignment {
    return typeof value === "string" && ALIGNMENTS[value] === true;
}

/** 水平位置（top / bottom）：跨度、32px 标题头收起与高度轴手势只在这两个位置上成立。 */
export function isHorizontalPanelPosition(position: ShellPanelPosition): boolean {
    return position === "top" || position === "bottom";
}

/** 对齐是否生效：左右位置忽略保存值，改回水平位置时再按保存值生效。 */
export function panelAlignmentApplies(position: ShellPanelPosition): boolean {
    return isHorizontalPanelPosition(position);
}

/** 最大化可用性：左右位置可用，水平位置只有居中可最大化（其余对齐要求先切回居中）。 */
export function panelMaximizable(position: ShellPanelPosition, alignment: ShellPanelAlignment): boolean {
    return !isHorizontalPanelPosition(position) || alignment === "center";
}

/**
 * 从记录字段拼出偏好：缺字段取默认、非法枚举值回落默认。
 *
 * 「记录里有坏字段」由持久化层的读取分类负责保留原件并阻断覆盖，这里只回答「能不能当状态用」；
 * 侧向位置的 `collapsed` 不做删除（保存值留着），几何在使用处按「不适用」处理。
 */
export function resolvePanelPreferences(input: Readonly<{
    position?: unknown;
    alignment?: unknown;
    hidden?: unknown;
    collapsed?: unknown;
}>): WorkbenchPanelPreferences {
    return {
        position: isShellPanelPosition(input.position) ? input.position : SHELL_PANEL_DEFAULTS.position,
        alignment: isShellPanelAlignment(input.alignment) ? input.alignment : SHELL_PANEL_DEFAULTS.alignment,
        hidden: typeof input.hidden === "boolean" ? input.hidden : SHELL_PANEL_DEFAULTS.hidden,
        collapsed: typeof input.collapsed === "boolean" ? input.collapsed : SHELL_PANEL_DEFAULTS.collapsed,
    };
}
