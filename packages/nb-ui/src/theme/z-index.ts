/**
 * 组件库浮层层级常量。
 *
 * z-index 不是主题语义，不进 CSS 变量契约；组件用 :style 绑定消费，
 * 避免在原子类里复制魔法值。新增浮层组件时在此登记。
 */
import type {InjectionKey} from "vue";

export const NB_Z_INDEX = {
    /** Dropdown / Combobox 等局部浮层 */
    popover: 60,
    tooltip: 70,
    /** 非模态浮动窗口，低于模态 Dialog */
    dialogWindow: 8990,
    dialog: 9000,
    notification: 9001,
    /** 右键菜单；子菜单用 contextMenu + 1 */
    contextMenu: 9100,
} as const;

/** DialogWindow 内容树中的局部浮层层级；未提供时回退到普通页面浮层层级。 */
export const NB_POPOVER_Z_INDEX: InjectionKey<number> = Symbol("nb-popover-z-index");

/**
 * 浮动窗口每深一层占的层级跨度：本体一格、它的局部浮层下一格。
 * 整档压在 `dialogWindow` 与模态 `dialog` 之间，所以 8990–8999 一共容纳 5 层窗口；
 * 再深的嵌套不该靠 z-index 解决，而是重新想清楚那是不是两个窗口。
 */
export const NB_DIALOG_WINDOW_Z_STEP = 2;

/** 当前所在的浮动窗口嵌套深度，最外层窗口是 1。未提供时按 0 处理（注入方即第 1 层）。 */
export const NB_DIALOG_WINDOW_DEPTH: InjectionKey<number> = Symbol("nb-dialog-window-depth");
