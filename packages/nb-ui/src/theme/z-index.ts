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
